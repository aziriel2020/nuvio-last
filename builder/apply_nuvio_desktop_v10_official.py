#!/usr/bin/env python3
"""Patch current official NuvioDesktop Dev for Windows Hero Trailer without replacing
the official Watch Party implementation or the official native V4 cover pipeline.
Use only against the pinned, validated official commit in the V10 workflow.
This deliberately fails if upstream changes a targeted source contract.
"""
from pathlib import Path
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else ".").resolve()
def f(path):
    p=root/path
    if not p.is_file(): raise RuntimeError(f"Missing upstream source: {path}")
    return p
def replace_once(path, old, new, name):
    p=f(path)
    s=p.read_text(encoding="utf-8")
    count=s.count(old)
    if count!=1: raise RuntimeError(f"{name}: upstream changed (expected one match, found {count})")
    p.write_text(s.replace(old,new,1),encoding="utf-8")
def require(path,*tokens):
    s=f(path).read_text(encoding="utf-8")
    for token in tokens:
        if token not in s: raise RuntimeError(f"Missing source contract {token} in {path}")

# Preserve the official Dev Watch Party model, chat, desktop JS controls and backend
# availability checks. Copying the old V9 application would erase this functionality.
require("composeApp/src/commonMain/kotlin/com/nuvio/app/features/party/PartyRepository.kt",
        "fun join(code:", "fun create(media:", "server.capabilities.watchParty")
require("composeApp/src/commonMain/kotlin/com/nuvio/app/features/player/PlayerScreenRuntimeParty.kt",
        "PartyRepository", "partyBlocksControl")
require("composeApp/src/desktopMain/resources/player-ui/party.js", "party")
require("composeApp/src/commonMain/composeResources/values-fr/strings_party.xml", "party")
# V4: use the official desktop poster code: landscape art wins over backgrounds,
# explicit landscape setting, fallback to original images, logo preference.
require("composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomePosterCard.kt",
        "item.landscapePoster", "item.banner", "item.rawPosterUrl",
        "alwaysShowLandscapeClearlogo", "bottomLeftLogoUrl")
require("composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/PosterCardStyleRepository.kt",
        "catalogLandscapeModeEnabled", "alwaysShowLandscapeClearlogo")
require("composeApp/src/commonMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.kt",
        "HeroTrailerPlayerSurface")

# Enable the native Hero player and its settings on Windows.
policy="composeApp/src/desktopMain/kotlin/com/nuvio/app/core/build/AppFeaturePolicy.desktop.kt"
replace_once(policy,
'''    actual val trailerPlaybackMode: TrailerPlaybackMode =
        if (isWindowsDesktop) TrailerPlaybackMode.EXTERNAL else TrailerPlaybackMode.IN_APP
    actual val heroTrailerPlaybackSupported: Boolean = !isWindowsDesktop''',
'''    actual val trailerPlaybackMode: TrailerPlaybackMode = TrailerPlaybackMode.IN_APP
    actual val heroTrailerPlaybackSupported: Boolean = true''',
"Windows in-app trailer capability")

# Native Win32/libmpv player: use the previously working V9 lifecycle, not the
# upstream Windows stub. Never overwrite common player or party UI.
win=f("composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt")
require(str(win.relative_to(root)), ") = Unit")
win.write_text(r'''package com.nuvio.app.features.details.components

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
import com.nuvio.app.features.player.desktop.NativePlayerBridge
import com.nuvio.app.features.player.desktop.NativePlayerController
import com.nuvio.app.features.trailer.TrailerExtractionPlatform
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
    val controller = remember(host) {
        NativePlayerController(host = host, controlsPageUrl = NativePlayerBridge.heroTrailerControlsPageUrl)
    }
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
            sourceHeaders = TrailerExtractionPlatform.defaultHeaders,
            playWhenReady = playWhenReady,
            initialPositionMs = startPositionMillis.coerceAtLeast(0L),
            decoderPriority = 1,
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
                modifier = if (readyReported.value) {
                    Modifier.fillMaxSize()
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .requiredSize(2.dp)
                },
                background = Color.Black,
            )
        }
    }
}
''',encoding="utf-8")

# The Hero WebView overlay is on the correct native layer (above libmpv).
# A broad left-to-right fade, plus a separate bottom fade, avoids an opaque
# rectangular black information panel.
bridge="composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/desktop/NativePlayerBridge.kt"
replace_once(bridge,
'''    private val controlsPageAssets: ControlsPageAssets by lazy { exportControlsPageAssets() }''',
'''    val heroTrailerControlsPageUrl: String by lazy {
        val html = """
            <!doctype html><html><head><meta charset="utf-8">
            <style>
              html, body { margin:0; padding:0; width:100%; height:100%;
                background:transparent!important; overflow:hidden; pointer-events:none!important; }
              #heroBlend { position:fixed!important; inset:0!important;
                width:100%!important; height:100%!important; pointer-events:none!important;
                z-index:2147483647!important;
                background:
                  linear-gradient(90deg,
                    rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.94) 8%,
                    rgba(0,0,0,0.84) 19%, rgba(0,0,0,0.64) 31%,
                    rgba(0,0,0,0.40) 43%, rgba(0,0,0,0.18) 55%,
                    rgba(0,0,0,0.04) 65%, rgba(0,0,0,0) 73%),
                  linear-gradient(180deg,
                    rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 20%,
                    rgba(0,0,0,0) 68%, rgba(0,0,0,0.20) 82%,
                    rgba(0,0,0,0.56) 94%, rgba(0,0,0,0.90) 100%);
              }
            </style></head><body><div id="heroBlend"></div></body></html>
        """.trimIndent().toByteArray(Charsets.UTF_8)
        val dir = DesktopCache.installVersionedFiles(
            "hero-player-ui-v10", mapOf("hero.html" to html),
        ).toFile()
        dir.resolve("hero.html").toURI().toASCIIString()
    }
    private val controlsPageAssets: ControlsPageAssets by lazy { exportControlsPageAssets() }''',
"independent native Hero gradient overlay")

