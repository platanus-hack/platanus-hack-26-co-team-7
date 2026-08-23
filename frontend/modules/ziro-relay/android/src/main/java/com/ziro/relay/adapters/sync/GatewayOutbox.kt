package com.ziro.relay.adapters.sync

import android.content.ContentValues
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec

data class GatewayOutboxItem(val id: String, val telegram: String, val status: String, val retryCount: Int, val error: String?)
data class GatewaySyncSnapshot(
    val pendingCount: Int,
    val lastSyncAt: Long?,
    val lastConfirmedPurgeAt: Long?,
    val lastConfirmedPurgeOutcome: String?,
    val items: List<GatewayOutboxItem>,
)

/** Native durable queue. JS only sends these wire telegrams; it never owns deduplication. */
class GatewayOutbox(private val database: RelayDatabase) {
    companion object {
        const val MAX_ITEMS = 100
        const val MAX_BYTES = 512 * 1024
        const val RAW_TELEGRAM_RETENTION_MS = 24L * 60L * 60L * 1000L
    }
    fun enqueue(telegram: Telegram) {
        val values = ContentValues().apply { put("telegram_id", telegram.id) }
        database.writableDatabase.insertWithOnConflict("gateway_outbox", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun snapshot(): GatewaySyncSnapshot {
        val db = database.readableDatabase
        val items = db.rawQuery("SELECT o.telegram_id, t.telegram_json, COALESCE(o.outcome, 'pending'), o.retry_count, o.error FROM gateway_outbox o JOIN telegram t ON t.id=o.telegram_id WHERE o.synced_at IS NULL ORDER BY CASE json_extract(t.telegram_json, '$.status') WHEN 'EMERGENCY' THEN 0 WHEN 'NEED_HELP' THEN 1 ELSE 2 END, t.created_at ASC", null).use { cursor ->
            buildList { while (cursor.moveToNext()) add(GatewayOutboxItem(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getInt(3), cursor.getString(4))) }
        }
        val lastSync = db.rawQuery("SELECT MAX(synced_at) FROM gateway_outbox", null).use { cursor -> if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null }
        val lastPurge = db.rawQuery("SELECT confirmed_at, outcome FROM telegram_tombstone ORDER BY confirmed_at DESC LIMIT 1", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0) to cursor.getString(1) else null
        }
        return GatewaySyncSnapshot(items.size, lastSync, lastPurge?.first, lastPurge?.second, items)
    }

    /** Strict user priority and encoded JSON envelope cap, so a valid batch is durable and replay-safe. */
    fun nextBatch(): List<GatewayOutboxItem> {
        val selected = mutableListOf<GatewayOutboxItem>()
        var bytes = "{\"items\":[]}".toByteArray().size
        snapshot().items.forEach { item ->
            val itemBytes = item.telegram.toByteArray().size + if (selected.isEmpty()) 0 else 1
            if (selected.size == MAX_ITEMS || bytes + itemBytes > MAX_BYTES) return@forEach
            selected += item
            bytes += itemBytes
        }
        return selected
    }

    /** Server acknowledgement stops uploads; raw relay data remains available for the 24-hour gossip window. */
    fun recordOutcome(id: String, outcome: String, error: String?) {
        val removable = outcome == "accepted" || outcome == "duplicate" || outcome == "ignored_safe"
        val db = database.writableDatabase
        db.beginTransaction()
        try {
            if (removable) {
                val now = System.currentTimeMillis()
                db.execSQL("UPDATE gateway_outbox SET synced_at=?, outcome=?, last_attempt_at=?, error=NULL WHERE telegram_id=?", arrayOf(now, outcome, now, id))
                purgeConfirmedRecords(db, now)
            } else {
                db.execSQL("UPDATE gateway_outbox SET outcome=?, last_attempt_at=?, error=?, retry_count=retry_count+1 WHERE telegram_id=?", arrayOf(outcome, System.currentTimeMillis(), error, id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun purgeConfirmedRecords() {
        val db = database.writableDatabase
        db.beginTransaction()
        try {
            purgeConfirmedRecords(db, System.currentTimeMillis())
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun purgeConfirmedRecords(db: android.database.sqlite.SQLiteDatabase, now: Long) {
        val cutoff = now - RAW_TELEGRAM_RETENTION_MS
        val eligible = "SELECT o.telegram_id FROM gateway_outbox o JOIN telegram t ON t.id = o.telegram_id WHERE o.synced_at IS NOT NULL AND o.outcome IN ('accepted', 'duplicate', 'ignored_safe') AND o.synced_at <= ?"
        db.execSQL("INSERT OR REPLACE INTO telegram_tombstone (telegram_id, confirmed_at, outcome, event_id) SELECT t.id, o.synced_at, o.outcome, json_extract(t.telegram_json, '$.event_id') FROM gateway_outbox o JOIN telegram t ON t.id = o.telegram_id WHERE o.synced_at IS NOT NULL AND o.outcome IN ('accepted', 'duplicate', 'ignored_safe') AND o.synced_at <= ?", arrayOf(cutoff))
        db.delete("telegram", "id IN ($eligible)", arrayOf(cutoff.toString()))
    }

    fun recordTransportFailure(ids: List<String>, diagnostic: String) {
        val db = database.writableDatabase
        db.beginTransaction()
        try {
            ids.forEach { id -> db.execSQL("UPDATE gateway_outbox SET outcome=?, last_attempt_at=?, error=?, retry_count=retry_count+1 WHERE telegram_id=?", arrayOf("retry_pending", System.currentTimeMillis(), diagnostic, id)) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
}
