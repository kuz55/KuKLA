package com.smartcam.assistant.data.analysis

import com.smartcam.assistant.domain.model.CompositionAnalysis
import com.smartcam.assistant.domain.model.ExposureAnalysis
import com.smartcam.assistant.domain.model.SubjectRegion
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.nio.ByteBuffer
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Высокопроизводительный CV-движок реального времени на базе OpenCV 4.10.
 *
 * Реализует двухскоростной конвейер:
 * 1) Fast Path (каждый кадр): гистограмма 256 корзин, клиппинг светов/теней, сетка «Зебры» 48x36.
 * 2) Heavy CV Path (каждый [COMPOSITION_FRAME_STRIDE] кадр + EMA-сглаживание):
 *    - детекция линии горизонта (GaussianBlur -> адаптивный Canny -> HoughLinesP);
 *    - поиск доминирующего объекта (Sobel Gradient Energy + Local Intensity Contrast -> Contours)
 *      и расчёт вектора до ближайшего пересечения правила третей.
 */
@Singleton
class OpenCvFrameProcessor @Inject constructor() {

    private var frameCounter: Long = 0L

    // Состояние EMA-фильтра сглаживания горизонта и объекта
    private var smoothedHorizonAngle: Float = 0f
    private var smoothedHorizonOffset: Float = 0.5f
    private var horizonHoldCounter: Int = 0
    private var cachedComposition: CompositionAnalysis = CompositionAnalysis()

    private var smoothedSubjectX: Float = -1f
    private var smoothedSubjectY: Float = -1f
    private var subjectHoldCounter: Int = 0

    data class ProcessedFrameResult(
        val exposure: ExposureAnalysis,
        val composition: CompositionAnalysis
    )

    fun processLumaPlane(
        yBuffer: ByteBuffer,
        width: Int,
        height: Int,
        rowStride: Int,
        pixelStride: Int,
        rotationDegrees: Int,
        isFrontCamera: Boolean,
        pool: FrameBufferPool
    ): ProcessedFrameResult {
        prepareUprightAnalysisMat(
            yBuffer = yBuffer,
            width = width,
            height = height,
            rowStride = rowStride,
            pixelStride = pixelStride,
            rotationDegrees = rotationDegrees,
            isFrontCamera = isFrontCamera,
            pool = pool
        )

        val upright = pool.uprightMat
        val exposure = computeExposureAndZebra(upright, pool)

        val shouldRunHeavyCv = (frameCounter % COMPOSITION_FRAME_STRIDE == 0L)
        if (shouldRunHeavyCv) {
            cachedComposition = computeComposition(
                upright = upright,
                meanLuminance = exposure.meanLuminance,
                pool = pool
            )
        }
        frameCounter++

        return ProcessedFrameResult(
            exposure = exposure,
            composition = cachedComposition
        )
    }

