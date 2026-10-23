package com.smartcam.assistant.domain.usecase

import com.smartcam.assistant.domain.model.CameraLens
import com.smartcam.assistant.domain.model.CapturedPhoto
import com.smartcam.assistant.domain.model.FrameTelemetry
import com.smartcam.assistant.domain.repository.CameraRepository
import com.smartcam.assistant.domain.repository.FrameAnalysisRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

class ObserveFrameTelemetryUseCase @Inject constructor(
    private val frameAnalysisRepository: FrameAnalysisRepository,
    private val evaluateCoachingHints: EvaluateCoachingHintsUseCase
) {
    operator fun invoke(): Flow<FrameTelemetry> {
        return frameAnalysisRepository.telemetryFlow.map { rawTelemetry ->
            val hints = evaluateCoachingHints(
                exposure = rawTelemetry.exposure,
                composition = rawTelemetry.composition
            )
            rawTelemetry.copy(hints = hints)
        }
    }
}

class SwitchCameraLensUseCase @Inject constructor(
    private val cameraRepository: CameraRepository
) {
    suspend operator fun invoke(): CameraLens = cameraRepository.switchLens()
}

class CapturePhotoUseCase @Inject constructor(
    private val cameraRepository: CameraRepository
) {
    suspend operator fun invoke(): Result<CapturedPhoto> = cameraRepository.capturePhoto()
}

class AdjustExposureUseCase @Inject constructor(
    private val cameraRepository: CameraRepository
) {
    suspend operator fun invoke(exposureIndex: Int): Result<Int> {
        return cameraRepository.setExposureCompensation(exposureIndex)
    }
}
