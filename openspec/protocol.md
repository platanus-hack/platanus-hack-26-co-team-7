# protocol.md — El telegrama y la máquina de estados del nodo

## 1. El "telegrama": unidad mínima de información

El telegrama es un objeto JSON muy pequeño (~120-200 bytes) que viaja entre nodos. Es la **única unidad de información obligatoria** que cruza la red mesh.

### Schema del telegrama (v1)

```json
{
  "v": 1,
  "id": "a8f29c3f-7b9e-4a1d-8e2f-1c5b9d6e3f4a",
  "event": "EARTHQUAKE",
  "lat": 4.6097,
  "lng": -74.0817,
  "ts": 1787440000,
  "severity": 3,
  "hop": 0,
  "ttl": 8,
  "origin": "device_short_hash",
  "person_name": null,
  "person_age": null,
  "medical_note": null,
  "family_contact": null
}
```

### Campos

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `v` | int | sí | Versión del protocolo. Permite migración futura. |
| `id` | UUID v4 (string) | sí | Identificador único universal. **Es la clave de deduplicación.** |
| `event` | enum string | sí | `EARTHQUAKE`, `FIRE`, `FLOOD`, `MEDICAL`, `OTHER`. |
| `lat`, `lng` | float | sí | Coordenadas decimales (4 decimales = ~11m de precisión). |
| `ts` | int (epoch seconds) | sí | Timestamp de cuándo ocurrió la emergencia en el origen. |
| `severity` | int (1-5) | sí | 1=leve, 5=catastrófico. Lo setea el origen o el trigger externo. |
| `hop` | int | sí | Contador de saltos. Inicia en 0, se incrementa en cada relay. |
| `ttl` | int | sí | Time-to-live en saltos. Inicia en 8, decrementa en cada relay. Si llega a 0, se descarta. |
| `origin` | string hash | sí | Hash corto del dispositivo origen (no expone identidad real). |
| `person_name` | string \| null | no | Nombre que el usuario tipeó al activar EMERGENCY MODE. |
| `person_age` | int \| null | no | Edad. |
| `medical_note` | string \| null | no | Nota médica breve ("diabético", "alergia a penicilina"). |
| `family_contact` | string \| null | no | Teléfono o email del familiar a notificar. |

### Versión serializada (compacta)

Para minimizar bytes en el aire, en producción se puede usar **CBOR** o **MessagePack** en lugar de JSON. Para la demo del hackathon, **JSON string** alcanza porque:

- 200 bytes × N telegrams = trivial comparado con el tiempo de handshake P2P.
- Debug más fácil (se puede loguear y leer).

Si en 36h sobra tiempo, se puede meter CBOR. Pero NO es core.

### Por qué cada campo

- **`v=1`** — permite que un nodo v2 rechace/acepte nodos v1 sin ambigüedad.
- **`id` UUID** — es la única verdad universal. Un nodo recibe un telegrama y pregunta "¿ya tengo este id?" → decide si lo guarda o lo descarta. Sin esto, el ledger se inunda de duplicados.
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

## 4. Concurrencia y locks

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

## 5. Lo que NO hace el protocolo

- ❌ No hace enrutamiento (no es AODV, no es OSPF, no es B.A.T.M.A.N.).
- ❌ No hace store-and-forward persistente multi-día (eso lo cubre el ledger).
- ❌ No garantiza orden de entrega (los telegramas pueden llegar en cualquier orden al gateway).
- ❌ No garantiza entrega (es best-effort, como toda red P2P sin infraestructura).
