package com.smartcam.assistant.presentation.overlay

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.smartcam.assistant.domain.model.CompositionAnalysis
import com.smartcam.assistant.domain.model.GuideOverlayType
import com.smartcam.assistant.domain.model.SubjectRegion
import com.smartcam.assistant.presentation.theme.AlertCrimson
import com.smartcam.assistant.presentation.theme.CinemaAmber
import com.smartcam.assistant.presentation.theme.EmeraldGood
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Комплексный композиционный Canvas-оверлей реального времени:
 * 1) Направляющие линии: Правило третей / Золотое сечение (+ спираль Фибоначчи) / Диагонали;
 * 2) Интерактивный авиагоризонт (зелёный при <= 2.0°, янтарно-красный при завале > 2.0°);
 * 3) Рамка доминирующего объекта + вектор наведения к ближайшему узлу правила третей.
 */
@Composable
fun CompositionGuidesOverlay(
    guideType: GuideOverlayType,
    composition: CompositionAnalysis,
    focusTapPoint: Offset?,
    modifier: Modifier = Modifier
) {
    Canvas(
        modifier = modifier
            .fillMaxSize()
            .graphicsLayer()
    ) {
        // 1. Базовая композиционная сетка
        when (guideType) {
            GuideOverlayType.RULE_OF_THIRDS -> drawRuleOfThirdsGrid()
            GuideOverlayType.GOLDEN_RATIO -> drawGoldenRatioGridAndSpiral()
            GuideOverlayType.DIAGONALS -> drawDiagonalGuides()
            GuideOverlayType.NONE -> Unit
        }

        // 2. Виртуальный уровень горизонта
        if (composition.horizonDetected) {
            drawHorizonIndicator(composition)
        }

        // 3. Доминирующий объект и вектор до точки силы правила третей
        composition.dominantSubject?.let { subject ->
            drawDominantSubjectGuide(subject)
        }

        // 4. Индикатор ручного тапа фокусировки / автоэкспозиции (AF/AE)
        focusTapPoint?.let { tap ->
            drawFocusMeteringReticle(tap)
        }
    }
}

private fun DrawScope.drawRuleOfThirdsGrid() {
    val gridColor = Color.White.copy(alpha = 0.42f)
    val shadowColor = Color.Black.copy(alpha = 0.35f)
    val strokePx = 1.dp.toPx()

    val x1 = size.width / 3f
    val x2 = size.width * 2f / 3f
    val y1 = size.height / 3f
    val y2 = size.height * 2f / 3f

    for (x in listOf(x1, x2)) {
        drawLine(shadowColor, Offset(x + 1f, 0f), Offset(x + 1f, size.height), strokeWidth = strokePx + 1f)
        drawLine(gridColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = strokePx)
    }
    for (y in listOf(y1, y2)) {
        drawLine(shadowColor, Offset(0f, y + 1f), Offset(size.width, y + 1f), strokeWidth = strokePx + 1f)
        drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = strokePx)
    }

    // Узлы пересечений («Точки силы»)
    val crossArm = 7.dp.toPx()
    for (px in listOf(x1, x2)) {
        for (py in listOf(y1, y2)) {
            drawCircle(
                color = Color.White.copy(alpha = 0.55f),
                radius = 3.dp.toPx(),
                center = Offset(px, py)
            )
            drawLine(
                color = Color.White.copy(alpha = 0.65f),
                start = Offset(px - crossArm, py),
                end = Offset(px + crossArm, py),
                strokeWidth = strokePx
            )
            drawLine(
                color = Color.White.copy(alpha = 0.65f),
                start = Offset(px, py - crossArm),
                end = Offset(px, py + crossArm),
                strokeWidth = strokePx
            )
        }
    }
}

