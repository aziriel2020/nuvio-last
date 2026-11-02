'use strict';

// Approved prebuilt WebP genre artwork only. Films Monde now serves TMDB
// photos directly and never rasterizes/encodes individual movie cards.
const fs = require('node:fs');
const path = require('node:path');
const { GENRES } = require('./model.cjs');
const ROOT = path.resolve(__dirname, '../../../assets/movie-covers');
const REVISION = 'movies-premium-20261025-v2';

function genreBytes(id) {
  if (!GENRES.some((g) => g.id === id)) return null;
  const filename = path.join(ROOT, `${id}.webp`);
  return fs.existsSync(filename) ? fs.readFileSync(filename) : null;
}
function progress() {
  const loaded = GENRES.filter((g) => fs.existsSync(path.join(ROOT, `${g.id}.webp`))).length;
  return { loaded, total: GENRES.length, ready: loaded === GENRES.length, version: REVISION };
}
module.exports = { ROOT, REVISION, genreBytes, progress };
