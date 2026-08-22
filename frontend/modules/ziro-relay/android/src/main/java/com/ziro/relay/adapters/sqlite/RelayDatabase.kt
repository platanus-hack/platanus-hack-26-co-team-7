package com.ziro.relay.adapters.sqlite

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** MVP local storage. It is SQLite-backed, durable across process restarts, and unencrypted. */
class RelayDatabase(context: Context) : SQLiteOpenHelper(context, NAME, null, VERSION) {
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
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("CREATE TABLE IF NOT EXISTS migration (name TEXT PRIMARY KEY)")
    }

    private companion object {
        const val NAME = "ziro_relay.sqlite"
        const val VERSION = 2
    }
}
