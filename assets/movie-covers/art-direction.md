# Films Monde — imagegen and project layout

Built-in imagegen was used for the new principal illustration (no CLI fallback).
Style/layout reference: the approved `all.webp` in
`assets/series-covers/series-covers-25-approved.zip`.
Project master: `assets/movie-covers/movies-world-master.jpg`.
Final main cover: `assets/movie-covers/all.webp`.
All genre cards: the 20 WebP files enumerated in `manifest.json`.
The reproducible project renderer is `scripts/generate-movie-covers.cjs`.

## Exact principal-image prompt

Use case: ads-marketing. Asset type: premium 1600x900 landscape collection cover for the Nuvio media app. The attached image is a STYLE AND LAYOUT REFERENCE, not an edit target. Create a NEW matching FILMS MONDE cover for live-action movies: preserve the reference's elegant thin champagne-gold rounded frame, charcoal/navy background, cinematic photography on the left 38% and spacious dark rectangular typography panel on the right 58%, generous TV-safe margins and large white sans-serif typography. Replace the left montage with original photorealistic movie imagery: a beautiful vintage cinema camera and lens catching warm projector light, a dramatic night-time movie-theatre entrance with red velvet and city lights, and a subtle globe seen through a film-frame motif. Rich cinematic teal, deep navy, champagne gold. No copyrighted film posters or actor likenesses, no anime or cartoon styling. Typography MUST be exactly in French: top small gold text 'NUVIO / FILMS MONDIAUX'; big white headline 'TOUS LES FILMS' on two lines; below a thin gold rule, small subtitle 'STREAMING • VOD • CINÉMA'; smaller muted line 'MARCHÉ FRANÇAIS • TOUS SERVICES'. Make the typography readable on a television. The gold border must be fully inside the canvas, no cut-off text, no logos for streaming companies, no UI mockup around the cover. Output one flat polished finished cover, 16:9.

## Genre layout

The approved photographic artwork for each matching genre is placed in the left
panel; the complete right panel is rendered as project-native SVG paths using
DejaVu Sans, with bold uppercase genre names. Typography states FILMS MONDIAUX,
STREAMING • VOD • CINÉMA, and MARCHÉ FRANÇAIS • TOUS SERVICES. All borders and
type remain inside a 1600×900 canvas. Original genre labels are not reused.
