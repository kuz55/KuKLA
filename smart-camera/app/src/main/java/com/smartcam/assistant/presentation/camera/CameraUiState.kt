package com.smartcam.assistant.presentation.camera

import com.smartcam.assistant.domain.model.CameraCapabilities
import com.smartcam.assistant.domain.model.CameraLens
import com.smartcam.assistant.domain.model.CapturedPhoto
import com.smartcam.assistant.domain.model.FrameTelemetry
import com.smartcam.assistant.domain.model.GuideOverlayType
import com.smartcam.assistant.domain.repository.SimulationPreset

data class CameraUiState(
    val activeLens: CameraLens = CameraLens.BACK,
    val capabilities: CameraCapabilities = CameraCapabilities(),
    val guideOverlay: GuideOverlayType = GuideOverlayType.RULE_OF_THIRDS,
    val isZebraEnabled: Boolean = true,
    val isHistogramVisible: Boolean = true,
    val simulationPreset: SimulationPreset = SimulationPreset.LIVE_CAMERA,
    val telemetry: FrameTelemetry = FrameTelemetry(),
    val isCapturingPhoto: Boolean = false,
    val lastCapturedPhoto: CapturedPhoto? = null,
    val statusMessage: String? = null
)
