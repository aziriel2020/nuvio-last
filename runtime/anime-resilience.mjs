const TSUZUKI_BASE = 'https://tsuzuki.top/api/v1';
const ANIME_TIMEZONE = 'Asia/Tokyo';
export const ANIME_RESILIENCE_REV = 'anime-series-v4-shield-cinematic-resilience';
const ATTRIBUTION = 'Données AniList (anilist.co) • calendrier de secours Tsuzuki (tsuzuki.top).';

function pad(value) {
  return String(value).padStart(2, '0');
}

function addIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDays(start, end) {
  return Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000);
}

function zonedParts(value, timeZone = ANIME_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const out = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${out.year}-${out.month}-${out.day}`,
    time: `${out.hour}:${out.minute}`
  };
}

function localToday(now = new Date()) {
  return zonedParts(now).date;
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function periodWindow(period, now = new Date()) {
  const today = localToday(now);
  if (period === 'today') return { start: today, end: today, today };
  if (period === 'tomorrow') {
    const date = addIsoDays(today, 1);
    return { start: date, end: date, today };
  }
  if (period === 'yesterday') {
    const date = addIsoDays(today, -1);
    return { start: date, end: date, today };
  }
  if (period === 'lastweek' || period === 'nextweek') {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const currentMonday = addIsoDays(today, -((weekday + 6) % 7));
    const start = period === 'lastweek' ? addIsoDays(currentMonday, -7) : addIsoDays(currentMonday, 7);
    return { start, end: addIsoDays(start, 6), today };
  }
  const monthMatch = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month < 1 || month > 12) return null;
    const start = `${year}-${pad(month)}-01`;
    if (start.slice(0, 7) > today.slice(0, 7)) return { start, end: start, today, empty: true };
    const end = start.slice(0, 7) === today.slice(0, 7) ? today : monthEnd(year, month);
    return { start, end, today };
  }
  return null;
}

function catalogMatch(urlLike) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  return url.pathname.match(/^\/global\/catalog\/series\/archives-global-v1-series-anime-asia-(today|tomorrow|yesterday|lastweek|nextweek|\d{4}-\d{2})\.json$/);
}

function metaMatch(urlLike) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  return url.pathname.match(/^\/global\/meta\/series\/anilist(?::|%3A)(\d+)\.json$/i);
}

export function isGlobalAnimeResilienceRequest(urlLike) {
  return Boolean(catalogMatch(urlLike) || metaMatch(urlLike));
}

function stripHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchJson(url, fetchFn) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NuvioCalendar/1.4.0 Oracle-AniList-Resilience'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Tsuzuki HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.ok) throw new Error(payload?.error || 'Tsuzuki response not ok');
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRawSchedule(window, fetchFn) {
  if (!window || window.empty) return [];
  const queryStart = addIsoDays(window.start, -1);
  const queryEnd = addIsoDays(window.end, 1);
  const rows = [];
  let cursor = queryStart;
  while (cursor <= queryEnd) {
    const days = Math.min(31, diffDays(cursor, queryEnd) + 1);
    const url = `${TSUZUKI_BASE}/schedule?start=${cursor}&days=${days}&airType=raw`;
    const payload = await fetchJson(url, fetchFn);
    rows.push(...(Array.isArray(payload?.episodes) ? payload.episodes : []));
    cursor = addIsoDays(cursor, days);
  }

  const deduped = new Map();
  for (const row of rows) {
    if (!row || row.isBreak || !Number.isFinite(Number(row.airingAt))) continue;
    const local = zonedParts(Number(row.airingAt) * 1000);
    if (local.date < window.start || local.date > window.end) continue;
    const key = `${row.mediaId}:${row.episode}:${row.airingAt}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  return [...deduped.values()].sort((a, b) => Number(a.airingAt || 0) - Number(b.airingAt || 0));
}

function seasonKeyForDate(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  const season = month <= 3 ? 'winter' : month <= 6 ? 'spring' : month <= 9 ? 'summer' : 'fall';
  return `${season}/${year}`;
}

function shiftMonth(isoDate, months) {
  const [year, month] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 15)).toISOString().slice(0, 10);
}

function relevantSeasonKeys(window) {
  return [...new Set([
    seasonKeyForDate(shiftMonth(window.start, -3)),
    seasonKeyForDate(window.start),
    seasonKeyForDate(window.end),
    seasonKeyForDate(shiftMonth(window.end, 3))
  ])];
}

