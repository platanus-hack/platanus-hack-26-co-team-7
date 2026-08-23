package com.ziro.relay.adapters.sqlite

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** MVP local storage. It is SQLite-backed, durable across process restarts, and unencrypted. */
class RelayDatabase(context: Context) : SQLiteOpenHelper(context, NAME, null, VERSION) {
    val context: Context = context.applicationContext
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK (id = 1), profile_json TEXT NOT NULL)")
        db.execSQL(
            "CREATE TABLE telegram (id TEXT PRIMARY KEY, telegram_json TEXT NOT NULL, received_from TEXT, created_at INTEGER NOT NULL)",
        )
        db.execSQL(
            "CREATE TABLE delivery (telegram_id TEXT NOT NULL, peer_id TEXT NOT NULL, PRIMARY KEY (telegram_id, peer_id), " +
                "FOREIGN KEY (telegram_id) REFERENCES telegram(id) ON DELETE CASCADE)",
        )
        db.execSQL("CREATE TABLE migration (name TEXT PRIMARY KEY)")
        createSyncTables(db)
        createEmergencyTables(db)
        createPurgeTables(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("CREATE TABLE IF NOT EXISTS migration (name TEXT PRIMARY KEY)")
        if (oldVersion < 3) createSyncTables(db)
        if (oldVersion < 4) createEmergencyTables(db)
        if (oldVersion < 6) createPurgeTables(db)
        if (oldVersion < 7) db.execSQL("ALTER TABLE active_emergency ADD COLUMN user_status TEXT NOT NULL DEFAULT 'EMERGENCY'")
    }

    private fun createSyncTables(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS gateway_outbox (telegram_id TEXT PRIMARY KEY, synced_at INTEGER, outcome TEXT, last_attempt_at INTEGER, retry_count INTEGER NOT NULL DEFAULT 0, error TEXT, FOREIGN KEY (telegram_id) REFERENCES telegram(id) ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_gateway_outbox_pending ON gateway_outbox(synced_at, last_attempt_at)")
    }

    private fun createEmergencyTables(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS active_emergency (id INTEGER PRIMARY KEY CHECK (id = 1), event_id TEXT NOT NULL, event_type TEXT NOT NULL, revision INTEGER NOT NULL, user_status TEXT NOT NULL DEFAULT 'EMERGENCY')")
    }

    private fun createPurgeTables(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS telegram_tombstone (telegram_id TEXT PRIMARY KEY, confirmed_at INTEGER NOT NULL, outcome TEXT NOT NULL, event_id TEXT)")
        db.execSQL("CREATE INDEX IF NOT EXISTS ix_telegram_tombstone_confirmed_at ON telegram_tombstone(confirmed_at)")
    }

    private companion object {
        const val NAME = "ziro_relay.sqlite"
        const val VERSION = 7
    }
}
