package com.ziro.relay.adapters.service

import android.app.Service
import android.content.Intent
import android.os.IBinder

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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // TODO(A, phase 2): create the notification channel, call startForeground with
        //  FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, then container.engine.start().
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "ziro_relay"
        const val NOTIFICATION_ID = 1
    }
}
