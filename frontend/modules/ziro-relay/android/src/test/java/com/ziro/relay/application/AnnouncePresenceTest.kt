package com.ziro.relay.application

import com.ziro.relay.adapters.crypto.HmacSha256Signer
import com.ziro.relay.adapters.ledger.InMemoryLedger
import com.ziro.relay.adapters.profile.HardcodedProfileStore
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.Profile
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.ports.ProfileStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Activating the relay must put a telegram in the ledger. Everything downstream —
 * broadcast to live peers, store-and-forward to peers that appear later — already works
 * and is driven entirely off that one row. Without it the mesh connects and stays silent,
 * which is indistinguishable from a broken radio.
 */
class AnnouncePresenceTest {

    private val bus = RecordingBus()
    private val ledger = InMemoryLedger()
    private val transport = RecordingTransport()
    private val signer = HmacSha256Signer()

    private var clock = 1_787_440_000L

    private fun announcePresence(
        profiles: ProfileStore = StubProfileStore(HardcodedProfileStore.DEMO_PROFILE),
        location: FakeLocationSource = FakeLocationSource(),
    ) = AnnouncePresence(
        sendTelegram = SendTelegram(ledger, transport, signer, profiles, ORIGIN, now = { clock }),
        location = location,
        bus = bus,
        now = { clock },
    )

    @Test
    fun `carries the saved profile so the receiver sees who is asking for help`() = runTest {
        val telegram = announcePresence().invoke()

        assertNotNull(telegram)
        assertEquals(HardcodedProfileStore.DEMO_PROFILE.userId, telegram!!.userId)
        assertEquals("Juan Perez", telegram.vital?.name)
        assertEquals(PersonStatus.EMERGENCY, telegram.status)
        assertEquals(EventType.EARTHQUAKE, telegram.event)
        assertTrue(signer.verify(telegram))
    }

    @Test
    fun `stores the telegram so a peer connecting later still receives it`() = runTest {
        val telegram = announcePresence().invoke()!!

        // Store-and-forward: pendingFor is what ForwardPending reads on PEER_CONNECTED.
        assertEquals(listOf(telegram.id), ledger.pendingFor(PeerId("later-peer")).map { it.id })
    }

    @Test
    fun `broadcasts immediately to peers that are already connected`() = runTest {
        transport.connect(PeerId("peer-online"))

        announcePresence().invoke()

        assertEquals(1, transport.broadcasts.size)
    }

    @Test
    fun `uses the platform fix when the device knows where it is`() = runTest {
        val fix = GeoPoint(lat = 6.2442, lng = -75.5812)

        val telegram = announcePresence(location = FakeLocationSource(fix)).invoke()!!

        assertEquals(fix, telegram.location)
    }

    @Test
    fun `falls back to a known location rather than refusing to announce`() = runTest {
        val telegram = announcePresence(location = FakeLocationSource()).invoke()!!

        assertEquals(AnnouncePresence.FALLBACK_LOCATION, telegram.location)
    }

    @Test
    fun `announces anonymously when onboarding never happened`() = runTest {
        val telegram = announcePresence(profiles = StubProfileStore(null)).invoke()

        assertNotNull(telegram)
        assertNull(telegram!!.vital)
    }

    @Test
    fun `a failed announce never takes the radio down with it`() = runTest {
        val telegram = announcePresence(profiles = ExplodingProfileStore()).invoke()

        assertNull(telegram)
        assertTrue(bus.emitted.any { it is RelayEvent.RadioError })
    }

    @Test
    fun `a link that flaps twice in a minute announces once`() = runTest {
        val announce = announcePresence()

        val first = announce()
        clock += AnnouncePresence.MIN_INTERVAL_SECONDS - 1
        val duringFlap = announce()

        assertNotNull(first)
        assertNull(duringFlap)
        assertEquals(1, ledger.count())
    }

    @Test
    fun `a changed profile overrides the flap guard`() = runTest {
        val announce = announcePresence()

        announce()
        clock += 1
        val forced = announce(force = true)

        assertNotNull(forced)
        assertEquals(2, ledger.count())
    }

    @Test
    fun `each announce reads the position again`() = runTest {
        val gps = FakeLocationSource(GeoPoint(lat = 4.60, lng = -74.08))
        val announce = announcePresence(location = gps)

        val first = announce()!!
        gps.fix = GeoPoint(lat = 4.71, lng = -74.15)
        clock += AnnouncePresence.MIN_INTERVAL_SECONDS
        val second = announce()!!

        assertEquals(GeoPoint(lat = 4.60, lng = -74.08), first.location)
        assertEquals(GeoPoint(lat = 4.71, lng = -74.15), second.location)
    }

    private companion object {
        const val ORIGIN = "d4f8a2b1"
    }
}