ctrl="composeApp/src/desktopMain/kotlin/com/nuvio/app/features/player/desktop/NativePlayerController.kt"
replace_once(ctrl,
'''    private val onCreateWaitCompleted: () -> Unit = {},
) : PlayerEngineController {''',
'''    private val onCreateWaitCompleted: () -> Unit = {},
    private val controlsPageUrl: String = NativePlayerBridge.controlsPageUrl,
) : PlayerEngineController {''',
"selectable native UI URL")
replace_once(ctrl,
'''                        NativePlayerBridge.controlsPageUrl,
                        pending.decoderPriority,''',
'''                        controlsPageUrl,
                        pending.decoderPriority,''',
"route Hero native UI URL")
replace_once(ctrl,
'''    private var currentVolumeLevel = rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()''',
'''    private var currentVolumeLevel = rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
    @Volatile private var heroMutedOverride = false''',
"separate native Hero muted state")
replace_once(ctrl,
'''    override fun pause() {
        log.d { "pause handle=$handle" }
        handle.takeIf { it != 0L }?.let { NativePlayerBridge.setPaused(it, true) }
    }''',
'''    override fun pause() {
        log.d { "pause handle=$handle" }
        handle.takeIf { it != 0L }?.let { NativePlayerBridge.setPaused(it, true) }
    }

    override fun setMuted(muted: Boolean) {
        heroMutedOverride = muted
        val level = if (muted) 0f else rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
        currentVolumeLevel = level
        handle.takeIf { it != 0L }?.let { NativePlayerBridge.setVolume(it, level) }
    }''',
"Windows native Hero sound control")
replace_once(ctrl,
'''        val level = rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
        currentVolumeLevel = level
        NativePlayerBridge.setVolume(current, level)''',
'''        val level = if (heroMutedOverride) 0f else rememberedVolumeLevel.coerceDesktopPlayerVolumeLevel()
        currentVolumeLevel = level
        NativePlayerBridge.setVolume(current, level)''',
"preserve sound setting during attach")

# Windows video fade is continuous per pixel, rather than the V9.11 black strips.
cpp="composeApp/src/desktopMain/native/windows/player_bridge.cpp"
replace_once(cpp,
'''        startWebView(controlsUrl);
        startMpv(sourceUrl, headerLines, playWhenReady, initialPositionMs, decoderPriority, nvidiaRtxSuperResolutionEnabled);''',
'''        const bool heroTrailerMode = controlsUrl.find("hero.html") != std::string::npos;
        startWebView(controlsUrl);
        startMpv(sourceUrl, headerLines, playWhenReady, initialPositionMs, decoderPriority, nvidiaRtxSuperResolutionEnabled, heroTrailerMode);''',
"native Hero recognition")
replace_once(cpp,
'''        int decoderPriority,
        bool nvidiaRtxSuperResolutionEnabled
    ) {
        MpvApi &api = mpvApi();''',
'''        int decoderPriority,
        bool nvidiaRtxSuperResolutionEnabled,
        bool heroTrailerMode
    ) {
        MpvApi &api = mpvApi();''',
"Win32 video filter signature")
replace_once(cpp,
'''            if (nvidiaRtxSuperResolutionEnabled) {
                setMpvOptionStringLocked("vf", "d3d11vpp=scale=2:scaling-mode=nvidia");
            }
            setMpvOptionStringLocked("target-colorspace-hint", "yes");''',
'''            if (nvidiaRtxSuperResolutionEnabled) {
                setMpvOptionStringLocked("vf", "d3d11vpp=scale=2:scaling-mode=nvidia");
            } else if (heroTrailerMode) {
                // Continuous video brightness fade at the left seam and lower edge.
                setMpvOptionStringLocked("vf",
                    "lavfi=[format=rgb24,geq="
                    "r='r(X,Y)*pow(clip(X/(W*0.45),0,1),0.95)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))':"
                    "g='g(X,Y)*pow(clip(X/(W*0.45),0,1),0.95)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))':"
                    "b='b(X,Y)*pow(clip(X/(W*0.45),0,1),0.95)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))'"
                    "]");
            }
            setMpvOptionStringLocked("target-colorspace-hint", "yes");''',
"native per-pixel trailer fade")

# Windows mpv Hero cannot combine two separate streams by itself.
# Prefer a reachable progressive combined track; fall back to video only.
extract="composeApp/src/desktopMain/kotlin/com/nuvio/app/features/trailer/TrailerExtractionPlatform.desktop.kt"
replace_once(extract,
'''        val useSeparatedStreams = separatedVideoUrl != null && separatedAudioUrl != null
        val combinedCandidateUrl = if (!useSeparatedStreams) {
            combinedUrl?.let { resolveReachableUrlOrNull(it) }
        } else {
            null
        }''',
'''        val windowsHeroSource = System.getProperty("os.name")
            ?.startsWith("Windows", ignoreCase = true) == true
        val useSeparatedStreams = !windowsHeroSource &&
            separatedVideoUrl != null && separatedAudioUrl != null
        val combinedCandidateUrl = combinedUrl?.let { resolveReachableUrlOrNull(it) }''',
"Windows combined trailer stream priority")


