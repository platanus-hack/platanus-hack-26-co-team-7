package com.ziro.relay.ports

import com.ziro.relay.domain.PeerId
import kotlinx.coroutines.flow.StateFlow

/**
 * PORT — the radio, as the rest of the app sees it.
 *
 * Nothing above this interface knows the word "Nearby". Two implementations exist:
 * NearbyTransport (real, developer A) and FakeTransport (in-process loopback,
 * developer B). Because the fake speaks the same interface, B can exercise the FULL
 * ingest pipeline — decode, verify, dedup, store, render — without a second phone.
 *
 * That is also the diagnostic: if a flow works over FakeTransport and fails over
 * NearbyTransport, the bug is in the radio, not in the logic.
 */
interface PeerTransport {

    /** Peers currently connected. The UI binds a counter straight to this. */
    val peers: StateFlow<Set<PeerId>>

    fun start()

    fun stop()

    /** Fire and forget. Delivery is best effort, as in any infrastructure-free network. */
    fun send(peer: PeerId, bytes: ByteArray)

    /** Send to every currently connected peer. */
    fun broadcast(bytes: ByteArray)
}
