'use strict';

const sharp = require('sharp');
const { artworkCache } = require('../../fr/api/artwork-cache.cjs');

// Anime sources include portrait key art and very wide banners. Preserve the
// entire source, rather than treating either shape as a 16:9 photograph.
async function landscapeArtwork(bytes) {
  const background = await sharp(bytes).rotate()
    .resize(1600, 900, { fit: 'cover', position: 'centre' })
    .blur(32).modulate({ brightness: 0.45 }).jpeg().toBuffer();
  const artwork = await sharp(bytes).rotate()
    .resize(1600, 900, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  return sharp(background).composite([{ input: artwork }]).jpeg({ quality: 94 }).toBuffer();
}

async function renderAnimeCatalogCard(url, { isAllowedSource, calendarCardSvg }) {
  const sources = [...new Set(['src', 'fallback'].map(k => url.searchParams.get(k)).filter(Boolean))];
  if (!sources.length || sources.some(src => !isAllowedSource(src))) {
    const error = new Error('Invalid anime artwork source'); error.status = 400; throw error;
  }
  const title = String(url.searchParams.get('title') || '').slice(0, 100);
  const append = String(url.searchParams.get('append') || '').slice(0, 180);
  const type = url.searchParams.get('type') === 'movie' ? 'movie' : 'series';
  const key = JSON.stringify(['anime-calendar-16x9-v1', sources, title, append, type]);
  return artworkCache.render(key, async () => {
    let photo = null, selectedSource = null;
    for (const src of sources) {
      try { photo = await artworkCache.photo(src); selectedSource = src; break; } catch (_) {}
    }
    return artworkCache.raster(async () => {
      const imageDataUri = photo
        ? 'data:image/jpeg;base64,' + (await landscapeArtwork(photo.bytes)).toString('base64')
        : null;
      // Reuse the collection engine's Calendar layout: the same blue footer,
      // title, date/episode typography and badges as the other catalogues.
      const svg = calendarCardSvg({ imageDataUri, title, provider: 'Anime JP/KR', append, type, layout: 'landscape' });
      const data = await sharp(Buffer.from(svg)).resize(1600, 900)
        .jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
      return { data, photo: Boolean(photo), selectedSource, cacheable: Boolean(photo) };
    });
  });
}

module.exports = { landscapeArtwork, renderAnimeCatalogCard };