    /**
     * Формирует выровненную (upright) матрицу [pool.uprightMat] в экранной ориентации
     * с учётом аппаратного rowStride, поворота сенсора (90°/180°/270°) и зеркала селфи-камеры.
     */
    private fun prepareUprightAnalysisMat(
        yBuffer: ByteBuffer,
        width: Int,
        height: Int,
        rowStride: Int,
        pixelStride: Int,
        rotationDegrees: Int,
        isFrontCamera: Boolean,
        pool: FrameBufferPool
    ) {
        yBuffer.rewind()

        val sourceWrapper: Mat = if (pixelStride == 1 && rowStride >= width) {
            // Zero-Copy обёртка над DirectByteBuffer камеры:
            // представляем буфер как матрицу [height x rowStride] и берём подматрицу [0..height, 0..width],
            // что учитывает аппаратный паддинг строк rowStride БЕЗ единого копирования памяти!
            val paddedWrapper = Mat(height, rowStride, CvType.CV_8UC1, yBuffer)
            if (rowStride == width) {
                paddedWrapper
            } else {
                try {
                    paddedWrapper.submat(0, height, 0, width)
                } finally {
                    paddedWrapper.release()
                }
            }
        } else {
            // Редкий фоллбэк, если драйвер камеры использует pixelStride > 1 для Y-плоскости
            val needed = width * height
            if (pool.stridedCopyBuffer.size < needed) {
                pool.stridedCopyBuffer = ByteArray(needed)
            }
            val rowData = ByteArray(rowStride)
            var dstOffset = 0
            for (row in 0 until height) {
                yBuffer.position(row * rowStride)
                val toRead = min(rowStride, yBuffer.remaining())
                yBuffer.get(rowData, 0, toRead)
                for (col in 0 until width) {
                    val idx = col * pixelStride
                    pool.stridedCopyBuffer[dstOffset++] = if (idx < toRead) rowData[idx] else 0
                }
            }
            Mat(height, width, CvType.CV_8UC1).apply {
                put(0, 0, pool.stridedCopyBuffer, 0, needed)
            }
        }

        try {
            // Сначала уменьшаем разрешение до 320x240 методом INTER_AREA (подавляет шум сенсора!)
            Imgproc.resize(
                sourceWrapper,
                pool.scaledMat,
                Size(
                    FrameBufferPool.ANALYSIS_WIDTH.toDouble(),
                    FrameBufferPool.ANALYSIS_HEIGHT.toDouble()
                ),
                0.0,
                0.0,
                Imgproc.INTER_AREA
            )
        } finally {
            sourceWrapper.release()
        }

        // Приводим к ориентации экрана, чтобы углы горизонта и ячейки Зебры совпадали с UI
        when (((rotationDegrees % 360) + 360) % 360) {
            90 -> Core.rotate(pool.scaledMat, pool.uprightMat, Core.ROTATE_90_CLOCKWISE)
            180 -> Core.rotate(pool.scaledMat, pool.uprightMat, Core.ROTATE_180)
            270 -> Core.rotate(pool.scaledMat, pool.uprightMat, Core.ROTATE_90_COUNTERCLOCKWISE)
            else -> pool.scaledMat.copyTo(pool.uprightMat)
        }

        if (isFrontCamera) {
            Core.flip(pool.uprightMat, pool.uprightMat, 1)
        }
    }

