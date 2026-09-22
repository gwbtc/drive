package me.groundwire.drive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Brings the sync service back after a reboot, when a session exists. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (ChatApplication.instance.store.session.value == null) return
        ChatSyncService.start(context)
    }
}
