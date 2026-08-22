# protocol.md — El telegrama y la máquina de estados del nodo

## 1. El "telegrama": unidad mínima de información

El telegrama es un objeto JSON muy pequeño (~120-200 bytes) que viaja entre nodos. Es la **única unidad de información obligatoria** que cruza la red mesh.

### Schema del telegrama (v1)

```json
{
  "v": 1,
  "id": "a8f29c3f-7b9e-4a1d-8e2f-1c5b9d6e3f4a",
  "user_id": "USER123",
  "event_id": "EARTHQUAKE001",
  "event": "EARTHQUAKE",
  "status": "EMERGENCY",
  "severity": 3,
  "location": { "lat": 4.6097, "lng": -74.0817 },
  "timestamp": 1787440000,
  "hop": 0,
  "ttl": 8,
  "origin": "d4f8a2b1",
  "vital": {
    "name": "Juan Perez",
    "age": 35,
    "blood": "O+",
    "allergies": ["penicilina"],
    "conditions": ["diabetes"],
    "medications": ["warfarina"],
    "disability": "NONE",
    "pregnant": false
  },
  "verify": {
    "question_id": "PET_NAME_42",
    "answer_hash": "abcxyz..."
  },
  "hmac": "9f2a..."
}
```

Implementación de referencia: `app/src/main/java/com/ziro/relay/domain/Telegram.kt`. Ese archivo es la fuente de verdad; este documento explica el por qué.

### Campos raíz — obligatorios

Los 13 son obligatorios. Sin cualquiera de ellos el protocolo no funciona.

| Campo | Tipo | Descripción |
|---|---|---|
| `v` | int | Versión del protocolo. Sin esto un nodo v2 no puede rechazar un v1 incompatible. |
| `id` | UUID v4 | **La clave de deduplicación universal.** El corazón del protocolo. |
| `user_id` | string | Identificador anónimo de la persona. Agrupa varios telegramas de la misma persona (`EMERGENCY` → después `SAFE`). |
| `event_id` | string | Instancia del evento disparador. Agrupa a todos los afectados del mismo desastre. |
| `event` | enum | `EARTHQUAKE` \| `FIRE` \| `FLOOD` \| `MEDICAL` \| `OTHER`. El `event_id` es opaco, no se puede filtrar por él. |
| `status` | enum | `EMERGENCY` \| `NEED_HELP` \| `SAFE`. Estado de la **persona**. Ver sección 4. |
| `severity` | int 1-5 | **Sin esto el rescatista no puede priorizar**, que es un objetivo declarado del producto. Default 3 en MVP. |
| `location` | { lat, lng } | Sin ubicación el telegrama no sirve ni a la familia ni al rescatista. |
| `timestamp` | int epoch s | Generado en el **origen**. No es cuándo llegó a este nodo — eso vive en el ledger. |
| `hop` | int | Saltos ya realizados. Inicia en 0. |
| `ttl` | int | Saltos restantes. Inicia en 8. |
| `origin` | string hash | Hash corto del dispositivo origen. **Nunca el identificador real.** |
| `hmac` | string \| null | HMAC-SHA256 sobre el canonical. **El campo existe desde v1 aunque vaya `null` en MVP** — agregarlo después obliga a un `v=2`. |

### Bloque `vital` (nulleable) — lo que el rescatista necesita OFFLINE

El criterio de admisión de este bloque es una sola pregunta: **¿lo necesita un rescatista sin Internet para decidir cómo actuar en los próximos 10 minutos?**

| Campo | Tipo | Por qué viaja |
|---|---|---|
| `name` | string \| null | Identificación humana |
| `age` | int \| null | Derivado de `birth_date` en el perfil local |
| `blood` | string \| null | Grupo + Rh juntos (`"O+"`, `"AB-"`). Transfusión. |
| `allergies` | string[] | **Penicilina, látex. Mata si no se sabe.** |
| `conditions` | string[] | Diabetes, epilepsia, cardíaco, asma |
| `medications` | string[] | **Anticoagulantes cambian todo en trauma** |
| `disability` | enum | `NONE`\|`MOBILITY`\|`VISUAL`\|`HEARING`\|`COGNITIVE`. Define **cómo** se rescata: ¿camina o hay que cargarlo? |
| `pregnant` | bool | Cambia la prioridad de triage drásticamente |