# The official Dev tabbed folder grid still hard-codes portrait cards. Align it
# with the official V4 landscape/card/logo logic already used in home and catalogs,
# keeping the mobile presentation unchanged.
folder="composeApp/src/commonMain/kotlin/com/nuvio/app/features/collection/FolderDetailScreen.kt"
replace_once(folder,
'''import com.nuvio.app.core.ui.catalogPosterBaseWidthDp
''',
'''import com.nuvio.app.core.ui.catalogPosterBaseWidthDp
import com.nuvio.app.core.ui.landscapePosterWidth
''',
"folder desktop landscape width import")
replace_once(folder,
'''import com.nuvio.app.features.home.components.HomeCatalogRowSection
''',
'''import com.nuvio.app.features.home.components.HomeCatalogRowSection
import com.nuvio.app.features.home.components.HomePosterCard
''',
"folder desktop V4 poster import")
replace_once(folder,
'''            val gridCells = if (isDesktop) {
                GridCells.FixedSize(basePosterWidthDp.dp)
            } else {
                GridCells.Fixed(columns)
            }''',
'''            val gridCells = if (isDesktop) {
                GridCells.FixedSize(
                    if (posterCardStyle.catalogLandscapeModeEnabled)
                        landscapePosterWidth(basePosterWidthDp)
                    else basePosterWidthDp.dp
                )
            } else {
                GridCells.Fixed(columns)
            }''',
"folder V4 landscape grid columns")
replace_once(folder,
'''                                HomePosterHoverPreview(
                                    item = item,
                                    isWatched = isWatched,
                                    onClick = { onPosterClick(item) },
                                    onLongClick = null,
                                ) { cardModifier ->
                                    NuvioPosterCard(
                                        title = item.name,
                                        imageUrl = item.poster,
                                        modifier = cardModifier,
                                        basePosterWidthDp = if (isDesktop) basePosterWidthDp else null,
                                        fallbackImageUrl = item.rawPosterUrl,
                                        shape = NuvioPosterShape.Poster,
                                        detailLine = item.releaseInfo,
                                        isWatched = isWatched,
                                        onClick = { onPosterClick(item) },
                                    )
                                }''',
'''                                if (isDesktop) {
                                    HomePosterCard(
                                        item = item,
                                        isWatched = isWatched,
                                        useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                        onClick = { onPosterClick(item) },
                                    )
                                } else {
                                    HomePosterHoverPreview(
                                        item = item,
                                        isWatched = isWatched,
                                        onClick = { onPosterClick(item) },
                                        onLongClick = null,
                                    ) { cardModifier ->
                                        NuvioPosterCard(
                                            title = item.name,
                                            imageUrl = item.poster,
                                            modifier = cardModifier,
                                            basePosterWidthDp = null,
                                            fallbackImageUrl = item.rawPosterUrl,
                                            shape = NuvioPosterShape.Poster,
                                            detailLine = item.releaseInfo,
                                            isWatched = isWatched,
                                            onClick = { onPosterClick(item) },
                                        )
                                    }
                                }''',
"V4 custom landscape covers in desktop folder grids")


# Preserve the custom V9 cinematic Catalog Hero on official Dev. The recent
# official app has poster hover previews but no full-width CatalogHoverHero.
catalog_hero=f("composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/CatalogHoverHero.kt") if (
    root/"composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/CatalogHoverHero.kt").is_file() else (
    root/"composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/CatalogHoverHero.kt")
catalog_hero.parent.mkdir(parents=True,exist_ok=True)
catalog_hero.write_text(r'''package com.nuvio.app.features.home.components

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
import androidx.compose.ui.zIndex
import com.nuvio.app.core.build.AppFeaturePolicy
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
        AppFeaturePolicy.heroTrailerPlaybackSupported &&
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
                .fillMaxWidth(0.54f)
                .fillMaxHeight()
                .zIndex(30f),
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
                .fillMaxWidth(0.46f)
                .zIndex(50f)
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
                .fillMaxWidth(0.43f)
                .zIndex(50f),
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
''',encoding="utf-8")

# Extend the official V4 card without changing its image precedence/logo logic:
# desktop catalog hover selects the large Hero instead of opening the small preview.
poster="composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomePosterCard.kt"
replace_once(poster,
'''import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier''',
'''import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.onPointerEvent''',
"hover-aware V4 poster imports")
replace_once(poster,
'''@Composable
fun HomePosterCard(''',
'''@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun HomePosterCard(''',
"poster pointer event opt-in")
replace_once(poster,
'''    showLandscapeOverlay: Boolean = true,
) {
    val posterCardStyle = rememberPosterCardStyleUiState()''',
'''    showLandscapeOverlay: Boolean = true,
    useHoverPreview: Boolean = true,
    onHoverChanged: ((Boolean) -> Unit)? = null,
) {
    val posterCardStyle = rememberPosterCardStyleUiState()''',
"desktop hover routing")
replace_once(poster,
'''    HomePosterHoverPreview(
        item = item,
        isWatched = isWatched,
        onClick = onClick,
        onLongClick = onLongClick,
    ) { hoverModifier ->
        NuvioPosterCard(''',
'''    val card: @Composable (Modifier) -> Unit = { hoverModifier ->
        NuvioPosterCard(''',
"reusable original V4 poster card")
replace_once(poster,
'''            modifier = modifier.then(hoverModifier),
            fallbackImageUrl = fallbackImageUrl,''',
'''            modifier = modifier.then(hoverModifier)
                .onPointerEvent(PointerEventType.Enter) { onHoverChanged?.invoke(true) }
                .onPointerEvent(PointerEventType.Exit) { onHoverChanged?.invoke(false) },
            fallbackImageUrl = fallbackImageUrl,''',
"hover event on V4 poster")
replace_once(poster,
'''        )
    }
}

private fun PosterShape.toNuvioPosterShape''',
'''        )
    }
    if (useHoverPreview) {
        HomePosterHoverPreview(
            item = item,
            isWatched = isWatched,
            onClick = onClick,
            onLongClick = onLongClick,
            content = card,
        )
    } else {
        card(Modifier)
    }
}

private fun PosterShape.toNuvioPosterShape''',
"desktop hero reuses official poster V4")

