package me.groundwire.drive.store

import java.io.File
import java.util.Properties

/** A properties file under ~/.drive-mobile; the JVM target exists for tests. */
class DesktopSettingsStore(private val file: File = File(System.getProperty("user.home"), ".drive-mobile/settings.properties")) : SettingsStore {
    private val props = Properties().apply {
        if (file.exists()) file.inputStream().use { load(it) }
    }

    override fun get(key: String): String? = props.getProperty(key)

    override fun put(key: String, value: String?) {
        if (value == null) props.remove(key) else props.setProperty(key, value)
        file.parentFile?.mkdirs()
        file.outputStream().use { props.store(it, null) }
    }
}

actual fun platformSettingsStore(): SettingsStore = DesktopSettingsStore()
