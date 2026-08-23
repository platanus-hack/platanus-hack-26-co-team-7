package com.ziro.relay

import android.content.Context
import com.ziro.relay.adapters.bus.SharedFlowEventBus
import com.ziro.relay.adapters.crypto.KeystoreDeviceSigner
import com.ziro.relay.adapters.ledger.SqliteTelegramLedger
import com.ziro.relay.adapters.location.AndroidLocationSource
import com.ziro.relay.adapters.nearby.NearbyTransport
import com.ziro.relay.adapters.profile.SqliteProfileStore
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.adapters.sync.GatewayOutbox
import com.ziro.relay.adapters.emergency.ActiveEmergencyStore
import com.ziro.relay.adapters.session.SecureSessionStore
import com.ziro.relay.adapters.sqlite.LegacySharedPreferencesMigration
import com.ziro.relay.application.AnnouncePresence
import com.ziro.relay.application.ForwardPending
import com.ziro.relay.application.IngestTelegram
import com.ziro.relay.application.RelayEngine
import com.ziro.relay.application.SendTelegram
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.LocationSource
import com.ziro.relay.ports.ProfileStore
import com.ziro.relay.ports.Signer
import com.ziro.relay.ports.TelegramLedger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID

/** Manual DI root. Android adapters are assembled here; domain and application stay platform-free. */
object RelayContainer {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var appContext: Context

    lateinit var originHash: String
        private set
    lateinit var bus: EventBus
        private set
    lateinit var ledger: TelegramLedger
        private set
    lateinit var signer: Signer
        private set
    lateinit var profiles: ProfileStore
        private set
    lateinit var ingest: IngestTelegram
        private set
    lateinit var transport: NearbyTransport
        private set
    lateinit var forwardPending: ForwardPending
        private set
    lateinit var sendTelegram: SendTelegram
        private set
    lateinit var location: LocationSource
        private set
    lateinit var announcePresence: AnnouncePresence
        private set
    lateinit var engine: RelayEngine
        private set
    lateinit var gatewayOutbox: GatewayOutbox
        private set
    lateinit var secureSession: SecureSessionStore
        private set
    lateinit var activeEmergency: ActiveEmergencyStore
        private set

    @Synchronized
    fun attach(context: Context) {
        if (::engine.isInitialized) return
        appContext = context.applicationContext
        val identity = appContext.getSharedPreferences("ziro_relay_identity", Context.MODE_PRIVATE)
        originHash = identity.getString("origin_hash", null)
            ?: UUID.randomUUID().toString().take(8).also { identity.edit().putString("origin_hash", it).apply() }
        bus = SharedFlowEventBus()
        val database = RelayDatabase(appContext)
        LegacySharedPreferencesMigration(appContext, database).run()
        gatewayOutbox = GatewayOutbox(database)
        activeEmergency = ActiveEmergencyStore(database)
        secureSession = SecureSessionStore(appContext)
        ledger = SqliteTelegramLedger(database, gatewayOutbox)
        signer = KeystoreDeviceSigner(appContext)
        profiles = SqliteProfileStore(database)
        ingest = IngestTelegram(ledger = ledger, signer = signer, bus = bus, allowUnsigned = false)
        transport = NearbyTransport(appContext, bus, scope, originHash, ingest)
        forwardPending = ForwardPending(ledger, transport)
        sendTelegram = SendTelegram(ledger, transport, signer, profiles, originHash)
        location = AndroidLocationSource(appContext)
        announcePresence = AnnouncePresence(
            sendTelegram = sendTelegram,
            location = location,
            bus = bus,
            activeEmergency = { activeEmergency.current() },
        )
        engine = RelayEngine(transport, bus, forwardPending, ledger, scope, announcePresence, location)
    }

    fun context(): Context = appContext
}
