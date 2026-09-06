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

if "import androidx.compose.foundation.border\n" not in shelf:
    shelf = shelf.replace(
        "import androidx.compose.foundation.background\n",
        "import androidx.compose.foundation.background\nimport androidx.compose.foundation.border\n",
        1,
    )

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


# V7: deterministic keyboard navigation + guaranteed profile artwork + IMDb badge.
nav_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/PosterKeyboardNavigation.kt"
nav_test_path = root / "composeApp/src/commonTest/kotlin/com/nuvio/app/core/ui/PosterKeyboardNavigationTest.kt"
avatar_test_path = root / "composeApp/src/commonTest/kotlin/com/nuvio/app/features/profiles/ProfileAvatarResolutionTest.kt"

nav_path.parent.mkdir(parents=True, exist_ok=True)
nav_test_path.parent.mkdir(parents=True, exist_ok=True)
avatar_test_path.parent.mkdir(parents=True, exist_ok=True)

nav_path.write_text(r'''package com.nuvio.app.core.ui

internal enum class PosterNavigationDirection {
    Left,
    Right,
    Up,
    Down,
}

internal data class PosterRowPosition(
    val row: Int,
    val column: Int,
)

internal fun nextPosterIndex(
    currentIndex: Int,
    itemCount: Int,
    columnCount: Int,
    direction: PosterNavigationDirection,
): Int {
    if (itemCount <= 0) return -1
    val columns = columnCount.coerceAtLeast(1)
    val current = currentIndex.coerceIn(0, itemCount - 1)
    val column = current % columns
    return when (direction) {
        PosterNavigationDirection.Left ->
            if (column > 0) current - 1 else current
        PosterNavigationDirection.Right ->
            if (column < columns - 1 && current + 1 < itemCount) current + 1 else current
        PosterNavigationDirection.Up ->
            (current - columns).takeIf { it >= 0 } ?: current
        PosterNavigationDirection.Down -> {
            val target = current + columns
            when {
                target < itemCount -> target
                current / columns < (itemCount - 1) / columns -> itemCount - 1
                else -> current
            }
        }
    }
}

internal fun normalizePosterRowPosition(
    position: PosterRowPosition,
    rowSizes: List<Int>,
): PosterRowPosition? {
    if (rowSizes.none { it > 0 }) return null
    val requestedRow = position.row.coerceIn(0, rowSizes.lastIndex)
    val row = if (rowSizes[requestedRow] > 0) {
        requestedRow
    } else {
        rowSizes.indices.minByOrNull { index ->
            if (rowSizes[index] > 0) kotlin.math.abs(index - requestedRow) else Int.MAX_VALUE
        } ?: return null
    }
    val column = position.column.coerceIn(0, rowSizes[row] - 1)
    return PosterRowPosition(row, column)
}

internal fun nextPosterRowPosition(
    current: PosterRowPosition,
    rowSizes: List<Int>,
    direction: PosterNavigationDirection,
): PosterRowPosition? {
    val normalized = normalizePosterRowPosition(current, rowSizes) ?: return null
    val row = normalized.row
    val column = normalized.column
    return when (direction) {
        PosterNavigationDirection.Left ->
            PosterRowPosition(row, (column - 1).coerceAtLeast(0))
        PosterNavigationDirection.Right ->
            PosterRowPosition(row, (column + 1).coerceAtMost(rowSizes[row] - 1))
        PosterNavigationDirection.Up -> {
            val targetRow = (row - 1 downTo 0).firstOrNull { rowSizes[it] > 0 } ?: row
            PosterRowPosition(targetRow, column.coerceAtMost(rowSizes[targetRow] - 1))
        }
        PosterNavigationDirection.Down -> {
            val targetRow = (row + 1..rowSizes.lastIndex).firstOrNull { rowSizes[it] > 0 } ?: row
            PosterRowPosition(targetRow, column.coerceAtMost(rowSizes[targetRow] - 1))
        }
    }
}
''', encoding="utf-8")

nav_test_path.write_text(r'''package com.nuvio.app.core.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PosterKeyboardNavigationTest {
    @Test
    fun gridNavigationRespectsRowsColumnsAndEdges() {
        assertEquals(1, nextPosterIndex(0, 10, 4, PosterNavigationDirection.Right))
        assertEquals(0, nextPosterIndex(0, 10, 4, PosterNavigationDirection.Left))
        assertEquals(4, nextPosterIndex(0, 10, 4, PosterNavigationDirection.Down))
        assertEquals(0, nextPosterIndex(0, 10, 4, PosterNavigationDirection.Up))
        assertEquals(7, nextPosterIndex(3, 10, 4, PosterNavigationDirection.Down))
        assertEquals(9, nextPosterIndex(7, 10, 4, PosterNavigationDirection.Down))
        assertEquals(9, nextPosterIndex(9, 10, 4, PosterNavigationDirection.Right))
    }

    @Test
    fun rowNavigationSkipsEmptyRowsAndClampsColumns() {
        val sizes = listOf(4, 0, 2, 5)
        assertEquals(
            PosterRowPosition(2, 1),
            nextPosterRowPosition(PosterRowPosition(0, 3), sizes, PosterNavigationDirection.Down),
        )
        assertEquals(
            PosterRowPosition(3, 1),
            nextPosterRowPosition(PosterRowPosition(2, 1), sizes, PosterNavigationDirection.Down),
        )
        assertEquals(
            PosterRowPosition(0, 1),
            nextPosterRowPosition(PosterRowPosition(2, 1), sizes, PosterNavigationDirection.Up),
        )
        assertNull(normalizePosterRowPosition(PosterRowPosition(0, 0), emptyList()))
    }
}
''', encoding="utf-8")

profile_models_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/profiles/ProfileModels.kt"
profile_models = profile_models_path.read_text(encoding="utf-8")
profile_models = replace_once(
    profile_models,
    '''private fun bundledStandardAvatarById(id: String?): AvatarCatalogItem? =
    id?.let { target -> BundledStandardAvatarCatalog.firstOrNull { it.id == target } }

fun avatarStorageUrl(storagePath: String): String =
''',
    '''private fun bundledStandardAvatarById(id: String?): AvatarCatalogItem? =
    id?.let { target -> BundledStandardAvatarCatalog.firstOrNull { it.id == target } }

private fun legacyDefaultAvatarForProfileIndex(profileIndex: Int): AvatarCatalogItem? {
    val fallbackIds = listOf(
        "avatar_linear_woman_teal",
        "avatar_linear_man_purple",
        "avatar_linear_woman_red",
        "avatar_linear_man_navy",
        "avatar_linear_woman_yellow",
        "avatar_linear_man_green",
    )
    val id = fallbackIds.getOrNull((profileIndex - 1).coerceAtLeast(0)) ?: return null
    return bundledStandardAvatarById(id)
}

fun avatarStorageUrl(storagePath: String): String =
''',
    "v7 legacy profile avatar helper",
)
profile_models = replace_once(
    profile_models,
    '''fun profileAvatarImageUrl(profile: NuvioProfile, avatar: AvatarCatalogItem?): String? =
    normalizedAvatarUrl(profile.avatarUrl)
        ?: avatar?.let(::avatarImageUrl)
        ?: bundledStandardAvatarById(profile.avatarId)?.let(::avatarImageUrl)
''',
    '''fun profileAvatarImageUrl(profile: NuvioProfile, avatar: AvatarCatalogItem?): String? =
    normalizedAvatarUrl(profile.avatarUrl)
        ?: avatar?.let(::avatarImageUrl)
        ?: bundledStandardAvatarById(profile.avatarId)?.let(::avatarImageUrl)
        ?: legacyDefaultAvatarForProfileIndex(profile.profileIndex)?.let(::avatarImageUrl)
''',
    "v7 legacy profile avatar fallback",
)
profile_models_path.write_text(profile_models, encoding="utf-8")

avatar_test_path.write_text(r'''package com.nuvio.app.features.profiles

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ProfileAvatarResolutionTest {
    @Test
    fun customAvatarUrlHasHighestPriority() {
        val profile = NuvioProfile(
            profileIndex = 1,
            avatarId = "avatar_goku",
            avatarUrl = "https://example.com/custom.png",
        )
        assertEquals("https://example.com/custom.png", profileAvatarImageUrl(profile, null))
    }

    @Test
    fun bundledAvatarIdResolvesWithoutBackendCatalog() {
        val profile = NuvioProfile(profileIndex = 1, avatarId = "avatar_goku")
        val resolved = assertNotNull(profileAvatarImageUrl(profile, null))
        assertTrue(resolved.contains("/storage/v1/object/public/avatars/avatar_goku_"))
    }

    @Test
    fun legacyProfileWithoutAvatarMetadataStillGetsArtwork() {
        val resolved = assertNotNull(profileAvatarImageUrl(NuvioProfile(profileIndex = 2), null))
        assertTrue(resolved.contains("avatar_linear_purple_v3.png"))
    }
}
''', encoding="utf-8")

poster = poster_path.read_text(encoding="utf-8")
poster = poster.replace("import androidx.compose.runtime.Composable\n", "import androidx.compose.foundation.border\nimport androidx.compose.runtime.Composable\n", 1)
poster = poster.replace("import androidx.compose.ui.Modifier\n", "import androidx.compose.ui.Modifier\nimport androidx.compose.ui.graphics.graphicsLayer\nimport androidx.compose.ui.zIndex\n", 1)
poster = poster.replace("import com.nuvio.app.core.format.formatReleaseDateForDisplay\n", "import androidx.compose.foundation.shape.RoundedCornerShape\nimport androidx.compose.material3.MaterialTheme\nimport androidx.compose.ui.unit.dp\nimport com.nuvio.app.core.format.formatReleaseDateForDisplay\n", 1)
poster = replace_once(
    poster,
    '''    useHoverPreview: Boolean = true,
    onHoverChanged: ((Boolean) -> Unit)? = null,
    isWatched: Boolean = false,
''',
    '''    useHoverPreview: Boolean = true,
    onHoverChanged: ((Boolean) -> Unit)? = null,
    isKeyboardSelected: Boolean = false,
    isWatched: Boolean = false,
''',
    "v7 poster selection signature",
)
poster = replace_once(
    poster,
    '''    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    var pointerHovered by remember(item.type, item.id) { mutableStateOf(false) }
''',
    '''    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    val keyboardSelectionModifier = if (isKeyboardSelected) {
        Modifier
            .border(
                width = 2.dp,
                color = MaterialTheme.colorScheme.primary,
                shape = RoundedCornerShape(posterCardStyle.cornerRadiusDp.dp),
            )
            .graphicsLayer {
                scaleX = 1.035f
                scaleY = 1.035f
            }
            .zIndex(2f)
    } else {
        Modifier
    }
    var pointerHovered by remember(item.type, item.id) { mutableStateOf(false) }
''',
    "v7 keyboard selection visual",
)
poster = replace_once(
    poster,
    '''    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
''',
    '''    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
            .then(keyboardSelectionModifier)
''',
    "v7 selected modifier hover branch",
)
poster = replace_once(
    poster,
    '''    } else {
        modifier
    }
''',
    '''    } else {
        modifier.then(keyboardSelectionModifier)
    }
''',
    "v7 selected modifier no hover branch",
)
poster_path.write_text(poster, encoding="utf-8")

section = section_path.read_text(encoding="utf-8")
section = section.replace("import androidx.compose.foundation.layout.fillMaxWidth\n", "import androidx.compose.foundation.layout.fillMaxWidth\nimport androidx.compose.foundation.lazy.LazyListState\nimport androidx.compose.foundation.lazy.rememberLazyListState\n", 1)
section = replace_once(
    section,
    '''    useHoverPreview: Boolean = true,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
''',
    '''    useHoverPreview: Boolean = true,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
    state: LazyListState = rememberLazyListState(),
    keyboardSelectedItemKey: String? = null,
) {
''',
    "v7 section public params",
)
section = section.replace(
    '''            onPosterHoverChanged = onPosterHoverChanged,
        )
''',
    '''            onPosterHoverChanged = onPosterHoverChanged,
            state = state,
            keyboardSelectedItemKey = keyboardSelectedItemKey,
        )
''',
    1,
)
section = section.replace(
    '''                onPosterHoverChanged = onPosterHoverChanged,
            )
''',
    '''                onPosterHoverChanged = onPosterHoverChanged,
                state = state,
                keyboardSelectedItemKey = keyboardSelectedItemKey,
            )
''',
    1,
)
section = replace_once(
    section,
    '''    useHoverPreview: Boolean,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)?,
) {
''',
    '''    useHoverPreview: Boolean,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)?,
    state: LazyListState,
    keyboardSelectedItemKey: String?,
) {
''',
    "v7 section content params",
)
section = replace_once(
    section,
    '''        viewAllPillSize = NuvioViewAllPillSize.Compact,
        key = { item -> item.stableKey() },
''',
    '''        viewAllPillSize = NuvioViewAllPillSize.Compact,
        key = { item -> item.stableKey() },
        state = state,
''',
    "v7 section row state",
)
section = replace_once(
    section,
    '''            onHoverChanged = onPosterHoverChanged?.let { callback ->
                { hovered -> callback(item, hovered) }
            },
            isWatched = WatchingState.isPosterWatched(
''',
    '''            onHoverChanged = onPosterHoverChanged?.let { callback ->
                { hovered -> callback(item, hovered) }
            },
            isKeyboardSelected = keyboardSelectedItemKey == item.stableKey(),
            isWatched = WatchingState.isPosterWatched(
''',
    "v7 section selected item",
)
section_path.write_text(section, encoding="utf-8")