    /**
     * Fast Path (~0.5 мс):
     * - 256-корзинная гистограмма яркости через Imgproc.calcHist;
     * - среднее и контраст (Core.meanStdDev);
     * - доля клиппинга теней (Y <= 8) и светов (Y >= 247);
     * - пространственная карта пересветов/провалов «Зебра» 48x36.
     */
    private fun computeExposureAndZebra(
        upright: Mat,
        pool: FrameBufferPool
    ): ExposureAnalysis {
        val rows = upright.rows()
        val cols = upright.cols()
        val totalPixels = (rows * cols).coerceAtLeast(1)

        Imgproc.calcHist(
            listOf(upright),
            pool.histChannels,
            pool.emptyMask,
            pool.histMat,
            pool.histSize,
            pool.histRanges
        )
        pool.histMat.get(0, 0, pool.rawHistFloatBuffer)

        Core.meanStdDev(upright, pool.meanMat, pool.stdDevMat)
        val meanLum = pool.meanMat.get(0, 0)?.firstOrNull()?.toFloat() ?: 128f
        val stdDevLum = pool.stdDevMat.get(0, 0)?.firstOrNull()?.toFloat() ?: 40f

        var shadowClipCount = 0f
        for (i in 0..SHADOW_CLIP_MAX_BIN) {
            shadowClipCount += pool.rawHistFloatBuffer[i]
        }

        var highlightClipCount = 0f
        for (i in HIGHLIGHT_CLIP_MIN_BIN until FrameBufferPool.HISTOGRAM_BINS) {
            highlightClipCount += pool.rawHistFloatBuffer[i]
        }

        // Мягкая нормализация пика (как в камерах Sony/Fujifilm): единичный пик клиппинга в 255
        // не «сплющивает» полутона гистограммы в плоскую линию.
        var maxBin = 1f
        for (i in 0 until FrameBufferPool.HISTOGRAM_BINS) {
            if (pool.rawHistFloatBuffer[i] > maxBin) {
                maxBin = pool.rawHistFloatBuffer[i]
            }
        }
        val effectiveCap = min(maxBin, totalPixels * 0.065f).coerceAtLeast(1f)
        for (i in 0 until FrameBufferPool.HISTOGRAM_BINS) {
            pool.normalizedHistBuffer[i] =
                (pool.rawHistFloatBuffer[i] / effectiveCap).coerceIn(0f, 1f)
        }

        // Построение пространственной сетки «Зебры» (48 x 36) за 1 чтение массива пикселей
        if (pool.pixelScratchBuffer.size < totalPixels) {
            pool.pixelScratchBuffer = ByteArray(totalPixels)
        }
        upright.get(0, 0, pool.pixelScratchBuffer)

        val zCols = FrameBufferPool.ZEBRA_COLS
        val zRows = FrameBufferPool.ZEBRA_ROWS
        for (zy in 0 until zRows) {
            val yStart = (zy * rows) / zRows
            val yEnd = max(yStart + 1, ((zy + 1) * rows) / zRows)
            for (zx in 0 until zCols) {
                val xStart = (zx * cols) / zCols
                val xEnd = max(xStart + 1, ((zx + 1) * cols) / zCols)

                var hiPixels = 0
                var loPixels = 0
                var sampleCount = 0
                for (py in yStart until yEnd) {
                    val rowOffset = py * cols
                    for (px in xStart until xEnd) {
                        val lum = pool.pixelScratchBuffer[rowOffset + px].toInt() and 0xFF
                        if (lum >= HIGHLIGHT_CLIP_MIN_BIN) hiPixels++
                        else if (lum <= SHADOW_CLIP_MAX_BIN) loPixels++
                        sampleCount++
                    }
                }

                val threshold = (sampleCount * 0.45f).toInt().coerceAtLeast(1)
                pool.zebraBuffer[zy * zCols + zx] = when {
                    hiPixels >= threshold -> 1
                    loPixels >= threshold -> -1
                    else -> 0
                }
            }
        }

        return ExposureAnalysis(
            histogram = pool.normalizedHistBuffer.toList(),
            meanLuminance = meanLum,
            contrastStdDev = stdDevLum,
            shadowClippingRatio = (shadowClipCount / totalPixels).coerceIn(0f, 1f),
            highlightClippingRatio = (highlightClipCount / totalPixels).coerceIn(0f, 1f),
            zebraGridCols = zCols,
            zebraGridRows = zRows,
            zebraMask = pool.zebraBuffer.toList()
        )
    }