### Bloque `verify` (nulleable)

| Campo | Tipo | Descripción |
|---|---|---|
| `question_id` | string | ID de la pregunta. **La pregunta en sí no viaja** — solo el id. |
| `answer_hash` | string | SHA-256 hex de la respuesta esperada. **La respuesta en claro nunca viaja ni se guarda.** |

### Lo que NO viaja, y por qué

| Dato | Por qué se queda en el teléfono |
|---|---|
| `doc_type`, `doc_number` | El backend ya los tiene del onboarding, indexados por `user_id`. Un rescatista no necesita la cédula para salvarte, pero `nombre + cédula + sangre + GPS` en el teléfono de un desconocido, en SQLite **sin cifrar** (que es el MVP), es un kit de robo de identidad viajando por 8 saltos. |
| `eps` | Idem. Es para admisión hospitalaria, no para triage en la calle. |
| `family_contact` | **Cambio respecto de la versión anterior de este doc.** El backend notifica a la familia y ya tiene el teléfono del onboarding. No hay razón para que el número de un familiar pase por el celular de 8 extraños. |
| `device_secret` | Es la clave del HMAC. |
| video, audio, fotos | Se quedan en disco, suben por HTTP cuando hay Internet. Ver `storage.md`. |
| Cualquier metadata local | `receivedFrom`, `sent`, `arrivedAt`. Ver `ledger.md`. |

**Trade-off honesto:** si alguien nunca completó el onboarding con Internet, el backend no tiene su perfil y la notificación a la familia falla. Aceptable para MVP.

**No hay campo de texto libre. ZIRO no es un chat** — el telegrama es data estructurada.

### Tamaño real (corrección)

Este telegrama pesa **~550-700 bytes**, no 120. Y no es un problema: Nearby Connections no manda payloads por advertisements BLE (que son 31 bytes) — usa BLE para *discovery* y después Bluetooth Classic o Wi-Fi Direct para el canal de datos, donde el límite de `Payload.fromBytes` está en el orden de los **KB**.

Lo que cambia es la aritmética del ledger: el cap de 5 MB pasa de ~25.000 telegramas a ~7.000. Sigue siendo de sobra.

**El límite real no es el ancho de banda. Es la privacidad**, y por eso manda la tabla de "lo que NO viaja".

### Versión serializada (compacta)

Para minimizar bytes en el aire, en producción se puede usar **CBOR** o **MessagePack** en lugar de JSON. Para la demo del hackathon, **JSON string** alcanza porque:

- 200 bytes × N telegrams = trivial comparado con el tiempo de handshake P2P.
- Debug más fácil (se puede loguear y leer).

Si en 36h sobra tiempo, se puede meter CBOR. Pero NO es core.

### Por qué cada campo

