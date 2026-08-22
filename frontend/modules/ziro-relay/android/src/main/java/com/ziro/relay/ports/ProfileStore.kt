package com.ziro.relay.ports

import com.ziro.relay.domain.Profile

/**
 * PORT — the onboarding profile.
 *
 * The MVP implementation is durable SQLite storage (unencrypted). The profile never crosses
 * the relay boundary in serialised form.
 */
interface ProfileStore {
    suspend fun get(): Profile?
    suspend fun save(profile: Profile)
}
