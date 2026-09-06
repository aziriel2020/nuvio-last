from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

catalog_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/catalog/CatalogScreen.kt"
folder_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/FolderDetailScreen.kt"
poster_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomePosterCard.kt"
section_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomeCatalogSection.kt"
hero_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/CatalogHoverHero.kt"

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

poster_path.write_text(r'''package com.nuvio.app.features.home.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.onPointerEvent
import com.nuvio.app.core.format.formatReleaseDateForDisplay
import com.nuvio.app.core.ui.NuvioPosterCard
import com.nuvio.app.core.ui.NuvioPosterShape
import com.nuvio.app.core.ui.desktopCatalogShelfPosterBaseWidthDp
import com.nuvio.app.core.ui.rememberPosterCardStyleUiState
import com.nuvio.app.features.home.MetaPreview
import com.nuvio.app.features.home.PosterShape

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun HomePosterCard(
    item: MetaPreview,
    modifier: Modifier = Modifier,
    useLandscapeBackdropMode: Boolean = false,
    useHoverPreview: Boolean = true,
    onHoverChanged: ((Boolean) -> Unit)? = null,
    isWatched: Boolean = false,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
            .onPointerEvent(PointerEventType.Enter) { onHoverChanged(true) }
            .onPointerEvent(PointerEventType.Exit) { onHoverChanged(false) }
    } else {
        modifier
    }

    val cardContent: @Composable (Modifier) -> Unit = { hoverModifier ->
        NuvioPosterCard(
            title = item.name,
            imageUrl = if (isLandscapeMode) (item.banner ?: item.poster) else item.poster,
            modifier = hoverAwareModifier.then(hoverModifier),
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

    if (useHoverPreview) {
        HomePosterHoverPreview(
            item = item,
            isWatched = isWatched,
            onClick = onClick,
            onLongClick = onLongClick,
            content = cardContent,
        )
    } else {
        cardContent(Modifier)
    }
}

private fun PosterShape.toNuvioPosterShape(): NuvioPosterShape =
    when (this) {
        PosterShape.Poster -> NuvioPosterShape.Poster
        PosterShape.Square -> NuvioPosterShape.Square
        PosterShape.Landscape -> NuvioPosterShape.Landscape
    }
''', encoding="utf-8")

section_path.write_text(r'''package com.nuvio.app.features.home.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.nuvio.app.core.ui.NuvioShelfSection
import com.nuvio.app.core.ui.NuvioViewAllPillSize
import com.nuvio.app.core.ui.rememberPosterCardStyleUiState
import com.nuvio.app.isDesktop
import com.nuvio.app.features.home.HomeCatalogSection
import com.nuvio.app.features.home.MetaPreview
import com.nuvio.app.features.home.stableKey
import com.nuvio.app.features.watching.application.WatchingState

@Composable
fun HomeCatalogRowSection(
    section: HomeCatalogSection,
    modifier: Modifier = Modifier,
    entries: List<MetaPreview> = section.items,
    watchedKeys: Set<String> = emptySet(),
    fullyWatchedSeriesKeys: Set<String> = emptySet(),
    sectionPadding: Dp? = null,
    onViewAllClick: (() -> Unit)? = null,
    onPosterClick: ((MetaPreview) -> Unit)? = null,
    onPosterLongClick: ((MetaPreview) -> Unit)? = null,
    useHoverPreview: Boolean = true,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
    if (sectionPadding != null) {
        HomeCatalogRowSectionContent(
            section = section,
            entries = entries,
            watchedKeys = watchedKeys,
            fullyWatchedSeriesKeys = fullyWatchedSeriesKeys,
            modifier = modifier.fillMaxWidth(),
            sectionPadding = sectionPadding,
            onViewAllClick = onViewAllClick,
            onPosterClick = onPosterClick,
            onPosterLongClick = onPosterLongClick,
            useHoverPreview = useHoverPreview,
            onPosterHoverChanged = onPosterHoverChanged,
        )
    } else {
        BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
            HomeCatalogRowSectionContent(
                section = section,
                entries = entries,
                watchedKeys = watchedKeys,
                fullyWatchedSeriesKeys = fullyWatchedSeriesKeys,
                modifier = Modifier.fillMaxWidth(),
                sectionPadding = homeSectionHorizontalPaddingForWidth(maxWidth.value),
                onViewAllClick = onViewAllClick,
                onPosterClick = onPosterClick,
                onPosterLongClick = onPosterLongClick,
                useHoverPreview = useHoverPreview,
                onPosterHoverChanged = onPosterHoverChanged,
            )
        }
    }
}

@Composable
private fun HomeCatalogRowSectionContent(
    section: HomeCatalogSection,
    entries: List<MetaPreview>,
    watchedKeys: Set<String>,
    fullyWatchedSeriesKeys: Set<String>,
    modifier: Modifier,
    sectionPadding: Dp,
    onViewAllClick: (() -> Unit)?,
    onPosterClick: ((MetaPreview) -> Unit)?,
    onPosterLongClick: ((MetaPreview) -> Unit)?,
    useHoverPreview: Boolean,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)?,
) {
    val posterCardStyle = rememberPosterCardStyleUiState()

    NuvioShelfSection(
        title = section.title,
        entries = entries,
        modifier = modifier,
        headerHorizontalPadding = sectionPadding,
        rowContentPadding = PaddingValues(horizontal = sectionPadding),
        onViewAllClick = onViewAllClick,
        onTitleClick = onViewAllClick?.takeIf { isDesktop },
        viewAllPillSize = NuvioViewAllPillSize.Compact,
        key = { item -> item.stableKey() },
    ) { item ->
        HomePosterCard(
            item = item,
            useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
            useHoverPreview = useHoverPreview,
            onHoverChanged = onPosterHoverChanged?.let { callback ->
                { hovered -> callback(item, hovered) }
            },
            isWatched = WatchingState.isPosterWatched(
                watchedKeys = watchedKeys,
                item = item,
                fullyWatchedSeriesKeys = fullyWatchedSeriesKeys,
            ),
            onClick = onPosterClick?.let { { it(item) } },
            onLongClick = onPosterLongClick?.let { { it(item) } },
        )
    }
}
''', encoding="utf-8")

