# Films Monde - Oracle performance audit, 2026-11-07

## Strict scope
Server-only cache tuning; no MSI, APK, app, UI, SVG renderer, logos, typography, artwork assets, collection imports, manifest, movie metadata, movie IDs, classifications or SQLite schema changes. No production deployment. The default branch main remains untouched.

## Verified production reference
- Production Oracle /_oracle/health reported gitSha ced4c49beb78d596366feb2ca103882a7a2b5b2c, matching repository main, on Node 22.23.2, RSS approximately 3057 MiB.
- Read-only benchmark: scripts/benchmark-films-monde-oracle-readonly.mjs; 16 GET samples, at most two simultaneous requests, no production stress tests.
- First sample 2026-11-07 06:55 UTC: 16/16 OK, p50 1125.85 ms, p95 5644.26 ms, 9 disk/hot hits. Cache-hot repeated queries ~114-116 ms; non-cached SQL catalog work ~1-3 seconds according to Server-Timing.
- A second sample (before any production deploy) had p50 114.05 ms, p95 3352.99 ms and 15/16 cache hits. This difference is cache temperature, NOT an optimization gain.
- Movie poster URLs in sampled JSON point directly to image.tmdb.org, not to the old Oracle composed-JPEG endpoint.

## Root causes and limitations
1. Cold catalog SQLite processing can block for seconds, using complex predicates in regions/movies/src/store.cjs. A representative read-only DB copy and EXPLAIN QUERY PLAN are needed before safe SQL tuning; the production index is not available to this workflow.
2. A stock TV client can request more than 100 period catalog pages per folder. Server-only changes can reduce their cost but cannot stop those requests.
3. The original Oracle edge cache capped old archive pages at 300s although the authoritative movie catalog cache policy already permits 900s.
4. The legacy artwork warmer only recognizes Oracle /fr/calendar-card.jpg patterns while live Film Monde JSON mostly returns TMDB URLs; prewarming those old URLs does not automatically prewarm direct TV -> TMDB transfers.
5. No TV screenshot, decoder benchmark or 20/50/100-production concurrency test was performed; such claims would be unverified.

## Actual changes on the isolated branch
- oracle/movie-history-grace.mjs: classify old monthly and annual movie catalog pages using Europe/Brussels time and preserve all current/daily/rolling/future, image and nonmovie paths.
- runtime/router.mjs: align old archive cache TTL to 900s. Identical URLs and response bytes; current-month and rolling periods retain previous limits.
- oracle/server.mjs: bounded stale-while-revalidate for previously cached old-archive pages, at most 180s beyond TTL when existing headers explicitly allow it. Cached bytes are returned immediately with no-store, while at most two refreshes run later; never applies to current dates or imagery.
- test/oracle-movies-cache-stale.test.mjs: guards date boundaries, archives with pagination and nonmovie/graphic exclusions.
- scripts/benchmark-films-monde-oracle-readonly.mjs + isolated Actions workflow: collect HTTP latency and ordered ID/poster fingerprints without production mutations.
- Existing Film Monde cache tests updated only for the intentional archive TTL extension.

## Design lock
The renderer, poster files, SVG, content cards, approved genre covers, 4 collections, 20 genres and import JSON are untouched. Cache returns original response bytes, never rewrites artwork, IDs or images. Visual rendering on Shield after a deployment remains to be checked on hardware.

## Validation and deployment gate
GitHub Actions isolated regression run: https://github.com/aziriel2020/nuvio-last/actions/runs/42349333814 (success). Includes official movie tests, approved-cover checks, historical cache-boundary tests and routing tests.
Do not deploy without user authorization. Before deploy, measure SQL with EXPLAIN QUERY PLAN against an approved sanitized DB snapshot; stage a 20/50/100-concurrency test; verify output IDs, order, URLs, server CPU/RSS, background refresh limit and image hashes. Then deploy via the existing Oracle pipeline and compare p50/p95 on identical workloads. Roll back to commit ced4c49 if regressions; do not purge artwork cache or alter SQLite.

## Performance claim
Only pre-production source/test changes are demonstrated. The real after-deploy speedup is UNKNOWN, not zero and not estimated. Gains target repeated archive browsing, not the first cold SQL scan or direct client-TMDB downloads.
