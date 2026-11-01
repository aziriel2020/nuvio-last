package com.nuvio.tv.ui.components

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.nuvio.tv.domain.model.MetaPreview
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * This is the user's existing France calendar card art direction, drawn on the
 * Shield (Jetpack Compose) rather than generating a new bitmap on Oracle:
 * navy/cyan lower gradient, cyan separator, FILM/SÉRIE and platform badges,
 * large white title, event date and provider accent. It is NOT a new theme.
 *
 * Global opt-in: applies to all movie/series metadata cards from every addon,
 * without changing collection-folder cover images or original metadata.
 */
object FranceOverlaySettings {
    private const val PREFS = "nuvio_france_overlay"
    private const val ENABLED = "design_france_all_collections"
    var enabled by mutableStateOf(false)
        private set
    private var initialized = false

    fun initialize(context: Context) {
        if (initialized) return
        enabled = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(ENABLED, false)
        initialized = true
    }

    fun toggle(context: Context) {
        initialize(context)
        enabled = !enabled
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(ENABLED, enabled).apply()
    }
}

/** No image bytes or extra HTTP calls. Read only recognized image renderer query parameters. */
object FranceOverlayArtwork {
    private val rendererNames = setOf(
        "calendar-card.jpg", "calendar-card.svg", "desktop-content-card.jpg",
        "shield-content-card.jpg", "content-card.jpg", "original.jpg", "original.png"
    )
    private val allowedHosts = setOf(
        "image.tmdb.org", "artworks.thetvdb.com", "static.tvmaze.com",
        "s1.anilist.co", "s2.anilist.co", "s3.anilist.co", "s4.anilist.co", "img.anili.st"
    )
    private val tmdbSize = Regex("/t/p/(?:original|w[0-9]+|h[0-9]+)/")

    private fun normalizedCandidate(url: String?, landscape: Boolean): String? {
        val uri = runCatching { Uri.parse(url ?: return null) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) ||
            uri.host?.lowercase(Locale.ROOT) !in allowedHosts) return null
        if (uri.userInfo != null) return null
        val source = uri.toString()
        if (uri.host.equals("image.tmdb.org", ignoreCase = true)) {
            return source.replace(tmdbSize, if (landscape) "/t/p/w780/" else "/t/p/w500/")
        }
        return source
    }

    /** Protect against double design: old France/Oracle bitmaps are already decorated. */
    fun shouldPaint(url: String?): Boolean {
        if (!FranceOverlaySettings.enabled || url.isNullOrBlank()) return false
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return true
        return !(uri.lastPathSegment in rendererNames && uri.host?.lowercase(Locale.ROOT) !in allowedHosts)
    }

    fun image(url: String?, landscape: Boolean): String? {
        if (!FranceOverlaySettings.enabled || url.isNullOrBlank()) return url
        normalizedCandidate(url, landscape)?.let { return it }
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
        if (uri.lastPathSegment !in rendererNames) return url
        val keys = if (landscape) listOf("src", "background", "poster", "fallback")
            else listOf("fallback", "poster", "src", "background")
        for (key in keys) {
            normalizedCandidate(uri.getQueryParameter(key), landscape)?.let { return it }
        }
        return url
    }
}

private fun accentFor(source: String): Color {
    val tag = source.lowercase(Locale.ROOT)
    return when {
        "netflix" in tag -> Color(0xFFE50914)
        "prime" in tag -> Color(0xFF22A6F2)
        "disney" in tag -> Color(0xFF32D4FF)
        "canal" in tag -> Color(0xFFF4F4F5)
        "apple" in tag -> Color(0xFF94A3B8)
        "max" in tag || "hbo" in tag -> Color(0xFF7C3AED)
        "hulu" in tag -> Color(0xFF1CE783)
        "paramount" in tag -> Color(0xFF2D7FF9)
        "arte" in tag -> Color(0xFFFA481C)
        "cinéma" in tag || "cinema" in tag -> Color(0xFFE11D48)
        "crunchyroll" in tag -> Color(0xFFF97316)
        else -> Color(0xFF38BDF8)
    }
}

private fun dateLabel(released: String?): String? = runCatching {
    val day = LocalDate.parse(released?.take(10))
    val dayToken = day.format(DateTimeFormatter.ofPattern("EEE dd MMM", Locale.FRANCE))
    dayToken.uppercase(Locale.FRANCE).replace(".", "")
}.getOrNull()

