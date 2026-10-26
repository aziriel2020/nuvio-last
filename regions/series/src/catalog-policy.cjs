'use strict';

const { AVAILABILITY_TTL } = require('./france.cjs');
const REVISION = 'fr-major-platforms-20261026-v1';
// Explicit brands and their own subscription channels. An arbitrary Amazon
// channel (M6+, France TV, etc.) never inherits Prime Video eligibility.
const MAJOR_SERVICES = Object.freeze([
  { name: 'Netflix', ids: [8,1796] },
  { name: 'Prime Video', ids: [119,2100] },
  { name: 'HBO Max', ids: [1899,1825] },
  { name: 'Apple TV+', ids: [350,2243] },
  { name: 'Disney+', ids: [337] },
  { name: 'CANAL+', ids: [381,345] },
  { name: 'Paramount+', ids: [531,582,1853,2303] },
  { name: 'Universal+', ids: [1889] },
  { name: 'Ciné+ OCS', ids: [685] },
  { name: 'MUBI', ids: [11,201] }
]);
const MAJOR_IDS = Object.freeze(MAJOR_SERVICES.flatMap(p => p.ids));
const VOD_STORES = Object.freeze([
  { name: 'Apple TV Store', ids: [2] }, { name: 'Amazon Video', ids: [10] },
  { name: 'Canal VOD', ids: [58] }, { name: 'Orange VOD', ids: [61] },
  { name: 'Rakuten TV', ids: [35] }, { name: 'Pathé Home', ids: [2601] }
]);
const VOD_IDS = Object.freeze(VOD_STORES.flatMap(p => p.ids));
const SPECIALIST_GENRES = Object.freeze(['99','10764','10767']);
const isSpecialistGenre = genre => SPECIALIST_GENRES.includes(String(genre));
const isMajorProvider = id => MAJOR_IDS.includes(Number(id));
const isVodProvider = id => VOD_IDS.includes(Number(id));
const allowedOffer = (offer, scope = 'streaming') => scope === 'vod'
  ? isVodProvider(offer.provider_id ?? offer.providerId) && ['rent','buy'].includes(offer.kind)
  : isMajorProvider(offer.provider_id ?? offer.providerId) && ['flatrate','free','ads'].includes(offer.kind);

const genreClause = (genre, alias = 's') => `EXISTS (SELECT 1 FROM json_each(${alias}.genres) WHERE CAST(value AS TEXT)='${genre}')`;
function broadcastClause(alias = 's') {
  return `(EXISTS (SELECT 1 FROM json_each(${alias}.genres) WHERE CAST(value AS TEXT) IN ('99','10764','10767','10763'))
    OR EXISTS (SELECT 1 FROM sources bs WHERE bs.show_id=${alias}.id
      AND LOWER(CAST(json_extract(bs.payload,'$.sourceType') AS TEXT)) IN
      ('documentary','reality','talk show','news','game show','sports','variety','award show','video')))`;
}
function offerClause(scope = 'streaming', alias = 's') {
  const ids = scope === 'vod' ? VOD_IDS : MAJOR_IDS;
  const kinds = scope === 'vod' ? "'rent','buy'" : "'flatrate','free','ads'";
  // Discovery from an unrestricted directory cannot prove a major-platform
  // offer. Require fresh, explicit per-title FR availability before admission.
  return `EXISTS (SELECT 1 FROM sources ps
    JOIN fr_availability pa ON pa.tmdb_id=ps.source_id
    JOIN fr_offers po ON po.tmdb_id=ps.source_id
    WHERE ps.source='tmdb' AND ps.show_id=${alias}.id AND pa.available=1
      AND pa.evidence='watch-providers-FR' AND pa.checked_at>${Date.now()-AVAILABILITY_TTL}
      AND po.provider_id IN (${ids.join(',')}) AND po.kind IN (${kinds}))`;
}
function seriesClause(alias = 's') {
  return `((NOT ${broadcastClause(alias)} AND ${offerClause('streaming',alias)})
    OR EXISTS (SELECT 1 FROM json_each(${alias}.genres) WHERE CAST(value AS TEXT) IN ('99','10764','10767')))`;
}
function policy() {
  return { revision: REVISION, majorServices: MAJOR_SERVICES.map(p => p.name),
    vodStores: VOD_STORES.map(p => p.name), specialistOnlyGenres: [...SPECIALIST_GENRES],
    specialistOnlyLabels: ['Documentaires','Téléréalité','Talk-shows'],
    replayCollections: false, animationExcluded: true, discoverCategory: false };
}
module.exports = { REVISION, MAJOR_SERVICES, MAJOR_IDS, VOD_STORES, VOD_IDS,
  SPECIALIST_GENRES, isSpecialistGenre, isMajorProvider, isVodProvider, allowedOffer,
  genreClause, broadcastClause, offerClause, seriesClause, policy };
