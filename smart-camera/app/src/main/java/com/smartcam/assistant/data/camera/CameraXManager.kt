package com.smartcam.assistant.data.camera

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Process
import android.provider.MediaStore
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.MeteringPointFactory
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.smartcam.assistant.domain.model.CameraCapabilities
import com.smartcam.assistant.domain.model.CameraLens
import com.smartcam.assistant.domain.model.CapturedPhoto
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

@Singleton
class CameraXManager @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val frameAnalyzer: LensAwareFrameAnalyzer
) {

    /**
     * Выделенный однопоточный пул для ImageAnalysis:
     * 1) гарантирует строго последовательную обработку кадров без гонок за пул буферов Mat;
     * 2) полностью изолирован от Main UI Thread и GPU RenderThread превью.
     */
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(
            {
                Process.setThreadPriority(Process.THREAD_PRIORITY_DEFAULT + Process.THREAD_PRIORITY_LESS_FAVORABLE)
                runnable.run()
            },
            "SmartCam-CV-Worker"
        )
    }

    private var cameraProvider: ProcessCameraProvider? = null
    private var activeCamera: Camera? = null
    private var imageCaptureUseCase: ImageCapture? = null

    private val _activeLens = MutableStateFlow(CameraLens.BACK)
    val activeLens: StateFlow<CameraLens> = _activeLens.asStateFlow()

    private val _capabilities = MutableStateFlow(CameraCapabilities())
    val capabilities: StateFlow<CameraCapabilities> = _capabilities.asStateFlow()

    /**
     * Инициализирует ProcessCameraProvider и атомарно привязывает к LifecycleOwner
     * три согласованных по формату 4:3 UseCase: Preview + ImageCapture + ImageAnalysis.
     */
    suspend fun bindCameraUseCases(
        lifecycleOwner: LifecycleOwner,
        surfaceProvider: Preview.SurfaceProvider,
        preferredLens: CameraLens = _activeLens.value
    ) = withContext(Dispatchers.Main.immediate) {
        val provider = cameraProvider ?: ProcessCameraProvider.getInstance(appContext).await().also {
            cameraProvider = it
        }

        val hasBack = runCatching { provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) }.getOrDefault(false)
        val hasFront = runCatching { provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) }.getOrDefault(false)

        val resolvedLens = when {
            preferredLens == CameraLens.BACK && hasBack -> CameraLens.BACK
            preferredLens == CameraLens.FRONT && hasFront -> CameraLens.FRONT
            hasBack -> CameraLens.BACK
            hasFront -> CameraLens.FRONT
            else -> preferredLens
        }
        _activeLens.value = resolvedLens
        frameAnalyzer.updateFrontCameraState(resolvedLens == CameraLens.FRONT)

        val cameraSelector = when {
            resolvedLens == CameraLens.FRONT && hasFront -> CameraSelector.DEFAULT_FRONT_CAMERA
            hasBack -> CameraSelector.DEFAULT_BACK_CAMERA
            else -> CameraSelector.Builder()
                .addCameraFilter { cameras -> cameras.take(1) }
                .build()
        }

        // Единая стратегия соотношения сторон 4:3 исключает рассинхронизацию поля зрения (FOV)
        // между потоком анализа и отображаемым превью.
        val sharedAspectRatio = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY

        // 1. Preview UseCase (рендерится напрямую на GPU через SurfaceProvider)
        val preview = Preview.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(sharedAspectRatio)
                    .build()
            )
            .build()
            .also { it.surfaceProvider = surfaceProvider }

        // 2. ImageCapture UseCase (максимальное доступное разрешение матрицы)
        val imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(sharedAspectRatio)
                    .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
                    .build()
            )
            .build()
        imageCaptureUseCase = imageCapture

        // 3. ImageAnalysis UseCase (VGA 640x480 YUV_420_888 + неблокирующая стратегия KEEP_ONLY_LATEST)
        val imageAnalysis = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(sharedAspectRatio)
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            ANALYSIS_TARGET_SIZE,
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER
                        )
                    )
                    .build()
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
            .also { analysis ->
                analysis.setAnalyzer(analysisExecutor, frameAnalyzer)
            }

        try {
            provider.unbindAll()
            val camera = provider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                preview,
                imageCapture,
                imageAnalysis
            )
            activeCamera = camera
            updateExposureCapabilities(camera, hasBack = hasBack, hasFront = hasFront)
        } catch (t: Throwable) {
            Log.e(TAG, "Ошибка привязки UseCases CameraX", t)
            throw t
        }
    }

    fun requestLensSwitch(): CameraLens {
        val current = _activeLens.value
        val caps = _capabilities.value
        val next = when {
            current == CameraLens.BACK && caps.hasFrontCamera -> CameraLens.FRONT
            current == CameraLens.FRONT && caps.hasBackCamera -> CameraLens.BACK
            else -> current
        }
        _activeLens.value = next
        frameAnalyzer.updateFrontCameraState(next == CameraLens.FRONT)
        return next
    }

    suspend fun setExposureCompensation(targetIndex: Int): Result<Int> {
        val camera = activeCamera
            ?: return Result.failure(IllegalStateException("Камера ещё не инициализирована"))
        val state = camera.cameraInfo.exposureState
        if (!state.isExposureCompensationSupported) {
            return Result.failure(UnsupportedOperationException("Экспокоррекция не поддерживается камерой"))
        }
        val clamped = targetIndex.coerceIn(
            state.exposureCompensationRange.lower,
            state.exposureCompensationRange.upper
        )
        return runCatching {
            val applied = camera.cameraControl.setExposureCompensationIndex(clamped).await()
            _capabilities.value = _capabilities.value.copy(currentExposureIndex = applied)
            applied
        }
    }

    fun triggerFocusAndMetering(factory: MeteringPointFactory, x: Float, y: Float) {
        val camera = activeCamera ?: return
        val point = factory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(
            point,
            FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE
        )
            .setAutoCancelDuration(3, TimeUnit.SECONDS)
            .build()
        camera.cameraControl.startFocusAndMetering(action)
    }

    suspend fun capturePhoto(): Result<CapturedPhoto> {
        val imageCapture = imageCaptureUseCase
            ?: return Result.failure(IllegalStateException("ImageCapture не активен"))

        val timestamp = System.currentTimeMillis()
        val fileName = "IMG_${
            SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date(timestamp))
        }.jpg"

        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/SmartCamAssistant")
            }
        }

        val metadata = ImageCapture.Metadata().apply {
            isReversedHorizontal = (_activeLens.value == CameraLens.FRONT)
        }

        val outputOptions = ImageCapture.OutputFileOptions.Builder(
            appContext.contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            contentValues
        )
            .setMetadata(metadata)
            .build()

        return suspendCancellableCoroutine { continuation ->
            imageCapture.takePicture(
                outputOptions,
                ContextCompat.getMainExecutor(appContext),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                        if (continuation.isActive) {
                            continuation.resume(
                                Result.success(
                                    CapturedPhoto(
                                        uriString = outputFileResults.savedUri?.toString().orEmpty(),
                                        fileName = fileName,
                                        timestampMillis = timestamp
                                    )
                                )
                            )
                        }
                    }

                    override fun onError(exception: ImageCaptureException) {
                        Log.e(TAG, "Ошибка сохранения снимка", exception)
                        if (continuation.isActive) {
                            continuation.resume(Result.failure(exception))
                        }
                    }
                }
            )
        }
    }

    private fun updateExposureCapabilities(
        camera: Camera,
        hasBack: Boolean,
        hasFront: Boolean
    ) {
        val exposure = camera.cameraInfo.exposureState
        _capabilities.value = CameraCapabilities(
            hasBackCamera = hasBack,
            hasFrontCamera = hasFront,
            isExposureCompensationSupported = exposure.isExposureCompensationSupported,
            minExposureIndex = exposure.exposureCompensationRange.lower,
            maxExposureIndex = exposure.exposureCompensationRange.upper,
            exposureStepEv = exposure.exposureCompensationStep.toFloat(),
            currentExposureIndex = exposure.exposureCompensationIndex
        )
    }

    companion object {
        private const val TAG = "CameraXManager"
        private val ANALYSIS_TARGET_SIZE = Size(640, 480)
    }
}
