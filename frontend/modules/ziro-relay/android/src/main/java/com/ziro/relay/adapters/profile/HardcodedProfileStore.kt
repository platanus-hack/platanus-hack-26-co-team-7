package com.ziro.relay.adapters.profile

import com.ziro.relay.domain.BloodRh
import com.ziro.relay.domain.BloodType
import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.DocType
import com.ziro.relay.domain.EmergencyContact
import com.ziro.relay.domain.Profile
import com.ziro.relay.ports.ProfileStore

/**
 * MVP profile: one hardcoded person. Owner: developer B (it feeds the Settings screen).
 *
 * Onboarding is phase 5. What matters now is that the shape is final, so the telegram
 * that goes on the wire in the demo carries the same vital block a real profile would.
 *
 * Note which fields never leave this object: docNumber, eps, emergencyContacts and
 * deviceSecret are not part of VitalBlock and must not be added to it. The backend
 * already holds them from onboarding, keyed by userId.
 */
class HardcodedProfileStore : ProfileStore {

    private var profile: Profile = DEMO_PROFILE

    override suspend fun get(): Profile = profile

    override suspend fun save(profile: Profile) {
        this.profile = profile
    }

    companion object {
        val DEMO_PROFILE = Profile(
            userId = "USER123",
            fullName = "Juan Perez",
            docType = DocType.CC,
            docNumber = "1020304050",
            birthDate = "1991-03-14",
            bloodType = BloodType.O,
            bloodRh = BloodRh.POSITIVE,
            allergies = listOf("penicilina"),
            chronicConditions = listOf("diabetes"),
            medications = listOf("warfarina"),
            disability = Disability.NONE,
            isPregnant = false,
            weightKg = 78,
            eps = "Sanitas",
            emergencyContacts = listOf(
                EmergencyContact(name = "Ana Perez", phone = "+57...", relationship = "madre"),
            ),
            questionId = "PET_NAME_42",
            // SHA-256 placeholder. Real onboarding hashes the answer on device.
            answerHash = "0000000000000000000000000000000000000000000000000000000000000000",
            deviceSecret = "device-secret-not-used-in-mvp",
        )
    }
}
