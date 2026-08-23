package com.ziro.relay.adapters.session

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class SecureSession(val accessToken: String, val refreshToken: String, val expiresIn: Int)

/** Credentials stay in Android Keystore-backed encrypted preferences, never SQLite or JS storage. */
class SecureSessionStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(context, "ziro_secure_session", MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(), EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    fun load(): SecureSession? {
        val access = preferences.getString("access", null) ?: return null
        val refresh = preferences.getString("refresh", null) ?: return null
        return SecureSession(access, refresh, preferences.getInt("expires", 0))
    }
    fun save(session: SecureSession) = preferences.edit().putString("access", session.accessToken).putString("refresh", session.refreshToken).putInt("expires", session.expiresIn).remove("role").apply()
    fun clear() = preferences.edit().clear().apply()
    fun apiBaseUrl(): String? = preferences.getString("api_base_url", null)
    fun saveApiBaseUrl(value: String) = preferences.edit().putString("api_base_url", value).apply()
}
