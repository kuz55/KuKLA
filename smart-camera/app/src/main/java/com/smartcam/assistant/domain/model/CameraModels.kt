package com.smartcam.assistant.domain.model

enum class CameraLens {
    BACK,
    FRONT;

    fun toggled(): CameraLens = if (this == BACK) FRONT else BACK
}

enum class GuideOverlayType(val displayName: String) {
    RULE_OF_THIRDS("Трети"),
    GOLDEN_RATIO("Золотое сечение"),
    DIAGONALS("Диагонали"),
    NONE("Скрыть сетку")
}

data class CapturedPhoto(
    val uriString: String,
    val fileName: String,
    val timestampMillis: Long
)

data class CameraCapabilities(
    val hasBackCamera: Boolean = true,
    val hasFrontCamera: Boolean = true,
    val isExposureCompensationSupported: Boolean = false,
    val minExposureIndex: Int = 0,
    val maxExposureIndex: Int = 0,
    val exposureStepEv: Float = 0f,
    val currentExposureIndex: Int = 0
) {
    val canSwitchLens: Boolean
        get() = hasBackCamera && hasFrontCamera

    val currentEvValue: Float
        get() = currentExposureIndex * exposureStepEv
}
