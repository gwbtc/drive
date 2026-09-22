package me.groundwire.drive.store

import platform.Foundation.NSUserDefaults

/** NSUserDefaults. Untested until the iOS shell exists; see docs/mobile-ios.md. */
class IosSettingsStore : SettingsStore {
    private val defaults = NSUserDefaults.standardUserDefaults

    override fun get(key: String): String? = defaults.stringForKey(key)

    override fun put(key: String, value: String?) {
        if (value == null) defaults.removeObjectForKey(key) else defaults.setObject(value, key)
    }
}

actual fun platformSettingsStore(): SettingsStore = IosSettingsStore()
