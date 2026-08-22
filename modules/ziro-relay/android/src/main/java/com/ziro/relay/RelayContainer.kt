package com.ziro.relay

import android.content.Context
import com.ziro.relay.adapters.bus.SharedFlowEventBus
import com.ziro.relay.adapters.crypto.HmacSha256Signer
import com.ziro.relay.adapters.fake.FakeTransport
import com.ziro.relay.adapters.ledger.InMemoryLedger
import com.ziro.relay.adapters.profile.HardcodedProfileStore
import com.ziro.relay.application.ForwardPending
import com.ziro.relay.application.IngestTelegram
import com.ziro.relay.application.RelayEngine
import com.ziro.relay.application.SendTelegram
import com.ziro.relay.ports.EventBus
import com.ziro.relay.ports.PeerTransport
import com.ziro.relay.ports.ProfileStore
import com.ziro.relay.ports.Signer
import com.ziro.relay.ports.TelegramLedger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import java.util.UUID

/**
 * Manual dependency injection for the relay engine. Owner: developer A.
 *
 * Lives as a process singleton rather than inside an Application subclass, because the
 * engine must survive independently of the React Native runtime. See ZiroRelayModule for
 * why that matters: the JS thread is not reliably alive when the app is backgrounded, and
 * a telegram arriving at that moment still has to be verified, deduplicated and stored.
 *
 * This is also the ONLY file that decides which adapter is real and which is fake:
 *   InMemoryLedger        -> RoomLedger              (phase 5)
 *   FakeTransport         -> NearbyTransport         (phase 2)
 *   HardcodedProfileStore -> SqlCipherProfileStore   (phase 5)
 *
 * Nothing above the ports changes when those lines change.
 */
object RelayContainer {

    private val scope = CoroutineScope(SupervisorJob())

    /** Short device hash. Never the real device identifier. */
    val originHash: String = UUID.randomUUID().toString().take(8)

    val bus: EventBus = SharedFlowEventBus()

    val ledger: TelegramLedger = InMemoryLedger()

    val signer: Signer = HmacSha256Signer()

    val profiles: ProfileStore = HardcodedProfileStore()

    val ingest = IngestTelegram(ledger = ledger, signer = signer, bus = bus)

    /**
     * SWAP POINT. Starts as the in-process loopback so the whole pipeline runs from hour
     * one, on one phone, with no radio. Developer A replaces this with NearbyTransport in
     * phase 2 and this is the only line that changes.
     */
    private val fakeTransport = FakeTransport(bus = bus, scope = scope, ingest = ingest)

    val transport: PeerTransport = fakeTransport

    val forwardPending = ForwardPending(ledger = ledger, transport = transport)

    val sendTelegram = SendTelegram(
        ledger = ledger,
        transport = transport,
        signer = signer,
        profiles = profiles,
        originHash = originHash,
    )

    val engine = RelayEngine(
        transport = transport,
        bus = bus,
        forwardPending = forwardPending,
        scope = scope,
    )

    /**
     * Called once from the bridge. Kept separate from construction so the container can be
     * built without a Context — NearbyTransport is the only piece that needs one.
     */
    fun attach(context: Context) {
        // TODO(A, phase 2): build NearbyTransport(context, bus, scope, endpointName) here
        //  and route it into engine / sendTelegram / forwardPending instead of the fake.
    }
}
