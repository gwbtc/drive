package me.groundwire.drive.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Orange = Color(0xFFF2842C)
private val OrangeDark = Color(0xFFFFA65C)

private val Light = lightColorScheme(
    primary = Orange,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDCC4),
    onPrimaryContainer = Color(0xFF331200),
    secondaryContainer = Color(0xFFEDE7E1),
    surface = Color(0xFFFCFAF7),
    background = Color(0xFFFCFAF7),
)

private val Dark = darkColorScheme(
    primary = OrangeDark,
    onPrimary = Color(0xFF3B1A00),
    primaryContainer = Color(0xFF6B3A10),
    onPrimaryContainer = Color(0xFFFFDCC4),
    secondaryContainer = Color(0xFF2A2A2E),
    surface = Color(0xFF151518),
    background = Color(0xFF151518),
)

@Composable
fun GwTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        content = content,
    )
}
