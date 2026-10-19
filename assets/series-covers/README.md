# Séries mondiales — premium genre artwork (25 / 25)

Approved artwork for the existing **Séries France V2** / Séries mondiales Nuvio Shield collections.

## How these files are served
- **Simplest upload**: put the single supplied `series-covers-25-approved.zip` in this directory. The ZIP contains the 25 landscape WebP covers at its root, uses ZIP_STORED, and is read directly by the Node runtime; do not unzip it. Upload the one file through GitHub's `Add file → Upload files` page at this directory, then commit to `main`. The normal Oracle deploy will validate it and switch the artwork automatically.\n- Each existing genre uses its **exact category ID** as its filename: `all.webp`, `10759.webp`, `35.webp`, `80.webp`, `18.webp`, `9648.webp`, `10765.webp`, `10768.webp`, `37.webp`, `10766.webp`, `10751.webp`, `10762.webp`, `99.webp`, `10764.webp`, `10767.webp`, `10763.webp`, `unclassified.webp`, `thriller.webp`, `horror.webp`, `romance.webp`, `history.webp`, `medical.webp`, `legal.webp`, `espionage.webp`, `miniseries.webp`.
- Images have already been composed for **Nuvio Shield's 16:9 landscape cards** (1600 × 900 WebP) from the user-approved individual posters.
- Optional `<id>-poster.webp` files retain the approved vertical edition for other clients.
- Once all **25** exact files have been uploaded into this folder, `/series-v2/nuvio-collections.json` and the compatible legacy collection route automatically use the new image URLs, replacing the shared stock genre templates.
- **Partial uploads do not activate any new art.** Missing files keep the old artwork active.
- URLs are served directly by Oracle at `/series-v2/artwork/genre/<id>.webp?v=premium-20261019-v1`.
- Existing collection IDs, folder IDs, source IDs and covers outside Séries mondiales are unchanged.

## Mandatory quality gate

Run `node scripts/verify-series-covers.mjs` to inspect the ZIP or individually installed WebP artwork. Add `--require-complete` to make missing assets fatal. The GitHub CI deploy stays safe before upload; upload all 25 in one batch to activate.

**Excluded:** MUSIC / musical and any animation or anime genre. Those are not in the 25 genre IDs defined by the series addon.
