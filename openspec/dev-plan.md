# dev-plan.md — Plan de desarrollo para 2 personas (MVP offline)

> Cómo repartimos el trabajo A y B en 36 horas para llegar al MVP: un telegrama cruzando entre dos teléfonos vía Nearby Connections. Este plan se negocia en la Fase 0 y se respeta hasta el demo.

---

## 1. Contexto y por qué este plan

Hackatón de 36 horas (Platanus Hack 26, Bogotá), equipo de 2 personas, foco en el módulo offline de ZIRO. La decisión arquitectónica de fondo — puro **Kotlin + Jetpack Compose** en un único APK Android nativo (sin React Native, sin Expo, sin bridge) — hace que el offline module sea self-contained: una app Android con un solo proceso, una sola build, un solo toolchain. Eso habilita una división del trabajo **equitativa y por path vertical**, no por capa horizontal.

La **trampa obvia** en un equipo de 2 con 36 horas es que A y B se bloqueen mutuamente: A está haciendo el sender, B está haciendo la UI, y ninguno puede validar nada sin la pieza del otro. La solución es **contrato primero**: ambos firman un contrato compartido en la Fase 0 y avanzan solos contra ese contrato, no contra la implementación del compañero.

---

## 2. Principio: contrato primero

Si A y B trabajan contra la implementación del otro, se bloquean. Si trabajan contra un **contrato compartido que se define en la Fase 0 (1-2 horas, los dos juntos)**, ambos avanzan solos y la integración es juntar dos piezas que encajan.

Por qué funciona:

1. **B puede arrancar hoy mismo con un `FakeEventBus`** y validar la UI sin teléfono, sin Nearby, sin esperar a que A termine el wrapper.
2. **Cambios de última hora se negocian contra el contrato, no contra el código del otro.** "El contrato dice que `RelayEvent.TelegramReceived` lleva un `Telegram`. Si querés cambiar `Telegram`, primero actualizamos el contrato, después ambos ajustan."
3. **La integración tiene checkpoints explícitos** — momentos definidos donde se juntan, validan que las dos piezas encajan, y siguen. Sin checkpoint, "funciona en mi máquina" se perpetúa.

El contrato se firma en la Fase 0. Es la única pieza de código que ambos tocan en simultáneo en todo el sprint.

---

## 3. Equipo y división equitativa (por path vertical, no por capa)

### División equitativa — por path vertical

| Persona A — Emisión | Persona B — Recepción |
|---|---|
| Project skeleton (Gradle, AndroidManifest, permisos) | Telegram data class + kotlinx.serialization |
| `NearbyWrapper` (advertise, discover, connect) | `TelegramStore` (in-memory dedup con `MutableMap<String, Telegram>`) |
| `TelegramSender`: bytes → `Nearby.sendPayload` | `TelegramReceiver`: callback → deserializar → dedup |
| `sendTestTelegram()`: genera UUID, hardcodea contenido, manda | UI Home: status del nodo, contador de pares |
| Foreground service para discovery en background | UI Demo: botón "Enviar test" + lista de recibidos |
| HMAC signing del telegrama | UI Settings: profile hardcoded |
| Reenvío: cuando aparece nuevo par, mandar lo que tengo | Demo flow: armar el escenario de prueba (logs, screenshots) |

**Cada uno toca Nearby.** A para mandar, B para recibir. Ambos necesitan entender la API, pero solo uno la implementa por path. Si A descubre un bug en `onPayloadReceived` mientras está testeando, **se lo dice a B** — B es quien lo arregla porque es su código.

### Estimación de líneas

| Persona | Líneas estimadas | Composición |
|---|---|---|
| **A** | ~400 | Plomería: wrapper de Nearby, foreground service, HMAC, sender, DI. Menos visible en demo, más crítico para que ande. |
| **B** | ~500 | UI Compose + receiver + store + verificación. Más visible en demo, más iteración. |

Ratio ~45/55 a favor de B. Está bien — la UI es lo que ve el juez, y B es quien va a estar al teléfono en la mesa de demo. A está cerca por si falla la radio.

### Quién lidera cada momento

- **Fase 0 — escribir el contrato:** los dos juntos, una pantalla compartida, Kotlin Playground o Android Studio vacío.
- **Fase 0 — primer commit del skeleton:** A lidera, B revisa. Es código 100% A pero el contrato ya está firmado.
- **Fase 3 — primer telegrama cruzando dos phones:** A lidera (sender), B valida la UI cuando el card aparece.
- **Demo a los jueces:** B lidera (UI visible, narrativa), A cerca por si falla radio.

---

## 4. El contrato compartido (Fase 0 — 1-2 h, los dos juntos)

