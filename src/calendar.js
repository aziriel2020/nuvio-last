'use strict';

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_COUNTRY = 'US';
const DEFAULT_LANGUAGE = 'en-US';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/';

const EVENT_MODES = Object.freeze({
  BROADCAST_INSTANT: 'BROADCAST_INSTANT',
  STREAMING_DATE: 'STREAMING_DATE',
  STREAMING_INSTANT: 'STREAMING_INSTANT',
  LIVE_GLOBAL_INSTANT: 'LIVE_GLOBAL_INSTANT',
  ANIME_ORIGINAL_AIRING: 'ANIME_ORIGINAL_AIRING'
});

function isValidTimeZone(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(value = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function isoDateFromParts(parts) {
  if (!parts) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function timeFromParts(parts) {
  if (!parts) return null;
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function addIsoDays(isoDate, offsetDays = 0) {
  const date = normalizeIsoDate(isoDate);
  if (!date) return null;
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function localIsoDate(now = new Date(), timeZone = DEFAULT_TIMEZONE, offsetDays = 0) {
  const date = isoDateFromParts(zonedParts(now, timeZone));
  return addIsoDays(date, offsetDays);
}

function localTime(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return timeFromParts(zonedParts(now, timeZone));
}

function dateWindow(period = 'week', now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const today = localIsoDate(now, timeZone, 0);
  if (period === 'today') return { start: today, end: today, kind: 'today', today };
  if (period === 'tomorrow') {
    const tomorrow = addIsoDays(today, 1);
    return { start: tomorrow, end: tomorrow, kind: 'tomorrow', today };
  }
  if (period === 'upcoming' || period === 'future') {
    return { start: addIsoDays(today, 1), end: addIsoDays(today, 6), kind: 'upcoming', today };
  }
  return { start: today, end: addIsoDays(today, 6), kind: 'week', today };
}

function normalizeIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const date = match[1];
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return date;
}

function isDateInWindow(value, window) {
  const date = normalizeIsoDate(value);
  if (!date || !window?.start || !window?.end) return false;
  return date >= window.start && date <= window.end;
}

function classifyDate(value, window) {
  const date = normalizeIsoDate(value);
  if (!date) return 'unknown';
  if (date < window.today) return 'past';
  if (date < window.start || date > window.end) return 'outside';
  return 'inside';
}

function humanDate(value, timeZone = DEFAULT_TIMEZONE, today = null) {
  const date = normalizeIsoDate(value);
  if (!date) return null;
  const localToday = today || localIsoDate(new Date(), timeZone, 0);
  const tomorrow = addIsoDays(localToday, 1);
  if (date === localToday) return 'Aujourd’hui';
  if (date === tomorrow) return 'Demain';
  const parsed = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(parsed);
}

function humanCalendarDate(value) {
  const date = normalizeIsoDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`));
}

function timeZoneShortName(value, timeZone) {
  if (!isValidTimeZone(timeZone)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short'
  }).formatToParts(date);
  return parts.find((part) => part.type === 'timeZoneName')?.value || null;
}

function viewerDateTimeFromInstant(value, timeZone = DEFAULT_TIMEZONE) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = zonedParts(instant, timeZone);
  return {
    instant: instant.toISOString(),
    date: isoDateFromParts(parts),
    time: timeFromParts(parts),
    timeZone,
    timeZoneLabel: timeZoneShortName(instant, timeZone)
  };
}

// Convert a wall-clock time in an IANA timezone into an absolute instant.
// Intl exposes zone conversion but not a direct constructor, so this converges
// on the correct UTC instant by re-evaluating the zone offset around the target.
function zonedDateTimeToUtc(date, timeZone = DEFAULT_TIMEZONE, time = '00:00:00') {
  const normalized = normalizeIsoDate(date);
  if (!normalized || !isValidTimeZone(timeZone)) return null;
  const match = String(time || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const desiredWallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = desiredWallAsUtc;
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    if (!parts) return null;
    const representedWallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = desiredWallAsUtc - representedWallAsUtc;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate);
}

function viewerWindowEpochBounds(window, timeZone = DEFAULT_TIMEZONE) {
  const start = zonedDateTimeToUtc(window.start, timeZone, '00:00:00');
  const endExclusive = zonedDateTimeToUtc(addIsoDays(window.end, 1), timeZone, '00:00:00');
  if (!start || !endExclusive) return null;
  return {
    startMs: start.getTime(),
    endExclusiveMs: endExclusive.getTime(),
    startEpoch: Math.floor(start.getTime() / 1000),
    endExclusiveEpoch: Math.floor(endExclusive.getTime() / 1000)
  };
}

function buildInstantEvent({
  eventMode,
  eventInstant,
  viewerTimezone = DEFAULT_TIMEZONE,
  window,
  sourceTimezone = null,
  sourceDate = null,
  sourceTime = null,
  calendarDate = null
}) {
  const viewer = viewerDateTimeFromInstant(eventInstant, viewerTimezone);
  if (!viewer) return { event: null, reason: 'date-unknown' };
  const classification = classifyDate(viewer.date, window);
  if (classification === 'past') return { event: null, reason: 'past' };
  if (classification !== 'inside') return { event: null, reason: 'outside-window' };
  return {
    event: {
      eventMode,
      calendarDate: normalizeIsoDate(calendarDate),
      eventInstant: viewer.instant,
      eventInstantMs: new Date(viewer.instant).getTime(),
      viewerDate: viewer.date,
      viewerTime: viewer.time,
      viewerTimezone,
      viewerTimezoneLabel: viewer.timeZoneLabel,
      sourceTimezone,
      sourceDate: normalizeIsoDate(sourceDate),
      sourceTime: sourceTime || null
    },
    reason: null
  };
}

function buildStreamingDateEvent(calendarDate, window, provider = null) {
  const date = normalizeIsoDate(calendarDate);
  if (!date) return { event: null, reason: 'date-unknown' };
  const classification = classifyDate(date, window);
  if (classification === 'past') return { event: null, reason: 'past' };
  if (classification !== 'inside') return { event: null, reason: 'outside-window' };
  return {
    event: {
      eventMode: EVENT_MODES.STREAMING_DATE,
      provider,
      calendarDate: date,
      eventInstant: null,
      eventInstantMs: null,
      viewerDate: date,
      viewerTime: null
    },
    reason: null
  };
}

function eventStatus(event, now = new Date(), runtimeMinutes = null) {
  if (!event?.eventInstant) return null;
  const start = new Date(event.eventInstant).getTime();
  if (!Number.isFinite(start)) return null;
  const nowMs = now.getTime();
  const diff = start - nowMs;
  const runtime = Number(runtimeMinutes);
  const end = start + (Number.isFinite(runtime) && runtime > 0 ? runtime * 60_000 : 0);
  if (diff > 60 * 60_000) return 'UPCOMING';
  if (diff > 0) return 'AIRING_SOON';
  if (end > start && nowMs < end) return 'AIRING_NOW';
  return 'RELEASED_TODAY';
}

function image(path, size = 'w500') {
  if (!path) return null;
  return `${IMAGE_BASE}${size}${path}`;
}

function tmdbFallbackId(type, tmdbId) {
  return type === 'movie' ? `tmdb:movie:${tmdbId}` : `tmdb:tv:${tmdbId}`;
}

function parseTmdbFallbackId(id, expectedType) {
  const re = expectedType === 'movie' ? /^tmdb:movie:(\d+)$/ : /^tmdb:tv:(\d+)$/;
  const match = String(id || '').match(re);
  return match ? Number(match[1]) : null;
}

function usWatchData(details) {
  return details?.['watch/providers']?.results?.[DEFAULT_COUNTRY] || {};
}

function flatrateProviderIds(details) {
  return new Set((usWatchData(details).flatrate || []).map((p) => Number(p?.provider_id)).filter(Number.isFinite));
}

function hasProviderInFlatrate(details, providerIds = []) {
  if (!Array.isArray(providerIds) || providerIds.length === 0) return false;
  const active = flatrateProviderIds(details);
  return providerIds.some((id) => active.has(Number(id)));
}

function usDigitalReleaseDates(details) {
  const country = (details?.release_dates?.results || []).find((entry) => entry?.iso_3166_1 === DEFAULT_COUNTRY);
  return (country?.release_dates || [])
    .filter((entry) => Number(entry?.type) === 4)
    .map((entry) => ({ ...entry, date: normalizeIsoDate(entry?.release_date) }))
    .filter((entry) => entry.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function selectDigitalRelease(details, window) {
  const dates = usDigitalReleaseDates(details);
  if (!dates.length) return { release: null, reason: 'date-unknown' };
  const inside = dates.find((entry) => isDateInWindow(entry.date, window));
  if (inside) return { release: inside, reason: null };
  if (dates.every((entry) => entry.date < window.today)) return { release: null, reason: 'past' };
  return { release: null, reason: 'outside-window' };
}

function episodeCode(episode) {
  const season = Number(episode?.season_number ?? episode?.season);
  const number = Number(episode?.episode_number ?? episode?.number);
  if (!Number.isFinite(season) || !Number.isFinite(number)) return 'Nouvel épisode';
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;
}

function selectRelevantEpisode(details, window) {
  const candidates = [details?.last_episode_to_air, details?.next_episode_to_air]
    .filter(Boolean)
    .map((episode) => ({ ...episode, date: normalizeIsoDate(episode?.air_date) }))
    .filter((episode) => episode.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const inside = candidates.find((episode) => isDateInWindow(episode.date, window));
  if (inside) return { episode: inside, reason: null };
  if (!candidates.length) return { episode: null, reason: 'date-unknown' };
  if (candidates.every((episode) => episode.date < window.today)) return { episode: null, reason: 'past' };
  return { episode: null, reason: 'outside-window' };
}

function baseMeta(details, type, releaseDate, releaseInfo) {
  const isMovie = type === 'movie';
  const imdbId = details?.external_ids?.imdb_id || details?.imdb_id || null;
  const tmdbId = Number(details?.id);
  const runtime = isMovie
    ? details?.runtime
    : Array.isArray(details?.episode_run_time) ? details.episode_run_time.find(Boolean) : null;

  return {
    id: imdbId || tmdbFallbackId(type, tmdbId),
    type,
    name: (isMovie ? details?.title : details?.name) || 'Sans titre',
    poster: image(details?.poster_path, 'w500'),
    posterShape: 'poster',
    background: image(details?.backdrop_path, 'w1280') || image(details?.poster_path, 'w780'),
    landscapePoster: image(details?.backdrop_path, 'w780'),
    description: details?.overview || null,
    releaseInfo,
    released: releaseDate,
    status: details?.status || null,
    imdbRating: Number.isFinite(details?.vote_average) ? details.vote_average.toFixed(1) : null,
    imdb_id: imdbId,
    genres: Array.isArray(details?.genres) ? details.genres.map((g) => g?.name).filter(Boolean) : [],
    runtime: runtime ? `${runtime} min` : null,
    country: 'United States',
    language: details?.original_language || null,
    behaviorHints: type === 'series' ? { hasScheduledVideos: true } : undefined,
    _tmdbId: tmdbId,
    _popularity: Number(details?.popularity || 0),
    _voteCount: Number(details?.vote_count || 0),
    _dedupeKey: Number.isFinite(tmdbId) ? `${type}:${tmdbId}` : (imdbId || null),
    _eventInstantMs: null,
    _eventHasTime: false,
    _eventMode: null
  };
}

function movieDetailsToMeta(details, providerLabel, window) {
  const selected = selectDigitalRelease(details, window);
  if (!selected.release) return { meta: null, reason: selected.reason };
  const eventResult = buildStreamingDateEvent(selected.release.date, window, providerLabel);
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const meta = baseMeta(
    details,
    'movie',
    event.viewerDate,
    `Première streaming • ${humanDate(event.viewerDate, DEFAULT_TIMEZONE, window.today)}`
  );
  meta.description = [`${providerLabel} US • Première digitale`, meta.description].filter(Boolean).join('\n\n');
  meta._eventMode = event.eventMode;
  return { meta, reason: null, event };
}

function seriesDetailsToMeta(details, providerLabel, window) {
  const selected = selectRelevantEpisode(details, window);
  if (!selected.episode) return { meta: null, reason: selected.reason };
  const episode = selected.episode;
  const eventResult = buildStreamingDateEvent(episode.date, window, providerLabel);
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const meta = baseMeta(
    details,
    'series',
    event.viewerDate,
    `${episodeCode(episode)} • ${humanDate(event.viewerDate, DEFAULT_TIMEZONE, window.today)}`
  );
  meta.description = [`${providerLabel} US • Date streaming`, meta.description].filter(Boolean).join('\n\n');
  meta._eventMode = event.eventMode;
  return { meta, reason: null, episode, event };
}

function cleanCatalogMeta(meta) {
  if (!meta) return null;
  const copy = { ...meta };
  for (const key of Object.keys(copy)) {
    if (key.startsWith('_')) delete copy[key];
  }
  return copy;
}

function sortAndDedupeMetas(metas = []) {
  const map = new Map();
  for (const meta of metas.filter(Boolean)) {
    const key = meta._dedupeKey || meta.id;
    if (!key) continue;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, meta);
      continue;
    }
    const currentInstant = Number.isFinite(meta._eventInstantMs) ? meta._eventInstantMs : Infinity;
    const previousInstant = Number.isFinite(previous._eventInstantMs) ? previous._eventInstantMs : Infinity;
    const earlier = currentInstant < previousInstant;
    const sameInstant = currentInstant === previousInstant;
    const betterPopularity = Number(meta._popularity || 0) > Number(previous._popularity || 0) ||
      (Number(meta._popularity || 0) === Number(previous._popularity || 0) && Number(meta._voteCount || 0) > Number(previous._voteCount || 0));
    if (earlier || (sameInstant && betterPopularity)) map.set(key, meta);
  }

  return [...map.values()].sort((a, b) => {
    const dateCmp = String(a.released || '').localeCompare(String(b.released || ''));
    if (dateCmp) return dateCmp;
    const aTimed = Number.isFinite(a._eventInstantMs);
    const bTimed = Number.isFinite(b._eventInstantMs);
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (aTimed && bTimed && a._eventInstantMs !== b._eventInstantMs) return a._eventInstantMs - b._eventInstantMs;
    const popCmp = Number(b._popularity || 0) - Number(a._popularity || 0);
    if (popCmp) return popCmp;
    const votesCmp = Number(b._voteCount || 0) - Number(a._voteCount || 0);
    if (votesCmp) return votesCmp;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function catalogCacheKey({ providerSlug = 'global', type, period, timeZone, today, sourceVersion = 'v1' }) {
  return `catalog:${providerSlug}:${type}:${period}:${timeZone}:${today}:${sourceVersion}`;
}

function stripHtml(value) {
  if (!value) return null;
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  EVENT_MODES,
  isValidTimeZone,
  zonedParts,
  isoDateFromParts,
  timeFromParts,
  addIsoDays,
  localIsoDate,
  localTime,
  dateWindow,
  normalizeIsoDate,
  isDateInWindow,
  classifyDate,
  humanDate,
  humanCalendarDate,
  timeZoneShortName,
  viewerDateTimeFromInstant,
  zonedDateTimeToUtc,
  viewerWindowEpochBounds,
  buildInstantEvent,
  buildStreamingDateEvent,
  eventStatus,
  image,
  tmdbFallbackId,
  parseTmdbFallbackId,
  usWatchData,
  flatrateProviderIds,
  hasProviderInFlatrate,
  usDigitalReleaseDates,
  selectDigitalRelease,
  episodeCode,
  selectRelevantEpisode,
  baseMeta,
  movieDetailsToMeta,
  seriesDetailsToMeta,
  cleanCatalogMeta,
  sortAndDedupeMetas,
  catalogCacheKey,
  stripHtml,
  normalizeTitle
};
