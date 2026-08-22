package com.ziro.relay.adapters.crypto

import com.ziro.relay.domain.Canonical
import com.ziro.relay.domain.Telegram
import com.ziro.relay.ports.Signer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HMAC-SHA256 over Canonical.of(telegram). Owner: developer A.
 *
 * Two things here are the difference between this working and burning two hours at 4am:
 *
 * 1. The signed bytes come from Canonical, which excludes hop, ttl and hmac. Signing the
 *    whole telegram would produce a signature that only validates at hop 0, because hop
 *    and ttl change at every node.
 *
 * 2. The key is ONE app-wide constant, not a per-device secret. HMAC is symmetric: a
 *    verifier that does not hold the signing key rejects everything. A per-device secret
 *    only works with an actual key exchange, which is phase 5.
 *
 * The constant below is not a security claim. It stops casual spoofing on a hackathon
 * floor and nothing more.
 */
class HmacSha256Signer(
    private val sharedKey: String = MVP_SHARED_KEY,
) : Signer {

    override fun sign(telegram: Telegram): String = hex(mac(Canonical.of(telegram)))

    override fun verify(telegram: Telegram): Boolean {
        val provided = telegram.hmac ?: return false
        val expected = sign(telegram)
        return constantTimeEquals(provided, expected)
    }

    private fun mac(payload: ByteArray): ByteArray {
        val mac = Mac.getInstance(ALGORITHM)
        mac.init(SecretKeySpec(sharedKey.toByteArray(Charsets.UTF_8), ALGORITHM))
        return mac.doFinal(payload)
    }

    private fun hex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    /** Comparing signatures with == leaks timing. Cheap to avoid, so avoid it. */
    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }

    companion object {
        private const val ALGORITHM = "HmacSHA256"

        /** MVP only. Phase 5 replaces this with a negotiated key. */
        const val MVP_SHARED_KEY = "ziro-relay-v1-mvp-shared-key"
    }
}
