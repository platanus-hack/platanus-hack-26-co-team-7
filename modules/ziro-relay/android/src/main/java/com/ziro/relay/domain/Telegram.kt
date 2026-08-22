package com.ziro.relay.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The telegram: the only unit of information that crosses the mesh.
 *
 * This is the WIRE format. It carries facts stated by the origin device and nothing
 * else. Anything a node knows about its own relationship with a telegram (when it
 * arrived here, which peer delivered it, whether it was flushed to the backend) lives
 * in the ledger, never here — see ports/TelegramLedger.kt.
 *
 * Only [hop] and [ttl] ever change in transit, and they change exactly once per node,
 * on ingest. See [RelayPolicy].
 *
 * FROZEN CONTRACT: no field is added, removed or renamed without both developers
 * agreeing. A shape change is a protocol version bump, not an edit.
 */
@Serializable
data class Telegram(
    val v: Int = PROTOCOL_VERSION,
    /** UUID v4. The universal deduplication key. Nothing works without this. */
    val id: String,
    /** Stable anonymous id of the affected person. Groups their telegrams over time. */
    @SerialName("user_id") val userId: String,
    /** Groups every person affected by the same disaster. */
    @SerialName("event_id") val eventId: String,
    val event: EventType,
    val status: PersonStatus,
    /** 1 = minor, 5 = catastrophic. Drives rescuer triage ordering. */
    val severity: Int = DEFAULT_SEVERITY,
    val location: GeoPoint,
    /** Epoch seconds, set by the ORIGIN. Not when this node received it. */
    val timestamp: Long,
    /** Hops already travelled. Starts at 0, incremented by each receiving node. */
    val hop: Int = 0,
    /** Hops remaining. Starts at 8, decremented by each receiving node. */
    val ttl: Int = DEFAULT_TTL,
    /** Short hash of the origin device. Never the real device identifier. */
    val origin: String,
    /** Triage payload. Null when no profile has been loaded yet. */
    val vital: VitalBlock? = null,
    /** Identity challenge used to move the person to SAFE. */
    val verify: VerifyBlock? = null,
    /**
     * HMAC-SHA256 over [Canonical.of]. Nullable in the MVP, but the field exists from
     * v1 on purpose: adding it later would force a protocol version bump.
     */
    val hmac: String? = null,
) {
    companion object {
        const val PROTOCOL_VERSION = 1
        const val DEFAULT_TTL = 8
        const val DEFAULT_SEVERITY = 3
    }
}

@Serializable
data class GeoPoint(
    val lat: Double,
    val lng: Double,
)

/**
 * What a rescuer needs OFFLINE, in the next ten minutes, to decide how to act.
 *
 * That is the whole admission criterion for this block. Data that only a hospital or
 * the backend needs (document number, insurer, family phone numbers) is deliberately
 * absent: the backend already holds it from onboarding, keyed by
 * [Telegram.userId]. Relaying it through eight strangers' phones buys nothing and
 * leaks everything. See Profile.toVitalBlock().
 */
@Serializable
data class VitalBlock(
    val name: String? = null,
    val age: Int? = null,
    /** Blood group and Rh combined, e.g. "O+", "AB-". */
    val blood: String? = null,
    val allergies: List<String> = emptyList(),
    val conditions: List<String> = emptyList(),
    val medications: List<String> = emptyList(),
    val disability: Disability = Disability.NONE,
    val pregnant: Boolean = false,
)

/**
 * The plaintext answer NEVER travels and is never stored. Only the hash moves, and
 * only the backend compares it.
 */
@Serializable
data class VerifyBlock(
    @SerialName("question_id") val questionId: String,
    @SerialName("answer_hash") val answerHash: String,
)

@Serializable
enum class EventType { EARTHQUAKE, FIRE, FLOOD, MEDICAL, OTHER }

/**
 * State of the PERSON. Orthogonal to [EngineStatus], which is the state of the node.
 * Backend processing priority: NEED_HELP > EMERGENCY > SAFE.
 */
@Serializable
enum class PersonStatus { EMERGENCY, NEED_HELP, SAFE }

/** Changes HOW someone is rescued, not just whether. Part of triage, so it travels. */
@Serializable
enum class Disability { NONE, MOBILITY, VISUAL, HEARING, COGNITIVE }
