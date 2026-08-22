# ledger.md — Registro distribuido y gossip entre pares

## Concepto

Cada nodo ZIRO mantiene una **base de datos local SQLite** con **TODOS los telegramas que vio**, no solo los que retransmite. Esta base se sincroniza con cada par usando un protocolo de **gossip** simple (diff de IDs primero, bytes después).

### JSON vs SQLite — dos roles distintos

| Capa | Qué es | Para qué |
|---|---|---|
| **JSON** (telegrama) | Paquete de transporte que viaja por la red mesh | Información en tránsito: ~200 bytes, inmutable, schema fijo (ver `protocol.md`) |
| **SQLite** (ledger) | **Memoria del nodo** | Persistencia local: dedup por id, store-and-forward cuando no hay Internet, re-transmisión al reconectarse, auditoría del recorrido del mensaje |

**El JSON no reemplaza al SQLite.** El JSON es lo que se manda; el SQLite es lo que se recuerda. Cuando un nodo recibe un JSON, lo deserializa y lo guarda como fila. Si el nodo muere, el JSON se pierde; si solo pierde conexión, el SQLite le permite reintentar.

## Por qué esto importa (no es decoración)

Sin ledger distribuido, ZIRO sería "solo otro mesh messenger". Con ledger distribuido, ZIRO se vuelve:

1. **Un repositorio distribuido de emergencias activas** — un rescatista con ZIRO offline puede ver qué personas se reportaron en su zona.
2. **Un sistema tolerante a fallos** — si un nodo se pierde, otros siguen teniendo la info.
3. **Un sistema útil incluso sin Internet** — el ledger local es consultable desde la app.
4. **Un sistema con store-and-forward real** — un nodo sin Internet puede acumular mensajes y flush-earlos apenas recupera señal.

## Encriptación local

El ledger puede contener **datos sensibles**: nombre, tipo de sangre, contactos familiares, ubicación precisa. Si un teléfono cae en malas manos después del desastre, esa información no debe filtrarse.

- **MVP demo:** SQLite plano. Aceptable para la hackatón en ambiente controlado.
- **Producción:** **SQLCipher** (`net.zetetic:android-database-sqlcipher`) con clave derivada del device. Cada nodo que "encuentra" un teléfono abandonado no debe poder leer el contenido sin la clave.

La migración MVP → prod es drop-in porque SQLCipher implementa la misma API de SQLite.

## Esquema SQLite (Room)

Dos tablas centrales: `messages` (el contenido) y `hops` (la auditoría del recorrido). Más dos tablas auxiliares.

```kotlin
@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,           // UUID v4 — clave de dedup universal
    val payloadJson: String,              // telegrama completo serializado (fuente de verdad)
    val status: String,                   // RECEIVED | RELAYED | FLUSHED | WIPED
    val createdAt: Long,                  // epoch seconds LOCAL (cuándo llegó a este nodo)
    val sent: Boolean,                    // true si ya se entregó al backend (auto-gateway)
    val receivedFrom: String?,            // peerId del primer par que trajo este id (null si lo generamos nosotros)
    val hopCount: Int,                    // cantidad actual de saltos realizados
    val hmac: String?                     // firma criptográfica opcional del origen
)

@Entity(tableName = "hops",
    primaryKeys = ["messageId", "hopIndex"])
data class HopEntity(
    val messageId: String,                // FK a messages.id
    val hopIndex: Int,                    // 0, 1, 2, ... orden del salto
    val fromPeer: String,                 // hash del nodo que entregó
    val toPeer: String,                   // hash del nodo receptor
    val timestamp: Long                   // epoch seconds LOCAL
)

@Entity(tableName = "delivered_peers",
    primaryKeys = ["telegramId", "peerId"])
data class DeliveredPeer(
    val telegramId: String,
    val peerId: String,                   // hash del peer al que ya le entregué este id
    val deliveredAt: Long
)

@Entity(tableName = "evidence_chunks")
data class EvidenceChunkEntity(
    @PrimaryKey(autoGenerate = true) val rowId: Long = 0,
    val telegramId: String,
    val chunkIndex: Int,
    val totalChunks: Int,
    val sizeBytes: Long,
    val sha256: String,
    val storedAt: Long
)
```

### Por qué dos tablas (messages + hops)

`messages` guarda **qué hay** en este nodo. `hops` guarda **cómo llegó hasta acá**. Separarlas permite:

