'use strict';
// Provenance-checked platform premieres. A dated provider announcement and a
// regional availability proof are required before an entry is published.
// The registry applies to ALL provider movie collections, not just Prime/FR.
const { day, isInside } = require('./streaming-release-recovery.cjs');

const RECORDS = Object.freeze([
  // Amazon confirms this release is global (240+ territories); these
  // country-specific Prime Video parents exist and use the same platform date.
  Object.freeze({
    market: 'US', type: 'movie', providerSlug: 'prime-video',
    providerLabel: 'Prime Video', tmdbId: 1507696, imdbId: 'tt37522541',
    title: 'Apocalypse Z: New World',
    originalTitle: 'Apocalipsis Z: Nuevo mundo',
    platformDate: '2026-10-30',
    overview: 'Following the TSJ outbreak, a team crosses from the Canary Islands to Madrid to collect essential supplies.',
    officialSource: 'https://www.aboutamazon.com/news/entertainment/apocalypse-z-2-new-world-sequel-prime-video',
    regionalSource: 'https://www.aboutamazon.com/news/entertainment/halloween-movies-shows-on-prime-video',
    watchUrl: 'https://www.primevideo.com/detail/0NBVXAJ6EQW7OTHPOIWASZ9313'
  }),
  Object.freeze({
    market: 'TR', type: 'movie', providerSlug: 'prime-video',
    providerLabel: 'Prime Video', tmdbId: 1507696, imdbId: 'tt37522541',
    title: 'Apocalypse Z: New World',
    originalTitle: 'Apocalipsis Z: Nuevo mundo',
    platformDate: '2026-10-30',
    overview: 'Following the TSJ outbreak, a team crosses from the Canary Islands to Madrid to collect essential supplies.',
    officialSource: 'https://www.aboutamazon.com/news/entertainment/apocalypse-z-2-new-world-sequel-prime-video',
    regionalSource: 'https://www.aboutamazon.com/news/entertainment/apocalypse-z-2-new-world-sequel-prime-video',
    watchUrl: 'https://www.primevideo.com/detail/0NBVXAJ6EQW7OTHPOIWASZ9313'
  }),
  Object.freeze({
    market: 'FR', type: 'movie', providerSlug: 'prime-video',
    providerLabel: 'Prime Video', tmdbId: 1507696, imdbId: 'tt37522541',
    title: 'Apocalypse Z : Nouveau Monde',
    // Sitges' official 2026 announcement dates the first festival screening to 10 October.
    worldPremiereDate: '2026-10-10',
    worldPremiereSource: 'https://sitgesfilmfestival.com/es/noticies/kevin-bacon-kyra-sedgwick-meiko-kaji-adrienne-barbeau-nuevos-premios-sitges-2026',
    originalTitle: 'Apocalipsis Z: Nuevo mundo',
    platformDate: '2026-10-30',
    overview: 'Aux Canaries, une équipe part chercher des provisions sur le continent, au milieu des infectés.',
    officialSource: 'https://www.aboutamazon.com/news/entertainment/apocalypse-z-2-new-world-sequel-prime-video',
    regionalSource: 'https://www.justwatch.com/fr/film/apocalypse-z-nouveau-monde',
    watchUrl: 'https://www.primevideo.com/detail/0NBVXAJ6EQW7OTHPOIWASZ9313'
  })
]);
function assertValid(p) {
  if (!['FR','US','TR','GLOBAL'].includes(p.market)) throw Error('Invalid verified-premiere market');
  if (p.type !== 'movie' || !/^[a-z0-9-]+$/.test(p.providerSlug)) throw Error('Invalid verified-premiere type/provider');
  if (!Number.isSafeInteger(p.tmdbId) || p.tmdbId < 1 || !day(p.platformDate)) throw Error('Invalid verified-premiere ID/date');
  if (!p.title || !p.providerLabel || !p.officialSource || !p.regionalSource || !p.watchUrl) throw Error('Unverified premiere evidence');
  if ((p.worldPremiereDate || p.worldPremiereSource) && (!day(p.worldPremiereDate) || !p.worldPremiereSource || p.worldPremiereDate > p.platformDate)) throw Error('Invalid original worldwide premiere evidence');
  for (const url of [p.officialSource,p.regionalSource,p.watchUrl,p.worldPremiereSource].filter(Boolean)) {
    if (new URL(url).protocol !== 'https:') throw Error('Insecure premiere evidence');
  }
}
for (const row of RECORDS) assertValid(row);
if (new Set(RECORDS.map(p=>[p.market,p.type,p.providerSlug,p.tmdbId,p.platformDate].join(':'))).size !== RECORDS.length) {
  throw Error('Duplicate verified-premiere record');
}
function verifiedForCatalog(catalog, window, market) {
  if (catalog?.type !== 'movie') return [];
  return RECORDS.filter(p => p.market === market && p.type === catalog.type &&
    p.providerSlug === catalog.providerSlug && isInside(p.platformDate,window));
}
function verifiedMeta(premiere, details, baseMeta, formatDate = (d)=>d, marketLabel = 'Streaming') {
  assertValid(premiere);
  const source = {
    ...(details || {}),
    id: premiere.tmdbId,
    imdb_id: premiere.imdbId || details?.imdb_id,
    external_ids: {
      ...(details?.external_ids || {}),
      imdb_id: premiere.imdbId || details?.external_ids?.imdb_id
    },
    title: premiere.title,
    original_title: premiere.originalTitle,
    overview: details?.overview || premiere.overview
  };
  const label = premiere.providerLabel;
  const meta = baseMeta(source,'movie',premiere.platformDate,
    `Première ${label} • ${formatDate(premiere.platformDate)}`);
  meta._calendarProvider = label;
  meta._calendarSource = 'verified-platform-premiere';
  meta.description = [
    `Sortie ${label} ${marketLabel} : ${formatDate(premiere.platformDate)} (date plateforme vérifiée, différente de la première mondiale).`,
    meta.description
  ].filter(Boolean).join('\n\n');
  meta.links = [
    { name: `Regarder sur ${label}`, category: 'Regarder', url: premiere.watchUrl },
    { name: 'Annonce officielle', category: 'Sources', url: premiere.officialSource },
    { name: 'Disponibilité régionale', category: 'Sources', url: premiere.regionalSource }
  ];
  return meta;
}
// Mandatory provenance-confirmed premieres must never be crowded out by
// popularity/size limits. Sort chronology without sacrificing the proof set.
function retainVerifiedMetas(sorted, maxItems) {
  const max = Math.max(0, Number(maxItems) || 0);
  const required = sorted.filter(meta => meta?._calendarSource === 'verified-platform-premiere');
  const others = sorted.filter(meta => meta?._calendarSource !== 'verified-platform-premiere');
  const chosen = [...others.slice(0, Math.max(0, max - required.length)), ...required].slice(0, max);
  const order = new Map(sorted.map((meta, index) => [meta._dedupeKey || meta.id, index]));
  return chosen.sort((a, b) => (order.get(a._dedupeKey || a.id) || 0) - (order.get(b._dedupeKey || b.id) || 0));
}
module.exports = { RECORDS, assertValid, verifiedForCatalog, verifiedMeta, retainVerifiedMetas };
