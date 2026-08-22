package com.ziro.relay.adapters.profile

import android.content.ContentValues
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.domain.BloodRh
import com.ziro.relay.domain.BloodType
import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.DocType
import com.ziro.relay.domain.EmergencyContact
import com.ziro.relay.domain.Profile
import com.ziro.relay.ports.ProfileStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** SQLite-backed private profile store. The database is deliberately unencrypted in this MVP. */
class SqliteProfileStore(private val database: RelayDatabase) : ProfileStore {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    override suspend fun get(): Profile? = database.readableDatabase.query(
        "profile", arrayOf("profile_json"), "id = 1", null, null, null, null,
    ).use { cursor ->
        if (!cursor.moveToFirst()) null
        else runCatching { json.decodeFromString(PersistedProfile.serializer(), cursor.getString(0)).toDomain() }.getOrNull()
    }

    override suspend fun save(profile: Profile) {
        val values = ContentValues().apply {
            put("id", 1)
            put("profile_json", json.encodeToString(PersistedProfile.serializer(), PersistedProfile.from(profile)))
        }
        database.writableDatabase.insertWithOnConflict("profile", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Serializable private data class PersistedContact(val name: String, val phone: String, val relationship: String)
    @Serializable private data class PersistedProfile(
        val userId: String, val fullName: String, val docType: String, val docNumber: String, val birthDate: String,
        val bloodType: String, val bloodRh: String, val allergies: List<String>, val chronicConditions: List<String>,
        val medications: List<String>, val disability: String, val isPregnant: Boolean, val weightKg: Int? = null,
        val eps: String? = null, val emergencyContacts: List<PersistedContact>, val questionId: String,
        val answerHash: String, val deviceSecret: String,
    ) {
        fun toDomain() = Profile(userId, fullName, DocType.valueOf(docType), docNumber, birthDate,
            BloodType.valueOf(bloodType), BloodRh.valueOf(bloodRh), allergies, chronicConditions, medications,
            Disability.valueOf(disability), isPregnant, weightKg, eps,
            emergencyContacts.map { EmergencyContact(it.name, it.phone, it.relationship) }, questionId, answerHash, deviceSecret)
        companion object {
            fun from(profile: Profile) = PersistedProfile(profile.userId, profile.fullName, profile.docType.name,
                profile.docNumber, profile.birthDate, profile.bloodType.name, profile.bloodRh.name, profile.allergies,
                profile.chronicConditions, profile.medications, profile.disability.name, profile.isPregnant, profile.weightKg,
                profile.eps, profile.emergencyContacts.map { PersistedContact(it.name, it.phone, it.relationship) },
                profile.questionId, profile.answerHash, profile.deviceSecret)
        }
    }
}
