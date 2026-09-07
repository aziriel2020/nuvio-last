# Free Cloudflare edge

This directory contains the Cloudflare Pages layer used to keep the public Nuvio endpoint on the free tier.

## Architecture

Cloudflare Pages serves the large, stable JSON files and repository artwork directly from its static asset network. Only genuinely dynamic catalog and generated-card routes invoke the Pages Worker. Those requests are cached at Cloudflare and use the existing Vercel deployment only as a compatibility origin while the Node/Sharp runtime is still required.

This keeps the current Nuvio behavior intact while removing the repeated large JSON transfers that caused the Vercel Fast Origin Transfer spikes.

## Direct Upload deployment

The repository includes `.github/workflows/deploy-cloudflare.yml`. It does not require Cloudflare's GitHub integration. GitHub Actions builds `dist`, creates the Pages project if it does not exist, uploads the site with Wrangler, then checks the public endpoint.

Cloudflare credentials required by GitHub Actions:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a scoped API token with Cloudflare Pages edit/write permission for that account.

Add both as GitHub repository Actions secrets. The workflow intentionally skips deployment without them instead of breaking normal CI.

## Cloudflare Pages settings

- Project name: `nuvio-last-aziriel2020-1343705637`
- Production branch: `main`
- Public endpoint: `https://nuvio-last-aziriel2020-1343705637.pages.dev`
- Build command used by CI: `npm run build:cloudflare`
- Build output directory: `dist`
- Build environment: `PUBLIC_ORIGIN=https://nuvio-last-aziriel2020-1343705637.pages.dev`

The worker defaults to `https://nuvio-last.vercel.app` as the compatibility origin, so no Cloudflare-side variable is required for the first deployment.

Do not remove the Vercel project until the Cloudflare endpoint has been exercised with Nuvio on Shield and desktop. The intended end state is that large static traffic is served for free by Cloudflare while Vercel receives only low-volume compatibility traffic.