catalog = catalog_path.read_text(encoding="utf-8")
catalog = catalog.replace("import androidx.compose.foundation.background\n", "import androidx.compose.foundation.background\nimport androidx.compose.foundation.focusable\n", 1)
catalog = catalog.replace("import androidx.compose.runtime.remember\n", "import androidx.compose.runtime.remember\nimport androidx.compose.runtime.rememberCoroutineScope\n", 1)
catalog = catalog.replace("import androidx.compose.ui.draw.clip\n", "import androidx.compose.ui.draw.clip\nimport androidx.compose.ui.focus.FocusRequester\nimport androidx.compose.ui.focus.focusRequester\nimport androidx.compose.ui.input.key.Key\nimport androidx.compose.ui.input.key.KeyEventType\nimport androidx.compose.ui.input.key.key\nimport androidx.compose.ui.input.key.onPreviewKeyEvent\nimport androidx.compose.ui.input.key.type\n", 1)
catalog = catalog.replace("import com.nuvio.app.core.ui.PosterLandscapeAspectRatio\n", "import com.nuvio.app.core.ui.PosterLandscapeAspectRatio\nimport com.nuvio.app.core.ui.PosterNavigationDirection\nimport com.nuvio.app.core.ui.nextPosterIndex\n", 1)
catalog = catalog.replace("import kotlinx.coroutines.flow.distinctUntilChanged\n", "import kotlinx.coroutines.flow.distinctUntilChanged\nimport kotlinx.coroutines.launch\n", 1)
catalog = replace_once(
    catalog,
    '''    var hoveredHeroItem by remember(target) { mutableStateOf<MetaPreview?>(null) }
''',
    '''    var hoveredHeroItem by remember(target) { mutableStateOf<MetaPreview?>(null) }
    var keyboardSelectedIndex by remember(target) { mutableIntStateOf(0) }
    var keyboardNavigationActive by remember(target) { mutableStateOf(false) }
    val keyboardFocusRequester = remember(target) { FocusRequester() }
    val keyboardScope = rememberCoroutineScope()
''',
    "v7 catalog keyboard state",
)
catalog = replace_once(
    catalog,
    '''        val gridCells = if (isDesktop) {
            GridCells.FixedSize(
                if (posterCardStyle.catalogLandscapeModeEnabled) {
                    landscapePosterWidth(basePosterWidthDp)
                } else {
                    basePosterWidthDp.dp
                },
            )
        } else {
            GridCells.Fixed(columns)
        }

        Box(modifier = Modifier.fillMaxSize()) {
''',
    '''        val gridCells = if (isDesktop) {
            GridCells.FixedSize(
                if (posterCardStyle.catalogLandscapeModeEnabled) {
                    landscapePosterWidth(basePosterWidthDp)
                } else {
                    basePosterWidthDp.dp
                },
            )
        } else {
            GridCells.Fixed(columns)
        }
        val keyboardSelectedItem = if (keyboardNavigationActive) {
            uiState.items.getOrNull(keyboardSelectedIndex)
        } else {
            null
        }

        LaunchedEffect(target, uiState.items.size, columns, isDesktop) {
            if (!isDesktop || uiState.items.isEmpty()) return@LaunchedEffect
            keyboardSelectedIndex = keyboardSelectedIndex.coerceIn(0, uiState.items.lastIndex)
            keyboardFocusRequester.requestFocus()
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .then(
                    if (isDesktop) {
                        Modifier
                            .focusRequester(keyboardFocusRequester)
                            .focusable()
                            .onPreviewKeyEvent { event ->
                                if (event.type != KeyEventType.KeyDown || uiState.items.isEmpty()) {
                                    return@onPreviewKeyEvent false
                                }
                                val direction = when (event.key) {
                                    Key.DirectionLeft -> PosterNavigationDirection.Left
                                    Key.DirectionRight -> PosterNavigationDirection.Right
                                    Key.DirectionUp -> PosterNavigationDirection.Up
                                    Key.DirectionDown -> PosterNavigationDirection.Down
                                    else -> null
                                }
                                if (direction != null) {
                                    val next = nextPosterIndex(
                                        currentIndex = keyboardSelectedIndex,
                                        itemCount = uiState.items.size,
                                        columnCount = columns,
                                        direction = direction,
                                    )
                                    if (next >= 0) {
                                        keyboardNavigationActive = true
                                        keyboardSelectedIndex = next
                                        keyboardScope.launch { gridState.animateScrollToItem(next) }
                                    }
                                    true
                                } else if (event.key == Key.Enter) {
                                    val selected = uiState.items.getOrNull(keyboardSelectedIndex)
                                    if (selected != null) {
                                        keyboardNavigationActive = true
                                        onPosterClick?.invoke(selected)
                                        true
                                    } else {
                                        false
                                    }
                                } else {
                                    false
                                }
                            }
                    } else {
                        Modifier
                    },
                ),
        ) {
''',
    "v7 catalog keyboard container",
)
catalog = replace_once(
    catalog,
    '''                                onHoverChanged = { hovered ->
                                    if (hovered) {
                                        hoveredHeroItem = item
                                    } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                        hoveredHeroItem = null
                                    }
                                },
                                isWatched = isWatched,
''',
    '''                                onHoverChanged = { hovered ->
                                    if (hovered) {
                                        hoveredHeroItem = item
                                    } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                        hoveredHeroItem = null
                                    }
                                },
                                isKeyboardSelected =
                                    keyboardNavigationActive &&
                                        keyboardSelectedItem?.stableKey() == item.stableKey(),
                                isWatched = isWatched,
''',
    "v7 catalog selected poster",
)
catalog = replace_once(
    catalog,
    '''                    selectedItem = hoveredHeroItem ?: uiState.items.first(),
                    isHoverActive = hoveredHeroItem != null,
''',
    '''                    selectedItem = hoveredHeroItem ?: keyboardSelectedItem ?: uiState.items.first(),
                    isHoverActive = hoveredHeroItem != null || keyboardSelectedItem != null,
''',
    "v7 catalog hero keyboard priority",
)
catalog_path.write_text(catalog, encoding="utf-8")

