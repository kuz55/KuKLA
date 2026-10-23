package com.smartcam.assistant.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val CinemaAmber = Color(0xFFFFB800)
val EmeraldGood = Color(0xFF34D399)
val AlertCrimson = Color(0xFFEF4444)
val ShadowCyan = Color(0xFF38BDF8)
val HudSurface = Color(0xBD0D1117)
val HudBorder = Color(0x3DFFFFFF)

private val SmartCamDarkColorScheme = darkColorScheme(
    primary = CinemaAmber,
    onPrimary = Color(0xFF141414),
    secondary = EmeraldGood,
    onSecondary = Color(0xFF062117),
    background = Color(0xFF07090D),
    surface = Color(0xFF11161F),
    onBackground = Color(0xFFF3F4F6),
    onSurface = Color(0xFFF3F4F6),
    error = AlertCrimson
)

@Composable
fun SmartCamTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SmartCamDarkColorScheme,
        content = content
    )
}
