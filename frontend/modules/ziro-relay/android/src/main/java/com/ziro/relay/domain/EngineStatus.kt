package com.ziro.relay.domain

/**
 * State of the NODE — what this phone is doing on the mesh.
 *
 * Orthogonal to [PersonStatus], which is the state of the affected person. Confusing
 * the two breaks the backend priority logic.
 *
 * The MVP only reaches IDLE and ADVERTISING. The other three exist so the UI renders
 * all five from day one and phase 5 adds no new UI work.
 */
enum class EngineStatus {
    /** No emergency active, radio off. */
    IDLE,

    /** Advertising and discovering on the ZIRO service id. */
    ADVERTISING,

    /** Connected to at least one peer, exchanging ledgers. */
    SYNCING,

    /** Holding telegrams, waiting for the next peer to appear. */
    RELAY,

    /** No peer seen for over two minutes. Beacon only, reduced duty cycle. */
    ORPHAN,
}
