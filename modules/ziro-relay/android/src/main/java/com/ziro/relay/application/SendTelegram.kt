package com.ziro.relay.application

import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.domain.toVerifyBlock
import com.ziro.relay.domain.toVitalBlock
import com.ziro.relay.ports.PeerTransport
import com.ziro.relay.ports.ProfileStore
import com.ziro.relay.ports.Signer
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
        location: GeoPoint,
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

        val telegram = unsigned.copy(hmac = signer.sign(unsigned))

        // hop stays 0 here: the origin has not travelled anywhere. The first receiver is
        // the one that moves it to 1. See RelayPolicy.
        ledger.put(telegram, receivedFrom = null)
        transport.broadcast(TelegramCodec.encode(telegram))

        return telegram
    }

    private companion object {
        const val ANONYMOUS_USER = "ANON"
    }
}
