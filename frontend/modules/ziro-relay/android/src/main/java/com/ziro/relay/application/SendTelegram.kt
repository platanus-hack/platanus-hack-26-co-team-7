package com.ziro.relay.application

import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.RelayEnvelopeCodec
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.domain.toVerifyBlock
import com.ziro.relay.domain.toVitalBlock
import com.ziro.relay.domain.VerifyBlock
import com.ziro.relay.ports.PeerTransport
import com.ziro.relay.ports.ProfileStore
import com.ziro.relay.ports.Signer
import com.ziro.relay.adapters.crypto.KeystoreDeviceSigner
import com.ziro.relay.ports.TelegramLedger
import java.time.LocalDate
import java.util.UUID

/**
 * Creates a telegram originated by THIS device, signs it, stores it, broadcasts it.
 *
 * It is stored locally before being sent on purpose: this node is now a carrier of its
 * own telegram, so if the radio finds nobody right now the message still gets relayed
 * when a peer appears later. Store-and-forward starts at the origin.
 */
class SendTelegram(
    private val ledger: TelegramLedger,
    private val transport: PeerTransport,
    private val signer: Signer,
    private val profiles: ProfileStore,
    private val originHash: String,
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
    private val today: () -> LocalDate = { LocalDate.now() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {

    suspend operator fun invoke(
        eventId: String,
        location: GeoPoint? = null,
        event: EventType = EventType.EARTHQUAKE,
        status: PersonStatus = PersonStatus.EMERGENCY,
        severity: Int = Telegram.DEFAULT_SEVERITY,
    ): Telegram {
        val profile = profiles.get()

        val unsigned = Telegram(
            id = newId(),
            userId = profile?.userId ?: ANONYMOUS_USER,
            eventId = eventId,
            event = event,
            status = status,
            severity = severity,
            location = location,
            timestamp = now(),
            origin = originHash,
            vital = profile?.toVitalBlock(today()),
            verify = profile?.toVerifyBlock(),
        )

        val deviceSigner = signer as? KeystoreDeviceSigner
            ?: error("The active signer must provide a device identity")
        val signable = unsigned.copy(keyId = deviceSigner.keyId, publicKey = deviceSigner.publicKey)
        val telegram = signable.copy(signature = signer.sign(signable))

        val wire = TelegramCodec.encode(telegram)
        require(RelayEnvelopeCodec.telegram(telegram.id, wire.toString(Charsets.UTF_8)).size <= RelayEnvelopeCodec.MAX_BYTES) {
            "Telegram exceeds the 24 KiB Nearby payload limit. Remove medical list entries and try again."
        }

        // hop stays 0 here: the origin has not travelled anywhere. The first receiver is
        // the one that moves it to 1. See RelayPolicy.
        ledger.put(telegram, receivedFrom = null)
        transport.broadcast(wire)

        return telegram
    }

    /**
     * A nearby helper can answer a received person's SAFE challenge. The target's identity
     * remains in the telegram, while the helper's registered device signs the response.
     */
    suspend fun safeResponse(received: Telegram, answerHash: String): Telegram {
        require(received.verify != null) { "This telegram has no SAFE verification question." }
        require(answerHash.matches(Regex("[a-f0-9]{64}"))) { "SAFE answer is invalid." }
        val deviceSigner = signer as? KeystoreDeviceSigner
            ?: error("The active signer must provide a device identity")
        val unsigned = Telegram(
            id = newId(), userId = received.userId, eventId = received.eventId, event = received.event,
            status = PersonStatus.SAFE, severity = received.severity, location = received.location,
            timestamp = now(), origin = originHash, vital = null,
            verify = VerifyBlock(received.verify.questionId, answerHash),
            keyId = deviceSigner.keyId, publicKey = deviceSigner.publicKey,
        )
        val telegram = unsigned.copy(signature = signer.sign(unsigned))
        val wire = TelegramCodec.encode(telegram)
        require(RelayEnvelopeCodec.telegram(telegram.id, wire.toString(Charsets.UTF_8)).size <= RelayEnvelopeCodec.MAX_BYTES) {
            "SAFE response exceeds the 24 KiB Nearby payload limit."
        }
        ledger.put(telegram, receivedFrom = null)
        transport.broadcast(wire)
        return telegram
    }

    private companion object {
        const val ANONYMOUS_USER = "ANON"
    }
}
