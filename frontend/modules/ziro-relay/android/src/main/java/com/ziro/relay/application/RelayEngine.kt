package com.ziro.relay.application

import com.ziro.relay.domain.EngineStatus
import com.ziro.relay.domain.PresenceSchedule
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.RelayPolicy
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.LocationSource
import com.ziro.relay.ports.PeerTransport
import com.ziro.relay.ports.TelegramLedger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The node state machine. Owner: developer A, because it drives the radio.
 *
 * Developer B never calls into this beyond start/stop and never mutates it - B only
 * collects [status]. That single StateFlow is the entire interface between the engine
 * and the UI.
 *
 * The engine also owns the PRESENCE HEARTBEAT. Meeting a peer is what triggers this
 * device to describe itself, and the repeats that follow back off on a doubling ladder -
 * see [PresenceSchedule]. That logic lives here rather than in the transport because it
 * is a decision about the node, not about the radio.
 */
class RelayEngine(
    private val transport: PeerTransport,
    private val bus: EventBus,
    private val forwardPending: ForwardPending,
    private val ledger: TelegramLedger,
    private val scope: CoroutineScope,
    private val announcePresence: AnnouncePresence,
    private val location: LocationSource,
    private val schedule: PresenceSchedule = PresenceSchedule(),
) {

    private val _status = MutableStateFlow(EngineStatus.IDLE)
    val status: StateFlow<EngineStatus> = _status.asStateFlow()
    private var observer: Job? = null
    private var heartbeat: Job? = null
    private var orphanJob: Job? = null

    fun start() {
        if (observer?.isActive == true) return
        observer = scope.launch { observeRadio() }
        // Tracking begins with the radio so the first telegram already carries a fix
        // rather than the stale cache of whatever app last asked for a position.
        location.start()
        transition(EngineStatus.ADVERTISING)
        transport.start()
    }

    fun stop() {
        cancelOrphanTimeout()
        stopHeartbeat()
        location.stop()
        transport.stop()
        observer?.cancel()
        observer = null
        transition(EngineStatus.IDLE)
    }

    /**
     * The person edited their profile, so the ladder no longer describes reality.
     *
     * Back to the bottom rung and announce at once - a changed medical block or status is
     * exactly the update the mesh should not sit on for another 48 minutes.
     */
    fun onProfileChanged() {
        if (transport.peers.value.isEmpty()) return
        stopHeartbeat()
        startHeartbeat(force = true)
    }

    private suspend fun observeRadio() {
        bus.events.collect { event ->
            when (event) {
                is RelayEvent.PeerConnected -> {
                    cancelOrphanTimeout()
                    transition(EngineStatus.SYNCING)
                    forwardPending(event.peer)
                    startHeartbeat()
                }

                is RelayEvent.TelegramReceived -> {
                    // Immediate forward to all connected peers except the sender.
                    // The stored telegram was already mutated (hop+1, ttl-1) by IngestTelegram,
                    // so re-encoding it produces the correct relay payload with the signature intact.
                    val peers = transport.peers.value - event.from
                    if (peers.isNotEmpty() && RelayPolicy.shouldForward(event.telegram)) {
                        val wire = TelegramCodec.encode(event.telegram)
                        for (peer in peers) {
                            transport.send(peer, wire)
                        }
                    }
                }

                is RelayEvent.TelegramDelivered -> ledger.markDelivered(event.id, event.to)

                is RelayEvent.PeerDisconnected -> {
                    val alone = transport.peers.value.isEmpty()
                    if (alone) {
                        stopHeartbeat()
                        transition(EngineStatus.RELAY)
                        scheduleOrphanTimeout()
                    } else {
                        transition(EngineStatus.SYNCING)
                    }
                }

                is RelayEvent.PeerDiscovered,
                is RelayEvent.TelegramSent,
                is RelayEvent.TelegramRejected,
                is RelayEvent.StatusChanged,
                is RelayEvent.RadioError -> Unit
            }
        }
    }

    private fun scheduleOrphanTimeout() {
        orphanJob?.cancel()
        orphanJob = scope.launch {
            delay(ORPHAN_TIMEOUT_MS)
            if (transport.peers.value.isEmpty()) {
                transition(EngineStatus.ORPHAN)
            }
        }
    }

    private fun cancelOrphanTimeout() {
        orphanJob?.cancel()
        orphanJob = null
    }

    /**
     * Announce now, then keep announcing on a widening gap for as long as anyone is there.
     *
     * A second peer joining an existing mesh does NOT restart the ladder: it already has a
     * running heartbeat to listen to, and ForwardPending hands it every telegram this node
     * is carrying the moment it connects.
     */
    private fun startHeartbeat(force: Boolean = false) {
        if (heartbeat?.isActive == true) return
        schedule.reset()
        heartbeat = scope.launch {
            announcePresence(force = force)
            while (isActive) {
                delay(schedule.nextDelaySeconds() * MILLIS_PER_SECOND)
                // Alone again: nothing to announce to, and stop() will have cancelled us.
                if (transport.peers.value.isEmpty()) break
                announcePresence()
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeat?.cancel()
        heartbeat = null
    }

    private fun transition(next: EngineStatus) {
        if (_status.value == next) return
        _status.value = next
        bus.emit(RelayEvent.StatusChanged(next))
    }

    private companion object {
        const val MILLIS_PER_SECOND = 1_000L
        const val ORPHAN_TIMEOUT_MS = 120_000L
    }
}
