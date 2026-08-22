package com.ziro.relay.application

import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.RejectReason
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.RelayPolicy
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.Signer
import com.ziro.relay.ports.TelegramLedger
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The single entry point for anything arriving from the radio.
 *
 * The ORDER of these checks is part of the contract, not an implementation detail:
 * parse, version, field sanity, signature, then dedup, then mutate, then store, then
 * announce. Verify BEFORE dedup so a forged telegram can never occupy an id and lock
 * the real one out.
 */
class IngestTelegram(
    private val ledger: TelegramLedger,
    private val signer: Signer,
    private val bus: EventBus,
    /** MVP accepts unsigned telegrams. Flip to false once HMAC lands on both sides. */
    private val allowUnsigned: Boolean = true,
) {

    /**
     * One global mutex, not one per id.
     *
     * kotlinx Mutex.withLock(owner) does NOT give per-key locking - the owner argument
     * is only used for ownership tracking. Serialising the whole ingest pipeline is the
     * honest implementation, and at telegram volumes it costs nothing. Calling it a
     * "lock per id" would have been a lie.
     */
    private val mutex = Mutex()

    suspend fun handle(raw: ByteArray, from: PeerId): IngestResult {
        val incoming = TelegramCodec.decode(raw)
            ?: return reject(RejectReason.MALFORMED, from)

        if (!RelayPolicy.isSupportedVersion(incoming)) {
            return reject(RejectReason.UNSUPPORTED_VERSION, from)
        }
        if (!RelayPolicy.isValid(incoming)) {
            return reject(RejectReason.INVALID_FIELDS, from)
        }
        if (!isSignatureAcceptable(incoming)) {
            return reject(RejectReason.BAD_SIGNATURE, from)
        }

        return mutex.withLock {
            if (ledger.has(incoming.id)) {
                // Silent drop by design. A duplicate is the protocol working, not a fault.
                return@withLock reject(RejectReason.DUPLICATE, from)
            }
            val stored = RelayPolicy.onIngest(incoming)
                ?: return@withLock reject(RejectReason.EXPIRED, from)

            ledger.put(stored, from)
            ledger.markDelivered(stored.id, from)
            bus.emit(RelayEvent.TelegramReceived(stored, from))
            IngestResult.Accepted(stored)
        }
    }

    private fun isSignatureAcceptable(t: Telegram): Boolean = when {
        t.hmac != null -> signer.verify(t)
        else -> allowUnsigned
    }

    private fun reject(reason: RejectReason, from: PeerId): IngestResult {
        bus.emit(RelayEvent.TelegramRejected(reason, from))
        return IngestResult.Rejected(reason)
    }
}

sealed interface IngestResult {
    data class Accepted(val telegram: Telegram) : IngestResult
    data class Rejected(val reason: RejectReason) : IngestResult
}
