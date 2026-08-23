# communication.md — Capa radio: Google Nearby Connections

## Dónde vive Nearby Connections (aclaración arquitectónica)

Este es el punto más importante para entender Replica. **Nearby Connections vive en el teléfono, NO en el backend.**

```
ANDROID APP (cada teléfono) — un solo APK vía EAS Build
├── src/                              React Native · pantallas, perfil, mapa
│      │
│  ════╪════  el bridge (ver bridge.md) · 5 funciones, 1 evento
│      │
└── modules/ziro-relay/               EL MOTOR · Kotlin
    ├── application/                  ingest · send · forward · engine
    ├── domain/ + ports/              contrato compartido, cero Android
    └── adapters/nearby/              Nearby Connections API  ← acá, y SOLO acá
       │
       ▼ (Bluetooth / Wi-Fi Direct)
OTHER PHONES (peer-to-peer, sin Internet)

Cuando algún nodo consigue Internet:
Node → Internet → Backend Render (independiente, solo conoce la API HTTP/WS)
```

**Nearby vive abajo del bridge, no arriba.** JavaScript nunca toca la radio: manda comandos ("activá", "mandá") y lee el ledger. El motivo es duro — el hilo de JS de React Native no está confiablemente vivo en background, y un telegrama que llega con la pantalla apagada tiene que ser verificado, deduplicado y guardado igual. Ver `bridge.md`.

El backend **NO usa Nearby**. No sabe nada del grafo mesh. Cuando un nodo con Internet aparece, ese nodo toma su ledger local y lo postea por HTTP. El backend recibe JSON por API REST/WebSocket exactamente igual que si viniera de cualquier cliente.

Esto mata el modelo mental incorrecto "Backend → Nearby → teléfonos". La realidad es **dos canales independientes**:

1. **Phone → Nearby → Phone** (sin Internet, capa radio entre pares).
2. **Phone + Internet → Backend Render** (canal saliente clásico HTTP/WS).

## Decisión de fondo

Replica usa **Google Nearby Connections** como capa de transporte radio. **NO implementa Wi-Fi Direct ni BLE directamente**.

## Por qué Nearby Connections

- Abstrae Wi-Fi Direct + BLE en una sola API.
- Maneja automáticamente: **descubrimiento, autenticación, encriptación de tránsito, re-conexión tras pérdida de contacto**.
- Diseñado exactamente para nuestro caso: "descubrir dispositivos cercanos, transferir datos sin Internet".
- Para 36h el alcance es Android. La API de iOS es distinta y queda fuera.

## Lo que Nearby Connections **NO** hace (lo hacemos nosotros)

- ❌ No resuelve deduplicación por id → nuestro código.
- ❌ No resuelve TTL/hop → nuestro código.
- ❌ No resuelve gossip/sincronización de ledgers → nuestro código.
- ❌ No garantiza orden de entrega → aceptamos que no (es best-effort).
- ❌ No resuelve persistencia entre sesiones → nuestro `TelegramLedger` (en memoria en MVP, Room en Fase 5).

## ServiceId

```kotlin
private const val SERVICE_ID = "replica.relay.v1"
```

Este ID es público en el APK. Permite que solo dispositivos Replica con la misma versión del protocolo se reconozcan entre sí. Versión `v1` permite migrar a `v2` sin romper compatibilidad hacia atrás.

## Estrategia de discovery

```kotlin
Nearby.getConnectionsClient(context).startAdvertising(
    SERVICE_ID,
    "Replica Relay",  // human-readable name visible en el peer
    connectionLifecycleCallback,
    AdvertisingOptions.Builder()
        .setStrategy(Strategy.P2P_STAR)  // un nodo central + varios periféricos
        .build()
)
```

**Por qué `P2P_STAR`** y no `P2P_CLUSTER`: modela exactamente nuestro caso "un origen + varios relays". `P2P_CLUSTER` intenta mesh completo con routing, que no necesitamos.

## Flujo detallado (4 fases)

### Fase 1 — Discovery mutuo

```kotlin
// En paralelo, ambos nodos hacen advertising y discovery
Nearby.getConnectionsClient(context).startAdvertising(...)
Nearby.getConnectionsClient(context).startDiscovery(SERVICE_ID, endpointDiscoveryCallback, discoveryOptions)
```