private fun DrawScope.drawGoldenRatioGridAndSpiral() {
    val phiInv = 0.618034f
    val comp = 1f - phiInv // ~0.381966f
    val lineColor = CinemaAmber.copy(alpha = 0.48f)
    val strokePx = 1.dp.toPx()

    // Phi-сетка (1 : 0.618 : 1)
    for (fx in listOf(comp, phiInv)) {
        val x = size.width * fx
        drawLine(lineColor, Offset(x, 0f), Offset(x, size.height), strokeWidth = strokePx)
    }
    for (fy in listOf(comp, phiInv)) {
        val y = size.height * fy
        drawLine(lineColor, Offset(0f, y), Offset(size.width, y), strokeWidth = strokePx)
    }

    // Спираль Фибоначчи из последовательных дуг 90° внутри сжимающегося золотого прямоугольника
    var left = 0f
    var top = 0f
    var right = size.width
    var bottom = size.height
    val spiralPath = Path()

    for (step in 0 until 7) {
        val w = right - left
        val h = bottom - top
        if (w < 6f || h < 6f) break

        when (step % 4) {
            0 -> {
                val splitY = bottom - h * phiInv
                spiralPath.arcTo(
                    rect = Rect(left, splitY - (bottom - splitY), left + 2f * w, bottom),
                    startAngleDegrees = 180f,
                    sweepAngleDegrees = -90f,
                    forceMoveTo = step == 0
                )
                bottom = splitY
            }
            1 -> {
                val splitX = left + w * phiInv
                spiralPath.arcTo(
                    rect = Rect(left, top, splitX + (splitX - left), top + 2f * h),
                    startAngleDegrees = 270f,
                    sweepAngleDegrees = -90f,
                    forceMoveTo = false
                )
                left = splitX
            }
            2 -> {
                val splitY = top + h * phiInv
                spiralPath.arcTo(
                    rect = Rect(right - 2f * w, top, right, splitY + (splitY - top)),
                    startAngleDegrees = 0f,
                    sweepAngleDegrees = -90f,
                    forceMoveTo = false
                )
                top = splitY
            }
            3 -> {
                val splitX = right - w * phiInv
                spiralPath.arcTo(
                    rect = Rect(splitX - (right - splitX), bottom - 2f * h, right, bottom),
                    startAngleDegrees = 90f,
                    sweepAngleDegrees = -90f,
                    forceMoveTo = false
                )
                right = splitX
            }
        }
    }

    drawPath(
        path = spiralPath,
        color = CinemaAmber.copy(alpha = 0.72f),
        style = Stroke(width = 1.6.dp.toPx(), cap = StrokeCap.Round)
    )
}

private fun DrawScope.drawDiagonalGuides() {
    val primaryColor = Color.White.copy(alpha = 0.42f)
    val secondaryColor = CinemaAmber.copy(alpha = 0.34f)
    val strokePx = 1.dp.toPx()

    // Главные диагонали кадра
    drawLine(primaryColor, Offset(0f, 0f), Offset(size.width, size.height), strokeWidth = strokePx)
    drawLine(primaryColor, Offset(size.width, 0f), Offset(0f, size.height), strokeWidth = strokePx)

    // Диагонали барокко / синистер (треугольники композиции)
    drawLine(
        secondaryColor,
        Offset(0f, size.height * 0.35f),
        Offset(size.width * 0.65f, size.height),
        strokeWidth = strokePx
    )
    drawLine(
        secondaryColor,
        Offset(size.width * 0.35f, 0f),
        Offset(size.width, size.height * 0.65f),
        strokeWidth = strokePx
    )
}

private fun DrawScope.drawHorizonIndicator(composition: CompositionAnalysis) {
    val angle = composition.horizonAngleDegrees
    val isTilted = abs(angle) > 2.0f
    val statusColor = if (isTilted) AlertCrimson else EmeraldGood

    val center = Offset(size.width * 0.5f, size.height * 0.5f)
    val barHalfSpan = min(size.width, size.height) * 0.24f
    val outerTickGap = barHalfSpan + 14.dp.toPx()
    val outerTickLen = 18.dp.toPx()

    // Неподвижные эталонные риски идеального горизонта по бокам
    drawLine(
        color = Color.White.copy(alpha = 0.65f),
        start = Offset(center.x - outerTickGap - outerTickLen, center.y),
        end = Offset(center.x - outerTickGap, center.y),
        strokeWidth = 2.dp.toPx(),
        cap = StrokeCap.Round
    )
    drawLine(
        color = Color.White.copy(alpha = 0.65f),
        start = Offset(center.x + outerTickGap, center.y),
        end = Offset(center.x + outerTickGap + outerTickLen, center.y),
        strokeWidth = 2.dp.toPx(),
        cap = StrokeCap.Round
    )

    // Живая линия горизонта (наклоняется синхронно с линией в кадре)
    rotate(degrees = angle, pivot = center) {
        val innerGap = 16.dp.toPx()
        drawLine(
            color = statusColor,
            start = Offset(center.x - barHalfSpan, center.y),
            end = Offset(center.x - innerGap, center.y),
            strokeWidth = 2.8.dp.toPx(),
            cap = StrokeCap.Round
        )
        drawLine(
            color = statusColor,
            start = Offset(center.x + innerGap, center.y),
            end = Offset(center.x + barHalfSpan, center.y),
            strokeWidth = 2.8.dp.toPx(),
            cap = StrokeCap.Round
        )
        drawCircle(
            color = statusColor,
            radius = 4.dp.toPx(),
            center = center,
            style = Stroke(width = 2.dp.toPx())
        )
    }

    // Тонкая пунктирная проекция найденной линии горизонта на реальной высоте в кадре
    val detectedY = (composition.horizonVerticalOffset * size.height).coerceIn(0f, size.height)
    rotate(degrees = angle, pivot = Offset(size.width * 0.5f, detectedY)) {
        drawLine(
            color = statusColor.copy(alpha = 0.35f),
            start = Offset(0f, detectedY),
            end = Offset(size.width, detectedY),
            strokeWidth = 1.2.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(16f, 12f), 0f)
        )
    }
}

