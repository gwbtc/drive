package me.groundwire.drive.store

import android.content.Context
import me.groundwire.drive.AppContext

/**
 * SharedPreferences, private to the app. The eyre cookie is stored in
 * the clear here; an encrypted store is a later step (see README).
 */
class AndroidSettingsStore(context: Context) : SettingsStore {
    private val prefs = context.getSharedPreferences("drive-mobile", Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String?) {
        prefs.edit().apply {
            if (value == null) remove(key) else putString(key, value)
        }.apply()
    }
}

actual fun platformSettingsStore(): SettingsStore = AndroidSettingsStore(AppContext.app)
