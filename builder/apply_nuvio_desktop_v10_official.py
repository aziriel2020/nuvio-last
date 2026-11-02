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

print("V10 official Dev patch applied: native Windows Hero, gradients, official V4 and Watch Party intact")