folder = folder_path.read_text(encoding="utf-8")
folder = folder.replace("import androidx.compose.foundation.background\n", "import androidx.compose.foundation.background\nimport androidx.compose.foundation.focusable\n", 1)
folder = folder.replace("import androidx.compose.foundation.lazy.rememberLazyListState\n", "import androidx.compose.foundation.lazy.LazyListState\nimport androidx.compose.foundation.lazy.rememberLazyListState\n", 1)
folder = folder.replace("import androidx.compose.runtime.mutableFloatStateOf\n", "import androidx.compose.runtime.mutableFloatStateOf\nimport androidx.compose.runtime.mutableIntStateOf\nimport androidx.compose.runtime.rememberCoroutineScope\n", 1)
folder = folder.replace("import androidx.compose.ui.geometry.Offset\n", "import androidx.compose.ui.focus.FocusRequester\nimport androidx.compose.ui.focus.focusRequester\nimport androidx.compose.ui.geometry.Offset\nimport androidx.compose.ui.input.key.Key\nimport androidx.compose.ui.input.key.KeyEventType\nimport androidx.compose.ui.input.key.key\nimport androidx.compose.ui.input.key.onPreviewKeyEvent\nimport androidx.compose.ui.input.key.type\n", 1)
folder = folder.replace("import com.nuvio.app.core.ui.NuvioPosterShape\n", "import com.nuvio.app.core.ui.NuvioPosterShape\nimport com.nuvio.app.core.ui.PosterNavigationDirection\nimport com.nuvio.app.core.ui.PosterRowPosition\nimport com.nuvio.app.core.ui.nextPosterIndex\nimport com.nuvio.app.core.ui.nextPosterRowPosition\nimport com.nuvio.app.core.ui.normalizePosterRowPosition\n", 1)
folder = folder.replace("import kotlinx.coroutines.flow.distinctUntilChanged\n", "import kotlinx.coroutines.flow.distinctUntilChanged\nimport kotlinx.coroutines.launch\n", 1)
folder = replace_once(
    folder,
    '''    var hoveredHeroItem by remember(uiState.collectionTitle, uiState.viewMode) { mutableStateOf<MetaPreview?>(null) }
''',
    '''    var hoveredHeroItem by remember(uiState.collectionTitle, uiState.viewMode) { mutableStateOf<MetaPreview?>(null) }
    var keyboardHeroItem by remember(uiState.collectionTitle, uiState.viewMode) { mutableStateOf<MetaPreview?>(null) }
''',
    "v7 folder keyboard hero state",
)
folder = replace_once(
    folder,
    '''                LaunchedEffect(uiState.viewMode, uiState.selectedTabIndex, defaultHeroItem?.stableKey()) {
                    hoveredHeroItem = null
                }
''',
    '''                LaunchedEffect(uiState.viewMode, uiState.selectedTabIndex, defaultHeroItem?.stableKey()) {
                    hoveredHeroItem = null
                    keyboardHeroItem = null
                }
''',
    "v7 folder selection reset",
)
folder = replace_once(
    folder,
    '''                        selectedItem = hoveredHeroItem ?: defaultHeroItem,
                        isHoverActive = hoveredHeroItem != null,
''',
    '''                        selectedItem = hoveredHeroItem ?: keyboardHeroItem ?: defaultHeroItem,
                        isHoverActive = hoveredHeroItem != null || keyboardHeroItem != null,
''',
    "v7 folder hero keyboard priority",
)
folder = folder.replace(
    '''                        onPosterHoverChanged = { item, hovered ->
                            if (hovered) {
                                hoveredHeroItem = item
                            } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                hoveredHeroItem = null
                            }
                        },
''',
    '''                        onPosterHoverChanged = { item, hovered ->
                            if (hovered) {
                                hoveredHeroItem = item
                            } else if (hoveredHeroItem?.stableKey() == item.stableKey()) {
                                hoveredHeroItem = null
                            }
                        },
                        onKeyboardPosterSelected = { keyboardHeroItem = it },
''',
)
folder = replace_once(
    folder,
    '''    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
    val gridState = rememberLazyGridState()
''',
    '''    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
    onKeyboardPosterSelected: ((MetaPreview?) -> Unit)? = null,
) {
    val gridState = rememberLazyGridState()
    var keyboardSelectedIndex by remember(uiState.selectedTabIndex) { mutableIntStateOf(0) }
    var keyboardNavigationActive by remember(uiState.selectedTabIndex) { mutableStateOf(false) }
    val keyboardFocusRequester = remember(uiState.selectedTabIndex) { FocusRequester() }
    val keyboardScope = rememberCoroutineScope()
''',
    "v7 tabbed grid keyboard signature state",
)
folder = replace_once(
    folder,
    '''            val gridCells = if (isDesktop) {
                GridCells.FixedSize(
                    if (posterCardStyle.catalogLandscapeModeEnabled) {
                        landscapePosterWidth(basePosterWidthDp)
                    } else {
                        basePosterWidthDp.dp
                    },
                )
            } else {
                GridCells.Fixed(columns)
            }

            when {
''',
    '''            val gridCells = if (isDesktop) {
                GridCells.FixedSize(
                    if (posterCardStyle.catalogLandscapeModeEnabled) {
                        landscapePosterWidth(basePosterWidthDp)
                    } else {
                        basePosterWidthDp.dp
                    },
                )
            } else {
                GridCells.Fixed(columns)
            }
            val keyboardSelectedItem = if (keyboardNavigationActive) {
                selectedTab.items.getOrNull(keyboardSelectedIndex)
            } else {
                null
            }

            LaunchedEffect(uiState.selectedTabIndex, selectedTab.items.size, columns, isDesktop) {
                if (!isDesktop || selectedTab.items.isEmpty()) return@LaunchedEffect
                keyboardSelectedIndex = keyboardSelectedIndex.coerceIn(0, selectedTab.items.lastIndex)
                keyboardFocusRequester.requestFocus()
            }

            when {
''',
    "v7 tabbed grid selection",
)
folder = replace_once(
    folder,
    '''                    Box(modifier = Modifier.fillMaxSize()) {
                        LazyVerticalGrid(
''',
    '''                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .then(
                                if (isDesktop) {
                                    Modifier
                                        .focusRequester(keyboardFocusRequester)
                                        .focusable()
                                        .onPreviewKeyEvent { event ->
                                            if (event.type != KeyEventType.KeyDown || selectedTab.items.isEmpty()) {
                                                return@onPreviewKeyEvent false
                                            }
                                            val direction = when (event.key) {
                                                Key.DirectionLeft -> PosterNavigationDirection.Left
                                                Key.DirectionRight -> PosterNavigationDirection.Right
                                                Key.DirectionUp -> PosterNavigationDirection.Up
                                                Key.DirectionDown -> PosterNavigationDirection.Down
                                                else -> null
                                            }
                                            if (direction != null) {
                                                val next = nextPosterIndex(
                                                    currentIndex = keyboardSelectedIndex,
                                                    itemCount = selectedTab.items.size,
                                                    columnCount = columns,
                                                    direction = direction,
                                                )
                                                if (next >= 0) {
                                                    keyboardNavigationActive = true
                                                    keyboardSelectedIndex = next
                                                    onKeyboardPosterSelected?.invoke(selectedTab.items[next])
                                                    keyboardScope.launch { gridState.animateScrollToItem(next) }
                                                }
                                                true
                                            } else if (event.key == Key.Enter) {
                                                selectedTab.items.getOrNull(keyboardSelectedIndex)?.let {
                                                    keyboardNavigationActive = true
                                                    onKeyboardPosterSelected?.invoke(it)
                                                    onPosterClick(it)
                                                    true
                                                } ?: false
                                            } else {
                                                false
                                            }
                                        }
                                } else {
                                    Modifier
                                },
                            ),
                    ) {
                        LazyVerticalGrid(
''',
    "v7 tabbed grid keyboard container",
)
folder = replace_once(
    folder,
    '''                                        onHoverChanged = onPosterHoverChanged?.let { callback ->
                                            { hovered -> callback(item, hovered) }
                                        },
                                        isWatched = isWatched,
''',
    '''                                        onHoverChanged = onPosterHoverChanged?.let { callback ->
                                            { hovered -> callback(item, hovered) }
                                        },
                                        isKeyboardSelected =
                                            keyboardNavigationActive &&
                                                keyboardSelectedItem?.stableKey() == item.stableKey(),
                                        isWatched = isWatched,
''',
    "v7 tabbed selected visual",
)
folder = replace_once(
    folder,
    '''    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
    val sections = FolderDetailRepository.getCatalogSectionsForRows()
    val listState = rememberLazyListState()
''',
    '''    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
    onKeyboardPosterSelected: ((MetaPreview?) -> Unit)? = null,
) {
    val sections = FolderDetailRepository.getCatalogSectionsForRows()
    val listState = rememberLazyListState()
    var keyboardPosition by remember(uiState.collectionTitle) { mutableStateOf(PosterRowPosition(0, 0)) }
    var keyboardNavigationActive by remember(uiState.collectionTitle) { mutableStateOf(false) }
    val keyboardFocusRequester = remember(uiState.collectionTitle) { FocusRequester() }
    val keyboardScope = rememberCoroutineScope()
    val rowStates = remember(sections.map { it.key }) {
        List(sections.size) { LazyListState() }
    }
''',
    "v7 rows keyboard signature state",
)
folder = replace_once(
    folder,
    '''    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val sectionPadding = if (isDesktop) homeSectionHorizontalPaddingForWidth(maxWidth.value) else null
''',
    '''    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .then(
                if (isDesktop) {
                    Modifier
                        .focusRequester(keyboardFocusRequester)
                        .focusable()
                        .onPreviewKeyEvent { event ->
                            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            val rowSizes = sections.map { it.items.size }
                            val normalized = normalizePosterRowPosition(keyboardPosition, rowSizes)
                                ?: return@onPreviewKeyEvent false
                            val direction = when (event.key) {
                                Key.DirectionLeft -> PosterNavigationDirection.Left
                                Key.DirectionRight -> PosterNavigationDirection.Right
                                Key.DirectionUp -> PosterNavigationDirection.Up
                                Key.DirectionDown -> PosterNavigationDirection.Down
                                else -> null
                            }
                            if (direction != null) {
                                val next = nextPosterRowPosition(normalized, rowSizes, direction)
                                    ?: return@onPreviewKeyEvent false
                                keyboardPosition = next
                                keyboardNavigationActive = true
                                val selected = sections.getOrNull(next.row)?.items?.getOrNull(next.column)
                                onKeyboardPosterSelected?.invoke(selected)
                                keyboardScope.launch {
                                    listState.animateScrollToItem(next.row)
                                    rowStates.getOrNull(next.row)?.animateScrollToItem(next.column)
                                }
                                true
                            } else if (event.key == Key.Enter) {
                                sections.getOrNull(normalized.row)?.items?.getOrNull(normalized.column)?.let {
                                    keyboardNavigationActive = true
                                    onKeyboardPosterSelected?.invoke(it)
                                    onPosterClick(it)
                                    true
                                } ?: false
                            } else {
                                false
                            }
                        }
                } else {
                    Modifier
                },
            ),
    ) {
        val sectionPadding = if (isDesktop) homeSectionHorizontalPaddingForWidth(maxWidth.value) else null

        LaunchedEffect(sections.map { it.key }, isDesktop) {
            if (!isDesktop) return@LaunchedEffect
            val normalized = normalizePosterRowPosition(
                keyboardPosition,
                sections.map { it.items.size },
            )
            if (normalized != null) keyboardPosition = normalized
            keyboardFocusRequester.requestFocus()
        }
''',
    "v7 rows keyboard container",
)
folder = replace_once(
    folder,
    '''                val section = keyedSection.value
                HomeCatalogRowSection(
''',
    '''                val section = keyedSection.value
                val sectionIndex = sections.indexOfFirst { it.key == section.key }
                val keyboardSelectedKey = if (
                    keyboardNavigationActive &&
                    keyboardPosition.row == sectionIndex
                ) {
                    section.items.getOrNull(keyboardPosition.column)?.stableKey()
                } else {
                    null
                }
                HomeCatalogRowSection(
''',
    "v7 rows selected section",
)
folder = replace_once(
    folder,
    '''                    onPosterClick = { onPosterClick(it) },
                    useHoverPreview = onPosterHoverChanged == null,
                    onPosterHoverChanged = onPosterHoverChanged,
                )
''',
    '''                    onPosterClick = { onPosterClick(it) },
                    useHoverPreview = onPosterHoverChanged == null,
                    onPosterHoverChanged = onPosterHoverChanged,
                    state = rowStates.getOrNull(sectionIndex) ?: rememberLazyListState(),
                    keyboardSelectedItemKey = keyboardSelectedKey,
                )
''',
    "v7 rows selected row state",
)
folder_path.write_text(folder, encoding="utf-8")

hero = hero_path.read_text(encoding="utf-8")
hero = hero.replace("import androidx.compose.material3.MaterialTheme\n", "import androidx.compose.material3.MaterialTheme\nimport androidx.compose.material3.Surface\n", 1)
hero = replace_once(
    hero,
    '''        meta?.ageRating?.takeIf { it.isNotBlank() }?.let(::add)
        rating?.let { add("IMDb $it") }
    }.joinToString("  •  ")
''',
    '''        meta?.ageRating?.takeIf { it.isNotBlank() }?.let(::add)
    }.joinToString("  •  ")
''',
    "v7 remove imdb text from meta string",
)
hero = replace_once(
    hero,
    '''            if (primaryMeta.isNotBlank()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = primaryMeta,
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White.copy(alpha = 0.90f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
''',
    '''            if (primaryMeta.isNotBlank() || !rating.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    if (primaryMeta.isNotBlank()) {
                        Text(
                            text = primaryMeta,
                            style = MaterialTheme.typography.labelLarge,
                            color = Color.White.copy(alpha = 0.90f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (!rating.isNullOrBlank()) {
                        if (primaryMeta.isNotBlank()) {
                            Text(
                                text = "•",
                                style = MaterialTheme.typography.labelLarge,
                                color = Color.White.copy(alpha = 0.78f),
                            )
                        }
                        Surface(
                            color = Color(0xFFF5C518),
                            shape = RoundedCornerShape(3.dp),
                        ) {
                            Text(
                                text = "IMDb",
                                modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Black),
                                color = Color.Black,
                            )
                        }
                        Text(
                            text = rating,
                            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                            color = Color.White.copy(alpha = 0.94f),
                        )
                    }
                }
            }
''',
    "v7 imdb badge row",
)
hero_path.write_text(hero, encoding="utf-8")

print("Applied V7 deterministic keyboard navigation, avatar resolution, and IMDb badge")


# V8: keyboard selection border/scale belongs to artwork only, never the title/label area.
poster = poster_path.read_text(encoding="utf-8")

poster = replace_once(
    poster,
    '''    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    val keyboardSelectionModifier = if (isKeyboardSelected) {
        Modifier
            .border(
                width = 2.dp,
                color = MaterialTheme.colorScheme.primary,
                shape = RoundedCornerShape(posterCardStyle.cornerRadiusDp.dp),
            )
            .graphicsLayer {
                scaleX = 1.035f
                scaleY = 1.035f
            }
            .zIndex(2f)
    } else {
        Modifier
    }
    var pointerHovered by remember(item.type, item.id) { mutableStateOf(false) }
''',
    '''    val posterCardStyle = rememberPosterCardStyleUiState()
    val isLandscapeMode = useLandscapeBackdropMode || posterCardStyle.catalogLandscapeModeEnabled
    var pointerHovered by remember(item.type, item.id) { mutableStateOf(false) }
''',
    "v8 remove root keyboard artwork styling",
)

poster = replace_once(
    poster,
    '''    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
            .then(keyboardSelectionModifier)
            .onPointerEvent(PointerEventType.Enter) {
''',
    '''    val hoverAwareModifier = if (onHoverChanged != null) {
        modifier
            .onPointerEvent(PointerEventType.Enter) {
''',
    "v8 remove selected modifier hover branch",
)

poster = replace_once(
    poster,
    '''    } else {
        modifier.then(keyboardSelectionModifier)
    }
''',
    '''    } else {
        modifier
    }
''',
    "v8 remove selected modifier no hover branch",
)

poster = replace_once(
    poster,
    '''            isWatched = isWatched,
            onFocusChanged = if (onHoverChanged != null) {
''',
    '''            isWatched = isWatched,
            isKeyboardSelected = isKeyboardSelected,
            onFocusChanged = if (onHoverChanged != null) {
''',
    "v8 pass keyboard selection to artwork",
)

poster_path.write_text(poster, encoding="utf-8")

shelf_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/ShelfComponents.kt"
shelf = shelf_path.read_text(encoding="utf-8")

shelf = replace_once(
    shelf,
    '''    isWatched: Boolean = false,
    onFocusChanged: ((Boolean) -> Unit)? = null,
    onClick: (() -> Unit)? = null,
''',
    '''    isWatched: Boolean = false,
    isKeyboardSelected: Boolean = false,
    onFocusChanged: ((Boolean) -> Unit)? = null,
    onClick: (() -> Unit)? = null,
''',
    "v8 nuvio poster selected param",
)

shelf = replace_once(
    shelf,
    '''        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(shape.aspectRatio)
                .clip(cardShape)
''',
    '''        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(shape.aspectRatio)
                .then(
                    if (isKeyboardSelected) {
                        Modifier
                            .border(
                                width = 2.dp,
                                color = MaterialTheme.colorScheme.primary,
                                shape = cardShape,
                            )
                            .graphicsLayer {
                                scaleX = 1.035f
                                scaleY = 1.035f
                            }
                            .zIndex(2f)
                    } else {
                        Modifier
                    },
                )
                .clip(cardShape)
''',
    "v8 artwork-only keyboard focus styling",
)

shelf_path.write_text(shelf, encoding="utf-8")

print("Applied V8 artwork-only keyboard selection styling")


