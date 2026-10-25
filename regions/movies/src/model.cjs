'use strict';

const { isoDate, unique, classify, localDay, shiftDay, windowFor, catalogWindowFor, WESTERN_GENRE, periods } = require('../../series/src/model.cjs');
const { offersInFrance } = require('../../series/src/france.cjs');
const ADDON_ID = 'com.nuvio.movies.france.world.v1';
const VERSION = '1.0.1';
const GENRES = Object.freeze([
  ['all', 'Tous les films', 'all'], ['28', 'Action', 'action'], ['12', 'Aventure', 'adventure'],
  ['35', 'Comédie', 'comedy'], ['80', 'Crime / Policier', 'crime'], ['99', 'Documentaires', 'documentary'],
  ['18', 'Drame', 'drama'], ['10751', 'Famille', 'family'], ['14', 'Fantastique', 'fantasy'],
  ['36', 'Histoire', 'history'], ['27', 'Horreur', 'horror'], ['10402', 'Musique', 'music'],
  ['9648', 'Mystère', 'mystery'], ['10749', 'Romance', 'romance'], ['878', 'Science-fiction', 'science-fiction'],
  ['10770', 'Téléfilms', 'tv-movie'], ['53', 'Thriller', 'thriller'], ['10752', 'Guerre', 'war'],
  ['37', 'Western', 'western'], ['unclassified', 'Genre non renseigné', 'unclassified']
].map(([id, name, slug]) => Object.freeze({ id, name, slug })));
const VIEWS = Object.freeze([
  { id: 'all', name: 'Films Monde · Toutes les sorties' },
  { id: 'streaming', name: 'Films Monde · Streaming' },
  { id: 'vod', name: 'Films Monde · VOD' },
  { id: 'cinema', name: 'Films Monde · Cinéma' }
]);

function fromTmdb(data) {
  if (!Number.isSafeInteger(data?.id) || data.id < 1) throw new Error('Invalid TMDB movie ID');
  const genres = unique((data.genres || []).map((g) => g.id));
  const keywords = (data.keywords?.keywords || data.keywords?.results || []).map((k) => k.name);
  const regional = (data.release_dates?.results || []).find((r) => r.iso_3166_1 === 'FR');
  const releases = (regional?.release_dates || []).flatMap((r) => {
    const kind = [2, 3].includes(Number(r.type)) ? 'cinema' : Number(r.type) === 4 ? 'digital' : null;
    const date = isoDate(String(r.release_date || '').slice(0, 10));
    return kind && date ? [{ kind, date, proof: 'release_dates.FR' }] : [];
  });
  return {
    key: `tmdb:${data.id}`, source: 'tmdb', sourceId: data.id,
    imdbId: /^tt\d+$/.test(data.imdb_id || data.external_ids?.imdb_id || '') ? (data.imdb_id || data.external_ids.imdb_id) : null,
    title: data.title || data.original_title || `Film ${data.id}`, originalTitle: data.original_title || null,
    description: data.overview || null, firstAirDate: isoDate(data.release_date),
    poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
    background: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
    genres, classification: classify({ genres, keywords }), countries: (data.production_countries || []).map((c) => c.iso_3166_1),
    languages: unique([data.original_language]), status: data.status || null, runtime: Number(data.runtime) || null,
    franceOffers: Object.hasOwn(data, 'watch/providers') ? offersInFrance(data) : undefined,
    releases, releasesComplete: Object.hasOwn(data, 'release_dates')
  };
}
function candidateRecord(data) { return fromTmdb({ ...data, genres: (data.genre_ids || []).map((id) => ({ id })) }); }
function catalogId(view, genre, period) { return `movies-fr-${view}-${genre}-${period}`; }
function parseCatalog(id) {
  const m = String(id).match(/^movies-fr-(all|streaming|vod|cinema)-([a-z0-9]+)-(all|today|tomorrow|yesterday|lastweek|nextweek|before1900|undated|\d{4}(?:-\d{2})?)$/);
  return m && GENRES.some((g) => g.id === m[2]) ? { view: m[1], genre: m[2], period: m[3] } : null;
}
module.exports = { ADDON_ID, VERSION, GENRES, VIEWS, fromTmdb, candidateRecord, catalogId, parseCatalog, isoDate, localDay, shiftDay, windowFor, catalogWindowFor, WESTERN_GENRE, periods };
