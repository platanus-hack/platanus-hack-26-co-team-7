package com.ziro.relay

import android.content.Context
import com.ziro.relay.adapters.bus.SharedFlowEventBus
import com.ziro.relay.adapters.crypto.HmacSha256Signer
import com.ziro.relay.adapters.ledger.SqliteTelegramLedger
import com.ziro.relay.adapters.nearby.NearbyTransport
import com.ziro.relay.adapters.profile.SqliteProfileStore
import com.ziro.relay.adapters.sqlite.RelayDatabase
import com.ziro.relay.application.ForwardPending
import com.ziro.relay.application.IngestTelegram
import com.ziro.relay.application.RelayEngine
import com.ziro.relay.application.SendTelegram
import com.ziro.relay.ports.EventBus
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
    lateinit var engine: RelayEngine
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
        ledger = SqliteTelegramLedger(database)
        signer = HmacSha256Signer()
        profiles = SqliteProfileStore(database)
        ingest = IngestTelegram(ledger = ledger, signer = signer, bus = bus, allowUnsigned = false)
        transport = NearbyTransport(appContext, bus, scope, originHash, ingest)
        forwardPending = ForwardPending(ledger, transport)
        sendTelegram = SendTelegram(ledger, transport, signer, profiles, originHash)
        engine = RelayEngine(transport, bus, forwardPending, ledger, scope)
    }

    fun context(): Context = appContext
}
