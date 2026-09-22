package me.groundwire.drive.ui

import androidx.compose.runtime.Composable

/** iOS: the room screen's own back button; no system gesture wiring yet. */
@Composable
actual fun PlatformBackHandler(enabled: Boolean, onBack: () -> Unit) = Unit
