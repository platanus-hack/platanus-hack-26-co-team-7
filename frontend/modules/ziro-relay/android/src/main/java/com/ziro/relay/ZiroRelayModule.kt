package com.ziro.relay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.ziro.relay.adapters.service.RelayForegroundService
import com.ziro.relay.domain.BloodRh
import com.ziro.relay.domain.BloodType
import com.ziro.relay.domain.Disability
import com.ziro.relay.domain.DocType
import com.ziro.relay.domain.EmergencyContact
import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.Profile
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import com.ziro.relay.domain.identityAnswerHash
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import java.time.LocalDate
import kotlin.coroutines.resume

/**
 * THE BRIDGE. Owner: developer A. This is the only file both developers read together.
 *
 * ── The design rule that makes the hybrid split work ──
 *
 * The engine is FAT and lives entirely in Kotlin. JavaScript is a viewer and a commander,
 * never a participant in the relay path.
 *
 * That is not a style preference. React Native's JS thread is not reliably alive when the
 * app is backgrounded, but a foreground service is. If deduplication, HMAC verification or
 * the ledger lived in JS, every telegram arriving while the screen was off would be lost —
 * which is precisely the situation ZIRO exists for. So receive, verify, dedup, store and
 * forward all happen below this line, and JS finds out afterwards.
 *
 * ── The rule that keeps the contract cheap ──
 *
 * The bridge speaks the SAME JSON as the radio. A telegram crosses this boundary as the
 * exact wire string produced by TelegramCodec, so there is no second hand-maintained
 * mapping to WritableMap and no way for the two representations to drift. The TypeScript
 * type in src/ZiroRelay.types.ts mirrors protocol.md directly.
 *
 * ── Keep this surface small ──
 *
 * Every addition here is a line that has to be kept in sync by hand in TypeScript, with no
 * compiler watching. If something can be computed in JS from a telegram that already crossed,
 * do it in JS.
 */
class ZiroRelayModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json { encodeDefaults = true; explicitNulls = true }

    override fun definition() = ModuleDefinition {
        Name("ZiroRelay")

        Events(EVENT_RELAY)

        OnCreate {
            appContext.reactContext?.let { RelayContainer.attach(it) }
            observeEngine()
        }

        /** Current node status without waiting for an event. Used on mount. */
        Function("getStatus") {
            RelayContainer.engine.status.value.name
        }

        /** Snapshot connected peers so the UI can recover after its JS listener was inactive. */
        Function("getConnectedPeers") {
            RelayContainer.transport.peers.value.map { it.value }
        }

        Function("getOriginHash") {
            RelayContainer.originHash
        }

        AsyncFunction("getProfile").Coroutine<String> {
            RelayContainer.profiles.get()?.let(::profileWire)
                ?: json.encodeToString(ProfileInput.serializer(), ProfileInput.blank("anon-${RelayContainer.originHash}"))
        }

        AsyncFunction("saveProfile").Coroutine<Unit, String> { profileJson ->
            val input = runCatching { json.decodeFromString(ProfileInput.serializer(), profileJson) }
                .getOrElse { throw IllegalArgumentException("Invalid profile: ${it.message}") }
            RelayContainer.profiles.save(input.toDomain(RelayContainer.profiles.get()))
        }

        AsyncFunction("start").Coroutine<Unit> {
            val permResult = requestPermissionsInternal()
            val denied = permResult["denied"].orEmpty()
            if (denied.isNotEmpty()) {
                throw IllegalStateException(
                    "Cannot start ZIRO relay: missing required runtime permissions. " +
                        "Grant them in Settings and try again. Denied: " + denied.joinToString(),
                )
            }
            // Engine runs inside the foreground service so it survives JS going background.
            val context = RelayContainer.context()
            ContextCompat.startForegroundService(context, Intent(context, RelayForegroundService::class.java))
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("stop") {
            RelayContainer.context().stopService(Intent(RelayContainer.context(), RelayForegroundService::class.java))
        }

        /** Read-only current grant state, for the UI to render hints before pressing start. */
        Function("getPermissions") { permissionState() }

        /**
         * Request all runtime permissions required by Nearby Connections + the foreground
         * service. Returns JSON: {"granted":[...], "denied":[...]} — same wire shape as the
         * Kotlin engine uses for telegrams, so the same Json instance encodes both.
         *
         * Safe to call multiple times; permissions already granted are skipped from the
         * system dialog and just echoed back in `granted`. `start()` already calls this
         * internally and throws on denial — only call it directly if you want to preflight
         * before showing the start button.
         */
        AsyncFunction("requestPermissions").Coroutine<String> {
            encodePermissionResult(requestPermissionsInternal())
        }.runOnQueue(Queues.MAIN)

        /** Returns the created telegram as a wire JSON string. */
        AsyncFunction("sendTelegram").Coroutine<String, String> { draftJson ->
            val draft = runCatching { json.decodeFromString(TelegramDraft.serializer(), draftJson) }
                .getOrElse { throw IllegalArgumentException("Invalid telegram draft: ${it.message}") }
            require(draft.eventId.isNotBlank()) { "eventId is required" }
            require(draft.severity in 1..5) { "severity must be between 1 and 5" }
            require(draft.location.lat in -90.0..90.0 && draft.location.lng in -180.0..180.0) {
                "location is outside valid coordinates"
            }
            val telegram = RelayContainer.sendTelegram(
                eventId = draft.eventId.trim(),
                location = draft.location,
                event = draft.event,
                status = draft.status,
                severity = draft.severity,
            )
            wire(telegram)
        }

        /** The whole local ledger as a JSON array of telegrams. Newest first. */
        // Dot call with an explicit type argument: the no-arg lambda is otherwise ambiguous
        // between the zero- and one-parameter Coroutine overloads.
        AsyncFunction("getLedger").Coroutine<String> {
            val entries = RelayContainer.ledger.all().map { telegram ->
                val state = RelayContainer.ledger.localState(telegram.id)
                LedgerEntryWire(telegram, state?.receivedFrom?.value, state?.deliveredTo?.map { it.value }.orEmpty())
            }
            json.encodeToString(ListSerializer(LedgerEntryWire.serializer()), entries)
        }
    }

    /**
     * Translates domain events into the single JS event for the life of the process. The
     * ledger and getConnectedPeers() reconcile state after a transient JS listener is inactive.
     */
    private fun observeEngine() {
        scope.launch {
            RelayContainer.bus.events.collect { event ->
                if (event is RelayEvent.TelegramDelivered) {
                    RelayContainer.ledger.markDelivered(event.id, event.to)
                }
                sendEvent(EVENT_RELAY, event.toJsPayload())
            }
        }
    }

    /**
     * Resolves Nearby runtime permissions through Expo's installed PermissionsService.
     * AppContext.permissions owns the React-specific permission callback; this module only
     * verifies that AppContext has a live foreground Activity before delegating to it. This
     * function is invoked on Queues.MAIN so the request originates from that Activity.
     */
    private suspend fun requestPermissionsInternal(): Map<String, List<String>> {
        val context = RelayContainer.context()
        val perms = requiredPermissions()
        val alreadyGranted = perms.filter {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            return mapOf("granted" to alreadyGranted.distinct(), "denied" to emptyList())
        }

        val activity = appContext.currentActivity
        if (activity == null || activity.isFinishing || activity.isDestroyed) {
            throw IllegalStateException(
                "Permissions can only be requested while the ZIRO app is open in the foreground. " +
                    "Return to the app and tap Grant permissions again.",
            )
        }
        val permissions = appContext.permissions
            ?: throw IllegalStateException("Expo permissions service is unavailable in this app build.")

        suspendCancellableCoroutine<Unit> { continuation ->
            permissions.askForPermissions({
                if (continuation.isActive) continuation.resume(Unit)
            }, *missing.toTypedArray())
        }

        val granted = perms.filter {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
        val denied = perms.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        return mapOf(
            "granted" to granted.distinct(),
            "denied" to denied.distinct(),
        )
    }

    /**
     * Read-only permission state without triggering a request — for the UI to render the
     * "we need these" hint before the user taps start.
     */
    private fun permissionState(): Map<String, Boolean> {
        val context = RelayContainer.context()
        return requiredPermissions().associateWith {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Permissions Nearby Connections needs to actually broadcast and discover on modern
     * Android. ACCESS_FINE_LOCATION is required on every version for BLE scanning; the
     * Bluetooth trio only exists on API 31+; NEARBY_WIFI_DEVICES and POST_NOTIFICATIONS are
     * API 33+.
     */
    private fun requiredPermissions(): List<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            add(Manifest.permission.BLUETOOTH_SCAN)
            add(Manifest.permission.BLUETOOTH_ADVERTISE)
            add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.NEARBY_WIFI_DEVICES)
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun encodePermissionResult(result: Map<String, List<String>>): String =
        json.encodeToString(
            MapSerializer(String.serializer(), ListSerializer(String.serializer())),
            result,
        )

    private fun RelayEvent.toJsPayload(): Map<String, Any?> = when (this) {
        is RelayEvent.PeerDiscovered ->
            mapOf("type" to "PEER_DISCOVERED", "peerId" to peer.value)

        is RelayEvent.PeerConnected ->
            mapOf("type" to "PEER_CONNECTED", "peerId" to peer.value)

        is RelayEvent.PeerDisconnected ->
            mapOf("type" to "PEER_DISCONNECTED", "peerId" to peer.value)

        is RelayEvent.TelegramReceived -> mapOf(
            "type" to "TELEGRAM_RECEIVED",
            "peerId" to from.value,
            "telegram" to wire(telegram),
        )

        is RelayEvent.TelegramSent ->
            mapOf("type" to "TELEGRAM_SENT", "peerId" to to.value, "telegramId" to id)

        is RelayEvent.TelegramDelivered ->
            mapOf("type" to "TELEGRAM_DELIVERED", "peerId" to to.value, "telegramId" to id)

        is RelayEvent.TelegramRejected ->
            mapOf("type" to "TELEGRAM_REJECTED", "peerId" to from.value, "reason" to reason.name)

        is RelayEvent.StatusChanged ->
            mapOf("type" to "STATUS_CHANGED", "status" to status.name)

        is RelayEvent.RadioError ->
            mapOf("type" to "RADIO_ERROR", "message" to message)
    }

    private fun wire(telegram: Telegram): String =
        TelegramCodec.encode(telegram).toString(Charsets.UTF_8)

    private fun profileWire(profile: Profile): String = json.encodeToString(
        ProfileInput.serializer(),
        ProfileInput.from(profile),
    )

    private companion object {
        const val EVENT_RELAY = "onRelayEvent"
    }
}

@Serializable
private data class TelegramDraft(
    val eventId: String,
    val event: EventType,
    val status: PersonStatus,
    val location: GeoPoint,
    val severity: Int,
)

@Serializable
private data class LedgerEntryWire(
    val telegram: Telegram,
    val receivedFrom: String? = null,
    val deliveredTo: List<String> = emptyList(),
)

@Serializable
private data class ProfileContact(val name: String, val phone: String, val relationship: String)

@Serializable
private data class ProfileInput(
    val userId: String,
    val fullName: String,
    val docType: DocType,
    val docNumber: String,
    val birthDate: String,
    val bloodType: BloodType,
    val bloodRh: BloodRh,
    val allergies: List<String> = emptyList(),
    val chronicConditions: List<String> = emptyList(),
    val medications: List<String> = emptyList(),
    val disability: Disability = Disability.NONE,
    val isPregnant: Boolean = false,
    val weightKg: Int? = null,
    val eps: String? = null,
    val emergencyContacts: List<ProfileContact> = emptyList(),
    val questionId: String,
    /** Save-only plaintext. Kotlin hashes it before persistence and never returns it. */
    val identityAnswer: String? = null,
) {
    fun toDomain(current: Profile?): Profile {
        require(userId.isNotBlank() && fullName.isNotBlank() && docNumber.isNotBlank() && birthDate.isNotBlank() && questionId.isNotBlank()) {
            "Profile identity, birth date, document and verification question are required"
        }
        require(runCatching { LocalDate.parse(birthDate.trim()) }.isSuccess) { "Birth date must be ISO-8601 (YYYY-MM-DD)" }
        require(weightKg == null || weightKg > 0) { "Weight must be a positive number" }
        val deviceSecret = current?.deviceSecret ?: randomSecret()
        val answerHash = identityAnswer?.trim()?.takeIf(String::isNotBlank)?.let {
            identityAnswerHash(deviceSecret, it)
        }
            ?: current?.answerHash
            ?: throw IllegalArgumentException("An identity answer is required the first time you save your profile")
        return Profile(
            userId.trim(), fullName.trim(), docType, docNumber.trim(), birthDate.trim(), bloodType, bloodRh,
            allergies.map(String::trim).filter(String::isNotBlank),
            chronicConditions.map(String::trim).filter(String::isNotBlank),
            medications.map(String::trim).filter(String::isNotBlank),
            disability, isPregnant, weightKg, eps?.trim()?.ifBlank { null },
            emergencyContacts
                .filter { it.name.isNotBlank() && it.phone.isNotBlank() }
                .map { EmergencyContact(it.name.trim(), it.phone.trim(), it.relationship.trim()) },
            questionId.trim(), answerHash, deviceSecret,
        )
    }

    companion object {
        fun from(profile: Profile) = ProfileInput(
            profile.userId, profile.fullName, profile.docType, profile.docNumber,
            profile.birthDate, profile.bloodType, profile.bloodRh,
            profile.allergies, profile.chronicConditions, profile.medications,
            profile.disability, profile.isPregnant, profile.weightKg, profile.eps,
            profile.emergencyContacts.map { ProfileContact(it.name, it.phone, it.relationship) },
            profile.questionId,
        )

        fun blank(userId: String) = ProfileInput(
            userId = userId, fullName = "", docType = DocType.CC, docNumber = "", birthDate = "",
            bloodType = BloodType.O, bloodRh = BloodRh.POSITIVE, questionId = "",
        )
    }
}

private fun randomSecret(): String = ByteArray(32).also(SecureRandom()::nextBytes)
    .joinToString("") { "%02x".format(it) }
