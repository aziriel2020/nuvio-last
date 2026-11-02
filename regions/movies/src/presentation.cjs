'use strict';

// Films Monde V4: catalog artwork is always the original upstream TMDB image.
// Nuvio's native Custom Posters resolver applies the approved SVG V4 overlay.
// Never construct a /fr/calendar-card.jpg, desktop-content-card.jpg or other
// server JPEG: even the *canonical* addon must avoid that legacy pipeline.
// The original calendar/catalog selection, IDs, periods and dates stay intact.
const { resolveNativeImage } = require('../../runtime/native-bridge.cjs');

// Real film logos are reserved for the V4 vector, so Nuvio Modern Home must
// not draw a second title above the approved composition. This lightweight
// transparent SVG is already supported by the France addon; no raster work.
function transparentTitleLogo(origin) {
  return new URL('../fr/calendar-transparent-logo.svg?v=films-world-native-v4', origin).href;
}

// Detail metadata is deliberately distinct: it retains TMDB's original artwork
// and does not publish the transparent catalog-only logo.
function withoutFilmTitleLogo(meta) {
  const clean = { ...meta };
  delete clean.logo;
  delete clean.titleLogoUrl;
  return clean;
}

function decorateMovieMetas(origin, metas, _descriptor) {
  const root = new URL(origin).origin;
  return (metas || []).map(meta => {
    const portrait = resolveNativeImage(meta.poster, 'poster', root);
    // The store copies the portrait into background when TMDB has no backdrop.
    // Do not label that fallback as a genuine widescreen film backdrop.
    const hasRealBackdrop = Boolean(meta.background && meta.background !== meta.poster);
    const backdrop = hasRealBackdrop
      ? resolveNativeImage(meta.background, 'background', root) : null;
    const landscape = hasRealBackdrop
      ? resolveNativeImage(meta.background, 'landscapePoster', root) : null;
    const wide = landscape || backdrop;
    const image = wide || portrait;
    const decorated = { ...meta };
    // Never leak a precomposed renderer URL from imported or legacy metadata.
    for (const key of ['poster', 'background', 'landscapePoster', 'banner']) {
      delete decorated[key];
    }
    delete decorated.logo;
    delete decorated.titleLogoUrl;
    if (image) {
      decorated.poster = image;
      decorated.background = backdrop || portrait || image;
      decorated.landscapePoster = wide || portrait || image;
      decorated.banner = wide || portrait || image;
      decorated.posterShape = wide ? 'landscape' : 'poster';
      decorated.logo = transparentTitleLogo(origin);
      if (wide && portrait && wide !== portrait) decorated._rawPosterUrl = portrait;
    }
    return decorated;
  });
}

module.exports = { decorateMovieMetas, withoutFilmTitleLogo };
