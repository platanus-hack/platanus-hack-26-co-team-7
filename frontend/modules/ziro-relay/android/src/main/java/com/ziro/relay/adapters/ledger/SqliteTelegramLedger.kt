package com.ziro.relay.adapters.ledger

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.adapters.sync.GatewayOutbox
import com.ziro.relay.adapters.sync.GatewaySyncWorker
import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.RelayPolicy
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.ports.TelegramLedger
import com.ziro.relay.ports.LedgerLocalState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Durable SQLite ledger: message-id deduplication and per-peer delivery receipts are database constraints. */
class SqliteTelegramLedger(private val database: RelayDatabase, private val gatewayOutbox: GatewayOutbox) : TelegramLedger {
    private val mutex = Mutex()
    private val _stream = MutableStateFlow(emptyList<Telegram>())

    init {
        // Raw telegrams remain until a server-confirmed outcome authorizes their purge.
        // Tombstones retain only deduplication metadata for repeated mesh replicas.
        database.writableDatabase.execSQL(
            "DELETE FROM telegram_tombstone WHERE confirmed_at < ?",
            arrayOf(System.currentTimeMillis() - TOMBSTONE_RETENTION_MS),
        )
        gatewayOutbox.purgeConfirmedRecords()
        _stream.value = loadAll()
    }

    override suspend fun has(id: String): Boolean = mutex.withLock {
        get(id) != null || database.readableDatabase.query(
            "telegram_tombstone", arrayOf("telegram_id"), "telegram_id = ?", arrayOf(id), null, null, null,
        ).use { it.moveToFirst() }
    }

    override suspend fun put(telegram: Telegram, receivedFrom: PeerId?): Boolean = mutex.withLock {
        val wire = TelegramCodec.encode(telegram).toString(Charsets.UTF_8)
        val db = database.writableDatabase
        db.beginTransaction()
        try {
            ensureCapacity(db, wire.toByteArray(Charsets.UTF_8).size)
            val values = ContentValues().apply {
                put("id", telegram.id)
                put("telegram_json", wire)
                put("received_from", receivedFrom?.value)
                put("created_at", System.currentTimeMillis())
            }
            val inserted = db.insertWithOnConflict("telegram", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
            if (inserted) gatewayOutbox.enqueue(telegram)
            db.setTransactionSuccessful()
            if (inserted) { GatewaySyncWorker.schedule(database.context); publish() }
            inserted
        } finally {
            db.endTransaction()
        }
    }

    /** TTL/LRU must never evict raw relay data; capacity exhaustion is explicit until a confirmed purge. */
    private fun ensureCapacity(db: SQLiteDatabase, incomingBytes: Int) {
        if (ledgerBytes(db) + incomingBytes > MAX_LEDGER_BYTES) {
            throw IllegalStateException("Local relay storage is full. Connect to a gateway and wait for server-confirmed synchronization before receiving more data.")
        }
    }

    private fun ledgerBytes(db: SQLiteDatabase): Int = db.rawQuery("SELECT COALESCE(SUM(length(telegram_json)), 0) FROM telegram", null).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }

    private companion object {
        const val TOMBSTONE_RETENTION_MS = 30L * 24L * 60L * 60L * 1000L
        const val MAX_LEDGER_BYTES = 5 * 1024 * 1024
    }

    override suspend fun get(id: String): Telegram? = database.readableDatabase.query(
        "telegram", arrayOf("telegram_json"), "id = ?", arrayOf(id), null, null, null,
    ).use { cursor -> if (cursor.moveToFirst()) TelegramCodec.decode(cursor.getString(0).toByteArray()) else null }

    override suspend fun all(): List<Telegram> = mutex.withLock { loadAll() }
    override suspend fun localState(id: String): LedgerLocalState? = mutex.withLock {
        val receivedFrom = database.readableDatabase.query(
            "telegram", arrayOf("received_from"), "id = ?", arrayOf(id), null, null, null,
        ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0)?.let(::PeerId) else return@withLock null }
        val deliveredTo = database.readableDatabase.query(
            "delivery", arrayOf("peer_id"), "telegram_id = ?", arrayOf(id), null, null, null,
        ).use { cursor -> buildSet { while (cursor.moveToNext()) add(PeerId(cursor.getString(0))) } }
        LedgerLocalState(receivedFrom, deliveredTo)
    }
    override fun stream(): Flow<List<Telegram>> = _stream.asStateFlow()

    override suspend fun markDelivered(id: String, peer: PeerId) = mutex.withLock {
        val values = ContentValues().apply { put("telegram_id", id); put("peer_id", peer.value) }
        database.writableDatabase.insertWithOnConflict("delivery", null, values, SQLiteDatabase.CONFLICT_IGNORE)
        Unit
    }

    override suspend fun wasDeliveredTo(id: String, peer: PeerId): Boolean = mutex.withLock {
        database.readableDatabase.query("delivery", arrayOf("telegram_id"), "telegram_id = ? AND peer_id = ?", arrayOf(id, peer.value), null, null, null)
            .use { it.moveToFirst() }
    }

    override suspend fun pendingFor(peer: PeerId): List<Telegram> = mutex.withLock {
        loadAll().filter(RelayPolicy::shouldForward).filterNot { telegram ->
            database.readableDatabase.query(
                "delivery", arrayOf("telegram_id"), "telegram_id = ? AND peer_id = ?", arrayOf(telegram.id, peer.value), null, null, null,
            ).use { it.moveToFirst() }
        }
    }

    override suspend fun count(): Int = mutex.withLock {
        database.readableDatabase.rawQuery("SELECT COUNT(*) FROM telegram", null).use { cursor -> cursor.moveToFirst(); cursor.getInt(0) }
    }

    private fun loadAll(): List<Telegram> = database.readableDatabase.query(
        "telegram", arrayOf("telegram_json"), null, null, null, null, "created_at DESC",
    ).use { cursor -> buildList { while (cursor.moveToNext()) TelegramCodec.decode(cursor.getString(0).toByteArray())?.let(::add) } }

    private fun publish() { _stream.value = loadAll() }
}
