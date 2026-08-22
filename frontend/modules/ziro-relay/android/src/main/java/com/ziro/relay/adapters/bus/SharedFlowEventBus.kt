package com.ziro.relay.adapters.bus

import com.ziro.relay.domain.RelayEvent
import com.ziro.relay.ports.EventBus
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * The one and only real EventBus. Both the Nearby adapter and the fake transport push
 * through this - there is no such thing as a "fake bus", only fake producers.
 *
 * extraBufferCapacity plus DROP_OLDEST is deliberate: emit() is called from Nearby
 * callbacks, which are synchronous. Losing an old event under pressure is acceptable;
 * suspending a radio callback is not.
 *
 * replay = 1 so a Composable that subscribes late still sees the current situation
 * instead of an empty screen.
 */
class SharedFlowEventBus(
    replay: Int = 1,
    extraBufferCapacity: Int = 64,
) : EventBus {

    private val _events = MutableSharedFlow<RelayEvent>(
        replay = replay,
        extraBufferCapacity = extraBufferCapacity,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )

    override val events: SharedFlow<RelayEvent> = _events.asSharedFlow()

    override fun emit(event: RelayEvent) {
        _events.tryEmit(event)
    }
}