# V9: make the Windows Hero trailer a real native inline player, force combined
# YouTube playback on Windows, and keep the trailer confined to the right side.
windows_hero_player_path = root / "composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt"
windows_hero_player_path.write_text(r'''package com.nuvio.app.features.details.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.awt.SwingPanel
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.nuvio.app.core.ui.LocalNuvioPlatformDensity
import com.nuvio.app.features.player.PlayerControlsState
import com.nuvio.app.features.player.PlayerResizeMode
import com.nuvio.app.features.player.desktop.NativePlayerController
import com.nuvio.app.features.player.desktop.NativePlayerHost
import kotlinx.coroutines.delay

private const val HeroTrailerSnapshotIntervalMillis = 120L

@Composable
actual fun HeroTrailerPlayerSurface(
    sourceUrl: String,
    sourceAudioUrl: String?,
    playWhenReady: Boolean,
    muted: Boolean,
    startPositionMillis: Long,
    fillFrame: Boolean,
    modifier: Modifier,
    onReady: () -> Unit,
    onEnded: () -> Unit,
    onError: () -> Unit,
) {
    key(sourceUrl, sourceAudioUrl, startPositionMillis) {
        WindowsHeroTrailerSession(
            sourceUrl = sourceUrl,
            sourceAudioUrl = sourceAudioUrl,
            playWhenReady = playWhenReady,
            muted = muted,
            startPositionMillis = startPositionMillis,
            fillFrame = fillFrame,
            modifier = modifier,
            onReady = onReady,
            onEnded = onEnded,
            onError = onError,
        )
    }
}

@Composable
private fun WindowsHeroTrailerSession(
    sourceUrl: String,
    sourceAudioUrl: String?,
    playWhenReady: Boolean,
    muted: Boolean,
    startPositionMillis: Long,
    fillFrame: Boolean,
    modifier: Modifier,
    onReady: () -> Unit,
    onEnded: () -> Unit,
    onError: () -> Unit,
) {
    val platformDensity = LocalNuvioPlatformDensity.current
    val host = remember { NativePlayerHost() }
    val controller = remember(host) { NativePlayerController(host) }
    val hostFirstPaintComplete = remember { mutableStateOf(false) }
    val hostReady = remember { mutableStateOf(false) }
    val readyReported = remember { mutableStateOf(false) }
    val terminalReported = remember { mutableStateOf(false) }
    val latestOnReady = rememberUpdatedState(onReady)
    val latestOnEnded = rememberUpdatedState(onEnded)
    val latestOnError = rememberUpdatedState(onError)

    DisposableEffect(host, controller) {
        host.setControlsVisible(false)
        host.onDisplayableChanged = { displayable ->
            if (!displayable) {
                hostFirstPaintComplete.value = false
                hostReady.value = false
            }
        }
        host.onFirstPaint = {
            hostFirstPaintComplete.value = true
        }
        host.onFirstFullSizePaint = {
            hostReady.value = true
        }
        onDispose {
            host.onDisplayableChanged = null
            host.onFirstPaint = null
            host.onFirstFullSizePaint = null
            controller.dispose()
        }
    }

    LaunchedEffect(controller) {
        controller.setControlCallbacks(
            onAction = { false },
            onEvent = { _, _ -> false },
            onScrubChange = { false },
            onScrubFinished = { false },
        )
    }

    LaunchedEffect(
        controller,
        hostReady.value,
        sourceUrl,
        sourceAudioUrl,
        startPositionMillis,
    ) {
        if (!hostReady.value || sourceUrl.isBlank()) return@LaunchedEffect

        if (!sourceAudioUrl.isNullOrBlank()) {
            terminalReported.value = true
            latestOnError.value()
            return@LaunchedEffect
        }

        readyReported.value = false
        terminalReported.value = false
        delay(16L)
        controller.attach(
            sourceUrl = sourceUrl,
            sourceHeaders = emptyMap(),
            playWhenReady = playWhenReady,
            initialPositionMs = startPositionMillis.coerceAtLeast(0L),
            decoderPriority = 0,
            nvidiaRtxSuperResolutionEnabled = false,
            onError = {
                if (!terminalReported.value) {
                    terminalReported.value = true
                    latestOnError.value()
                }
            },
        )
        controller.setResizeMode(
            if (fillFrame) PlayerResizeMode.Zoom else PlayerResizeMode.Fit,
        )
        controller.updateControls(
            PlayerControlsState(
                controlsVisible = false,
                volumeLevel = if (muted) 0f else null,
            ),
        )
        controller.setMuted(muted)
    }

    LaunchedEffect(controller, playWhenReady, hostReady.value) {
        if (!hostReady.value) return@LaunchedEffect
        if (playWhenReady) controller.play() else controller.pause()
    }

    LaunchedEffect(controller, muted, hostReady.value) {
        if (hostReady.value) controller.setMuted(muted)
    }

    LaunchedEffect(controller, hostReady.value) {
        if (!hostReady.value) return@LaunchedEffect
        while (true) {
            val snapshot = controller.snapshot()
            val hasPlaybackProgress =
                snapshot.positionMs >= (startPositionMillis.coerceAtLeast(0L) + 250L)
            if (
                !readyReported.value &&
                !terminalReported.value &&
                !snapshot.isEnded &&
                (
                    hasPlaybackProgress ||
                        snapshot.isPlaying ||
                        (!snapshot.isLoading && snapshot.durationMs > 0L)
                    )
            ) {
                readyReported.value = true
                latestOnReady.value()
            }
            if (!terminalReported.value && snapshot.isEnded) {
                terminalReported.value = true
                latestOnEnded.value()
            }
            delay(HeroTrailerSnapshotIntervalMillis)
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        androidx.compose.runtime.CompositionLocalProvider(
            LocalDensity provides platformDensity,
        ) {
            SwingPanel(
                factory = { host },
                modifier = if (hostFirstPaintComplete.value) {
                    Modifier.fillMaxSize()
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .requiredSize(1.dp)
                },
                background = Color.Black,
            )
        }
    }
}
''', encoding="utf-8")

native_controller_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/desktop/NativePlayerController.kt"
native_controller = native_controller_path.read_text(encoding="utf-8")
native_controller = replace_once(
    native_controller,
    '''    @Volatile
    private var currentVolumeLevel = rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
''',
    '''    @Volatile
    private var currentVolumeLevel = rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
    @Volatile
    private var mutedOverride: Boolean = false
''',
    "v9 native player mute state",
)
native_controller = replace_once(
    native_controller,
    '''    override fun pause() {
        log.d { "pause handle=$handle" }
        handle.takeIf { it != 0L }?.let { NativePlayerBridge.setPaused(it, true) }
    }
''',
    '''    override fun pause() {
        log.d { "pause handle=$handle" }
        handle.takeIf { it != 0L }?.let { NativePlayerBridge.setPaused(it, true) }
    }

    override fun setMuted(muted: Boolean) {
        mutedOverride = muted
        val current = handle
        if (current == 0L) return
        val level = if (muted) {
            0f
        } else {
            rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
        }
        currentVolumeLevel = level
        NativePlayerBridge.setVolume(current, level)
        controlsState = controlsState.copy(volumeLevel = level)
    }
''',
    "v9 native player setMuted",
)
native_controller = replace_once(
    native_controller,
    '''        val level = rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
        currentVolumeLevel = level
        NativePlayerBridge.setVolume(current, level)
''',
    '''        val level = if (mutedOverride) {
            0f
        } else {
            rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
        }
        currentVolumeLevel = level
        NativePlayerBridge.setVolume(current, level)
''',
    "v9 preserve mute after native attach",
)
native_controller_path.write_text(native_controller, encoding="utf-8")

trailer_platform_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/features/trailer/TrailerExtractionPlatform.desktop.kt"
trailer_platform = trailer_platform_path.read_text(encoding="utf-8")
trailer_platform = replace_once(
    trailer_platform,
    '''    fun supportsSeparateVideo(candidate: StreamCandidate): Boolean = candidate.ext == "mp4"

    fun supportsSeparateAudio(candidate: StreamCandidate): Boolean = candidate.ext == "m4a"
''',
    '''    private val windowsHost: Boolean =
        System.getProperty("os.name", "").contains("win", ignoreCase = true)

    fun supportsSeparateVideo(candidate: StreamCandidate): Boolean =
        !windowsHost && candidate.ext == "mp4"

    fun supportsSeparateAudio(candidate: StreamCandidate): Boolean =
        !windowsHost && candidate.ext == "m4a"
''',
    "v9 Windows combined trailer source",
)
trailer_platform_path.write_text(trailer_platform, encoding="utf-8")

hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    '''                .fillMaxWidth(0.70f)
                .fillMaxHeight(),
''',
    '''                .fillMaxWidth(0.62f)
                .fillMaxHeight(),
''',
    "v9 hero trailer right-side width",
)
hero_path.write_text(hero, encoding="utf-8")

main_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/Main.kt"
main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''        val smokePlayerUrl = (
            System.getProperty("nuvio.desktop.smokePlayerUrl")
                ?: System.getenv("NUVIO_DESKTOP_SMOKE_PLAYER_URL")
            )
            ?.takeIf { it.isNotBlank() }
''',
    '''        val smokePlayerUrl = (
            System.getProperty("nuvio.desktop.smokePlayerUrl")
                ?: System.getenv("NUVIO_DESKTOP_SMOKE_PLAYER_URL")
            )
            ?.takeIf { it.isNotBlank() }
        val heroTrailerSmokeYoutubeUrl =
            System.getenv("NUVIO_HERO_TRAILER_SMOKE_YOUTUBE_URL")
                ?.takeIf { it.isNotBlank() }
        val heroTrailerSmokeMarker =
            System.getenv("NUVIO_HERO_TRAILER_SMOKE_MARKER")
                ?.takeIf { it.isNotBlank() }
''',
    "v9 hero smoke env",
)
main = replace_once(
    main,
    '''            title = if (smokePlayerUrl == null) "Nuvio" else "Nuvio Player Smoke",
''',
    '''            title = when {
                heroTrailerSmokeYoutubeUrl != null -> "Nuvio Hero Trailer Smoke"
                smokePlayerUrl != null -> "Nuvio Player Smoke"
                else -> "Nuvio"
            },
''',
    "v9 smoke window title",
)
main = replace_once(
    main,
    '''            if (smokePlayerUrl == null) {
                App()
            } else {
                // The player surface reads LocalNuvioPlatformDensity, which only
                // NuvioTheme provides — the bare smoke harness must supply it too.
                NuvioTheme {
                    PlatformPlayerSurface(
                        sourceUrl = smokePlayerUrl,
                        modifier = Modifier.fillMaxSize(),
                        onControllerReady = {},
                        onSnapshot = {},
                        onError = {},
                    )
                }
            }
''',
    '''            when {
                heroTrailerSmokeYoutubeUrl != null && heroTrailerSmokeMarker != null -> {
                    NuvioTheme {
                        HeroTrailerSmokeHarness(
                            youtubeUrl = heroTrailerSmokeYoutubeUrl,
                            markerPath = heroTrailerSmokeMarker,
                        )
                    }
                }
                smokePlayerUrl != null -> {
                    NuvioTheme {
                        PlatformPlayerSurface(
                            sourceUrl = smokePlayerUrl,
                            modifier = Modifier.fillMaxSize(),
                            onControllerReady = {},
                            onSnapshot = {},
                            onError = {},
                        )
                    }
                }
                else -> App()
            }
''',
    "v9 smoke harness branch",
)

main += r'''