- **`v=1`** — permite que un nodo v2 rechace/acepte nodos v1 sin ambigüedad.
- **`id` UUID** — es la única verdad universal. Un nodo recibe un telegrama y pregunta "¿ya tengo este id?" → decide si lo guarda o lo descarta. Sin esto, el ledger se inunda de duplicados.
- **`user_id`** — separa la identidad de la persona del id del mensaje. Varios telegramas del mismo afectado (ej: `EMERGENCY` inicial + `NEED_HELP` después) comparten `user_id` pero tienen `id` distinto. El backend los agrupa por acá.
- **`event_id`** — varios afectados en el mismo terremoto comparten `event_id`. Permite al backend mostrar "este desastre tiene N personas reportadas".
- **`status`** — el estado de la **persona**, no del nodo. Es ortogonal a los 5 estados del nodo (`IDLE/ADVERTISING/SYNC/RELAY/ORPHAN`). Ver sección 4 abajo.
- **`question_id` + `answer_hash`** — mecanismo de verificación de identidad para transicionar a `SAFE`. La pregunta (ej: "¿nombre de tu primera mascota?") está asociada al perfil pre-cargado del usuario. El `answer_hash` es el SHA-256 de la respuesta correcta. **La respuesta en claro nunca sale del teléfono.** Cuando alguien quiere confirmar que está a salvo, tipea la respuesta en la app; el backend compara el hash y, si coincide, marca `SAFE`. Si el usuario no tiene su teléfono a mano, **otro dispositivo ZIRO autorizado** (ej: el de un familiar) puede tipear la respuesta en su nombre y mandar un nuevo telegrama con `status: "SAFE"` desde su propio `origin` (mismo `user_id`). Ver `orphan-device.md`.
- **`hop` vs `ttl`** — son ortogonales. `hop` te dice **cuántos saltos hizo** (información útil para el backend: "este mensaje pasó por 4 dispositivos antes de llegar al gateway"). `ttl` te dice **cuántos saltos le quedan** antes de morir.
- **`origin`** — para que el gateway pueda reconstruir el path A → B → C → D → Gateway en el dashboard.

## 2. Reglas del protocolo

### Regla 1 — Deduplicación por `id`
Cada nodo mantiene un set de IDs vistos. Si llega un telegrama con un id ya visto, **se descarta silenciosamente** sin importar el contenido.

### Regla 2 — Punto único de mutación: el receptor, al ingestar

**El nodo que RECIBE aplica `hop+1` y `ttl-1` exactamente una vez, al ingestar. El reenvío es verbatim.**

```kotlin
// domain/RelayPolicy.kt
fun onIngest(t: Telegram): Telegram? {
    if (t.ttl <= 0) return null              // ya está muerto, no debió llegar
    return t.copy(hop = t.hop + 1, ttl = t.ttl - 1)
}

fun shouldForward(t: Telegram): Boolean = t.ttl > 0
```

Esto corrige la versión anterior de esta regla, que mutaba al reenviar. Dos razones:

1. **Si se muta al ingestar Y al reenviar, `hop` cuenta doble.** Acá no puede.
2. **Reenviar los bytes verbatim mantiene el HMAC válido de punta a punta.** Re-serializar en cada salto es como mueren las firmas.

**Consecuencia esperada en el checkpoint del MVP:** el emisor manda `hop = 0`, el receptor guarda y muestra `hop = 1`. Eso es el resultado correcto, no un off-by-one.

Un telegrama con `ttl = 0` se **guarda** (llegó al final de su camino, sigue siendo parte del ledger local) pero no se reenvía.

### Regla 3 — Inmutabilidad
Un telegrama **nunca se modifica semánticamente** en tránsito. Solo cambian `hop` y `ttl`. Los demás campos son del origen.

### Regla 4 — Backpressure por hop_count
Un nodo no reenvía un telegrama que ya fue retransmitido a un peer específico. Tabla local `delivered_to[peer_id] = true`. Si B se re-encuentra con A y A le manda el mismo id, B lo ignora aunque siga en su ledger.

### Regla 5 — HMAC: el canonical excluye `hop`, `ttl` y `hmac`

El origen firma con HMAC-SHA256. **Cada nodo receptor verifica antes de deduplicar** — nunca al revés, o un telegrama falsificado podría ocupar un `id` y dejar afuera al real.

```kotlin
// domain/Canonical.kt — el orden de campos está fijado a mano, a propósito
telegram.hmac = HMAC(SHARED_KEY, Canonical.of(telegram))
```

Tres exclusiones, y cada una es estructural:

| Excluido | Por qué |
|---|---|
| `hop` | Cambia en cada nodo (Regla 2). Si entra al canonical, la firma **solo valida en hop 0** y falla en todos los relays. |
| `ttl` | Idem. |
| `hmac` | Es la salida de la función, no puede ser parte de su propia entrada. |

**No delegar el canonical a un encoder JSON.** Un cambio de orden de campos, de espacios o de formato de número rompe la verificación del otro lado de la radio — y el fallo se ve como un bug de transporte, no de serialización. `Canonical.kt` fija el orden a mano y las listas se ordenan alfabéticamente.

