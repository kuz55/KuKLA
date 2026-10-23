package com.smartcam.assistant.di

import com.smartcam.assistant.data.analysis.FrameAnalysisRepositoryImpl
import com.smartcam.assistant.data.analysis.RealTimeFrameAnalyzer
import com.smartcam.assistant.data.camera.CameraRepositoryImpl
import com.smartcam.assistant.data.camera.LensAwareFrameAnalyzer
import com.smartcam.assistant.domain.repository.CameraRepository
import com.smartcam.assistant.domain.repository.FrameAnalysisRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class CameraModule {

    @Binds
    @Singleton
    abstract fun bindCameraRepository(
        impl: CameraRepositoryImpl
    ): CameraRepository

    @Binds
    @Singleton
    abstract fun bindFrameAnalysisRepository(
        impl: FrameAnalysisRepositoryImpl
    ): FrameAnalysisRepository

    @Binds
    @Singleton
    abstract fun bindLensAwareAnalyzer(
        impl: RealTimeFrameAnalyzer
    ): LensAwareFrameAnalyzer
}
