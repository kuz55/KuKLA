package com.smartcam.assistant.domain.usecase

import com.smartcam.assistant.domain.model.CompositionAnalysis
import com.smartcam.assistant.domain.model.ExposureAnalysis
import com.smartcam.assistant.domain.model.HintCategory
import com.smartcam.assistant.domain.model.HintSeverity
import com.smartcam.assistant.domain.model.SubjectRegion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EvaluateCoachingHintsUseCaseTest {

    @Test
    fun `triggers overexposure warning when highlight clipping exceeds threshold`() {
        val useCase = EvaluateCoachingHintsUseCase()
        val exposure = ExposureAnalysis(
            meanLuminance = 175f,
            highlightClippingRatio = 0.08f,
            shadowClippingRatio = 0.01f
        )

        val hints = useCase(exposure, CompositionAnalysis())
        val exposureHint = hints.first { it.category == HintCategory.EXPOSURE }

        assertEquals(HintSeverity.WARNING, exposureHint.severity)
        assertTrue(exposureHint.message.contains("Снизьте экспокоррекцию"))
    }

    @Test
    fun `horizon hint triggers above 2 degrees and respects anti-flicker hysteresis`() {
        val useCase = EvaluateCoachingHintsUseCase()

        // 1.4° -> горизонт ровный
        val levelHints = useCase(
            ExposureAnalysis(),
            CompositionAnalysis(horizonDetected = true, horizonAngleDegrees = 1.4f)
        )
        assertEquals(
            HintSeverity.GOOD,
            levelHints.first { it.category == HintCategory.HORIZON }.severity
        )

        // 4.8° -> срабатывает "Выровняйте горизонт"
        val tiltedHints = useCase(
            ExposureAnalysis(),
            CompositionAnalysis(horizonDetected = true, horizonAngleDegrees = 4.8f)
        )
        val horizonWarning = tiltedHints.first { it.category == HintCategory.HORIZON }
        assertEquals(HintSeverity.WARNING, horizonWarning.severity)
        assertEquals("Выровняйте горизонт", horizonWarning.message)

        // 1.8° -> внутри окна гистерезиса [1.6°..2.0°], предупреждение ещё удерживается без мерцания
        val hysteresisHints = useCase(
            ExposureAnalysis(),
            CompositionAnalysis(horizonDetected = true, horizonAngleDegrees = 1.8f)
        )
        assertEquals(
            HintSeverity.WARNING,
            hysteresisHints.first { it.category == HintCategory.HORIZON }.severity
        )

        // 1.2° -> ниже порога 1.6°, снова зелёный статус
        val clearedHints = useCase(
            ExposureAnalysis(),
            CompositionAnalysis(horizonDetected = true, horizonAngleDegrees = 1.2f)
        )
        assertEquals(
            HintSeverity.GOOD,
            clearedHints.first { it.category == HintCategory.HORIZON }.severity
        )
    }

    @Test
    fun `dominant subject off thirds intersection produces directional guidance`() {
        val useCase = EvaluateCoachingHintsUseCase()
        val subject = SubjectRegion(
            centerX = 0.50f,
            centerY = 0.50f,
            boxLeft = 0.38f,
            boxTop = 0.38f,
            boxRight = 0.62f,
            boxBottom = 0.62f,
            confidence = 0.85f,
            nearestPowerPointX = 2f / 3f,
            nearestPowerPointY = 1f / 3f,
            distanceToPowerPoint = 0.235f
        )

        val hints = useCase(
            ExposureAnalysis(),
            CompositionAnalysis(dominantSubject = subject)
        )
        val subjectHint = hints.first { it.category == HintCategory.SUBJECT_PLACEMENT }

        assertEquals(HintSeverity.INFO, subjectHint.severity)
        assertTrue(subjectHint.message.contains("третей"))
    }
}