**La clave es UNA constante app-wide, no un secret por dispositivo.** HMAC es simétrico: un verificador que no tiene la clave de firma rechaza el 100% de los telegramas. Un secret por dispositivo requiere un intercambio de claves real, que es Fase 5.

Guardado en `Canonical.of` con doble decimal fijo en las coordenadas (6 decimales) para que el formato de `Double` no derive entre dispositivos.

**Invariante verificada por test:** `TelegramContractTest.signature survives every hop` recorre 7 saltos y verifica la firma en cada uno. Corre en la JVM en milisegundos.

## 3. Máquina de estados del nodo

Cada nodo ZIRO tiene 5 estados. Las transiciones son **manejadas por eventos** (no por polling).

```
            ┌──────────────┐
            │     IDLE     │  (no hay emergencias, sin pares visibles)
            └──────┬───────┘
                   │ trigger externo (EMS, app manual, etc.)
                   ▼
            ┌──────────────┐
            │  ADVERTISING │  (escucho y me anuncio en el serviceId)
            └──────┬───────┘
                   │ encuentro con par
                   ▼
            ┌──────────────┐
            │   SYNC       │  (sincronizo ledgers: paso IDs nuevos,
            └──────┬───────┘   recibo IDs nuevos del peer, después bytes)
                   │ par se fue
                   ▼
            ┌──────────────┐
            │   RELAY      │  (guardo telegrama, espero nuevo par,
            └──────┬───────┘   reenvío cuando aparece)
                   │ sin pares > 2 min
                   ▼
            ┌──────────────┐
            │   ORPHAN     │  (transmito beacon BLE cada 60s,
            └──────────────┘   "tengo datos, esperándome")
```

### Transiciones detalladas

#### IDLE → ADVERTISING
**Trigger:** trigger externo (EMSC, botón manual, schedule pre-configurado, etc.).
**Acción:**
- `Nearby.Connections.startAdvertising(serviceId="ziro.relay.v1", strategy=P2P_STAR)`
- `Nearby.Connections.startDiscovery(serviceId="ziro.relay.v1")`
- Advertise en BLE con metadata mínima `{app:"ziro", v:1, has_emergency: true}`.

#### ADVERTISING → SYNC
**Trigger:** se descubre un par (callback de Nearby Connections).
**Acción:**
1. Pedir conexión.
2. Handshake: intercambio de `{protocol_version, node_id, capabilities, ledger_summary}`.
3. Comparar ledgers: A le dice a B "yo tengo estos N ids, los más viejos son del timestamp X". B compara con su propio ledger.
4. A le pide a B los IDs que A no tiene; B le pide a A los IDs que B no tiene.
5. Intercambio de bytes solo de los telegramas nuevos.
6. Cada parte actualiza su tabla `delivered_to[peer_id]` con los IDs que acaba de entregar.

#### SYNC → RELAY
**Trigger:** el par se desconectó (sale del rango, timeout, fin de sync).
**Acción:**
- Mantener advertising + discovery activos.
- Los telegramas recién recibidos pasan al ledger local.
- Esperar el próximo par.

#### RELAY → ORPHAN
**Trigger:** pasaron 2 minutos sin descubrir ningún par.
**Acción:**
- Bajar frecuencia de advertising (ahorrar batería).
- Mantener BLE advertising con metadata extendida `{app:"ziro", v:1, has_emergency: true, ledger_size: N, last_seen_peer: ts}`.
- Cada 60s, broadcast de beacon.
- Si entra un par, transición a SYNC.

#### Cualquier estado → IDLE
**Trigger:** trigger externo "cancelar emergencia" o batería < 5%.
**Acción:** detener advertising/discovery, liberar recursos.

### Nota: estados del nodo ≠ estados de la persona

Los 5 estados de arriba describen el **comportamiento del nodo** (qué está haciendo en la red mesh). Son ortogonales a los **estados de la persona afectada**, que se modelan aparte en la sección siguiente.

## 4. Estados de la persona (3, ortogonales a los del nodo)

