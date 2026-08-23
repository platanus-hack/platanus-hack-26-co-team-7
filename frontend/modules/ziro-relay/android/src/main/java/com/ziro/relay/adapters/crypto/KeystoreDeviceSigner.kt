package com.ziro.relay.adapters.crypto

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.ziro.relay.domain.Canonical
import com.ziro.relay.domain.Telegram
import com.ziro.relay.ports.Signer
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** P-256 is Keystore-backed from API 23, unlike Ed25519 which is not portable on minSdk 26. */
class KeystoreDeviceSigner(context: Context) : Signer {
    private val alias = "ziro.device.signing.v1"
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    init { if (!keyStore.containsAlias(alias)) generate() }

    val publicKey: String get() = Base64.encodeToString(keyStore.getCertificate(alias).publicKey.encoded, Base64.NO_WRAP)
    val keyId: String get() = MessageDigest.getInstance("SHA-256").digest(keyStore.getCertificate(alias).publicKey.encoded)
        .joinToString("") { "%02x".format(it) }

    override fun sign(telegram: Telegram): String {
        val privateKey = keyStore.getKey(alias, null)
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey as java.security.PrivateKey)
        signature.update(Canonical.of(telegram))
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    fun signBinding(): String {
        val privateKey = keyStore.getKey(alias, null) as java.security.PrivateKey
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(privateKey)
        signature.update("replica-device-binding-v1\u001f$keyId\u001f$publicKey\u001f".toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    override fun verify(telegram: Telegram): Boolean = try {
        val encoded = telegram.publicKey ?: return false
        val proof = telegram.signature ?: return false
        val publicKey = java.security.KeyFactory.getInstance("EC").generatePublic(java.security.spec.X509EncodedKeySpec(Base64.decode(encoded, Base64.DEFAULT)))
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initVerify(publicKey)
        signature.update(Canonical.of(telegram))
        signature.verify(Base64.decode(proof, Base64.DEFAULT))
    } catch (_: Exception) { false }

    private fun generate() {
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .build())
            generateKeyPair()
        }
    }
}
