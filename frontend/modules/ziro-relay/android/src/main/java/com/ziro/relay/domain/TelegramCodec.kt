package com.ziro.relay.domain

import kotlinx.serialization.json.Json

/**
 * Wire encoding. JSON on purpose for the hackathon: debuggable in logcat, no extra
 * dependency, and ~600 bytes is irrelevant next to a 5-15 second Nearby handshake.
 *
 * Note on [decode]: it returns the parsed telegram, but callers must keep the ORIGINAL
 * bytes if they intend to verify a signature or relay. Re-encoding can change field
 * order or number formatting, which breaks the HMAC downstream.
 */
object TelegramCodec {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true // forward compatibility with a future v2 field
        explicitNulls = true
    }

    fun encode(t: Telegram): ByteArray =
        json.encodeToString(Telegram.serializer(), t).toByteArray(Charsets.UTF_8)

    fun decode(bytes: ByteArray): Telegram? = try {
        json.decodeFromString(Telegram.serializer(), bytes.toString(Charsets.UTF_8))
    } catch (e: Exception) {
        null
    }
}
