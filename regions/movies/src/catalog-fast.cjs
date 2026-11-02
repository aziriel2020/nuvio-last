'use strict';

// Films Monde lightweight catalogue projection. Details still use MovieStore.meta.
// One batched provider query replaces per-film sources/offers/lane/release lookups.
// All calendar filtering, catalogue IDs and provider eligibility stay in the
// authoritative MovieStore.query SQL; only the payload construction is cheaper.
const { AVAILABILITY_TTL } = require('../../series/src/france.cjs');
const policy = require('../../series/src/catalog-policy.cjs');
const { GENRES, displayDateForPremiere } = require('./model.cjs');
const { RECORDS } = require('../../../runtime/verified-streaming-premieres.cjs');
const VERIFIED = RECORDS.filter(p => p.market === 'FR' && p.type === 'movie');
const byTmdbId = new Map(VERIFIED.map(p => [p.tmdbId, p]));

function readGenres(value) {
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function batchedOffers(store, rows) {
  const result = new Map();
  if (!rows.length) return result;
  const keys = [...new Set(rows.map(row => row.id))];
  const placeholders = keys.map(() => '?').join(',');
  const sql = `SELECT src.show_id, offers.*
    FROM sources src
    JOIN fr_offers offers ON offers.tmdb_id=src.source_id
    JOIN movie_lanes lane ON lane.tmdb_id=offers.tmdb_id
      AND lane.kind=(CASE WHEN offers.kind IN ('rent','buy') THEN 'vod' ELSE 'streaming' END)
      AND lane.available=1 AND lane.checked_at>?
    WHERE src.source='tmdb' AND src.show_id IN (${placeholders})
    ORDER BY offers.name,offers.kind`;
  for (const offer of store.db.prepare(sql).all(Date.now() - AVAILABILITY_TTL, ...keys)) {
    if (!result.has(offer.show_id)) result.set(offer.show_id, []);
    result.get(offer.show_id).push(offer);
  }
  return result;
}
function fastMovieMetas(store, rows, { view = 'all', genre = 'all', curated = false, now = new Date() } = {}) {
  if (!rows.length) return [];
  const offersByMovie = batchedOffers(store, rows);
  const nowMs = +new Date(now);
  return rows.map(row => {
    const tmdbId = Number(row.catalog_tmdb_id || String(row.id).replace(/^tmdb:/, ''));
    const sourceId = Number.isSafeInteger(tmdbId) && tmdbId > 0 ? tmdbId : null;
    const imdb = row.catalog_imdb_id || undefined;
    const official = sourceId ? byTmdbId.get(sourceId) : null;
    const verified = official && nowMs >= Date.parse(official.platformDate + 'T00:00:00Z') ? official : null;
    const specialist = genre === '99' || genre === 'standup';
    const offers = (offersByMovie.get(row.id) || []).filter(o =>
      !curated || specialist ||
      (view !== 'vod' && policy.allowedOffer(o)) ||
      (view !== 'streaming' && policy.allowedOffer(o, 'vod')));
    const streaming = [...new Set([
      ...offers.filter(o => ['flatrate','free','ads'].includes(o.kind)).map(o => o.name),
      ...(verified ? [verified.providerLabel] : [])
    ])];
    const vod = [...new Set(offers.filter(o => ['rent','buy'].includes(o.kind)).map(o => o.name))];
    const names = [...new Set([...offers.map(o => o.name),
      ...(verified && view !== 'vod' ? [verified.providerLabel] : [])])];
    const date = row.event_date || row.first_air_date;
    const tags = readGenres(row.genres);
    const id = imdb || (sourceId ? `tmdb:movie:${sourceId}` : row.id);
    return {
      id, type:'movie', name:row.title, poster:row.poster || undefined,
      background:row.background || row.poster || undefined, posterShape:'poster',
      streamingProviders:names, providersByKind:{streaming,vod},
      movieContentKind:row.content_kind, movieReleaseKind:'original',
      originalReleaseDate:verified?.worldPremiereDate || row.first_air_date || null,
      released:date ? `${date}T00:00:00.000Z` : undefined,
      releaseInfo:row.first_air_date?.slice(0,4) || 'Date inconnue',
      genres:genre === 'standup' ? ['Stand-up'] : GENRES.filter(g => tags.includes(g.id)).map(g => g.name),
      description:row.description || undefined, imdb_id:imdb,
      links:[
        ...(sourceId ? [{name:'TMDB',category:'Sources',url:`https://www.themoviedb.org/movie/${sourceId}`}] : []),
        ...(verified ? [
          {name:`Regarder sur ${verified.providerLabel}`,category:'Regarder',url:verified.watchUrl},
          {name:'Sortie streaming vérifiée',category:'Sources',url:verified.officialSource}
        ] : [])
      ]
    };
  });
}
module.exports = { fastMovieMetas, batchedOffers };