catalog="composeApp/src/commonMain/kotlin/com/nuvio/app/features/catalog/CatalogScreen.kt"
replace_once(catalog,
'''import com.nuvio.app.features.home.components.HomeEmptyStateCard
''',
'''import com.nuvio.app.features.home.components.CatalogHoverHero
import com.nuvio.app.features.home.components.HomeEmptyStateCard
''',
"catalog Hero import")
replace_once(catalog,
'''import org.jetbrains.compose.resources.stringResource

@Composable''',
'''import org.jetbrains.compose.resources.stringResource

private val CatalogCoverHeroHeight = 430.dp

@Composable''',
"catalog hero height")
replace_once(catalog,
'''    var headerHeightPx by remember { mutableIntStateOf(0) }
    var observedOfflineState by remember { mutableStateOf(false) }''',
'''    var headerHeightPx by remember { mutableIntStateOf(0) }
    var observedOfflineState by remember { mutableStateOf(false) }
    var hoveredHeroItem by remember(target) { mutableStateOf<MetaPreview?>(null) }''',
"catalog Hero hover state")
replace_once(catalog,
'''        val basePosterWidthDp = catalogPosterBaseWidthDp(posterCardStyle.widthDp)''',
'''        val basePosterWidthDp = catalogPosterBaseWidthDp(posterCardStyle.widthDp)
        val headerHeightDp = with(androidx.compose.ui.platform.LocalDensity.current) { headerHeightPx.toDp() }
        val showDesktopHero = isDesktop && uiState.items.isNotEmpty()''',
"catalog hero grid layout")
replace_once(catalog,
'''                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = pageHorizontalPadding,
                    top = with(androidx.compose.ui.platform.LocalDensity.current) { headerHeightPx.toDp() } + 12.dp,''',
'''                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = if (showDesktopHero) CatalogCoverHeroHeight + 18.dp else 0.dp),
                contentPadding = PaddingValues(
                    start = pageHorizontalPadding,
                    top = if (showDesktopHero) 0.dp else headerHeightDp + 12.dp,''',
"catalog hero above posters")
replace_once(catalog,
'''                            HomePosterCard(
                                item = item,
                                useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                isWatched = isWatched,''',
'''                            HomePosterCard(
                                item = item,
                                useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                useHoverPreview = false,
                                onHoverChanged = { hovering ->
                                    if (hovering) hoveredHeroItem = item
                                    else if (hoveredHeroItem?.stableKey() == item.stableKey()) hoveredHeroItem = null
                                },
                                isWatched = isWatched,''',
"catalog poster to large Hero")
replace_once(catalog,
'''            CatalogHeader(
                title = title,
                subtitle = subtitle,
                pageHorizontalPadding = pageHorizontalPadding,
                modifier = Modifier.onSizeChanged { headerHeightPx = it.height },
                onBack = onBack,
            )
''',
'''            if (showDesktopHero) {
                CatalogHoverHero(
                    selectedItem = hoveredHeroItem ?: uiState.items.first(),
                    isHoverActive = hoveredHeroItem != null,
                    pageTitle = title,
                    pageSubtitle = subtitle,
                    onBack = onBack,
                    showBack = !LocalUseNativeNavigation.current,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(horizontal = 10.dp, vertical = 10.dp)
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
"preserve full-width catalog Hero trailer")

print("V10 official Dev patch applied: native Windows Hero, gradients, official V4 and Watch Party intact")


# V10.1: the official Windows MSI built successfully but lacked an active Home
# Hero Trailer and a configured V4 native Custom Posters URL. The earlier
# source-only checks did not exercise either integration. Keep the official
# player, Party and catalog wiring above; this is an additive desktop patch.

# 1. Enable V4 in the existing native Custom Posters mechanism. This is an
# artwork URL template, NOT a Stremio addon / manifest, and never JPEG renders.
# Preserve manual user patterns and explicit per-profile disable across restarts.
custom="composeApp/src/commonMain/kotlin/com/nuvio/app/core/poster/CustomPosterUrlRepository.kt"
replace_once(custom,
'''package com.nuvio.app.core.poster

''',
'''package com.nuvio.app.core.poster

import com.nuvio.app.isWindows
''',
"Desktop Windows V4 import")
replace_once(custom,
'''import kotlinx.coroutines.flow.asStateFlow

object CustomPosterUrlRepository''',
'''import kotlinx.coroutines.flow.asStateFlow

private const val NUVIO_DESKTOP_V4_ARTWORK_PATTERN =
    "https://141-145-215-202.nip.io/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details"
private const val NUVIO_DESKTOP_POSTER_DISABLED = "nuvio:custom-posters-disabled"

object CustomPosterUrlRepository''',
"Desktop native V4 artwork URL below imports")
replace_once(custom,
'''        val trimmed = pattern.trim()
        if (_pattern.value == trimmed) return
        _pattern.value = trimmed
        CustomPosterUrlStorage.savePattern(trimmed.ifBlank { null })''',
'''        val trimmed = pattern.trim()
        if (trimmed.isBlank()) {
            clearPattern()
            return
        }
        if (_pattern.value == trimmed) return
        _pattern.value = trimmed
        CustomPosterUrlStorage.savePattern(trimmed)''',
"V4 preference explicit custom pattern")
replace_once(custom,
'''        CustomPosterUrlStorage.savePattern(null)
        com.nuvio.app.features.home.HomeRepository.applyCurrentSettings()
    }

    fun patternForScreen''',
'''        CustomPosterUrlStorage.savePattern(if (isWindows) NUVIO_DESKTOP_POSTER_DISABLED else null)
        com.nuvio.app.features.home.HomeRepository.applyCurrentSettings()
    }

    fun patternForScreen''',
"V4 preference durable disable")
replace_once(custom,
'''        _pattern.value = CustomPosterUrlStorage.loadPattern().orEmpty().trim()
        _enabledScreens.value = CustomPosterScreen.fromKeys(CustomPosterUrlStorage.loadEnabledScreens())''',
'''        val storedPattern = CustomPosterUrlStorage.loadPattern()
        _pattern.value = when {
            storedPattern == NUVIO_DESKTOP_POSTER_DISABLED -> ""
            storedPattern == null && isWindows -> NUVIO_DESKTOP_V4_ARTWORK_PATTERN
            else -> storedPattern.orEmpty().trim()
        }
        _enabledScreens.value = CustomPosterScreen.fromKeys(CustomPosterUrlStorage.loadEnabledScreens())''',
"V4 artwork loaded automatically for Windows profiles")

# 2. Migrate the older official desktop preferences that default to OFF.
# Existing opt-outs remain authoritative after a user toggles a control.
style="composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/PosterCardStyleRepository.kt"
replace_once(style,
'''package com.nuvio.app.core.ui

''',
'''package com.nuvio.app.core.ui

import com.nuvio.app.isWindows

