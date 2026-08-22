package com.ziro.relay.adapters.fake

import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.VerifyBlock
import com.ziro.relay.domain.VitalBlock
import java.util.UUID

/**
 * Realistic sample telegrams. Owner: developer B.
 *
 * Not throwaway code: a Compose @Preview cannot run a radio, so fake data is not a
 * shortcut, it is the only way to preview a screen at all. Keeping it behind one object
 * means the fake values live in a single place instead of being scattered across the UI.
 */
object FakeTelegrams {

    private val BOGOTA = GeoPoint(lat = 4.6097, lng = -74.0817)

    fun sample(
        id: String = UUID.randomUUID().toString(),
        userId: String = "USER123",
        status: PersonStatus = PersonStatus.EMERGENCY,
        severity: Int = 3,
        hop: Int = 0,
        withVital: Boolean = true,
    ): Telegram = Telegram(
        id = id,
        userId = userId,
        eventId = "EARTHQUAKE001",
        event = EventType.EARTHQUAKE,
        status = status,
        severity = severity,
        location = BOGOTA,
        timestamp = 1787440000L,
        hop = hop,
        ttl = Telegram.DEFAULT_TTL - hop,
        origin = "d4f8a2b1",
        vital = if (withVital) SAMPLE_VITAL else null,
        verify = VerifyBlock(questionId = "PET_NAME_42", answerHash = "abc123def456"),
        hmac = null,
    )

    /** A batch, so empty states, scrolling and ordering can all be exercised. */
    fun batch(size: Int = 5): List<Telegram> = List(size) { index ->
        sample(
            userId = "USER${100 + index}",
            status = PERSON_STATES[index % PERSON_STATES.size],
            severity = 1 + (index % 5),
            hop = index % 4,
        )
    }

    private val PERSON_STATES = listOf(
        PersonStatus.EMERGENCY,
        PersonStatus.NEED_HELP,
        PersonStatus.SAFE,
    )

    private val SAMPLE_VITAL = VitalBlock(
        name = "Juan Perez",
        age = 35,
        blood = "O+",
        allergies = listOf("penicilina"),
        conditions = listOf("diabetes"),
        medications = listOf("warfarina"),
        disability = Disability.NONE,
        pregnant = false,
    )
}
