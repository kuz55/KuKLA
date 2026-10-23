package com.smartcam.assistant.data.analysis

import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfFloat
import org.opencv.core.MatOfInt
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.nio.ByteBuffer

/**
 * Пул предвыделенных нативных матриц OpenCV (Mat) и примитивных массивов JVM.
 *
 * Все объекты живут в единственном потоке "SmartCam-CV-Worker", поэтому:
 * - 0 аллокаций в куче JVM и нативной куче JNI на каждый кадр;
 * - отсутствуют GC-паузы и фрагментация памяти даже при длительной съёмке.
 */
class FrameBufferPool {

    val scaledMat = Mat()
    val uprightMat = Mat()
    val blurredMat = Mat()
    val edgesMat = Mat()
    val linesMat = Mat()

    val gradX = Mat()
    val gradY = Mat()
    val absGradX = Mat()
    val absGradY = Mat()
    val edgeEnergyMat = Mat()
    val contrastMat = Mat()
    val saliencyMat = Mat()
    val saliencyBinaryMat = Mat()
    val hierarchyMat = Mat()

    val morphKernel: Mat = Imgproc.getStructuringElement(
        Imgproc.MORPH_ELLIPSE,
        Size(9.0, 9.0)
    )

    val meanMat = org.opencv.core.MatOfDouble()
    val stdDevMat = org.opencv.core.MatOfDouble()

    val histMat = Mat()
    val emptyMask = Mat()
    val histChannels = MatOfInt(0)
    val histSize = MatOfInt(HISTOGRAM_BINS)
    val histRanges = MatOfFloat(0f, 256f)

    // Примитивные буферы для быстрого чтения пикселей без аллокаций на кадр
    val rawHistFloatBuffer = FloatArray(HISTOGRAM_BINS)
    val normalizedHistBuffer = FloatArray(HISTOGRAM_BINS)
    val zebraBuffer = IntArray(ZEBRA_COLS * ZEBRA_ROWS)
    var pixelScratchBuffer = ByteArray(ANALYSIS_WIDTH * ANALYSIS_HEIGHT)
    var stridedCopyBuffer = ByteArray(0)

    // Буфер для генерации синтетических Y-кадров отладки в эмуляторе
    val syntheticFrameBuffer: ByteBuffer =
        ByteBuffer.allocateDirect(SYNTHETIC_WIDTH * SYNTHETIC_HEIGHT)

    fun releaseAll() {
        scaledMat.release()
        uprightMat.release()
        blurredMat.release()
        edgesMat.release()
        linesMat.release()
        gradX.release()
        gradY.release()
        absGradX.release()
        absGradY.release()
        edgeEnergyMat.release()
        contrastMat.release()
        saliencyMat.release()
        saliencyBinaryMat.release()
        hierarchyMat.release()
        morphKernel.release()
        meanMat.release()
        stdDevMat.release()
        histMat.release()
        emptyMask.release()
        histChannels.release()
        histSize.release()
        histRanges.release()
    }

    companion object {
        const val ANALYSIS_WIDTH = 320
        const val ANALYSIS_HEIGHT = 240
        const val SYNTHETIC_WIDTH = 240
        const val SYNTHETIC_HEIGHT = 320
        const val HISTOGRAM_BINS = 256
        const val ZEBRA_COLS = 48
        const val ZEBRA_ROWS = 36
    }
}
