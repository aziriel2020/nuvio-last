# Films Monde — film title logos disabled (1 November 2026)

## User-facing rule

The **standard Films Monde addon** (`/movies/manifest.json`) must never overlay
an official TMDB film title logo on its posters, horizontal cards or detail pages.
This applies to the four Films Monde views: All, Streaming, VOD and Cinéma.
The existing approved premium photo, backdrop, date/provider typography, genre
art, collection covers, calendar rules and fast cache pipeline stay unchanged.

- On **catalog** cards: the existing Nuvio Modern transparent control logo
  (`/fr/calendar-transparent-logo.svg`) may remain as an *invisible* layout
  placeholder so the native client does not draw a duplicate title on top of
  the approved precomposed cinematic card. It is not an actual movie logo.
- On **details**: public movie metadata omits `logo` and `titleLogoUrl`.
  The independent internal TMDB enrichment/database may retain logo metadata,
  but the public Films Monde addon does not expose it to clients.
- No change to `/fr`, `/us`, `/tr`, `/global` or `/series` addons.
- No change to standard or fast collection IDs, sources, visual files or original
  film dates; existing installed manifest URL stays the same.

## Existing poster images

This policy disables **separate transparent title-logo overlays**. It does not
remove lettering that is already permanently embedded in a source movie image
or existing precomposed typography (date, text title, service), which would
require changing image assets or the user's approved design.

## Legacy optional Shield APK

The optional experimental debug APK
`com.nuvio.tv.filmsmonde.logos` contains client code capable of drawing a
TMDB logo when the addon provides one. New Films Monde catalog responses no
longer send actual film logos, so this overlay should not be triggered.
The standard Shield app remains unchanged and is the supported target.

## Validation

Run `npm run test:movies`, `npm test`, `node scripts/test-movies-runtime.mjs`
and `node scripts/verify-films-monde-production.mjs`.
Verify actual screen on Shield after client cache expiry.