    /**
     * Heavy CV Path (~2.5–3.5 мс на 240x320):
     * 1) Линия горизонта через GaussianBlur + адаптивный Canny + HoughLinesP + взвешивание по длине;
     * 2) Доминирующий объект через комбинацию энергии градиента Собеля и контраста яркости.
     */
    private fun computeComposition(
        upright: Mat,
        meanLuminance: Float,
        pool: FrameBufferPool
    ): CompositionAnalysis {
        Imgproc.GaussianBlur(upright, pool.blurredMat, Size(5.0, 5.0), 1.3)

        // --- 1. Поиск линии горизонта ---
        val lowerCanny = max(20.0, meanLuminance * 0.62)
        val upperCanny = max(60.0, meanLuminance * 1.32)
        Imgproc.Canny(pool.blurredMat, pool.edgesMat, lowerCanny, upperCanny)

        val minSegmentLength = upright.cols() * 0.22
        Imgproc.HoughLinesP(
            pool.edgesMat,
            pool.linesMat,
            1.0,
            PI / 180.0,
            34,
            minSegmentLength,
            18.0
        )

        var weightedAngleSum = 0.0
        var weightedYOffsetSum = 0.0
        var totalWeight = 0.0

        val lineCount = pool.linesMat.rows()
        for (i in 0 until lineCount) {
            val coords = pool.linesMat.get(i, 0) ?: continue
            val x1 = coords[0]
            val y1 = coords[1]
            val x2 = coords[2]
            val y2 = coords[3]
            val dx = x2 - x1
            val dy = y2 - y1
            val length = hypot(dx, dy)
            if (length < minSegmentLength) continue

            // Нормализуем вектор слева направо, чтобы угол лежал в [-90°..+90°]
            val (nx, ny) = if (dx >= 0) dx to dy else -dx to -dy
            val angleDeg = atan2(ny, nx) * (180.0 / PI)

            // Отбираем только близкие к горизонтали линии (отсекая стены, двери и вертикали)
            if (kotlin.math.abs(angleDeg) <= MAX_HORIZON_CANDIDATE_DEGREES) {
                val midY = ((y1 + y2) * 0.5) / upright.rows().coerceAtLeast(1)
                weightedAngleSum += angleDeg * length
                weightedYOffsetSum += midY * length
                totalWeight += length
            }
        }

        val horizonDetectedNow = totalWeight >= upright.cols() * 0.25
        if (horizonDetectedNow) {
            val rawAngle = (weightedAngleSum / totalWeight).toFloat()
            val rawOffset = (weightedYOffsetSum / totalWeight).toFloat().coerceIn(0.1f, 0.9f)
            if (horizonHoldCounter == 0) {
                smoothedHorizonAngle = rawAngle
                smoothedHorizonOffset = rawOffset
            } else {
                smoothedHorizonAngle += EMA_ALPHA * (rawAngle - smoothedHorizonAngle)
                smoothedHorizonOffset += EMA_ALPHA * (rawOffset - smoothedHorizonOffset)
            }
            horizonHoldCounter = HORIZON_HOLD_CYCLES
        } else if (horizonHoldCounter > 0) {
            horizonHoldCounter--
        }

        val confidence = if (horizonDetectedNow) {
            (totalWeight / (upright.cols() * 1.2)).toFloat().coerceIn(0.25f, 1f)
        } else {
            0.2f
        }

        // --- 2. Поиск доминирующего объекта (Sobel Saliency + Local Contrast) ---
        val dominantSubject = detectDominantSubject(
            blurred = pool.blurredMat,
            meanLuminance = meanLuminance,
            pool = pool
        )

        return CompositionAnalysis(
            horizonDetected = horizonHoldCounter > 0,
            horizonAngleDegrees = smoothedHorizonAngle,
            horizonVerticalOffset = smoothedHorizonOffset,
            horizonConfidence = if (horizonHoldCounter > 0) confidence else 0f,
            dominantSubject = dominantSubject
        )
    }

