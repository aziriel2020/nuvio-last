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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
private val CatalogHeroCornerRadius = 18.dp

@Composable
internal fun CatalogHoverHero(
    selectedItem: MetaPreview,
    isHoverActive: Boolean,
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
                            0f to backgroundColor,
                            0.22f to backgroundColor.copy(alpha = 0.98f),
                            0.44f to backgroundColor.copy(alpha = 0.80f),
                            0.67f to backgroundColor.copy(alpha = 0.22f),
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
                            0f to Color.Transparent,
                            0.62f to Color.Transparent,
                            1f to backgroundColor.copy(alpha = 0.94f),
                        ),
                    ),
                ),
        )

        Column(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .padding(start = 40.dp, end = 28.dp, top = 26.dp, bottom = 30.dp)
                .widthIn(max = 560.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            if (!logo.isNullOrBlank()) {
                AsyncImage(
                    model = logo,
                    contentDescription = title,
                    modifier = Modifier
                        .fillMaxWidth(0.68f)
                        .height(96.dp),
                    contentScale = ContentScale.Fit,
                    alignment = Alignment.CenterStart,
                )
            } else {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineLarge.copy(
                        fontWeight = FontWeight.ExtraBold,
                    ),
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (primaryMeta.isNotBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = primaryMeta,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.90f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (genres.isNotEmpty()) {
                Spacer(modifier = Modifier.height(9.dp))
                Text(
                    text = genres.take(4).joinToString("  •  "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.76f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (!description.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(14.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.93f),
                    maxLines = 4,
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
catalog = replace_once(
    catalog,
    "private val ",
    "private val ",
    "catalog noop guard",
) if False else catalog

catalog = catalog.replace(
    "import org.jetbrains.compose.resources.stringResource\n\n@Composable\n",
    "import org.jetbrains.compose.resources.stringResource\n\nprivate val CatalogFixedHeroHeight = 340.dp\n\n@Composable\n",
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
    "catalog fixed dimensions",
)
catalog = replace_once(
    catalog,
    "                modifier = Modifier.fillMaxSize(),\n                contentPadding = PaddingValues(\n                    start = pageHorizontalPadding,\n                    top = with(androidx.compose.ui.platform.LocalDensity.current) { headerHeightPx.toDp() } + 12.dp,\n",
    "                modifier = Modifier\n                    .fillMaxSize()\n                    .padding(\n                        top = if (isDesktop) {\n                            headerHeightDp + if (showDesktopHero) CatalogFixedHeroHeight + 20.dp else 12.dp\n                        } else {\n                            0.dp\n                        },\n                    ),\n                contentPadding = PaddingValues(\n                    start = pageHorizontalPadding,\n                    top = if (isDesktop) 0.dp else headerHeightDp + 12.dp,\n",
    "catalog grid viewport",
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
''',
    '''            NuvioDesktopVerticalScrollbar(
                state = gridState,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .padding(
                        top = if (isDesktop) {
                            headerHeightDp + if (showDesktopHero) CatalogFixedHeroHeight + 20.dp else 12.dp
                        } else {
                            8.dp
                        },
                        bottom = 8.dp,
                        start = 4.dp,
                        end = 4.dp,
                    ),
            )

            if (showDesktopHero) {
                CatalogHoverHero(
                    selectedItem = hoveredHeroItem ?: uiState.items.first(),
                    isHoverActive = hoveredHeroItem != null,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(
                            start = pageHorizontalPadding,
                            end = pageHorizontalPadding,
                            top = headerHeightDp + 8.dp,
                        )
                        .fillMaxWidth()
                        .height(CatalogFixedHeroHeight),
                )
            }

            CatalogHeader(
''',
    "catalog fixed hero overlay",
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
    "private val FolderCoverHeight = 176.dp\nprivate val FolderFixedCatalogHeroHeight = 340.dp\n",
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
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(FolderFixedCatalogHeroHeight)
                            .padding(horizontal = desktopPagePadding, vertical = 6.dp),
                    )
                }

                when (uiState.viewMode) {
                    FolderViewMode.TABBED_GRID -> TabbedGridContent(
''',
    "folder fixed hero",
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

print("Applied fixed NuvioTV-style catalog hero v2 patch to", root)
