package me.groundwire.drive.ui

import androidx.compose.runtime.Composable

/**
 * The system back gesture. Android has one; the JVM has none; iOS has
 * an edge swipe that Compose does not surface here, so the room screen
 * keeps its own back button in the top bar.
 */
@Composable
expect fun PlatformBackHandler(enabled: Boolean, onBack: () -> Unit)
