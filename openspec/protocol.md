# protocol.md — El telegrama y la máquina de estados del nodo

## 1. El "telegrama": unidad mínima de información

El telegrama es un objeto JSON muy pequeño (~120-200 bytes) que viaja entre nodos. Es la **única unidad de información obligatoria** que cruza la red mesh.

### Schema del telegrama (v2)

> **v2 (2026-08-22):** se reestructura con bloques anidados `vital` y `verify`, y **`family_contact` sale del telegrama** — el backend ya tiene los teléfonos del perfil cargado en onboarding y resuelve por `user_id`. Ver `DECISIONS.md`.

```json
{
  "v": 2,
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

### Campos raíz

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `v` | int | sí | Versión del protocolo (`2`). Permite migración futura. |
| `id` | UUID v4 (string) | sí | Identificador único del mensaje. **Es la clave de deduplicación universal.** |
| `user_id` | string | sí | Identificador anónimo estable de la persona afectada. |
| `event_id` | string | sí | Identificador de la instancia del evento disparador (ej: `EARTHQUAKE001`). Agrupa todos los telegramas de un mismo desastre. |
| `event` | enum string | sí | Tipo de evento: `EARTHQUAKE`, `FIRE`, `FLOOD`, `MEDICAL`, `OTHER`. |
| `status` | enum string | sí | Estado de la persona: `EMERGENCY`, `NEED_HELP`, `SAFE`. Ver sección 4. |
| `severity` | int (1-5) | sí | 1=leve, 5=catastrófico. Lo setea el origen o el trigger externo. |
| `location` | { `lat`, `lng` } | sí | Coordenadas decimales (4 decimales ≈ 11 m). |
| `timestamp` | int (epoch seconds) | sí | Momento en que se generó el telegrama en el origen. |
| `hop` | int | sí | Saltos ya realizados. Inicia en 0. |
| `ttl` | int | sí | Time-to-live en saltos. Inicia en 8; al llegar a 0 se descarta. |
| `origin` | string hash | sí | Hash corto del dispositivo origen (no expone identidad real). |
| `vital` | objeto \| null | condicional | Snapshot médico para triage offline (ver abajo). Null si no hay perfil cargado. |
| `verify` | objeto \| null | condicional | `{ question_id, answer_hash }` para transición a SAFE. Null si no aplica. |
| `hmac` | string | recomendado | HMAC-SHA256 del telegrama (Regla 5). |

### Bloque `vital` — qué VIAJA y por qué

El criterio NO es "qué es importante", sino: **¿qué necesita un rescatista SIN Internet en los próximos 10 minutos?**

VIAJA en claro porque cambia cómo actúa el rescatista en el lugar:

| Campo | Para qué |
|---|---|
| `name` | Identificación humana en el punto de rescate |
| `age` | Triage y dosificación |
| `blood` | Transfusión (ABO+Rh) |
| `allergies` | Penicilina, látex — mata si no se sabe |
| `conditions` | Diabetes, epilepsia, cardíaco, asma |
| `medications` | Anticoagulantes cambian todo en trauma |
| `disability` | Define CÓMO se rescata: ¿camina o hay que cargarlo? |
| `pregnant` | Cambia la prioridad de triage drásticamente |

**NO viaja** (el backend lo tiene del onboarding, resuelto por `user_id`): `doc_type`, `doc_number`, `eps`, teléfonos de contactos de emergencia, `device_secret`. Un rescatista no necesita la cédula para salvarte — pero nombre + cédula + sangre + ubicación GPS en el SQLite sin cifrar de un desconocido, saltando por 8 teléfonos ajenos, es un kit de robo de identidad en tránsito.

`family_contact` fue eliminado del telegrama en v2: la notificación a la familia es responsabilidad del backend usando los contactos del perfil registrado en onboarding.

**Trade-off aceptado:** si alguien nunca completó el onboarding con Internet, el backend no tiene su perfil y la notificación a la familia falla. Documentado como limitación del MVP.

### Tamaño real (corrección honesta)

El "~120 bytes, cabe en una sola trama BLE" de versiones anteriores era doctrina, no física:

- Un advertisement BLE legacy son **31 bytes** — ni siquiera un telegrama de 200 bytes cabía ahí.
- Nearby Connections **no manda payloads por advertisements**: usa BLE para *discovery* y después Bluetooth Classic o Wi-Fi para el canal de datos (`Payload.fromBytes`), donde el límite está en el orden de los KB.

Con el bloque `vital`, el telegrama pesa **~550–700 bytes** y no hay ningún problema técnico. La aritmética del ledger sí cambia: el cap de 5 MB pasa de ~25.000 a ~7.000 telegramas. Sigue siendo de sobra. **El límite real no es el ancho de banda; es la privacidad** — y por eso manda el criterio del bloque `vital`, no el conteo de bytes.

Para minimizar bytes en el aire se podría usar **CBOR** o MessagePack en lugar de JSON, pero NO es core: JSON string alcanza y facilita el debug (se puede loguear y leer).

### Por qué cada campo

- **`v=2`** — permite que un nodo v2 rechace/acepte nodos v1 sin ambigüedad.
- **`id` UUID** — es la única verdad universal. Un nodo recibe un telegrama y pregunta "¿ya tengo este id?" → decide si lo guarda o lo descarta. Sin esto, el ledger se inunda de duplicados.
- **`user_id`** — separa la identidad de la persona del id del mensaje. Varios telegramas del mismo afectado (ej: `EMERGENCY` inicial + `NEED_HELP` después) comparten `user_id` pero tienen `id` distinto. El backend los agrupa por acá.
- **`event_id`** — varios afectados en el mismo terremoto comparten `event_id`. Permite al backend mostrar "este desastre tiene N personas reportadas".
- **`status`** — el estado de la **persona**, no del nodo. Es ortogonal a los 5 estados del nodo (`IDLE/ADVERTISING/SYNC/RELAY/ORPHAN`). Ver sección 4 abajo.
- **`question_id` + `answer_hash`** (bloque `verify`) — mecanismo de verificación de identidad para transicionar a `SAFE`. La pregunta (ej: "¿nombre de tu primera mascota?") está asociada al perfil pre-cargado del usuario. El `answer_hash` es el SHA-256 de la respuesta correcta. **La respuesta en claro nunca sale del teléfono.** Cuando alguien quiere confirmar que está a salvo, tipea la respuesta en la app; el backend compara el hash y, si coincide, marca `SAFE`. Si el usuario no tiene su teléfono a mano, **otro dispositivo Replica autorizado** (ej: el de un familiar) puede tipear la respuesta en su nombre y mandar un nuevo telegrama con `status: "SAFE"` desde su propio `origin` (mismo `user_id`). Ver `orphan-device.md`.
- **`hop` vs `ttl`** — son ortogonales. `hop` te dice **cuántos saltos hizo** (información útil para el backend: "este mensaje pasó por 4 dispositivos antes de llegar al gateway"). `ttl` te dice **cuántos saltos le quedan** antes de morir.
- **`origin`** — para que el gateway pueda reconstruir el path A → B → C → D → Gateway en el dashboard.

## 2. Reglas del protocolo

### Regla 1 — Deduplicación por `id`
Cada nodo mantiene un set de IDs vistos. Si llega un telegrama con un id ya visto, **se descarta silenciosamente** sin importar el contenido.

### Regla 2 — TTL decrementa, hop incrementa
En cada relay:
```kotlin
if (telegram.hop >= telegram.ttl) {
    discard(telegram)  // llegó al final del camino
} else {
    telegram.hop += 1
    telegram.ttl -= 1
    forward(telegram)
}
```

### Regla 3 — Inmutabilidad
Un telegrama **nunca se modifica semánticamente** en tránsito. Solo cambian `hop` y `ttl`. Los demás campos son del origen.

### Regla 4 — Backpressure por hop_count
Un nodo no reenvía un telegrama que ya fue retransmitido a un peer específico. Tabla local `delivered_to[peer_id] = true`. Si B se re-encuentra con A y A le manda el mismo id, B lo ignora aunque siga en su ledger.

### Regla 5 — HMAC opcional (recomendado)
Para evitar spoofing, el origen firma el telegrama con un HMAC-SHA256 usando un secret derivado de su `origin`:
```kotlin
telegram.hmac = HMAC(device_secret, canonical(telegram))
```

El gateway verifica el HMAC antes de aceptar. Si el HMAC no valida → descarta (posible atacante). Esto blinda el riesgo del paper de USENIX 2022 sobre Bridgefy.

## 3. Máquina de estados del nodo

Cada nodo Replica tiene 5 estados. Las transiciones son **manejadas por eventos** (no por polling).

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
- `Nearby.Connections.startAdvertising(serviceId="replica.relay.v1", strategy=P2P_STAR)`
- `Nearby.Connections.startDiscovery(serviceId="replica.relay.v1")`
- Advertise en BLE con metadata mínima `{app:"replica", v:1, has_emergency: true}`.

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
- Mantener BLE advertising con metadata extendida `{app:"replica", v:1, has_emergency: true, ledger_size: N, last_seen_peer: ts}`.
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
- **Dispositivo Replica autorizado** (familiar con Replica instalado y vinculado al `user_id`): puede pasar a `SAFE` en nombre del afectado. Esto cubre el caso "el teléfono quedó tirado". Ver `orphan-device.md`.
- **Backend**: nunca emite transiciones por sí solo — solo refleja lo que recibe y notifica a la familia.

### Modelo en el backend

El **Emergency Orchestrator** (ver `api.md`) agrupa los telegramas por `user_id` y mantiene el estado actual. Prioridad de procesamiento:

```
NEED_HELP  >  EMERGENCY  >  SAFE
```

Un `NEED_HELP` siempre se entrega antes que un `EMERGENCY` aunque haya llegado después en el tiempo.

## 5. Concurrencia y locks

### Lock por `id`
Cuando un nodo recibe un telegrama, antes de procesarlo toma un lock sobre `id` para evitar que dos peers simultáneos disparen doble procesamiento:

```kotlin
suspend fun onTelegramReceived(t: Telegram) {
    mutex.withLock(t.id) {
        if (ledger.has(t.id)) return
        ledger.put(t.id, t)
        // schedule broadcast to peers
    }
}
```

### Cola de envío por par
Cada peer conectado tiene una cola FIFO. No se bloquea el procesamiento del siguiente par.

## 6. Lo que NO hace el protocolo

- ❌ No hace enrutamiento (no es AODV, no es OSPF, no es B.A.T.M.A.N.).
- ❌ No hace store-and-forward persistente multi-día (eso lo cubre el ledger).
- ❌ No garantiza orden de entrega (los telegramas pueden llegar en cualquier orden al gateway).
- ❌ No garantiza entrega (es best-effort, como toda red P2P sin infraestructura).
