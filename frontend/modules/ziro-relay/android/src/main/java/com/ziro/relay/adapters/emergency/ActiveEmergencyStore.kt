package com.ziro.relay.adapters.emergency

import android.content.ContentValues
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.PersonStatus

data class ActiveEmergency(
	val eventId: String,
	val eventType: EventType,
	val revision: Int,
	val userStatus: PersonStatus = PersonStatus.EMERGENCY,
)

class ActiveEmergencyStore(private val database: RelayDatabase) {
	fun current(): ActiveEmergency? = database.readableDatabase.rawQuery(
		"SELECT event_id, event_type, revision, user_status FROM active_emergency WHERE id = 1", null,
	).use { cursor ->
		if (!cursor.moveToFirst()) return@use null
		ActiveEmergency(
			cursor.getString(0),
			EventType.valueOf(cursor.getString(1)),
			cursor.getInt(2),
			PersonStatus.valueOf(cursor.getString(3)),
		)
	}

	fun replaceIfNewer(event: ActiveEmergency): Boolean {
		val current = current()
		if (current != null && current.eventId == event.eventId && current.revision >= event.revision) return false
		val values = ContentValues().apply {
			put("id", 1)
			put("event_id", event.eventId)
			put("event_type", event.eventType.name)
			put("revision", event.revision)
			put("user_status", event.userStatus.name)
		}
		database.writableDatabase.insertWithOnConflict("active_emergency", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
		return true
	}

	fun updateUserStatus(status: PersonStatus) {
		val current = current() ?: return
		database.writableDatabase.execSQL(
			"UPDATE active_emergency SET user_status = ? WHERE event_id = ?",
			arrayOf(status.name, current.eventId),
		)
	}
}
