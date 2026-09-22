package me.groundwire.drive.ui

import androidx.compose.runtime.Composable

/** No system back gesture on the JVM; the top-bar button is the way back. */
@Composable
actual fun PlatformBackHandler(enabled: Boolean, onBack: () -> Unit) = Unit