hero_path.write_text(r'''package com.nuvio.app.features.home.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nuvio.app.core.build.AppFeaturePolicy
import com.nuvio.app.core.build.TrailerPlaybackMode
import com.nuvio.app.core.ui.NuvioAsyncImage as AsyncImage
import com.nuvio.app.core.ui.NuvioBackButton
import com.nuvio.app.core.ui.rememberPosterCardStyleUiState
import com.nuvio.app.features.details.MetaDetails
import com.nuvio.app.features.details.MetaDetailsRepository
import com.nuvio.app.features.home.MetaPreview
import com.nuvio.app.features.tmdb.originalTmdbImageUrl
import com.nuvio.app.features.trailer.TrailerPlaybackSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private const val CatalogHeroEnrichmentDelayMillis = 450L
private const val CatalogHeroTrailerFadeMillis = 480
private val CatalogHeroCornerRadius = 20.dp

@Composable
internal fun CatalogHoverHero(
    selectedItem: MetaPreview,
    isHoverActive: Boolean,
    pageTitle: String,
    pageSubtitle: String = "",
    onBack: (() -> Unit)? = null,
    showBack: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val posterCardStyle = rememberPosterCardStyleUiState()
    var resolvedMeta by remember(selectedItem.type, selectedItem.id) {
        mutableStateOf<MetaDetails?>(null)
    }
    var trailerPlaybackSource by remember(selectedItem.type, selectedItem.id) {
        mutableStateOf<TrailerPlaybackSource?>(null)
    }

    LaunchedEffect(selectedItem.type, selectedItem.id, isHoverActive) {
        resolvedMeta = null
        if (!isHoverActive) return@LaunchedEffect
        delay(CatalogHeroEnrichmentDelayMillis)
        resolvedMeta = try {
            MetaDetailsRepository.peek(type = selectedItem.type, id = selectedItem.id)
                ?: MetaDetailsRepository.fetch(type = selectedItem.type, id = selectedItem.id)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Throwable) {
            null
        }
    }

    val trailerPlaybackEnabled =
        AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP &&
            posterCardStyle.hoverPreviewTrailerEnabled

    LaunchedEffect(
        selectedItem.type,
        selectedItem.id,
        isHoverActive,
        trailerPlaybackEnabled,
        posterCardStyle.hoverPreviewOpenDelayMillis,
    ) {
        trailerPlaybackSource = null
        if (!isHoverActive || !trailerPlaybackEnabled) return@LaunchedEffect
        delay(posterCardStyle.hoverPreviewOpenDelayMillis.toLong())
        trailerPlaybackSource = try {
            resolveHomePosterHoverTrailerPlaybackSource(selectedItem)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Throwable) {
            null
        }
    }

    val meta = resolvedMeta
    val title = meta?.name?.takeIf { it.isNotBlank() } ?: selectedItem.name
    val backdrop = originalTmdbImageUrl(
        meta?.background?.takeIf { it.isNotBlank() }
            ?: selectedItem.banner
            ?: selectedItem.poster,
    )
    val logo = originalTmdbImageUrl(
        meta?.logo?.takeIf { it.isNotBlank() }
            ?: selectedItem.logo,
    )
    val description = meta?.description?.takeIf { it.isNotBlank() }
        ?: selectedItem.description
    val releaseInfo = meta?.releaseInfo?.takeIf { it.isNotBlank() }
        ?: selectedItem.releaseInfo
    val rating = meta?.imdbRating?.takeIf { it.isNotBlank() }
        ?: selectedItem.imdbRating
    val genres = meta?.genres?.takeIf { it.isNotEmpty() }
        ?: selectedItem.genres
    val primaryMeta = buildList {
        releaseInfo?.takeIf { it.isNotBlank() }?.let(::add)
        meta?.runtime?.takeIf { it.isNotBlank() }?.let(::add)
        meta?.ageRating?.takeIf { it.isNotBlank() }?.let(::add)
        rating?.let { add("IMDb $it") }
    }.joinToString("  •  ")

    val backgroundColor = MaterialTheme.colorScheme.background

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(CatalogHeroCornerRadius))
            .background(backgroundColor),
    ) {
        if (!backdrop.isNullOrBlank()) {
            AsyncImage(
                model = backdrop,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                alignment = Alignment.Center,
            )
        }

        AnimatedVisibility(
            visible = trailerPlaybackSource != null,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxWidth(0.70f)
                .fillMaxHeight(),
            enter = fadeIn(tween(CatalogHeroTrailerFadeMillis)),
            exit = fadeOut(tween(180)),
        ) {
            trailerPlaybackSource?.let { source ->
                HomePosterHoverTrailer(
                    playbackSource = source,
                    soundEnabled = posterCardStyle.hoverPreviewTrailerSoundEnabled,
                    startPositionSeconds = posterCardStyle.hoverPreviewTrailerStartSeconds,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 0.99f),
                            0.22f to backgroundColor.copy(alpha = 0.96f),
                            0.45f to backgroundColor.copy(alpha = 0.76f),
                            0.70f to backgroundColor.copy(alpha = 0.16f),
                            1f to Color.Transparent,
                        ),
                    ),
                ),
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 0.42f),
                            0.18f to Color.Transparent,
                            0.68f to Color.Transparent,
                            1f to backgroundColor.copy(alpha = 0.96f),
                        ),
                    ),
                ),
        )

        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, top = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showBack && onBack != null) {
                NuvioBackButton(
                    onClick = onBack,
                    modifier = Modifier.size(46.dp),
                    containerColor = Color.Black.copy(alpha = 0.34f),
                    contentColor = Color.White,
                    iconSize = 24.dp,
                )
                Spacer(modifier = Modifier.size(14.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = pageTitle,
                    style = MaterialTheme.typography.displaySmall.copy(
                        fontWeight = FontWeight.ExtraBold,
                    ),
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (pageSubtitle.isNotBlank()) {
                    Text(
                        text = pageSubtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.72f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 34.dp, end = 28.dp, bottom = 34.dp)
                .widthIn(max = 570.dp),
            verticalArrangement = Arrangement.Bottom,
        ) {
            if (!logo.isNullOrBlank()) {
                AsyncImage(
                    model = logo,
                    contentDescription = title,
                    modifier = Modifier
                        .fillMaxWidth(0.68f)
                        .height(86.dp),
                    contentScale = ContentScale.Fit,
                    alignment = Alignment.CenterStart,
                )
            } else {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineLarge.copy(
                        fontWeight = FontWeight.ExtraBold,
                    ),
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (primaryMeta.isNotBlank()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = primaryMeta,
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White.copy(alpha = 0.90f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (genres.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = genres.take(4).joinToString("  •  "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.76f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (!description.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.White.copy(alpha = 0.93f),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
''', encoding="utf-8")