async function mapSettled(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        output[index] = await mapper(items[index], index);
      } catch {
        output[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function loadMediaMap(schedule, window, fetchFn) {
  const payloads = await Promise.allSettled([
    ...relevantSeasonKeys(window).map((key) => fetchJson(`${TSUZUKI_BASE}/seasons/${key}?full=1`, fetchFn)),
    fetchJson(`${TSUZUKI_BASE}/airing?full=1`, fetchFn)
  ]);
  const mediaMap = new Map();
  for (const result of payloads) {
    if (result.status !== 'fulfilled') continue;
    for (const media of Array.isArray(result.value?.media) ? result.value.media : []) {
      const id = Number(media?.id);
      if (Number.isFinite(id)) mediaMap.set(id, media);
    }
  }

  const missing = [...new Set(schedule.map((row) => Number(row?.mediaId)).filter((id) => Number.isFinite(id) && !mediaMap.has(id)))];
  const recovered = await mapSettled(missing.slice(0, 18), 4, async (id) => {
    const payload = await fetchJson(`${TSUZUKI_BASE}/anime/${id}?full=1`, fetchFn);
    return payload?.media || null;
  });
  for (const media of recovered) {
    const id = Number(media?.id);
    if (Number.isFinite(id)) mediaMap.set(id, media);
  }
  return mediaMap;
}

function countryLabel(code) {
  return String(code || '').toUpperCase() === 'KR' ? 'Corée du Sud' : 'Japon';
}

function languageCode(code) {
  return String(code || '').toUpperCase() === 'KR' ? 'ko' : 'ja';
}

function desktopBanner(origin, meta) {
  const url = new URL('/global/desktop-content-card.jpg', origin);
  url.searchParams.set('v', `${ANIME_RESILIENCE_REV}-desktop11`);
  url.searchParams.set('design', 'shield3');
  const src = meta.background || meta.landscapePoster || meta.poster;
  if (src) url.searchParams.set('src', src);
  url.searchParams.set('provider', 'anime-asia');
  url.searchParams.set('type', 'series');
  url.searchParams.set('title', String(meta.name || 'Anime').slice(0, 68));
  url.searchParams.set('append', String(meta.releaseInfo || '').slice(0, 120));
  url.searchParams.set('label', 'Anime JP/KR');
  return url.toString();
}

function scheduleMeta(row, media, origin) {
  if (!row || !media || media.isAdult) return null;
  const id = Number(media.id || row.mediaId);
  if (!Number.isFinite(id)) return null;
  const country = String(media.countryOfOrigin || '').toUpperCase();
  if (!['JP', 'KR'].includes(country)) return null;
  if (String(media.format || '').toUpperCase() === 'MOVIE') return null;

  const title = media?.title?.english || media?.title?.romaji || media?.title?.native || row.title || 'Anime';
  const poster = media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium || row.coverImage || null;
  const background = media?.bannerImage || poster;
  const local = zonedParts(Number(row.airingAt) * 1000);
  const episode = Number(row.episode);
  const releaseInfo = `Épisode ${Number.isFinite(episode) ? episode : '?'} • ${local.date.split('-').reverse().join('/')} • ${local.time}`;
  const description = [
    `Épisode ${Number.isFinite(episode) ? episode : '?'} • Diffusion originale Japon/Corée`,
    stripHtml(media.description),
    ATTRIBUTION
  ].filter(Boolean).join('\n\n');
  const score = Number(media.averageScore);
  const duration = Number(media.duration);
  const meta = {
    id: `anilist:${id}`,
    type: 'series',
    name: title,
    poster,
    posterShape: 'poster',
    background,
    landscapePoster: background,
    description,
    releaseInfo,
    released: local.date,
    status: media.status || null,
    imdbRating: Number.isFinite(score) && score > 0 ? (score / 10).toFixed(1) : null,
    imdb_id: null,
    genres: Array.isArray(media.genres) ? media.genres.filter(Boolean) : [],
    runtime: Number.isFinite(duration) && duration > 0 ? `${duration} min` : null,
    country: countryLabel(country),
    language: languageCode(country),
    behaviorHints: { hasScheduledVideos: true },
    _calendarProvider: 'Anime JP/KR',
    _tmdbId: null,
    _popularity: Number(media.popularity || 0),
    _voteCount: Number(media.averageScore || 0),
    _dedupeKey: `anime:${id}:${row.episode}`,
    _eventInstantMs: Number(row.airingAt) * 1000,
    _eventHasTime: true,
    _eventMode: 'ANIME_ORIGINAL_AIRING'
  };
  // Catalog fallback must obey the exact same visual contract as the normal
  // Global Anime handler. Keep the raw AniList/Tsuzuki art only as the source
  // embedded by the Oracle renderer, never as a user-facing card URL.
  const cinematic = desktopBanner(origin, meta);
  meta.poster = cinematic;
  meta.posterShape = 'landscape';
  meta.background = cinematic;
  meta.landscapePoster = cinematic;
  meta.banner = cinematic;
  return meta;
}

function mediaScheduleRow(media, now = new Date()) {
  const nodes = Array.isArray(media?.airingSchedule?.nodes) ? media.airingSchedule.nodes : [];
  if (!nodes.length) return null;
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const sorted = nodes
    .filter((node) => Number.isFinite(Number(node?.airingAt)) && Number.isFinite(Number(node?.episode)))
    .sort((a, b) => Number(a.airingAt) - Number(b.airingAt));
  const next = sorted.find((node) => Number(node.airingAt) >= nowEpoch);
  const chosen = next || sorted.at(-1);
  return chosen ? { ...chosen, mediaId: media.id } : null;
}

export async function buildTsuzukiCatalog(urlLike, options = {}) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  const match = catalogMatch(url);
  if (!match) return null;
  const window = periodWindow(match[1], options.now || new Date());
  if (!window || window.empty) return { metas: [], window };
  const fetchFn = options.fetchFn || fetch;
  const schedule = await loadRawSchedule(window, fetchFn);
  if (!schedule.length) return { metas: [], window };
  const mediaMap = await loadMediaMap(schedule, window, fetchFn);
  const metas = schedule
    .map((row) => scheduleMeta(row, mediaMap.get(Number(row.mediaId)), url.origin))
    .filter(Boolean)
    .sort((a, b) => Number(a._eventInstantMs || 0) - Number(b._eventInstantMs || 0));
  return { metas, window };
}

export async function buildTsuzukiMeta(urlLike, options = {}) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  const match = metaMatch(url);
  if (!match) return null;
  const fetchFn = options.fetchFn || fetch;
  const payload = await fetchJson(`${TSUZUKI_BASE}/anime/${match[1]}?full=1`, fetchFn);
  const media = payload?.media;
  if (!media) return null;
  const row = mediaScheduleRow(media, options.now || new Date());
  if (row) {
    const meta = scheduleMeta(row, media, url.origin);
    if (!meta) return null;

    // Detail pages should retain the source artwork. Only catalog cards are
    // forced through the Shield cinematic renderer.
    const poster = media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium || null;
    const background = media?.bannerImage || poster;
    meta.poster = poster;
    meta.posterShape = 'poster';
    meta.background = background;
    meta.landscapePoster = background;
    meta.banner = desktopBanner(url.origin, { ...meta, poster, background, landscapePoster: background });
    return meta;
  }

  const country = String(media.countryOfOrigin || '').toUpperCase();
  if (media.isAdult || !['JP', 'KR'].includes(country) || String(media.format || '').toUpperCase() === 'MOVIE') return null;
  const poster = media?.coverImage?.extraLarge || media?.coverImage?.large || media?.coverImage?.medium || null;
  const background = media?.bannerImage || poster;
  const score = Number(media.averageScore);
  const duration = Number(media.duration);
  const meta = {
    id: `anilist:${Number(media.id)}`,
    type: 'series',
    name: media?.title?.english || media?.title?.romaji || media?.title?.native || 'Anime',
    poster,
    posterShape: 'poster',
    background,
    landscapePoster: background,
    description: [stripHtml(media.description), ATTRIBUTION].filter(Boolean).join('\n\n'),
    releaseInfo: Number.isFinite(Number(media.seasonYear)) ? String(media.seasonYear) : null,
    released: null,
    status: media.status || null,
    imdbRating: Number.isFinite(score) && score > 0 ? (score / 10).toFixed(1) : null,
    imdb_id: null,
    genres: Array.isArray(media.genres) ? media.genres.filter(Boolean) : [],
    runtime: Number.isFinite(duration) && duration > 0 ? `${duration} min` : null,
    country: countryLabel(country),
    language: languageCode(country),
    behaviorHints: { hasScheduledVideos: true }
  };
  meta.banner = desktopBanner(url.origin, meta);
  return meta;
}

