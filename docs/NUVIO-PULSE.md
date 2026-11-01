# Nuvio Pulse — premium daily discovery, zero APK changes

## What it adds (opt-in)

**One new import**: `https://141-145-215-202.nip.io/nuvio-collections-pulse.json`.

This creates **four additional native Nuvio collections** (no existing collection is replaced or re-identified):

| Parent | Original source | New folders |
|---|---|---|
| ✨ Nuvio Pulse · France | France Editorial, native | Nouveaux films, nouvelles séries, séries renouvelées, Binge Watch |
| 🎬 Nuvio Pulse · Films Monde | Films Monde, canonical addon | Toutes les sorties, Streaming, VOD, Cinéma |
| 📺 Nuvio Pulse · Séries France V2 | Curated V2 addon | Nouvelles séries et épisodes, nouvelles saisons |
| 🌍 Nuvio Pulse · Anime & VOD Monde | Global addon | Anime Japon/Corée Séries, Anime Films, VOD Monde Films |

Each **Films Monde** / **Séries V2** folder has three independent, fixed-ID dynamic period rows:
`last7` = 7 derniers jours (today and six previous days),
`last30` = 30 derniers jours (today and 29 previous days),
`next7` = 7 prochains jours (tomorrow through day 7). These use **Europe/Brussels civil calendar days**; the corresponding last/next exact date ranges are recomputed on *every* catalog request. The labels and IDs **never change when the month/year changes**. No monthly import is necessary for **Pulse**. These rows preserve the original genre exclusions, provenance-checked platform premiere, metadata, and cinematic card rendering.

The France Editorial Pulse folders reuse the already approved editorial selection and periods, with a maximum of four sources. Global Anime/VOD Pulse uses the existing `today`, `yesterday`, `lastweek`, `nextweek` sources, keeping **Asia/Tokyo** release calendar for Anime Japon/Corée. **No new US or Türkiye sources, calendars or addons.**

**Artwork:** copies the existing approved folder covers and cinematic backdrops (URLs unchanged). Native wordmark uses the current `/collection-title.svg`, not a new raster generation pipeline. It keeps the no-film-clearlogo Films Monde policy. Up to **4 catalog requests per Pulse folder** instead of 100+.

## Installation on Shield

1. Keep your four existing `/collections-only/manifest.json` addons for `fr`, `movies`, `series-v2`, and `global`. No Native Bridge, no APK.
2. **Refresh the addon manifests** for **Films Monde** and **Séries V2** to register the 12 + 6 new Pulse descriptor IDs. Their installed addon IDs and original collection sources do not change. If the app caches an old manifest, remove and reinstall only the same canonical collection-only addon URLs, without deleting your existing custom collections.
3. Import **once** `https://141-145-215-202.nip.io/nuvio-collections-pulse.json`.
4. Relaunch Nuvio Shield. Pulse appears as four new collections beside your existing Films Monde Fast, Séries V2, France, and Global.
5. All Pulse catalogs stay **inside Collections only**; they are absent from Home, Discover and global Search because the installed collection-only addon manifests still require the hidden `search` and `genre` parameters. Client-specific cache behavior requires on-device validation.

## Compatibility / non-guarantees

Pulse is additive and cannot break the original 4 Films Monde collections, 2 Séries V2 collections or rolling calendar archives through 2030. The server may refresh discovery frequently, but **unannounced or missing third-party release data cannot be guaranteed**. Films Monde and Séries V2 indexes require fresh French provider evidence; new episodes may arrive after sources update. Existing non-Pulse month-folder imports may still require reimport on months not originally prewired. Pulse's rolling rows do not.

Technical validation:
`node --test test/nuvio-pulse.test.js`,
`node scripts/verify-nuvio-pulse-production.mjs` after Oracle deploy.

**Explicit exclusion:** no changes under `regions/us` or `regions/tr`, no US/Türkiye Pulse parents, and no Android app build.
