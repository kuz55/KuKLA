package com.smartcam.assistant.presentation.camera

import androidx.camera.core.MeteringPointFactory
import androidx.camera.core.Preview
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smartcam.assistant.data.camera.CameraXManager
import com.smartcam.assistant.domain.model.GuideOverlayType
import com.smartcam.assistant.domain.repository.CameraRepository
import com.smartcam.assistant.domain.repository.FrameAnalysisRepository
import com.smartcam.assistant.domain.repository.SimulationPreset
import com.smartcam.assistant.domain.usecase.AdjustExposureUseCase
import com.smartcam.assistant.domain.usecase.CapturePhotoUseCase
import com.smartcam.assistant.domain.usecase.ObserveFrameTelemetryUseCase
import com.smartcam.assistant.domain.usecase.SwitchCameraLensUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CameraViewModel @Inject constructor(
    private val cameraXManager: CameraXManager,
    cameraRepository: CameraRepository,
    private val frameAnalysisRepository: FrameAnalysisRepository,
    observeFrameTelemetryUseCase: ObserveFrameTelemetryUseCase,
    private val switchCameraLensUseCase: SwitchCameraLensUseCase,
    private val capturePhotoUseCase: CapturePhotoUseCase,
    private val adjustExposureUseCase: AdjustExposureUseCase
) : ViewModel() {

    private data class UiControlsState(
        val guideOverlay: GuideOverlayType = GuideOverlayType.RULE_OF_THIRDS,
        val isZebraEnabled: Boolean = true,
        val isHistogramVisible: Boolean = true,
        val isCapturingPhoto: Boolean = false,
        val lastCapturedPhoto: com.smartcam.assistant.domain.model.CapturedPhoto? = null,
        val statusMessage: String? = null
    )

    private val controlsState = MutableStateFlow(UiControlsState())

    val uiState: StateFlow<CameraUiState> = combine(
        cameraRepository.activeLens,
        cameraRepository.capabilities,
        frameAnalysisRepository.simulationPreset,
        observeFrameTelemetryUseCase(),
        controlsState
    ) { lens, caps, preset, telemetry, controls ->
        CameraUiState(
            activeLens = lens,
            capabilities = caps,
            guideOverlay = controls.guideOverlay,
            isZebraEnabled = controls.isZebraEnabled,
            isHistogramVisible = controls.isHistogramVisible,
            simulationPreset = preset,
            telemetry = telemetry,
            isCapturingPhoto = controls.isCapturingPhoto,
            lastCapturedPhoto = controls.lastCapturedPhoto,
            statusMessage = controls.statusMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = CameraUiState()
    )

    fun bindCamera(
        lifecycleOwner: LifecycleOwner,
        surfaceProvider: Preview.SurfaceProvider
    ) {
        viewModelScope.launch {
            runCatching {
                cameraXManager.bindCameraUseCases(
                    lifecycleOwner = lifecycleOwner,
                    surfaceProvider = surfaceProvider,
                    preferredLens = uiState.value.activeLens
                )
            }.onFailure { error ->
                controlsState.update {
                    it.copy(
                        statusMessage = "Камера недоступна (${error.localizedMessage ?: "AVD"}). Доступен режим тестовых сцен."
                    )
                }
            }
        }
    }

    fun onSwitchCamera() {
        viewModelScope.launch {
            val previous = uiState.value.activeLens
            val updated = switchCameraLensUseCase()
            if (updated == previous) {
                controlsState.update {
                    it.copy(statusMessage = "На этом устройстве/эмуляторе доступна только одна камера")
                }
            }
        }
    }

    fun onCapturePhoto() {
        if (controlsState.value.isCapturingPhoto) return
        viewModelScope.launch {
            controlsState.update { it.copy(isCapturingPhoto = true) }
            val result = capturePhotoUseCase()
            result.fold(
                onSuccess = { photo ->
                    controlsState.update {
                        it.copy(
                            isCapturingPhoto = false,
                            lastCapturedPhoto = photo,
                            statusMessage = "Сохранено: Pictures/SmartCamAssistant/${photo.fileName}"
                        )
                    }
                },
                onFailure = { err ->
                    controlsState.update {
                        it.copy(
                            isCapturingPhoto = false,
                            statusMessage = "Не удалось сохранить снимок: ${err.localizedMessage ?: "ошибка камеры"}"
                        )
                    }
                }
            )
        }
    }

    fun onCycleGuideOverlay() {
        val all = GuideOverlayType.entries
        val next = all[(controlsState.value.guideOverlay.ordinal + 1) % all.size]
        controlsState.update { it.copy(guideOverlay = next) }
    }

    fun onToggleZebra() {
        controlsState.update { it.copy(isZebraEnabled = !it.isZebraEnabled) }
    }

    fun onToggleHistogram() {
        controlsState.update { it.copy(isHistogramVisible = !it.isHistogramVisible) }
    }

    fun onCycleSimulationPreset() {
        val presets = SimulationPreset.entries
        val current = uiState.value.simulationPreset
        val next = presets[(current.ordinal + 1) % presets.size]
        frameAnalysisRepository.setSimulationPreset(next)
    }

    fun onExposureChanged(newIndex: Int) {
        viewModelScope.launch {
            adjustExposureUseCase(newIndex)
        }
    }

    fun onTapToFocus(factory: MeteringPointFactory, x: Float, y: Float) {
        cameraXManager.triggerFocusAndMetering(factory, x, y)
    }

    fun onDismissStatusMessage() {
        controlsState.update { it.copy(statusMessage = null) }
    }
}
