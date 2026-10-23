package com.smartcam.assistant.presentation.camera

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Cameraswitch
import androidx.compose.material.icons.rounded.GridOn
import androidx.compose.material.icons.rounded.Science
import androidx.compose.material.icons.rounded.Texture
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.smartcam.assistant.BuildConfig
import com.smartcam.assistant.domain.repository.SimulationPreset
import com.smartcam.assistant.presentation.overlay.CoachingHudBanner
import com.smartcam.assistant.presentation.overlay.CompositionGuidesOverlay
import com.smartcam.assistant.presentation.overlay.HistogramHudCard
import com.smartcam.assistant.presentation.overlay.ZebraClippingOverlay
import com.smartcam.assistant.presentation.theme.CinemaAmber
import com.smartcam.assistant.presentation.theme.HudBorder
import com.smartcam.assistant.presentation.theme.HudSurface
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.tan

@Composable
fun CameraScreen(
    viewModel: CameraViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    if (!hasCameraPermission) {
        PermissionGateContent(
            onRequestPermission = { permissionLauncher.launch(Manifest.permission.CAMERA) }
        )
    } else {
        ActiveCameraViewfinder(
            uiState = uiState,
            viewModel = viewModel
        )
    }
}

@Composable
private fun ActiveCameraViewfinder(
    uiState: CameraUiState,
    viewModel: CameraViewModel
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val snackbarHostState = remember { SnackbarHostState() }

    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.PERFORMANCE
        }
    }

    var focusTapOffset by remember { mutableStateOf<Offset?>(null) }

    // Перепривязка CameraX при смене объектива или жизненного цикла
    LaunchedEffect(lifecycleOwner, uiState.activeLens) {
        viewModel.bindCamera(
            lifecycleOwner = lifecycleOwner,
            surfaceProvider = previewView.surfaceProvider
        )
    }

    // Автоматическое скрытие маркера точки фокуса через 1.4 секунды
    LaunchedEffect(focusTapOffset) {
        if (focusTapOffset != null) {
            delay(1400L)
            focusTapOffset = null
        }
    }

    LaunchedEffect(uiState.statusMessage) {
        val message = uiState.statusMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.onDismissStatusMessage()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // 1. Аппаратное превью камеры CameraX + жест тап-фокуса/замера AE
        AndroidView(
            factory = { previewView },
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures { offset ->
                        focusTapOffset = offset
                        viewModel.onTapToFocus(
                            factory = previewView.meteringPointFactory,
                            x = offset.x,
                            y = offset.y
                        )
                    }
                }
        )

        // 2. Визуализация синтетической сцены (только если включён пресет отладки в эмуляторе)
        if (uiState.simulationPreset != SimulationPreset.LIVE_CAMERA) {
            SyntheticScenePreviewBackdrop(preset = uiState.simulationPreset)
        }

        // 3. Оверлей подсветки клиппинга светов/теней («Зебра»)
        ZebraClippingOverlay(
            exposure = uiState.telemetry.exposure,
            enabled = uiState.isZebraEnabled
        )

        // 4. Оверлей композиционных сеток, уровня горизонта и доминирующего объекта
        CompositionGuidesOverlay(
            guideType = uiState.guideOverlay,
            composition = uiState.telemetry.composition,
            focusTapPoint = focusTapOffset
        )

        // 5. Мягкая вспышка затвора при сохранении кадра
        AnimatedVisibility(
            visible = uiState.isCapturingPhoto,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.White.copy(alpha = 0.45f))
            )
        }

        // 6. Верхняя панель HUD: гистограмма слева + переключатели режимов справа
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            if (uiState.isHistogramVisible) {
                HistogramHudCard(
                    exposure = uiState.telemetry.exposure,
                    processingTimeMs = uiState.telemetry.processingTimeMs,
                    analysisFps = uiState.telemetry.analysisFps
                )
            } else {
                Spacer(modifier = Modifier.width(8.dp))
            }

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                HudToggleChip(
                    label = uiState.guideOverlay.displayName,
                    active = uiState.guideOverlay.ordinal != 3,
                    icon = Icons.Rounded.GridOn,
                    onClick = viewModel::onCycleGuideOverlay
                )
                HudToggleChip(
                    label = if (uiState.isZebraEnabled) "Zebra ON" else "Zebra OFF",
                    active = uiState.isZebraEnabled,
                    icon = Icons.Rounded.Texture,
                    onClick = viewModel::onToggleZebra
                )
                HudToggleChip(
                    label = "Гистограмма",
                    active = uiState.isHistogramVisible,
                    icon = Icons.Rounded.BarChart,
                    onClick = viewModel::onToggleHistogram
                )
                if (BuildConfig.DEBUG) {
                    HudToggleChip(
                        label = uiState.simulationPreset.title,
                        active = uiState.simulationPreset != SimulationPreset.LIVE_CAMERA,
                        icon = Icons.Rounded.Science,
                        onClick = viewModel::onCycleSimulationPreset
                    )
                }
            }
        }

        // 7. Нижний блок: стек живых текстовых подсказок + EV слайдер + затвор и смена камеры
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CoachingHudBanner(
                hints = uiState.telemetry.hints,
                modifier = Modifier.padding(bottom = 12.dp)
            )

            // Регулятор аппаратной экспокоррекции EV (если поддерживается драйвером камеры)
            if (uiState.capabilities.isExposureCompensationSupported &&
                uiState.capabilities.minExposureIndex < uiState.capabilities.maxExposureIndex
            ) {
                ExposureCompensationBar(
                    currentIndex = uiState.capabilities.currentExposureIndex,
                    minIndex = uiState.capabilities.minExposureIndex,
                    maxIndex = uiState.capabilities.maxExposureIndex,
                    evValue = uiState.capabilities.currentEvValue,
                    onIndexChange = viewModel::onExposureChanged
                )
                Spacer(modifier = Modifier.height(10.dp))
            }

            // Панель затвора и переключения объектива
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(28.dp))
                    .background(HudSurface)
                    .border(1.dp, HudBorder, RoundedCornerShape(28.dp))
                    .padding(horizontal = 24.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Индикатор последнего кадра / активного объектива
                Column(modifier = Modifier.width(88.dp)) {
                    Text(
                        text = if (uiState.activeLens.name == "BACK") "ОСНОВНАЯ" else "ФРОНТАЛЬНАЯ",
                        color = CinemaAmber,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.7.sp
                    )
                    Text(
                        text = if (uiState.lastCapturedPhoto != null) "Фото сохранено" else "4:3 · RAW YUV",
                        color = Color.White.copy(alpha = 0.68f),
                        fontSize = 10.sp
                    )
                }

                // Кнопка спуска затвора
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .border(3.dp, Color.White, CircleShape)
                        .clickable(
                            enabled = !uiState.isCapturingPhoto,
                            onClick = viewModel::onCapturePhoto
                        )
                        .padding(6.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(CircleShape)
                            .background(if (uiState.isCapturingPhoto) CinemaAmber else Color.White)
                    )
                }

                // Переключение фронтальной и основной камер
                Box(
                    modifier = Modifier.width(88.dp),
                    contentAlignment = Alignment.CenterEnd
                ) {
                    IconButton(
                        onClick = viewModel::onSwitchCamera,
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.12f))
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Cameraswitch,
                            contentDescription = "Переключить камеру",
                            tint = Color.White
                        )
                    }
                }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(top = 86.dp)
        )
    }
}

