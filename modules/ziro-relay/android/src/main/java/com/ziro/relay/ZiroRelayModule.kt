package com.ziro.relay

import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * THE BRIDGE. Owner: developer A. This is the only file both developers read together.
 *
 * ── The design rule that makes the hybrid split work ──
 *
 * The engine is FAT and lives entirely in Kotlin. JavaScript is a viewer and a commander,
 * never a participant in the relay path.
 *
 * That is not a style preference. React Native's JS thread is not reliably alive when the
 * app is backgrounded, but a foreground service is. If deduplication, HMAC verification or
 * the ledger lived in JS, every telegram arriving while the screen was off would be lost —
 * which is precisely the situation ZIRO exists for. So receive, verify, dedup, store and
 * forward all happen below this line, and JS finds out afterwards.
 *
 * ── The rule that keeps the contract cheap ──
 *
 * The bridge speaks the SAME JSON as the radio. A telegram crosses this boundary as the
 * exact wire string produced by TelegramCodec, so there is no second hand-maintained
 * mapping to WritableMap and no way for the two representations to drift. The TypeScript
 * type in src/ZiroRelay.types.ts mirrors protocol.md directly.
 *
 * ── Keep this surface small ──
 *
 * Five functions and one event. Every addition here is a line that has to be kept in sync
 * by hand in TypeScript, with no compiler watching. If something can be computed in JS
 * from a telegram that already crossed, do it in JS.
 */
class ZiroRelayModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json { encodeDefaults = true; explicitNulls = false }

    override fun definition() = ModuleDefinition {
        Name("ZiroRelay")

        Events(EVENT_RELAY)

        OnCreate {
            appContext.reactContext?.let { RelayContainer.attach(it) }
            observeEngine()
        }

        /** Current node status without waiting for an event. Used on mount. */
        Function("getStatus") {
            RelayContainer.engine.status.value.name
        }

        Function("getOriginHash") {
            RelayContainer.originHash
        }

        AsyncFunction("start") {
            RelayContainer.engine.start()
        }

        AsyncFunction("stop") {
            RelayContainer.engine.stop()
        }

        /** Returns the created telegram as a wire JSON string. */
        AsyncFunction("sendTelegram") { eventId: String, lat: Double, lng: Double, severity: Int ->
            val telegram = RelayContainer.sendTelegram(
                eventId = eventId,
                location = GeoPoint(lat = lat, lng = lng),
                event = EventType.EARTHQUAKE,
                status = PersonStatus.EMERGENCY,
                severity = severity,
            )
            wire(telegram)
        }

        /** The whole local ledger as a JSON array of telegrams. Newest first. */
        AsyncFunction("getLedger") {
            json.encodeToString(
                ListSerializer(Telegram.serializer()),
                RelayContainer.ledger.all(),
            )
        }
    }

    /**
     * Translates domain events into the single JS event. Runs for the life of the process,
     * not the life of a screen, so nothing is missed while JS is asleep — the ledger is
     * always the source of truth and getLedger() reconciles on mount.
     */
    private fun observeEngine() {
        scope.launch {
            RelayContainer.bus.events.collect { event ->
                sendEvent(EVENT_RELAY, event.toJsPayload())
            }
        }
    }

    private fun RelayEvent.toJsPayload(): Map<String, Any?> = when (this) {
        is RelayEvent.PeerDiscovered ->
            mapOf("type" to "PEER_DISCOVERED", "peerId" to peer.value)

        is RelayEvent.PeerConnected ->
            mapOf("type" to "PEER_CONNECTED", "peerId" to peer.value)

        is RelayEvent.PeerDisconnected ->
            mapOf("type" to "PEER_DISCONNECTED", "peerId" to peer.value)

        is RelayEvent.TelegramReceived -> mapOf(
            "type" to "TELEGRAM_RECEIVED",
            "peerId" to from.value,
            "telegram" to wire(telegram),
        )

        is RelayEvent.TelegramSent ->
            mapOf("type" to "TELEGRAM_SENT", "peerId" to to.value, "telegramId" to id)

        is RelayEvent.TelegramRejected ->
            mapOf("type" to "TELEGRAM_REJECTED", "peerId" to from.value, "reason" to reason.name)

        is RelayEvent.StatusChanged ->
            mapOf("type" to "STATUS_CHANGED", "status" to status.name)

        is RelayEvent.RadioError ->
            mapOf("type" to "RADIO_ERROR", "message" to message)
    }

    private fun wire(telegram: Telegram): String =
        TelegramCodec.encode(telegram).toString(Charsets.UTF_8)

    private companion object {
        const val EVENT_RELAY = "onRelayEvent"
    }
}
