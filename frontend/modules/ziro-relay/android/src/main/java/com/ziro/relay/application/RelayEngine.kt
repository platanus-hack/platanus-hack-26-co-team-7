package com.ziro.relay.application

import com.ziro.relay.domain.EngineStatus
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.PeerTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The node state machine. Owner: developer A, because it drives the radio.
 *
 * Developer B never calls into this beyond start/stop and never mutates it - B only
 * collects [status]. That single StateFlow is the entire interface between the engine
 * and the UI, which is exactly what the earlier plan was missing: the state machine had
 * no home and no owner, while both developers needed it.
 *
 * The MVP only exercises IDLE and ADVERTISING. SYNCING, RELAY and ORPHAN are wired here
 * but their timers land in phase 5 - the UI already renders all five from day one.
 */
class RelayEngine(
    private val transport: PeerTransport,
    private val bus: EventBus,
    private val forwardPending: ForwardPending,
    private val scope: CoroutineScope,
) {

    private val _status = MutableStateFlow(EngineStatus.IDLE)
    val status: StateFlow<EngineStatus> = _status.asStateFlow()

    fun start() {
        transition(EngineStatus.ADVERTISING)
        transport.start()
        scope.launch { observeRadio() }
    }

    fun stop() {
        transport.stop()
        transition(EngineStatus.IDLE)
    }

    private suspend fun observeRadio() {
        bus.events.collect { event ->
            when (event) {
                is RelayEvent.PeerConnected -> {
                    transition(EngineStatus.SYNCING)
                    forwardPending(event.peer)
                }

                is RelayEvent.PeerDisconnected -> {
                    val next = if (transport.peers.value.isEmpty()) {
                        EngineStatus.RELAY
                    } else {
                        EngineStatus.SYNCING
                    }
                    transition(next)
                }

                // Observable state, not a transition trigger.
                is RelayEvent.PeerDiscovered,
                is RelayEvent.TelegramReceived,
                is RelayEvent.TelegramSent,
                is RelayEvent.TelegramRejected,
                is RelayEvent.StatusChanged,
                is RelayEvent.RadioError -> Unit
            }
        }
    }

    private fun transition(next: EngineStatus) {
        if (_status.value == next) return
        _status.value = next
        bus.emit(RelayEvent.StatusChanged(next))
    }
}
