#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, text):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")

def replace_once(rel, old, new):
    text = read(rel)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{rel}: expected exactly one match, found {count}: {old[:120]!r}")
    write(rel, text.replace(old, new, 1))

poster = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomePosterCard.kt"
replace_once(
    poster,
    """import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
""",
    """import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
""",
)
replace_once(
    poster,
    """import com.nuvio.app.features.home.PosterShape
""",
    """import com.nuvio.app.features.home.PosterShape
import com.nuvio.app.isDesktop
""",
)
replace_once(
    poster,
    """    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
""",
    """    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    onHoverChange: ((MetaPreview, Boolean) -> Unit)? = null,
) {
""",
)
old_body = """    HomePosterHoverPreview(
        item = item,
        isWatched = isWatched,
        onClick = onClick,
        onLongClick = onLongClick,
    ) { hoverModifier ->
        NuvioPosterCard(
            title = item.name,
            imageUrl = if (isLandscapeMode) (item.banner ?: item.poster) else item.poster,
            modifier = modifier.then(hoverModifier),
            basePosterWidthDp = desktopCatalogShelfPosterBaseWidthDp(posterCardStyle.widthDp),
            shape = if (isLandscapeMode) NuvioPosterShape.Landscape else item.posterShape.toNuvioPosterShape(),
            detailLine = if (isLandscapeMode || posterCardStyle.hideLabelsEnabled) null else item.releaseInfo?.let { formatReleaseDateForDisplay(it) },
            showTitleBelow = !posterCardStyle.hideLabelsEnabled,
            bottomLeftLogoUrl = if (isLandscapeMode) item.logo else null,
            bottomLeftText = if (isLandscapeMode && item.logo.isNullOrBlank() && !posterCardStyle.hideLabelsEnabled) item.name else null,
            isWatched = isWatched,
            onClick = onClick,
            onLongClick = onLongClick,
        )
    }
"""
new_body = """    val posterContent: @Composable (Modifier) -> Unit = { hoverModifier ->
        NuvioPosterCard(
            title = item.name,
            imageUrl = if (isLandscapeMode) (item.banner ?: item.poster) else item.poster,
            modifier = modifier.then(hoverModifier),
            basePosterWidthDp = desktopCatalogShelfPosterBaseWidthDp(posterCardStyle.widthDp),
            shape = if (isLandscapeMode) NuvioPosterShape.Landscape else item.posterShape.toNuvioPosterShape(),
            detailLine = if (isLandscapeMode || posterCardStyle.hideLabelsEnabled) null else item.releaseInfo?.let { formatReleaseDateForDisplay(it) },
            showTitleBelow = !posterCardStyle.hideLabelsEnabled,
            bottomLeftLogoUrl = if (isLandscapeMode) item.logo else null,
            bottomLeftText = if (isLandscapeMode && item.logo.isNullOrBlank() && !posterCardStyle.hideLabelsEnabled) item.name else null,
            isWatched = isWatched,
            onClick = onClick,
            onLongClick = onLongClick,
        )
    }

    if (isDesktop && onHoverChange != null) {
        val hoverInteractionSource = remember(item.type, item.id) { MutableInteractionSource() }
        val isHovered by hoverInteractionSource.collectIsHoveredAsState()

        LaunchedEffect(item.type, item.id, isHovered) {
            onHoverChange(item, isHovered)
        }
        DisposableEffect(item.type, item.id) {
            onDispose { onHoverChange(item, false) }
        }

        posterContent(Modifier.hoverable(hoverInteractionSource))
    } else {
        HomePosterHoverPreview(
            item = item,
            isWatched = isWatched,
            onClick = onClick,
            onLongClick = onLongClick,
        ) { hoverModifier ->
            posterContent(hoverModifier)
        }
    }
"""
replace_once(poster, old_body, new_body)