@androidx.compose.runtime.Composable
private fun HeroTrailerSmokeHarness(
    youtubeUrl: String,
    markerPath: String,
) {
    val source = remember {
        androidx.compose.runtime.mutableStateOf<com.nuvio.app.features.trailer.TrailerPlaybackSource?>(null)
    }
    val terminal = remember { androidx.compose.runtime.mutableStateOf(false) }
    val readyObserved = remember { androidx.compose.runtime.mutableStateOf(false) }

    fun mark(value: String) {
        runCatching {
            java.io.File(markerPath).apply {
                parentFile?.mkdirs()
                writeText(value)
            }
        }
    }

    LaunchedEffect(youtubeUrl) {
        runCatching {
            com.nuvio.app.features.trailer.TrailerPlaybackResolver.resolveFromYouTubeUrl(youtubeUrl)
        }.onSuccess { resolved ->
            when {
                resolved == null -> {
                    terminal.value = true
                    mark("error:resolver-null")
                }
                !resolved.audioUrl.isNullOrBlank() -> {
                    terminal.value = true
                    mark("error:windows-separate-audio")
                }
                else -> {
                    source.value = resolved
                    mark("resolved")
                }
            }
        }.onFailure { error ->
            terminal.value = true
            mark("error:resolver:" + (error::class.simpleName ?: "unknown"))
        }
    }

    source.value?.let { playbackSource ->
        com.nuvio.app.features.details.components.HeroTrailerPlayerSurface(
            sourceUrl = playbackSource.videoUrl,
            sourceAudioUrl = playbackSource.audioUrl,
            playWhenReady = true,
            muted = true,
            startPositionMillis = 0L,
            fillFrame = true,
            modifier = Modifier.fillMaxSize(),
            onReady = {
                if (!terminal.value) {
                    readyObserved.value = true
                    mark("ready")
                }
            },
            onEnded = {
                if (!terminal.value && !readyObserved.value) {
                    mark("ended-before-ready")
                }
            },
            onError = {
                terminal.value = true
                mark("error:player")
            },
        )
    }
}
'''
main_path.write_text(main, encoding="utf-8")

print("Applied V9 Windows inline Hero trailer player + CI first-frame smoke harness")


# V9.1: transient YouTube extraction failures must not kill Hero autoplay.
resolver_path = root / "composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/trailer/TrailerPlaybackResolver.kt"
resolver = resolver_path.read_text(encoding="utf-8")
resolver = resolver.replace(
    "import kotlinx.coroutines.sync.Mutex\n",
    "import kotlinx.coroutines.delay\nimport kotlinx.coroutines.sync.Mutex\n",
    1,
)
resolver = replace_once(
    resolver,
    '''        val source = extractor.extractPlaybackSource(youtubeUrl)
        if (source != null) {
''',
    '''        var source: TrailerPlaybackSource? = null
        val retryDelaysMillis = listOf(0L, 350L, 1_000L)
        for ((attemptIndex, retryDelayMillis) in retryDelaysMillis.withIndex()) {
            if (retryDelayMillis > 0L) {
                delay(retryDelayMillis)
            }
            source = extractor.extractPlaybackSource(youtubeUrl)
            if (source != null) {
                if (attemptIndex > 0) {
                    TrailerExtractionPlatform.diagnostic(
                        "resolver recovered attempt=${attemptIndex + 1}",
                    )
                }
                break
            }
            TrailerExtractionPlatform.diagnostic(
                "resolver miss attempt=${attemptIndex + 1}/${retryDelaysMillis.size}",
            )
        }
        if (source != null) {
''',
    "v9 resolver retry",
)
resolver_path.write_text(resolver, encoding="utf-8")

print("Applied V9.1 transient YouTube resolver retry")


# V9.2: Windows Hero autoplay prefers one-file progressive YouTube streams over HLS.
trailer_platform_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/features/trailer/TrailerExtractionPlatform.desktop.kt"
trailer_platform = trailer_platform_path.read_text(encoding="utf-8")
trailer_platform = replace_once(
    trailer_platform,
    '''        val bestCombinedIsManifest = bestManifest != null &&
            (bestProgressive == null || bestManifest.height > bestProgressive.height)
        val preferManifestPlayback = bestManifest != null &&
            (bestVideo == null || bestManifest.height >= bestVideo.height)
        val combinedUrl = if (bestCombinedIsManifest) {
            bestManifest.manifestUrl
        } else {
            bestProgressive?.url
        }
''',
    '''        val bestCombinedIsManifest = if (windowsHost) {
            bestProgressive == null && bestManifest != null
        } else {
            bestManifest != null &&
                (bestProgressive == null || bestManifest.height > bestProgressive.height)
        }
        val preferManifestPlayback = if (windowsHost) {
            bestProgressive == null && bestManifest != null
        } else {
            bestManifest != null &&
                (bestVideo == null || bestManifest.height >= bestVideo.height)
        }
        val combinedUrl = if (bestCombinedIsManifest) {
            bestManifest?.selectedVariantUrl
        } else {
            bestProgressive?.url ?: bestManifest?.selectedVariantUrl
        }
''',
    "v9 Windows progressive Hero source priority",
)
trailer_platform_path.write_text(trailer_platform, encoding="utf-8")

print("Applied V9.2 Windows progressive-first Hero trailer source policy")


# V9.3: extracted YouTube/googlevideo URLs must be opened by mpv with browser headers.
windows_hero_player_path = root / "composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt"
windows_hero_player = windows_hero_player_path.read_text(encoding="utf-8")
windows_hero_player = replace_once(
    windows_hero_player,
    '''private const val HeroTrailerSnapshotIntervalMillis = 120L
''',
    '''private const val HeroTrailerSnapshotIntervalMillis = 120L

private val HeroTrailerPlaybackHeaders = mapOf(
    "User-Agent" to "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Referer" to "https://www.youtube.com/",
    "Origin" to "https://www.youtube.com",
    "Accept-Language" to "en-US,en;q=0.9",
)
''',
    "v9 hero playback headers",
)
windows_hero_player = replace_once(
    windows_hero_player,
    '''        controller.attach(
            sourceUrl = sourceUrl,
            sourceHeaders = emptyMap(),
''',
    '''        controller.attach(
            sourceUrl = sourceUrl,
            sourceHeaders = HeroTrailerPlaybackHeaders,
''',
    "v9 pass YouTube headers to native player",
)
windows_hero_player_path.write_text(windows_hero_player, encoding="utf-8")

print("Applied V9.3 YouTube playback headers for Windows native Hero player")


# V9.4: keep the extractor/player HTTP identity consistent and map special headers to mpv options.
windows_hero_player_path = root / "composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt"
windows_hero_player = windows_hero_player_path.read_text(encoding="utf-8")
windows_hero_player = replace_once(
    windows_hero_player,
    '''import com.nuvio.app.features.player.desktop.NativePlayerHost
''',
    '''import com.nuvio.app.features.player.desktop.NativePlayerHost
import com.nuvio.app.features.trailer.TrailerExtractionPlatform
''',
    "v9.4 hero trailer platform headers import",
)
windows_hero_player = replace_once(
    windows_hero_player,
    '''private val HeroTrailerPlaybackHeaders = mapOf(
    "User-Agent" to "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Referer" to "https://www.youtube.com/",
    "Origin" to "https://www.youtube.com",
    "Accept-Language" to "en-US,en;q=0.9",
)
''',
    '''private val HeroTrailerPlaybackHeaders = TrailerExtractionPlatform.defaultHeaders
''',
    "v9.4 use extractor headers for native Hero playback",
)
windows_hero_player_path.write_text(windows_hero_player, encoding="utf-8")

bridge_path = root / "composeApp/src/desktopMain/native/windows/player_bridge.cpp"
bridge = bridge_path.read_text(encoding="utf-8")
bridge = replace_once(
    bridge,
    r'''            if (!headerLines.empty()) {
                std::string headers;
                for (size_t index = 0; index < headerLines.size(); index++) {
                    if (index > 0) headers.push_back(',');
                    // Escape backslashes and commas in header values
                    for (char c : headerLines[index]) {
                        if (c == '\\' || c == ',') headers.push_back('\\');
                        headers.push_back(c);
                    }
                }
                setMpvOptionStringLocked("http-header-fields", headers.c_str());
            }
''',
    r'''            if (!headerLines.empty()) {
                std::vector<std::string> genericHeaders;
                for (const std::string &headerLine : headerLines) {
                    const size_t separator = headerLine.find(':');
                    if (separator == std::string::npos) {
                        genericHeaders.push_back(headerLine);
                        continue;
                    }

                    std::string name = headerLine.substr(0, separator);
                    std::string value = headerLine.substr(separator + 1);
                    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) {
                        value.erase(value.begin());
                    }

                    std::string lowerName = name;
                    std::transform(
                        lowerName.begin(),
                        lowerName.end(),
                        lowerName.begin(),
                        [](unsigned char c) { return static_cast<char>(std::tolower(c)); }
                    );

                    if (lowerName == "user-agent") {
                        setMpvOptionStringLocked("user-agent", value.c_str());
                    } else if (lowerName == "referer" || lowerName == "referrer") {
                        setMpvOptionStringLocked("referrer", value.c_str());
                    } else {
                        genericHeaders.push_back(headerLine);
                    }
                }

                if (!genericHeaders.empty()) {
                    std::string headers;
                    for (size_t index = 0; index < genericHeaders.size(); index++) {
                        if (index > 0) headers.push_back(',');
                        for (char c : genericHeaders[index]) {
                            if (c == '\\' || c == ',') headers.push_back('\\');
                            headers.push_back(c);
                        }
                    }
                    setMpvOptionStringLocked("http-header-fields", headers.c_str());
                }
            }
''',
    "v9.4 mpv dedicated user-agent and referrer options",
)
bridge_path.write_text(bridge, encoding="utf-8")

print("Applied V9.4 mpv User-Agent/referrer option mapping on Windows")


# V9.5: the Hero player must keep software decode fallback available on generic Windows machines.
windows_hero_player = windows_hero_player_path.read_text(encoding="utf-8")
windows_hero_player = replace_once(
    windows_hero_player,
    '''            decoderPriority = 0,
''',
    '''            decoderPriority = 1,
''',
    "v9.5 normal Hero decoder fallback priority",
)
windows_hero_player_path.write_text(windows_hero_player, encoding="utf-8")

print("Applied V9.5 normal decoder fallback policy for Windows Hero trailer")


# V9.6: Windows catalog Hero must pass the real in-app Hero capability gate.
hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    '''import com.nuvio.app.core.build.TrailerPlaybackMode
''',
    '''''',
    "v9.6 remove obsolete catalog trailer mode import",
)
hero = replace_once(
    hero,
    '''    val trailerPlaybackEnabled =
        AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP &&
            posterCardStyle.hoverPreviewTrailerEnabled
''',
    '''    val trailerPlaybackEnabled = isCatalogHeroTrailerPlaybackEnabled(posterCardStyle)
''',
    "v9.6 catalog Hero capability gate",
)
hero += r'''

internal fun isCatalogHeroTrailerPlaybackEnabled(
    posterCardStyle: com.nuvio.app.core.ui.PosterCardStyleUiState,
): Boolean =
    AppFeaturePolicy.heroTrailerPlaybackSupported &&
        posterCardStyle.hoverPreviewTrailerEnabled
'''
hero_path.write_text(hero, encoding="utf-8")

policy_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/core/build/AppFeaturePolicy.desktop.kt"
policy = policy_path.read_text(encoding="utf-8")
policy = replace_once(
    policy,
    '''    actual val heroTrailerPlaybackSupported: Boolean = !isWindowsDesktop
''',
    '''    actual val heroTrailerPlaybackSupported: Boolean = true
''',
    "v9.6 enable native Hero trailer capability on Windows",
)
policy_path.write_text(policy, encoding="utf-8")

settings_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/settings/HoverPreviewSettingsPage.kt"
settings = settings_path.read_text(encoding="utf-8")
settings = replace_once(
    settings,
    '''    if (AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP) {
''',
    '''    if (
        AppFeaturePolicy.heroTrailerPlaybackSupported ||
        AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP
    ) {
''',
    "v9.6 expose Hero trailer controls when Hero playback is supported",
)
settings_path.write_text(settings, encoding="utf-8")

style_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/PosterCardStyleRepository.kt"
style = style_path.read_text(encoding="utf-8")
style = replace_once(
    style,
    '''package com.nuvio.app.core.ui

''',
    '''package com.nuvio.app.core.ui

import com.nuvio.app.isWindows
''',
    "v9.6 Windows trailer preference migration import",
)
style = replace_once(
    style,
    '''@Serializable
private data class StoredPosterCardStylePreferences(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,
    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
''',
    '''@Serializable
private data class StoredPosterCardStylePreferences(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,
    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = false,
    val hoverPreviewTrailerConfigured: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
''',
    "v9.6 stored trailer configured flag",
)
style = replace_once(
    style,
    '''data class PosterCardStyleUiState(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,
    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
''',
    '''data class PosterCardStyleUiState(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,
    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = isWindows,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
''',
    "v9.6 Windows Hero trailer default",
)
style = replace_once(
    style,
    '''    private var hasLoaded = false
''',
    '''    private var hasLoaded = false
    private var hoverPreviewTrailerConfigured = false
''',
    "v9.6 trailer preference migration state",
)
style = replace_once(
    style,
    '''    fun clearLocalState() {
        hasLoaded = false
        _uiState.value = PosterCardStyleUiState()
    }
''',
    '''    fun clearLocalState() {
        hasLoaded = false
        hoverPreviewTrailerConfigured = false
        _uiState.value = PosterCardStyleUiState()
    }
''',
    "v9.6 clear trailer preference migration state",
)
style = replace_once(
    style,
    '''    fun setHoverPreviewTrailerEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerEnabled == enabled) return
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerEnabled = enabled)
        persist()
    }
''',
    '''    fun setHoverPreviewTrailerEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerEnabled == enabled && hoverPreviewTrailerConfigured) return
        hoverPreviewTrailerConfigured = true
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerEnabled = enabled)
        persist()
    }
''',
    "v9.6 mark explicit trailer enable preference",
)
style = replace_once(
    style,
    '''        if (payload.isEmpty()) {
            _uiState.value = PosterCardStyleUiState()
            return
        }
''',
    '''        if (payload.isEmpty()) {
            hoverPreviewTrailerConfigured = false
            _uiState.value = PosterCardStyleUiState()
            return
        }
''',
    "v9.6 empty preference migration",
)
style = replace_once(
    style,
    '''        val stored = runCatching {
            json.decodeFromString<StoredPosterCardStylePreferences>(payload)
        }.getOrNull()

        _uiState.value = if (stored != null) {
''',
    '''        val stored = runCatching {
            json.decodeFromString<StoredPosterCardStylePreferences>(payload)
        }.getOrNull()
        hoverPreviewTrailerConfigured = stored?.hoverPreviewTrailerConfigured ?: false

        _uiState.value = if (stored != null) {
''',
    "v9.6 load trailer configured flag",
)
style = replace_once(
    style,
    '''                hoverPreviewTrailerEnabled = stored.hoverPreviewTrailerEnabled,
                hoverPreviewTrailerSoundEnabled = stored.hoverPreviewTrailerSoundEnabled,
''',
    '''                hoverPreviewTrailerEnabled =
                    if (isWindows && !hoverPreviewTrailerConfigured) true
                    else stored.hoverPreviewTrailerEnabled,
                hoverPreviewTrailerSoundEnabled = stored.hoverPreviewTrailerSoundEnabled,
''',
    "v9.6 migrate legacy Windows disabled trailer default",
)
style = replace_once(
    style,
    '''                    hoverPreviewTrailerEnabled = _uiState.value.hoverPreviewTrailerEnabled,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,
''',
    '''                    hoverPreviewTrailerEnabled = _uiState.value.hoverPreviewTrailerEnabled,
                    hoverPreviewTrailerConfigured = hoverPreviewTrailerConfigured,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,
''',
    "v9.6 persist trailer configured flag",
)
style_path.write_text(style, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''    LaunchedEffect(youtubeUrl) {
        runCatching {
            com.nuvio.app.features.trailer.TrailerPlaybackResolver.resolveFromYouTubeUrl(youtubeUrl)
''',
    '''    LaunchedEffect(youtubeUrl) {
        com.nuvio.app.core.ui.PosterCardStyleRepository.ensureLoaded()
        val heroStyle = com.nuvio.app.core.ui.PosterCardStyleRepository.uiState.value
        if (!com.nuvio.app.features.home.components.isCatalogHeroTrailerPlaybackEnabled(heroStyle)) {
            terminal.value = true
            mark("error:hero-gate-disabled")
            return@LaunchedEffect
        }

        runCatching {
            com.nuvio.app.features.trailer.TrailerPlaybackResolver.resolveFromYouTubeUrl(youtubeUrl)
''',
    "v9.6 smoke real Hero gate",
)
main_path.write_text(main, encoding="utf-8")

print("Applied V9.6 Windows Hero capability gate + trailer preference migration")


# V9.7: port NuvioTV's resilient Innertube config path to Desktop.
extractor_path = root / "composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/trailer/InAppYouTubeExtractor.kt"
extractor = extractor_path.read_text(encoding="utf-8")
extractor = replace_once(
    extractor,
    '''private const val PREFERRED_SEPARATE_CLIENT = "visionos"
''',
    '''private const val PREFERRED_SEPARATE_CLIENT = "visionos"
private const val FALLBACK_INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
private const val STABLE_WATCH_CONFIG_VIDEO_ID = "dQw4w9WgXcQ"
''',
    "v9.7 NuvioTV Innertube fallback constants",
)
extractor = replace_once(
    extractor,
    '''        val watchUrl = "https://www.youtube.com/watch?v=$videoId&hl=en"
        val watchResponse = TrailerExtractionPlatform.performRequest(
            url = watchUrl,
            method = "GET",
            headers = TrailerExtractionPlatform.defaultHeaders,
            body = null,
            timeoutMillis = TRAILER_REQUEST_TIMEOUT_MS,
        )
        if (!watchResponse.ok) {
            throw IllegalStateException("Failed to fetch watch page (${watchResponse.status})")
        }
        TrailerExtractionPlatform.diagnostic(
            "watch ok status=${watchResponse.status} bytes=${watchResponse.body.length}",
        )

        val watchConfig = getWatchConfig(watchResponse.body)
        val apiKey = watchConfig.apiKey
            ?: throw IllegalStateException("Unable to extract INNERTUBE_API_KEY")
''',
    '''        val watchUrl =
            "https://www.youtube.com/watch?v=$STABLE_WATCH_CONFIG_VIDEO_ID&hl=en"
        val watchResponse = TrailerExtractionPlatform.performRequest(
            url = watchUrl,
            method = "GET",
            headers = TrailerExtractionPlatform.defaultHeaders,
            body = null,
            timeoutMillis = TRAILER_REQUEST_TIMEOUT_MS,
        )
        val watchConfig = if (watchResponse.ok) {
            TrailerExtractionPlatform.diagnostic(
                "watch config ok status=${watchResponse.status} bytes=${watchResponse.body.length}",
            )
            getWatchConfig(watchResponse.body)
        } else {
            TrailerExtractionPlatform.diagnostic(
                "watch config unavailable status=${watchResponse.status}; using fallback key",
            )
            WatchConfig(apiKey = null, visitorData = null)
        }
        val apiKey = watchConfig.apiKey ?: FALLBACK_INNERTUBE_API_KEY
        if (watchConfig.apiKey == null) {
            TrailerExtractionPlatform.diagnostic("watch config using NuvioTV fallback Innertube key")
        }
''',
    "v9.7 resilient watch config and fallback key",
)
extractor = replace_once(
    extractor,
    '''                val playerResponse = fetchPlayerResponse(
                    apiKey = apiKey,
                    videoId = videoId,
                    client = client,
                    visitorData = watchConfig.visitorData,
                )

                val streamingData = playerResponse.objectValue("streamingData")
                    ?: throw IllegalStateException("missing streamingData")
''',
    '''                var playerResponse = fetchPlayerResponse(
                    apiKey = apiKey,
                    videoId = videoId,
                    client = client,
                    visitorData = watchConfig.visitorData,
                )
                var playabilityStatus =
                    playerResponse.objectValue("playabilityStatus")?.stringValue("status")
                if (
                    playabilityStatus == "LOGIN_REQUIRED" &&
                    !watchConfig.visitorData.isNullOrBlank()
                ) {
                    TrailerExtractionPlatform.diagnostic(
                        "client=${client.key} status=LOGIN_REQUIRED; retrying without visitor data",
                    )
                    playerResponse = fetchPlayerResponse(
                        apiKey = apiKey,
                        videoId = videoId,
                        client = client,
                        visitorData = null,
                    )
                    playabilityStatus =
                        playerResponse.objectValue("playabilityStatus")?.stringValue("status")
                }
                if (playabilityStatus != null && playabilityStatus != "OK") {
                    val reason = playerResponse.objectValue("playabilityStatus")
                        ?.stringValue("reason")
                        .orEmpty()
                    TrailerExtractionPlatform.diagnostic(
                        "client=${client.key} playability=$playabilityStatus reason=$reason",
                    )
                    return@runCatching
                }

                val streamingData = playerResponse.objectValue("streamingData")
                    ?: throw IllegalStateException("missing streamingData")
''',
    "v9.7 playability diagnostics and visitor fallback",
)
extractor_path.write_text(extractor, encoding="utf-8")

print("Applied V9.7 NuvioTV Innertube fallback + playability diagnostics")


# V9.8: match the supplied Hero reference framing/gradient and enable Windows sound by default.
hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    '''                .fillMaxWidth(0.62f)
                .fillMaxHeight(),
''',
    '''                .fillMaxWidth(0.68f)
                .fillMaxHeight(),
''',
    "v9.8 reference trailer visual width",
)
hero = replace_once(
    hero,
    '''                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 0.99f),
                            0.22f to backgroundColor.copy(alpha = 0.96f),
                            0.45f to backgroundColor.copy(alpha = 0.76f),
                            0.70f to backgroundColor.copy(alpha = 0.16f),
                            1f to Color.Transparent,
                        ),
                    ),
''',
    '''                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 1.00f),
                            0.28f to backgroundColor.copy(alpha = 0.99f),
                            0.40f to backgroundColor.copy(alpha = 0.96f),
                            0.50f to backgroundColor.copy(alpha = 0.82f),
                            0.60f to backgroundColor.copy(alpha = 0.56f),
                            0.70f to backgroundColor.copy(alpha = 0.28f),
                            0.82f to backgroundColor.copy(alpha = 0.07f),
                            1f to Color.Transparent,
                        ),
                    ),
''',
    "v9.8 reference wide horizontal video blend",
)
hero = replace_once(
    hero,
    '''                    Brush.verticalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 0.42f),
                            0.18f to Color.Transparent,
                            0.68f to Color.Transparent,
                            1f to backgroundColor.copy(alpha = 0.96f),
                        ),
                    ),
''',
    '''                    Brush.verticalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 0.10f),
                            0.14f to Color.Transparent,
                            0.70f to Color.Transparent,
                            0.86f to backgroundColor.copy(alpha = 0.42f),
                            1f to backgroundColor.copy(alpha = 0.94f),
                        ),
                    ),
''',
    "v9.8 reference subtle top and strong shelf blend",
)
hero_path.write_text(hero, encoding="utf-8")

style_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/PosterCardStyleRepository.kt"
style = style_path.read_text(encoding="utf-8")
style = replace_once(
    style,
    '''    val hoverPreviewTrailerConfigured: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
''',
    '''    val hoverPreviewTrailerConfigured: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
    val hoverPreviewTrailerSoundConfigured: Boolean = false,
''',
    "v9.8 stored trailer sound configured flag",
)
style = replace_once(
    style,
    '''    val hoverPreviewTrailerEnabled: Boolean = isWindows,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,
''',
    '''    val hoverPreviewTrailerEnabled: Boolean = isWindows,
    val hoverPreviewTrailerSoundEnabled: Boolean = isWindows,
''',
    "v9.8 Windows trailer sound default",
)
style = replace_once(
    style,
    '''    private var hasLoaded = false
    private var hoverPreviewTrailerConfigured = false
''',
    '''    private var hasLoaded = false
    private var hoverPreviewTrailerConfigured = false
    private var hoverPreviewTrailerSoundConfigured = false
''',
    "v9.8 sound preference migration state",
)
style = replace_once(
    style,
    '''        hasLoaded = false
        hoverPreviewTrailerConfigured = false
        _uiState.value = PosterCardStyleUiState()
''',
    '''        hasLoaded = false
        hoverPreviewTrailerConfigured = false
        hoverPreviewTrailerSoundConfigured = false
        _uiState.value = PosterCardStyleUiState()
''',
    "v9.8 clear sound preference migration state",
)
style = replace_once(
    style,
    '''    fun setHoverPreviewTrailerSoundEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerSoundEnabled == enabled) return
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerSoundEnabled = enabled)
        persist()
    }
''',
    '''    fun setHoverPreviewTrailerSoundEnabled(enabled: Boolean) {
        ensureLoaded()
        if (
            _uiState.value.hoverPreviewTrailerSoundEnabled == enabled &&
            hoverPreviewTrailerSoundConfigured
        ) return
        hoverPreviewTrailerSoundConfigured = true
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerSoundEnabled = enabled)
        persist()
    }
''',
    "v9.8 mark explicit trailer sound preference",
)
style = replace_once(
    style,
    '''        hoverPreviewTrailerConfigured = stored?.hoverPreviewTrailerConfigured ?: false

        _uiState.value = if (stored != null) {
''',
    '''        hoverPreviewTrailerConfigured = stored?.hoverPreviewTrailerConfigured ?: false
        hoverPreviewTrailerSoundConfigured =
            stored?.hoverPreviewTrailerSoundConfigured ?: false

        _uiState.value = if (stored != null) {
''',
    "v9.8 load trailer sound configured flag",
)
style = replace_once(
    style,
    '''                hoverPreviewTrailerSoundEnabled = stored.hoverPreviewTrailerSoundEnabled,
                hoverPreviewTrailerStartSeconds = normalizeHoverPreviewTrailerStartSeconds(
''',
    '''                hoverPreviewTrailerSoundEnabled =
                    if (isWindows && !hoverPreviewTrailerSoundConfigured) true
                    else stored.hoverPreviewTrailerSoundEnabled,
                hoverPreviewTrailerStartSeconds = normalizeHoverPreviewTrailerStartSeconds(
''',
    "v9.8 migrate legacy Windows muted trailer default",
)
style = replace_once(
    style,
    '''                    hoverPreviewTrailerConfigured = hoverPreviewTrailerConfigured,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,
''',
    '''                    hoverPreviewTrailerConfigured = hoverPreviewTrailerConfigured,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,
                    hoverPreviewTrailerSoundConfigured = hoverPreviewTrailerSoundConfigured,
''',
    "v9.8 persist trailer sound configured flag",
)
style_path.write_text(style, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''            muted = true,
''',
    '''            muted = false,
''',
    "v9.8 unmuted installed Hero smoke",
)
main_path.write_text(main, encoding="utf-8")

print("Applied V9.8 reference Hero blend + Windows sound-on migration")


# V9.9: render the Hero blend in the native WebView2 layer that actually sits above mpv.
hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    '''                .fillMaxWidth(0.68f)
                .fillMaxHeight(),
''',
    '''                .fillMaxWidth(0.58f)
                .fillMaxHeight(),
''',
    "v9.9 reference player width",
)
hero_path.write_text(hero, encoding="utf-8")

bridge_kt_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/desktop/NativePlayerBridge.kt"
bridge_kt = bridge_kt_path.read_text(encoding="utf-8")
bridge_kt = replace_once(
    bridge_kt,
    '''    val controlsPageUrl: String by lazy { controlsPageAssets.url }
    private val controlsPageAssets: ControlsPageAssets by lazy { exportControlsPageAssets() }
''',
    '''    val controlsPageUrl: String by lazy { controlsPageAssets.url }
    val heroTrailerControlsPageUrl: String by lazy { heroTrailerControlsPageAssets.url }

    private val controlsPageAssets: ControlsPageAssets by lazy { exportControlsPageAssets() }
    private val heroTrailerControlsPageAssets: ControlsPageAssets by lazy {
        val html = """
            <!doctype html>
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                html, body {
                  width: 100%;
                  height: 100%;
                  margin: 0;
                  overflow: hidden;
                  background: transparent !important;
                  pointer-events: none;
                }
                #heroBlend {
                  position: fixed;
                  inset: 0;
                  pointer-events: none;
                  background:
                    linear-gradient(
                      90deg,
                      rgba(13,13,13,1.00) 0%,
                      rgba(13,13,13,0.98) 7%,
                      rgba(13,13,13,0.90) 13%,
                      rgba(13,13,13,0.72) 19%,
                      rgba(13,13,13,0.48) 25%,
                      rgba(13,13,13,0.24) 31%,
                      rgba(13,13,13,0.08) 37%,
                      rgba(13,13,13,0.00) 43%
                    ),
                    linear-gradient(
                      180deg,
                      rgba(13,13,13,0.08) 0%,
                      rgba(13,13,13,0.00) 14%,
                      rgba(13,13,13,0.00) 70%,
                      rgba(13,13,13,0.38) 87%,
                      rgba(13,13,13,0.92) 100%
                    );
                }
              </style>
            </head>
            <body><div id="heroBlend"></div></body>
            </html>
        """.trimIndent().toByteArray(Charsets.UTF_8)
        val heroRoot = DesktopCache.installVersionedFiles(
            "hero-player-ui",
            mapOf("hero.html" to html),
        ).toFile()
        ControlsPageAssets(url = heroRoot.resolve("hero.html").toURI().toASCIIString())
    }
''',
    "v9.9 native Hero overlay controls page",
)
bridge_kt_path.write_text(bridge_kt, encoding="utf-8")

native_controller_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/desktop/NativePlayerController.kt"
native_controller = native_controller_path.read_text(encoding="utf-8")
native_controller = replace_once(
    native_controller,
    '''    private val onCreateWaitCompleted: () -> Unit = {},
) : PlayerEngineController {
''',
    '''    private val onCreateWaitCompleted: () -> Unit = {},
    private val controlsPageUrl: String = NativePlayerBridge.controlsPageUrl,
) : PlayerEngineController {
''',
    "v9.9 configurable native controls page",
)
native_controller = replace_once(
    native_controller,
    '''                        NativePlayerBridge.controlsPageUrl,
''',
    '''                        controlsPageUrl,
''',
    "v9.9 use configured controls page",
)
native_controller_path.write_text(native_controller, encoding="utf-8")

windows_hero_player_path = root / "composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt"
win = windows_hero_player_path.read_text(encoding="utf-8")
win = replace_once(
    win,
    '''import com.nuvio.app.features.player.desktop.NativePlayerController
import com.nuvio.app.features.player.desktop.NativePlayerHost
''',
    '''import com.nuvio.app.features.player.desktop.NativePlayerBridge
import com.nuvio.app.features.player.desktop.NativePlayerController
import com.nuvio.app.features.player.desktop.NativePlayerHost
''',
    "v9.9 Hero bridge import",
)
win = replace_once(
    win,
    '''    val platformDensity = LocalNuvioPlatformDensity.current
    val host = remember { NativePlayerHost() }
    val controller = remember(host) { NativePlayerController(host) }
''',
    '''    val platformDensity = LocalNuvioPlatformDensity.current
    val host = remember { NativePlayerHost() }
    val controller = remember(host) {
        NativePlayerController(
            host = host,
            controlsPageUrl = NativePlayerBridge.heroTrailerControlsPageUrl,
        )
    }
''',
    "v9.9 Hero native gradient page",
)
win = replace_once(
    win,
    '''                modifier = if (hostFirstPaintComplete.value) {
                    Modifier.fillMaxSize()
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .requiredSize(1.dp)
                },
''',
    '''                modifier = if (readyReported.value) {
                    Modifier.fillMaxSize()
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .requiredSize(2.dp)
                },
''',
    "v9.9 keep native player tiny until first real frame",
)
windows_hero_player_path.write_text(win, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''    source.value?.let { playbackSource ->
        com.nuvio.app.features.details.components.HeroTrailerPlayerSurface(
''',
    '''    androidx.compose.material3.Surface(
        modifier = Modifier.fillMaxSize(),
        color = androidx.compose.ui.graphics.Color(0xFF0D0D0D),
    ) {
        androidx.compose.foundation.layout.Box(modifier = Modifier.fillMaxSize()) {
            source.value?.let { playbackSource ->
                com.nuvio.app.features.details.components.HeroTrailerPlayerSurface(
''',
    "v9.9 visual smoke Hero container",
)
main = replace_once(
    main,
    '''            modifier = Modifier.fillMaxSize(),
            onReady = {
                if (!terminal.value) {
                    readyObserved.value = true
                    mark("ready")
                }
            },
''',
    '''                    modifier = Modifier
                        .align(androidx.compose.ui.Alignment.CenterEnd)
                        .fillMaxWidth(0.58f)
                        .fillMaxHeight(),
                    onReady = {
                        if (!terminal.value) {
                            readyObserved.value = true
                            val screenshotPath =
                                System.getenv("NUVIO_HERO_TRAILER_SMOKE_SCREENSHOT")
                                    ?.takeIf { it.isNotBlank() }
                            if (screenshotPath == null) {
                                mark("ready")
                            } else {
                                Thread {
                                    runCatching {
                                        Thread.sleep(900L)
                                        val toolkit = java.awt.Toolkit.getDefaultToolkit()
                                        val screen = java.awt.Rectangle(toolkit.screenSize)
                                        val image = java.awt.Robot().createScreenCapture(screen)
                                        val file = java.io.File(screenshotPath)
                                        file.parentFile?.mkdirs()
                                        javax.imageio.ImageIO.write(image, "png", file)
                                    }
                                    mark("ready")
                                }.apply {
                                    isDaemon = true
                                    name = "nuvio-hero-visual-smoke"
                                    start()
                                }
                            }
                        }
                    },
''',
    "v9.9 visual smoke screenshot after ready",
)
main = replace_once(
    main,
    '''            onError = {
                terminal.value = true
                mark("error:player")
            },
        )
    }
}
''',
    '''                    onError = {
                        terminal.value = true
                        mark("error:player")
                    },
                )
            }
        }
    }
}
''',
    "v9.9 close visual smoke container",
)
main_path.write_text(main, encoding="utf-8")

print("Applied V9.9 native WebView2 Hero blend + 58% placement + visual smoke")


# V9.9.1: visual smoke harness layout imports.
main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''import androidx.compose.foundation.layout.fillMaxSize
''',
    '''import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
''',
    "v9.9.1 visual smoke layout imports",
)
main_path.write_text(main, encoding="utf-8")
print("Applied V9.9.1 visual smoke layout imports")


# V9.10: harden native Hero stacking with explicit CSS !important and keep native video out of the text column.
hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    '''                .fillMaxWidth(0.58f)
                .fillMaxHeight(),
''',
    '''                .fillMaxWidth(0.54f)
                .fillMaxHeight(),
''',
    "v9.10 keep native player clear of text column",
)
hero = replace_once(
    hero,
    '''                .padding(start = 34.dp, end = 28.dp, bottom = 34.dp)
                .widthIn(max = 570.dp),
''',
    '''                .padding(start = 34.dp, end = 28.dp, bottom = 34.dp)
                .fillMaxWidth(0.43f),
''',
    "v9.10 explicit top information layer width",
)
hero = replace_once(
    hero,
    '''                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 1.00f),
                            0.28f to backgroundColor.copy(alpha = 0.99f),
                            0.40f to backgroundColor.copy(alpha = 0.96f),
                            0.50f to backgroundColor.copy(alpha = 0.82f),
                            0.60f to backgroundColor.copy(alpha = 0.56f),
                            0.70f to backgroundColor.copy(alpha = 0.28f),
                            0.82f to backgroundColor.copy(alpha = 0.07f),
                            1f to Color.Transparent,
                        ),
                    ),