''',
"desktop Windows preference resolution")
replace_once(style,
'''@Serializable
private data class StoredPosterCardStylePreferences(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,''',
'''@Serializable
private data class StoredPosterCardStylePreferences(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,
    val catalogLandscapeModeConfigured: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,''',
"V4 stored explicit landscape preference")
replace_once(style,
'''    val catalogLandscapeModeConfigured: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,
    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,''',
'''    val catalogLandscapeModeConfigured: Boolean = false,
    val hideLabelsEnabled: Boolean = false,
    val hoverPreviewEnabled: Boolean = true,
    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = false,
    val hoverPreviewTrailerConfigured: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,''',
"Hero stored explicit trailer preference")
replace_once(style,
'''    val alwaysShowLandscapeClearlogo: Boolean = false,
    val animatedArtworkMode: String = AnimatedArtworkMode.Always.name,''',
'''    val alwaysShowLandscapeClearlogo: Boolean = false,
    val alwaysShowLandscapeClearlogoConfigured: Boolean = false,
    val animatedArtworkMode: String = AnimatedArtworkMode.Always.name,''',
"V4 stored explicit logo preference")

# The first occurrences above are in the stored DTO, while these changes use
# the UI DTO and require a unique nearby anchor.
replace_once(style,
'''data class PosterCardStyleUiState(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = false,''',
'''data class PosterCardStyleUiState(
    val widthDp: Int = DefaultPosterCardWidthDp,
    val heightDp: Int = DefaultPosterCardHeightDp,
    val cornerRadiusDp: Int = DefaultPosterCardCornerRadiusDp,
    val catalogLandscapeModeEnabled: Boolean = isWindows,''',
"V4 enabled for Windows fresh profiles")
replace_once(style,
'''    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = false,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,''',
'''    val hoverPreviewOpenDelayMillis: Int = DefaultHoverPreviewOpenDelayMillis,
    val hoverPreviewTrailerEnabled: Boolean = isWindows,
    val hoverPreviewTrailerSoundEnabled: Boolean = false,''',
"Hero enabled for Windows fresh profiles")
replace_once(style,
'''    val alwaysShowLandscapeClearlogo: Boolean = false,
    val animatedArtworkMode: AnimatedArtworkMode = AnimatedArtworkMode.Always,''',
'''    val alwaysShowLandscapeClearlogo: Boolean = isWindows,
    val animatedArtworkMode: AnimatedArtworkMode = AnimatedArtworkMode.Always,''',
"V4 native logos for Windows fresh profiles")
replace_once(style,
'''    private var hasLoaded = false

    fun ensureLoaded()''',
'''    private var hasLoaded = false
    private var catalogLandscapeModeConfigured = false
    private var hoverPreviewTrailerConfigured = false
    private var alwaysShowLandscapeClearlogoConfigured = false

    fun ensureLoaded()''',
"per-profile explicit preference state")
replace_once(style,
'''        hasLoaded = false
        _uiState.value = PosterCardStyleUiState()
    }''',
'''        hasLoaded = false
        catalogLandscapeModeConfigured = false
        hoverPreviewTrailerConfigured = false
        alwaysShowLandscapeClearlogoConfigured = false
        _uiState.value = PosterCardStyleUiState()
    }''',
"clear cached explicit preference state")
replace_once(style,
'''    fun setCatalogLandscapeModeEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.catalogLandscapeModeEnabled == enabled) return
        _uiState.value = _uiState.value.copy(catalogLandscapeModeEnabled = enabled)
        persist()
    }''',
'''    fun setCatalogLandscapeModeEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.catalogLandscapeModeEnabled == enabled && catalogLandscapeModeConfigured) return
        catalogLandscapeModeConfigured = true
        _uiState.value = _uiState.value.copy(catalogLandscapeModeEnabled = enabled)
        persist()
    }''',
"respect Windows V4 landscape opt out")
replace_once(style,
'''    fun setHoverPreviewTrailerEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerEnabled == enabled) return
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerEnabled = enabled)
        persist()
    }''',
'''    fun setHoverPreviewTrailerEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerEnabled == enabled && hoverPreviewTrailerConfigured) return
        hoverPreviewTrailerConfigured = true
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerEnabled = enabled)
        persist()
    }''',
"respect Windows Hero opt out")
replace_once(style,
'''    fun setAlwaysShowLandscapeClearlogo(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.alwaysShowLandscapeClearlogo == enabled) return
        _uiState.value = _uiState.value.copy(alwaysShowLandscapeClearlogo = enabled)
        persist()
    }''',
'''    fun setAlwaysShowLandscapeClearlogo(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.alwaysShowLandscapeClearlogo == enabled && alwaysShowLandscapeClearlogoConfigured) return
        alwaysShowLandscapeClearlogoConfigured = true
        _uiState.value = _uiState.value.copy(alwaysShowLandscapeClearlogo = enabled)
        persist()
    }''',
"respect Windows V4 logo opt out")
replace_once(style,
'''        val stored = runCatching {
            json.decodeFromString<StoredPosterCardStylePreferences>(payload)
        }.getOrNull()

        _uiState.value = if (stored != null) {''',
'''        val stored = runCatching {
            json.decodeFromString<StoredPosterCardStylePreferences>(payload)
        }.getOrNull()
        catalogLandscapeModeConfigured = stored?.catalogLandscapeModeConfigured ?: false
        hoverPreviewTrailerConfigured = stored?.hoverPreviewTrailerConfigured ?: false
        alwaysShowLandscapeClearlogoConfigured = stored?.alwaysShowLandscapeClearlogoConfigured ?: false

        _uiState.value = if (stored != null) {''',
"load explicit stored flags")
replace_once(style,
'''                catalogLandscapeModeEnabled = stored.catalogLandscapeModeEnabled,
                hideLabelsEnabled = stored.hideLabelsEnabled,''',
'''                catalogLandscapeModeEnabled =
                    if (isWindows && !catalogLandscapeModeConfigured) true
                    else stored.catalogLandscapeModeEnabled,
                hideLabelsEnabled = stored.hideLabelsEnabled,''',
"V4 legacy Windows profiles landscape migration")
replace_once(style,
'''                hoverPreviewTrailerEnabled = stored.hoverPreviewTrailerEnabled,
                hoverPreviewTrailerSoundEnabled = stored.hoverPreviewTrailerSoundEnabled,''',
'''                hoverPreviewTrailerEnabled =
                    if (isWindows && !hoverPreviewTrailerConfigured) true
                    else stored.hoverPreviewTrailerEnabled,
                hoverPreviewTrailerSoundEnabled = stored.hoverPreviewTrailerSoundEnabled,''',
"Hero legacy Windows profiles migration")
replace_once(style,
'''                alwaysShowLandscapeClearlogo = stored.alwaysShowLandscapeClearlogo,
                animatedArtworkMode = AnimatedArtworkMode.entries''',
'''                alwaysShowLandscapeClearlogo =
                    if (isWindows && !alwaysShowLandscapeClearlogoConfigured) true
                    else stored.alwaysShowLandscapeClearlogo,
                animatedArtworkMode = AnimatedArtworkMode.entries''',
"V4 legacy Windows logos migration")
replace_once(style,
'''                    catalogLandscapeModeEnabled = _uiState.value.catalogLandscapeModeEnabled,
                    hideLabelsEnabled = _uiState.value.hideLabelsEnabled,''',
'''                    catalogLandscapeModeEnabled = _uiState.value.catalogLandscapeModeEnabled,
                    catalogLandscapeModeConfigured = catalogLandscapeModeConfigured,
                    hideLabelsEnabled = _uiState.value.hideLabelsEnabled,''',
"persist explicit landscape setting")
replace_once(style,
'''                    hoverPreviewTrailerEnabled = _uiState.value.hoverPreviewTrailerEnabled,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,''',
'''                    hoverPreviewTrailerEnabled = _uiState.value.hoverPreviewTrailerEnabled,
                    hoverPreviewTrailerConfigured = hoverPreviewTrailerConfigured,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,''',
"persist explicit Hero setting")
replace_once(style,
'''                    alwaysShowLandscapeClearlogo = _uiState.value.alwaysShowLandscapeClearlogo,
                    animatedArtworkMode = _uiState.value.animatedArtworkMode.name,''',
'''                    alwaysShowLandscapeClearlogo = _uiState.value.alwaysShowLandscapeClearlogo,
                    alwaysShowLandscapeClearlogoConfigured = alwaysShowLandscapeClearlogoConfigured,
                    animatedArtworkMode = _uiState.value.animatedArtworkMode.name,''',
"persist explicit V4 logo setting")

# 3. Connect the fullscreen Home Hero banner to the EXISTING Windows native
# playback Surface, with a poster fallback and the approved left/bottom blends.
home="composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomeHeroSection.kt"
replace_once(home,
'''import com.nuvio.app.core.ui.NuvioTokens
''',
'''import com.nuvio.app.core.ui.NuvioTokens
import com.nuvio.app.core.build.AppFeaturePolicy
import com.nuvio.app.isWindows
import com.nuvio.app.core.ui.rememberPosterCardStyleUiState
import com.nuvio.app.features.trailer.TrailerPlaybackSource
import kotlinx.coroutines.CancellationException
''',
"home Hero source and settings imports")
replace_once(home,
'''    val backgroundColor = colorScheme.background

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor),
    ) {
        HeroBackgroundLayers(''',
'''    val backgroundColor = colorScheme.background
    val heroStyle = rememberPosterCardStyleUiState()
    val heroItem = currentHeroItem(items, pagerState)
    val homeTrailerEnabled = isWindows &&
        AppFeaturePolicy.heroTrailerPlaybackSupported &&
        heroStyle.hoverPreviewTrailerEnabled
    var homeTrailerSource by remember(heroItem.type, heroItem.id) {
        mutableStateOf<TrailerPlaybackSource?>(null)
    }
    LaunchedEffect(heroItem.type, heroItem.id, homeTrailerEnabled) {
        homeTrailerSource = null
        if (!homeTrailerEnabled) return@LaunchedEffect
        delay(heroStyle.hoverPreviewOpenDelayMillis.toLong())
        homeTrailerSource = try {
            resolveHomePosterHoverTrailerPlaybackSource(heroItem)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor),
    ) {
        HeroBackgroundLayers(''',
"connect native trailer with Home Hero selected item")
replace_once(home,
'''            includePagerNeighbors = includePagerNeighbors,
            desktopFrame = true,
        )

        Box(''',
'''            includePagerNeighbors = includePagerNeighbors,
            desktopFrame = true,
        )

        // Keep the cinematic poster visible until native playback reports
        // the first frame. The player covers ONLY the right-hand background.
        if (homeTrailerEnabled && homeTrailerSource != null) {
            HomePosterHoverTrailer(
                playbackSource = homeTrailerSource,
                soundEnabled = heroStyle.hoverPreviewTrailerSoundEnabled,
                startPositionSeconds = heroStyle.hoverPreviewTrailerStartSeconds,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxWidth(0.68f)
                    .fillMaxHeight(),
            )
        }

        Box(''',
"render native Hero Trailer inside Home Hero background")

# 4. The catalog hero previously only loaded a video while hovering a card,
# so its default selected item was never playing. Use the selected item even
# without hover and preserve the existing hover switch when scrolling.
replace_once(
    "composeApp/src/commonMain/kotlin/com/nuvio/app/features/catalog/CatalogScreen.kt",
'''                    isHoverActive = hoveredHeroItem != null,
                    pageTitle = title,''',
'''                    isHoverActive = true,
                    pageTitle = title,''',
"start catalog Hero Trailer for default featured item"
)

# 5. Build-time assertions catch the regression even when Kotlin compiles.
require(home, "HomePosterHoverTrailer(", "homeTrailerEnabled", "resolveHomePosterHoverTrailerPlaybackSource")
require(custom, "oracle-vector-v4-film-details", "NUVIO_DESKTOP_V4_ARTWORK_PATTERN")
require(style, "hoverPreviewTrailerConfigured", "catalogLandscapeModeConfigured")
print("V10.1: native Home/Catalog Hero and original Oracle V4 poster link connected for Windows MSI")


# V10.2 — missing collection/folder Hero was a real integration bug.
# The previous V10.1 only rendered CatalogHoverHero inside CatalogScreen,
# not the FolderDetailScreen used by the user's collection catalogs.
# Restore the full width fixed Hero ABOVE tabbed and row layouts, and reuse
# the original V4 cards without introducing duplicate thumbnail video players.
replace_once(folder,
'''import com.nuvio.app.features.home.components.HomeCatalogRowSection
import com.nuvio.app.features.home.components.HomePosterCard
''',
'''import com.nuvio.app.features.home.components.CatalogHoverHero
import com.nuvio.app.features.home.components.HomeCatalogRowSection
import com.nuvio.app.features.home.components.HomePosterCard
''',
"folder full Hero component import")

replace_once(folder,
'''import androidx.compose.runtime.mutableFloatStateOf
''',
'''import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
''',
"folder Hero state import")

replace_once(folder,
'''private val FolderCoverHeight = 176.dp
''',
'''private val FolderCoverHeight = 176.dp
private val DesktopFolderHeroHeight = 430.dp
''',
"desktop full Hero sizing")

replace_once(folder,
'''    val coverImageUrl = folder?.coverImageUrl?.takeIf { it.isNotBlank() }
''',
'''    val coverImageUrl = folder?.coverImageUrl?.takeIf { it.isNotBlank() }
    var hoveredHeroItem by remember(
        folder?.id, uiState.viewMode, uiState.selectedTabIndex,
    ) { mutableStateOf<MetaPreview?>(null) }
''',
"folder selected featured card per profile, view and tab")

replace_once(folder,
'''            Column(modifier = Modifier.fillMaxSize()) {
                if (!useNativeNavigation) {
                    NuvioScreenHeader(''',
'''            Column(modifier = Modifier.fillMaxSize()) {
                // These ARE the catalog screens opened inside Collections.
                // Show the full cinematic Hero in every desktop view mode.
                val featuredHeroItem = when (uiState.viewMode) {
                    FolderViewMode.TABBED_GRID ->
                        uiState.tabs.getOrNull(uiState.selectedTabIndex)?.items?.firstOrNull()
                    FolderViewMode.ROWS,
                    FolderViewMode.FOLLOW_LAYOUT ->
                        FolderDetailRepository.getCatalogSectionsForRows()
                            .firstOrNull { it.items.isNotEmpty() }
                            ?.items?.firstOrNull()
                }
                if (featuredHeroItem != null) {
                    CatalogHoverHero(
                        selectedItem = hoveredHeroItem ?: featuredHeroItem,
                        isHoverActive = true,
                        pageTitle = folder?.title ?: uiState.collectionTitle,
                        onBack = onBack,
                        showBack = !useNativeNavigation,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(DesktopFolderHeroHeight)
                            .padding(
                                start = desktopPagePadding,
                                end = desktopPagePadding,
                                top = 10.dp,
                                bottom = 8.dp,
                            ),
                    )
                } else if (!useNativeNavigation) {
                    NuvioScreenHeader(''',
"mount full desktop Hero above every collection catalog instead of portrait-only header")

replace_once(folder,
'''                        onTabSelected = { FolderDetailRepository.selectTab(it) },
                        onPosterClick = onPosterClick,
                    )
                    FolderViewMode.ROWS -> RowsContent(''',
'''                        onTabSelected = { FolderDetailRepository.selectTab(it) },
                        onPosterClick = onPosterClick,
                        onPosterHoverChanged = { item, hovering ->
                            if (hovering) hoveredHeroItem = item
                            else if (hoveredHeroItem?.stableKey() == item.stableKey())
                                hoveredHeroItem = null
                        },
                    )
                    FolderViewMode.ROWS -> RowsContent(''',
"desktop folder tabbed posters switch full Hero on hover")

replace_once(folder,
'''                    FolderViewMode.ROWS -> RowsContent(
                        uiState = uiState,
                        watchedKeys = watchedUiState.watchedKeys,
                        modifier = Modifier.weight(1f),
                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                    )
                    FolderViewMode.FOLLOW_LAYOUT -> RowsContent(''',
'''                    FolderViewMode.ROWS -> RowsContent(
                        uiState = uiState,
                        watchedKeys = watchedUiState.watchedKeys,
                        modifier = Modifier.weight(1f),
                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                        onPosterHoverChanged = { item, hovering ->
                            if (hovering) hoveredHeroItem = item
                            else if (hoveredHeroItem?.stableKey() == item.stableKey())
                                hoveredHeroItem = null
                        },
                    )
                    FolderViewMode.FOLLOW_LAYOUT -> RowsContent(''',
"desktop folder row posters switch full Hero on hover")

replace_once(folder,
'''                    FolderViewMode.FOLLOW_LAYOUT -> RowsContent(
                        uiState = uiState,
                        watchedKeys = watchedUiState.watchedKeys,
                        modifier = Modifier.weight(1f),
                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                    )
                }
''',
'''                    FolderViewMode.FOLLOW_LAYOUT -> RowsContent(
                        uiState = uiState,
                        watchedKeys = watchedUiState.watchedKeys,
                        modifier = Modifier.weight(1f),
                        onCatalogClick = onCatalogClick,
                        onPosterClick = onPosterClick,
                        onPosterHoverChanged = { item, hovering ->
                            if (hovering) hoveredHeroItem = item
                            else if (hoveredHeroItem?.stableKey() == item.stableKey())
                                hoveredHeroItem = null
                        },
                    )
                }
''',
"desktop folder follow-layout posters switch full Hero on hover")

replace_once(folder,
'''    onTabSelected: (Int) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
) {
    val gridState = rememberLazyGridState()''',
'''    onTabSelected: (Int) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
    val gridState = rememberLazyGridState()''',
"folder grid optional hover callback without affecting mobile")

replace_once(folder,
'''                                        useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                        onClick = { onPosterClick(item) },
                                    )''',
'''                                        useLandscapeBackdropMode = posterCardStyle.catalogLandscapeModeEnabled,
                                        useHoverPreview = onPosterHoverChanged == null,
                                        onHoverChanged = { hovering ->
                                            onPosterHoverChanged?.invoke(item, hovering)
                                        },
                                        onClick = { onPosterClick(item) },
                                    )''',
"folder grid's V4 cover selects cinematic Hero")

replace_once(folder,
'''private fun RowsContent(
    uiState: FolderDetailUiState,
    watchedKeys: Set<String>,
    modifier: Modifier = Modifier,
    onCatalogClick: (HomeCatalogSection) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
) {''',
'''private fun RowsContent(
    uiState: FolderDetailUiState,
    watchedKeys: Set<String>,
    modifier: Modifier = Modifier,
    onCatalogClick: (HomeCatalogSection) -> Unit,
    onPosterClick: (MetaPreview) -> Unit,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {''',
"optional folder row Hero callback")

replace_once(folder,
'''                    watchedKeys = watchedKeys,
                    onPosterClick = { onPosterClick(it) },
                )
''',
'''                    watchedKeys = watchedKeys,
                    onPosterClick = { onPosterClick(it) },
                    onPosterHoverChanged = onPosterHoverChanged,
                )
''',
"pass folder hover into row section")

# Reuse the native V4 HomePosterCard in horizontal rows. No special image
# conversion, plugin change or alternate card implementation.
rowsection = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomeCatalogSection.kt"
replace_once(rowsection,
'''    onPosterLongClick: ((MetaPreview) -> Unit)? = null,
) {
    if (sectionPadding != null) {''',
'''    onPosterLongClick: ((MetaPreview) -> Unit)? = null,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)? = null,
) {
    if (sectionPadding != null) {''',
"row section public optional Hero callback")

# This specific argument occurs in both public section invocations, so use a
# unique one-time replacement that contains both neighboring branches.
row_file = f(rowsection)
row_src = row_file.read_text(encoding="utf-8")
public_start = row_src.index("fun HomeCatalogRowSection(")
private_start = row_src.index("private fun HomeCatalogRowSectionContent(")
public_region = row_src[public_start:private_start]
needle = '''            onPosterLongClick = onPosterLongClick,
'''
if public_region.count(needle) != 2:
    raise RuntimeError("V10.2 row public invocations changed")
public_region = public_region.replace(
    needle,
    '''            onPosterLongClick = onPosterLongClick,
            onPosterHoverChanged = onPosterHoverChanged,
''')
row_src = row_src[:public_start] + public_region + row_src[private_start:]
row_file.write_text(row_src, encoding="utf-8")

replace_once(rowsection,
'''    onPosterLongClick: ((MetaPreview) -> Unit)?,
) {
    val posterCardStyle''',
'''    onPosterLongClick: ((MetaPreview) -> Unit)?,
    onPosterHoverChanged: ((MetaPreview, Boolean) -> Unit)?,
) {
    val posterCardStyle''',
"internal row content hover callback")

replace_once(rowsection,
'''            onLongClick = onPosterLongClick?.let { { it(item) } },
        )
''',
'''            onLongClick = onPosterLongClick?.let { { it(item) } },
            useHoverPreview = onPosterHoverChanged == null,
            onHoverChanged = { hovering ->
                onPosterHoverChanged?.invoke(item, hovering)
            },
        )
''',
"row V4 covers update active full Hero instead of small preview")

# Never validate this installer's UI presence by Kotlin success alone.
require(folder,
    "DesktopFolderHeroHeight",
    "CatalogHoverHero(",
    "selectedItem = hoveredHeroItem ?: featuredHeroItem",
    "FolderViewMode.TABBED_GRID",
    "FolderViewMode.FOLLOW_LAYOUT",
    "onPosterHoverChanged =")
require(rowsection, "onPosterHoverChanged = onPosterHoverChanged",
    "useHoverPreview = onPosterHoverChanged == null")
require(catalog, "CatalogHoverHero(", "isHoverActive = true")
print("V10.2: CatalogScreen + FolderDetailScreen (grid/rows/follow) now mount native Hero block")


# V10.3 — the native V4 link existed in settings but did not affect the images:
#  (1) old Windows profiles could store disabled Custom Posters/screens;
#  (2) "Always show landscape clearlogo" nulled item.landscapePoster.
# Migrate each Windows profile ONCE and use V4 artwork regardless of the
# clearlogo setting, while preserving later manual edits and safe fallback.

storage = "composeApp/src/desktopMain/kotlin/com/nuvio/app/core/poster/CustomPosterUrlStorage.desktop.kt"
replace_once(storage,
'''    actual fun loadPattern(): String? =
        store.getString(ProfileScopedKey.of("custom_poster_url_pattern"))''',
'''    // One-time profile-scoped Windows migration: intentionally upgrade even
    // previously disabled or legacy custom artwork to the approved Oracle V4.
    // Explicit user edits AFTER the migration are kept and not overwritten.
    private fun seedApprovedV4Once() {
        if (!com.nuvio.app.isWindows) return
        val migratedKey = ProfileScopedKey.of("oracle_design_v4_seeded_windows_20261102")
        if (store.getString(migratedKey) == "yes") return
        store.putString(
            ProfileScopedKey.of("custom_poster_url_pattern"),
            "https://141-145-215-202.nip.io/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details",
        )
        store.putStringSet(
            ProfileScopedKey.of("custom_poster_enabled_screens"),
            CustomPosterScreen.toKeys(CustomPosterScreen.ALL),
        )
        store.putString(migratedKey, "yes")
    }

    actual fun loadPattern(): String? {
        seedApprovedV4Once()
        return store.getString(ProfileScopedKey.of("custom_poster_url_pattern"))
    }''',
"migrate existing Windows profiles to active custom V4 artwork")

replace_once(storage,
'''    actual fun loadEnabledScreens(): Set<String>? =
        store.getStringSet(ProfileScopedKey.of("custom_poster_enabled_screens"))''',
'''    actual fun loadEnabledScreens(): Set<String>? {
        seedApprovedV4Once()
        return store.getStringSet(ProfileScopedKey.of("custom_poster_enabled_screens"))
    }''',
"enable V4 across Home, Collections, Library, Search and Details for Windows")

# Correct V4 precedence in the original reusable HomePosterCard: "logo always"
# is for a logo overlay on provider photography, NOT for replacing custom
# artwork that already embeds title/logo/rating in the V4 landscape SVG.
replace_once(poster,
'''import com.nuvio.app.features.home.PosterShape

@OptIn(ExperimentalComposeUiApi::class)''',
'''import com.nuvio.app.features.home.PosterShape
import com.nuvio.app.isWindows

@OptIn(ExperimentalComposeUiApi::class)''',
"Windows V4 artwork card import")

replace_once(poster,
'''    val effectiveLandscapePoster = if (posterCardStyle.alwaysShowLandscapeClearlogo) null else item.landscapePoster
    val imageUrl = if (isLandscapeMode) {''',
'''    val approvedV4Artwork = isWindows &&
        item.landscapePoster?.contains("/design-meta/art/") == true
    val effectiveLandscapePoster =
        if (approvedV4Artwork || !posterCardStyle.alwaysShowLandscapeClearlogo)
            item.landscapePoster
        else null
    val imageUrl = if (isLandscapeMode) {''',
"never suppress approved V4 image with logo overlay setting")

require(storage, "seedApprovedV4Once", "oracle_design_v4_seeded_windows_20261102", "CustomPosterScreen.ALL")
require(poster, "approvedV4Artwork", "effectiveLandscapePoster", "item.landscapePoster")
print("V10.3: Oracle V4 SVG is applied to actual cards on existing Windows profiles; Hero from V10.2 preserved")
