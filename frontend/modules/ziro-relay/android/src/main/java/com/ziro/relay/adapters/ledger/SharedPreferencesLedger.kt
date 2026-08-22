package com.ziro.relay.adapters.ledger

import android.content.Context
import com.ziro.relay.domain.PeerId
import com.ziro.relay.domain.RelayPolicy
import com.ziro.relay.domain.Telegram
import com.ziro.relay.ports.TelegramLedger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Process-death-safe ledger for the relay protocol and its per-peer delivery receipts. */
class SharedPreferencesLedger(context: Context) : TelegramLedger {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mutex = Mutex()
    private val rows = linkedMapOf<String, Row>()
    private val deliveredTo = mutableMapOf<String, MutableSet<String>>()
    private val _stream = MutableStateFlow<List<Telegram>>(emptyList())

    init {
        restore()
        publish()
    }

    override suspend fun has(id: String): Boolean = mutex.withLock { rows.containsKey(id) }

    override suspend fun put(telegram: Telegram, receivedFrom: PeerId?): Boolean = mutex.withLock {
        if (rows.containsKey(telegram.id)) return@withLock false
        rows[telegram.id] = Row(telegram, receivedFrom?.value)
        persist()
        publish()
        true
    }

    override suspend fun get(id: String): Telegram? = mutex.withLock { rows[id]?.telegram }
    override suspend fun all(): List<Telegram> = mutex.withLock { snapshot() }
    override fun stream(): Flow<List<Telegram>> = _stream.asStateFlow()

    override suspend fun markDelivered(id: String, peer: PeerId) = mutex.withLock {
        deliveredTo.getOrPut(id) { mutableSetOf() }.add(peer.value)
        persist()
    }

    override suspend fun wasDeliveredTo(id: String, peer: PeerId): Boolean = mutex.withLock {
        deliveredTo[id]?.contains(peer.value) == true
    }

    override suspend fun pendingFor(peer: PeerId): List<Telegram> = mutex.withLock {
        rows.values.map(Row::telegram)
            .filter(RelayPolicy::shouldForward)
            .filterNot { deliveredTo[it.id]?.contains(peer.value) == true }
    }

    override suspend fun count(): Int = mutex.withLock { rows.size }

    private fun restore() {
        val saved = preferences.getString(KEY_STATE, null) ?: return
        val state = runCatching { json.decodeFromString(LedgerState.serializer(), saved) }.getOrNull() ?: return
        state.rows.forEach { row -> rows[row.telegram.id] = Row(row.telegram, row.receivedFrom) }
        state.deliveredTo.forEach { (id, peers) -> deliveredTo[id] = peers.toMutableSet() }
    }

    private fun persist() {
        val state = LedgerState(
            rows = rows.values.map { PersistedRow(it.telegram, it.receivedFrom) },
            deliveredTo = deliveredTo.mapValues { (_, peers) -> peers.toList() },
        )
        preferences.edit().putString(KEY_STATE, json.encodeToString(LedgerState.serializer(), state)).apply()
    }

    private fun snapshot(): List<Telegram> = rows.values.map(Row::telegram).sortedByDescending { it.timestamp }
    private fun publish() { _stream.value = snapshot() }

    private data class Row(val telegram: Telegram, val receivedFrom: String?)

    @Serializable private data class PersistedRow(val telegram: Telegram, val receivedFrom: String? = null)
    @Serializable private data class LedgerState(
        val rows: List<PersistedRow> = emptyList(),
        val deliveredTo: Map<String, List<String>> = emptyMap(),
    )

    private companion object {
        const val PREFERENCES = "ziro_relay_ledger"
        const val KEY_STATE = "state"
    }
}
