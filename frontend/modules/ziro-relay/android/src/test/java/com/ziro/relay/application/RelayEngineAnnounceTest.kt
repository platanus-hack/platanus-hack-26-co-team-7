package com.ziro.relay.application

import com.ziro.relay.adapters.crypto.HmacSha256Signer
import com.ziro.relay.adapters.ledger.InMemoryLedger
import com.ziro.relay.adapters.profile.HardcodedProfileStore
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.PresenceSchedule
import com.ziro.relay.domain.RelayEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The behaviour the demo depends on: MEETING someone is what makes this device speak.
 *
 * Two phones that connect and exchange nothing look identical to two phones whose radio is
 * broken, and that is the bug these guard. The repeats matter just as much - a person
 * trapped for an hour should still be on the mesh, without drowning it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RelayEngineAnnounceTest {

    private val bus = RecordingBus()
    private val ledger = InMemoryLedger()
    private val transport = RecordingTransport()
    private val signer = HmacSha256Signer()
    private val gps = FakeLocationSource(GeoPoint(lat = 4.60, lng = -74.08))
    private var clock = 1_787_440_000L

    private fun engine(scope: CoroutineScope) = RelayEngine(
        transport = transport,
        bus = bus,
        forwardPending = ForwardPending(ledger, transport),
        ledger = ledger,
        scope = scope,
        announcePresence = AnnouncePresence(
            sendTelegram = SendTelegram(
                ledger, transport, signer, StubProfileStore(HardcodedProfileStore.DEMO_PROFILE),
                ORIGIN, now = { clock },
            ),
            location = gps,
            bus = bus,
            minIntervalSeconds = 0,
            now = { clock },
        ),
        location = gps,
        schedule = PresenceSchedule(),
    )

    /** Connect a peer the way the transport would, then let the engine react. */
    private suspend fun connect(relay: RelayEngine, peer: PeerId) {
        transport.connect(peer)
        bus.emit(RelayEvent.PeerConnected(peer))
    }

    @Test
    fun `starting the radio alone says nothing`() = runTest(StandardTestDispatcher()) {
        engine(backgroundScope).start()
        runCurrent()

        // Nobody is there. Announcing into an empty room only burns battery.
        assertEquals(0, ledger.count())
        assertTrue(transport.started)
        assertTrue(gps.tracking)
    }

    @Test
    fun `meeting a peer announces immediately`() = runTest(StandardTestDispatcher()) {
        val relay = engine(backgroundScope)
        relay.start()
        runCurrent()

        connect(relay, PEER)
        runCurrent()

        assertEquals(1, ledger.count())
        assertEquals(GeoPoint(lat = 4.60, lng = -74.08), ledger.all().single().location)
    }

    @Test
    fun `the repeats back off and carry the position of that moment`() =
        runTest(StandardTestDispatcher()) {
            val relay = engine(backgroundScope)
            relay.start()
            runCurrent()
            connect(relay, PEER)
            runCurrent()

            gps.fix = GeoPoint(lat = 4.71, lng = -74.15)
            advanceTimeBy(181_000)   // 3 min -> second announce
            runCurrent()
            assertEquals(2, ledger.count())

            advanceTimeBy(181_000)   // 3 more min is NOT enough: the gap doubled to 6
            runCurrent()
            assertEquals(2, ledger.count())

            advanceTimeBy(181_000)   // now past 6 min -> third announce
            runCurrent()
            assertEquals(3, ledger.count())

            val newest = ledger.all().first { it.location.lat == 4.71 }
            assertEquals(GeoPoint(lat = 4.71, lng = -74.15), newest.location)
        }

    @Test
    fun `a second peer joining does not restart the ladder`() = runTest(StandardTestDispatcher()) {
        val relay = engine(backgroundScope)
        relay.start()
        runCurrent()
        connect(relay, PEER)
        runCurrent()

        connect(relay, PeerId("peer-two"))
        runCurrent()

        // One announce, not two: ForwardPending already handed the newcomer everything.
        assertEquals(1, ledger.count())
    }

    @Test
    fun `losing everyone stops the heartbeat`() = runTest(StandardTestDispatcher()) {
        val relay = engine(backgroundScope)
        relay.start()
        runCurrent()
        connect(relay, PEER)
        runCurrent()

        transport.disconnect(PEER)
        bus.emit(RelayEvent.PeerDisconnected(PEER))
        runCurrent()
        advanceTimeBy(3_600_000)
        runCurrent()

        assertEquals(1, ledger.count())
    }

    @Test
    fun `editing the profile announces at once instead of waiting out the ladder`() =
        runTest(StandardTestDispatcher()) {
            val relay = engine(backgroundScope)
            relay.start()
            runCurrent()
            connect(relay, PEER)
            runCurrent()

            relay.onProfileChanged()
            runCurrent()

            assertEquals(2, ledger.count())
        }

    @Test
    fun `stopping releases the location radio`() = runTest(StandardTestDispatcher()) {
        val relay = engine(backgroundScope)
        relay.start()
        runCurrent()

        relay.stop()
        runCurrent()

        assertFalse(gps.tracking)
    }

    private companion object {
        const val ORIGIN = "d4f8a2b1"
        val PEER = PeerId("peer-online")
    }
}