private fun DrawScope.drawDominantSubjectGuide(subject: SubjectRegion) {
    val isAligned = subject.distanceToPowerPoint <= 0.085f
    val accent = if (isAligned) EmeraldGood else CinemaAmber

    val left = subject.boxLeft * size.width
    val top = subject.boxTop * size.height
    val right = subject.boxRight * size.width
    val bottom = subject.boxBottom * size.height
    val cornerLen = min(right - left, bottom - top).coerceAtLeast(24f) * 0.24f
    val strokeW = 2.2.dp.toPx()

    // Кинематографические угловые скобки вокруг доминирующего объекта
    // Верхний левый угол
    drawLine(accent, Offset(left, top), Offset(left + cornerLen, top), strokeWidth = strokeW, cap = StrokeCap.Round)
    drawLine(accent, Offset(left, top), Offset(left, top + cornerLen), strokeWidth = strokeW, cap = StrokeCap.Round)
    // Верхний правый угол
    drawLine(accent, Offset(right, top), Offset(right - cornerLen, top), strokeWidth = strokeW, cap = StrokeCap.Round)
    drawLine(accent, Offset(right, top), Offset(right, top + cornerLen), strokeWidth = strokeW, cap = StrokeCap.Round)
    // Нижний левый угол
    drawLine(accent, Offset(left, bottom), Offset(left + cornerLen, bottom), strokeWidth = strokeW, cap = StrokeCap.Round)
    drawLine(accent, Offset(left, bottom), Offset(left, bottom - cornerLen), strokeWidth = strokeW, cap = StrokeCap.Round)
    // Нижний правый угол
    drawLine(accent, Offset(right, bottom), Offset(right - cornerLen, bottom), strokeWidth = strokeW, cap = StrokeCap.Round)
    drawLine(accent, Offset(right, bottom), Offset(right, bottom - cornerLen), strokeWidth = strokeW, cap = StrokeCap.Round)

    val center = Offset(subject.centerX * size.width, subject.centerY * size.height)
    val powerPoint = Offset(
        subject.nearestPowerPointX * size.width,
        subject.nearestPowerPointY * size.height
    )

    // Центр масс объекта
    drawCircle(color = accent, radius = 4.5.dp.toPx(), center = center)

    // Целевое кольцо в ближайшем узле правила третей
    drawCircle(
        color = EmeraldGood,
        radius = 10.dp.toPx(),
        center = powerPoint,
        style = Stroke(width = 2.dp.toPx())
    )
    drawCircle(
        color = EmeraldGood.copy(alpha = 0.22f),
        radius = 10.dp.toPx(),
        center = powerPoint
    )

    // Пунктирная стрелка подсказки от центра объекта к узлу третей
    if (!isAligned) {
        drawLine(
            color = CinemaAmber.copy(alpha = 0.9f),
            start = center,
            end = powerPoint,
            strokeWidth = 2.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 9f), 0f),
            cap = StrokeCap.Round
        )
        val theta = atan2(powerPoint.y - center.y, powerPoint.x - center.x)
        val headLen = 9.dp.toPx()
        val wing1 = Offset(
            powerPoint.x - headLen * cos(theta - 0.5f),
            powerPoint.y - headLen * sin(theta - 0.5f)
        )
        val wing2 = Offset(
            powerPoint.x - headLen * cos(theta + 0.5f),
            powerPoint.y - headLen * sin(theta + 0.5f)
        )
        drawLine(CinemaAmber, powerPoint, wing1, strokeWidth = 2.dp.toPx(), cap = StrokeCap.Round)
        drawLine(CinemaAmber, powerPoint, wing2, strokeWidth = 2.dp.toPx(), cap = StrokeCap.Round)
    }
}

private fun DrawScope.drawFocusMeteringReticle(tap: Offset) {
    val radius = 26.dp.toPx()
    drawCircle(
        color = CinemaAmber,
        radius = radius,
        center = tap,
        style = Stroke(width = 1.8.dp.toPx())
    )
    drawCircle(
        color = CinemaAmber,
        radius = 3.dp.toPx(),
        center = tap
    )
}
