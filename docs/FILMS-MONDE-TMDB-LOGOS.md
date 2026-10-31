# Films Monde — original TMDB title logos, no baked-in poster art

## Objective

Use the official TMDB **image/logo** for each film with one clean, optional
client-side title overlay. Keep film posters and horizontal backdrops loaded
directly from TMDB CDN; do not generate a second Oracle image for every movie.

## Source and sync

The existing `/movie/{id}` detail sync requests images in `append_to_response`
and includes languages `fr,en,null`. No additional API request per card.
`selectMovieLogo()` prefers French, the original language if included in the
response, English, then untagged logos, ranking quality within a language.
Only valid PNG/WebP bitmap logo paths are returned for Coil interoperability.
TMDB SVG paths are intentionally skipped on the Shield unless the client adds
an SVG decoder.

The movie-only SQLite `shows.logo` column is migrated on the writer, leaving
Séries Monde intact. The `logo` string is stored with the movie; discovery
candidates without appended image details **never erase** an enriched logo.
The detail sync gradually refreshes older movies. New productions from the
last 90 days are prioritized once, capped at 1200 IDs, to populate their logos.
No full 38K-movie synchronous backfill.

## Addon behavior

`/movies/native-bridge/manifest.json` is unchanged. Film catalogue and
detail JSON now contain `logo: https://image.tmdb.org/t/p/w500/....png`
when one exists. The French calendar decorator's intentional transparent
logo placeholder is overwritten **only for Films Monde**, never the France
catalogues.

Native Bridge additionally fixes horizontal film cards: if
`posterShape = landscape`, its **catalog** poster is the original TMDB
horizontal backdrop (w780), with original portrait at `_rawPosterUrl`.
The movie **detail** still receives the real portrait poster (w500).
Other addon families are unchanged. This is 100% provider-CDN imagery.

## On-screen overlay without burning artwork

The stock official NuvioTV client honors logos in several layouts, but does
not guarantee they appear on every 16:9 GridContentCard. The opt-in patched
Shield client from `builder/apply_nuvio_tv_films_monde_logos.py` explicitly
draws the logo over Films Monde horizontal cards in Compose, with a bottom
gradient and the text title fallback when the image request fails.
The patch is restricted to source addon URLs containing `/movies`.
The rest of the collection design and approved covers remain untouched.

An isolated NuvioTV debug package is built by
`.github/workflows/build-nuvio-tv-films-monde-logos.yml` using a pinned
public upstream revision. Its package is
`com.nuvio.tv.filmsmonde.logos`. It **does not overwrite** an existing
official Shield app, automatically modify the Shield or claim native support
in the official APK. The GitHub Actions APK artifact can be installed
manually for an optional test. It uses the official public Nuvio backend
discovery, not a personal account.

## Release and verification

- `npm test` including new `regions/movies/test/logos.test.cjs` tests
- `npm run test:movies`
- `node scripts/verify-films-monde-production.mjs`
- Existing production audit/rollback workflows remain intact.

Test TMDB logo availability on multiple titles, especially recent releases.
A missing/unsuitable logo must not prevent poster display. Always compare
poster time-to-first-paint on a real Shield before promoting an APK.