catalog = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomeCatalogSection.kt"
replace_once(
    catalog,
    """    onPosterClick: ((MetaPreview) -> Unit)? = null,
    onPosterLongClick: ((MetaPreview) -> Unit)? = null,
) {
""",
    """    onPosterClick: ((MetaPreview) -> Unit)? = null,
    onPosterLongClick: ((MetaPreview) -> Unit)? = null,
    onPosterHoverChange: ((MetaPreview, Boolean) -> Unit)? = null,
) {
""",
)
replace_once(
    catalog,
    """            onPosterClick = onPosterClick,
            onPosterLongClick = onPosterLongClick,
        )
""",
    """            onPosterClick = onPosterClick,
            onPosterLongClick = onPosterLongClick,
            onPosterHoverChange = onPosterHoverChange,
        )
""",
)
replace_once(
    catalog,
    """                onPosterClick = onPosterClick,
                onPosterLongClick = onPosterLongClick,
            )
""",
    """                onPosterClick = onPosterClick,
                onPosterLongClick = onPosterLongClick,
                onPosterHoverChange = onPosterHoverChange,
            )
""",
)
replace_once(
    catalog,
    """    onPosterClick: ((MetaPreview) -> Unit)?,
    onPosterLongClick: ((MetaPreview) -> Unit)?,
) {
""",
    """    onPosterClick: ((MetaPreview) -> Unit)?,
    onPosterLongClick: ((MetaPreview) -> Unit)?,
    onPosterHoverChange: ((MetaPreview, Boolean) -> Unit)?,
) {
""",
)
replace_once(
    catalog,
    """            onClick = onPosterClick?.let { { it(item) } },
            onLongClick = onPosterLongClick?.let { { it(item) } },
        )
""",
    """            onClick = onPosterClick?.let { { it(item) } },
            onLongClick = onPosterLongClick?.let { { it(item) } },
            onHoverChange = onPosterHoverChange,
        )
""",
)

screen = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/HomeScreen.kt"
replace_once(
    screen,
    """    var observedOfflineState by remember { mutableStateOf(false) }
""",
    """    var observedOfflineState by remember { mutableStateOf(false) }
    var hoveredHeroItem by remember { mutableStateOf<MetaPreview?>(null) }
""",
)
replace_once(
    screen,
    """                        homeUiState.heroItems.isNotEmpty() -> HomeHeroSection(
                            items = homeUiState.heroItems,
                            modifier = Modifier,
""",
    """                        homeUiState.heroItems.isNotEmpty() -> HomeHeroSection(
                            items = homeUiState.heroItems,
                            hoverItem = hoveredHeroItem,
                            modifier = Modifier,
""",
)
replace_once(
    screen,
    """                                        onPosterClick = onPosterClick,
                                        onPosterLongClick = onPosterLongClick,
                                    )
""",
    """                                        onPosterClick = onPosterClick,
                                        onPosterLongClick = onPosterLongClick,
                                        onPosterHoverChange = if (isDesktop && homeSettingsUiState.heroEnabled) {
                                            { item, isHovered ->
                                                if (isHovered) {
                                                    hoveredHeroItem = item
                                                } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                                    hoveredHeroItem = null
                                                }
                                            }
                                        } else {
                                            null
                                        },
                                    )
""",
)