@Composable
private fun HudToggleChip(
    label: String,
    active: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(20.dp)
    val borderColor = if (active) CinemaAmber.copy(alpha = 0.75f) else HudBorder
    val contentColor = if (active) CinemaAmber else Color.White.copy(alpha = 0.8f)

    Row(
        modifier = Modifier
            .clip(shape)
            .background(HudSurface)
            .border(1.dp, borderColor, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = contentColor,
            modifier = Modifier.size(14.dp)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            color = contentColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun ExposureCompensationBar(
    currentIndex: Int,
    minIndex: Int,
    maxIndex: Int,
    evValue: Float,
    onIndexChange: (Int) -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(HudSurface)
            .border(1.dp, HudBorder, shape)
            .padding(horizontal = 14.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = String.format(Locale.US, "EV %+.1f", evValue),
            color = CinemaAmber,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.width(60.dp)
        )
        Slider(
            value = currentIndex.toFloat(),
            onValueChange = { onIndexChange(it.roundToInt()) },
            valueRange = minIndex.toFloat()..maxIndex.toFloat(),
            colors = SliderDefaults.colors(
                thumbColor = CinemaAmber,
                activeTrackColor = CinemaAmber
            ),
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * Наглядная визуализация синтетической сцены поверх видоискателя при включённом пресете отладки,
 * чтобы в эмуляторе без веб-камеры пользователь видел сам объект/окно/горизонт под Canvas-оверлеем.
 */
@Composable
private fun SyntheticScenePreviewBackdrop(preset: SimulationPreset) {
    Canvas(modifier = Modifier.fillMaxSize()) {
        when (preset) {
            SimulationPreset.OVEREXPOSED_HIGHLIGHTS -> {
                drawRect(
                    brush = Brush.verticalGradient(
                        listOf(Color(0xFF4B5563), Color(0xFF1F2937))
                    )
                )
                drawRect(
                    color = Color(0xFFFAFAFA),
                    topLeft = Offset(size.width * 0.42f, 0f),
                    size = Size(size.width * 0.58f, size.height * 0.48f)
                )
            }

            SimulationPreset.TILTED_HORIZON -> {
                drawRect(color = Color(0xFFC7D2FE))
                val slope = tan(6.5 * PI / 180.0).toFloat()
                val cy = size.height * 0.46f
                val leftY = cy - (size.width * 0.5f) * slope
                val rightY = cy + (size.width * 0.5f) * slope
                val ground = Path().apply {
                    moveTo(0f, leftY)
                    lineTo(size.width, rightY)
                    lineTo(size.width, size.height)
                    lineTo(0f, size.height)
                    close()
                }
                drawPath(ground, color = Color(0xFF374151))
            }

            SimulationPreset.OFF_CENTER_SUBJECT -> {
                drawRect(
                    brush = Brush.verticalGradient(
                        listOf(Color(0xFF334155), Color(0xFF475569))
                    )
                )
                drawOval(
                    color = Color(0xFFE2E8F0),
                    topLeft = Offset(size.width * 0.37f, size.height * 0.41f),
                    size = Size(size.width * 0.26f, size.height * 0.22f)
                )
            }

            SimulationPreset.LIVE_CAMERA -> Unit
        }
    }
}

@Composable
private fun PermissionGateContent(onRequestPermission: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF07090D))
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Доступ к камере",
            color = Color.White,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Для анализа экспозиции, гистограммы, линии горизонта и композиции в реальном времени необходим доступ к камере устройства.",
            color = Color.White.copy(alpha = 0.76f),
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
            lineHeight = 20.sp
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onRequestPermission,
            colors = ButtonDefaults.buttonColors(
                containerColor = CinemaAmber,
                contentColor = Color(0xFF141414)
            ),
            shape = RoundedCornerShape(14.dp)
        ) {
            Text(
                text = "Разрешить камеру",
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )
        }
    }
}