catalog = catalog_path.read_text(encoding="utf-8")
catalog = replace_once(
    catalog,
    "import com.nuvio.app.features.home.components.HomeEmptyStateCard\n",
    "import com.nuvio.app.features.home.components.CatalogHoverHero\nimport com.nuvio.app.features.home.components.HomeEmptyStateCard\n",
    "catalog hero import",
)
catalog = catalog.replace(
    "import org.jetbrains.compose.resources.stringResource\n\n@Composable\n",
    "import org.jetbrains.compose.resources.stringResource\n\nprivate val CatalogCoverHeroHeight = 430.dp\n\n@Composable\n",
    1,
)
catalog = replace_once(
    catalog,
    "    var headerHeightPx by remember { mutableIntStateOf(0) }\n    var observedOfflineState by remember { mutableStateOf(false) }\n",
    "    var headerHeightPx by remember { mutableIntStateOf(0) }\n    var observedOfflineState by remember { mutableStateOf(false) }\n    var hoveredHeroItem by remember(target) { mutableStateOf<MetaPreview?>(null) }\n",
    "catalog hover state",
)
catalog = replace_once(
    catalog,
    "        val basePosterWidthDp = catalogPosterBaseWidthDp(posterCardStyle.widthDp)\n",
    "        val basePosterWidthDp = catalogPosterBaseWidthDp(posterCardStyle.widthDp)\n        val headerHeightDp = with(androidx.compose.ui.platform.LocalDensity.current) { headerHeightPx.toDp() }\n        val showDesktopHero = isDesktop && uiState.items.isNotEmpty()\n",
    "catalog layout state",
)
catalog = replace_once(
    catalog,
    '''                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = pageHorizontalPadding,
                    top = with(androidx.compose.ui.platform.LocalDensity.current) { headerHeightPx.toDp() } + 12.dp,
''',
    '''                modifier = Modifier
                    .fillMaxSize()
                    .padding(
                        top = if (showDesktopHero) CatalogCoverHeroHeight + 18.dp else 0.dp,
                    ),
                contentPadding = PaddingValues(
                    start = pageHorizontalPadding,
                    top = if (isDesktop) {
                        if (showDesktopHero) 0.dp else headerHeightDp + 12.dp
                    } else {
                        headerHeightDp + 12.dp
                    },
''',
    "catalog grid placement",
)
catalog = replace_once(
    catalog,
    '''                            HomePosterCard(
                                item = item,
                                useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                isWatched = isWatched,
''',
    '''                            HomePosterCard(
                                item = item,
                                useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                useHoverPreview = false,
                                onHoverChanged = { hovered ->
                                    if (hovered) {
                                        hoveredHeroItem = item
                                    } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                        hoveredHeroItem = null
                                    }
                                },
                                isWatched = isWatched,
''',
    "catalog poster hover",
)
catalog = replace_once(
    catalog,
    '''            NuvioDesktopVerticalScrollbar(
                state = gridState,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .padding(vertical = 8.dp, horizontal = 4.dp),
            )

            CatalogHeader(
                title = title,
                subtitle = subtitle,
                pageHorizontalPadding = pageHorizontalPadding,
                modifier = Modifier.onSizeChanged { headerHeightPx = it.height },
                onBack = onBack,
            )
''',
    '''            NuvioDesktopVerticalScrollbar(
                state = gridState,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .padding(
                        top = if (showDesktopHero) CatalogCoverHeroHeight + 18.dp else 8.dp,
                        bottom = 8.dp,
                        start = 4.dp,
                        end = 4.dp,
                    ),
            )

            if (showDesktopHero) {
                CatalogHoverHero(
                    selectedItem = hoveredHeroItem ?: uiState.items.first(),
                    isHoverActive = hoveredHeroItem != null,
                    pageTitle = title,
                    pageSubtitle = subtitle,
                    onBack = onBack,
                    showBack = !LocalUseNativeNavigation.current,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(
                            start = pageHorizontalPadding,
                            end = pageHorizontalPadding,
                            top = 12.dp,
                        )
                        .fillMaxWidth()
                        .height(CatalogCoverHeroHeight - 12.dp),
                )
            } else {
                CatalogHeader(
                    title = title,
                    subtitle = subtitle,
                    pageHorizontalPadding = pageHorizontalPadding,
                    modifier = Modifier.onSizeChanged { headerHeightPx = it.height },
                    onBack = onBack,
                )
            }
''',
    "catalog fused cover hero",
)
catalog_path.write_text(catalog, encoding="utf-8")

