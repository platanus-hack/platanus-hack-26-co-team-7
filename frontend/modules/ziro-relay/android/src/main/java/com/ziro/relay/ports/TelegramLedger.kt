package com.ziro.relay.ports

import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.Telegram
import kotlinx.coroutines.flow.Flow

data class LedgerLocalState(val receivedFrom: PeerId?, val deliveredTo: Set<PeerId>)

/**
 * PORT — the memory of this node.
 *
 * The distinction that matters: a telegram is what the ORIGIN said. This ledger is what
 * THIS node knows. Fields like "when did it arrive here", "which peer brought it" and
 * "did I already hand it to that peer" exist only here and must never enter a telegram
 * — if they travelled, every node would be asserting facts about other nodes' state.
 *
 * The production adapter is durable SQLite storage. Nothing above this interface depends on
 * the storage mechanism.
 */
interface TelegramLedger {

    suspend fun has(id: String): Boolean

    /**
     * Stores a telegram. Returns false when the id was already known, which is the
     * deduplication rule and the heart of the protocol.
     */
    suspend fun put(telegram: Telegram, receivedFrom: PeerId?): Boolean

    suspend fun get(id: String): Telegram?

    suspend fun all(): List<Telegram>

    /** Local-only metadata for UI status; it must never be added to a telegram. */
    suspend fun localState(id: String): LedgerLocalState?

    /** Observable view for the UI. Emits a new list on every accepted telegram. */
    fun stream(): Flow<List<Telegram>>

    /** Backpressure rule: record that this id was handed to this peer. */
    suspend fun markDelivered(id: String, peer: PeerId)

    suspend fun wasDeliveredTo(id: String, peer: PeerId): Boolean

    /** Telegrams still worth relaying to [peer]: alive, and not yet delivered to it. */
    suspend fun pendingFor(peer: PeerId): List<Telegram>

    suspend fun count(): Int
}