Este código es la **única verdad que ambos firman antes de separar**. Vive en `app/src/main/java/com/ziro/relay/contract/`. No se toca sin acuerdo de los dos.

```kotlin
// En app/src/main/java/com/ziro/relay/contract/

@Serializable
data class Telegram(
    val v: Int = 1,
    val id: String, // UUID v4
    val user_id: String,
    val event_id: String,
    val event: String,
    val name: String? = null,
    val location: Location? = null,
    val status: String,
    val question_id: String? = null,
    val answer_hash: String? = null,
    val timestamp: Long,
    val hop: Int = 0,
    val ttl: Int = 8,
    val origin: String
)

@Serializable
data class Location(val lat: Double, val lng: Double)

sealed class RelayEvent {
    object PeerDiscovered : RelayEvent()
    object PeerConnected : RelayEvent()
    data class TelegramReceived(val telegram: Telegram) : RelayEvent()
    object PeerDisconnected : RelayEvent()
}

interface EventBus {
    val events: SharedFlow<RelayEvent>
    fun emit(event: RelayEvent)
}

sealed class EngineStatus {
    object Idle : EngineStatus()
    object Advertising : EngineStatus()
    object Syncing : EngineStatus()
    object Relay : EngineStatus()
    object Orphan : EngineStatus()
}
```

- **A implementa `NearbyEventBus`** (real, dispara desde los callbacks de Nearby: `onEndpointFound`, `onConnectionInitiated`, `onPayloadReceived`).
- **B implementa `FakeEventBus`** primero (para validar UI sin teléfono). Después consume el real.
- **Ambos firman este contrato en la Fase 0** — ningún campo se agrega sin acuerdo.

Detalles:

- `Telegram` está alineado con `protocol.md` sección 1. Los campos que no usamos en MVP (severity, family_contact, etc.) **no entran al data class todavía** — solo lo que se manda en la demo del MVP. Si los necesitamos, se agregan por mutuo acuerdo con un PR al contrato.
- `RelayEvent` es un `sealed class` para que el `when` en la UI de B sea exhaustivo sin `else`.
- `EventBus` es un `SharedFlow` (no `StateFlow`) porque son eventos, no estado. `emit` es fire-and-forget.
- `EngineStatus` también `sealed` para que la UI renderice bien los 5 estados (aunque MVP solo use `Idle` y `Advertising`).

---

## 5. Estructura de carpetas

```
app/src/main/java/com/ziro/relay/
├── contract/                  ← COMPARTIDO
│   ├── Telegram.kt            ← B escribe, A revisa
│   ├── RelayEvent.kt          ← A y B juntos
│   ├── EventBus.kt            ← A y B juntos
│   └── EngineStatus.kt        ← B escribe, A revisa
├── sender/                    ← SOLO A
│   ├── NearbyWrapper.kt
│   ├── TelegramSender.kt
│   ├── HmacSigner.kt
│   └── NearbyEventBus.kt      ← implementa EventBus
├── receiver/                  ← SOLO B
│   ├── TelegramReceiver.kt
│   ├── TelegramStore.kt
│   └── HmacVerifier.kt
├── service/                   ← SOLO A
│   └── RelayForegroundService.kt
├── ui/                        ← SOLO B
│   ├── MainActivity.kt
│   ├── screens/
│   └── theme/
└── ZiroApp.kt                 ← A: DI (provee RealEventBus); B: consume
```

### Reglas de ownership

- **`contract/`** — tocado solo con acuerdo de los dos. Si alguien necesita cambiar algo, lo dice antes de tocar el archivo.
- **`sender/`, `service/`** — A es dueño. B puede leer pero no editar. Si B ve un bug, abre un issue / se lo dice a A.
- **`receiver/`, `ui/`** — B es dueña. A puede leer pero no editar.
- **`ZiroApp.kt`** — A escribe la parte de DI (cómo se construye `NearbyWrapper` y `NearbyEventBus`). B agrega su `FakeEventBus` solo en `debug` builds o en `preview` Composables, no en producción.

---

## 6. Fases del desarrollo (con checkpoints de integración)

### Fase 0 — Contrato (1-2 h, los dos juntos)

| Persona A | Persona B |
|---|---|
| Escribir `EventBus.kt` y `RelayEvent.kt` | Escribir `Telegram.kt` y `EngineStatus.kt` |
| Revisar `Telegram.kt` y `EngineStatus.kt` | Revisar `EventBus.kt` y `RelayEvent.kt` |
| Acordar: serviceId, strategy, permisos | Acordar: navegación entre pantallas, theme |
| Primer commit: skeleton Gradle vacío + `contract/` | Validar que compila en su máquina local |

**Checkpoint:** el código del contrato compila en ambas máquinas. Ambos pueden importar `EventBus`, `RelayEvent`, `Telegram`, `EngineStatus` sin warnings.

