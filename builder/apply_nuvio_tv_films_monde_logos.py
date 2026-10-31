#!/usr/bin/env python3
"""Apply an isolated, reversible Films Monde title-logo overlay to NuvioTV.

Targets a pinned public NuvioTV source revision in a CI checkout. A separate
debug application ID is used so official NuvioTV is never overwritten.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("NuvioTV")
card = root / "app/src/main/java/com/nuvio/tv/ui/components/GridContentCard.kt"
gradle = root / "app/build.gradle.kts"
source = card.read_text(encoding="utf-8")

def replace_once(old, new):
    global source
    if source.count(old) != 1:
        raise SystemExit(f"GridContentCard source contract changed ({source.count(old)} matches): {old[:95]}")
    source = source.replace(old, new, 1)

replace_once(
    """                val showLandscapeClearlogo = isLandscapeBackdropCard &&
                    !item.logo.isNullOrBlank()
                if (showLandscapeClearlogo) {""",
    """                // Films Monde supplies original transparent TMDB title logos.
                // Draw atop direct-CDN landscape art on the device: ZERO Oracle
                // image composition, no logo baked into poster bitmaps.
                val isFilmsMondeNativeCard = item.sourceAddonBaseUrl
                    ?.contains("/movies", ignoreCase = true) == true &&
                    effectivePosterShape == PosterShape.LANDSCAPE &&
                    !item.logo.isNullOrBlank()
                val showLandscapeClearlogo = isLandscapeBackdropCard &&
                    !item.logo.isNullOrBlank() && !isFilmsMondeNativeCard
                if (isFilmsMondeNativeCard) {
                    var movieLogoFailed by remember(item.logo) { mutableStateOf(false) }
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .drawWithCache {
                                val shade = Brush.verticalGradient(
                                    0.0f to Color.Transparent,
                                    0.52f to Color.Transparent,
                                    1.0f to Color.Black.copy(alpha = 0.78f)
                                )
                                onDrawBehind { drawRect(shade) }
                            }
                    )
                    if (!movieLogoFailed) {
                        val movieLogoRequest = remember(item.logo) {
                            ImageRequest.Builder(context)
                                .data(item.logo)
                                .crossfade(false)
                                .build()
                        }
                        AsyncImage(
                            model = movieLogoRequest,
                            contentDescription = item.name,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth(0.76f)
                                .fillMaxHeight(0.34f)
                                .padding(bottom = NuvioTheme.spacing.sm),
                            contentScale = ContentScale.Fit,
                            alignment = Alignment.Center,
                            onError = { movieLogoFailed = true }
                        )
                    } else if (!showLabel) {
                        Text(
                            text = item.name,
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(horizontal = NuvioTheme.spacing.md, vertical = NuvioTheme.spacing.sm)
                        )
                    }
                } else if (showLandscapeClearlogo) {"""
)
card.write_text(source, encoding="utf-8")

build = gradle.read_text(encoding="utf-8")
def replace_build(old, new):
    global build
    if build.count(old) != 1:
        raise SystemExit(f"Gradle contract changed ({build.count(old)}): {old[:90]}")
    build = build.replace(old, new, 1)
replace_build(
    """        create("full") {
            dimension = "distribution" """.rstrip(),
    """        create("full") {
            dimension = "distribution" """
)
# Keep this test app isolated from Nuvio production on the Shield.
replace_build(
    """        debug {
            signingConfig = signingConfigs.getByName("release")
            isDebuggable = parseBooleanProperty(providers.gradleProperty("debuggable").orNull)""",
    """        debug {
            signingConfig = signingConfigs.getByName("debug")
            applicationIdSuffix = ".filmsmonde.logos"
            isDebuggable = true"""
)
# Prevent the stock updater from replacing this deliberately isolated demo.
replace_build(
    'buildConfigField("boolean", "FEATURE_IN_APP_UPDATES_ENABLED", "true")',
    'buildConfigField("boolean", "FEATURE_IN_APP_UPDATES_ENABLED", "false")'
)
gradle.write_text(build, encoding="utf-8")
print("NuvioTV Films Monde native clearlogo card overlay installed in isolated debug app.")
