package me.groundwire.drive

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import me.groundwire.drive.drive.RoomId
import me.groundwire.drive.ui.App

class MainActivity : ComponentActivity() {
    private val store get() = ChatApplication.instance.store

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { App(store) }
        openRoomFrom(intent)

        // Once a session exists: the service, the notification permission,
        // and one offer to exempt the app from battery optimisation, without
        // which many phones kill the service within the hour.
        lifecycleScope.launch {
            store.session.filterNotNull().collect {
                ChatSyncService.start(this@MainActivity)
                requestNotificationPermission()
                offerBatteryExemptionOnce()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openRoomFrom(intent)
    }

    override fun onResume() {
        super.onResume()
        if (store.session.value != null) store.start()
    }

    private fun openRoomFrom(intent: Intent?) {
        val key = intent?.getStringExtra(EXTRA_ROOM) ?: return
        RoomId.fromKey(key)?.let { store.openRequest.value = it }
        Notifier.clear(this, key)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun offerBatteryExemptionOnce() {
        val prefs = getSharedPreferences("drive-mobile", MODE_PRIVATE)
        if (prefs.getBoolean("asked.battery", false)) return
        prefs.edit().putBoolean("asked.battery", true).apply()
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        runCatching {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName")),
            )
        }
    }

    companion object {
        const val EXTRA_ROOM = "room"
    }
}
