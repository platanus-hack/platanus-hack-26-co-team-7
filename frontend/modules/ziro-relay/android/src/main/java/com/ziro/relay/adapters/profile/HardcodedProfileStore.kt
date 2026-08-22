package com.ziro.relay.adapters.profile

import com.ziro.relay.domain.BloodRh
import com.ziro.relay.domain.BloodType
import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.DocType
import com.ziro.relay.domain.EmergencyContact
import com.ziro.relay.domain.Profile

/** Test fixture only. Production wiring uses [SqliteProfileStore]. */
object HardcodedProfileStore {
    val DEMO_PROFILE = Profile(
        userId = "USER123", fullName = "Juan Perez", docType = DocType.CC, docNumber = "1020304050",
        birthDate = "1991-03-14", bloodType = BloodType.O, bloodRh = BloodRh.POSITIVE,
        allergies = listOf("penicillin"), chronicConditions = listOf("diabetes"), medications = listOf("warfarin"),
        disability = Disability.NONE, isPregnant = false, weightKg = 78, eps = "Sanitas",
        emergencyContacts = listOf(EmergencyContact("Ana Perez", "+570000000", "mother")),
        questionId = "PET_NAME_42", answerHash = "0".repeat(64), deviceSecret = "test-only-device-secret",
    )
}