Cuando A descubre a B (o viceversa), se dispara `onEndpointFound(endpointId, info)`.

### Fase 2 — Conexión + Handshake

```kotlin
Nearby.getConnectionsClient(context).requestConnection(
    localEndpointName,    // ej: "replica-A-${hash}"
    endpointId,
    connectionLifecycleCallback
)
```

Antes de aceptar la conexión, se intercambia un **payload de identificación**:

```kotlin
val hello = HelloMessage(
    v = 1,                          // versión del protocolo
    nodeId = hashDevice(),          // hash corto del device
    caps = setOf("relay", "sync"),  // capacidades
    ledgerSize = ledgerDao.count()
).toBytes()
Nearby.getConnectionsClient(context).sendPayload(endpointId, Payload.fromBytes(hello))
```

Cuando se recibe el hello del peer, **validar `v`** — si no es compatible, rechazar.

### Fase 3 — Sync de ledgers (gossip)

Una vez conectados, A y B ejecutan el protocolo de gossip:

```
1. A → B: {my_ids: [uuid1, uuid2, ...], ledger_size: N, oldest_ts: T}
2. B compara con su ledger → B → A: {want_from_you: [...], i_have_for_you: [...]}
3. A → B: bytes de want_from_you (solo los nuevos)
4. B → A: bytes de i_have_for_you
5. ACK por cada telegrama recibido → marca en delivered_peers[]
```

### Fase 4 — Payload de telegrama individual

```kotlin
val telegramBytes = TelegramCodec.encode(telegram)  // ~550-700 bytes
val payload = Payload.fromBytes(telegramBytes)
Nearby.getConnectionsClient(context).sendPayload(endpointId, payload)
```

El receptor, en `onPayloadReceived(endpointId, payload)`:
1. Deserialize JSON → `Telegram`.
2. Pasar los bytes CRUDOS a `IngestTelegram.handle(raw, from)`. No parsear y re-serializar: el HMAC se calcula sobre el canonical y re-serializar es como mueren las firmas.
3. Enviar ACK: `Payload.fromBytes("ACK:${t.id}".toByteArray())`.

### Fase 5 — Lifecycle de la conexión

- **Hold:** mantener la conexión 60s con actividad (permite sync de más ledgers).
- **Idle:** 15s sin actividad → close.
- **Al cerrar:** marcar en `delivered_peers[]` los IDs enviados a ese peer (para no reenviar si se reencuentran).

## Limitaciones reales (declaration of honesty)

- **Rango por hop: 50-200 m** en condiciones normales (urban denso puede ser 30 m). **No es 1 km.**
- **Tiempo de handshake: 5-15 segundos** en condiciones normales. El payload (~650 bytes) es instantáneo comparado — el handshake domina por tres órdenes de magnitud.
- **Máximo 3 conexiones simultáneas por nodo** (recomendado para batería/CPU).
- **Teléfonos SIN Replica no participan** — limitación de Android. Por eso el modelo Relay/Gateway.
- **Background discovery se pausa** — la app tiene que estar abierta o con foreground service.

## Permisos Android requeridos

El manifest real está en `modules/ziro-relay/android/src/main/AndroidManifest.xml`. Al ser un módulo local de Expo, ese manifest **se mergea solo** al de la app durante `expo prebuild`: no hace falta ningún config plugin, y los permisos quedan versionados junto al código que los necesita. Tres cosas que la versión anterior de esta sección no tenía y que rompen la app:

**1. Los permisos de Bluetooth legacy necesitan `maxSdkVersion`.** Sin eso, Android 12+ los trata como permisos activos y ensucia el prompt.

**2. `NEARBY_WIFI_DEVICES` necesita `usesPermissionFlags="neverForLocation"`** en Android 13+.

**3. El foreground service necesita permiso TIPADO.** En Android 14+ `startForeground()` **lanza excepción** sin `android:foregroundServiceType` en el `<service>` **y** el permiso `FOREGROUND_SERVICE_CONNECTED_DEVICE` declarado. Esto es un crash garantizado en teléfonos nuevos, y se debuggea como si fuera un problema de Nearby.

```xml
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" tools:targetApi="s" />

<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES"
    android:usesPermissionFlags="neverForLocation" tools:targetApi="tiramisu" />

<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

```xml
<service
    android:name=".adapters.service.RelayForegroundService"
    android:exported="false"
    android:foregroundServiceType="connectedDevice" />
