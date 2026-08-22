package com.ziro.relay.domain

/**
 * How often this node repeats its presence telegram while it stays on the mesh.
 *
 * The first announce is immediate — the moment a peer appears is the moment help becomes
 * possible, and it is also the moment a fresh GPS fix is worth the most. After that the
 * gap DOUBLES: 3, 6, 12, 24, 48 minutes, then once an hour forever.
 *
 * Backing off matters more here than in an ordinary heartbeat. Every repeat is a new row
 * in the ledger of every phone within range, and those phones forward it onward — a fixed
 * interval would turn one trapped person into a slow flood that crowds out everyone else's
 * telegrams. Someone whose situation has not changed in an hour is, sadly, the person
 * whose next update carries the least new information.
 *
 * [reset] is what a real change looks like: edit the profile and the ladder starts over
 * from immediate, because now there IS something new to say.
 *
 * Pure logic, no clock and no coroutines: the caller owns the waiting, this only answers
 * "how long until the next one".
 */
class PresenceSchedule(
    private val firstDelaySeconds: Long = FIRST_DELAY_SECONDS,
    private val maxDelaySeconds: Long = MAX_DELAY_SECONDS,
) {

    private var step = 0

    /** Seconds to wait before the next announce. Advances the ladder by one rung. */
    fun nextDelaySeconds(): Long {
        val delay = (firstDelaySeconds shl step).coerceAtMost(maxDelaySeconds)
        // Stop climbing once the ceiling is reached, or `shl` eventually overflows.
        if (delay < maxDelaySeconds) step++
        return delay
    }

    /** Back to the bottom rung. Call when the situation actually changed. */
    fun reset() {
        step = 0
    }

    companion object {
        const val FIRST_DELAY_SECONDS = 180L
        const val MAX_DELAY_SECONDS = 3_600L
    }
}
