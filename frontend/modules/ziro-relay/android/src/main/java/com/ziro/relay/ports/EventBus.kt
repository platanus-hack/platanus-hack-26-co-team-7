package com.ziro.relay.ports

import com.ziro.relay.domain.RelayEvent
import kotlinx.coroutines.flow.SharedFlow

/**
 * PORT — one writer, many readers.
 *
 * Developer A drops events in from the Nearby callbacks. Developer B collects them in
 * the UI. Neither knows the other exists, which is why B can build and test against
 * FakeEventBus with no phone, no radio and no code from A.
 *
 * [emit] is intentionally NOT suspend: it is called from Nearby callbacks, which are
 * plain synchronous methods. Implementations use tryEmit over a buffered
 * MutableSharedFlow. An event dropped under buffer pressure is acceptable; blocking a
 * radio callback is not.
 */
interface EventBus {
    val events: SharedFlow<RelayEvent>
    fun emit(event: RelayEvent)
}
