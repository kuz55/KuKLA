package com.smartcam.assistant.domain.model

/**
 * Результат анализа экспозиции кадра по яркостной компоненте (Luma Y).
 *
 * @param histogram Нормализованная гистограмма яркости из 256 корзин в диапазоне [0f..1f].
 * @param meanLuminance Средняя яркость кадра [0f..255f].
 * @param contrastStdDev Стандартное отклонение яркости (мера микро/общего контраста).
 * @param shadowClippingRatio Доля пикселей с провалом в глубоких тенях (Y <= 8), [0f..1f].
 * @param highlightClippingRatio Доля пикселей с выбитыми светами (Y >= 247), [0f..1f].
 * @param zebraGridCols Ширина пространственной сетки клиппинга (Zebra).
 * @param zebraGridRows Высота пространственной сетки клиппинга (Zebra).
 * @param zebraMask Массив размера [zebraGridCols * zebraGridRows]:
 *                  0 = норма, 1 = пересвет (highlights clipping), -1 = провал в тенях (crushed blacks).
 */
data class ExposureAnalysis(
    val histogram: List<Float> = List(256) { 0f },
    val meanLuminance: Float = 128f,
    val contrastStdDev: Float = 42f,
    val shadowClippingRatio: Float = 0f,
    val highlightClippingRatio: Float = 0f,
    val zebraGridCols: Int = 48,
    val zebraGridRows: Int = 36,
    val zebraMask: List<Int> = emptyList()
)

/**
 * Доминирующий объект в кадре и ближайшая к нему точка силы правила третей.
 * Все координаты нормализованы в диапазон [0f..1f] относительно отображаемого кадра.
 */
data class SubjectRegion(
    val centerX: Float,
    val centerY: Float,
    val boxLeft: Float,
    val boxTop: Float,
    val boxRight: Float,
    val boxBottom: Float,
    val confidence: Float,
    val nearestPowerPointX: Float,
    val nearestPowerPointY: Float,
    val distanceToPowerPoint: Float
)

/**
 * Результат анализа композиции кадра (линия горизонта + доминирующий объект).
 */
data class CompositionAnalysis(
    val horizonDetected: Boolean = false,
    val horizonAngleDegrees: Float = 0f,
    val horizonVerticalOffset: Float = 0.5f,
    val horizonConfidence: Float = 0f,
    val dominantSubject: SubjectRegion? = null
)

enum class HintCategory {
    EXPOSURE,
    HORIZON,
    SUBJECT_PLACEMENT
}

enum class HintSeverity {
    GOOD,
    INFO,
    WARNING
}

data class CoachingHint(
    val category: HintCategory,
    val severity: HintSeverity,
    val message: String,
    val actionDetail: String? = null
)

/**
 * Сводный пакет телеметрии реального времени для UI.
 */
data class FrameTelemetry(
    val frameTimestampNs: Long = 0L,
    val processingTimeMs: Float = 0f,
    val analysisFps: Float = 0f,
    val exposure: ExposureAnalysis = ExposureAnalysis(),
    val composition: CompositionAnalysis = CompositionAnalysis(),
    val hints: List<CoachingHint> = emptyList()
)