folder = folder_path.read_text(encoding="utf-8")
folder = replace_once(
    folder,
    "import androidx.compose.runtime.mutableFloatStateOf\n",
    "import androidx.compose.runtime.mutableFloatStateOf\nimport androidx.compose.runtime.mutableStateOf\n",
    "folder state import",
)
folder = replace_once(
    folder,
    "import com.nuvio.app.features.home.components.HomeCatalogRowSection\n",
    "import com.nuvio.app.features.home.components.CatalogHoverHero\nimport com.nuvio.app.features.home.components.HomeCatalogRowSection\n",
    "folder hero import",
)
folder = folder.replace(
    "private val FolderCoverHeight = 176.dp\n",
    "private val FolderCoverHeight = 176.dp\nprivate val FolderCoverHeroHeight = 430.dp\n",
    1,
)
folder = replace_once(
    folder,
    "    val coverImageUrl = folder?.coverImageUrl?.takeIf { it.isNotBlank() }\n",
    "    val coverImageUrl = folder?.coverImageUrl?.takeIf { it.isNotBlank() }\n    var hoveredHeroItem by remember(uiState.collectionTitle, uiState.viewMode) { mutableStateOf<MetaPreview?>(null) }\n",
    "folder hover state",
)
folder = replace_once(
    folder,
    '''            Column(modifier = Modifier.fillMaxSize()) {
                if (!useNativeNavigation) {
                    NuvioScreenHeader(
                        title = folder?.title ?: uiState.collectionTitle,
                        modifier = Modifier.padding(horizontal = desktopPagePadding),
                        backgroundColor = Color.Transparent,
                        includeStatusBarPadding = false,
                        topPadding = 32.dp,
                        onBack = onBack,
                    )
                }

                if (folder == null && !uiState.isLoading) {
''',
    '''            Column(modifier = Modifier.fillMaxSize()) {
                if (folder == null && !uiState.isLoading) {
''',
    "folder remove separate desktop header",
)
folder = replace_once(
    folder,
    '''                when (uiState.viewMode) {
                    FolderViewMode.TABBED_GRID -> TabbedGridContent(
''',
    '''                val defaultHeroItem = when (uiState.viewMode) {
                    FolderViewMode.TABBED_GRID -> uiState.tabs
                        .getOrNull(uiState.selectedTabIndex)
                        ?.items
                        ?.firstOrNull()
                    FolderViewMode.ROWS,
                    FolderViewMode.FOLLOW_LAYOUT,
                    -> FolderDetailRepository.getCatalogSectionsForRows()
                        .firstOrNull { it.items.isNotEmpty() }
                        ?.items
                        ?.firstOrNull()
                }

                LaunchedEffect(uiState.viewMode, uiState.selectedTabIndex, defaultHeroItem?.stableKey()) {
                    hoveredHeroItem = null
                }

                if (defaultHeroItem != null) {
                    CatalogHoverHero(
                        selectedItem = hoveredHeroItem ?: defaultHeroItem,
                        isHoverActive = hoveredHeroItem != null,
                        pageTitle = folder?.title ?: uiState.collectionTitle,
                        onBack = onBack,
                        showBack = !useNativeNavigation,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(FolderCoverHeroHeight)
                            .padding(
                                start = desktopPagePadding,
                                end = desktopPagePadding,
                                top = 12.dp,
                                bottom = 6.dp,
                            ),
                    )
                } else if (!useNativeNavigation) {
                    NuvioScreenHeader(
                        title = folder?.title ?: uiState.collectionTitle,
                        modifier = Modifier.padding(horizontal = desktopPagePadding),
                        backgroundColor = Color.Transparent,
                        includeStatusBarPadding = false,
                        topPadding = 32.dp,
                        onBack = onBack,
                    )
                }

                when (uiState.viewMode) {
                    FolderViewMode.TABBED_GRID -> TabbedGridContent(
''',
    "folder fused cover hero",
)
folder = replace_once(
    folder,
    '''                        modifier = Modifier.weight(1f),
                        onTabSelected = { FolderDetailRepository.selectTab(it) },
                        onPosterClick = onPosterClick,
                    )
                    FolderViewMode.ROWS -> RowsContent(
''',
    '''                        modifier = Modifier.weight(1f),
                        onTabSelected = { FolderDetailRepository.selectTab(it) },
                        onPosterClick = onPosterClick,
                        onPosterHoverChanged = { item, hovered ->
                            if (hovered) {
                                hoveredHeroItem = item
                            } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                hoveredHeroItem = null
                            }
                        },
                    )
                    FolderViewMode.ROWS -> RowsContent(
''',
    "folder tab hover callback",
)
folder = replace_once(
    folder,
    '''                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                    )
                    FolderViewMode.FOLLOW_LAYOUT -> RowsContent(
''',
    '''                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                        onPosterHoverChanged = { item, hovered ->
                            if (hovered) {
                                hoveredHeroItem = item
                            } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                hoveredHeroItem = null
                            }
                        },
                    )
                    FolderViewMode.FOLLOW_LAYOUT -> RowsContent(
''',
    "folder rows hover callback",
)
folder = replace_once(
    folder,
    '''                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                    )
                }
''',
    '''                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                        onPosterHoverChanged = { item, hovered ->
                            if (hovered) {
                                hoveredHeroItem = item
                            } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                hoveredHeroItem = null
                            }
                        },
                    )
                }
''',
    "folder follow hover callback",
)
folder = replace_once(
    folder,
    '''    onTabSelected: (Int) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
) {
''',
    '''    onTabSelected: (Int) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
''',
    "tabbed signature",
)
folder = replace_once(
    folder,
    '''                                    HomePosterCard(
                                        item = item,
                                        useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                        isWatched = isWatched,
''',
    '''                                    HomePosterCard(
                                        item = item,
                                        useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                        useHoverPreview = onPosterHoverChanged == null,
                                        onHoverChanged = onPosterHoverChanged?.let { callback ->
                                            { hovered -> callback(item, hovered) }
                                        },
                                        isWatched = isWatched,
''',
    "tabbed poster hover",
)
folder = replace_once(
    folder,
    '''    modifier: Modifier = Modifier,
    onCatalogClick: (HomeCatalogSection) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
) {
''',
    '''    modifier: Modifier = Modifier,
    onCatalogClick: (HomeCatalogSection) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
''',
    "rows signature",
)
folder = replace_once(
    folder,
    '''                    watchedKeys = watchedKeys,
                    onPosterClick = { onPosterClick(it) },
                )
''',
    '''                    watchedKeys = watchedKeys,
                    onPosterClick = { onPosterClick(it) },
                    useHoverPreview = onPosterHoverChanged == null,
                    onPosterHoverChanged = onPosterHoverChanged,
                )
''',
    "rows section hover",
)
folder_path.write_text(folder, encoding="utf-8")

print("Applied Nuvio Desktop fused cover hero v3 patch to", root)


