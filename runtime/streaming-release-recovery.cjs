'use strict';

// Shared across FR, US, TR and Global streaming platform catalogs.
// TMDb digital release (type 4) remains authoritative. A second discovery
// path looks for ORIGINAL releases that are already available on the exact
// requested platform; never infer a later streaming launch from old cinema.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function day(value) {
  const text = String(value || '').slice(0, 10);
  if (!ISO_DAY.test(text)) return null;
  const dt = new Date(text + 'T00:00:00Z');
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === text ? text : null;
}
function isInside(date, window) {
  return Boolean(date && window?.start && window?.end && !window?.empty &&
    date >= window.start && date <= window.end);
}
function secondaryMovieDiscoveryParams(primaryParams, window) {
  if (!window?.start || !window?.end || window.empty) return null;
  const params = { ...primaryParams };
  delete params['release_date.gte'];
  delete params['release_date.lte'];
  delete params.with_release_type;
  delete params.region;
  params['primary_release_date.gte'] = window.start;
  params['primary_release_date.lte'] = window.end;
  return params;
}
function originalPremiereWhenDigitalMissing(details, window, market) {
  const release = day(details?.release_date);
  if (!isInside(release, window)) return null;
  const results = details?.release_dates?.results || [];
  // A known digital date for this market (or any market in Global) must never
  // be replaced by the original theatrical/first-release date.
  const digitalDates = results
    .filter(group => !market || group?.iso_3166_1 === market)
    .flatMap(group => group?.release_dates || [])
    .filter(entry => Number(entry?.type) === 4 && day(entry?.release_date));
  if (digitalDates.length) return null;
  return { date: release, type: 'original-premiere', proof: 'tmdb-original+confirmed-provider' };
}
function mergeCandidatePages(primary, secondary, maxCandidates = 80) {
  const found = new Map();
  for (const item of [...(primary || []), ...(secondary || [])]) {
    const id = Number(item?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || found.has(id)) continue;
    found.set(id, item);
    if (found.size >= maxCandidates) break;
  }
  return [...found.values()];
}
module.exports = { day, isInside, secondaryMovieDiscoveryParams, originalPremiereWhenDigitalMissing, mergeCandidatePages };
