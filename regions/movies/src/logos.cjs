'use strict';

// TMDB /movie/{id}?append_to_response=images delivers logos in the existing
// detail request. No per-card API calls, image downloads, or Oracle rasterizers.
const TMDB_CDN = 'https://image.tmdb.org/t/p/w500';
const VALID_FILE = /^\/[a-zA-Z0-9_/-]{1,210}\.(?:png|webp)$/;
const LANGUAGE_ORDER = ['fr', 'en', null];

function selectMovieLogo(images, originalLanguage = '') {
  if (!Array.isArray(images?.logos)) return null;
  const original = /^[a-z]{2}$/i.test(originalLanguage) ? originalLanguage.toLowerCase() : null;
  const languages = ['fr', original, 'en', null].filter((x, i, a) => a.indexOf(x) === i);
  const valid = images.logos.filter(logo =>
    logo && typeof logo.file_path === 'string' && VALID_FILE.test(logo.file_path)
    && Number.isFinite(Number(logo.width)) && Number(logo.width) >= 150
    && Number.isFinite(Number(logo.height)) && Number(logo.height) > 0);
  if (!valid.length) return null;
  valid.sort((a, b) => {
    const lang = l => {
      const index = languages.indexOf(l.iso_639_1 ?? null);
      return index === -1 ? languages.length : index;
    };
    const delta = lang(a) - lang(b);
    if (delta) return delta;
    const quality = l => Number(l.vote_average || 0) * Math.log1p(Number(l.vote_count || 0)) +
      Math.min(Number(l.width || 0), 2000) / 1000;
    return quality(b) - quality(a);
  });
  const best = valid[0];
  return {
    url: TMDB_CDN + best.file_path,
    language: best.iso_639_1 || null,
    width: Number(best.width),
    height: Number(best.height)
  };
}

module.exports = { selectMovieLogo, TMDB_CDN };