---

### Fase 1 — Skeleton compilando (2-3 h, paralelo)

| Persona A | Persona B |
|---|---|
| Crear proyecto Android Studio + Gradle | MainActivity con 2 pantallas vacías (Home, Demo) |
| AndroidManifest con todos los permisos | `FakeEventBus` que emite eventos fake cada 5s |
| `ZiroApp.kt` con DI mínimo | UI Home: muestra `EngineStatus.Idle` hardcoded |
| Compilar APK debug, instalar en Phone A | Compilar y validar preview de Compose en su laptop |

**Checkpoint:** 2 APK instalados en 2 phones, ambos abren, ambos ven "IDLE" en pantalla. La UI de B está renderizando contra `FakeEventBus` sin tocar nada de A.

---

### Fase 2 — Radio real funcionando (3-4 h, paralelo)

| Persona A | Persona B |
|---|---|
| `NearbyWrapper` con `startAdvertising` + `startDiscovery` | `TelegramReceiver` con callback de `FakeEventBus` |
| `NearbyEventBus` que traduce callbacks de Nearby a `RelayEvent` | `TelegramStore` con dedup por `id` |
| `RelayForegroundService` que mantiene advertising en background | UI Home muestra estado real del `EventBus` |
| Probar: 2 phones se descubren, logcat limpio | UI Demo: lista de "telegramas recibidos" (vacía por ahora) |

**Checkpoint:** 2 phones se descubren vía Nearby en < 15 segundos. Alguien grita "se vieron" y ambos verifican. Logcat sin errores de permisos. UI de B pasa de "IDLE" a "ADVERTISING" cuando A empieza a anunciar.

---

### Fase 3 — Primer telegrama cruza (2-3 h, MVP)

| Persona A | Persona B |
|---|---|
| `TelegramSender` con `sendPayload(Payload.fromBytes(telegram.toJsonBytes()))` | UI Demo: botón "Enviar test" |
| `HmacSigner` con HMAC-SHA256 sobre canonical(telegram) | `HmacVerifier` que valida antes de aceptar |
| `sendTestTelegram()`: genera UUID, hardcodea, firma, manda | `TelegramReceiver` deserializa, valida HMAC, guarda en `TelegramStore` |
| Reenvío básico: cuando aparece peer nuevo, mandar lo que tengo | UI Demo muestra card con `id`, `user_id`, `hop` |

**Checkpoint:** A pulsa "Enviar test" en su teléfono, B ve aparecer el card en pantalla con los datos correctos. **`hop = 0` en el origen, `hop = 1` en el receptor.** **ESTE ES EL MVP.** Después de esto, podemos respirar.

---

### Fase 4 — Pulir MVP (2-3 h)

| Persona A | Persona B |
|---|---|
| Reenvío robusto: marcar `delivered_peers[id] = peerId` | UI muestra hop count en cada card |
| `TelegramStore` (sender side): no reenviar lo que ya entregué | Contador de pares descubiertos / conectados |
| Manejo de desconexión (`PeerDisconnected`) | Auto-scroll en la lista de recibidos |
| Logs limpios en logcat (quitar `println`, usar `Timber` o `Log`) | Estados vacíos: "No hay pares cerca", "No hay telegramas" |
| Test: A manda 3 telegramas, B recibe 3, A se acerca a C, C recibe 3 | Test: matar la app, reabrir, los telegramas siguen en pantalla (en memoria está bien por ahora) |

**Checkpoint:** demo robusta, dedup funciona (mandar el mismo id 2 veces → B lo ve una sola vez), hop count visible, sin crashes en 5 corridas consecutivas.

---

### Fase 5 (opcional, si sobra tiempo)

- SQLite (Room) persiste mensajes. Sobrevive a kill de la app.
- Gossip completo: al conectar, A y B sincronizan ledgers (diff de IDs primero, bytes después).
- Bidireccional: A → B → A roundtrip con `hop = 2` visible.
- 5 estados del nodo reales con transiciones (no solo `Idle` y `Advertising`).
- Beacon ORPHAN cada 60s cuando no hay pares.
- Auto-gateway: cuando hay Internet, flushear al backend.
- HMAC con clave real (no hardcoded).

**Total hasta MVP (Fases 0-3):** ~10-12 horas de las 36. Quedan 24 horas para Fase 4, Fase 5, polish, y el resto del proyecto (backend, dashboard, storage de evidencia).

---

## 7. Cómo correr la demo (instrucciones del día)

