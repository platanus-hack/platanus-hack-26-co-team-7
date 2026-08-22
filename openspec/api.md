# api.md — Endpoints backend mínimos

> ⚠️ **Desactualizado en parte:** el schema del telegrama y el modelo SQL de abajo son de la v1 del protocolo. El telegrama vigente es **v2** (bloques `vital`/`verify`, sin `family_contact`) — ver `protocol.md` sección 1 y la sección "Protocolo v2" en `DECISIONS.md`. La semántica de endpoints y del Emergency Orchestrator sigue válida; el stack definitivo es FastAPI + PostgreSQL (`architecture.md`).

## Stack

- **Node.js + Express** o **Python + FastAPI** — cualquiera sirve para 36h, lo que el equipo domine.
- Desplegado en **Render** (free tier alcanza para la demo).
- **WebSocket** (`ws` en Node, `websockets` en Python) para push al dashboard familiar en tiempo real.
- **Storage:** **SQLite** para la demo (suficiente, archivo plano, fácil de versionar). **PostgreSQL** queda como migración natural si crece — la columna `payload_json` cambia a `JSONB` y los índices se ajustan.
- Componente propio: **Emergency Orchestrator** (ver sección dedicada abajo).

## Emergency Orchestrator

Componente central del backend. **No es un endpoint más — es el cerebro que decide qué pasa con cada telegrama que llega.**

Responsabilidades:

1. **Deduplicación por `id`** — rechazos idempotentes (replay-safe).
2. **Agrupación por `user_id`** — varios telegramas del mismo afectado se consolidan en un único "caso".
3. **Transiciones de estado de la persona** — aplica las reglas de la sección 4 de `protocol.md`:
   - `EMERGENCY → SAFE` (con `answer_hash` válido)
   - `EMERGENCY → NEED_HELP` (cualquier telegrama con status `NEED_HELP`)
   - `NEED_HELP → SAFE` (con `answer_hash` válido)
4. **Priorización de notificaciones** — al armar la cola para el dashboard y SMS, el orden es **NEED_HELP > EMERGENCY > SAFE**. Un `NEED_HELP` siempre se notifica antes aunque haya llegado después.
5. **Validación de `answer_hash`** — único punto que compara el hash de una respuesta contra el que el usuario registró al configurar su perfil. Si coincide → transición a `SAFE`.
6. **Cierre de eventos** — declara `event_id` cerrado cuando todas las personas pasaron a `SAFE` o cuando pasaron N horas desde el último telegrama nuevo. Avisa a los nodos para que programen el wipe a 72h.

Implementación sugerida:

```python
class EmergencyOrchestrator:
    def ingest(self, telegram: dict) -> IngestResult:
        if self.known_ids.has(telegram["id"]):
            return IngestResult.DUPLICATE
        
        case = self.cases.get(telegram["user_id"])
        new_status = telegram["status"]
        
        # SAFE requiere answer_hash válido
        if new_status == "SAFE":
            if not self.verify_answer_hash(telegram):
                return IngestResult.INVALID_VERIFICATION
            case.close(telegram)
        
        # NEED_HELP pisa EMERGENCY (mayor prioridad)
        if new_status == "NEED_HELP":
            case.escalate(telegram)
        
        # nuevo EMERGENCY solo si no hay caso
        if new_status == "EMERGENCY" and case is None:
            case = self.cases.create(telegram)
        
        self.priority_queue.push(case, priority=self.priority_of(new_status))
        self.known_ids.add(telegram["id"])
        return IngestResult.OK
```

## Auto-gateway en el nodo (no en el backend)

**El backend no hace polling.** Son los nodos los que, al detectar Internet, **flushean automáticamente** su ledger pendiente (ver Regla L6 en `ledger.md`). Esto significa:

- No hay `POST /api/poll` ni nada similar — el backend solo recibe.
- El backend responde `200` cuando acepta, `409` cuando es duplicado.
- En caso de éxito, el nodo marca `sent = true` localmente y no reenvía más.

Esta separación es importante: si el backend fuera el que pregunta "hay algo nuevo?", tendría que mantener estado por nodo y manejar timeouts. Con el modelo actual, el backend es **stateless respecto del flush**: solo procesa lo que llega.

## Modelo de datos

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,                    -- UUID v4
  user_id TEXT NOT NULL,                  -- identificador anónimo del afectado
  event_id TEXT NOT NULL,                -- identificador del evento
  payload_json TEXT NOT NULL,            -- telegrama completo serializado
  status TEXT NOT NULL,                   -- EMERGENCY | NEED_HELP | SAFE
  event TEXT NOT NULL,                    -- tipo (EARTHQUAKE, FIRE, etc.)
  lat REAL,
  lng REAL,
  ts INTEGER NOT NULL,
  severity INTEGER NOT NULL,
  hop INTEGER NOT NULL,
  origin TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  closed_at INTEGER,                      -- cuándo se cerró el caso
  video_uploaded_at INTEGER,
  video_url TEXT
);

CREATE TABLE message_path (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  hop_at_peer INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  family_contact TEXT NOT NULL,
  user_id TEXT NOT NULL,                  -- FK lógica al caso
  token TEXT NOT NULL,                    -- para WebSocket
  last_notified_at INTEGER
);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  closed_at INTEGER,                      -- null mientras esté abierto
  closed_reason TEXT                      -- "ALL_SAFE" | "TIMEOUT" | "MANUAL"
);

