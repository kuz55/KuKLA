package com.smartcam.assistant.data.analysis

import com.smartcam.assistant.domain.repository.SimulationPreset
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.tan

/**
 * Генератор синтетических полутоновых (Y-plane) сцен для отладки алгоритмов OpenCV
 * в Android Studio Emulator (например, если в AVD не подключена веб-камера).
 *
 * Важно: сгенерированный кадр проходит через ТОТ ЖЕ САМЫЙ OpenCvFrameProcessor,
 * проверяя реальную работу calcHist, Zebra-маски, Canny/HoughLinesP и Sobel Saliency.
 */
object SyntheticSceneGenerator {

    fun populateScene(
        preset: SimulationPreset,
        targetBuffer: ByteBuffer,
        width: Int,
        height: Int,
        timeSeconds: Double
    ) {
        targetBuffer.rewind()
        val pulse = sin(timeSeconds * 1.4)

        when (preset) {
            SimulationPreset.OVEREXPOSED_HIGHLIGHTS -> {
                // Яркое окно в правой верхней четверти (клиппинг светов Y=250..255) + нормальный интерьер
                for (y in 0 until height) {
                    val normY = y.toFloat() / height
                    for (x in 0 until width) {
                        val normX = x.toFloat() / width
                        val inWindow = normX > 0.42f && normY < 0.48f
                        val luma = if (inWindow) {
                            (250 + (pulse * 4).toInt()).coerceIn(247, 255)
                        } else {
                            (95f + 55f * (1f - normY) + 18f * sin(normX * 8.0).toFloat())
                                .toInt()
                                .coerceIn(25, 220)
                        }
                        targetBuffer.put(luma.toByte())
                    }
                }
            }

            SimulationPreset.TILTED_HORIZON -> {
                // Пейзаж с наклонённой линией горизонта ~ +6.5° (выше порога 2.0°)
                val angleDeg = 6.5 + 0.4 * pulse
                val slope = tan(angleDeg * PI / 180.0)
                val centerX = width * 0.5
                val centerY = height * 0.46
                for (y in 0 until height) {
                    for (x in 0 until width) {
                        val horizonY = centerY + (x - centerX) * slope
                        val dist = y - horizonY
                        val luma = when {
                            dist < -2.0 -> (198 - (y * 0.12).toInt()).coerceIn(155, 220) // Небо
                            dist <= 2.0 -> 130                                           // Переход горизонта
                            else -> (68 + (dist * 0.14).toInt()).coerceIn(45, 115)       // Земля/море
                        }
                        targetBuffer.put(luma.toByte())
                    }
                }
            }

            SimulationPreset.OFF_CENTER_SUBJECT -> {
                // Контрастный объект с текстурой, смещённый относительно узла третей (0.67, 0.67)
                val subjCx = (0.50 + 0.03 * pulse) * width
                val subjCy = (0.52 + 0.02 * pulse) * height
                val radiusX = width * 0.13
                val radiusY = height * 0.11

                for (y in 0 until height) {
                    for (x in 0 until width) {
                        val dx = (x - subjCx) / radiusX
                        val dy = (y - subjCy) / radiusY
                        val insideSubject = (dx * dx + dy * dy) <= 1.0
                        val luma = if (insideSubject) {
                            val checker = if (((x / 6) + (y / 6)) % 2 == 0) 215 else 155
                            checker
                        } else {
                            (74 + ((y.toFloat() / height) * 20f).toInt()).coerceIn(60, 105)
                        }
                        targetBuffer.put(luma.toByte())
                    }
                }
            }

            SimulationPreset.LIVE_CAMERA -> Unit
        }
        targetBuffer.rewind()
    }
}
