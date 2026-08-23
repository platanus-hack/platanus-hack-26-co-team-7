package com.ziro.relay.domain

/**
 * Deterministic immutable representation signed by the origin device.
 *
 * Three fields are excluded, and each exclusion is load-bearing:
 *
 *  - `hop` and `ttl` mutate at every node (see [RelayPolicy]). Including them would
 *    make the signature valid only at hop 0 and fail on every relay after that.
 *  - `signature` is the output of this function, so it cannot be part of its own input.
 *
 * The field order below is fixed by hand ON PURPOSE. Do not replace this with a JSON
 * encoder: a change in field order, whitespace or number formatting would silently
 * break verification on the other side of the radio, and the failure would look like a
 * transport bug rather than a serialisation bug.
 */
object Canonical {

    private const val SEP = '\u001F' // ASCII unit separator: cannot appear in our data
    private const val NULL = "\u0000"

    fun of(t: Telegram): ByteArray = buildString {
        field(t.v)
        field(t.id)
        field(t.userId)
        field(t.eventId)
        field(t.event.name)
        field(t.status.name)
        field(t.severity)
        // Fixed to 6 decimals so Double formatting can never drift between devices.
        field(String.format(java.util.Locale.ROOT, "%.6f", t.location.lat))
        field(String.format(java.util.Locale.ROOT, "%.6f", t.location.lng))
        field(t.timestamp)
        field(t.origin)
        vital(t.vital)
        verify(t.verify)
        field(t.keyId)
        field(t.publicKey)
    }.toByteArray(Charsets.UTF_8)

    private fun StringBuilder.field(value: Any?) {
        append(value?.toString() ?: NULL)
        append(SEP)
    }

    private fun StringBuilder.list(values: List<String>) {
        // Sorted so two devices that hold the same set in a different order agree.
        field(values.sorted().joinToString(","))
    }

    private fun StringBuilder.vital(v: VitalBlock?) {
        if (v == null) {
            field(NULL)
            return
        }
        field(v.name)
        field(v.age)
        field(v.blood)
        list(v.allergies)
        list(v.conditions)
        list(v.medications)
        field(v.disability.name)
        field(v.pregnant)
    }

    private fun StringBuilder.verify(v: VerifyBlock?) {
        if (v == null) {
            field(NULL)
            return
        }
        field(v.questionId)
        field(v.answerHash)
    }
}
