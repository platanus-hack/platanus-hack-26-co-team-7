package com.ziro.relay.adapters.emergency

import android.content.ContentValues
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.domain.EventType

data class ActiveEmergency(val eventId: String, val eventType: EventType, val revision: Int)

class ActiveEmergencyStore(private val database: RelayDatabase) {
    fun current(): ActiveEmergency? = database.readableDatabase.rawQuery(
        "SELECT event_id, event_type, revision FROM active_emergency WHERE id = 1", null,
    ).use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        ActiveEmergency(cursor.getString(0), EventType.valueOf(cursor.getString(1)), cursor.getInt(2))
    }

    fun replaceIfNewer(event: ActiveEmergency): Boolean {
        val current = current()
        if (current != null && current.eventId == event.eventId && current.revision >= event.revision) return false
        val values = ContentValues().apply {
            put("id", 1); put("event_id", event.eventId); put("event_type", event.eventType.name); put("revision", event.revision)
        }
        database.writableDatabase.insertWithOnConflict("active_emergency", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
        return true
    }
}
