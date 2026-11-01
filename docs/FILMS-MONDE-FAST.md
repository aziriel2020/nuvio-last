# Films Monde Fast Collections — opt-in Shield and Mobile

## Verified incident (31 October 2026)

Read-only Oracle diagnostics discovered:

- `/movies/status.json`: `ok: true`, 38,471 eligible titles, index sync active.
- Canonical and Native Bridge manifests both expose 9,572 catalogs.
- The normal collection import contains 4 collections × 20 genre folders ×
  up to ~119 period references (9,492 total sources across four collections).
- The original and Native Bridge catalog pages return actual movies. The
  Native Bridge page had 24 of 24 TMDB URLs, rather than 24 Oracle renderers.
- The stock NuvioTV `FolderDetailViewModel.loadFolder` eagerly starts one
  source request for every period in the selected genre; 100+ simultaneous
  catalog calls in one folder is the critical load multiplier.
- The previous Oracle production audit did not validate the `/movies`
  catalog family. New read-only diagnostics now do.

## Fast collections: preserve every date, reduce in-flight loads

New opt-in imports:

- Shield: `https://141-145-215-202.nip.io/movies/nuvio-collections-fast.json`
- Desktop: `https://141-145-215-202.nip.io/movies/nuvio-collections-fast-desktop.json`
- Mobile: `https://141-145-215-202.nip.io/nuvio-collections-movies-fast-mobile.json`

The same original four collection IDs and 20 main genre folder IDs are retained.
Main genres appear first, with existing approved premium covers and backdrops.
Each main genre contains five rolling date periods plus the last twelve
monthly periods. Older months are still accessible, grouped in chronologically
labeled archive folders (at most 24 periods per folder). Western historic
year and undated rows remain reachable in bounded archival groups.

The complete set of catalog IDs and their period names is preserved exactly,
including daily rollover and rolling monthly history through 2030 and beyond.
No movies, streaming/VOD/cinema rules or sources are dropped. The original
full import endpoints are unchanged for immediate rollback.

## Faster Native Bridge catalog responses

`runtime/router.mjs` now applies the same warm disk-cache policy and
Brussels-local day cache key used by canonical Movies catalogs to:

- `/movies/native-bridge/catalog/movie/...`
- `/movies/native-bridge/mobile/catalog/movie/...`

Only successful, nonempty pages can be cached; empty and error results are
still never cached. Today/Yesterday have a 60-second maximum; archived
nonempty pages use 300 seconds, with the Brussels day in the cache identity.
Images remain direct provider CDN URLs; no extra Oracle poster hop.

## Installation and rollback — standard addon, NO Native Bridge required

1. Keep the **original Films Monde addon**:
   `https://141-145-215-202.nip.io/movies/manifest.json`.
   Do not replace it with Native Bridge.
2. On Shield, re-import **only Films Monde** using
   `https://141-145-215-202.nip.io/movies/nuvio-collections-fast.json`.
   Reimport updates the same four collection IDs without deleting any date.
3. Keep France/Global/US/TR/Series imports unchanged.
4. Premium covers, hero backdrops, typography and original genre folder
   IDs are identical. Old monthly dates appear in clearly labelled archive
   folders, limiting eager requests; this changes archive navigation, **not**
   the existing visual design or the source catalogs.
5. Roll back instantly by reimporting
   `https://141-145-215-202.nip.io/movies/nuvio-collections.json`.
   No SQLite migration or cleanup is necessary.

The standard addon automatically benefits from reduced simultaneous duplicate
TMDB poster downloads, catalog singleflight, hot-cache hits and larger Oracle
artwork retention. A previously imported full collection keeps its large
119-period folders until the fast import is applied.

Note: this is a **server-only mitigation**. The client still loads all
periods *within the open folder*; the addon cannot implement genuine
tab-on-demand loading without modifying the Nuvio app.

## Tests

`node --test test/films-monde-fast-collections.test.cjs`
`node --test test/films-monde-posters.test.mjs`
`npm test`

GitHub Action `Diagnose Films Monde Live` prints the index, manifest,
collection and live catalog sample state from production. Unlike the
original overall audit, it explicitly exercises the Movies family.

Performance validation on the physical Shield is still required:
test the first genre, an archive genre, and compare warm/cold poster paints.
