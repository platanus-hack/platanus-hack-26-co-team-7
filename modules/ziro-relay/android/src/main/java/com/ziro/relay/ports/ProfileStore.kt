package com.ziro.relay.ports

import com.ziro.relay.domain.Profile

/**
 * PORT — the onboarding profile.
 *
 * MVP implementation is a hardcoded constant. Phase 5 swaps in SQLCipher-backed
 * storage. The profile never crosses this boundary in serialised form.
 */
interface ProfileStore {
    suspend fun get(): Profile?
    suspend fun save(profile: Profile)
}