```bash
# 1. Compilar el APK en Android Studio (Build > Build Bundle(s) > APK)
#    O por línea de comandos:
./gradlew assembleDebug

# 2. Instalar en ambos phones (mismo APK en los dos)
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 3. En cada phone:
#    - Dar todos los permisos (BT, Wi-Fi, Location, Nearby)
#    - Abrir ZIRO
#    - Verificar que la pantalla Home diga "ADVERTISING"
#    - Si dice "IDLE", tocar el botón de "Activar modo emergencia"

# 4. Acerca los teléfonos a < 1 metro
# 5. Esperar ~5-10 segundos (handshake de Nearby)
# 6. Verificar: ambos phones dicen "1 par conectado"
# 7. En el phone A: pulsar "Enviar test"
# 8. En el phone B: el card aparece en pantalla con hop=1

# 9. Para probar reenvío (si hay Phone C disponible):
#    - Phone C también tiene el APK
#    - Alejar B, acercar C a A
#    - C debe recibir el mismo telegrama (hop=1 desde A)
#    - Si B se vuelve a acercar a A, NO debe recibir duplicado
```

### Setup de los teléfonos antes de la demo

| Paso | Comando / acción | Por qué |
|---|---|---|
| Cargar al 100% | Cable + cargador 1h antes | 36h hackathon, batería es un riesgo real |
| Apagar Wi-Fi | Settings > Wi-Fi > Off | Reduce interferencia con Nearby |
| Apagar Bluetooth | Settings > Bluetooth > Off (si no es Nearby) | Idem |
| Modo avión + datos | Settings > Airplane ON, Mobile data ON | Solo el gateway necesita Internet |
| Permisos pre-otorgados | Primera instalación, aceptar todo | La demo no puede esperar prompts |
| App abierta al inicio | Launcher > ZIRO | Sin lockscreen, sin código PIN |

---

## 8. Riesgos mitigados con este plan

| Riesgo | Mitigación que el plan ya aplica |
|---|---|
| B bloqueado esperando a que A termine `NearbyWrapper` | B usa `FakeEventBus` desde Fase 1. Puede validar UI sin teléfono, sin Nearby, sin A. |
| Cambios tardíos de A rompen la integración con B | A negocia contra el contrato, no contra el código de B. Si quiere cambiar un campo de `Telegram`, lo charlamos antes. |
| No se entienden qué pantallas necesita cada uno | B define UI contra el contrato (`RelayEvent.TelegramReceived`), no contra código nativo. La UI funciona con `FakeEventBus` desde el día 1. |
| Solo hay 1 teléfono disponible para testear | `FakeEventBus` permite a B testear la UI sin segundo teléfono. A puede validar `NearbyWrapper` con emulador + phone (parcialmente). |
| Nearby Connections no anda en emulador | Checkpoint de Fase 2 exige 2 phones reales. Si no hay 2 phones, A y B testean por separado y se juntan en Fase 3 con phones reales. |
| B no sabe Kotlin / Compose | Las 3 pantallas del MVP son ~150 líneas de Compose. Tutorial de 30 min en `developer.android.com/jetpack/compose` alcanza para arrancar. |
| Merge conflicts en `contract/` | `contract/` se congela después de Fase 0. Si alguien necesita cambiar, avisa antes. En la práctica, no se toca hasta Fase 5+. |
| A y B se pisan en `ZiroApp.kt` | A escribe la sección de DI (parte de sender/service). B solo agrega Composables que reciben `EventBus` por parámetro. No tocan la misma zona del archivo. |

---

## 9. Lo que NO entra en este MVP (ordenamiento explícito)

Esto **no se hace en este sprint**. Si alguien lo pide, se discute, pero no se codea en las primeras 36 horas.

- ❌ **Estados de persona (`EMERGENCY` / `NEED_HELP` / `SAFE`)** con verificación hash. En MVP todos los telegramas son `EMERGENCY` hardcoded.
- ❌ **Familiares y caso C5** (familiar responde SAFE desde otro dispositivo).
- ❌ **Grabación de video / chunks de evidencia** (eso es storage, otro sprint).
- ❌ **Beacon ORPHAN** cada 60s (Fase 5+).
- ❌ **Encriptación SQLCipher** (MVP usa SQLite plano; migración drop-in después).
- ❌ **Auto-wipe 72h** cuando el evento se cierra.
- ❌ **Conexión con backend** (esa es la parte online, otro sprint — ver `api.md`).
- ❌ **iOS** (fuera de scope para 36h).
- ❌ **CBOR / MessagePack** para serialización (JSON alcanza, es debug-friendly).
- ❌ **Dashboard familiar** (es frontend web, no parte del offline module).

Si sobra tiempo y hay entusiasmo, **Fase 5** tiene una lista priorizada. Pero el equipo tiene que tener el MVP (Fase 3) andando **antes** de empezar a mirar la lista de "nice to have".
