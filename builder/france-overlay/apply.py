#!/usr/bin/env python3
"""Apply the user's EXISTING France calendar-card design to ALL NuvioTV collections.

The pinned public NuvioTV source stays unchanged; only an isolated local clone
is patched. Compose draws the design at card paint time; posters are loaded
directly from original TMDB/TVDB URLs whenever an existing Oracle wrapper
exposes that source. No bitmap compositing and no API calls per image.
"""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("NuvioTV")
overlay = Path("builder/france-overlay/FranceCalendarCardOverlay.kt")
dest = root / "app/src/main/java/com/nuvio/tv/ui/components/FranceCalendarCardOverlay.kt"
if not overlay.exists():
    raise SystemExit("Missing France design source; abort isolated APK patch.")
dest.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(overlay, dest)

def replace(path, replacements):
    file = root / path
    source = file.read_text(encoding="utf-8")
    for old, new in replacements:
        count = source.count(old)
        if count != 1:
            raise SystemExit(f"{path}: expected one contract, saw {count}: {old[:125]!r}")
        source = source.replace(old, new, 1)
    file.write_text(source, encoding="utf-8")

replace("app/src/main/java/com/nuvio/tv/MainActivity.kt", [
    ("super.onCreate(savedInstanceState)\n        isFirstResumeAfterCreate",
     "super.onCreate(savedInstanceState)\n        com.nuvio.tv.ui.components.FranceOverlaySettings.initialize(this)\n        isFirstResumeAfterCreate")
])

replace("app/src/main/java/com/nuvio/tv/ui/screens/settings/LayoutSettingsScreen.kt", [
    ("import com.nuvio.tv.ui.theme.NuvioTheme",
     "import com.nuvio.tv.ui.theme.NuvioTheme\nimport com.nuvio.tv.ui.components.FranceOverlaySettings"),
    ('                        items(items = sections, key = { it.name }) { section ->',
     '''                        item(key = "france_design_global_toggle") {
                            SettingsToggleRow(
                                title = "Design France — toutes les collections",
                                subtitle = "Votre surcouche France d'origine, dessinée par la Shield. Images TMDB directes, badges, titres et dates ; sans images recompilées sur Oracle.",
                                checked = FranceOverlaySettings.enabled,
                                onToggle = { FranceOverlaySettings.toggle(context) }
                            )
                        }
                        items(items = sections, key = { it.name }) { section ->''')
])

replace("app/src/main/java/com/nuvio/tv/ui/components/GridContentCard.kt", [
    ("    val cardShape = remember(posterCardStyle.cornerRadius)",
     "    val franceOverlayEnabled = FranceOverlaySettings.enabled\n    val cardShape = remember(posterCardStyle.cornerRadius)"),
    ("                val effectiveImageUrl = if (globalLandscape) {\n                    effectiveLandscapePoster ?: item.background ?: item.poster\n                } else {\n                    item.poster\n                }",
     """                val effectiveImageUrl = FranceOverlayArtwork.image(
                    if (globalLandscape) {
                        effectiveLandscapePoster ?: item.background ?: item.poster
                    } else {
                        item.poster
                    },
                    effectivePosterShape == PosterShape.LANDSCAPE
                )"""),
    ("                val showLandscapeClearlogo = isLandscapeBackdropCard &&",
     "                val showLandscapeClearlogo = !franceOverlayEnabled && isLandscapeBackdropCard &&"),
    ("                } else if (showLogo && !item.logo.isNullOrBlank()) {",
     "                } else if (!franceOverlayEnabled && showLogo && !item.logo.isNullOrBlank()) {"),
    ("                if (isWatched) {\n                    WatchedMarker(",
     """                if (franceOverlayEnabled) {
                    FranceCalendarCardOverlay(
                        item = item,
                        landscape = effectivePosterShape == PosterShape.LANDSCAPE
                    )
                }
                if (isWatched) {
                    WatchedMarker("""),
    ("        if (showLabel && (!showLogo || item.logo.isNullOrBlank())) {",
     "        if (!franceOverlayEnabled && showLabel && (!showLogo || item.logo.isNullOrBlank())) {")
])

