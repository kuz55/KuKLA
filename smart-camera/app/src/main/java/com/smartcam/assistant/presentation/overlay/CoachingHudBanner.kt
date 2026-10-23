package com.smartcam.assistant.presentation.overlay

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smartcam.assistant.domain.model.CoachingHint
import com.smartcam.assistant.domain.model.HintSeverity
import com.smartcam.assistant.presentation.theme.AlertCrimson
import com.smartcam.assistant.presentation.theme.CinemaAmber
import com.smartcam.assistant.presentation.theme.EmeraldGood
import com.smartcam.assistant.presentation.theme.HudSurface

/**
 * Компактная стек-панель текстовых подсказок по экспозиции, горизонту и композиции.
 */
@Composable
fun CoachingHudBanner(
    hints: List<CoachingHint>,
    modifier: Modifier = Modifier
) {
    if (hints.isEmpty()) return

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        hints.forEach { hint ->
            val (accent, icon) = when (hint.severity) {
                HintSeverity.GOOD -> EmeraldGood to Icons.Rounded.CheckCircle
                HintSeverity.INFO -> CinemaAmber to Icons.Rounded.Info
                HintSeverity.WARNING -> AlertCrimson to Icons.Rounded.Warning
            }
            val pillShape = RoundedCornerShape(12.dp)

            Row(
                modifier = Modifier
                    .clip(pillShape)
                    .background(HudSurface)
                    .border(1.dp, accent.copy(alpha = 0.55f), pillShape)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier.size(17.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text(
                        text = hint.message,
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        lineHeight = 15.sp
                    )
                    hint.actionDetail?.let { detail ->
                        Text(
                            text = detail,
                            color = Color.White.copy(alpha = 0.72f),
                            fontSize = 10.sp,
                            lineHeight = 13.sp
                        )
                    }
                }
            }
        }
    }
}
