# ledger.md — Registro distribuido y gossip entre pares

## Concepto

Cada nodo ZIRO mantiene una **base de datos local SQLite** con **TODOS los telegramas que vio**, no solo los que retransmite. Esta base se sincroniza con cada par usando un protocolo de **gossip** simple (diff de IDs primero, bytes después).

## Por qué esto importa (no es decoración)

Sin ledger distribuido, ZIRO sería "solo otro mesh messenger". Con ledger distribuido, ZIRO se vuelve:

1. **Un repositorio distribuido de emergencias activas** — un rescatista con ZIRO offline puede ver qué personas se reportaron en su zona.
2. **Un sistema tolerante a fallos** — si un nodo se pierde, otros siguen teniendo la info.
3. **Un sistema útil incluso sin Internet** — el ledger local es consultable desde la app.

## Esquema SQLite (Room)

```kotlin
@Entity(tableName = "telegramas")
data class TelegramEntity(
    @PrimaryKey val id: String,           // UUID v4 — clave de dedup universal
    val v: Int,                           // versión del protocolo
    val event: String,                    // EARTHQUAKE, FIRE, FLOOD, MEDICAL, OTHER
    val lat: Double,
    val lng: Double,
    val ts: Long,                         // epoch seconds del origen
    val severity: Int,                    // 1-5
    val hop: Int,
    val ttl: Int,
    val origin: String,                   // hash corto del device origen
    val personName: String?,
    val personAge: Int?,
    val medicalNote: String?,
    val familyContact: String?,
    val receivedAt: Long,                 // epoch seconds LOCAL (cuándo llegó a este nodo)
    val hmac: String?                     // firma criptográfica opcional
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

## Reglas del ledger local

### Regla L1 — Deduplicación por id (corazón del protocolo)

```kotlin
suspend fun onTelegram(t: Telegram) {
    mutex.withLock(t.id) {
        if (dao.exists(t.id)) return@withLock  // ya lo tengo, ignoro silencioso
        dao.insert(t.toEntity(receivedAt = now()))
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
    dao.deleteWhere("ttl <= 0 OR received_at < ?", cutoff)
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
