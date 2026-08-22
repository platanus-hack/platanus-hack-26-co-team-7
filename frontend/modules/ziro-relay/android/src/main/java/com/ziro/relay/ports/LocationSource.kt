package com.ziro.relay.ports

import com.ziro.relay.domain.GeoPoint

/**
 * PORT — where this node believes it is, right now.
 *
 * [current] is deliberately NOT suspend and deliberately nullable: it is read on the path
 * that creates a telegram, and blocking the mesh on a satellite lock is how an emergency
 * app misses the emergency. A telegram with a slightly old fix beats no telegram.
 *
 * [start] and [stop] bracket active tracking. They exist because the presence heartbeat
 * repeats itself over an hour, and a repeat is only worth sending if the coordinates
 * actually moved — a purely cached fix would make every repeat identical.
 */
interface LocationSource {

    fun current(): GeoPoint?

    /** Begin tracking. Safe to call twice. */
    fun start() = Unit

    /** Stop tracking and release the radio. Safe to call without [start]. */
    fun stop() = Unit
}
