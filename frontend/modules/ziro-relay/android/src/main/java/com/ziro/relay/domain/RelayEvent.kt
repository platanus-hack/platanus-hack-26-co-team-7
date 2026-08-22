package com.ziro.relay.domain

/**
 * Everything that can happen on the radio, as far as the rest of the app is concerned.
 *
 * Sealed on purpose: the `when` in the UI is exhaustive without an `else`, so adding a
 * case here fails the build until it is handled. That compile error is the point.
 *
 * FROZEN CONTRACT: developer A emits these, developer B consumes them. Neither edits
 * this file alone.
 */
sealed interface RelayEvent {
    data class PeerDiscovered(val peer: PeerId) : RelayEvent
    data class PeerConnected(val peer: PeerId) : RelayEvent
    data class PeerDisconnected(val peer: PeerId) : RelayEvent
    data class TelegramReceived(val telegram: Telegram, val from: PeerId) : RelayEvent
    data class TelegramSent(val id: String, val to: PeerId) : RelayEvent
    data class TelegramDelivered(val id: String, val to: PeerId) : RelayEvent
    data class TelegramRejected(val reason: RejectReason, val from: PeerId) : RelayEvent
    data class StatusChanged(val status: EngineStatus) : RelayEvent
    data class RadioError(val message: String) : RelayEvent
}

enum class RejectReason {
    MALFORMED,
    UNSUPPORTED_VERSION,
    BAD_SIGNATURE,
    DUPLICATE,
    EXPIRED,
    INVALID_FIELDS,
}

/** Opaque peer handle. A value class so a peer id can never be passed where an id goes. */
@JvmInline
value class PeerId(val value: String)
