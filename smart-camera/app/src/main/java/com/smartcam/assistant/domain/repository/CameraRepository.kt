package com.smartcam.assistant.domain.repository

import com.smartcam.assistant.domain.model.CameraCapabilities
import com.smartcam.assistant.domain.model.CameraLens
import com.smartcam.assistant.domain.model.CapturedPhoto
import kotlinx.coroutines.flow.StateFlow

interface CameraRepository {
    val activeLens: StateFlow<CameraLens>
    val capabilities: StateFlow<CameraCapabilities>

    suspend fun switchLens(): CameraLens
    suspend fun setExposureCompensation(index: Int): Result<Int>
    suspend fun capturePhoto(): Result<CapturedPhoto>
}
