package com.ziro.relay.adapters.ledger

import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.RelayPolicy
import com.ziro.relay.domain.Telegram
import com.ziro.relay.ports.TelegramLedger
import com.ziro.relay.ports.LedgerLocalState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * MVP ledger. Owner: developer B. Everything lives in memory and dies with the process.
 *
 * That is a deliberate scope cut, not laziness: the MVP checkpoint is a card appearing
 * on the other phone, and Room plus KSP costs an hour that phase 3 does not have. Phase
 * 5 adds RoomLedger and swaps one line in ZiroApp - nothing above this port changes,
 * which is the entire reason the port exists.
 *
 * The local metadata below - arrivedAt, receivedFrom, deliveredTo - is exactly the data
 * that must never enter a telegram. It describes this node, not the message.
 */
class InMemoryLedger : TelegramLedger {

    private data class Row(
        val telegram: Telegram,
        val arrivedAt: Long,
        val receivedFrom: PeerId?,
    )

    private val mutex = Mutex()
    private val rows = LinkedHashMap<String, Row>()
    private val deliveredTo = mutableMapOf<String, MutableSet<String>>()

    private val _stream = MutableStateFlow<List<Telegram>>(emptyList())

    override suspend fun has(id: String): Boolean = mutex.withLock { rows.containsKey(id) }

    override suspend fun put(telegram: Telegram, receivedFrom: PeerId?): Boolean =
        mutex.withLock {
            if (rows.containsKey(telegram.id)) return@withLock false
            rows[telegram.id] = Row(
                telegram = telegram,
                arrivedAt = System.currentTimeMillis() / 1000,
                receivedFrom = receivedFrom,
            )
            publish()
            true
        }

    override suspend fun get(id: String): Telegram? = mutex.withLock { rows[id]?.telegram }

    override suspend fun all(): List<Telegram> = mutex.withLock { snapshot() }
    override suspend fun localState(id: String): LedgerLocalState? = mutex.withLock {
        rows[id]?.let { row -> LedgerLocalState(row.receivedFrom, deliveredTo[id].orEmpty().map(::PeerId).toSet()) }
    }

    override fun stream(): Flow<List<Telegram>> = _stream.asStateFlow()

    override suspend fun markDelivered(id: String, peer: PeerId) = mutex.withLock {
        deliveredTo.getOrPut(id) { mutableSetOf() }.add(peer.value)
        Unit
    }

    override suspend fun wasDeliveredTo(id: String, peer: PeerId): Boolean =
        mutex.withLock { deliveredTo[id]?.contains(peer.value) == true }

    override suspend fun pendingFor(peer: PeerId): List<Telegram> = mutex.withLock {
        rows.values
            .map { it.telegram }
            .filter { RelayPolicy.shouldForward(it) }
            .filterNot { deliveredTo[it.id]?.contains(peer.value) == true }
    }

    override suspend fun count(): Int = mutex.withLock { rows.size }

    /** Newest first: what the rescuer view and the demo list both want. */
    private fun snapshot(): List<Telegram> =
        rows.values.map { it.telegram }.sortedByDescending { it.timestamp }

    private fun publish() {
        _stream.value = snapshot()
    }
}
