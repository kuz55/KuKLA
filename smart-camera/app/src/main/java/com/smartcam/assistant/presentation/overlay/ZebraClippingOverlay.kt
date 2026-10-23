package com.smartcam.assistant.presentation.overlay

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import com.smartcam.assistant.domain.model.ExposureAnalysis
import com.smartcam.assistant.presentation.theme.AlertCrimson
import com.smartcam.assistant.presentation.theme.ShadowCyan

/**
 * Оверлей «Зебры» (Zebra Pattern) поверх превью камеры:
 * - Выбитые света (mask == 1): тёпло-красная заливка + диагональная штриховка 45°;
 * - Провалы в тенях (mask == -1): холодно-голубая подсветка.
 *
 * Оптимизация FPS: соседние ячейки одного типа в строке объединяются (Run-Length Encoding),
 * снижая количество вызовов Canvas drawRect/clipRect в 6–12 раз.
 */
@Composable
fun ZebraClippingOverlay(
    exposure: ExposureAnalysis,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    if (!enabled || exposure.zebraMask.isEmpty()) return

    val infiniteTransition = rememberInfiniteTransition(label = "zebraShift")
    val phaseShift by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 18f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 650, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "zebraStripePhase"
    )

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .graphicsLayer()
    ) {
        val cols = exposure.zebraGridCols
        val rows = exposure.zebraGridRows
        val mask = exposure.zebraMask
        if (cols <= 0 || rows <= 0 || mask.size < cols * rows) return@Canvas

        val cellW = size.width / cols
        val cellH = size.height / rows
        val stripeSpacing = 18f

        for (r in 0 until rows) {
            val rowTop = r * cellH
            var c = 0
            while (c < cols) {
                val state = mask[r * cols + c]
                if (state == 0) {
                    c++
                    continue
                }
                var runEnd = c + 1
                while (runEnd < cols && mask[r * cols + runEnd] == state) {
                    runEnd++
                }

                val left = c * cellW
                val spanWidth = (runEnd - c) * cellW
                val right = left + spanWidth
                val bottom = rowTop + cellH

                val fillColor = if (state > 0) {
                    AlertCrimson.copy(alpha = 0.24f)
                } else {
                    ShadowCyan.copy(alpha = 0.20f)
                }
                val stripeColor = if (state > 0) {
                    Color(0xDCFFECEC)
                } else {
                    Color(0xB8BAE6FD)
                }

                drawRect(
                    color = fillColor,
                    topLeft = Offset(left, rowTop),
                    size = Size(spanWidth, cellH)
                )

                clipRect(left = left, top = rowTop, right = right, bottom = bottom) {
                    var sx = left - cellH + phaseShift
                    while (sx < right + cellH) {
                        drawLine(
                            color = stripeColor,
                            start = Offset(sx, bottom),
                            end = Offset(sx + cellH, rowTop),
                            strokeWidth = 2.2f
                        )
                        sx += stripeSpacing
                    }
                }

                c = runEnd
            }
        }
    }
}
