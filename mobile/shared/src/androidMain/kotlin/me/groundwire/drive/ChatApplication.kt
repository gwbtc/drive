package me.groundwire.drive

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import me.groundwire.drive.store.ChatStore
import me.groundwire.drive.store.platformSettingsStore

/**
 * Owns the one [ChatStore] the activity and the sync service share, and
 * brings the service up on launch when a session exists.
 */
class ChatApplication : Application() {
    lateinit var store: ChatStore
        private set

    override fun onCreate() {
        super.onCreate()
        AppContext.init(this)
        instance = this
        store = ChatStore(platformSettingsStore(), CoroutineScope(SupervisorJob() + Dispatchers.IO))
        Notifier.createChannels(this)
        if (store.session.value != null) ChatSyncService.start(this)
    }

    companion object {
        lateinit var instance: ChatApplication
            private set
    }
}
