package com.ziro.relay.ports

import com.ziro.relay.domain.Telegram

/**
 * PORT — origin authentication.
 *
 * Device asymmetric signing. Private material remains in Android Keystore; receivers can
 * verify with the public key carried by v2 telegrams.
 */
interface Signer {

    /** Returns the v2 origin proof over Canonical.of(telegram). */
    fun sign(telegram: Telegram): String

    /** True when [Telegram.hmac] matches. An absent signature is handled by policy. */
    fun verify(telegram: Telegram): Boolean
}