- Auditar el recorrido exacto de un mensaje sin re-parsear el JSON cada vez.
- Mostrar en el dashboard familiar el path A → B → C → D → Gateway de forma barata.
- Detectar peers que están perdiendo mensajes (gap en la cadena).

## Reglas del ledger local

### Regla L1 — Deduplicación por id (corazón del protocolo)

```kotlin
suspend fun onTelegram(t: Telegram, fromPeer: String?) {
    mutex.withLock(t.id) {
        if (messagesDao.exists(t.id)) return@withLock  // ya lo tengo, ignoro silencioso
        messagesDao.insert(
            MessageEntity(
                id = t.id,
                payloadJson = t.toJsonString(),
                status = "RECEIVED",
                createdAt = now(),
                sent = false,
                receivedFrom = fromPeer,
                hopCount = t.hop,
                hmac = t.hmac
            )
        )
        hopsDao.insert(
            HopEntity(messageId = t.id, hopIndex = t.hop,
                     fromPeer = fromPeer ?: t.origin,
                     toPeer = localNodeId, timestamp = now())
        )
    }
}
```

### Regla L2 — TTL decrementa en retransmisión, hop incrementa

```kotlin
fun prepareForward(t: Telegram): Telegram? {
    val newTtl = t.ttl - 1
    if (newTtl <= 0) return null  // llegó al límite, no reenviar
    return t.copy(hop = t.hop + 1, ttl = newTtl)
}
```

### Regla L3 — Limpieza periódica por TTL y edad

```kotlin
suspend fun cleanup() {
    val cutoff = (System.currentTimeMillis() / 1000) - (24 * 3600)  // 24h
    dao.deleteWhere("status = 'WIPED' OR created_at < ?", cutoff)
}
```

### Regla L4 — Cap de memoria (LRU cuando se llena)

```kotlin
suspend fun enforceCap(maxBytes: Long = 5_000_000) {
    val currentSize = dao.sizeInBytes()
    if (currentSize > maxBytes) {
        // borrar los más viejos hasta entrar en el cap
        val toDelete = (currentSize - maxBytes) / 200  // ~200 bytes por telegrama
        dao.deleteOldest(toDelete.toInt())
    }
}
```

### Regla L5 — Inmutabilidad semántica

Un telegrama **nunca se modifica semánticamente** en tránsito. Solo cambian `hop` y `ttl`. El resto de los campos son del origen.

### Regla L6 — Auto-gateway (sin confirmación humana)

Cuando el nodo detecta que tiene Internet (WiFi o datos móviles), **flushea automáticamente** todos los mensajes con `sent = false`. No hay prompt "querés subir?". En una emergencia, la latencia mata.

```kotlin
suspend fun onInternetAvailable() {
    val pending = messagesDao.getPendingFlush()        // sent = false
    for (msg in pending) {
        try {
            val t = parseTelegram(msg.payloadJson)
            api.uploadTelegram(t)
            messagesDao.markSent(msg.id)               // sent = true
            messagesDao.updateStatus(msg.id, "FLUSHED")
        } catch (e: Exception) {
            log("Flush failed for ${msg.id}: $e — will retry on next reconnect")
            // queda como RECEIVED, sent = false. Reintento en próxima conexión.
        }
    }
}
```

El flush corre en background. La UI no se entera. La única señal visible para el usuario es el ícono de "sincronizado".

### Regla L7 — Auto-wipe de campos sensibles cuando el evento se cierra

Cuando el backend confirma que un `event_id` está cerrado (lo recibimos por respuesta del flush o por push WS), el nodo agenda un **wipe de campos sensibles** 72 horas después. Esto minimiza el riesgo de que un teléfono abandonado filtre datos médicos o de ubicación.

```kotlin
suspend fun scheduleWipeForClosedEvent(eventId: String, closedAt: Long) {
    val wipeAt = closedAt + (72 * 3600)
    pendingWipesDao.insert(PendingWipe(eventId = eventId, wipeAt = wipeAt))
}

suspend fun runDueWipes(now: Long) {
    val due = pendingWipesDao.getDue(now)
    for (w in due) {
        // re-leer cada payload, borrar campos sensibles, re-serializar
        for (msg in messagesDao.getByEventId(w.eventId)) {
            val t = parseTelegram(msg.payloadJson)
            val wiped = t.copy(
                name = null,
                blood = null,
                age = null,
                medicalNote = null,
                familyContact = null,
                location = null,
                questionId = null,
                answerHash = null
            )
            messagesDao.updatePayload(msg.id, wiped.toJsonString())
            messagesDao.updateStatus(msg.id, "WIPED")
        }
        pendingWipesDao.delete(w.eventId)
    }
}
```

