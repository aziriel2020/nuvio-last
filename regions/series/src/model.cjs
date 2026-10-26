'use strict';

const ADDON_ID = 'com.nuvio.series.world.liveaction';
const VERSION = '1.1.2';
const V2_ADDON_ID = 'com.nuvio.series.france.liveaction.v2';
const V2_VERSION = '2.0.2';
const { offersInFrance } = require('./france.cjs');
const GENRES = Object.freeze([
  ['all', 'Toutes les séries'],
  ['10759', 'Action & Aventure'], ['35', 'Comédie'], ['80', 'Crime / Policier'],
  ['18', 'Drame'], ['9648', 'Mystère'], ['10765', 'SF & Fantastique'],
  ['10768', 'Guerre & Politique'], ['37', 'Western'], ['10766', 'Feuilletons'],
  ['10751', 'Famille'], ['10762', 'Jeunesse'], ['99', 'Documentaires'],
  ['10764', 'Téléréalité'], ['10767', 'Talk-shows'], ['10763', 'Actualités'],
  ['unclassified', 'Genre non renseigné'],
  ['thriller', 'Thriller'], ['horror', 'Horreur'], ['romance', 'Romance'],
  ['history', 'Historique'], ['medical', 'Médical'], ['legal', 'Judiciaire'],
  ['espionage', 'Espionnage'], ['miniseries', 'Mini-séries']
].map(([id, name]) => Object.freeze({ id, name })));

const TVMAZE_GENRES = {
  Action: '10759', Adventure: '10759', Comedy: '35', Crime: '80', Drama: '18',
  Mystery: '9648', 'Science-Fiction': '10765', Fantasy: '10765',
  War: '10768', Western: '37', Family: '10751', Children: '10762',
  Thriller: 'thriller', Horror: 'horror', Romance: 'romance', History: 'history',
  Medical: 'medical', Legal: 'legal', Espionage: 'espionage'
};
const TYPE_GENRES = { Documentary: '99', Reality: '10764', 'Talk Show': '10767', News: '10763' };
// Exact topic names only. "Based on manga" is deliberately NOT an animation signal.
const TOPICS = {
  thriller: ['thriller', 'psychological thriller', 'political thriller'],
  horror: ['horror', 'supernatural horror'], romance: ['romance', 'romantic drama', 'romantic comedy'],
  history: ['historical drama', 'period drama', 'historical fiction'],
  medical: ['medical drama', 'medical procedural', 'hospital'],
  legal: ['legal drama', 'courtroom', 'courtroom drama'],
  espionage: ['espionage', 'spy', 'spy thriller'], miniseries: ['miniseries', 'mini-series']
};
const ANIMATION_WORDS = new Set(['animation', 'animated series', 'anime', 'japanese animation', 'stop motion', 'stop-motion']);
const unique = (values) => [...new Set(values.filter(Boolean).map(String))];
const topic = (v) => String(v || '').normalize('NFKC').toLowerCase().trim();

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}

function classify({ genres = [], keywords = [], sourceType = '' }) {
  const words = keywords.map(topic);
  if (genres.map(String).includes('16') || topic(sourceType) === 'animation' || words.some((s) => ANIMATION_WORDS.has(s))) return 'animation';
  return genres.length || sourceType ? 'eligible' : 'review';
}

function fromTmdb(data) {
  if (!Number.isSafeInteger(data?.id) || data.id < 1) throw new Error('Invalid TMDB TV ID');
  const genres = (data.genres || []).map((g) => String(g.id));
  const sourceType = data.type == null ? null : String(data.type);
  const typeGenre = { Documentary:'99', Reality:'10764', 'Talk Show':'10767', News:'10763' }[sourceType];
  if (typeGenre) genres.push(typeGenre);
  const keywords = (data.keywords?.results || data.keywords?.keywords || []).map((k) => k.name);
  for (const [id, names] of Object.entries(TOPICS)) if (keywords.some((k) => names.includes(topic(k)))) genres.push(id);
  if (Number(data.type) === 2 || data.type === 'Miniseries') genres.push('miniseries');
  return {
    key: `tmdb:${data.id}`, source: 'tmdb', sourceId: data.id, tmdbId: data.id,
    imdbId: /^tt\d+$/.test(data.external_ids?.imdb_id || '') ? data.external_ids.imdb_id : null,
    tvdbId: Number(data.external_ids?.tvdb_id) || null,
    title: data.name || data.original_name || `Série ${data.id}`, originalTitle: data.original_name || null,
    description: data.overview || null, firstAirDate: isoDate(data.first_air_date),
    poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
    background: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
    genres: unique(genres), sourceType, classification: classify({ genres, keywords, sourceType: sourceType || '' }),
    franceOffers: data['watch/providers'] !== undefined ? offersInFrance(data) : undefined,
    countries: data.origin_country || [], languages: unique([data.original_language]), status: data.status || null,
    // Series launch dates alone cannot surface returning shows' new episodes.
    // TMDb returns last/next episode airings independently of first_air_date.
    episodeEvents: [data.last_episode_to_air, data.next_episode_to_air]
      .filter((e) => e && Number.isInteger(e.season_number) && e.season_number > 0
        && Number.isInteger(e.episode_number) && e.episode_number > 0 && isoDate(e.air_date))
      .map((e) => ({ season: e.season_number, episode: e.episode_number,
        date: e.air_date, name: e.name || null })),
    seasons: (data.seasons || []).filter((s) => Number(s.season_number) > 0).map((s) => ({ number: Number(s.season_number), date: isoDate(s.air_date), name: s.name || null }))
  };
}

