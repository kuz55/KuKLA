package com.smartcam.assistant.domain.usecase

import com.smartcam.assistant.domain.model.CoachingHint
import com.smartcam.assistant.domain.model.CompositionAnalysis
import com.smartcam.assistant.domain.model.ExposureAnalysis
import com.smartcam.assistant.domain.model.HintCategory
import com.smartcam.assistant.domain.model.HintSeverity
import java.util.Locale
import javax.inject.Inject
import kotlin.math.abs

/**
 * Доменный UseCase интерпретации метрик кадра в человекочитаемые подсказки
 * с гистерезисом (защита от мерцания текста на пограничных значениях).
 */
class EvaluateCoachingHintsUseCase @Inject constructor() {

    private var wasHorizonTilted: Boolean = false
    private var wasHighlightClipped: Boolean = false
    private var wasShadowClipped: Boolean = false

    operator fun invoke(
        exposure: ExposureAnalysis,
        composition: CompositionAnalysis
    ): List<CoachingHint> {
        val hints = ArrayList<CoachingHint>(3)

        // 1. Оценка экспозиции и клиппинга с гистерезисом
        wasHighlightClipped = if (wasHighlightClipped) {
            exposure.highlightClippingRatio >= HIGHLIGHT_CLIP_CLEAR_THRESHOLD
        } else {
            exposure.highlightClippingRatio >= HIGHLIGHT_CLIP_ENTER_THRESHOLD
        }

        wasShadowClipped = if (wasShadowClipped) {
            exposure.shadowClippingRatio >= SHADOW_CLIP_CLEAR_THRESHOLD
        } else {
            exposure.shadowClippingRatio >= SHADOW_CLIP_ENTER_THRESHOLD
        }

        when {
            wasHighlightClipped -> {
                val pct = String.format(Locale.US, "%.1f%%", exposure.highlightClippingRatio * 100f)
                hints += CoachingHint(
                    category = HintCategory.EXPOSURE,
                    severity = HintSeverity.WARNING,
                    message = "Снизьте экспокоррекцию: пересвет в светах",
                    actionDetail = "Клиппинг светов ($pct) выделен «зеброй»"
                )
            }
            wasShadowClipped -> {
                val pct = String.format(Locale.US, "%.1f%%", exposure.shadowClippingRatio * 100f)
                hints += CoachingHint(
                    category = HintCategory.EXPOSURE,
                    severity = HintSeverity.WARNING,
                    message = "Провал в тенях: добавьте свет или поднимите EV",
                    actionDetail = "Потеря деталей в глубоких тенях ($pct)"
                )
            }
            exposure.meanLuminance < DARK_SCENE_MEAN_THRESHOLD -> {
                hints += CoachingHint(
                    category = HintCategory.EXPOSURE,
                    severity = HintSeverity.INFO,
                    message = "Кадр темноват — увеличьте экспокоррекцию (+EV)",
                    actionDetail = "Средняя яркость: ${exposure.meanLuminance.toInt()}/255"
                )
            }
            exposure.meanLuminance > BRIGHT_SCENE_MEAN_THRESHOLD -> {
                hints += CoachingHint(
                    category = HintCategory.EXPOSURE,
                    severity = HintSeverity.INFO,
                    message = "Снизьте экспокоррекцию (-EV) для сохранения полутонов",
                    actionDetail = "Средняя яркость: ${exposure.meanLuminance.toInt()}/255"
                )
            }
            else -> {
                hints += CoachingHint(
                    category = HintCategory.EXPOSURE,
                    severity = HintSeverity.GOOD,
                    message = "Экспозиция и тени в норме",
                    actionDetail = "Света и тени без клиппинга"
                )
            }
        }

        // 2. Оценка линии горизонта (порог отклонения > 2.0° + гистерезис 1.6°)
        if (composition.horizonDetected) {
            val absAngle = abs(composition.horizonAngleDegrees)
            wasHorizonTilted = if (wasHorizonTilted) {
                absAngle > HORIZON_CLEAR_DEGREES
            } else {
                absAngle > HORIZON_TRIGGER_DEGREES
            }

            val formattedAngle = String.format(Locale.US, "%.1f°", absAngle)
            if (wasHorizonTilted) {
                val direction = if (composition.horizonAngleDegrees > 0f) {
                    "против часовой стрелки"
                } else {
                    "по часовой стрелке"
                }
                hints += CoachingHint(
                    category = HintCategory.HORIZON,
                    severity = HintSeverity.WARNING,
                    message = "Выровняйте горизонт",
                    actionDetail = "Отклонение $formattedAngle — слегка наклоните камеру $direction"
                )
            } else {
                hints += CoachingHint(
                    category = HintCategory.HORIZON,
                    severity = HintSeverity.GOOD,
                    message = "Горизонт выровнен ($formattedAngle)",
                    actionDetail = null
                )
            }
        }

        // 3. Оценка положения доминирующего объекта относительно узлов правила третей
        composition.dominantSubject?.let { subject ->
            if (subject.distanceToPowerPoint <= POWER_POINT_LOCK_RADIUS) {
                hints += CoachingHint(
                    category = HintCategory.SUBJECT_PLACEMENT,
                    severity = HintSeverity.GOOD,
                    message = "Объект в точке силы правила третей",
                    actionDetail = "Композиционный баланс достигнут"
                )
            } else {
                val dx = subject.nearestPowerPointX - subject.centerX
                val dy = subject.nearestPowerPointY - subject.centerY
                val horizontalStep = when {
                    dx > 0.05f -> "левее"
                    dx < -0.05f -> "правее"
                    else -> null
                }
                val verticalStep = when {
                    dy > 0.05f -> "выше"
                    dy < -0.05f -> "ниже"
                    else -> null
                }
                val moveDirection = listOfNotNull(horizontalStep, verticalStep)
                    .joinToString(" и ")
                    .ifEmpty { "ближе к пересечению линий" }

                hints += CoachingHint(
                    category = HintCategory.SUBJECT_PLACEMENT,
                    severity = HintSeverity.INFO,
                    message = "Разместите объект на пересечении третей",
                    actionDetail = "Сместите ракурс чуть $moveDirection до зелёного маркера"
                )
            }
        }

        return hints
    }

    companion object {
        const val HIGHLIGHT_CLIP_ENTER_THRESHOLD = 0.035f
        const val HIGHLIGHT_CLIP_CLEAR_THRESHOLD = 0.020f
        const val SHADOW_CLIP_ENTER_THRESHOLD = 0.085f
        const val SHADOW_CLIP_CLEAR_THRESHOLD = 0.055f
        const val DARK_SCENE_MEAN_THRESHOLD = 55f
        const val BRIGHT_SCENE_MEAN_THRESHOLD = 205f
        const val HORIZON_TRIGGER_DEGREES = 2.0f
        const val HORIZON_CLEAR_DEGREES = 1.6f
        const val POWER_POINT_LOCK_RADIUS = 0.085f
    }
}