function jsonResponse(payload, baseResponse, extraHeaders = {}) {
  const headers = new Headers(baseResponse?.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Nuvio-Edge', 'oracle-node');
  headers.set('X-Nuvio-Origin', 'oracle-vm');
  headers.set('X-Nuvio-Anime-Source', 'anilist-cache-tsuzuki');
  headers.set('X-Nuvio-Anime-Cache-Rev', ANIME_RESILIENCE_REV);
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=900');
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function recoverGlobalAnimeResponse(request, baseResponse, options = {}) {
  const url = new URL(request.url);
  const catalog = catalogMatch(url);
  const meta = metaMatch(url);
  if (!catalog && !meta) return baseResponse;

  let basePayload = null;
  try {
    if (baseResponse?.headers?.get('content-type')?.includes('json')) basePayload = await baseResponse.clone().json();
  } catch {
    basePayload = null;
  }

  if (catalog && baseResponse?.ok && Array.isArray(basePayload?.metas) && basePayload.metas.length > 0) return baseResponse;
  if (meta && baseResponse?.ok && basePayload?.meta?.id === `anilist:${meta[1]}`) return baseResponse;

  try {
    if (catalog) {
      const fallback = await buildTsuzukiCatalog(url, options);
      if (!fallback?.metas?.length) return baseResponse;
      const stats = {
        ...(basePayload?.stats || {}),
        candidates: fallback.metas.length,
        kept: fallback.metas.length,
        anilistFallbacks: fallback.metas.length,
        resilienceSource: 'anilist-cache-tsuzuki',
        sourceVersion: ANIME_RESILIENCE_REV,
        attribution: 'Data from AniList, corrected by Tsuzuki.'
      };
      return jsonResponse({ metas: fallback.metas, stats }, baseResponse);
    }

    const fallbackMeta = await buildTsuzukiMeta(url, options);
    if (!fallbackMeta) return baseResponse;
    return jsonResponse({ meta: fallbackMeta }, baseResponse, { 'Cache-Control': 'public, max-age=3600, s-maxage=21600' });
  } catch (error) {
    console.warn('[anilist-resilience-fail]', url.pathname, error?.message || error);
    return baseResponse;
  }
}