# V4 visual refinements: preserve full cover framing, use more horizontal space,
# and keep profile avatar artwork fully visible.
hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    "import androidx.compose.ui.draw.clip\n",
    "import androidx.compose.ui.draw.blur\nimport androidx.compose.ui.draw.clip\n",
    "hero blur import",
)
hero = replace_once(
    hero,
    '''        if (!backdrop.isNullOrBlank()) {
            AsyncImage(
                model = backdrop,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                alignment = Alignment.Center,
            )
        }
''',
    '''        if (!backdrop.isNullOrBlank()) {
            // Cinematic fill layer: intentionally soft and dimmed, only used to avoid empty
            // letterbox areas when the foreground artwork is shown without destructive cropping.
            AsyncImage(
                model = backdrop,
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .blur(26.dp),
                contentScale = ContentScale.Crop,
                alignment = Alignment.Center,
                alpha = 0.42f,
            )

            // Foreground cover layer: keep the whole source artwork visible whenever possible.
            AsyncImage(
                model = backdrop,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
                alignment = Alignment.Center,
            )
        }
''',
    "hero non cropped artwork",
)
hero_path.write_text(hero, encoding="utf-8")

catalog = catalog_path.read_text(encoding="utf-8")
catalog = replace_once(
    catalog,
    '''                        .padding(
                            start = pageHorizontalPadding,
                            end = pageHorizontalPadding,
                            top = 12.dp,
                        )
''',
    '''                        .padding(
                            start = 10.dp,
                            end = 10.dp,
                            top = 10.dp,
                        )
''',
    "catalog hero wider margins",
)
catalog_path.write_text(catalog, encoding="utf-8")

folder = folder_path.read_text(encoding="utf-8")
folder = folder.replace(
    "start = desktopPagePadding,\n                                end = desktopPagePadding,\n                                top = 12.dp,\n                                bottom = 6.dp,",
    "start = 10.dp,\n                                end = 10.dp,\n                                top = 10.dp,\n                                bottom = 6.dp,",
    1,
)
folder_path.write_text(folder, encoding="utf-8")

switcher_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/profiles/ProfileSwitcherTab.kt"
selection_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/profiles/ProfileSelectionScreen.kt"

switcher = switcher_path.read_text(encoding="utf-8")
switcher_count = switcher.count("contentScale = ContentScale.Crop")
if switcher_count != 2:
    raise RuntimeError(f"profile switcher: expected 2 avatar Crop scales, found {switcher_count}")
switcher = switcher.replace("contentScale = ContentScale.Crop", "contentScale = ContentScale.Fit")
switcher_path.write_text(switcher, encoding="utf-8")

selection = selection_path.read_text(encoding="utf-8")
selection_count = selection.count("contentScale = ContentScale.Crop")
if selection_count != 1:
    raise RuntimeError(f"profile selection: expected 1 avatar Crop scale, found {selection_count}")
selection = selection.replace("contentScale = ContentScale.Crop", "contentScale = ContentScale.Fit")
selection_path.write_text(selection, encoding="utf-8")

print("Applied V4 non-cropped cover + wide hero + profile avatar refinements")


# V5: true single-layer COVER hero + resilient profile avatar image resolution.
hero = hero_path.read_text(encoding="utf-8")
hero = hero.replace(
    "import androidx.compose.ui.draw.blur\nimport androidx.compose.ui.draw.clip\n",
    "import androidx.compose.ui.draw.clip\n",
    1,
)
hero = replace_once(
    hero,
    '''        if (!backdrop.isNullOrBlank()) {
            // Cinematic fill layer: intentionally soft and dimmed, only used to avoid empty
            // letterbox areas when the foreground artwork is shown without destructive cropping.
            AsyncImage(
                model = backdrop,
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .blur(26.dp),
                contentScale = ContentScale.Crop,
                alignment = Alignment.Center,
                alpha = 0.42f,
            )

            // Foreground cover layer: keep the whole source artwork visible whenever possible.
            AsyncImage(
                model = backdrop,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
                alignment = Alignment.Center,
            )
        }
''',
    '''        if (!backdrop.isNullOrBlank()) {
            // One coherent backdrop layer only: true COVER behavior.
            // Keep the source centered so the unavoidable crop is distributed evenly.
            AsyncImage(
                model = backdrop,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                alignment = Alignment.Center,
            )
        }
''',
    "v5 true cover hero",
)
hero_path.write_text(hero, encoding="utf-8")

# Restore avatar artwork to fill its circular frame. V5 fixes the URL/catalog resolution
# instead of using Fit as a visual workaround.
switcher = switcher_path.read_text(encoding="utf-8")
switcher = switcher.replace(
    "contentScale = ContentScale.Fit",
    "contentScale = ContentScale.Crop",
)
switcher_path.write_text(switcher, encoding="utf-8")

selection = selection_path.read_text(encoding="utf-8")
selection = selection.replace(
    "contentScale = ContentScale.Fit",
    "contentScale = ContentScale.Crop",
)
selection_path.write_text(selection, encoding="utf-8")

profile_models_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/profiles/ProfileModels.kt"
profile_models = profile_models_path.read_text(encoding="utf-8")

