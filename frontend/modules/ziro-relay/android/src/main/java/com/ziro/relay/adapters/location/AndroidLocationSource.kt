package com.ziro.relay.adapters.location

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import com.ziro.relay.domain.GeoPoint
import com.ziro.relay.ports.LocationSource

/**
 * Position from the platform, tracked while the relay is on. Owner: developer A.
 *
 * Four choices worth knowing:
 *
 * - LocationManager, not FusedLocationProviderClient. Fused is another Play Services
 *   dependency with an async-only API; this one is synchronous to read and already
 *   available, which is what a port that must not block the mesh needs.
 *
 * - GPS AND network providers, both subscribed. GPS is the accurate one and the one that
 *   dies indoors, which is exactly where a collapsed building leaves people. Network
 *   positioning is coarse but survives there.
 *
 * - [current] prefers a tracked fix and falls back to the platform cache, so the very
 *   first telegram still carries coordinates before any update has arrived.
 *
 * - Every call is wrapped against SecurityException. ACCESS_FINE_LOCATION is granted
 *   before start(), but a user can revoke it from Settings while the service runs, and a
 *   revoked permission must degrade the telegram rather than crash the relay.
 */
class AndroidLocationSource(private val context: Context) : LocationSource {

    @Volatile private var tracked: GeoPoint? = null
    @Volatile private var tracking = false

    private val manager: LocationManager?
        get() = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            tracked = GeoPoint(lat = location.latitude, lng = location.longitude)
        }

        // Required explicitly: these only became default methods in API 30, and this
        // module ships down to 26. Omitting them is an AbstractMethodError on old phones.
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
    }

    override fun start() {
        if (tracking) return
        val locationManager = manager ?: return
        tracking = true
        for (provider in PROVIDERS) {
            try {
                if (!locationManager.isProviderEnabled(provider)) continue
                locationManager.requestLocationUpdates(
                    provider, MIN_INTERVAL_MS, MIN_DISTANCE_METRES, listener, Looper.getMainLooper(),
                )
            } catch (ignored: SecurityException) {
                // Permission revoked mid-session. current() degrades to null; the mesh lives on.
            } catch (ignored: IllegalArgumentException) {
                // Provider missing on this device. The other one may still work.
            }
        }
    }

    override fun stop() {
        tracking = false
        try {
            manager?.removeUpdates(listener)
        } catch (ignored: SecurityException) {
            // Nothing to release if the permission is already gone.
        }
    }

    override fun current(): GeoPoint? = tracked ?: lastKnown()

    /** The most recent fix any provider already had, newest wins. */
    private fun lastKnown(): GeoPoint? {
        val locationManager = manager ?: return null
        return locationManager.allProviders
            .mapNotNull { provider -> runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time }
            ?.let { GeoPoint(lat = it.latitude, lng = it.longitude) }
    }

    private companion object {
        val PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        const val MIN_INTERVAL_MS = 30_000L
        const val MIN_DISTANCE_METRES = 10f
    }
}
