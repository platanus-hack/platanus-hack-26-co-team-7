package com.ziro.relay.adapters.service

import android.app.Service
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.ziro.relay.RelayContainer

/**
 * SCAFFOLD - developer A implements this in phase 2. Owner: developer A.
 *
 * Keeps advertising and discovery alive while the app is not in the foreground. Android
 * pauses Nearby discovery for backgrounded apps, so without this the mesh only works
 * with the screen on and the app open.
 *
 * The landmine to know about up front: on Android 14+ startForeground() THROWS unless the
 * manifest declares android:foregroundServiceType AND the app holds the matching typed
 * permission. Both are already set - foregroundServiceType="connectedDevice" and
 * FOREGROUND_SERVICE_CONNECTED_DEVICE - so do not remove them while debugging a crash
 * here.
 *
 * Android 13+ also needs POST_NOTIFICATIONS granted at runtime, or the required
 * notification never shows.
 */
class RelayForegroundService : Service() {
    private var relayStarted = false

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startInForeground()
        RelayContainer.attach(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        RelayContainer.attach(applicationContext)
        if (!relayStarted) {
            RelayContainer.engine.start()
            relayStarted = true
        }
        return START_STICKY
    }

    override fun onDestroy() {
        if (relayStarted) {
            RelayContainer.engine.stop()
            relayStarted = false
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startInForeground() {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("ZIRO relay active")
            .setContentText("Discovering nearby emergency relays")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "ZIRO relay", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "ziro_relay"
        const val NOTIFICATION_ID = 1
    }
}
