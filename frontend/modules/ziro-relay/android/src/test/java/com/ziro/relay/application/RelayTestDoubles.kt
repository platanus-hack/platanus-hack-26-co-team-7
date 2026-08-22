package com.ziro.relay.application

import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.Profile
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.LocationSource
import com.ziro.relay.ports.PeerTransport
import com.ziro.relay.ports.ProfileStore
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/** Shared doubles for the application-layer tests. Kept out of main so they never ship. */

internal class RecordingBus : EventBus {
    private val _events = MutableSharedFlow<RelayEvent>(extraBufferCapacity = 64)
    override val events: SharedFlow<RelayEvent> = _events.asSharedFlow()
    val emitted = mutableListOf<RelayEvent>()
    override fun emit(event: RelayEvent) {
        emitted += event
        _events.tryEmit(event)
    }
}

internal class RecordingTransport : PeerTransport {
    private val _peers = MutableStateFlow<Set<PeerId>>(emptySet())
    override val peers: StateFlow<Set<PeerId>> = _peers.asStateFlow()
    val broadcasts = mutableListOf<ByteArray>()
    val sent = mutableListOf<Pair<PeerId, ByteArray>>()
    var started = false
        private set
    /** Ordered interaction log. The announce must reach the radio before it comes up. */
    val calls = mutableListOf<String>()

    fun connect(peer: PeerId) {
        _peers.value = _peers.value + peer
    }

    fun disconnect(peer: PeerId) {
        _peers.value = _peers.value - peer
    }

    override fun start() {
        started = true
        calls += "start"
    }

    override fun stop() {
        started = false
        calls += "stop"
    }

    override fun send(peer: PeerId, bytes: ByteArray) {
        sent += peer to bytes
        calls += "send"
    }

    override fun broadcast(bytes: ByteArray) {
        broadcasts += bytes
        calls += "broadcast"
        _peers.value.forEach { sent += it to bytes }
    }
}

internal class StubProfileStore(private val profile: Profile?) : ProfileStore {
    override suspend fun get(): Profile? = profile
    override suspend fun save(profile: Profile) = Unit
}

internal class ExplodingProfileStore : ProfileStore {
    override suspend fun get(): Profile = throw IllegalStateException("profile storage is unavailable")
    override suspend fun save(profile: Profile) = Unit
}

/** A position the test controls, plus a record of whether tracking was bracketed. */
internal class FakeLocationSource(var fix: GeoPoint? = null) : LocationSource {
    var tracking = false
        private set

    override fun current(): GeoPoint? = fix
    override fun start() { tracking = true }
    override fun stop() { tracking = false }
}
