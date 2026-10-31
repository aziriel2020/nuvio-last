# Nuvio Native Bridge V1 — provider artwork without Oracle image proxy

## Scope

Optional catalog/metadata bridge for existing France, Global, Türkiye, USA,
Films Monde, Séries France legacy and Séries France V2 addons. The bridge does
not fetch, cache or rasterize provider image bytes. In catalog and meta JSON it
unwraps known Oracle media renderers to the HTTPS image URL from TMDB, TVDB,
TVmaze or AniList. Nuvio downloads imagery directly from the provider CDN.

**This does not modify the TMDB/TVDB plugins, nor integrate with their private
internal APIs.** Nuvio still chooses its normal metadata provider for full
detail pages. TVDB image URLs pass through only when the source data contains
them. We do not invent missing TVDB IDs or promise that a given Nuvio build
shares caches across addons.

## Addon endpoints (after release)

Set `BASE` to the current Oracle host from `/install.json`. For each
`REGION` in `fr`, `us`, `tr`, `global`, `movies`, `series`, `series-v2`:

- Android TV / Shield: `BASE/REGION/native-bridge/manifest.json`
- Mobile / Desktop: `BASE/REGION/native-bridge/mobile/manifest.json`

Only one manifest for a given addon ID should be installed on the same Nuvio
profile. **Uninstall/replace the corresponding regular manifest**, not the
entire addon family. The bridge retains the canonical addon ID, catalog IDs,
catalog names, types, page size, meta resources and source definitions.

Collections do not need re-importing. Period labels, ordering, first-release
rules and the calendar horizon through 2030 are unchanged. Your curated
collection/genre covers are not affected. The original manifest URLs,
imports and artwork renderers all remain available for rollback.

## Performance model

- Existing JSON catalog and index generation is still on Oracle.
- Original provider photos no longer need Oracle's `/images/original.jpg`
  relay or per-title `/fr/calendar-card.jpg` generator when a provider photo
  is discoverable in that catalog entry.
- `poster`, `background`, `landscapePoster` and `banner` point to provider
  CDN sizes appropriate to their role. Episode thumbnails are handled too.
- If there is no safe original source image, the existing Oracle fallback
  remains so the title does not become blank.
- Only allowlisted HTTPS image hosts can be extracted from local renderers.
  No arbitrary URLs, redirects or network fetches are allowed in the bridge.
- Existing release dates, identities, platform/provider classifications,
  metadata, sorting and folders are not recalculated.

This removes an image hop and image rendering from the common case. It does
NOT guarantee instant display: device/network/CDN conditions and the number
of period sources loaded by the client are independent bottlenecks. In
particular, Nuvio Mobile currently requests all folder period sources
at initialization; the addon cannot fix that without changing the client.

## Verification

```bash
node --test test/native-bridge.test.cjs
npm test
npm run build:runtime
```

Smoke-test on a disposable Nuvio profile before replacing any production
manifest. Open Films Monde streaming, Cinema, and VOD; Series France; and one
Prime Video calendar on Shield and Mobile. Verify:

1. Existing collection/folder/period names and IDs remain stable.
2. A title with a provider photo points to `image.tmdb.org` (or equivalent)
   rather than Oracle for its content poster/background.
3. No metadata fields like `originalReleaseDate`, `released`, streaming
   provider, title or video ID change.
4. Titles lacking a photo still render a fallback card.
5. Compare first-paint and full-row loading on real hardware, including a
   cold cache and warm cache. No unmeasured speed claims.

## Rollback

Reinstall the prior canonical manifest or the earlier collection-only
manifest for each region on the same Nuvio profile. The addon and collection
IDs do not change. No database migration is required. Never import a second
manifest with the same ID alongside the first.

## Technical notes

- Module: `runtime/native-bridge.cjs`
- Opt-in dispatch: `api/index.js`
- Existing global image relay: `runtime/index.mjs` matches only canonical
  `/REGION/catalog` and `/REGION/meta` requests, not the nested
  `/REGION/native-bridge/...` endpoints.
- No changes to Oracle caching policy, image proxy defaults or active
  canonical manifests.
