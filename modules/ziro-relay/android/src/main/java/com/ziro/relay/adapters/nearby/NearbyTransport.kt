package com.ziro.relay.adapters.nearby

import android.content.Context
import com.ziro.relay.application.IngestTelegram
import com.ziro.relay.domain.PeerId
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.PeerTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * SCAFFOLD - developer A implements this in phase 2. Owner: developer A.
 *
 * The only place in the codebase allowed to mention Nearby Connections. Everything above
 * PeerTransport stays unaware that this class exists, which is what lets B build the
 * whole receive path against FakeTransport while this file is still empty.
 *
 * Things worth knowing before starting (each one has cost someone hours):
 *
 * - serviceId is "ziro.relay.v1" and Strategy is P2P_STAR. See openspec/communication.md.
 *
 * - Nearby does NOT work on an emulator. There is no virtual Bluetooth or Wi-Fi Direct.
 *   Two physical phones or nothing.
 *
 * - Bluetooth AND Wi-Fi must be ON. BLE handles discovery, Wi-Fi Direct handles the data
 *   channel. Airplane mode turns both off, so re-enable them by hand after enabling it.
 *
 * - Both devices advertise and discover at the same time, so both may call
 *   requestConnection on each other and collide. Tie-break: only the endpoint with the
 *   lexicographically smaller id initiates. See shouldInitiateTo below.
 *
 * - Android 12+ needs BLUETOOTH_SCAN / ADVERTISE / CONNECT granted at RUNTIME, not just
 *   declared in the manifest. Android 13+ adds NEARBY_WIFI_DEVICES.
 *
 * - onPayloadReceived hands you raw bytes. Pass them to IngestTelegram unchanged. Do not
 *   parse and re-encode: the HMAC is computed over a canonical form and re-serialising
 *   is how signatures die.
 */
class NearbyTransport(
    private val context: Context,
    private val bus: EventBus,
    private val scope: CoroutineScope,
    private val localEndpointName: String,
    var ingest: IngestTelegram? = null,
) : PeerTransport {

    private val _peers = MutableStateFlow<Set<PeerId>>(emptySet())
    override val peers: StateFlow<Set<PeerId>> = _peers.asStateFlow()

    override fun start() {
        // TODO(A, phase 2): startAdvertising(SERVICE_ID, localEndpointName, ...) with
        //  AdvertisingOptions(Strategy.P2P_STAR), then startDiscovery with the matching
        //  DiscoveryOptions. Emit RelayEvent.RadioError on failure so the UI can show it.
        TODO("phase 2: Nearby advertising + discovery")
    }

    override fun stop() {
        // TODO(A, phase 2): stopAdvertising, stopDiscovery, stopAllEndpoints.
        TODO("phase 2: tear down Nearby")
    }

    override fun send(peer: PeerId, bytes: ByteArray) {
        // TODO(A, phase 3): sendPayload(peer.value, Payload.fromBytes(bytes)) and emit
        //  RelayEvent.TelegramSent on success.
        TODO("phase 3: sendPayload")
    }

    override fun broadcast(bytes: ByteArray) {
        _peers.value.forEach { send(it, bytes) }
    }

    /**
     * Symmetric connection collision guard.
     *
     * With both sides advertising and discovering, A finds B at the same moment B finds
     * A, and both call requestConnection. Nearby survives it but you end up with
     * rejected or duplicated connections that look like flaky hardware. Deterministic
     * tie-break: only the smaller endpoint name initiates.
     */
    internal fun shouldInitiateTo(remoteEndpointName: String): Boolean =
        localEndpointName < remoteEndpointName

    companion object {
        const val SERVICE_ID = "ziro.relay.v1"
    }
}
