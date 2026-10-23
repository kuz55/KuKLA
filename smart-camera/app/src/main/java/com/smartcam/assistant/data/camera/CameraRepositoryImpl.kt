package com.smartcam.assistant.data.camera

import com.smartcam.assistant.domain.model.CameraCapabilities
import com.smartcam.assistant.domain.model.CameraLens
import com.smartcam.assistant.domain.model.CapturedPhoto
import com.smartcam.assistant.domain.repository.CameraRepository
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CameraRepositoryImpl @Inject constructor(
    private val cameraXManager: CameraXManager
) : CameraRepository {

    override val activeLens: StateFlow<CameraLens> = cameraXManager.activeLens

    override val capabilities: StateFlow<CameraCapabilities> = cameraXManager.capabilities

    override suspend fun switchLens(): CameraLens {
        return cameraXManager.requestLensSwitch()
    }

    override suspend fun setExposureCompensation(index: Int): Result<Int> {
        return cameraXManager.setExposureCompensation(index)
    }

    override suspend fun capturePhoto(): Result<CapturedPhoto> {
        return cameraXManager.capturePhoto()
    }
}
