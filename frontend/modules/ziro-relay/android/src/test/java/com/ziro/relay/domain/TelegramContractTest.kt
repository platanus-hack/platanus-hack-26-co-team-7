package com.ziro.relay.domain

import com.ziro.relay.adapters.crypto.HmacSha256Signer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the two contract invariants that are expensive to discover on a phone at 4am.
 *
 * Runs on the JVM in milliseconds because domain has no Android dependencies. Both
 * developers should run this before pushing anything that touches domain or ports.
 */
class TelegramContractTest {

    private val signer = HmacSha256Signer()

    private fun telegram(hop: Int = 0, ttl: Int = 8) = Telegram(
        id = "a8f29c3f-7b9e-4a1d-8e2f-1c5b9d6e3f4a",
        userId = "USER123",
        eventId = "EARTHQUAKE001",
        event = EventType.EARTHQUAKE,
        status = PersonStatus.EMERGENCY,
        severity = 3,
        location = GeoPoint(lat = 4.6097, lng = -74.0817),
        timestamp = 1787440000L,
        hop = hop,
        ttl = ttl,
        origin = "d4f8a2b1",
        vital = VitalBlock(name = "Juan Perez", age = 35, blood = "O+"),
    )

    @Test
    fun `signature survives every hop`() {
        // THE invariant. If canonical ever includes hop or ttl, this fails and the demo
        // would have failed instead - silently, as a "radio problem".
        val origin = telegram().let { it.copy(hmac = signer.sign(it)) }

        var current = origin
        repeat(7) {
            current = RelayPolicy.onIngest(current)!!
            assertTrue("signature broke at hop ${current.hop}", signer.verify(current))
        }
        assertEquals(7, current.hop)
        assertEquals(1, current.ttl)
    }

    @Test
    fun `tampering with vital data breaks the signature`() {
        val signed = telegram().let { it.copy(hmac = signer.sign(it)) }
        val tampered = signed.copy(vital = signed.vital?.copy(blood = "AB-"))

        assertFalse(signer.verify(tampered))
    }

    @Test
    fun `allergy order does not change the signature`() {
        val a = telegram().let {
            it.copy(vital = it.vital?.copy(allergies = listOf("penicilina", "latex")))
        }
        val b = a.copy(vital = a.vital?.copy(allergies = listOf("latex", "penicilina")))

        assertEquals(
            Canonical.of(a).toString(Charsets.UTF_8),
            Canonical.of(b).toString(Charsets.UTF_8),
        )
    }

    @Test
    fun `canonical ignores hop and ttl but not the rest`() {
        val base = telegram()
        assertEquals(
            Canonical.of(base).toString(Charsets.UTF_8),
            Canonical.of(base.copy(hop = 5, ttl = 3)).toString(Charsets.UTF_8),
        )
        assertNotEquals(
            Canonical.of(base).toString(Charsets.UTF_8),
            Canonical.of(base.copy(severity = 5)).toString(Charsets.UTF_8),
        )
    }

    @Test
    fun `hop increments once per ingest and dies at ttl zero`() {
        // Expected MVP checkpoint result: sender emits hop 0, receiver stores hop 1.
        val received = RelayPolicy.onIngest(telegram(hop = 0, ttl = 8))!!
        assertEquals(1, received.hop)
        assertEquals(7, received.ttl)

        assertNull(RelayPolicy.onIngest(telegram(hop = 8, ttl = 0)))
    }

    @Test
    fun `round trip through the wire format preserves the telegram`() {
        val signed = telegram().let { it.copy(hmac = signer.sign(it)) }
        val decoded = TelegramCodec.decode(TelegramCodec.encode(signed))

        assertEquals(signed, decoded)
        assertTrue(signer.verify(decoded!!))
    }

    @Test
    fun `profile only exposes triage fields to the wire`() {
        val vital = com.ziro.relay.adapters.profile.HardcodedProfileStore.DEMO_PROFILE
            .toVitalBlock(java.time.LocalDate.of(2026, 8, 22))

        assertEquals("Juan Perez", vital.name)
        assertEquals("O+", vital.blood)
        assertEquals(35, vital.age)
        // There is no field on VitalBlock for these, and there must not be one:
        // docNumber, eps, emergencyContacts, deviceSecret.
    }
}
