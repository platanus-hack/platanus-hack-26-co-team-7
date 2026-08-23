package com.ziro.relay.adapters.sqlite

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import com.ziro.relay.adapters.profile.SqliteProfileStore
import com.ziro.relay.domain.BloodRh
import com.ziro.relay.domain.BloodType
import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.DocType
import com.ziro.relay.domain.EmergencyContact
import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.Profile
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.security.SecureRandom
import java.io.File

/** Imports the retired preference adapters once, before SQLite-backed ports are constructed. */
class LegacySharedPreferencesMigration(private val context: Context, private val database: RelayDatabase) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun run() {
        val snapshots = legacyPreferenceNames().map { context.getSharedPreferences(it, Context.MODE_PRIVATE).all }
        val db = database.writableDatabase
        if (hasMigrated(db)) return

        db.beginTransaction()
        try {
            if (!hasProfile(db)) legacyProfile(snapshots)?.let { SqliteProfileStore.write(database, it) }
            snapshots.flatMap(::legacyTelegrams).distinctBy { it.telegram.id }.forEach { entry ->
                insertTelegram(db, entry.telegram, entry.receivedFrom)
                entry.deliveredTo.forEach { insertDelivery(db, entry.telegram.id, it) }
            }
            db.insertOrThrow("migration", null, ContentValues().apply { put("name", MARKER) })
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun hasMigrated(db: SQLiteDatabase): Boolean = db.query(
        "migration", arrayOf("name"), "name = ?", arrayOf(MARKER), null, null, null,
    ).use { it.moveToFirst() }

    private fun hasProfile(db: SQLiteDatabase): Boolean = db.query(
        "profile", arrayOf("id"), "id = 1", null, null, null, null,
    ).use { it.moveToFirst() }

    private fun legacyProfile(snapshots: List<Map<String, *>>): Profile? = snapshots.asSequence()
        .flatMap { prefs -> PROFILE_KEYS.mapNotNull { key -> prefs[key] as? String }.asSequence() }
        .mapNotNull { raw -> runCatching { json.decodeFromString(LegacyProfile.serializer(), raw).toDomain() }.getOrNull() }
        .firstOrNull()

    private fun legacyTelegrams(preferences: Map<String, *>): List<LegacyTelegram> {
        val receipts = preferences.mapNotNull { (key, value) ->
            val id = key.removePrefix("delivery:").removePrefix("receipt:").takeIf { key.startsWith("delivery:") || key.startsWith("receipt:") }
            id?.let { it to (value as? Set<*>)?.mapNotNull { peer -> (peer as? String)?.let(::PeerId) }.orEmpty() }
        }.toMap()
        val sources = preferences.mapNotNull { (key, value) ->
            key.removePrefix("received_from:").takeIf { key.startsWith("received_from:") }
                ?.let { id -> id to (value as? String)?.let(::PeerId) }
        }.toMap()
        return preferences.values.flatMap(::decodeTelegrams).map { entry ->
            entry.copy(
                receivedFrom = entry.receivedFrom ?: sources[entry.telegram.id],
                deliveredTo = (entry.deliveredTo + receipts[entry.telegram.id].orEmpty()).distinct(),
            )
        }
    }

    private fun decodeTelegrams(raw: Any?): List<LegacyTelegram> = when (raw) {
        is String -> TelegramCodec.decode(raw.toByteArray())?.let { listOf(LegacyTelegram(it, null, emptyList())) }
            ?: runCatching { json.parseToJsonElement(raw) }.getOrNull()?.let(::extractTelegrams).orEmpty()
        is Set<*> -> raw.flatMap(::decodeTelegrams)
        else -> emptyList()
    }

    /** Accepts both the old bare telegram list and ledger-entry wrappers with local state. */
    private fun extractTelegrams(element: JsonElement): List<LegacyTelegram> = when (element) {
        is JsonArray -> element.flatMap(::extractTelegrams)
        is JsonObject -> {
            val telegramElement = element["telegram"] ?: element
            val telegram = runCatching { json.decodeFromJsonElement(Telegram.serializer(), telegramElement) }.getOrNull()
            if (telegram != null) {
                val receivedFrom = string(element["receivedFrom"] ?: element["received_from"])?.let(::PeerId)
                val deliveredTo = peers(element["deliveredTo"] ?: element["delivered_to"])
                listOf(LegacyTelegram(telegram, receivedFrom, deliveredTo))
            } else {
                element.values.flatMap(::extractTelegrams)
            }
        }
        else -> emptyList()
    }

    private fun string(element: JsonElement?): String? = (element as? JsonPrimitive)?.contentOrNull
    private fun peers(element: JsonElement?): List<PeerId> = (element as? JsonArray).orEmpty()
        .mapNotNull(::string)
        .map(::PeerId)

    private fun insertTelegram(db: SQLiteDatabase, telegram: Telegram, receivedFrom: PeerId?) {
        db.insertWithOnConflict("telegram", null, ContentValues().apply {
            put("id", telegram.id)
            put("telegram_json", TelegramCodec.encode(telegram).toString(Charsets.UTF_8))
            put("received_from", receivedFrom?.value)
            put("created_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    private fun insertDelivery(db: SQLiteDatabase, telegramId: String, peer: PeerId) {
        db.insertWithOnConflict("delivery", null, ContentValues().apply {
            put("telegram_id", telegramId)
            put("peer_id", peer.value)
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    private data class LegacyTelegram(val telegram: Telegram, val receivedFrom: PeerId?, val deliveredTo: List<PeerId>)

    private fun legacyPreferenceNames(): List<String> = (
        LEGACY_PREFERENCES + File(context.applicationInfo.dataDir, "shared_prefs").listFiles()
            .orEmpty()
            .mapNotNull { file -> file.name.removeSuffix(".xml").takeIf { file.name.endsWith(".xml") } }
        ).distinct()

    @Serializable private data class LegacyContact(val name: String, val phone: String, val relationship: String = "")
    @Serializable private data class LegacyProfile(
        val userId: String = "", val fullName: String = "", val docType: String = "CC", val docNumber: String = "",
        val birthDate: String = "", val bloodType: String = "O", val bloodRh: String = "POSITIVE",
        val allergies: List<String> = emptyList(), val chronicConditions: List<String> = emptyList(),
        val medications: List<String> = emptyList(), val disability: String = "NONE", val isPregnant: Boolean = false,
        val weightKg: Int? = null, val eps: String? = null, val emergencyContacts: List<LegacyContact> = emptyList(),
        val questionId: String = "", val answerHash: String = "", val deviceSecret: String? = null,
    ) {
        fun toDomain(): Profile? = runCatching {
            if (userId.isBlank() || fullName.isBlank() || docNumber.isBlank() || birthDate.isBlank() || questionId.isBlank() || answerHash.isBlank()) return null
            val secret = deviceSecret?.takeIf(String::isNotBlank) ?: randomSecret()
            Profile(userId, fullName, DocType.valueOf(docType), docNumber, birthDate, BloodType.valueOf(bloodType),
                BloodRh.valueOf(bloodRh), allergies, chronicConditions, medications, Disability.valueOf(disability),
                isPregnant, weightKg, eps, emergencyContacts.map { EmergencyContact(it.name, it.phone, it.relationship) },
                questionId, answerHash.lowercase(), secret)
        }.getOrNull()
    }

    private companion object {
        const val MARKER = "shared_preferences_to_sqlite_v1"
        val LEGACY_PREFERENCES = listOf("ziro_relay_profile", "ziro_profile", "ziro_relay_ledger", "ziro_ledger")
        val PROFILE_KEYS = listOf("profile", "profile_json")
        fun randomSecret(): String = ByteArray(32).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
    }
}
