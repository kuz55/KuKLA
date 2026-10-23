package com.smartcam.assistant.presentation.overlay

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smartcam.assistant.domain.model.ExposureAnalysis
import com.smartcam.assistant.presentation.theme.AlertCrimson
import com.smartcam.assistant.presentation.theme.CinemaAmber
import com.smartcam.assistant.presentation.theme.HudBorder
import com.smartcam.assistant.presentation.theme.HudSurface
import com.smartcam.assistant.presentation.theme.ShadowCyan
import java.util.Locale

/**
 * Живая гистограмма яркости (256 bins) в стиле беззеркальных камер Sony / Fujifilm.
 * Использует graphicsLayer() для изоляции GPU-перерисовки без рекомпозиции родительского экрана.
 */
@Composable
fun HistogramHudCard(
    exposure: ExposureAnalysis,
    processingTimeMs: Float,
    analysisFps: Float,
    modifier: Modifier = Modifier
) {
    val shape = RoundedCornerShape(12.dp)
    val hasHighlightClip = exposure.highlightClippingRatio >= 0.025f
    val hasShadowClip = exposure.shadowClippingRatio >= 0.06f

    Column(
        modifier = modifier
            .width(172.dp)
            .clip(shape)
            .background(HudSurface)
            .border(1.dp, HudBorder, shape)
            .padding(horizontal = 10.dp, vertical = 8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "LUMA HIST",
                style = TextStyle(
                    color = Color.White.copy(alpha = 0.78f),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.8.sp
                )
            )
            Text(
                text = String.format(Locale.US, "%.1fms · %dHz", processingTimeMs, analysisFps.toInt()),
                style = TextStyle(
                    color = CinemaAmber,
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace,
                    fontFeatureSettings = "tnum"
                )
            )
        }

        Spacer(modifier = Modifier.height(5.dp))

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
                .graphicsLayer()
        ) {
            val w = size.width
            val h = size.height
            val bins = exposure.histogram

            // Сетка зон экспозиции (25%, 50%, 75% IRE)
            for (quarter in 1..3) {
                val x = w * (quarter / 4f)
                drawLine(
                    color = Color.White.copy(alpha = 0.14f),
                    start = Offset(x, 0f),
                    end = Offset(x, h),
                    strokeWidth = 1f
                )
            }

            // Цветовая подсветка краёв при клиппинге теней или светов
            if (hasShadowClip) {
                drawRect(
                    color = ShadowCyan.copy(alpha = 0.25f),
                    topLeft = Offset.Zero,
                    size = Size(w * 0.05f, h)
                )
            }
            if (hasHighlightClip) {
                drawRect(
                    color = AlertCrimson.copy(alpha = 0.30f),
                    topLeft = Offset(w * 0.95f, 0f),
                    size = Size(w * 0.05f, h)
                )
            }

            if (bins.isNotEmpty()) {
                val fillPath = Path()
                val strokePath = Path()
                val count = bins.size
                fillPath.moveTo(0f, h)

                for (i in 0 until count) {
                    val x = (i.toFloat() / (count - 1)) * w
                    val y = h - (bins[i].coerceIn(0f, 1f) * (h - 2f))
                    fillPath.lineTo(x, y)
                    if (i == 0) strokePath.moveTo(x, y) else strokePath.lineTo(x, y)
                }
                fillPath.lineTo(w, h)
                fillPath.close()

                drawPath(
                    path = fillPath,
                    brush = Brush.verticalGradient(
                        colors = listOf(
                            Color.White.copy(alpha = 0.68f),
                            Color.White.copy(alpha = 0.10f)
                        )
                    )
                )
                drawPath(
                    path = strokePath,
                    color = Color.White.copy(alpha = 0.92f),
                    style = Stroke(width = 1.4.dp.toPx())
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = String.format(Locale.US, "SHD %.0f%%", exposure.shadowClippingRatio * 100f),
                style = TextStyle(
                    color = if (hasShadowClip) ShadowCyan else Color.White.copy(alpha = 0.6f),
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    fontFeatureSettings = "tnum"
                )
            )
            Text(
                text = "Y:${exposure.meanLuminance.toInt()}",
                style = TextStyle(
                    color = Color.White.copy(alpha = 0.72f),
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    fontFeatureSettings = "tnum"
                )
            )
            Text(
                text = String.format(Locale.US, "HLT %.0f%%", exposure.highlightClippingRatio * 100f),
                style = TextStyle(
                    color = if (hasHighlightClip) AlertCrimson else Color.White.copy(alpha = 0.6f),
                    fontSize = 9.sp,
                    fontFamily = FontFamily.Monospace,
                    fontFeatureSettings = "tnum"
                )
            )
        }
    }
}