CREATE INDEX idx_messages_received_at ON messages(received_at);
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_event_id ON messages(event_id);
CREATE INDEX idx_message_path_message_id ON message_path(message_id);
CREATE INDEX idx_families_family_contact ON families(family_contact);
```

## Endpoints REST

### POST /api/messages

Recibe un telegrama del gateway. **Es el endpoint principal.**

```json
// Request
{
  "v": 1,
  "id": "a8f29c3f-7b9e-4a1d-8e2f-1c5b9d6e3f4a",
  "user_id": "USER123",
  "event_id": "EARTHQUAKE001",
  "event": "EARTHQUAKE",
  "name": "Juan Perez",
  "blood": "O+",
  "age": 35,
  "medical_note": null,
  "family_contact": "+57...",
  "location": { "lat": 4.6097, "lng": -74.0817 },
  "status": "EMERGENCY",
  "question_id": "PET_NAME_42",
  "answer_hash": "abcxyz...",
  "timestamp": 1787440000,
  "severity": 3,
  "hop": 4,
  "ttl": 4,
  "origin": "device_short_hash"
}
```

```json
// Response 201 Created
{
  "id": "a8f29c3f-...",
  "received_at": 1787440123,
  "status": "EMERGENCY",
  "hops": 4
}
```

Lógica:
1. Validar schema (zod / pydantic).
2. Validar HMAC si está presente (descartar si inválido).
3. Pasar al **Emergency Orchestrator** (`orchestrator.ingest(payload)`). Este deduplica por `id`, agrupa por `user_id`, valida `answer_hash` si `status == "SAFE"`, y decide la prioridad.
4. INSERT en `messages` (idempotente por `id`, lo hace el orchestrator).
5. INSERT en `message_path` con el peer que trajo el mensaje.
6. WebSocket broadcast a clientes suscritos a este `user_id` o `family_contact`.

### GET /api/messages/:id

La familia consulta el estado actual de un mensaje.

```json
// Response 200
{
  "id": "a8f29c3f-...",
  "user_id": "USER123",
  "event_id": "EARTHQUAKE001",
  "event": "EARTHQUAKE",
  "status": "EMERGENCY",
  "received_at": 1787440123,
  "video_uploaded_at": 1787441000,
  "video_url": "/storage/a8f29c3f.../video.mp4",
  "hops": 4,
  "path": ["peer_A", "peer_B", "peer_C", "peer_D_gateway"],
  "origin": {
    "lat": 4.6097,
    "lng": -74.0817,
    "timestamp": 1787440000,
    "name": "Juan Perez",
    "blood": "O+",
    "age": 35
  }
}
```

### POST /api/evidence/:telegram_id

El origen sube el video cuando recupera Internet (Patrón C).

```
Content-Type: multipart/form-data
Fields:
  - video: file (mp4)
  - chunk_index: int (default 0)
  - total_chunks: int (default 1)
  - sha256: string (hex)
```

```json
// Response 200
{
  "id": "a8f29c3f-...",
  "video_url": "/storage/a8f29c3f.../video.mp4",
  "size_bytes": 1234567
}
```

Lógica:
1. Validar `sha256` del archivo subido.
2. Guardar en `/storage/{telegram_id}/video_{chunk_index}.mp4`.
3. UPDATE `messages.video_uploaded_at = now()`.
4. WebSocket broadcast tipo `VIDEO_RECEIVED`.

### POST /api/families/register

La familia se registra para recibir updates de un mensaje.

```json
// Request
{
  "family_contact": "+57...",
  "message_id": "a8f29c3f-..."
}
```

```json
// Response 201
{
  "id": "family_abc123",
  "token": "ws_token_xyz789",  // para WebSocket
  "message_id": "a8f29c3f-..."
}
```

### GET /api/lookup?family_contact=+57...

Endpoint opcional para v2: la familia busca mensajes asociados a su número.

```json
// Response 200
{
  "messages": [
    { "id": "a8f29c3f-...", "status": "DELIVERED", "person_name": "Juan Pérez" }
  ]
}
```

## WebSocket /ws?token=...

Push en tiempo real al dashboard familiar.

```json
// Server → Client message
{
  "type": "MESSAGE_UPDATED",     // o "VIDEO_RECEIVED", "PATH_EXTENDED"
  "id": "a8f29c3f-...",
  "status": "DELIVERED",
  "video_uploaded_at": 1787441000,
  "hops": 4
}
```

## Autenticación simple (para 36h)

- Cliente recibe `token` al hacer `POST /api/families/register`.
- Token se pasa como query param en WebSocket: `ws://host/ws?token=...`.
- Server valida token contra tabla `families.token`.
- Aceptable para demo — para producción, JWT con expiración.

## Dashboard familiar (frontend mínimo)

- Una sola página HTML con polling cada 3s a `/api/messages/:id`.
- (Opcional) WebSocket para updates instantáneos.
- UI mínima: nombre, ubicación en mapa (Google Maps embed), hops, estado del video.

```html
<!-- Pseudo estructura -->
<div class="emergency-card">
  <h2>Juan Pérez</h2>
  <p>Última señal: hace 2 minutos</p>
  <p>Ubicación: 4.6097, -74.0817</p>
  <p>Saltos: A → B → C → D</p>
  <video controls src="/storage/a8f29c.../video.mp4"></video>
</div>
```

## Endpoints opcionales para v2 (NO en MVP)

- `GET /api/zones/heatmap` — heatmap de emergencias en una zona.
- `GET /api/messages?since=timestamp` — listado de emergencias activas.
- `POST /api/alerts/trigger` — endpoint para que EMSC dispare alertas.
- `GET /api/ledger/:device_id` — qué sabe un nodo específico.
- WebSocket auth con JWT firmado.

## Resiliencia básica

- **Idempotencia:** todos los POST son idempotentes por `id` (replay-safe).
- **Rate limit:** 100 req/min por IP en endpoints públicos.
- **CORS abierto** para el dashboard (en producción, cerrar).
- **Logging:** todas las requests se loguean con `id` para debug.