bundled_catalog = r'''
private const val OfficialAvatarPublicBaseUrl =
    "https://api.nuvio.tv/storage/v1/object/public/avatars"

private val BundledStandardAvatarCatalog = listOf(
    AvatarCatalogItem("avatar_aang", "Aang", "$OfficialAvatarPublicBaseUrl/avatar_aang_1772809370453.png", "animation", 1, bgColor = "#0060F8"),
    AvatarCatalogItem("avatar_katara", "Katara", "$OfficialAvatarPublicBaseUrl/avatar_katara_1772809386366.png", "animation", 18, bgColor = "#00A0A8"),
    AvatarCatalogItem("avatar_ash", "Ash", "$OfficialAvatarPublicBaseUrl/avatar_ash_1772809405294.png", "anime", 3, bgColor = "#E00808"),
    AvatarCatalogItem("avatar_chihiro", "Chihiro", "$OfficialAvatarPublicBaseUrl/avatar_chihiro_1772809422792.png", "anime", 4, bgColor = "#88E070"),
    AvatarCatalogItem("avatar_eren", "Eren", "$OfficialAvatarPublicBaseUrl/avatar_eren_1772808836514.png", "anime", 8, bgColor = "#900018"),
    AvatarCatalogItem("avatar_gojo", "Gojo", "$OfficialAvatarPublicBaseUrl/avatar_gojo_1772826847969.png", "anime", 11, bgColor = "#00F8F8"),
    AvatarCatalogItem("avatar_goku", "Goku", "$OfficialAvatarPublicBaseUrl/avatar_goku_1772786622108.png", "anime", 12, bgColor = "#F84000"),
    AvatarCatalogItem("avatar_jinwoo", "Jinwoo", "$OfficialAvatarPublicBaseUrl/avatar_jinwoo_1772808878532.png", "anime", 15, bgColor = "#0058F8"),
    AvatarCatalogItem("avatar_killua", "Killua", "$OfficialAvatarPublicBaseUrl/avatar_killua_1772826924033.png", "anime", 19, bgColor = "#0030F8"),
    AvatarCatalogItem("avatar_levi", "Levi", "$OfficialAvatarPublicBaseUrl/avatar_levi_1772826833149.png", "anime", 23, bgColor = "#484848"),
    AvatarCatalogItem("avatar_mikasa", "Mikasa", "$OfficialAvatarPublicBaseUrl/avatar_mikasa_1772808997012.png", "anime", 24, bgColor = "#007870"),
    AvatarCatalogItem("avatar_naruto", "Naruto", "$OfficialAvatarPublicBaseUrl/avatar_naruto_1772786640402.png", "anime", 25, bgColor = "#D8F800"),
    AvatarCatalogItem("avatar_saitama", "Saitama", "$OfficialAvatarPublicBaseUrl/avatar_saitama_1772826938248.png", "anime", 29, bgColor = "#F8D000"),
    AvatarCatalogItem("avatar_arthur_morgan", "Arthur Morgan", "$OfficialAvatarPublicBaseUrl/avatar_arthur_morgan_1772786328141.png", "gaming", 2, bgColor = "#B01028"),
    AvatarCatalogItem("avatar_geralt", "Geralt", "$OfficialAvatarPublicBaseUrl/avatar_geralt_1772826884310.png", "gaming", 10, bgColor = "#380070"),
    AvatarCatalogItem("avatar_kratos", "Kratos", "$OfficialAvatarPublicBaseUrl/avatar_kratos_1772826869090.png", "gaming", 20, bgColor = "#880000"),
    AvatarCatalogItem("avatar_lara", "Lara", "$OfficialAvatarPublicBaseUrl/avatar_lara_1772826963671.png", "gaming", 22, bgColor = "#008878"),
    AvatarCatalogItem("avatar_v", "V", "$OfficialAvatarPublicBaseUrl/avatar_v_1772827227584.png", "gaming", 32, bgColor = "#000830"),
    AvatarCatalogItem("avatar_linear_woman_teal", "Lin", "$OfficialAvatarPublicBaseUrl/avatar_linear_teal_v3.png", "linear", 35, bgColor = "#008080"),
    AvatarCatalogItem("avatar_linear_man_purple", "Max", "$OfficialAvatarPublicBaseUrl/avatar_linear_purple_v3.png", "linear", 36, bgColor = "#6B21A8"),
    AvatarCatalogItem("avatar_linear_woman_red", "Ava", "$OfficialAvatarPublicBaseUrl/avatar_linear_red_v3.png", "linear", 37, bgColor = "#E11D48"),
    AvatarCatalogItem("avatar_linear_man_navy", "Theo", "$OfficialAvatarPublicBaseUrl/avatar_linear_navy_v3.png", "linear", 38, bgColor = "#1E3A5F"),
    AvatarCatalogItem("avatar_linear_woman_yellow", "Zara", "$OfficialAvatarPublicBaseUrl/avatar_linear_yellow_v3.png", "linear", 39, bgColor = "#D97706"),
    AvatarCatalogItem("avatar_linear_man_green", "Kai", "$OfficialAvatarPublicBaseUrl/avatar_linear_green_v3.png", "linear", 40, bgColor = "#065F46"),
    AvatarCatalogItem("avatar_linear_woman_pink", "Nova", "$OfficialAvatarPublicBaseUrl/avatar_linear_pink_v3.png", "linear", 41, bgColor = "#BE185D"),
    AvatarCatalogItem("avatar_furiosa", "Furiosa", "$OfficialAvatarPublicBaseUrl/avatar_furiosa_1772827439561.png", "movie", 9, bgColor = "#D08848"),
    AvatarCatalogItem("avatar_harry_potter", "Harry Potter", "$OfficialAvatarPublicBaseUrl/avatar_harry_potter_1772786358133.png", "movie", 13, bgColor = "#F8B000"),
    AvatarCatalogItem("avatar_jack_sparrow", "Jack Sparrow", "$OfficialAvatarPublicBaseUrl/avatar_jack_sparrow_1772786396797.png", "movie", 14, bgColor = "#F8F8F8"),
    AvatarCatalogItem("avatar_neo", "Neo", "$OfficialAvatarPublicBaseUrl/avatar_neo_1772786377143.png", "movie", 27, bgColor = "#88F800"),
    AvatarCatalogItem("avatar_daenerys", "Daenerys", "$OfficialAvatarPublicBaseUrl/avatar_daenerys_1772786201651.png", "tv", 5, bgColor = "#00B8D8"),
    AvatarCatalogItem("avatar_dexter", "Dexter", "$OfficialAvatarPublicBaseUrl/avatar_dexter_1772808898372.png", "tv", 6, bgColor = "#A80808"),
    AvatarCatalogItem("avatar_eleven", "Eleven", "$OfficialAvatarPublicBaseUrl/avatar_eleven_1772785893766.png", "tv", 7, bgColor = "#8800F8"),
    AvatarCatalogItem("avatar_joel", "Joel", "$OfficialAvatarPublicBaseUrl/avatar_joel_1772827212455.png", "tv", 16, bgColor = "#102010"),
    AvatarCatalogItem("avatar_jon_snow", "Jon Snow", "$OfficialAvatarPublicBaseUrl/avatar_jon_snow_1772786050374.png", "tv", 17, bgColor = "#004090"),
    AvatarCatalogItem("avatar_lalo", "Lalo", "$OfficialAvatarPublicBaseUrl/avatar_lalo_1772808914536.png", "tv", 21, bgColor = "#E09018"),
    AvatarCatalogItem("avatar_negan", "Negan", "$OfficialAvatarPublicBaseUrl/avatar_negan_1772808934794.png", "tv", 26, bgColor = "#780078"),
    AvatarCatalogItem("avatar_rick_grimes", "Rick Grimes", "$OfficialAvatarPublicBaseUrl/avatar_rick_grimes_1772786275264.png", "tv", 28, bgColor = "#C85018"),
    AvatarCatalogItem("avatar_saul_goodman", "Saul Goodman", "$OfficialAvatarPublicBaseUrl/avatar_saul_goodman_1772786019049.png", "tv", 30, bgColor = "#F84000"),
    AvatarCatalogItem("avatar_tommy_shelby", "Tommy Shelby", "$OfficialAvatarPublicBaseUrl/avatar_tommy_shelby_1772786000275.png", "tv", 31, bgColor = "#F83040"),
    AvatarCatalogItem("avatar_walter_white", "Walter White", "$OfficialAvatarPublicBaseUrl/avatar_walter_white_1772785927308.png", "tv", 33, bgColor = "#F8C000"),
    AvatarCatalogItem("avatar_wednesday", "Wednesday", "$OfficialAvatarPublicBaseUrl/avatar_wednesday_1772786225606.png", "tv", 34, bgColor = "#500840"),
)

internal fun bundledStandardAvatarCatalog(): List<AvatarCatalogItem> = BundledStandardAvatarCatalog

private fun bundledStandardAvatarById(id: String?): AvatarCatalogItem? =
    id?.let { target -> BundledStandardAvatarCatalog.firstOrNull { it.id == target } }
'''

