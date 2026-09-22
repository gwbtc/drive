package me.groundwire.drive

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import me.groundwire.drive.store.Connection

/**
 * The no-server notification path: a foreground service that keeps the
 * store's feed connection alive while the app is in the background and
 * turns new messages into notifications.
 *
 * It costs one persistent, silent "connected" notification, which is
 * the price Android charges for a process that stays up. What it does
 * not survive is the OS deciding to kill it anyway (aggressive OEMs,
 * force-stop); see docs/mobile-notifications.md in the repo for the tiers above this.
 */
class ChatSyncService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val store get() = ChatApplication.instance.store

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(Notifier.ID_SERVICE, serviceNotification("connecting…"), foregroundType())
        scope.launch {
            store.connection.collect { c ->
                val text = when (c) {
                    Connection.Live -> "Connected to ${store.our ?: "your ship"}"
                    Connection.Connecting -> "Connecting…"
                    is Connection.Down -> "Offline: ${c.reason}"
                    Connection.Off -> "Idle"
                }
                Notifier.manager(this@ChatSyncService).notify(Notifier.ID_SERVICE, serviceNotification(text))
            }
        }
        scope.launch {
            store.newMessages.collect { Notifier.newMessage(this@ChatSyncService, it) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (store.session.value == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        store.start()
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun foregroundType(): Int =
        if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0

    private fun serviceNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, Notifier.CHANNEL_SERVICE)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("Groundwire Drive")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .build()
    }

    companion object {
        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, ChatSyncService::class.java))
        }
    }
}
