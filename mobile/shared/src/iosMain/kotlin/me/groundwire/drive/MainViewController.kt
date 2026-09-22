package me.groundwire.drive

import androidx.compose.ui.window.ComposeUIViewController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import me.groundwire.drive.store.ChatStore
import me.groundwire.drive.store.platformSettingsStore
import me.groundwire.drive.ui.App
import platform.UIKit.UIViewController

/**
 * The entry point an iOS shell calls: `MainViewControllerKt.MainViewController()`
 * from Swift. The store lives for the process. No background delivery on
 * iOS without a push relay; see docs/mobile-notifications.md in the repo.
 */
object IosApp {
    val store: ChatStore by lazy {
        ChatStore(platformSettingsStore(), CoroutineScope(SupervisorJob() + Dispatchers.Default))
    }
}

@Suppress("unused", "FunctionName")
fun MainViewController(): UIViewController = ComposeUIViewController { App(IosApp.store) }