replace("app/src/main/java/com/nuvio/tv/ui/components/ContentCard.kt", [
    ("    val cardShape = remember(posterCardStyle.cornerRadius)",
     "    val franceOverlayEnabled = FranceOverlaySettings.enabled\n    val cardShape = remember(posterCardStyle.cornerRadius)"),
    ("        val imageUrl = if (globalLandscape) {\n            effectiveLandscapePoster ?: item.background ?: item.poster\n        } else if (useLandscapeAsExpanded) {\n            item.landscapePoster\n        } else if (effectiveExpandEnabled && isBackdropExpanded) {\n            item.backdropUrl ?: item.poster\n        } else {\n            item.poster\n        }",
     """        val imageUrl = FranceOverlayArtwork.image(
            if (globalLandscape) {
                effectiveLandscapePoster ?: item.background ?: item.poster
            } else if (useLandscapeAsExpanded) {
                item.landscapePoster
            } else if (effectiveExpandEnabled && isBackdropExpanded) {
                item.backdropUrl ?: item.poster
            } else {
                item.poster
            },
            effectivePosterShape == PosterShape.LANDSCAPE
        )"""),
    ("        val showExpandedLogo = !item.logo.isNullOrBlank() && !logoLoadFailed",
     "        val showExpandedLogo = !franceOverlayEnabled && !item.logo.isNullOrBlank() && !logoLoadFailed"),
    ("                val showLandscapeOverlay = globalLandscape &&",
     "                val showLandscapeOverlay = !franceOverlayEnabled && globalLandscape &&"),
    ("                if (isWatched) {\n                    WatchedMarker(",
     """                if (franceOverlayEnabled) {
                    FranceCalendarCardOverlay(
                        item = item,
                        landscape = effectivePosterShape == PosterShape.LANDSCAPE
                    )
                }
                if (isWatched) {
                    WatchedMarker("""),
    ("        if (showLabels) {\n            Box(modifier = Modifier.fillMaxWidth().clipToBounds().graphicsLayer {}) {",
     "        if (showLabels && !franceOverlayEnabled) {\n            Box(modifier = Modifier.fillMaxWidth().clipToBounds().graphicsLayer {}) {")
])

replace("app/src/main/java/com/nuvio/tv/ui/screens/home/ModernHomeRows.kt", [
    ("package com.nuvio.tv.ui.screens.home",
     "package com.nuvio.tv.ui.screens.home\n\nimport com.nuvio.tv.ui.components.FranceOverlaySettings\nimport com.nuvio.tv.ui.components.FranceOverlayArtwork\nimport com.nuvio.tv.ui.components.FranceCalendarCardOverlay"),
    ("    val cardShape = remember(cardCornerRadius)",
     "    val franceOverlayEnabled = FranceOverlaySettings.enabled\n    val cardShape = remember(cardCornerRadius)"),
    ("    val imageUrl = when {\n        payload == null -> baseImageUrl\n        !payload.focusGifEnabled -> baseImageUrl\n        else -> baseImageUrl\n    }",
     """    val imageUrl = FranceOverlayArtwork.image(
        baseImageUrl, useLandscapeOverlayTreatment && !isCollectionFolder
    )"""),
    ("    val hasLandscapeLogo =\n        (useLandscapeOverlayTreatment || isBackdropExpanded) &&",
     "    val hasLandscapeLogo =\n        !franceOverlayEnabled && (useLandscapeOverlayTreatment || isBackdropExpanded) &&"),
    ("                if (isWatched) {\n                    WatchedMarker(",
     """                if (franceOverlayEnabled && !isCollectionFolder) {
                    item.metaPreview?.let { preview ->
                        FranceCalendarCardOverlay(
                            item = preview,
                            landscape = useLandscapeOverlayTreatment
                        )
                    }
                }
                if (isWatched) {
                    WatchedMarker("""),
    ("        if (showLabels && !isBackdropExpanded && item.title.isNotBlank()) {",
     "        if (showLabels && (isCollectionFolder || !franceOverlayEnabled) && !isBackdropExpanded && item.title.isNotBlank()) {")
])

replace("app/build.gradle.kts", [
    ('''        debug {
            signingConfig = signingConfigs.getByName("release")
            isDebuggable = parseBooleanProperty(providers.gradleProperty("debuggable").orNull)''',
     '''        debug {
            signingConfig = signingConfigs.getByName("debug")
            applicationIdSuffix = ".franceoverlay"
            isDebuggable = true'''),
    ('buildConfigField("boolean", "FEATURE_IN_APP_UPDATES_ENABLED", "true")',
     'buildConfigField("boolean", "FEATURE_IN_APP_UPDATES_ENABLED", "false")')
])

print("OK: Original France design in all metadata cards, Modern / Classic / Grid layouts, global persistent toggle, direct-CDN unwrap, separate debug APK.")
