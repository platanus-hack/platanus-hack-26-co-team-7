package com.ziro.relay.adapters.fake

import com.ziro.relay.application.IngestTelegram
import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.PeerTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * In-process loopback radio. Owner: developer B.
 *
 * This is the piece that makes the two-person split actually work. Because it speaks
 * the same PeerTransport interface as the Nearby adapter, B can exercise the FULL
 * pipeline - encode, transmit, decode, verify, dedup, store, render - on a single phone,
 * in an emulator, or inside a Compose preview. No second device, no code from A.
 *
 * It is also the fastest diagnostic in the project:
 *   works here + fails on Nearby  -> the radio is the problem (A)
 *   fails here                    -> the logic is the problem (B)
 *
 * Anything sent through it is delivered back to this same node, so a "sent" telegram
 * arrives as if a peer had relayed it.
 */
class FakeTransport(
    private val bus: EventBus,
    private val scope: CoroutineScope,
    /** Set once IngestTelegram exists; kept nullable so this compiles from hour one. */
    var ingest: IngestTelegram? = null,
    private val latencyMillis: Long = 400,
) : PeerTransport {

    private val _peers = MutableStateFlow<Set<PeerId>>(emptySet())
    override val peers: StateFlow<Set<PeerId>> = _peers.asStateFlow()

    override fun start() {
        scope.launch {
            delay(latencyMillis)
            bus.emit(RelayEvent.PeerDiscovered(FAKE_PEER))
            delay(latencyMillis)
            _peers.value = setOf(FAKE_PEER)
            bus.emit(RelayEvent.PeerConnected(FAKE_PEER))
        }
    }

    override fun stop() {
        _peers.value = emptySet()
        bus.emit(RelayEvent.PeerDisconnected(FAKE_PEER))
    }

    override fun send(peer: PeerId, bytes: ByteArray) {
        scope.launch {
            delay(latencyMillis)
            bus.emit(RelayEvent.TelegramSent(id = "loopback", to = peer))
            ingest?.handle(bytes, FAKE_PEER)
        }
    }

    override fun broadcast(bytes: ByteArray) {
        _peers.value.forEach { send(it, bytes) }
    }

    /**
     * Inject a telegram as if a peer had just relayed it. This is the one B reaches for
     * while building the UI: it produces a genuine ingest, so hop, dedup and the
     * received card are all exercised for real.
     *
     * Note that send() also loops back, but a telegram this node just originated is
     * already in the ledger, so it comes back as DUPLICATE. That is dedup working, and
     * it is worth watching once - it is not what you want for filling a list.
     */
    fun simulateIncoming(bytes: ByteArray) {
        scope.launch {
            delay(latencyMillis)
            ingest?.handle(bytes, FAKE_PEER)
        }
    }

    /** Force a disconnect / reconnect cycle to exercise the backpressure rule. */
    fun simulateReconnect() {
        stop()
        start()
    }

    companion object {
        val FAKE_PEER = PeerId("fake-peer-01")
    }
}
