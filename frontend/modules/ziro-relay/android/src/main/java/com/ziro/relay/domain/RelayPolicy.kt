package com.ziro.relay.domain

/**
 * The propagation rules of the protocol, in one place, with no dependencies.
 *
 * SINGLE MUTATION POINT: the RECEIVING node applies [onIngest] exactly once, when a
 * telegram arrives. Forwarding is then verbatim — whatever is stored in the ledger is
 * already the exact payload to relay.
 *
 * This is a deliberate correction to the earlier draft, which mutated on forward. Two
 * reasons:
 *  1. With mutation on both ingest and forward, hop double-counts. Here it cannot.
 *  2. Forwarding verbatim bytes keeps the HMAC verifiable end to end. Re-serialising
 *     on every hop is how signatures die.
 *
 * Consequence for the MVP checkpoint: the sender emits hop=0, the receiver stores and
 * displays hop=1. That is the expected result, not an off-by-one.
 */
object RelayPolicy {

    fun isSupportedVersion(t: Telegram): Boolean = t.v == Telegram.PROTOCOL_VERSION

    /**
     * Applied once, by the receiver, before storing.
     * Returns null when the telegram must be dropped instead of stored.
     */
    fun onIngest(t: Telegram): Telegram? {
        if (t.ttl <= 0) return null // already dead, should never have been sent
        return t.copy(hop = t.hop + 1, ttl = t.ttl - 1)
    }

    /** A stored telegram with no life left is kept for the local ledger but not relayed. */
    fun shouldForward(t: Telegram): Boolean = t.ttl > 0

    fun isValid(t: Telegram): Boolean =
        t.id.isNotBlank() &&
            t.userId.isNotBlank() &&
            t.eventId.isNotBlank() &&
            t.origin.isNotBlank() &&
            t.severity in 1..5 &&
            t.hop >= 0 &&
            t.ttl >= 0 &&
            t.timestamp > 0
}
