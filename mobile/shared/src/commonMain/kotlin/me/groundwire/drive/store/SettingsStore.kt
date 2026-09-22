package me.groundwire.drive.store

/** A tiny string key-value store: the session, and per-room read marks. */
interface SettingsStore {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

/** The platform's store: SharedPreferences, a properties file, NSUserDefaults. */
expect fun platformSettingsStore(): SettingsStore

/** In-memory store for tests. */
class MemorySettingsStore : SettingsStore {
    private val map = mutableMapOf<String, String>()
    override fun get(key: String) = map[key]
    override fun put(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}