@Composable
private fun FranceDesignBadge(label: String, accent: Color, solid: Boolean) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        modifier = Modifier
            .clip(shape)
            .background(if (solid) accent else Color(0xDD020617))
            .then(if (solid) Modifier else Modifier.border(1.dp, accent, shape))
    ) {
        Text(
            text = label,
            fontSize = 9.sp,
            fontWeight = FontWeight.Black,
            color = Color.White,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp)
        )
    }
}

/** Same hierarchy as France's 1600x900 calendar-card design, scaled to a real TV card. */
@Composable
fun FranceCalendarCardOverlay(item: MetaPreview, landscape: Boolean, modifier: Modifier = Modifier) {
    val releaseInfo = item.releaseInfo.orEmpty()
    val parts = releaseInfo.split("•").map { it.trim() }.filter { it.isNotEmpty() }
    val region = item.sourceAddonBaseUrl.orEmpty().lowercase(Locale.ROOT)
    val fallbackProvider = when {
        "/movies" in region -> "FILMS MONDE"
        "/series" in region -> "SÉRIES MONDE"
        "/tr/" in region -> "TURQUIE"
        "/us/" in region -> "USA"
        "/global/" in region -> "MONDE"
        else -> "FRANCE"
    }
    val provider = when {
        parts.size >= 2 -> parts.last().uppercase(Locale.FRANCE)
        parts.size == 1 && parts[0].length >= 4 &&
            !parts[0].matches(Regex("[0-9]{4}")) &&
            !parts[0].contains("AUJOURD", true) &&
            !parts[0].contains("DEMAIN", true) -> parts[0].uppercase(Locale.FRANCE)
        else -> fallbackProvider
    }.take(28)
    // Use the exact release day when available; don't mistake a year for a provider.
    val date = (dateLabel(item.released) ?: when {
        parts.size >= 2 -> parts.dropLast(1).joinToString(" • ")
        parts.size == 1 && provider == fallbackProvider -> parts[0]
        else -> ""
    }).take(62).uppercase(Locale.FRANCE)
    val showSecondaryProvider = provider !in setOf("FILMS MONDE", "SÉRIES MONDE", "FRANCE", "MONDE", "USA", "TURQUIE")
    val accent = accentFor(provider)
    val type = if (item.apiType.equals("movie", ignoreCase = true)) "FILM" else "SÉRIE"
    val titleSize = if (landscape) {
        when {
            item.name.length < 18 -> 18.sp
            item.name.length < 33 -> 15.sp
            else -> 12.sp
        }
    } else {
        if (item.name.length < 24) 16.sp else 13.sp
    }
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val height = maxHeight
        val overlayTop = height * if (landscape) 0.61f else 0.65f
        val compact = maxWidth < 245.dp || maxHeight < 135.dp
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(height - overlayTop)
                .background(
                    Brush.linearGradient(
                        colors = listOf(
                            Color(0xA903152F),
                            Color(0xC5062B5C),
                            Color(0xD00369A1)
                        )
                    )
                )
        )
        Box(
            Modifier
                .align(Alignment.TopStart)
                .offset(y = overlayTop)
                .fillMaxWidth()
                .height(2.dp)
                .background(Color(0xC638BDF8))
        )
        Row(
            modifier = Modifier.align(Alignment.TopEnd).padding(if (compact) 4.dp else 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Box(modifier = Modifier.widthIn(max = maxWidth * 0.58f)) {
                FranceDesignBadge(provider, accent, false)
            }
            FranceDesignBadge(type, accent, true)
        }
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(horizontal = if (compact) 7.dp else 9.dp, vertical = if (compact) 5.dp else 8.dp),
            verticalArrangement = Arrangement.spacedBy(if (compact) 1.dp else 2.dp)
        ) {
            Text(
                text = item.name,
                fontSize = if (compact) titleSize * 0.90f else titleSize,
                lineHeight = titleSize * 1.06f,
                fontWeight = FontWeight.Black,
                letterSpacing = (-0.45).sp,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            if (date.isNotBlank()) {
                Text(
                    text = date,
                    color = Color(0xFFF8FAFC),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            // Avoid the giant FILMS MONDE label repeated under the image.
            if (showSecondaryProvider) {
                Text(
                    text = provider,
                    color = accent,
                    fontSize = if (compact) 8.sp else 10.sp,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
