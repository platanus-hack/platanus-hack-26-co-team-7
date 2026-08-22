# api.md — Endpoints backend mínimos

## Stack propuesto

- **Node.js + Express** o **Python + FastAPI** — cualquiera sirve para 36h, lo que el equipo domine.
- **WebSocket** para push al dashboard familiar en tiempo real.
- **Storage:** SQLite (suficiente para demo) o PostgreSQL si el equipo prefiere.

## Modelo de datos

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  ts INTEGER NOT NULL,
  severity INTEGER NOT NULL,
  hop INTEGER NOT NULL,
  origin TEXT NOT NULL,
  person_name TEXT,
  person_age INTEGER,
  medical_note TEXT,
  family_contact TEXT,
  received_at INTEGER NOT NULL,
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
  message_id TEXT NOT NULL,
  last_notified_at INTEGER,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX idx_messages_received_at ON messages(received_at);
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
  "event": "EARTHQUAKE",
  "lat": 4.6097,
  "lng": -74.0817,
  "ts": 1787440000,
  "severity": 3,
  "hop": 4,
  "ttl": 4,
  "origin": "device_short_hash",
  "person_name": "Juan Pérez",
  "person_age": 35,
  "medical_note": null,
  "family_contact": "+57..."
}
```

```json
// Response 201 Created
{
  "id": "a8f29c3f-...",
  "received_at": 1787440123,
  "status": "DELIVERED",
  "hops": 4
}
```

Lógica:
1. Validar schema (zod / pydantic).
2. Validar HMAC si está presente (descartar si inválido).
3. INSERT en `messages` (idempotente por `id`).
4. INSERT en `message_path` con el peer que trajo el mensaje.
5. WebSocket broadcast a clientes suscritos a este `id` o `family_contact`.

### GET /api/messages/:id

La familia consulta el estado actual de un mensaje.

```json
// Response 200
{
  "id": "a8f29c3f-...",
  "event": "EARTHQUAKE",
  "status": "DELIVERED",
  "received_at": 1787440123,
  "video_uploaded_at": 1787441000,
  "video_url": "/storage/a8f29c3f.../video.mp4",
  "hops": 4,
  "path": ["peer_A", "peer_B", "peer_C", "peer_D_gateway"],
  "origin": {
    "lat": 4.6097,
    "lng": -74.0817,
    "ts": 1787440000,
    "person_name": "Juan Pérez",
    "person_age": 35
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
