'use strict';

const MARKET = 'FR';
const OFFER_TYPES = Object.freeze(['flatrate', 'free', 'ads', 'rent', 'buy']);
const AVAILABILITY_TTL = 48 * 3600000;

function offersInFrance(payload) {
  const country = payload?.['watch/providers']?.results?.FR || payload?.results?.FR;
  if (!country) return [];
  const rows = OFFER_TYPES.flatMap((kind) => (country[kind] || []).filter((p) => Number.isSafeInteger(p.provider_id) && p.provider_id > 0).map((p) => ({
    providerId: p.provider_id, name: p.provider_name || `Plateforme ${p.provider_id}`, kind,
    logo: p.logo_path ? `https://image.tmdb.org/t/p/w185${p.logo_path}` : null,
    url: country.link || null
  })));
  return [...new Map(rows.map((row) => [`${row.providerId}:${row.kind}`, row])).values()];
}

function providerDirectory(payload) {
  if (!Array.isArray(payload?.results)) throw new Error('Invalid France provider directory');
  const map = new Map();
  for (const p of payload.results) {
    if (Number.isSafeInteger(p.provider_id) && p.provider_id > 0 && p.provider_name) map.set(p.provider_id, {
      id: p.provider_id, name: p.provider_name,
      logo: p.logo_path ? `https://image.tmdb.org/t/p/w185${p.logo_path}` : null
    });
  }
  if (!map.size) throw new Error('Empty France provider directory; previous state retained');
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function discoverParams(providerIds, page = 1, dates = {}) {
  if (!providerIds.length) throw new Error('France discovery needs provider IDs');
  return {
    language: 'fr-FR', watch_region: MARKET, with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: OFFER_TYPES.join('|'), without_genres: '16',
    include_null_first_air_dates: true, include_adult: false,
    sort_by: 'first_air_date.desc', page, ...dates
  };
}

module.exports = { MARKET, OFFER_TYPES, AVAILABILITY_TTL, offersInFrance, providerDirectory, discoverParams };
