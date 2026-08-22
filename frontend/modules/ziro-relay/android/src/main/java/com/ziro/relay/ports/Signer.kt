package com.ziro.relay.ports

import com.ziro.relay.domain.Telegram

/**
 * PORT — origin authentication.
 *
 * Symmetric HMAC, so both sides need the SAME key. In the MVP that is a single
 * app-wide constant: a per-device secret cannot be verified by a peer that does not
 * hold it, which would make every telegram fail verification.
 *
 * Phase 5 replaces this with a real key exchange. The interface does not change.
 */
interface Signer {

    /** Returns the signature over Canonical.of(telegram). */
    fun sign(telegram: Telegram): String

    /** True when [Telegram.hmac] matches. An absent signature is handled by policy. */
    fun verify(telegram: Telegram): Boolean
}
