# communication.md — Capa radio: Google Nearby Connections

## Decisión de fondo

ZIRO usa **Google Nearby Connections** como capa de transporte radio. **NO implementa Wi-Fi Direct ni BLE directamente**.

## Por qué Nearby Connections

- Abstrae Wi-Fi Direct + BLE en una sola API.
- Maneja automáticamente: **descubrimiento, autenticación, encriptación de tránsito, re-conexión tras pérdida de contacto**.
- Diseñado exactamente para nuestro caso: "descubrir dispositivos cercanos, transferir datos sin Internet".
- Cross-platform (Android + iOS), pero para 36h nos enfocamos en Android Kotlin.

## Lo que Nearby Connections **NO** hace (lo hacemos nosotros)

- ❌ No resuelve deduplicación por id → nuestro código.
- ❌ No resuelve TTL/hop → nuestro código.
- ❌ No resuelve gossip/sincronización de ledgers → nuestro código.
- ❌ No garantiza orden de entrega → aceptamos que no (es best-effort).
- ❌ No resuelve persistencia entre sesiones → Room/SQLite nuestro.

## ServiceId

```kotlin
private const val SERVICE_ID = "ziro.relay.v1"
```

Este ID es público en el APK. Permite que solo dispositivos ZIRO con la misma versión del protocolo se reconozcan entre sí. Versión `v1` permite migrar a `v2` sin romper compatibilidad hacia atrás.

## Estrategia de discovery

```kotlin
Nearby.getConnectionsClient(context).startAdvertising(
    SERVICE_ID,
    "ZIRO Relay",  // human-readable name visible en el peer
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
    localEndpointName,    // ej: "ziro-A-${hash}"
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
val telegramBytes = telegram.toJsonString().toByteArray()  // ~120 bytes
val payload = Payload.fromBytes(telegramBytes)
Nearby.getConnectionsClient(context).sendPayload(endpointId, payload)
```

El receptor, en `onPayloadReceived(endpointId, payload)`:
1. Deserialize JSON → `Telegram`.
2. `mutex.withLock(t.id) { ledger.put(t.id, t) }` (dedup).
3. Enviar ACK: `Payload.fromBytes("ACK:${t.id}".toByteArray())`.

### Fase 5 — Lifecycle de la conexión

- **Hold:** mantener la conexión 60s con actividad (permite sync de más ledgers).
- **Idle:** 15s sin actividad → close.
- **Al cerrar:** marcar en `delivered_peers[]` los IDs enviados a ese peer (para no reenviar si se reencuentran).

## Limitaciones reales (declaration of honesty)

- **Rango por hop: 50-200 m** en condiciones normales (urban denso puede ser 30 m). **No es 1 km.**
- **Tiempo de handshake: 5-15 segundos** en condiciones normales. El payload (120 bytes) es instantáneo comparado.
- **Máximo 3 conexiones simultáneas por nodo** (recomendado para batería/CPU).
- **Teléfonos SIN ZIRO no participan** — limitación de Android. Por eso el modelo Relay/Gateway.
- **Background discovery se pausa** — la app tiene que estar abierta o con foreground service.

## Permisos Android requeridos

```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- Para Android 12+ -->
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" />
```

## Stack recomendado (Android)

```gradle
// build.gradle.kts
dependencies {
    implementation("com.google.android.gms:play-services-nearby:19.3.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
}
```

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
| Permisos no otorgados al usuario | UI explica por qué cada permiso es necesario |
| Battery drain por advertising continuo | En estado ORPHAN, bajar frecuencia |
| Wi-Fi del会場 interfiere | Apagar Wi-Fi de los teléfonos, usar solo datos para el gateway |
