package com.ziro.relay.application

import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.RelayPolicy
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.ports.PeerTransport
import com.ziro.relay.ports.TelegramLedger

/**
 * Store-and-forward: when a peer appears, hand it everything it has not seen.
 *
 * Forwarding is VERBATIM. The stored telegram was already mutated once on ingest, so
 * re-encoding the stored object reproduces the same payload and the signature survives
 * the hop. Mutating again here would double-count hop and invalidate the HMAC.
 *
 * TelegramLedger.pendingFor applies the backpressure rule, so a peer that disconnects
 * and reappears never receives the same id twice.
 */
class ForwardPending(
    private val ledger: TelegramLedger,
    private val transport: PeerTransport,
) {

    suspend operator fun invoke(peer: PeerId): Int {
        val pending = ledger.pendingFor(peer).filter(RelayPolicy::shouldForward)
        for (telegram in pending) {
            transport.send(peer, TelegramCodec.encode(telegram))
            ledger.markDelivered(telegram.id, peer)
        }
        return pending.size
    }
}
