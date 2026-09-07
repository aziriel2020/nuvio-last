# Free Cloudflare edge

This directory contains the Cloudflare Pages layer used to keep the public Nuvio endpoint on the free tier.

## Architecture

Cloudflare Pages serves the large, stable JSON files and repository artwork directly from its static asset network. Only genuinely dynamic catalog and generated-card routes invoke the Pages Worker. Those requests are cached at Cloudflare and use the existing Vercel deployment only as a compatibility origin while the Node/Sharp runtime is still required.

This keeps the current Nuvio behavior intact while removing the repeated large JSON transfers that caused the Vercel Fast Origin Transfer spikes.

## Cloudflare Pages settings

- Project name: `nuvio-last-aziriel2020-1343705637`
- Production branch: `main`
- Build command: `npm install --no-audit --no-fund && npm run build:cloudflare`
- Build output directory: `dist`
- Environment variable: `PUBLIC_ORIGIN=https://nuvio-last-aziriel2020-1343705637.pages.dev`
- Optional environment variable: `NUVIO_VERCEL_ORIGIN=https://nuvio-last.vercel.app`

Do not remove the Vercel project until the Cloudflare endpoint has been exercised with Nuvio on Shield and desktop. The Cloudflare layer is designed so the Vercel deployment can remain on the free Hobby allowance as a low-traffic origin during the transition.
