package me.groundwire.drive.store

/** A logged-in ship: where it is, who it is, and the eyre cookie. */
data class Session(
    val baseUrl: String,
    /** "~ship" */
    val ship: String,
    val cookie: String,
) {
    fun save(store: SettingsStore) {
        store.put(KEY_URL, baseUrl)
        store.put(KEY_SHIP, ship)
        store.put(KEY_COOKIE, cookie)
    }

    companion object {
        private const val KEY_URL = "session.url"
        private const val KEY_SHIP = "session.ship"
        private const val KEY_COOKIE = "session.cookie"

        fun load(store: SettingsStore): Session? {
            val url = store.get(KEY_URL) ?: return null
            val ship = store.get(KEY_SHIP) ?: return null
            val cookie = store.get(KEY_COOKIE) ?: return null
            return Session(url, ship, cookie)
        }

        fun clear(store: SettingsStore) {
            store.put(KEY_URL, null)
            store.put(KEY_SHIP, null)
            store.put(KEY_COOKIE, null)
        }
    }
}