```

**Declarar en el manifest no alcanza.** `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES`, las de location y `POST_NOTIFICATIONS` se piden **en runtime**. Si el usuario no las otorga, Nearby falla en silencio y parece hardware roto.

## Colisión de conexión simétrica

Los dos dispositivos hacen advertising **y** discovery al mismo tiempo. Eso significa que A encuentra a B en el mismo instante en que B encuentra a A, y **los dos llaman `requestConnection`**. Nearby sobrevive, pero quedan conexiones rechazadas o duplicadas que se ven como radio inestable.

Desempate determinista: **solo el endpoint con el nombre lexicográficamente menor inicia.**

```kotlin
// adapters/nearby/NearbyTransport.kt
internal fun shouldInitiateTo(remoteEndpointName: String): Boolean =
    localEndpointName < remoteEndpointName
```

## Stack (Android)

Versiones reales en `gradle/libs.versions.toml`. Lo relevante:

```
play-services-nearby        19.3.0
kotlinx-serialization-json  1.7.3
kotlinx-coroutines-android  1.9.0
expo SDK                    52 (RN 0.76.5)
minSdk                      26   (java.time sin desugaring)
```

**Room NO entra en el MVP.** El ledger arranca en memoria (`InMemoryLedger`) y Room llega en Fase 5 detrás del puerto `TelegramLedger`. Agregar Room + KSP en la Fase 1 cuesta una hora que el MVP no tiene.

## Alternativas consideradas y rechazadas

| Alternativa | Por qué no |
|---|---|
| **Bridgefy SDK** | Paper USENIX 2022 demostró MITM todavía posible. Mejor hacer nuestro protocolo con HMAC. |
| **Briar como librería** | Android-only, no es SDK, hay que forkear el proyecto entero. |
| **Wi-Fi Direct crudo** (`WifiP2pManager`) | Mucho boilerplate, lifecycle complejo, manejo de Group Owner manual. |
| **BLE Advertising puro** | Requiere implementar GATT services, chunking, ACK manualmente. Demasiado bajo nivel para 36h. |
| **Apple Multipeer Connectivity** | iOS-only. Para 36h, Android Kotlin. |
| **Meshtastic** | Requiere hardware ESP32 externo ($30+). Fuera de scope. |

## Riesgos identificados y mitigación

| Riesgo | Mitigación |
|---|---|
| Nearby Connections discovery lento (>15s) | Duty-cycling agresivo; en demo, discovery continuo |
| Permisos no otorgados al usuario | UI explica por qué cada permiso es necesario; se piden en runtime, no solo en el manifest |
| Battery drain por advertising continuo | En estado ORPHAN, bajar frecuencia |
| Wi-Fi del venue interfiere | **Desconectarse de la red del venue — NO apagar la radio Wi-Fi.** Ver abajo. |
| Colisión de conexión simétrica | Tie-break por nombre de endpoint (`shouldInitiateTo`) |
| Crash del foreground service en Android 14+ | `foregroundServiceType="connectedDevice"` + permiso tipado |

## ⚠️ Las radios van PRENDIDAS

Corrección importante respecto de versiones anteriores de este doc y de `demo-plan.md`, que decían "apagar Wi-Fi, apagar Bluetooth":

**Nearby Connections necesita Bluetooth Y Wi-Fi encendidos.** BLE hace el discovery, Wi-Fi Direct hace el canal de datos. Apagar cualquiera de las dos mata la demo. Modo avión apaga las dos de entrada, así que hay que **re-prenderlas a mano** después de activarlo.

Lo que sí hay que hacer es **desconectarse de la red Wi-Fi del venue** (radio prendida, sin red asociada). Eso es lo que reduce interferencia; apagar la radio no reduce interferencia, elimina el transporte.

## No corre en emulador

No hay Bluetooth ni Wi-Fi Direct virtualizado. **Dos teléfonos físicos o nada.** Por eso existe `FakeTransport`: implementa el mismo puerto `PeerTransport` en proceso, así que todo el pipeline (encode → transmitir → decode → verificar → dedup → guardar) se puede ejercitar en un solo teléfono o en un emulador. Del lado de la UI, `fakeRelayClient` cumple el mismo rol y corre en **Expo Go**. Ver `bridge.md`.
