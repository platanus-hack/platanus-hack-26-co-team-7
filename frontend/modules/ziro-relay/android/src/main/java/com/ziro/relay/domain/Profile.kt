package com.ziro.relay.domain

import java.time.LocalDate
import java.time.Period
import java.time.format.DateTimeParseException
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The owner of this phone, captured during onboarding, before any event.
 *
 * This NEVER leaves the device. Not serializable on purpose: there is no wire
 * representation of a Profile, and there should not be one. The only thing that
 * crosses the mesh is the subset returned by [toVitalBlock].
 */
data class Profile(
    val userId: String,
    val fullName: String,
    val docType: DocType,
    val docNumber: String,
    /** ISO-8601, e.g. "1991-03-14". Stored instead of age so it never goes stale. */
    val birthDate: String,
    val bloodType: BloodType,
    val bloodRh: BloodRh,
    val allergies: List<String> = emptyList(),
    val chronicConditions: List<String> = emptyList(),
    val medications: List<String> = emptyList(),
    val disability: Disability = Disability.NONE,
    val isPregnant: Boolean = false,
    val weightKg: Int? = null,
    /** Colombian health provider. Needed for hospital admission, not for triage. */
    val eps: String? = null,
    val emergencyContacts: List<EmergencyContact> = emptyList(),
    val questionId: String,
    /** Keyed digest of the expected answer. The plaintext and key never leave this device. */
    val answerHash: String,
    /** HMAC key. Never leaves this device, never enters a telegram. */
    val deviceSecret: String,
) {
    val blood: String get() = "${bloodType.name}${bloodRh.symbol}"

    fun ageOn(today: LocalDate): Int? = try {
        Period.between(LocalDate.parse(birthDate), today).years
    } catch (e: DateTimeParseException) {
        null
    }
}

data class EmergencyContact(
    val name: String,
    val phone: String,
    val relationship: String,
)

enum class DocType { CC, TI, CE, PA, NIT }

enum class BloodType { A, B, AB, O }

enum class BloodRh(val symbol: String) {
    POSITIVE("+"),
    NEGATIVE("-"),
}

/**
 * The privacy boundary of ZIRO, expressed as code.
 *
 * Everything this function copies travels through every relay in plaintext (SQLite is
 * unencrypted in the MVP). Everything it omits stays here. Before adding a field,
 * answer one question: does a rescuer without Internet need it to act in the next ten
 * minutes? If not, it does not belong in a telegram.
 *
 * Deliberately omitted: docType, docNumber, eps, emergencyContacts, deviceSecret.
 */
fun Profile.toVitalBlock(today: LocalDate): VitalBlock = VitalBlock(
    name = fullName,
    age = ageOn(today),
    blood = blood,
    allergies = allergies,
    conditions = chronicConditions,
    medications = medications,
    disability = disability,
    pregnant = isPregnant,
)

fun Profile.toVerifyBlock(): VerifyBlock = VerifyBlock(
    questionId = questionId,
    answerHash = answerHash,
)

/**
 * The relay wire keeps its existing `answer_hash` field, but that value must not be usable as
 * an offline oracle for a short answer. The device secret is random per profile and stays local.
 */
fun identityAnswerHash(deviceSecret: String, answer: String): String =
    hmacSha256(deviceSecret, sha256(answer))

/** Wraps pre-keyed legacy answer hashes without recovering or exposing their plaintext. */
fun protectLegacyAnswerHash(deviceSecret: String, legacyAnswerHash: String): String =
    hmacSha256(deviceSecret, legacyAnswerHash)

private fun sha256(value: String): String = java.security.MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

private fun hmacSha256(secret: String, value: String): String = Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    doFinal(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
