package com.smartcam.assistant.data.camera

import androidx.camera.core.ImageAnalysis

/**
 * Расширение контракта ImageAnalysis.Analyzer с передачей информации
 * об активном объективе (для зеркальной коррекции координат фронтальной камеры).
 */
interface LensAwareFrameAnalyzer : ImageAnalysis.Analyzer {
    fun updateFrontCameraState(isFrontCamera: Boolean)
}