**Lo que se conserva después del wipe:** `id`, `user_id`, `event_id`, `event`, `timestamp`, `severity`, `hop`, `ttl`, `origin`, `status`. Suficiente para estadísticas anonimizadas ("fueron N personas afectadas en el evento EARTHQUAKE001"), nada más.

**Lo que se borra:** `name`, `blood`, `age`, `medical_note`, `family_contact`, `location`, `question_id`, `answer_hash`. Datos que un atacante podría usar para identificar, localizar o contactar a la persona.

## Protocolo de gossip (sync entre pares)

Cuando A y B se conectan vía Nearby Connections:

### Paso 1 — Metadata exchange

A envía a B (metadata liviana, ~1 KB):

```json
{
  "type": "LEDGER_SUMMARY",
  "my_ids": ["uuid1", "uuid2", "uuid3"],   // primeros 100 IDs (resto bajo demanda)
  "ledger_size": 47,
  "oldest_ts": 1787400000
}
```

B compara con su propio ledger y responde:

```json
{
  "type": "LEDGER_DIFF_REQUEST",
  "want_from_you": ["uuid4", "uuid5"],      // IDs que A tiene y yo no
  "i_have_for_you": ["uuid50", "uuid51"]   // IDs que yo tengo y A no
}
```

### Paso 2 — Byte exchange (solo los nuevos)

A envía los bytes completos de cada ID en `want_from_you`:

```kotlin
for (id in wantFromYou) {
    val t = dao.getById(id) ?: continue
    nearby.send(endpointId, t.toJsonBytes())
}
```

B hace lo mismo con sus IDs.

### Paso 3 — ACK por cada telegrama recibido

```kotlin
suspend fun onTelegramBytesReceived(bytes: ByteArray, fromPeer: String) {
    val t = parseTelegram(bytes)
    mutex.withLock(t.id) {
        if (dao.exists(t.id)) return@withLock
        dao.insert(t.toEntity())
        // marcar delivered
        deliveredDao.insert(DeliveredPeer(t.id, fromPeer, now()))
        // ack al peer
        nearby.send(fromPeer, "ACK:${t.id}".toByteArray())
    }
}
```

### Paso 4 — Backpressure

Si el ledger tiene > 100 IDs de diferencia, el que recibe puede pedir resumen paginado:

```json
{
  "type": "LEDGER_SUMMARY_PAGE",
  "page": 1,
  "page_size": 100,
  "sort_by": "received_at"
}
```

## Caso de uso del rescatista (el momento WOW)

El rescatista con ZIRO abre la app → la app muestra automáticamente una lista de personas reportadas en la zona (últimas 24h, severidad ≥ 2). Esta lista se llena **por gossip con cualquier par que se acerque**.

```kotlin
suspend fun showNearbyEmergencies(): List<Emergency> {
    return dao.getAllOrderByTsDesc(limit = 50)
        .map { it.toEmergency() }
}
```

**Pitch:** "Un rescatista llega a una zona sin Internet. Apenas entra al rango de cualquier ZIRO cercano, recibe la lista de personas reportadas. No necesita Internet. La información ya está distribuida en los teléfonos de la gente alrededor."

## Lo que NO hace este ledger (declaration of honesty)

- ❌ No es consenso distribuido (no hay agreement global — cada nodo puede tener versiones distintas).
- ❌ No es append-only inmutable (los nodos pueden borrar por TTL/cap).
- ❌ No es replicación total (filtro de 24h + cap de 5MB).
- ❌ No es un blockchain (no hay PoW, no hay bloques, no hay reward).

## Métricas esperadas en demo

- 5 nodos, 5 emergencias simuladas → cada nodo termina con las 5 en su ledger en < 60s.
- Rescatista (6to nodo) entra al rango → recibe las 5 emergencias en < 30s vía gossip.
- Tamaño del ledger después de 50 emergencias: ~10 KB (50 × ~200 bytes).
- Tiempo de sync entre dos nodos con 50 IDs cada uno: < 5s.
