package com.smartcam.assistant.data.analysis

import android.util.Log
import androidx.camera.core.ImageProxy
import com.smartcam.assistant.data.camera.LensAwareFrameAnalyzer
import com.smartcam.assistant.domain.model.FrameTelemetry
import com.smartcam.assistant.domain.repository.SimulationPreset
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Реализация [LensAwareFrameAnalyzer] для CameraX ImageAnalysis.
 *
 * Гарантирует:
 * - ленивую потокобезопасную инициализацию нативной библиотеки OpenCV 4.10;
 * - мгновенный возврат буфера [ImageProxy.close] в блоке finally;
 * - неблокирующую доставку телеметрии через SharedFlow с BufferOverflow.DROP_OLDEST;
 * - поддержку синтетических YUV-сцен в режиме отладки на эмуляторе (даже если камера AVD = None).
 */
@Singleton
class RealTimeFrameAnalyzer @Inject constructor(
    private val processor: OpenCvFrameProcessor
) : LensAwareFrameAnalyzer {

    private val isFrontCamera = AtomicBoolean(false)
    private val openCvReady = AtomicBoolean(false)

    // Отдельный пул буферов на поток анализатора (и один для фонового симулятора сцен)
    private val cameraBufferPool by lazy { FrameBufferPool() }
    private val simulatorBufferPool by lazy { FrameBufferPool() }

    private val simulatorScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _simulationPreset = MutableStateFlow(SimulationPreset.LIVE_CAMERA)
    val simulationPreset: StateFlow<SimulationPreset> = _simulationPreset.asStateFlow()

    private val _telemetryFlow = MutableSharedFlow<FrameTelemetry>(
        replay = 1,
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val telemetryFlow: SharedFlow<FrameTelemetry> = _telemetryFlow.asSharedFlow()

    private var lastFrameTimestampNs: Long = 0L
    private var smoothedFps: Float = 0f

    init {
        ensureOpenCvLoaded()
        startSyntheticSceneTicker()
    }

    override fun updateFrontCameraState(isFrontCamera: Boolean) {
        this.isFrontCamera.set(isFrontCamera)
    }

    fun setSimulationPreset(preset: SimulationPreset) {
        _simulationPreset.value = preset
    }

    override fun analyze(imageProxy: ImageProxy) {
        try {
            // Если выбран синтетический пресет отладки, освобождаем аппаратный буфер сразу
            if (_simulationPreset.value != SimulationPreset.LIVE_CAMERA) {
                return
            }
            if (!ensureOpenCvLoaded()) {
                return
            }

            val startNs = System.nanoTime()
            val yPlane = imageProxy.planes.firstOrNull() ?: return

            val processed = processor.processLumaPlane(
                yBuffer = yPlane.buffer,
                width = imageProxy.width,
                height = imageProxy.height,
                rowStride = yPlane.rowStride,
                pixelStride = yPlane.pixelStride,
                rotationDegrees = imageProxy.imageInfo.rotationDegrees,
                isFrontCamera = isFrontCamera.get(),
                pool = cameraBufferPool
            )

            val endNs = System.nanoTime()
            val durationMs = (endNs - startNs) / 1_000_000f
            val instantFps = if (lastFrameTimestampNs > 0L && endNs > lastFrameTimestampNs) {
                1_000_000_000f / (endNs - lastFrameTimestampNs)
            } else {
                20f
            }
            lastFrameTimestampNs = endNs
            smoothedFps = if (smoothedFps == 0f) instantFps else smoothedFps + 0.2f * (instantFps - smoothedFps)

            _telemetryFlow.tryEmit(
                FrameTelemetry(
                    frameTimestampNs = imageProxy.imageInfo.timestamp,
                    processingTimeMs = durationMs,
                    analysisFps = smoothedFps,
                    exposure = processed.exposure,
                    composition = processed.composition
                )
            )
        } catch (t: Throwable) {
            Log.e(TAG, "Ошибка при обработке кадра в RealTimeFrameAnalyzer", t)
        } finally {
            // Критично: освобождаем буфер ImageReader в любом сценарии!
            imageProxy.close()
        }
    }

    private fun startSyntheticSceneTicker() {
        simulatorScope.launch {
            while (isActive) {
                val preset = _simulationPreset.value
                if (preset == SimulationPreset.LIVE_CAMERA) {
                    delay(120L)
                    continue
                }
                if (!ensureOpenCvLoaded()) {
                    delay(250L)
                    continue
                }

                val startNs = System.nanoTime()
                val width = FrameBufferPool.SYNTHETIC_WIDTH
                val height = FrameBufferPool.SYNTHETIC_HEIGHT
                SyntheticSceneGenerator.populateScene(
                    preset = preset,
                    targetBuffer = simulatorBufferPool.syntheticFrameBuffer,
                    width = width,
                    height = height,
                    timeSeconds = startNs / 1_000_000_000.0
                )

                val processed = processor.processLumaPlane(
                    yBuffer = simulatorBufferPool.syntheticFrameBuffer,
                    width = width,
                    height = height,
                    rowStride = width,
                    pixelStride = 1,
                    rotationDegrees = 0,
                    isFrontCamera = false,
                    pool = simulatorBufferPool
                )
                val durationMs = (System.nanoTime() - startNs) / 1_000_000f

                _telemetryFlow.tryEmit(
                    FrameTelemetry(
                        frameTimestampNs = startNs,
                        processingTimeMs = durationMs,
                        analysisFps = 16.5f,
                        exposure = processed.exposure,
                        composition = processed.composition
                    )
                )
                delay(60L)
            }
        }
    }

    private fun ensureOpenCvLoaded(): Boolean {
        if (openCvReady.get()) return true
        val initialized = runCatching {
            System.loadLibrary("opencv_java4")
            true
        }.getOrElse { error ->
            Log.e(TAG, "Не удалось загрузить нативную библиотеку OpenCV", error)
            false
        }
        if (initialized) {
            openCvReady.set(true)
        }
        return initialized
    }

    companion object {
        private const val TAG = "RealTimeFrameAnalyzer"
    }
}
