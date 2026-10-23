package com.smartcam.assistant

import android.app.Application
import android.util.Log
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class SmartCamApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        val ok = runCatching {
            System.loadLibrary("opencv_java4")
            true
        }.getOrDefault(false)
        Log.i("SmartCamApp", "OpenCV native engine (libopencv_java4.so) loaded: $ok")
    }
}
