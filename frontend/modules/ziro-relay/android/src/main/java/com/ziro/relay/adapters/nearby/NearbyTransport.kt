package com.ziro.relay.adapters.nearby

import android.content.Context
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import com.ziro.relay.application.IngestTelegram
import com.ziro.relay.application.IngestResult
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
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap

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
    private val ingest: IngestTelegram,
) : PeerTransport {

    private val _peers = MutableStateFlow<Set<PeerId>>(emptySet())
    override val peers: StateFlow<Set<PeerId>> = _peers.asStateFlow()
    private val client = Nearby.getConnectionsClient(context.applicationContext)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val endpointNames = ConcurrentHashMap<String, String>()
    private val pending = ConcurrentHashMap<String, ByteArray>()
    @Volatile private var running = false

    override fun start() {
        if (running) return
        running = true
        try {
            client.startAdvertising(localEndpointName, SERVICE_ID, lifecycleCallback,
                AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
                .addOnFailureListener { radioError("Advertising failed: ${it.message ?: "unknown error"}") }
            client.startDiscovery(SERVICE_ID, discoveryCallback,
                DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
                .addOnFailureListener { radioError("Discovery failed: ${it.message ?: "unknown error"}") }
        } catch (error: SecurityException) {
            radioError("Nearby permissions are missing: ${error.message ?: "security exception"}")
        }
    }

    override fun stop() {
        running = false
        pending.clear()
        endpointNames.clear()
        _peers.value = emptySet()
        try {
            client.stopAdvertising()
            client.stopDiscovery()
            client.stopAllEndpoints()
        } catch (error: SecurityException) {
            radioError("Unable to stop Nearby: ${error.message ?: "security exception"}")
        }
    }

    override fun send(peer: PeerId, bytes: ByteArray) {
        val messageId = telegramId(bytes) ?: return radioError("Refusing malformed outbound telegram")
        val envelope = encode(WireEnvelope.telegram(messageId, bytes.toString(Charsets.UTF_8)))
        val key = deliveryKey(peer, messageId)
        pending[key] = envelope
        sendEnvelope(peer, messageId, envelope, attempt = 0)
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

    private val discoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            endpointNames[endpointId] = info.endpointName
            bus.emit(RelayEvent.PeerDiscovered(PeerId(endpointId)))
            if (shouldInitiateTo(info.endpointName)) {
                requestConnection(endpointId)
            }
        }

        override fun onEndpointLost(endpointId: String) {
            endpointNames.remove(endpointId)
        }
    }

    private val lifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            endpointNames[endpointId] = info.endpointName
            try {
                client.acceptConnection(endpointId, payloadCallback)
                    .addOnFailureListener { radioError("Accepting connection failed: ${it.message ?: "unknown error"}") }
            } catch (error: SecurityException) {
                radioError("Unable to accept Nearby connection: ${error.message ?: "security exception"}")
            }
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            if (resolution.status.statusCode == CommonStatusCodes.SUCCESS) {
                val peer = PeerId(endpointId)
                _peers.value = _peers.value + peer
                bus.emit(RelayEvent.PeerConnected(peer))
            } else {
                radioError("Connection rejected: ${resolution.status.statusMessage ?: resolution.status.statusCode}")
            }
        }

        override fun onDisconnected(endpointId: String) {
            val peer = PeerId(endpointId)
            if (peer in _peers.value) {
                _peers.value = _peers.value - peer
                bus.emit(RelayEvent.PeerDisconnected(peer))
            }
            endpointNames.remove(endpointId)
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            val envelope = decode(bytes) ?: return radioError("Received malformed relay envelope")
            val peer = PeerId(endpointId)
            when (envelope.kind) {
                WireEnvelope.KIND_ACK -> {
                    val id = envelope.messageId
                    pending.remove(deliveryKey(peer, id))
                    bus.emit(RelayEvent.TelegramDelivered(id, peer))
                }
                WireEnvelope.KIND_TELEGRAM -> {
                    val wire = envelope.telegram ?: return radioError("Received empty telegram envelope")
                    scope.launch {
                        when (val result = ingest.handle(wire.toByteArray(Charsets.UTF_8), peer)) {
                            is IngestResult.Accepted -> sendAck(peer, envelope.messageId)
                            is IngestResult.Rejected -> if (result.reason == com.ziro.relay.domain.RejectReason.DUPLICATE) {
                                sendAck(peer, envelope.messageId)
                            }
                        }
                    }
                }
                else -> radioError("Received unknown relay envelope")
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
    }

    private fun requestConnection(endpointId: String) {
        try {
            client.requestConnection(localEndpointName, endpointId, lifecycleCallback)
                .addOnFailureListener { radioError("Connection request failed: ${it.message ?: "unknown error"}") }
        } catch (error: SecurityException) {
            radioError("Unable to request Nearby connection: ${error.message ?: "security exception"}")
        }
    }

    private fun sendEnvelope(peer: PeerId, messageId: String, envelope: ByteArray, attempt: Int) {
        if (!running || peer !in _peers.value) return
        try {
            client.sendPayload(peer.value, Payload.fromBytes(envelope))
                .addOnSuccessListener {
                    bus.emit(RelayEvent.TelegramSent(messageId, peer))
                    if (attempt < MAX_RETRIES) {
                        scope.launch {
                            delay(RETRY_DELAY_MS)
                            val key = deliveryKey(peer, messageId)
                            pending[key]?.let { sendEnvelope(peer, messageId, it, attempt + 1) }
                        }
                    }
                }
                .addOnFailureListener { radioError("Payload send failed: ${it.message ?: "unknown error"}") }
        } catch (error: SecurityException) {
            radioError("Unable to send Nearby payload: ${error.message ?: "security exception"}")
        }
    }

    private fun sendAck(peer: PeerId, messageId: String) {
        if (peer !in _peers.value) return
        try {
            client.sendPayload(peer.value, Payload.fromBytes(encode(WireEnvelope.ack(messageId))))
        } catch (error: SecurityException) {
            radioError("Unable to acknowledge telegram: ${error.message ?: "security exception"}")
        }
    }

    private fun telegramId(bytes: ByteArray): String? = runCatching {
        com.ziro.relay.domain.TelegramCodec.decode(bytes)?.id
    }.getOrNull()

    private fun encode(envelope: WireEnvelope): ByteArray = json.encodeToString(WireEnvelope.serializer(), envelope).toByteArray()
    private fun decode(bytes: ByteArray): WireEnvelope? = runCatching {
        json.decodeFromString(WireEnvelope.serializer(), bytes.toString(Charsets.UTF_8))
    }.getOrNull()
    private fun deliveryKey(peer: PeerId, messageId: String): String = "${peer.value}:$messageId"
    private fun radioError(message: String) = bus.emit(RelayEvent.RadioError(message))

    companion object {
        const val SERVICE_ID = "ziro.relay.v1"
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 2_000L
    }
}

@Serializable
private data class WireEnvelope(
    val v: Int = 1,
    val kind: String,
    val messageId: String,
    val telegram: String? = null,
) {
    companion object {
        const val KIND_TELEGRAM = "telegram"
        const val KIND_ACK = "ack"
        fun telegram(messageId: String, wire: String) = WireEnvelope(kind = KIND_TELEGRAM, messageId = messageId, telegram = wire)
        fun ack(messageId: String) = WireEnvelope(kind = KIND_ACK, messageId = messageId)
    }
}
