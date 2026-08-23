package com.ziro.relay.domain

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The complete Nearby byte payload, including its envelope, is limited to 24 KiB. */
object RelayEnvelopeCodec {
    const val MAX_BYTES = 24 * 1024
    private val json = Json { encodeDefaults = true; explicitNulls = true }

    fun telegram(id: String, wire: String): ByteArray =
        json.encodeToString(WireEnvelope.serializer(), WireEnvelope(kind = "telegram", messageId = id, telegram = wire))
            .toByteArray(Charsets.UTF_8)

    fun ack(id: String): ByteArray =
        json.encodeToString(WireEnvelope.serializer(), WireEnvelope(kind = "ack", messageId = id)).toByteArray(Charsets.UTF_8)

    fun decode(bytes: ByteArray): WireEnvelope? = runCatching {
        json.decodeFromString(WireEnvelope.serializer(), bytes.toString(Charsets.UTF_8))
    }.getOrNull()
}

@Serializable
data class WireEnvelope(
    val v: Int = 1,
    val kind: String,
    val messageId: String,
    val telegram: String? = null,
)