hero = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomeHeroSection.kt"
replace_once(
    hero,
    """import com.nuvio.app.isDesktop
""",
    """import com.nuvio.app.isDesktop
import com.nuvio.app.core.build.AppFeaturePolicy
import com.nuvio.app.core.build.TrailerPlaybackMode
""",
)
replace_once(
    hero,
    """import com.nuvio.app.core.ui.NuvioTokens
""",
    """import com.nuvio.app.core.ui.NuvioTokens
import com.nuvio.app.core.ui.rememberPosterCardStyleUiState
""",
)
replace_once(
    hero,
    """import com.nuvio.app.features.home.MetaPreview
""",
    """import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.details.MetaDetailsRepository
import com.nuvio.app.features.home.MetaPreview
import com.nuvio.app.features.home.stableKey
import com.nuvio.app.features.trailer.TrailerPlaybackSource
""",
)
replace_once(
    hero,
    """import kotlinx.coroutines.CoroutineScope
""",
    """import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
""",
)
replace_once(
    hero,
    """private const val HERO_AUTO_SCROLL_INTERVAL_MS = 8_000L
""",
    """private const val HERO_AUTO_SCROLL_INTERVAL_MS = 8_000L
private const val DESKTOP_HOVER_HERO_ENRICH_DEBOUNCE_MS = 450L
""",
)
replace_once(
    hero,
    """fun HomeHeroSection(
    items: List<MetaPreview>,
    modifier: Modifier = Modifier,
""",
    """fun HomeHeroSection(
    items: List<MetaPreview>,
    hoverItem: MetaPreview? = null,
    modifier: Modifier = Modifier,
""",
)
replace_once(
    hero,
    """    LaunchedEffect(autoScrollPage, items.size) {
        if (items.size <= 1) return@LaunchedEffect
""",
    """    LaunchedEffect(autoScrollPage, items.size, hoverItem?.stableKey()) {
        if (isDesktop && hoverItem != null) return@LaunchedEffect
        if (items.size <= 1) return@LaunchedEffect
""",
)
replace_once(
    hero,
    """                DesktopHomeHeroFrame(
                    items = items,
                    pagerState = pagerState,
""",
    """                DesktopHomeHeroFrame(
                    items = items,
                    hoverItem = hoverItem,
                    pagerState = pagerState,
""",
)
replace_once(
    hero,
    """private fun DesktopHomeHeroFrame(
    items: List<MetaPreview>,
    pagerState: PagerState,
""",
    """private fun DesktopHomeHeroFrame(
    items: List<MetaPreview>,
    hoverItem: MetaPreview?,
    pagerState: PagerState,
""",
)
replace_once(
    hero,
    """    val colorScheme = MaterialTheme.colorScheme
    val opacity = NuvioTokens.Opacity
""",
    """    if (hoverItem != null) {
        DesktopHoveredHomeHeroFrame(
            item = hoverItem,
            layout = layout,
            contentHorizontalPadding = contentHorizontalPadding,
            onItemClick = onItemClick,
        )
        return
    }

    val colorScheme = MaterialTheme.colorScheme
    val opacity = NuvioTokens.Opacity
""",
)

hover_frame = r'''
internal fun mergeDesktopHoverHeroMeta(
    item: MetaPreview,
    meta: MetaDetails?,
): MetaPreview {
    if (meta == null) return item
    return item.copy(
        name = meta.name.takeIf { it.isNotBlank() } ?: item.name,
        poster = meta.poster ?: item.poster,
        banner = meta.background ?: item.banner ?: item.poster,
        logo = meta.logo ?: item.logo,
        description = meta.description ?: item.description,
        releaseInfo = meta.releaseInfo ?: item.releaseInfo,
        imdbRating = meta.imdbRating ?: item.imdbRating,
        genres = meta.genres.ifEmpty { item.genres },
    )
}

@Composable
private fun DesktopHoveredHomeHeroFrame(
    item: MetaPreview,
    layout: HomeHeroLayout,
    contentHorizontalPadding: Dp,
    onItemClick: ((MetaPreview) -> Unit)?,
) {
    val colorScheme = MaterialTheme.colorScheme
    val opacity = NuvioTokens.Opacity
    val space = NuvioTokens.Space
    val backgroundColor = colorScheme.background
    val posterCardStyle = rememberPosterCardStyleUiState()
    val trailerPlaybackEnabled =
        AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP &&
            posterCardStyle.hoverPreviewTrailerEnabled

    var resolvedItem by remember(item.stableKey()) { mutableStateOf(item) }
    var trailerPlaybackSource by remember(item.stableKey()) {
        mutableStateOf<TrailerPlaybackSource?>(null)
    }

    LaunchedEffect(item.stableKey(), trailerPlaybackEnabled) {
        resolvedItem = item
        trailerPlaybackSource = null
        delay(DESKTOP_HOVER_HERO_ENRICH_DEBOUNCE_MS)

        val meta = try {
            MetaDetailsRepository.peek(type = item.type, id = item.id)
                ?: MetaDetailsRepository.fetch(type = item.type, id = item.id)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Throwable) {
            null
        }
        resolvedItem = mergeDesktopHoverHeroMeta(item, meta)

        if (trailerPlaybackEnabled) {
            trailerPlaybackSource = try {
                resolveHomePosterHoverTrailerPlaybackSource(item)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Throwable) {
                null
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor),
    ) {
        val imageUrl = resolvedItem.banner ?: resolvedItem.poster
        if (!imageUrl.isNullOrBlank()) {
            AsyncImage(
                model = originalTmdbImageUrl(imageUrl),
                contentDescription = resolvedItem.name,
                modifier = Modifier.fillMaxSize(),
                alignment = BiasAlignment(
                    horizontalBias = 0f,
                    verticalBias = DesktopBackdropVerticalBias,
                ),
                contentScale = ContentScale.Crop,
                desktopImageScaling = NuvioDesktopImageScaling.Disabled,
            )
        }

        if (trailerPlaybackEnabled) {
            HomePosterHoverTrailer(
                playbackSource = trailerPlaybackSource,
                soundEnabled = posterCardStyle.hoverPreviewTrailerSoundEnabled,
                startPositionSeconds = posterCardStyle.hoverPreviewTrailerStartSeconds,
                modifier = Modifier.fillMaxSize(),
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(layout.topFadeHeight)
                .align(Alignment.TopCenter)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            backgroundColor.copy(alpha = opacity.overlayHeavy),
                            Color.Transparent,
                        ),
                    ),
                ),
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0.00f to backgroundColor.copy(alpha = 0.96f),
                            0.08f to backgroundColor.copy(alpha = 0.90f),
                            0.16f to backgroundColor.copy(alpha = 0.76f),
                            0.26f to backgroundColor.copy(alpha = 0.54f),
                            0.36f to backgroundColor.copy(alpha = 0.30f),
                            0.46f to backgroundColor.copy(alpha = 0.12f),
                            0.54f to Color.Transparent,
                        ),
                    ),
                ),
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(layout.bottomFadeHeight)
                .align(Alignment.BottomCenter)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            backgroundColor.copy(alpha = 0f),
                            backgroundColor,
                        ),
                    ),
                ),
        )

        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(max = layout.contentContainerMaxWidth)
                .fillMaxSize(),
        ) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(
                        start = contentHorizontalPadding,
                        end = space.s32,
                        bottom = layout.contentVerticalPadding,
                    )
                    .fillMaxWidth(layout.contentWidthFraction)
                    .widthIn(max = layout.contentMaxWidth),
                contentAlignment = Alignment.CenterStart,
            ) {
                DesktopHeroContentBlock(
                    item = resolvedItem,
                    layout = layout,
                    onItemClick = onItemClick,
                )
            }

            if (isFullscreenActionSupported) {
                FullscreenActionButton(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(
                            top = space.s32,
                            end = contentHorizontalPadding,
                        ),
                    buttonSize = 48.dp,
                    iconSize = 24.dp,
                    containerColor = colorScheme.surfaceVariant.copy(alpha = 0.82f),
                    contentColor = colorScheme.onSurface,
                )
            }
        }
    }
}

'''
marker = "@Composable\nprivate fun DesktopHomeHeroFrame(\n"
hero_text = read(hero)
if hero_text.count(marker) != 1:
    raise SystemExit(f"{hero}: DesktopHomeHeroFrame marker mismatch")