''',
    '''                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to backgroundColor.copy(alpha = 1.00f),
                            0.24f to backgroundColor.copy(alpha = 0.98f),
                            0.36f to backgroundColor.copy(alpha = 0.88f),
                            0.44f to backgroundColor.copy(alpha = 0.54f),
                            0.50f to backgroundColor.copy(alpha = 0.16f),
                            0.56f to Color.Transparent,
                            1f to Color.Transparent,
                        ),
                    ),
''',
    "v9.10 Compose backdrop-only blend",
)
hero_path.write_text(hero, encoding="utf-8")

bridge_kt_path = root / "composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/desktop/NativePlayerBridge.kt"
bridge_kt = bridge_kt_path.read_text(encoding="utf-8")
bridge_kt = replace_once(
    bridge_kt,
    '''                html, body {
                  width: 100%;
                  height: 100%;
                  margin: 0;
                  overflow: hidden;
                  background: transparent !important;
                  pointer-events: none;
                }
                #heroBlend {
                  position: fixed;
                  inset: 0;
                  pointer-events: none;
                  background:
''',
    '''                html,
                body {
                  position: fixed !important;
                  inset: 0 !important;
                  width: 100% !important;
                  height: 100% !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: hidden !important;
                  background: transparent !important;
                  pointer-events: none !important;
                  isolation: isolate !important;
                  z-index: 2147483640 !important;
                }

                body > * {
                  pointer-events: none !important;
                }

                #heroBlend {
                  display: block !important;
                  position: fixed !important;
                  inset: 0 !important;
                  width: 100% !important;
                  height: 100% !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  opacity: 1 !important;
                  visibility: visible !important;
                  pointer-events: none !important;
                  z-index: 2147483647 !important;
                  transform: translateZ(0) !important;
                  will-change: opacity !important;
                  background:
