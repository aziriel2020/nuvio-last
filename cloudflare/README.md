# Cloudflare-only Nuvio

Nuvio is hosted on Cloudflare at:

`https://nuvio-last-aziriel2020-1343705637.pages.dev`

The public filenames, addon IDs, collection IDs, catalog IDs and regional paths stay unchanged.

## Architecture

- Large collection JSON files, manifests, blueprints and repository artwork are generated as static Cloudflare Pages assets.
- Static asset requests do not invoke Pages Functions.
- Catalog, metadata and dynamic SVG routes run directly in the Cloudflare Workers runtime through Pages advanced mode.
- Today/Tomorrow/current-month catalogs use short edge caching; historical catalogs use longer caching.
- Shield calendar cards stay self-contained SVG.
- Desktop folder/genre cards are served from repository artwork, and dynamic desktop content cards are proxied directly from the approved artwork source.
- There is no Vercel fallback in the Cloudflare runtime.

## Automatic updates

`.github/workflows/deploy-cloudflare.yml` deploys on changes to `main`, can be run manually, and also runs every six hours. The large JSON files are regenerated on each deployment while rolling period IDs stay stable, so users do not need to re-import Collections when Today/Tomorrow changes.

## Secrets

The Cloudflare Pages runtime needs one TMDb credential:

- `TMDB_READ_TOKEN` (preferred), or
- `TMDB_API_KEY`.

The TMDb credential is stored directly in the Cloudflare Pages production/preview environment and is verified before every deployment.

Cloudflare API deployment uses the GitHub repository secret `CLOUDFLARE_API_TOKEN`.
