# Nuvio Design Engine — global catalog artwork hook (experimental)

## Verified Nuvio integration contract
- Nuvio `CatalogRepositoryImpl.getCatalog()` applies `withCustomPosterUrls(...)` to the items received from **every** installed catalog addon when Custom Posters is enabled for the relevant screen.
- `CustomPosterOverlay.kt` resolves `{type}`, `{id}`, `{shape}` and assigns the resulting URL to `MetaPreview.landscapePoster`. The unmodified poster is preserved as `rawPosterUrl` for image-load fallback.
- `ModernHomeModels.kt` uses `landscapePoster ?: backdropUrl ?: poster` when the Nuvio landscape-card setting is enabled.
- This hook is part of **Nuvio's native Custom Posters setting**; an independent Stremio-compatible addon manifest cannot install or change that setting by itself. There is no claim of arbitrary Android/Compose UI injection.

## Shield legibility improvement — v3 (deployment pending)

For an opt-in test profile on Nuvio, set Custom Posters' URL pattern to:

```text
https://141-145-215-202.nip.io/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v3
```

Enable Custom Posters for **Catalogs/Home** and enable **landscape posters** in Nuvio's layout options. Keep the existing addons as they are; the native resolver requests our artwork per media identifier. No APK fork, no edits to the catalogs, and no generated JPEG artifacts are involved.

The optional *metadata addon* can be installed separately from `/design-meta/vector/manifest.json`, but its installation **alone does not override catalog posters**. The global artwork URL pattern is the piece that intercepts existing catalog images.

The service resolves IMDb `tt...` and TMDB `tmdb:...` content IDs, fetches title metadata and native artwork from TMDB, and dynamically returns a 1600×900 SVG with enlarged TV-legible type, cinematic backdrop, selected TMDB logo (when present), title/type, TMDB rating, season count and a single unambiguous French streaming provider. For series, it also shows the most recently confirmed aired episode, its season and episode number, and its actual airing date; if none is confirmed, it shows the original premiere date. Multiple FR watch providers cannot identify which collection a title belongs to, so no arbitrary platform badge is fabricated.

Non-landscape shapes return HTTP 404 for native artwork fallback instead of cropping a 16:9 fiche into portrait or square.

## Explicit limitations
- **Shield verification**: the user confirmed that v2 artwork renders on their Shield. The larger v3 typography and episode line still need visual testing on the device.
- **Only IMDb/TMDB IDs supported today**. A catalog using only TVDB/Kitsu/MAL IDs needs a verified ID resolver before it can receive global artwork. Other media URLs fall back.
- Fanart.tv and TVDB are **not integrated yet**; this prototype currently downloads artwork via TMDB.
- Nuvio determines card aspect ratio; this engine provides artwork, not UI layout code.
- This first vector engine may download and base64-embed original TMDB image bytes into SVG; it does not create or save JPEGs. Server cache is bounded (32 entries/48 MiB).
- The v3 change is not live until its PR is merged and Oracle deploy succeeds. Do not tell the user to switch to v3 before deployment is verified.
- Oracle runtime uses `oracle/server.mjs` → `runtime/index.mjs` → `runtime/router.mjs` → `api/index.js`; the integration suite tests that full path with no TMDB credentials.
- The dynamic SVG route has a 900-second Oracle edge/disk cache, with a revisioned URL. A changed design requires changing the `v` value.
- An identical film can appear in several catalogs: neither title ID nor TMDB watch-provider availability reliably identifies the catalog's specific brand. Provider badges are omitted when ambiguous.
- **Monthly series context:** the global Custom Posters URL exposes only `{type}`, `{id}`, and `{shape}`, not the month or the individual episode of the catalog row. Therefore the vector overlay truthfully labels the episode as *dernier épisode* (latest confirmed airing), NOT as an episode belonging to the month on screen. Séries Monde catalog metadata already contains the month-specific `episodeCode` and `released` fields; rendering those same month-specific values inside the vector image requires a future Nuvio URL template that passes catalog context, or a per-row artwork override. Never fabricate that context.
- The legacy server-side image treatments remain in place. Any cleanup is explicitly deferred until the user validates both readability and TV episode presentation.

## Verification
- `node --test test/native-design-meta-addon.test.cjs test/native-design-svg-preview.test.cjs`
- Confirm the standard metadata endpoint still returns TMDB-native URLs.
- Confirm `/design-meta/art/movie/tt1234567/landscape.svg` returns `image/svg+xml` when the movie exists on TMDB.
- Confirm `/design-meta/art/movie/tt1234567/poster.svg` returns 404 as designed for the native portrait fallback.
- On Shield, use a non-production profile and inspect one movie from an unrelated addon and one series from a separate addon. Verify actual card rendering, fallback behavior, startup time, scrolling smoothness and missing-provider behavior.
