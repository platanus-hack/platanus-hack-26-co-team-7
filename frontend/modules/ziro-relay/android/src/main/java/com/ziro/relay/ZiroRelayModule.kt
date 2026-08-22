package com.ziro.relay

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import com.ziro.relay.domain.EventType
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.domain.PersonStatus
import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.domain.Telegram
import com.ziro.relay.domain.TelegramCodec
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

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
 * Five functions and one event. Every addition here is a line that has to be kept in sync
 * by hand in TypeScript, with no compiler watching. If something can be computed in JS
 * from a telegram that already crossed, do it in JS.
 */
class ZiroRelayModule : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json { encodeDefaults = true; explicitNulls = false }

    /**
     * Permission launcher state.
     *
     * AndroidX requires registerForActivityResult to run on a ComponentActivity that is at
     * least in CREATED state — and ideally before STARTED. We try to register in OnCreate,
     * but if the activity isn't attached yet (the common case: the module is constructed
     * before MainActivity.onCreate returns), we fall back to lazy registration on the first
     * call from JS, when an activity is guaranteed to exist.
     *
     * The callback is fixed at registration time (ActivityResultLauncher.launch() does NOT
     * accept a per-call callback in 1.8.x — only the input and optional ActivityOptions).
     * We route results to whichever deferred is currently parked in `pendingPermissionResult`.
     * Requests are serialized through this single field, which is acceptable for an MVP: the
     * UI only ever triggers one start() / one requestPermissions() at a time.
     */
    private var permissionLauncher: ActivityResultLauncher<Array<String>>? = null
    private var pendingPermissionResult: CompletableDeferred<Map<String, Boolean>>? = null

    override fun definition() = ModuleDefinition {
        Name("ZiroRelay")

        Events(EVENT_RELAY)

        OnCreate {
            appContext.reactContext?.let { RelayContainer.attach(it) }
            observeEngine()
            // Best-effort early registration. If the activity isn't available yet, the lazy
            // path in requestPermissionsInternal() will register it before any JS call.
            (appContext.currentActivity as? ComponentActivity)?.let { registerPermissionLauncher(it) }
        }

        /** Current node status without waiting for an event. Used on mount. */
        Function("getStatus") {
            RelayContainer.engine.status.value.name
        }

        Function("getOriginHash") {
            RelayContainer.originHash
        }

        // Dot call with an explicit type argument: the no-arg lambda is otherwise ambiguous
        // between the zero- and one-parameter Coroutine overloads. Awaiting the permission
        // request forces this to be a Coroutine — without it, start() would return before
        // the user responded to the dialog and Nearby Connections would silently no-op.
        AsyncFunction("start").Coroutine<Unit> {
            val result = requestPermissionsInternal()
            val denied = result["denied"].orEmpty()
            if (denied.isNotEmpty()) {
                throw IllegalStateException(
                    "Cannot start ZIRO relay: missing required runtime permissions. " +
                        "Grant them in Settings and try again. Denied: " + denied.joinToString(),
                )
            }
            RelayContainer.engine.start()
        }

        AsyncFunction("stop") {
            RelayContainer.engine.stop()
        }

        /** Returns the created telegram as a wire JSON string. */
        AsyncFunction("sendTelegram") Coroutine { eventId: String, lat: Double, lng: Double, severity: Int ->
            val telegram = RelayContainer.sendTelegram(
                eventId = eventId,
                location = GeoPoint(lat = lat, lng = lng),
                event = EventType.EARTHQUAKE,
                status = PersonStatus.EMERGENCY,
                severity = severity,
            )
            return@Coroutine wire(telegram)
        }

        /** The whole local ledger as a JSON array of telegrams. Newest first. */
        // Dot call with an explicit type argument: the no-arg lambda is otherwise ambiguous
        // between the zero- and one-parameter Coroutine overloads.
        AsyncFunction("getLedger").Coroutine<String> {
            return@Coroutine json.encodeToString(
                ListSerializer(Telegram.serializer()),
                RelayContainer.ledger.all(),
            )
        }

        /**
         * Request all runtime permissions required by Nearby Connections + the foreground
         * service. Returns JSON: {"granted":[...], "denied":[...]} — same wire shape as the
         * Kotlin engine uses for telegrams, so the same Json instance encodes both.
         *
         * Safe to call multiple times; permissions already granted are skipped from the
         * system dialog and just echoed back in `granted`.
         */
        // Dot call with explicit type argument for the same no-arg-lambda ambiguity reason
        // as getLedger above.
        AsyncFunction("requestPermissions").Coroutine<String> {
            return@Coroutine encodePermissionResult(requestPermissionsInternal())
        }
    }

    /**
     * Translates domain events into the single JS event. Runs for the life of the process,
     * not the life of a screen, so nothing is missed while JS is asleep — the ledger is
     * always the source of truth and getLedger() reconciles on mount.
     */
    private fun observeEngine() {
        scope.launch {
            RelayContainer.bus.events.collect { event ->
                sendEvent(EVENT_RELAY, event.toJsPayload())
            }
        }
    }

    /**
     * Registers the permission launcher exactly once. Idempotent across calls: the launcher
     * is tied to a single ComponentActivity and must not be re-registered on the same host.
     * The callback is fixed at registration — ActivityResultLauncher.launch(input, callback)
     * does not exist in activity-ktx 1.8.x, only launch(input) and launch(input, options).
     */
    private fun registerPermissionLauncher(activity: ComponentActivity) {
        if (permissionLauncher != null) return
        permissionLauncher = activity.registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions(),
        ) { result ->
            // Resume the currently parked coroutine, if any. We tolerate a null deferred
            // because the launcher can fire once after the activity is recreated; we just
            // drop that result rather than crash.
            pendingPermissionResult?.complete(result)
            pendingPermissionResult = null
        }
    }

    /**
     * Resolves the runtime permissions required for Nearby Connections over BLE + Wi-Fi
     * Direct, plus the foreground service notification. Returns the (granted, denied) split
     * BEFORE any serialization, so both `requestPermissions` (JSON to JS) and `start` (raw
     * map for the throw decision) can share the same logic.
     *
     * Throws IllegalStateException if no ComponentActivity is attached — without an activity
     * there is nowhere to show the system dialog and no ActivityResultRegistry to dispatch
     * the result into.
     */
    private suspend fun requestPermissionsInternal(): Map<String, List<String>> {
        val activity = appContext.currentActivity as? ComponentActivity
            ?: throw IllegalStateException(
                "Cannot request ZIRO relay permissions: no ComponentActivity is attached " +
                    "to the current app context.",
            )
        registerPermissionLauncher(activity)
        val launcher = permissionLauncher
            ?: throw IllegalStateException("Permission launcher was not registered.")

        val perms = requiredPermissions()
        val alreadyGranted = perms.filter {
            ContextCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
        }
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            return mapOf("granted" to alreadyGranted.distinct(), "denied" to emptyList())
        }

        val deferred = CompletableDeferred<Map<String, Boolean>>()
        pendingPermissionResult = deferred
        // ActivityResultLauncher.launch(input, callback) does not exist in activity-ktx 1.8.x.
        // The callback was bound at registerForActivityResult time; the launcher just dispatches
        // its result to pendingPermissionResult.
        launcher.launch(missing.toTypedArray())
        val result = deferred.await()
        val newlyGranted = result.filterValues { it }.keys
        val denied = result.filterValues { !it }.keys
        return mapOf(
            "granted" to (alreadyGranted + newlyGranted).distinct(),
            "denied" to denied.toList(),
        )
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

        is RelayEvent.TelegramRejected ->
            mapOf("type" to "TELEGRAM_REJECTED", "peerId" to from.value, "reason" to reason.name)

        is RelayEvent.StatusChanged ->
            mapOf("type" to "STATUS_CHANGED", "status" to status.name)

        is RelayEvent.RadioError ->
            mapOf("type" to "RADIO_ERROR", "message" to message)
    }

    private fun wire(telegram: Telegram): String =
        TelegramCodec.encode(telegram).toString(Charsets.UTF_8)

    private companion object {
        const val EVENT_RELAY = "onRelayEvent"
    }
}