profile_models = replace_once(
    profile_models,
    '''fun avatarStorageUrl(storagePath: String): String =
''',
    bundled_catalog + '''
fun avatarStorageUrl(storagePath: String): String =
''',
    "v5 bundled avatar catalog",
)

profile_models = replace_once(
    profile_models,
    '''fun profileAvatarImageUrl(profile: NuvioProfile, avatar: AvatarCatalogItem?): String? =
    normalizedAvatarUrl(profile.avatarUrl)
        ?: avatar?.let(::avatarImageUrl)
''',
    '''fun profileAvatarImageUrl(profile: NuvioProfile, avatar: AvatarCatalogItem?): String? =
    normalizedAvatarUrl(profile.avatarUrl)
        ?: avatar?.let(::avatarImageUrl)
        ?: bundledStandardAvatarById(profile.avatarId)?.let(::avatarImageUrl)
''',
    "v5 profile avatar direct fallback",
)
profile_models_path.write_text(profile_models, encoding="utf-8")

avatar_repository_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/profiles/AvatarRepository.kt"
avatar_repository = avatar_repository_path.read_text(encoding="utf-8")

avatar_repository = replace_once(
    avatar_repository,
    '''    suspend fun fetchAvatars() {
        hydrateFromCacheIfNeeded()
        ensureMemberAccessObserver()
''',
    '''    suspend fun fetchAvatars() {
        hydrateFromCacheIfNeeded()
        ensureBundledStandardFallback()
        ensureMemberAccessObserver()
''',
    "v5 avatar fetch fallback",
)

avatar_repository = replace_once(
    avatar_repository,
    '''    suspend fun refreshAvatars(force: Boolean = false) {
        hydrateFromCacheIfNeeded()
        ensureMemberAccessObserver()
''',
    '''    suspend fun refreshAvatars(force: Boolean = false) {
        hydrateFromCacheIfNeeded()
        ensureBundledStandardFallback()
        ensureMemberAccessObserver()
''',
    "v5 avatar refresh fallback",
)

avatar_repository = replace_once(
    avatar_repository,
    '''    private fun isRefreshDue(lastRefresh: TimeMark?): Boolean =
        lastRefresh == null || lastRefresh.elapsedNow() >= AvatarCatalogRefreshInterval

    private fun hydrateFromCacheIfNeeded() {
''',
    '''    private fun isRefreshDue(lastRefresh: TimeMark?): Boolean =
        lastRefresh == null || lastRefresh.elapsedNow() >= AvatarCatalogRefreshInterval

    private fun ensureBundledStandardFallback() {
        if (standardCatalog.isNotEmpty()) return
        standardCatalog = bundledStandardAvatarCatalog()
            .filter { it.isActive }
            .sortedWith(compareBy({ it.category }, { it.sortOrder }))
        publishCatalog()
    }

    private fun hydrateFromCacheIfNeeded() {
''',
    "v5 avatar fallback helper",
)
avatar_repository_path.write_text(avatar_repository, encoding="utf-8")

print("Applied V5: single cover hero + bundled/resilient profile avatars")


# V6: desktop keyboard directional navigation for poster cards.
shelf_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/ShelfComponents.kt"
shelf = shelf_path.read_text(encoding="utf-8")

shelf = replace_once(
    shelf,
    "import androidx.compose.foundation.interaction.collectIsHoveredAsState\n",
    "import androidx.compose.foundation.interaction.collectIsFocusedAsState\nimport androidx.compose.foundation.interaction.collectIsHoveredAsState\n",
    "v6 focused interaction import",
)
shelf = replace_once(
    shelf,
    "import androidx.compose.ui.geometry.Rect\n",
    "import androidx.compose.ui.focus.FocusDirection\nimport androidx.compose.ui.focus.onFocusChanged\nimport androidx.compose.ui.geometry.Rect\n",
    "v6 focus imports",
)
shelf = replace_once(
    shelf,
    "import androidx.compose.ui.input.pointer.PointerEventPass\n",
    "import androidx.compose.ui.input.key.Key\nimport androidx.compose.ui.input.key.KeyEventType\nimport androidx.compose.ui.input.key.key\nimport androidx.compose.ui.input.key.onPreviewKeyEvent\nimport androidx.compose.ui.input.key.type\nimport androidx.compose.ui.input.pointer.PointerEventPass\n",
    "v6 key imports",
)
shelf = replace_once(
    shelf,
    "import androidx.compose.ui.platform.LocalDensity\n" if "import androidx.compose.ui.platform.LocalDensity\n" in shelf else "import androidx.compose.ui.layout.positionInRoot\n",
    ("import androidx.compose.ui.platform.LocalDensity\nimport androidx.compose.ui.platform.LocalFocusManager\n" if "import androidx.compose.ui.platform.LocalDensity\n" in shelf else "import androidx.compose.ui.layout.positionInRoot\nimport androidx.compose.ui.platform.LocalFocusManager\n"),
    "v6 local focus manager import",
)

