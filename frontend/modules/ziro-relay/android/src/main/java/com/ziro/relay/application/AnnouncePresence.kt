package com.ziro.relay.application

import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.Telegram
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.LocationSource
import com.ziro.relay.adapters.emergency.ActiveEmergency

/**
 * Meeting someone IS the moment to ask for help.
 *
 * Before this existed, connecting did nothing: two phones found each other, shook hands,
 * and exchanged silence, because store-and-forward is driven entirely by what the ledger
 * holds and the ledger stayed empty until someone filled in the create form. A connected
 * mesh with an empty ledger is indistinguishable from a broken radio.
 *
 * The telegram is built AT THE MOMENT OF CONTACT, not earlier. That ordering is the whole
 * value: [location] is read right then, so the coordinates describe where this person is
 * when a rescuer could actually reach them, not where they were when they opened the app.
 *
 * [SendTelegram] does the rest, all of it pre-existing: sign, store locally, broadcast to
 * everyone connected. Peers that appear later pick the same row up through ForwardPending.
 * One telegram, both delivery paths, no new protocol.
 *
 * This NEVER throws. A profile store that fails, a missing fix, an oversized medical block
 * — none of them may take the radio down, because a node that relays other people's
 * telegrams is still useful even when it cannot describe itself.
 */
class AnnouncePresence(
    private val sendTelegram: SendTelegram,
    private val location: LocationSource,
    private val bus: EventBus,
    private val activeEmergency: () -> ActiveEmergency?,
    private val fallbackLocation: GeoPoint = FALLBACK_LOCATION,
    private val minIntervalSeconds: Long = MIN_INTERVAL_SECONDS,
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
) {

    private var lastAnnouncedAt: Long? = null

    /**
     * Creates and sends one presence telegram.
     *
     * @param force skips the flap guard. Used when the profile changed, because then there
     *   genuinely is something new to say and the usual "too soon" rule should not apply.
     * @return the telegram, or null when it was suppressed or failed.
     */
    suspend operator fun invoke(force: Boolean = false): Telegram? {
        // A Bluetooth link that drops and re-forms twice in a minute is normal. Without
        // this guard each flap would mint another near-identical row of the same person.
        val previous = lastAnnouncedAt
        if (!force && previous != null && now() - previous < minIntervalSeconds) return null
        return announce()?.also { lastAnnouncedAt = now() }
    }

    private suspend fun announce(): Telegram? = runCatching {
        val emergency = activeEmergency() ?: return null
        sendTelegram(
            eventId = emergency.eventId,
            location = location.current() ?: fallbackLocation,
            event = emergency.eventType,
            status = PersonStatus.EMERGENCY,
        )
    }.onFailure { error ->
        bus.emit(
            RelayEvent.RadioError(
                "Connected, but this device could not announce itself: ${error.message ?: "unknown error"}. " +
                    "Incoming telegrams are still being relayed.",
            ),
        )
    }.getOrNull()

    companion object {
        /** Used only when no provider has ever produced a fix. Bogota city centre. */
        val FALLBACK_LOCATION = GeoPoint(lat = 4.6097, lng = -74.0817)

        /** Flap guard. A link that drops and re-forms inside this window announces once. */
        const val MIN_INTERVAL_SECONDS = 60L
    }
}
