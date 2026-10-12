'use strict';

// Strict TMDb evidence detector. Air dates are NOT a guarantee that video is
// actually playable: unknown, partial, weekly and unverified seasons fail closed.
const { localIsoDate, addIsoDays, normalizeIsoDate } = require('./calendar');

const BINGE_PERIODS = Object.freeze([
  { key: 'thisweek', label: 'Cette semaine' },
  { key: 'lastweek', label: 'Semaine passée' },
  { key: 'thismonth', label: 'Ce mois-ci' },
  { key: 'lastmonth', label: 'Le mois dernier' },
  { key: 'thisyear', label: 'Cette année' }
]);

function bingeWatchWindow(period, now = new Date(), timeZone = 'Europe/Paris') {
  if (!BINGE_PERIODS.some((p) => p.key === period)) return null;
  const today = localIsoDate(now, timeZone);
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const monday = addIsoDays(today, -((weekday + 6) % 7));
  const [year, month] = today.split('-').map(Number);
  let start;
  let end = today;
  if (period === 'thisweek') start = monday;
  if (period === 'lastweek') {
    start = addIsoDays(monday, -7);
    end = addIsoDays(monday, -1);
  }
  if (period === 'thismonth') start = today.slice(0, 7) + '-01';
  if (period === 'lastmonth') {
    const d = new Date(Date.UTC(year, month - 2, 1));
    start = d.toISOString().slice(0, 10);
    end = addIsoDays(today.slice(0, 7) + '-01', -1);
  }
  if (period === 'thisyear') start = year + '-01-01';
  return { start, end, today, kind: 'binge-' + period, allowPast: true };
}

function frenchStreamingProviders(details) {
  const region = details && details['watch/providers'] &&
    details['watch/providers'].results && details['watch/providers'].results.FR;
  if (!region) return [];
  const entries = [...(region.flatrate || []), ...(region.free || []), ...(region.ads || [])];
  return [...new Set(entries.filter((p) => p && Number.isFinite(Number(p.provider_id)))
    .map((p) => String(p.provider_name || p.provider_id)))];
}

function fullSeasonDrop(details, summary, season, window) {
  if (!details || !summary || !season || !window) return null;
  const seasonNumber = Number(summary.season_number);
  const count = Number(summary.episode_count);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 ||
      !Number.isInteger(count) || count < 2 || count > 50 ||
      Number(season.season_number) !== seasonNumber) return null;

  const providers = frenchStreamingProviders(details);
  if (!providers.length) return null;
  if (!Array.isArray(season.episodes) || season.episodes.length !== count) return null;

  const episodeNumbers = new Set();
  let releaseDate = null;
  for (const episode of season.episodes) {
    const number = Number(episode && episode.episode_number);
    const date = normalizeIsoDate(episode && episode.air_date);
    if (!Number.isInteger(number) || number < 1 || number > count ||
        episodeNumbers.has(number) || !date || date > window.today) return null;
    if (releaseDate !== null && date !== releaseDate) return null;
    releaseDate = date;
    episodeNumbers.add(number);
  }
  if (episodeNumbers.size !== count || releaseDate < window.start ||
      releaseDate > window.end) return null;

  const declaredStart = normalizeIsoDate(summary.air_date);
  const seasonStart = normalizeIsoDate(season.air_date);
  if ((declaredStart && declaredStart !== releaseDate) ||
      (seasonStart && seasonStart !== releaseDate)) return null;

  return {
    seasonNumber,
    episodeCount: count,
    releaseDate,
    providers,
    isMiniseries: String(details.type || '').toLowerCase() === 'miniseries',
    evidence: 'tmdb-all-episodes-same-day-and-fr-watch-provider'
  };
}

module.exports = { BINGE_PERIODS, bingeWatchWindow, frenchStreamingProviders, fullSeasonDrop };