shelf = replace_once(
    shelf,
    '''    isWatched: Boolean = false,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
''',
    '''    isWatched: Boolean = false,
    onFocusChanged: ((Boolean) -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
''',
    "v6 poster card focus callback signature",
)
shelf = replace_once(
    shelf,
    '''                    zoomImageUrl = imageUrl,
                    zoomCornerRadius = posterCardStyle.cornerRadiusDp.dp,
                    hoverScaleEnabled = false,
                ),
''',
    '''                    zoomImageUrl = imageUrl,
                    zoomCornerRadius = posterCardStyle.cornerRadiusDp.dp,
                    hoverScaleEnabled = false,
                    onFocusChanged = onFocusChanged,
                ),
''',
    "v6 poster card focus callback forwarding",
)

shelf = replace_once(
    shelf,
    '''    val hovered by interactionSource.collectIsHoveredAsState()
    val scale by animateFloatAsState(
        targetValue = if (hovered) DesktopPosterHoverScale else 1f,
''',
    '''    val hovered by interactionSource.collectIsHoveredAsState()
    val focused by interactionSource.collectIsFocusedAsState()
    val scale by animateFloatAsState(
        targetValue = if (hovered || focused) DesktopPosterHoverScale else 1f,
''',
    "v6 keyboard focus scale",
)
shelf = replace_once(
    shelf,
    '''    val isScaling = hovered || scale != 1f
''',
    '''    val isScaling = hovered || focused || scale != 1f
''',
    "v6 focused z index",
)

shelf = replace_once(
    shelf,
    '''    zoomImageUrl: String? = null,
    zoomCornerRadius: Dp = NuvioTokens.Radius.poster,
    hoverScaleEnabled: Boolean = true,
): Modifier {
''',
    '''    zoomImageUrl: String? = null,
    zoomCornerRadius: Dp = NuvioTokens.Radius.poster,
    hoverScaleEnabled: Boolean = true,
    onFocusChanged: ((Boolean) -> Unit)? = null,
): Modifier {
''',
    "v6 clickable focus callback signature",
)
shelf = replace_once(
    shelf,
    '''    val bounds = remember { mutableStateOf<Rect?>(null) }
    val interactionSource = remember { MutableInteractionSource() }
''',
    '''    val bounds = remember { mutableStateOf<Rect?>(null) }
    val interactionSource = remember { MutableInteractionSource() }
    val focusManager = LocalFocusManager.current
''',
    "v6 local focus manager",
)
shelf = replace_once(
    shelf,
    '''        .desktopPosterHoverScale(
            enabled = hoverScaleEnabled,
            interactionSource = interactionSource,
        )
        .combinedClickable(
''',
    '''        .desktopPosterHoverScale(
            enabled = hoverScaleEnabled,
            interactionSource = interactionSource,
        )
        .onFocusChanged { state -> onFocusChanged?.invoke(state.isFocused) }
        .onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            when (event.key) {
                Key.DirectionLeft -> focusManager.moveFocus(FocusDirection.Left)
                Key.DirectionRight -> focusManager.moveFocus(FocusDirection.Right)
                Key.DirectionUp -> focusManager.moveFocus(FocusDirection.Up)
                Key.DirectionDown -> focusManager.moveFocus(FocusDirection.Down)
                else -> false
            }
        }
        .combinedClickable(
''',
    "v6 directional key navigation",
)
shelf_path.write_text(shelf, encoding="utf-8")

poster = poster_path.read_text(encoding="utf-8")
poster = replace_once(
    poster,
    '''import androidx.compose.runtime.Composable
''',
    '''import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
''',
    "v6 poster state imports",
)
poster = replace_once(
    poster,
    '''    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
            .onPointerEvent(PointerEventType.Enter) { onHoverChanged(true) }
            .onPointerEvent(PointerEventType.Exit) { onHoverChanged(false) }
    } else {
        modifier
    }
''',
    '''    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    var pointerHovered by remember(item.type, item.id) { mutableStateOf(false) }
    var keyboardFocused by remember(item.type, item.id) { mutableStateOf(false) }

    fun notifyHeroInteraction() {
        onHoverChanged?.invoke(pointerHovered || keyboardFocused)
    }

    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
            .onPointerEvent(PointerEventType.Enter) {
                pointerHovered = true
                notifyHeroInteraction()
            }
            .onPointerEvent(PointerEventType.Exit) {
                pointerHovered = false
                notifyHeroInteraction()
            }
    } else {
        modifier
    }
''',
    "v6 combined mouse keyboard hero state",
)
poster = replace_once(
    poster,
    '''            bottomLeftText = if (isLandscapeMode && item.logo.isNullOrBlank() && !posterCardStyle.hideLabelsEnabled) item.name else null,
            isWatched = isWatched,
            onClick = onClick,
''',
    '''            bottomLeftText = if (isLandscapeMode && item.logo.isNullOrBlank() && !posterCardStyle.hideLabelsEnabled) item.name else null,
            isWatched = isWatched,
            onFocusChanged = if (onHoverChanged != null) {
                { focused ->
                    keyboardFocused = focused
                    notifyHeroInteraction()
                }
            } else {
                null
            },
            onClick = onClick,
''',
    "v6 focus updates hero",
)
poster_path.write_text(poster, encoding="utf-8")

print("Applied V6 keyboard arrow navigation for Desktop poster cards")
