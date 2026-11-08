#!/usr/bin/env python3
"""Fix V10 regression: restore the actual Windows homepage Hero Trailer and
make its persisted preference visible/active. Run AFTER the V10 official patch.
Fail closed on upstream source changes. Does not touch Watch Party or V4 assets.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()

def change(path, before, after, context):
    p = root / path
    if not p.is_file():
        raise RuntimeError(f"Missing source {path}")
    code = p.read_text(encoding="utf-8")
    hits = code.count(before)
    if hits != 1:
        raise RuntimeError(f"{context}: expected 1 anchor, found {hits}")
    p.write_text(code.replace(before, after, 1), encoding="utf-8")

style = "composeApp/src/commonMain/kotlin/com/nuvio/app/core/ui/PosterCardStyleRepository.kt"
change(style,
       "package com.nuvio.app.core.ui\n\n",
       "package com.nuvio.app.core.ui\n\nimport com.nuvio.app.isWindows\n",
       "Windows-only trailer defaults")
change(style,
       "    val hoverPreviewTrailerEnabled: Boolean = false,\n    val hoverPreviewTrailerSoundEnabled: Boolean = false,\n",
       "    val hoverPreviewTrailerEnabled: Boolean = false,\n    val hoverPreviewTrailerConfigured: Boolean = false,\n    val hoverPreviewTrailerSoundEnabled: Boolean = false,\n    val hoverPreviewTrailerSoundConfigured: Boolean = false,\n",
       "persist explicit Windows trailer preferences")
change(style,
       "    val hoverPreviewTrailerEnabled: Boolean = false,\n    val hoverPreviewTrailerSoundEnabled: Boolean = false,\n",
       "    val hoverPreviewTrailerEnabled: Boolean = isWindows,\n    val hoverPreviewTrailerSoundEnabled: Boolean = isWindows,\n",
       "Windows video+sound on by default in UI state")
change(style,
       "    private var hasLoaded = false\n",
       "    private var hasLoaded = false\n    private var hoverPreviewTrailerConfigured = false\n    private var hoverPreviewTrailerSoundConfigured = false\n",
       "track explicit user opt-outs")
change(style,
       '''    fun clearLocalState() {
        hasLoaded = false
        _uiState.value = PosterCardStyleUiState()
    }''',
       '''    fun clearLocalState() {
        hasLoaded = false
        hoverPreviewTrailerConfigured = false
        hoverPreviewTrailerSoundConfigured = false
        _uiState.value = PosterCardStyleUiState()
    }''',
       "clear trailer state on profile switch")
change(style,
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
       "remember explicit video toggle")
change(style,
       '''    fun setHoverPreviewTrailerSoundEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerSoundEnabled == enabled) return
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerSoundEnabled = enabled)
        persist()
    }''',
       '''    fun setHoverPreviewTrailerSoundEnabled(enabled: Boolean) {
        ensureLoaded()
        if (_uiState.value.hoverPreviewTrailerSoundEnabled == enabled && hoverPreviewTrailerSoundConfigured) return
        hoverPreviewTrailerSoundConfigured = true
        _uiState.value = _uiState.value.copy(hoverPreviewTrailerSoundEnabled = enabled)
        persist()
    }''',
       "remember explicit sound toggle")
change(style,
       '''        if (payload.isEmpty()) {
            _uiState.value = PosterCardStyleUiState()
            return
        }''',
       '''        if (payload.isEmpty()) {
            hoverPreviewTrailerConfigured = false
            hoverPreviewTrailerSoundConfigured = false
            _uiState.value = PosterCardStyleUiState()
            return
        }''',
       "new profile default")
change(style,
       '''        val stored = runCatching {
            json.decodeFromString<StoredPosterCardStylePreferences>(payload)
        }.getOrNull()

        _uiState.value = if (stored != null) {''',
       '''        val stored = runCatching {
            json.decodeFromString<StoredPosterCardStylePreferences>(payload)
        }.getOrNull()
        hoverPreviewTrailerConfigured = stored?.hoverPreviewTrailerConfigured ?: false
        hoverPreviewTrailerSoundConfigured = stored?.hoverPreviewTrailerSoundConfigured ?: false

        _uiState.value = if (stored != null) {''',
       "read explicit settings")
change(style,
       '''                hoverPreviewTrailerEnabled = stored.hoverPreviewTrailerEnabled,
                hoverPreviewTrailerSoundEnabled = stored.hoverPreviewTrailerSoundEnabled,''',
       '''                hoverPreviewTrailerEnabled =
                    if (isWindows && !hoverPreviewTrailerConfigured) true
                    else stored.hoverPreviewTrailerEnabled,
                hoverPreviewTrailerSoundEnabled =
                    if (isWindows && !hoverPreviewTrailerSoundConfigured) true
                    else stored.hoverPreviewTrailerSoundEnabled,''',
       "migrate V10 defaults but respect V9 explicit choices")
change(style,
       '''                    hoverPreviewTrailerEnabled = _uiState.value.hoverPreviewTrailerEnabled,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,''',
       '''                    hoverPreviewTrailerEnabled = _uiState.value.hoverPreviewTrailerEnabled,
                    hoverPreviewTrailerConfigured = hoverPreviewTrailerConfigured,
                    hoverPreviewTrailerSoundEnabled = _uiState.value.hoverPreviewTrailerSoundEnabled,
                    hoverPreviewTrailerSoundConfigured = hoverPreviewTrailerSoundConfigured,''',
       "persist explicit toggles")

hero = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/HomeHeroSection.kt"
change(hero,
       "import com.nuvio.app.isDesktop\n",
       "import com.nuvio.app.isDesktop\nimport com.nuvio.app.core.build.AppFeaturePolicy\nimport com.nuvio.app.core.ui.rememberPosterCardStyleUiState\nimport com.nuvio.app.features.trailer.TrailerPlaybackSource\nimport kotlinx.coroutines.CancellationException\n",
       "homepage Hero reader imports")
change(hero,
       '''    val backgroundColor = colorScheme.background

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor),
    ) {''',
       '''    val backgroundColor = colorScheme.background
    val heroItem = currentHeroItem(items, pagerState)
    val trailerOptions = rememberPosterCardStyleUiState()
    val videoEnabled = AppFeaturePolicy.heroTrailerPlaybackSupported &&
        trailerOptions.hoverPreviewTrailerEnabled
    var heroTrailerSource by remember(heroItem.type, heroItem.id) {
        mutableStateOf<TrailerPlaybackSource?>(null)
    }

    LaunchedEffect(heroItem.type, heroItem.id, videoEnabled) {
        heroTrailerSource = null
        if (!videoEnabled) return@LaunchedEffect
        // Do not request a new video during a rapid carousel change.
        delay(850L)
        heroTrailerSource = try {
            resolveHomePosterHoverTrailerPlaybackSource(heroItem)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Throwable) {
            null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(backgroundColor),
    ) {''',
       "restore actual hero media loading in desktop home frame")
change(hero,
       '''            desktopFrame = true,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(layout.topFadeHeight)''',
       '''            desktopFrame = true,
        )

        // Windows native MPV panel is above the Compose backdrop: the native
        // WebView and MPV pixel filter add the gradient, not an opaque box.
        if (heroTrailerSource != null && videoEnabled) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxWidth(0.68f)
                    .fillMaxHeight(),
            ) {
                HomePosterHoverTrailer(
                    playbackSource = heroTrailerSource,
                    soundEnabled = trailerOptions.hoverPreviewTrailerSoundEnabled,
                    startPositionSeconds = trailerOptions.hoverPreviewTrailerStartSeconds,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(layout.topFadeHeight)''',
       "mount native player in the right side of homepage Hero")

# V10 kept a 2dp placeholder until the first FULL-SIZE paint, while it only
# attached the player AFTER the full-size paint: a startup deadlock.
native = "composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt"
change(native,
       '''                modifier = if (readyReported.value) {
                    Modifier.fillMaxSize()
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .requiredSize(2.dp)
                },
                background = Color.Black,''',
       '''                // The player must be mounted at real dimensions before
                // onFirstFullSizePaint fires; do not wait for onReady to size it.
                modifier = Modifier.fillMaxSize(),
                background = Color.Black,''',
       "fix Hero first-frame deadlock")

settings = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/settings/HoverPreviewSettingsPage.kt"
change(settings,
       '''    if (AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP) {''',
       '''    if (AppFeaturePolicy.heroTrailerPlaybackSupported ||
        AppFeaturePolicy.trailerPlaybackMode == TrailerPlaybackMode.IN_APP) {''',
       "show Hero Trailer toggle in desktop settings")

print("V10.1 fixed: homepage Hero Trailer mounted, Windows defaults migrated, player first-paint deadlock removed")
