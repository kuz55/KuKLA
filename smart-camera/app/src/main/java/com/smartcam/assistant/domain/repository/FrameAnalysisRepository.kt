package com.smartcam.assistant.domain.repository

import com.smartcam.assistant.domain.model.FrameTelemetry
import kotlinx.coroutines.flow.Flow

enum class SimulationPreset(val title: String) {
    LIVE_CAMERA("Живая камера"),
    OVEREXPOSED_HIGHLIGHTS("Тест: Пересвет"),
    TILTED_HORIZON("Тест: Завал 6.5°"),
    OFF_CENTER_SUBJECT("Тест: Объект и трети")
}

interface FrameAnalysisRepository {
    val telemetryFlow: Flow<FrameTelemetry>
    val simulationPreset: Flow<SimulationPreset>

    fun setSimulationPreset(preset: SimulationPreset)
}
