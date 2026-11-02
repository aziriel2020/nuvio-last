# Nuvio Design Engine — global catalog artwork hook (experimental)

## Verified Nuvio integration contract
- Nuvio `CatalogRepositoryImpl.getCatalog()` applies `withCustomPosterUrls(...)` to the items received from **every** installed catalog addon when Custom Posters is enabled for the relevant screen.
- `CustomPosterOverlay.kt` resolves `{type}`, `{id}`, `{shape}` and assigns the resulting URL to `MetaPreview.landscapePoster`. The unmodified poster is preserved as `rawPosterUrl` for image-load fallback.
- `ModernHomeModels.kt` uses `landscapePoster ?: backdropUrl ?: poster` when the Nuvio landscape-card setting is enabled.
- This hook is part of **Nuvio's native Custom Posters setting**; an independent Stremio-compatible addon manifest cannot install or change that setting by itself. There is no claim of arbitrary Android/Compose UI injection.

## Experimental global configuration

For an opt-in test profile on Nuvio, set Custom Posters' URL pattern to:

```text
https://141-145-215-202.nip.io/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v2
```

Enable Custom Posters for **Catalogs/Home** and enable **landscape posters** in Nuvio's layout options. Keep the existing addons as they are; the native resolver requests our artwork per media identifier. No APK fork, no edits to the catalogs, and no generated JPEG artifacts are involved.

The optional *metadata addon* can be installed separately from `/design-meta/vector/manifest.json`, but its installation **alone does not override catalog posters**. The global artwork URL pattern is the piece that intercepts existing catalog images.

The service resolves IMDb `tt...` and TMDB `tmdb:...` content IDs, fetches title metadata and native artwork from TMDB, and dynamically returns a 1600×900 SVG containing a cinematic backdrop, selected TMDB logo (when present), title/type, first date, TMDB rating, genres, seasons, and a single unambiguous French streaming provider. Multiple FR watch providers cannot identify which collection a title belongs to, so no arbitrary platform badge is fabricated.

Non-landscape shapes return HTTP 404 for native artwork fallback instead of cropping a 16:9 fiche into portrait or square.

## Explicit limitations
- **Not proven on Shield**: Coil registers `SvgDecoder`, but its behavior with embedded data-URI JPEG/PNG/WebP, text and SVG features must be tested on the device.
- **Only IMDb/TMDB IDs supported today**. A catalog using only TVDB/Kitsu/MAL IDs needs a verified ID resolver before it can receive global artwork. Other media URLs fall back.
- Fanart.tv and TVDB are **not integrated yet**; this prototype currently downloads artwork via TMDB.
- Nuvio determines card aspect ratio; this engine provides artwork, not UI layout code.
- This first vector engine may download and base64-embed original TMDB image bytes into SVG; it does not create or save JPEGs. Server cache is bounded (32 entries/48 MiB).
- Oracle public hostname comes from the production deployment workflow, but the **new route is not live there while this branch remains unmerged**. Copying the pattern today cannot activate the feature.
- No production Oracle or NVIDIA Shield rollout is implied. Development branch and PR remain isolated.
- Oracle runtime uses `oracle/server.mjs` → `runtime/index.mjs` → `runtime/router.mjs` → `api/index.js`; the integration suite tests that full path with no TMDB credentials.
- The dynamic SVG route has a 900-second Oracle edge/disk cache, with a revisioned URL. A changed design requires changing the `v` value.
- An identical film can appear in several catalogs: neither title ID nor TMDB watch-provider availability reliably identifies the catalog's specific brand. Provider badges are omitted when ambiguous.

## Verification
- `node --test test/native-design-meta-addon.test.cjs test/native-design-svg-preview.test.cjs`
- Confirm the standard metadata endpoint still returns TMDB-native URLs.
- Confirm `/design-meta/art/movie/tt1234567/landscape.svg` returns `image/svg+xml` when the movie exists on TMDB.
- Confirm `/design-meta/art/movie/tt1234567/poster.svg` returns 404 as designed for the native portrait fallback.
- On Shield, use a non-production profile and inspect one movie from an unrelated addon and one series from a separate addon. Verify actual card rendering, fallback behavior, startup time, scrolling smoothness and missing-provider behavior.