''',
    "v9.10 native CSS important stacking",
)
bridge_kt = replace_once(
    bridge_kt,
    '''                      rgba(13,13,13,1.00) 0%,
                      rgba(13,13,13,0.98) 7%,
                      rgba(13,13,13,0.90) 13%,
                      rgba(13,13,13,0.72) 19%,
                      rgba(13,13,13,0.48) 25%,
                      rgba(13,13,13,0.24) 31%,
                      rgba(13,13,13,0.08) 37%,
                      rgba(13,13,13,0.00) 43%
''',
    '''                      rgba(13,13,13,1.00) 0%,
                      rgba(13,13,13,0.99) 10%,
                      rgba(13,13,13,0.94) 18%,
                      rgba(13,13,13,0.82) 27%,
                      rgba(13,13,13,0.64) 36%,
                      rgba(13,13,13,0.42) 45%,
                      rgba(13,13,13,0.22) 54%,
                      rgba(13,13,13,0.08) 63%,
                      rgba(13,13,13,0.00) 72%
''',
    "v9.10 wider native left fade",
)
bridge_kt = replace_once(
    bridge_kt,
    '''                      rgba(13,13,13,0.08) 0%,
                      rgba(13,13,13,0.00) 14%,
                      rgba(13,13,13,0.00) 70%,
                      rgba(13,13,13,0.38) 87%,
                      rgba(13,13,13,0.92) 100%
''',
    '''                      rgba(13,13,13,0.10) 0%,
                      rgba(13,13,13,0.00) 16%,
                      rgba(13,13,13,0.00) 68%,
                      rgba(13,13,13,0.30) 82%,
                      rgba(13,13,13,0.66) 92%,
                      rgba(13,13,13,0.96) 100%
''',
    "v9.10 stronger native shelf blend",
)
bridge_kt_path.write_text(bridge_kt, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''                        .fillMaxWidth(0.58f)
                        .fillMaxHeight(),
''',
    '''                        .fillMaxWidth(0.54f)
                        .fillMaxHeight(),
''',
    "v9.10 visual smoke native width",
)
main_path.write_text(main, encoding="utf-8")

print("Applied V9.10 CSS !important stacking + non-overlapping text/player geometry")


# V9.11: native mpv Hero fade.
bridge_path = root / "composeApp/src/desktopMain/native/windows/player_bridge.cpp"
bridge = bridge_path.read_text(encoding="utf-8")

bridge = replace_once(
    bridge,
    '''    void startMpv(
        const std::string &sourceUrl,
        const std::vector<std::string> &headerLines,
        bool playWhenReady,
        long long initialPositionMs,
        int decoderPriority,
        bool nvidiaRtxSuperResolutionEnabled
    ) {
''',
    '''    void startMpv(
        const std::string &sourceUrl,
        const std::vector<std::string> &headerLines,
        bool playWhenReady,
        long long initialPositionMs,
        int decoderPriority,
        bool nvidiaRtxSuperResolutionEnabled,
        bool heroTrailerMode
    ) {
''',
    "v9.11 hero mode argument",
)

