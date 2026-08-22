package com.ziro.relay.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class PresenceScheduleTest {

    @Test
    fun `the gap doubles so a stable situation stops crowding the mesh`() {
        val schedule = PresenceSchedule()

        val minutes = (1..6).map { schedule.nextDelaySeconds() / 60 }

        assertEquals(listOf(3L, 6L, 12L, 24L, 48L, 60L), minutes)
    }

    @Test
    fun `the ladder settles at the ceiling instead of overflowing`() {
        val schedule = PresenceSchedule()

        repeat(40) { schedule.nextDelaySeconds() }

        assertEquals(PresenceSchedule.MAX_DELAY_SECONDS, schedule.nextDelaySeconds())
    }

    @Test
    fun `a real change starts the ladder over`() {
        val schedule = PresenceSchedule()
        repeat(4) { schedule.nextDelaySeconds() }

        schedule.reset()

        assertEquals(PresenceSchedule.FIRST_DELAY_SECONDS, schedule.nextDelaySeconds())
    }
}
