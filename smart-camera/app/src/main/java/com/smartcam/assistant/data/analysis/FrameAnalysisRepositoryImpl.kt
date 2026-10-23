package com.smartcam.assistant.data.analysis

import com.smartcam.assistant.domain.model.FrameTelemetry
import com.smartcam.assistant.domain.repository.FrameAnalysisRepository
import com.smartcam.assistant.domain.repository.SimulationPreset
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FrameAnalysisRepositoryImpl @Inject constructor(
    private val frameAnalyzer: RealTimeFrameAnalyzer
) : FrameAnalysisRepository {

    override val telemetryFlow: Flow<FrameTelemetry> = frameAnalyzer.telemetryFlow

    override val simulationPreset: Flow<SimulationPreset> = frameAnalyzer.simulationPreset

    override fun setSimulationPreset(preset: SimulationPreset) {
        frameAnalyzer.setSimulationPreset(preset)
    }
}