    private fun detectDominantSubject(
        blurred: Mat,
        meanLuminance: Float,
        pool: FrameBufferPool
    ): SubjectRegion? {
        val rows = blurred.rows()
        val cols = blurred.cols()
        val frameArea = (rows * cols).toDouble().coerceAtLeast(1.0)

        // Энергия границ (текстурные/фокусные объекты)
        Imgproc.Sobel(blurred, pool.gradX, CvType.CV_16S, 1, 0, 3)
        Imgproc.Sobel(blurred, pool.gradY, CvType.CV_16S, 0, 1, 3)
        Core.convertScaleAbs(pool.gradX, pool.absGradX)
        Core.convertScaleAbs(pool.gradY, pool.absGradY)
        Core.addWeighted(pool.absGradX, 0.5, pool.absGradY, 0.5, 0.0, pool.edgeEnergyMat)

        // Локальное отличие яркости от среднего фона (гладкие контрастные объекты)
        Core.absdiff(blurred, Scalar(meanLuminance.toDouble()), pool.contrastMat)

        // Комбинированная карта заметности (Saliency Map)
        Core.addWeighted(pool.edgeEnergyMat, 0.65, pool.contrastMat, 0.35, 0.0, pool.saliencyMat)
        Imgproc.GaussianBlur(pool.saliencyMat, pool.saliencyMat, Size(13.0, 13.0), 0.0)

        // Пороговая бинаризация Отсу + морфологическое замыкание
        Imgproc.threshold(
            pool.saliencyMat,
            pool.saliencyBinaryMat,
            0.0,
            255.0,
            Imgproc.THRESH_BINARY or Imgproc.THRESH_OTSU
        )
        Imgproc.morphologyEx(
            pool.saliencyBinaryMat,
            pool.saliencyBinaryMat,
            Imgproc.MORPH_CLOSE,
            pool.morphKernel
        )

        val contours = ArrayList<MatOfPoint>()
        Imgproc.findContours(
            pool.saliencyBinaryMat,
            contours,
            pool.hierarchyMat,
            Imgproc.RETR_EXTERNAL,
            Imgproc.CHAIN_APPROX_SIMPLE
        )

        var bestRect: org.opencv.core.Rect? = null
        var bestScore = 0.0
        var bestCx = 0f
        var bestCy = 0f

        try {
            for (contour in contours) {
                val area = Imgproc.contourArea(contour)
                val areaRatio = area / frameArea
                // Отсекаем мелкий шум (< 1.8% кадра) и заливку всего фона (> 68% кадра)
                if (areaRatio < 0.018 || areaRatio > 0.68) continue

                val rect = Imgproc.boundingRect(contour)
                val moments = Imgproc.moments(contour)
                if (moments.m00 <= 1e-3) continue

                val cx = (moments.m10 / moments.m00).toFloat() / cols
                val cy = (moments.m01 / moments.m00).toFloat() / rows

                // Небольшой приоритет объектам, не прилипшим вплотную к краю матрицы
                val edgePenalty = if (cx in 0.06f..0.94f && cy in 0.06f..0.94f) 1.0 else 0.65
                val score = areaRatio * edgePenalty
                if (score > bestScore) {
                    bestScore = score
                    bestRect = rect
                    bestCx = cx
                    bestCy = cy
                }
            }
        } finally {
            contours.forEach { it.release() }
        }

        val chosenRect = bestRect
        if (chosenRect == null) {
            if (subjectHoldCounter > 0) {
                subjectHoldCounter--
                return cachedComposition.dominantSubject
            }
            smoothedSubjectX = -1f
            smoothedSubjectY = -1f
            return null
        }

        if (smoothedSubjectX < 0f || smoothedSubjectY < 0f) {
            smoothedSubjectX = bestCx
            smoothedSubjectY = bestCy
        } else {
            smoothedSubjectX += SUBJECT_EMA_ALPHA * (bestCx - smoothedSubjectX)
            smoothedSubjectY += SUBJECT_EMA_ALPHA * (bestCy - smoothedSubjectY)
        }
        subjectHoldCounter = SUBJECT_HOLD_CYCLES

        // Поиск ближайшего узла правила третей (Power Point)
        var nearestPx = THIRD_FIRST
        var nearestPy = THIRD_FIRST
        var minDistance = Float.MAX_VALUE
        for (px in POWER_POINTS_1D) {
            for (py in POWER_POINTS_1D) {
                val dist = hypot(smoothedSubjectX - px, smoothedSubjectY - py)
                if (dist < minDistance) {
                    minDistance = dist
                    nearestPx = px
                    nearestPy = py
                }
            }
        }

        val halfW = (chosenRect.width.toFloat() / cols) * 0.5f
        val halfH = (chosenRect.height.toFloat() / rows) * 0.5f

        return SubjectRegion(
            centerX = smoothedSubjectX,
            centerY = smoothedSubjectY,
            boxLeft = (smoothedSubjectX - halfW).coerceIn(0.02f, 0.98f),
            boxTop = (smoothedSubjectY - halfH).coerceIn(0.02f, 0.98f),
            boxRight = (smoothedSubjectX + halfW).coerceIn(0.02f, 0.98f),
            boxBottom = (smoothedSubjectY + halfH).coerceIn(0.02f, 0.98f),
            confidence = (bestScore * 4.0).toFloat().coerceIn(0.3f, 1.0f),
            nearestPowerPointX = nearestPx,
            nearestPowerPointY = nearestPy,
            distanceToPowerPoint = minDistance
        )
    }

    companion object {
        private const val SHADOW_CLIP_MAX_BIN = 8
        private const val HIGHLIGHT_CLIP_MIN_BIN = 247
        private const val COMPOSITION_FRAME_STRIDE = 2L
        private const val MAX_HORIZON_CANDIDATE_DEGREES = 26.0
        private const val EMA_ALPHA = 0.28f
        private const val SUBJECT_EMA_ALPHA = 0.25f
        private const val HORIZON_HOLD_CYCLES = 5
        private const val SUBJECT_HOLD_CYCLES = 4
        private const val THIRD_FIRST = 1f / 3f
        private const val THIRD_SECOND = 2f / 3f
        private val POWER_POINTS_1D = floatArrayOf(THIRD_FIRST, THIRD_SECOND)
    }
}