function fromTvmaze(data) {
  if (!Number.isSafeInteger(data?.id) || data.id < 1) throw new Error('Invalid TVmaze ID');
  const genres = unique([...(data.genres || []).map((g) => TVMAZE_GENRES[g]), TYPE_GENRES[data.type]]);
  return {
    key: `tvmaze:${data.id}`, source: 'tvmaze', sourceId: data.id, tvmazeId: data.id,
    imdbId: /^tt\d+$/.test(data.externals?.imdb || '') ? data.externals.imdb : null,
    tvdbId: Number(data.externals?.thetvdb) || null,
    title: data.name || `Série ${data.id}`, originalTitle: data.name || null,
    description: String(data.summary || '').replace(/<[^>]*>/g, '').trim() || null,
    firstAirDate: isoDate(data.premiered), poster: data.image?.original || data.image?.medium || null,
    background: null, genres, sourceType: data.type || null,
    classification: classify({ genres, sourceType: data.type }),
    countries: unique([data.network?.country?.code, data.webChannel?.country?.code]),
    languages: unique([data.language]), status: data.status || null, seasons: []
  };
}

function localDay(now = new Date(), timeZone = 'Europe/Brussels') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function shiftDay(day, amount) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10);
}
function windowFor(period, now = new Date(), timeZone = 'Europe/Brussels') {
  const today = localDay(now, timeZone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(today, -((weekday + 6) % 7));
  if (period === 'all') return { start: null, end: today };
  if (period === 'undated') return { undated: true };
  if (period === 'before1900') return { start: '0001-01-01', end: '1899-12-31' };
  if (period === 'today') return { start: today, end: today };
  if (period === 'tomorrow') return { start: shiftDay(today, 1), end: shiftDay(today, 1) };
  if (period === 'yesterday') return { start: shiftDay(today, -1), end: shiftDay(today, -1) };
  if (period === 'lastweek') return { start: shiftDay(monday, -7), end: shiftDay(monday, -1) };
  if (period === 'nextweek') return { start: shiftDay(monday, 7), end: shiftDay(monday, 13) };
  // Archive periods must never display upcoming airings. Only the explicit
  // Demain / La semaine suivante rolling rows are allowed into the future.
  if (/^\d{4}$/.test(period) && Number(period) >= 1900 && Number(period) <= 9998)
    return { start: `${period}-01-01`, end: `${period}-12-31` < today ? `${period}-12-31` : today };
  if (/^\d{4}-\d{2}$/.test(period) && isoDate(`${period}-01`)) {
    const next = new Date(`${period}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    const monthEnd = shiftDay(next.toISOString().slice(0, 10), -1);
    return { start: `${period}-01`, end: monthEnd < today ? monthEnd : today };
  }
  throw new Error('Invalid date period');
}

const CATALOG_START = '2018-01-01';
const WESTERN_GENRE = '37';

// Keep stored history and detail links intact; limit only catalog event dates.
function catalogWindowFor(period, genre = 'all', now = new Date()) {
  const window = windowFor(period, now);
  if (genre === WESTERN_GENRE) return window;
  if (window.undated || window.end < CATALOG_START) return null;
  return { ...window, start: window.start && window.start > CATALOG_START ? window.start : CATALOG_START };
}

function periods(now = new Date(), genre = 'all') {
  const out = [
    ['all', 'Toutes les dates · Récent → Ancien'], ['today', 'Aujourd’hui'],
    ['tomorrow', 'Demain'], ['yesterday', 'Hier'], ['lastweek', 'Semaine passée'], ['nextweek', 'La semaine suivante']
  ];
  // Do not prewire years/months that have not started yet: the current
  // calendar month is the newest archive, and it stops on today's date.
  const currentDay = localDay(now);
  const currentYear = Number(currentDay.slice(0, 4));
  const currentMonth = Number(currentDay.slice(5, 7));
  for (let year = currentYear; year >= (genre === WESTERN_GENRE ? 2015 : 2018); year--) {
    for (let month = (year === currentYear ? currentMonth : 12); month >= 1; month--) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T12:00:00Z`));
      out.push([key, label.charAt(0).toUpperCase() + label.slice(1)]);
    }
  }
  if (genre === WESTERN_GENRE) {
    for (let year = Math.min(2014, currentYear); year >= 1900; year--) out.push([String(year), String(year)]);
    out.push(['before1900', 'Avant 1900'], ['undated', 'Date inconnue']);
  }
  return out.map(([key, name]) => ({ key, name }));
}

function catalogId(mode, genre, period) { return `series-fr-${mode}-${genre}-${period}`; }
function parseCatalog(id) {
  const match = String(id).match(/^series-(?:world|fr)-(premieres|seasons)-([a-z0-9]+)-(all|today|tomorrow|yesterday|lastweek|nextweek|before1900|undated|\d{4}(?:-\d{2})?)$/);
  return match && GENRES.some((g) => g.id === match[2]) ? { mode: match[1], genre: match[2], period: match[3] } : null;
}

module.exports = { ADDON_ID, VERSION, V2_ADDON_ID, V2_VERSION, GENRES, isoDate, unique, classify, fromTmdb, fromTvmaze, localDay, shiftDay, windowFor, catalogWindowFor, CATALOG_START, WESTERN_GENRE, periods, catalogId, parseCatalog };