bridge = replace_once(
    bridge,
    '''            if (nvidiaRtxSuperResolutionEnabled) {
                setMpvOptionStringLocked("vf", "d3d11vpp=scale=2:scaling-mode=nvidia");
            }
''',
    '''            if (nvidiaRtxSuperResolutionEnabled) {
                setMpvOptionStringLocked("vf", "d3d11vpp=scale=2:scaling-mode=nvidia");
            } else if (heroTrailerMode) {
                setMpvOptionStringLocked(
                    "vf",
                    "lavfi=["
                    "drawbox=x=0:y=0:w=iw*0.045:h=ih:color=black@1.00:t=fill,"
                    "drawbox=x=iw*0.045:y=0:w=iw*0.045:h=ih:color=black@0.96:t=fill,"
                    "drawbox=x=iw*0.09:y=0:w=iw*0.045:h=ih:color=black@0.86:t=fill,"
                    "drawbox=x=iw*0.135:y=0:w=iw*0.045:h=ih:color=black@0.72:t=fill,"
                    "drawbox=x=iw*0.18:y=0:w=iw*0.045:h=ih:color=black@0.54:t=fill,"
                    "drawbox=x=iw*0.225:y=0:w=iw*0.045:h=ih:color=black@0.36:t=fill,"
                    "drawbox=x=iw*0.27:y=0:w=iw*0.045:h=ih:color=black@0.20:t=fill,"
                    "drawbox=x=iw*0.315:y=0:w=iw*0.045:h=ih:color=black@0.08:t=fill,"
                    "drawbox=x=0:y=ih*0.82:w=iw:h=ih*0.03:color=black@0.08:t=fill,"
                    "drawbox=x=0:y=ih*0.85:w=iw:h=ih*0.03:color=black@0.16:t=fill,"
                    "drawbox=x=0:y=ih*0.88:w=iw:h=ih*0.03:color=black@0.28:t=fill,"
                    "drawbox=x=0:y=ih*0.91:w=iw:h=ih*0.03:color=black@0.44:t=fill,"
                    "drawbox=x=0:y=ih*0.94:w=iw:h=ih*0.03:color=black@0.66:t=fill,"
                    "drawbox=x=0:y=ih*0.97:w=iw:h=ih*0.03:color=black@0.92:t=fill"
                    "]"
                );
            }
''',
    "v9.11 in-frame hero fade",
)

bridge = replace_once(
    bridge,
    '''        startWebView(controlsUrl);
        startMpv(sourceUrl, headerLines, playWhenReady, initialPositionMs, decoderPriority, nvidiaRtxSuperResolutionEnabled);
''',
    '''        const bool heroTrailerMode =
            controlsUrl.find("hero.html") != std::string::npos;
        startWebView(controlsUrl);
        startMpv(
            sourceUrl,
            headerLines,
            playWhenReady,
            initialPositionMs,
            decoderPriority,
            nvidiaRtxSuperResolutionEnabled,
            heroTrailerMode
        );
''',
    "v9.11 detect hero session",
)
bridge_path.write_text(bridge, encoding="utf-8")
print("Applied V9.11 native mpv Hero fade")


# V9.12: smooth per-pixel native Hero fade.
import re

bridge_path = root / "composeApp/src/desktopMain/native/windows/player_bridge.cpp"
bridge = bridge_path.read_text(encoding="utf-8")

hero_filter_pattern = re.compile(
    r'''            \} else if \(heroTrailerMode\) \{\n                setMpvOptionStringLocked\(\n                    "vf",\n                    "lavfi=\[".*?                    "\]"\n                \);\n            \}\n''',
    re.DOTALL,
)
hero_filter_replacement = r'''            } else if (heroTrailerMode) {
                // Continuous per-pixel blend: dark at the left edge, fully visible toward
                // the right, then smoothly darkened again into the shelf at the bottom.
                setMpvOptionStringLocked(
                    "vf",
                    "lavfi=[format=rgb24,"
                    "geq="
                    "r='r(X,Y)*pow(clip(X/(W*0.42),0,1),0.70)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))':"
                    "g='g(X,Y)*pow(clip(X/(W*0.42),0,1),0.70)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))':"
                    "b='b(X,Y)*pow(clip(X/(W*0.42),0,1),0.70)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))'"
                    "]"
                );
            }
'''
bridge, replacement_count = hero_filter_pattern.subn(hero_filter_replacement, bridge)
if replacement_count != 1:
    raise SystemExit(
        f"v9.12 smooth Hero native filter expected 1 replacement, found {replacement_count}"
    )

bridge_path.write_text(bridge, encoding="utf-8")
print("Applied V9.12 smooth per-pixel native Hero fade")


# V9.13: full black information bed under left UI while trailer is actually ready.
hover_trailer_path = root / "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomePosterHoverTrailer.kt"
hover_trailer = hover_trailer_path.read_text(encoding="utf-8")

hover_trailer = replace_once(
    hover_trailer,
    '''import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
''',
    '''import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
''',
    "v9.13 hover trailer disposal callback import",
)
hover_trailer = replace_once(
    hover_trailer,
    '''    startPositionSeconds: Int,
    modifier: Modifier = Modifier,
) {
''',
    '''    startPositionSeconds: Int,
    modifier: Modifier = Modifier,
    onPlaybackVisibilityChanged: ((Boolean) -> Unit)? = null,
) {
''',
    "v9.13 hover trailer visibility callback",
)
hover_trailer = replace_once(
    hover_trailer,
    '''    LaunchedEffect(trailerFinished, playbackSource) {
''',
    '''    LaunchedEffect(playbackSource?.videoUrl, playbackSource?.audioUrl) {
        onPlaybackVisibilityChanged?.invoke(false)
    }

    DisposableEffect(playbackSource?.videoUrl, playbackSource?.audioUrl) {
        onDispose {
            onPlaybackVisibilityChanged?.invoke(false)
        }
    }

    LaunchedEffect(trailerFinished, playbackSource) {
''',
    "v9.13 reset Hero black bed with player lifecycle",
)
hover_trailer = replace_once(
    hover_trailer,
    '''            onReady = {
                if (!trailerFinished) {
                    trailerReady = true
                }
            },
            onEnded = {
                trailerReady = false
                trailerFinished = true
            },
            onError = {
                trailerReady = false
                trailerFinished = true
            },
''',
    '''            onReady = {
                if (!trailerFinished) {
                    trailerReady = true
                    onPlaybackVisibilityChanged?.invoke(true)
                }
            },
            onEnded = {
                trailerReady = false
                trailerFinished = true
                onPlaybackVisibilityChanged?.invoke(false)
            },
            onError = {
                trailerReady = false
                trailerFinished = true
                onPlaybackVisibilityChanged?.invoke(false)
            },
''',
    "v9.13 report actual visible playback state",
)
hover_trailer_path.write_text(hover_trailer, encoding="utf-8")

hero = hero_path.read_text(encoding="utf-8")
hero = replace_once(
    hero,
    '''import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
''',
    '''import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
''',
    "v9.13 Hero z-index import",
)
hero = replace_once(
    hero,
    '''    var trailerPlaybackSource by remember(selectedItem.type, selectedItem.id) {
        mutableStateOf<TrailerPlaybackSource?>(null)
    }
''',
    '''    var trailerPlaybackSource by remember(selectedItem.type, selectedItem.id) {
        mutableStateOf<TrailerPlaybackSource?>(null)
    }
    var trailerVisuallyReady by remember(selectedItem.type, selectedItem.id) {
        mutableStateOf(false)
    }
''',
    "v9.13 Hero ready visual state",
)
hero = replace_once(
    hero,
    '''        trailerPlaybackSource = null
        if (!isHoverActive || !trailerPlaybackEnabled) return@LaunchedEffect
''',
    '''        trailerPlaybackSource = null
        trailerVisuallyReady = false
        if (!isHoverActive || !trailerPlaybackEnabled) return@LaunchedEffect
''',
    "v9.13 reset visual state before resolver",
)
hero = replace_once(
    hero,
    '''                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
''',
    '''                modifier = Modifier
                    .fillMaxSize()
                    .zIndex(10f),
                contentScale = ContentScale.Crop,
''',
    "v9.13 backdrop z-index",
)
hero = replace_once(
    hero,
    '''            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxWidth(0.54f)
                .fillMaxHeight(),
''',
    '''            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxWidth(0.54f)
                .fillMaxHeight()
                .zIndex(30f),
''',
    "v9.13 native video layer z-index contract",
)
hero = replace_once(
    hero,
    '''                    startPositionSeconds = posterCardStyle.hoverPreviewTrailerStartSeconds,
                    modifier = Modifier.fillMaxSize(),
                )
''',
    '''                    startPositionSeconds = posterCardStyle.hoverPreviewTrailerStartSeconds,
                    modifier = Modifier.fillMaxSize(),
                    onPlaybackVisibilityChanged = { isVisible ->
                        trailerVisuallyReady = isVisible
                    },
                )
''',
    "v9.13 wire actual player ready state to Hero",
)

# Keep the normal backdrop treatment below the UI.
hero = hero.replace(
    '''            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
''',
    '''            modifier = Modifier
                .fillMaxSize()
                .zIndex(15f)
                .background(
                    Brush.horizontalGradient(
''',
    1,
)
hero = hero.replace(
    '''            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
''',
    '''            modifier = Modifier
                .fillMaxSize()
                .zIndex(15f)
                .background(
                    Brush.verticalGradient(
''',
    1,
)

hero = replace_once(
    hero,
    '''        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
''',
    '''        CatalogHeroInformationBed(
            visible = trailerVisuallyReady,
            modifier = Modifier
                .align(Alignment.CenterStart)
                .fillMaxWidth(0.46f)
                .fillMaxHeight()
                .zIndex(20f),
        )

        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth(0.46f)
                .zIndex(50f)
''',
    "v9.13 black bed plus constrained top UI",
)
hero = replace_once(
    hero,
    '''            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 34.dp, end = 28.dp, bottom = 34.dp)
                .fillMaxWidth(0.43f),
''',
    '''            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 34.dp, end = 28.dp, bottom = 34.dp)
                .fillMaxWidth(0.43f)
                .zIndex(50f),
''',
    "v9.13 information content top layer",
)

hero += r'''

@Composable
internal fun CatalogHeroInformationBed(
    visible: Boolean,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(tween(220)),
        exit = fadeOut(tween(180)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to Color.Black,
                            0.72f to Color.Black,
                            0.90f to Color.Black.copy(alpha = 0.995f),
                            1f to Color.Black.copy(alpha = 0.985f),
                        ),
                    ),
                ),
        )
    }
}
'''
hero_path.write_text(hero, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''        androidx.compose.foundation.layout.Box(modifier = Modifier.fillMaxSize()) {
            source.value?.let { playbackSource ->
''',
    '''        androidx.compose.foundation.layout.Box(modifier = Modifier.fillMaxSize()) {
            androidx.compose.material3.Surface(
                modifier = Modifier.fillMaxSize(),
                color = androidx.compose.ui.graphics.Color(0xFF5B4036),
            ) {}

            com.nuvio.app.features.home.components.CatalogHeroInformationBed(
                visible = readyObserved.value,
                modifier = Modifier
                    .align(androidx.compose.ui.Alignment.CenterStart)
                    .fillMaxWidth(0.46f)
                    .fillMaxHeight(),
            )

            androidx.compose.material3.Text(
                text = "HERO INFORMATION",
                color = androidx.compose.ui.graphics.Color.White,
                modifier = Modifier.align(androidx.compose.ui.Alignment.CenterStart),
            )

            source.value?.let { playbackSource ->
''',
    "v9.13 visual smoke left information bed",
)
main_path.write_text(main, encoding="utf-8")

print("Applied V9.13 full black left information bed + explicit Hero layer order")


# V9.14: make the black information bed deterministic and non-animated.
hero = hero_path.read_text(encoding="utf-8")

hero = replace_once(
    hero,
    '''        CatalogHeroInformationBed(
            visible = trailerVisuallyReady,
''',
    '''        CatalogHeroInformationBed(
            visible = trailerPlaybackSource != null || trailerVisuallyReady,
''',
    "v9.14 black bed follows resolved trailer source",
)

hero = replace_once(
    hero,
    '''@Composable
internal fun CatalogHeroInformationBed(
    visible: Boolean,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = fadeIn(tween(220)),
        exit = fadeOut(tween(180)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0f to Color.Black,
                            0.72f to Color.Black,
                            0.90f to Color.Black.copy(alpha = 0.995f),
                            1f to Color.Black.copy(alpha = 0.985f),
                        ),
                    ),
                ),
        )
    }
}
''',
    '''@Composable
internal fun CatalogHeroInformationBed(
    visible: Boolean,
    modifier: Modifier = Modifier,
) {
    if (!visible) return
    Box(
        modifier = modifier
            .background(Color.Black),
    )
}
''',
    "v9.14 deterministic solid black information bed",
)
hero_path.write_text(hero, encoding="utf-8")

main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    '''            com.nuvio.app.features.home.components.CatalogHeroInformationBed(
                visible = readyObserved.value,
''',
    '''            com.nuvio.app.features.home.components.CatalogHeroInformationBed(
                visible = source.value != null,
''',
    "v9.14 deterministic visual smoke black bed",
)
main_path.write_text(main, encoding="utf-8")

print("Applied V9.14 deterministic solid black information bed")