La persona afectada tiene exactamente 3 estados posibles, independientes de los 5 estados del nodo:

| Estado | Significado | Prioridad en el backend |
|---|---|---|
| `EMERGENCY` | Estado por defecto cuando se dispara el evento. "No hay confirmación de seguridad." | Media |
| `NEED_HELP` | La persona (o un autorizado) marcó explícitamente que necesita ayuda. | **Alta** (la más urgente) |
| `SAFE` | La persona (o un autorizado) confirmó seguridad tipeando la respuesta correcta a `question_id`. | Baja (resuelve) |

### Transiciones permitidas

```
EMERGENCY  ──safe answer──▶  SAFE
EMERGENCY  ──user marks──▶   NEED_HELP
NEED_HELP  ──safe answer──▶  SAFE
```

**No se permite** `SAFE → EMERGENCY`, ni `NEED_HELP → EMERGENCY`. Un `SAFE` es terminal hasta que llegue un nuevo `event_id`.

### Quién puede emitir cada transición

- **Origen** (el propio teléfono del afectado): puede pasar de `EMERGENCY` a `NEED_HELP` o a `SAFE` (con respuesta correcta).
- **Dispositivo ZIRO autorizado** (familiar con ZIRO instalado y vinculado al `user_id`): puede pasar a `SAFE` en nombre del afectado. Esto cubre el caso "el teléfono quedó tirado". Ver `orphan-device.md`.
- **Backend**: nunca emite transiciones por sí solo — solo refleja lo que recibe y notifica a la familia.

### Modelo en el backend

El **Emergency Orchestrator** (ver `api.md`) agrupa los telegramas por `user_id` y mantiene el estado actual. Prioridad de procesamiento:

```
NEED_HELP  >  EMERGENCY  >  SAFE
```

Un `NEED_HELP` siempre se entrega antes que un `EMERGENCY` aunque haya llegado después en el tiempo.

## 5. Concurrencia y locks

### Lock del pipeline de ingest (no "lock por id")

**Corrección respecto de la versión anterior de este doc.** Decía `mutex.withLock(t.id)` y lo llamaba "lock por id". Eso **compila**, pero no hace lo que parece: el parámetro de `kotlinx.coroutines.sync.Mutex.withLock` es un *owner* para tracking de propiedad, **no una clave de lock**. No hay locking por id — es un lock global.

Funcionalmente sirve (serializa todo el ingest, que es lo que hace falta) y a volúmenes de telegramas no cuesta nada. Pero se documenta como lo que es:

```kotlin
// application/IngestTelegram.kt
private val mutex = Mutex()   // un mutex global del pipeline de ingest

suspend fun handle(raw: ByteArray, from: PeerId): IngestResult {
    // parse → versión → validez de campos → firma  (fuera del lock, son puros)
    return mutex.withLock {
        if (ledger.has(incoming.id)) return@withLock reject(DUPLICATE, from)
        val stored = RelayPolicy.onIngest(incoming) ?: return@withLock reject(EXPIRED, from)
        ledger.put(stored, from)
        ledger.markDelivered(stored.id, from)
        bus.emit(RelayEvent.TelegramReceived(stored, from))
        IngestResult.Accepted(stored)
    }
}
```

**El orden de los chequeos es parte del contrato**, no un detalle de implementación: parse → versión → validez → **firma** → dedup → mutar → guardar → anunciar. Si alguien necesita locking real por clave, es un `Map<String, Mutex>`, no el parámetro `owner`.

### Cola de envío por par
Cada peer conectado tiene una cola FIFO. No se bloquea el procesamiento del siguiente par.

## 6. Lo que NO hace el protocolo

- ❌ No hace enrutamiento (no es AODV, no es OSPF, no es B.A.T.M.A.N.).
- ❌ No hace store-and-forward persistente multi-día (eso lo cubre el ledger).
- ❌ No garantiza orden de entrega (los telegramas pueden llegar en cualquier orden al gateway).
- ❌ No garantiza entrega (es best-effort, como toda red P2P sin infraestructura).
