package com.ziro.relay.adapters.profile

import android.content.ContentValues
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.domain.BloodRh
import com.ziro.relay.domain.BloodType
import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.DocType
import com.ziro.relay.domain.EmergencyContact
import com.ziro.relay.domain.Profile
import com.ziro.relay.domain.protectLegacyAnswerHash
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
        else runCatching {
            val persisted = json.decodeFromString(PersistedProfile.serializer(), cursor.getString(0))
            persisted.toDomain().also { profile ->
                if (persisted.answerHashVersion < ANSWER_HASH_VERSION) write(database, profile)
            }
        }.getOrNull()
    }

    override suspend fun save(profile: Profile) {
        write(database, profile)
    }

    @Serializable private data class PersistedContact(val name: String, val phone: String, val relationship: String)
    @Serializable private data class PersistedProfile(
        val userId: String, val fullName: String, val docType: String, val docNumber: String, val birthDate: String,
        val bloodType: String, val bloodRh: String, val allergies: List<String>, val chronicConditions: List<String>,
        val medications: List<String>, val disability: String, val isPregnant: Boolean, val weightKg: Int? = null,
        val eps: String? = null, val emergencyContacts: List<PersistedContact>, val questionId: String,
        val answerHash: String, val deviceSecret: String, val answerHashVersion: Int = 1,
    ) {
        fun toDomain() = Profile(userId, fullName, DocType.valueOf(docType), docNumber, birthDate,
            BloodType.valueOf(bloodType), BloodRh.valueOf(bloodRh), allergies, chronicConditions, medications,
            Disability.valueOf(disability), isPregnant, weightKg, eps,
            emergencyContacts.map { EmergencyContact(it.name, it.phone, it.relationship) }, questionId,
            if (answerHashVersion >= ANSWER_HASH_VERSION) answerHash else protectLegacyAnswerHash(deviceSecret, answerHash),
            deviceSecret)
        companion object {
            fun from(profile: Profile) = PersistedProfile(profile.userId, profile.fullName, profile.docType.name,
                profile.docNumber, profile.birthDate, profile.bloodType.name, profile.bloodRh.name, profile.allergies,
                profile.chronicConditions, profile.medications, profile.disability.name, profile.isPregnant, profile.weightKg,
                profile.eps, profile.emergencyContacts.map { PersistedContact(it.name, it.phone, it.relationship) },
                profile.questionId, profile.answerHash, profile.deviceSecret, ANSWER_HASH_VERSION)
        }
    }

    companion object {
        private const val ANSWER_HASH_VERSION = 2

        internal fun write(database: RelayDatabase, profile: Profile) {
            val values = ContentValues().apply {
                put("id", 1)
                put("profile_json", Json { encodeDefaults = true }.encodeToString(PersistedProfile.serializer(), PersistedProfile.from(profile)))
            }
            database.writableDatabase.insertWithOnConflict("profile", null, values, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE)
        }
    }
}
