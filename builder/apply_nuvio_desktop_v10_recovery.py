#!/usr/bin/env python3
"""Conservative Windows V10 MSI recovery patch, applied after the official V10 patch."""
from pathlib import Path
import re
import sys

V3 = "https://141-145-215-202.nip.io/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v3"
V4 = "https://141-145-215-202.nip.io/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details"
WIN = "composeApp/src/windowsDesktopMain/kotlin/com/nuvio/app/features/details/components/HeroTrailerPlayerSurface.desktop.kt"
HERO = "composeApp/src/commonMain/kotlin/com/nuvio/app/features/home/components/CatalogHoverHero.kt"
CUSTOM = "composeApp/src/commonMain/kotlin/com/nuvio/app/core/poster/CustomPosterUrlRepository.kt"
STORAGE = "composeApp/src/desktopMain/kotlin/com/nuvio/app/core/poster/CustomPosterUrlStorage.desktop.kt"
BRIDGE = "composeApp/src/desktopMain/native/windows/player_bridge.cpp"

def once(data, before, after, label):
    count = data.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one exact match; found {count}")
    return data.replace(before, after, 1)

def patch(root):
    files = (WIN, HERO, CUSTOM, STORAGE, BRIDGE)
    sources = {key: (root / key).read_text(encoding="utf-8") for key in files}
    sources[WIN] = once(sources[WIN], '''                modifier = if (readyReported.value) {
                    Modifier.fillMaxSize()
                } else {
                    Modifier
                        .align(Alignment.BottomEnd)
                        .requiredSize(2.dp)
                },
                background = Color.Black,''',
        '''                // Mount native host full-size before first frame callback.
                modifier = Modifier.fillMaxSize(),
                background = Color.Black,''', "Native 2x2-pixel trailer deadlock")
    if "hostReady.value" not in sources[WIN] or "onFirstFullSizePaint" not in sources[WIN]:
        raise RuntimeError("Trailer lifecycle contract changed")
    sources[HERO] = once(sources[HERO], '''    val backdrop = originalTmdbImageUrl(
        meta?.background?.takeIf { it.isNotBlank() }
            ?: selectedItem.banner
            ?: selectedItem.poster,
    )''',
        '''    // Honor the profile's Custom Posters URL before original TMDB imagery.
    val backdrop = selectedItem.landscapePoster?.takeIf { it.isNotBlank() }
        ?: originalTmdbImageUrl(
            meta?.background?.takeIf { it.isNotBlank() }
                ?: selectedItem.banner
                ?: selectedItem.poster,
        )''', "Hero Custom Posters precedence")
    default = "NUVIO_DESKTOP_V4_ARTWORK_PATTERN"
    if sources[CUSTOM].count(default) != 2 or sources[CUSTOM].count(V4) != 1:
        raise RuntimeError("Unexpected default artwork contract")
    sources[CUSTOM] = sources[CUSTOM].replace(default, "NUVIO_DESKTOP_V3_ARTWORK_PATTERN").replace(V4, V3, 1)
    migration = re.compile(r"    private fun seedApprovedV4Once\(\) \{\n.*?\n    \}\n\n    actual fun loadPattern", re.DOTALL)
    old = sources[STORAGE]
    new = '''    private fun seedPreferredV3Once() {
        if (!com.nuvio.app.isWindows) return
        val migratedKey = ProfileScopedKey.of("oracle_vector_v3_recovery_windows_20261104")
        if (store.getString(migratedKey) == "yes") return
        val patternKey = ProfileScopedKey.of("custom_poster_url_pattern")
        val screensKey = ProfileScopedKey.of("custom_poster_enabled_screens")
        val previous = store.getString(patternKey)
        val oldAutomaticV4 = "''' + V4 + '''"
        // Preserve manual V3, third-party URLs and disabled flags.
        if (previous == null || previous == oldAutomaticV4) {
            store.putString(patternKey, "''' + V3 + '''")
        }
        if (store.getStringSet(screensKey) == null) {
            store.putStringSet(screensKey, CustomPosterScreen.toKeys(CustomPosterScreen.ALL))
        }
        store.putString(migratedKey, "yes")
    }

    actual fun loadPattern'''
    migrated, n = migration.subn(lambda _: new, old)
    if n != 1 or migrated.count("seedApprovedV4Once()") != 2:
        raise RuntimeError("Custom Poster migration changed")
    sources[STORAGE] = migrated.replace("seedApprovedV4Once()", "seedPreferredV3Once()")
    # Restore native mpv's light rendering pipeline as on working earlier MSI,
    # instead of costly per-pixel FFmpeg geq filtering on every video frame.
    old_filter = '''            } else if (heroTrailerMode) {
                // Continuous video brightness fade at the left seam and lower edge.
                setMpvOptionStringLocked("vf",
                    "lavfi=[format=rgb24,geq="
                    "r='r(X,Y)*pow(clip(X/(W*0.45),0,1),0.95)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))':"
                    "g='g(X,Y)*pow(clip(X/(W*0.45),0,1),0.95)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))':"
                    "b='b(X,Y)*pow(clip(X/(W*0.45),0,1),0.95)*(1-0.92*clip((Y/H-0.78)/0.22,0,1))'"
                    "]");
            }'''
    sources[BRIDGE] = once(sources[BRIDGE], old_filter, "            }", "Native FFmpeg software filter")
    if 'setMpvOptionStringLocked("target-colorspace-hint", "yes")' not in sources[BRIDGE]:
        raise RuntimeError("Native color space option missing")
    return sources

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: apply_nuvio_desktop_v10_recovery.py NuvioDesktop")
    root = Path(sys.argv[1]).resolve()
    edited = patch(root)
    for relative, content in edited.items():
        (root / relative).write_text(content, encoding="utf-8")
    print("Applied V10 trailer startup and V3 Custom Poster fixes; Windows runtime playback remains unverified.")