write(hero, hero_text.replace(marker, hover_frame + marker, 1))

test_path = "composeApp/src/commonTest/kotlin/com/nuvio/app/features/home/components/DesktopHoverHeroTest.kt"
write(
    test_path,
    """package com.nuvio.app.features.home.components

import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.home.MetaPreview
import kotlin.test.Test
import kotlin.test.assertEquals

class DesktopHoverHeroTest {
    @Test
    fun hoverHeroPrefersEnrichedMetadata() {
        val base = MetaPreview(
            id = "tt1234567",
            type = "series",
            name = "Base title",
            poster = "base-poster",
            banner = "base-banner",
            description = "Base description",
            releaseInfo = "2026",
            genres = listOf("Drama"),
        )
        val meta = MetaDetails(
            id = base.id,
            type = base.type,
            name = "TMDb title",
            poster = "tmdb-poster",
            background = "tmdb-backdrop",
            logo = "tmdb-logo",
            description = "TMDb description",
            releaseInfo = "2026 • 1 season",
            imdbRating = "8.7",
            genres = listOf("Drama", "Mystery"),
        )

        val merged = mergeDesktopHoverHeroMeta(base, meta)

        assertEquals("TMDb title", merged.name)
        assertEquals("tmdb-poster", merged.poster)
        assertEquals("tmdb-backdrop", merged.banner)
        assertEquals("tmdb-logo", merged.logo)
        assertEquals("TMDb description", merged.description)
        assertEquals("2026 • 1 season", merged.releaseInfo)
        assertEquals("8.7", merged.imdbRating)
        assertEquals(listOf("Drama", "Mystery"), merged.genres)
    }
}
""",
)

print("Desktop hover Hero patch applied successfully.")
