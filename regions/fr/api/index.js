'use strict';

const {
  DEFAULT_TIMEZONE,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  EVENT_MODES,
  isValidTimeZone,
  addIsoDays,
  localIsoDate,
  localTime,
  dateWindow,
  normalizeIsoDate,
  humanDate,
  humanCalendarDate,
  viewerDateTimeFromInstant,
  viewerWindowEpochBounds,
  buildInstantEvent,
  parseTmdbFallbackId,
  hasProviderInFlatrate,
  movieDetailsToMeta,
  movieVodDetailsToMeta,
  seriesDetailsToMeta,
  baseMeta,
  cleanCatalogMeta,
  sortAndDedupeMetas,
  catalogCacheKey,
  episodeCode,
  stripHtml,
  normalizeTitle
} = require('../src/calendar');

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const VERSION = '1.3.1';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TVMAZE_BASE = 'https://api.tvmaze.com';
const ANILIST_URL = 'https://graphql.anilist.co';
const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_ITEMS = 240;
const DEFAULT_PAGE_SIZE = 60;
const ENRICH_CONCURRENCY = 8;
const CATALOG_TTL_MS = 15 * 60 * 1000;
const DETAILS_TTL_MS = 15 * 60 * 1000;
const PROVIDERS_TTL_MS = 6 * 60 * 60 * 1000;
const TVMAZE_SCHEDULE_TTL_MS = 10 * 60 * 1000;
const ANILIST_SCHEDULE_TTL_MS = 10 * 60 * 1000;
const MAPPING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SOURCE_VERSION = 'calendar-archives-fr-v1.3.1-modern-shield';
const VISUAL_REV = 'coex-fr131-cinematic';

const REGION_ART_KEY = 'fr';
const PLATFORM_ART_DIR = path.resolve(__dirname, '../../../assets/platform-art/fr');
const GENRE_CINEMATIC_ART_DIR = path.resolve(__dirname, '../../../assets/genre-art/shared');
const COLLECTION_CINEMATIC_ART_DIR = path.resolve(__dirname, '../../../assets/collection-art');
const LOCAL_VISUAL_DATA_CACHE = new Map();
function localVisualDataUri(absolutePath, mime = 'image/jpeg') {
  const key = `${mime}:${absolutePath}`;
  if (LOCAL_VISUAL_DATA_CACHE.has(key)) return LOCAL_VISUAL_DATA_CACHE.get(key);
  try { const data = fs.readFileSync(absolutePath); const uri = `data:${mime};base64,${data.toString('base64')}`; LOCAL_VISUAL_DATA_CACHE.set(key, uri); return uri; }
  catch (_) { LOCAL_VISUAL_DATA_CACHE.set(key, null); return null; }
}
function platformPhotoDataUri(providerSlug, variant = 'card') { return localVisualDataUri(path.join(PLATFORM_ART_DIR, `${providerSlug}-${variant === 'backdrop' ? 'backdrop' : 'card'}.jpg`)); }
function servePlatformArtJpeg(res, url, variant = 'card') {
  const providerSlug = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(providerSlug)) { res.statusCode = 404; return res.end('Not found'); }
  return serveLocalJpeg(res, path.join(PLATFORM_ART_DIR, `${providerSlug}-${variant === 'backdrop' ? 'backdrop' : 'card'}.jpg`));
}
function genreCinematicDataUri(genreSlug, variant='card') { const v=variant==='backdrop'?'backdrop':'card'; return localVisualDataUri(path.join(GENRE_CINEMATIC_ART_DIR, `${String(genreSlug || '').trim().toLowerCase()}-${v}.jpg`)); }
function serveGenreCinematicJpeg(res, url, variant = 'card') {
  const genreSlug = String(url.searchParams.get('genre') || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(genreSlug)) { res.statusCode = 404; return res.end('Not found'); }
  return serveLocalJpeg(res, path.join(GENRE_CINEMATIC_ART_DIR, `${genreSlug}-${variant === 'backdrop' ? 'backdrop' : 'card'}.jpg`));
}
function serveLocalJpeg(res, absolutePath, cache = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000') {
  try { const data = fs.readFileSync(absolutePath); res.statusCode=200; res.setHeader('Content-Type','image/jpeg'); res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control',cache); res.end(data); }
  catch (_) { res.statusCode=404; res.end('Not found'); }
}

function normalizedDesktopType(value) {
  return String(value || '').toLowerCase() === 'movie' ? 'movie' : 'series';
}

function safeDesktopAccent(value, fallback = '#38bdf8') {
  const token = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(token) ? token : fallback;
}

function desktopFontFile() {
  try {
    return require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
  } catch (_) {
    return '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  }
}

function desktopTextEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function desktopTextComposite(text, left, top, width, height, options = {}) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const color = options.color || '#ffffff';
  const size = Number(options.size || 48);
  const fontfile = desktopFontFile();
  return {
    input: {
      text: {
        text: `<span foreground="${color}">${desktopTextEscape(value)}</span>`,
        font: `DejaVu Sans Bold ${size}`,
        fontfile,
        width,
        height,
        align: options.align || 'left',
        rgba: true,
        wrap: 'none'
      }
    },
    left,
    top
  };
}

function desktopOverlaySvg(type = 'series', accent = '#38bdf8') {
  const movie = normalizedDesktopType(type) === 'movie';
  const typeIcon = movie
    ? `<path d="M1418 68h42v38h-42z" fill="none" stroke="#fff" stroke-width="6"/><path d="M1418 82h42M1432 68v38M1446 68v38" stroke="#fff" stroke-width="4"/><path d="M1430 76l17 11-17 11z" fill="#fff"/>`
    : `<rect x="1418" y="70" width="43" height="32" rx="5" fill="none" stroke="#fff" stroke-width="6"/><path d="M1429 112h22" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#02040a" stop-opacity=".52"/>
        <stop offset="42%" stop-color="#02040a" stop-opacity=".08"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".28"/>
      </linearGradient>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#061021" stop-opacity="0"/>
        <stop offset="32%" stop-color="#072650" stop-opacity=".40"/>
        <stop offset="100%" stop-color="#061c42" stop-opacity=".97"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#shade)"/>
    <rect y="340" width="1600" height="560" fill="url(#bottom)"/>
    <rect x="1018" y="36" width="360" height="116" rx="28" fill="#03060c" fill-opacity=".90" stroke="${accent}" stroke-width="6"/>
    <rect x="1394" y="36" width="168" height="116" rx="28" fill="${accent}" fill-opacity=".98"/>
    ${typeIcon}
    <rect x="58" y="575" width="14" height="232" rx="7" fill="${accent}"/>
    <rect x="96" y="846" width="460" height="5" rx="2.5" fill="${accent}" opacity=".82"/>
  </svg>`);
}

async function desktopCinematicCardBuffer(sourceBuffer, options = {}) {
  const type = normalizedDesktopType(options.type);
  const accent = safeDesktopAccent(options.accent, '#38bdf8');
  const movie = type === 'movie';
  const title = compactCardText(options.title || (movie ? 'Film' : 'Série'), 58);
  const subtitle = compactCardText(options.subtitle || '', 72);
  const providerLabel = compactCardText(options.providerLabel || '', 24).replace(/^[^\p{L}\p{N}]+/u, '').toUpperCase();
  const typeLabel = movie ? 'FILM' : 'SÉRIE';
  const bottomTag = compactCardText(options.bottomTag || '', 24).toUpperCase();

  const composites = [{ input: desktopOverlaySvg(type, accent), left: 0, top: 0 }];

  if (options.logoBuffer) {
    try {
      const logo = await sharp(options.logoBuffer)
        .resize({ width: 116, height: 68, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      composites.push({ input: logo, left: 1042, top: 59 });
    } catch (_) {}
  }

  composites.push(...[
    desktopTextComposite(providerLabel, 1168, 67, 190, 58, { size: 28 }),
    desktopTextComposite(typeLabel, 1470, 67, 78, 58, { size: 27, align: 'center' }),
    desktopTextComposite(title, 98, 620, 1080, 116, { size: 86 }),
    desktopTextComposite(subtitle, 100, 742, 1030, 58, { size: 38, color: '#e8f1ff' }),
    desktopTextComposite(bottomTag, 100, 800, 620, 38, { size: 25, color: accent })
  ].filter(Boolean));

  try {
    return await sharp(sourceBuffer)
      .resize(1600, 900, { fit: 'cover', position: 'attention' })
      .modulate({ brightness: 0.95, saturation: 1.07 })
      .composite(composites)
      .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
      .toBuffer();
  } catch (_) {
    // Safe fallback: never render broken glyphs.
    const fallback = [{ input: desktopOverlaySvg(type, accent), left: 0, top: 0 }];
    if (options.logoBuffer) {
      try {
        const logo = await sharp(options.logoBuffer)
          .resize({ width: 116, height: 68, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        fallback.push({ input: logo, left: 1042, top: 59 });
      } catch (_) {}
    }
    return sharp(sourceBuffer)
      .resize(1600, 900, { fit: 'cover', position: 'attention' })
      .modulate({ brightness: 0.95, saturation: 1.07 })
      .composite(fallback)
      .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
      .toBuffer();
  }
}


function sendDesktopCinematicJpeg(res, data) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  res.end(data);
}

async function handleDesktopFolderCard(res, url) {
  const providerSlug = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  const type = normalizedDesktopType(url.searchParams.get('type'));
  if (!/^[a-z0-9-]+$/.test(providerSlug)) { res.statusCode = 404; return res.end('Not found'); }
  try {
    const source = fs.readFileSync(path.join(PLATFORM_ART_DIR, `${providerSlug}-card.jpg`));
    const asset = await platformLogoAsset(providerSlug, type);
    const accent = safeDesktopAccent(url.searchParams.get('color'), providerAccentColor(providerSlug));
    const providerLabel = String(url.searchParams.get('label') || platformCollectionTitle(providerSlug)).replace(/^[^\p{L}\p{N}]+/u, '');
    const title = url.searchParams.get('title') || (type === 'movie' ? 'Films' : 'Séries');
    const data = await desktopCinematicCardBuffer(source, {
      type,
      accent,
      logoBuffer: asset?.buffer || null,
      title,
      subtitle: providerLabel,
      providerLabel,
      bottomTag: ''
    });
    return sendDesktopCinematicJpeg(res, data);
  } catch (_) {
    res.statusCode = 404;
    return res.end('Not found');
  }
}

async function handleDesktopGenreCard(res, url) {
  const genreSlug = String(url.searchParams.get('genre') || '').trim().toLowerCase();
  const type = normalizedDesktopType(url.searchParams.get('type'));
  if (!/^[a-z0-9-]+$/.test(genreSlug)) { res.statusCode = 404; return res.end('Not found'); }
  try {
    const source = fs.readFileSync(path.join(GENRE_CINEMATIC_ART_DIR, `${genreSlug}-card.jpg`));
    const accent = safeDesktopAccent(url.searchParams.get('color'), '#a855f7');
    const title = url.searchParams.get('title') || genreSlug.replace(/-/g, ' ');
    const providerLabel = type === 'movie' ? 'GENRE FILM' : 'GENRE SÉRIE';
    const data = await desktopCinematicCardBuffer(source, {
      type,
      accent,
      title,
      subtitle: type === 'movie' ? 'Films' : 'Séries',
      providerLabel,
      bottomTag: 'GENRE'
    });
    return sendDesktopCinematicJpeg(res, data);
  } catch (_) {
    res.statusCode = 404;
    return res.end('Not found');
  }
}

async function handleDesktopContentCard(res, url) {
  const src = optimizedCardSource(url.searchParams.get('src') || '', 'landscape');
  const providerSlug = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  const type = normalizedDesktopType(url.searchParams.get('type'));
  if (!src || !isAllowedPosterSource(src)) { res.statusCode = 400; return res.end('Invalid source'); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(src, {
      signal: controller.signal,
      headers: { Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8', 'User-Agent': `NuvioCalendar/${VERSION}` }
    });
    if (!response.ok) { res.statusCode = 502; return res.end('Image unavailable'); }
    const source = Buffer.from(await response.arrayBuffer());
    const asset = providerSlug ? await platformLogoAsset(providerSlug, type) : null;
    const accent = safeDesktopAccent(url.searchParams.get('color'), providerAccentColor(providerSlug));
    const providerLabel = String(url.searchParams.get('label') || platformCollectionTitle(providerSlug)).replace(/^[^\p{L}\p{N}]+/u, '');
    const title = url.searchParams.get('title') || '';
    const subtitle = url.searchParams.get('append') || '';
    const data = await desktopCinematicCardBuffer(source, {
      type,
      accent,
      logoBuffer: asset?.buffer || null,
      title,
      subtitle,
      providerLabel,
      bottomTag: providerLabel
    });
    return sendDesktopCinematicJpeg(res, data);
  } catch (_) {
    res.statusCode = 502;
    return res.end('Image unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

const GENRE_POSTER_DIR = path.resolve(__dirname, '../../../assets/genre-posters');
const GENRE_POSTER_MAP = Object.freeze({
  'movie:action': 'action.png',
  'movie:animation': 'animation.png',
  'movie:comedy': 'comedy.png',
  'movie:crime': 'crime.png',
  'movie:documentary': 'documentary.png',
  'movie:drama': 'drama.png',
  'movie:fantasy': 'fantasy.png',
  'movie:horror': 'horror.png',
  'movie:romance': 'romance.png',
  'movie:science-fiction': 'science-fiction.png',
  'series:action-adventure': 'action.png',
  'series:animation': 'animation.png',
  'series:comedy': 'comedy.png',
  'series:crime': 'crime.png',
  'series:documentary': 'documentary.png',
  'series:drama': 'drama.png',
  'series:scifi-fantasy': 'fantasy.png'
});
const GENRE_POSTER_DATA_URI_CACHE = new Map();

function genrePosterDataUri(type, genreSlug) {
  const key = `${type}:${genreSlug}`;
  if (GENRE_POSTER_DATA_URI_CACHE.has(key)) return GENRE_POSTER_DATA_URI_CACHE.get(key);
  const fileName = GENRE_POSTER_MAP[key];
  if (!fileName) {
    GENRE_POSTER_DATA_URI_CACHE.set(key, null);
    return null;
  }
  try {
    const absolutePath = path.join(GENRE_POSTER_DIR, fileName);
    const buffer = fs.readFileSync(absolutePath);
    const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
    GENRE_POSTER_DATA_URI_CACHE.set(key, dataUri);
    return dataUri;
  } catch (_) {
    GENRE_POSTER_DATA_URI_CACHE.set(key, null);
    return null;
  }
}

function genrePosterSvg(params = {}) {
  const typeToken = String(params.type || 'movie') === 'series' ? 'series' : 'movie';
  const genreSlug = String(params.genre || '').trim().toLowerCase();
  const dataUri = genrePosterDataUri(typeToken, genreSlug);
  if (!dataUri) return null;
  const variant = String(params.variant || 'card');
  const label = escapeXml(String(params.label || 'Genre'));
  const typeLabel = typeToken === 'series' ? 'SÉRIES' : 'FILMS';
  if (variant === 'logo') {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="300" viewBox="0 0 1400 300">',
      '<defs>',
      '<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">',
      '<stop offset="0%" stop-color="#05070c"/>',
      '<stop offset="30%" stop-color="#0f172a"/>',
      '<stop offset="100%" stop-color="#111827"/>',
      '</linearGradient>',
      '</defs>',
      '<rect width="1400" height="300" rx="28" fill="url(#fade)"/>',
      `<image href="${dataUri}" x="940" y="0" width="460" height="300" preserveAspectRatio="xMidYMid slice" opacity="0.92"/>`,
      '<rect x="0" y="0" width="1400" height="300" fill="url(#fade)" fill-opacity="0.72"/>',
      `<text x="72" y="132" fill="#f8fbff" font-family="Arial,sans-serif" font-size="84" font-weight="900">${label}</text>`,
      `<text x="78" y="210" fill="#ff3b30" font-family="Arial,sans-serif" font-size="38" font-weight="800" letter-spacing="6">${typeLabel}</text>`,
      '</svg>'
    ].join('');
  }
  const isBackdrop = variant === 'backdrop';
  const width = isBackdrop ? 1920 : 1600;
  const height = isBackdrop ? 1080 : 900;
  const radius = isBackdrop ? 0 : 54;
  const topLabelY = isBackdrop ? 86 : 56;
  const mainLabelY = isBackdrop ? 182 : 284;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    radius ? `<clipPath id="clip"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></clipPath>` : '',
    '<linearGradient id="shadow" x1="0" x2="1" y1="0" y2="0">',
    '<stop offset="0%" stop-color="#05070c" stop-opacity="0.96"/>',
    '<stop offset="46%" stop-color="#05070c" stop-opacity="0.78"/>',
    '<stop offset="100%" stop-color="#05070c" stop-opacity="0.24"/>',
    '</linearGradient>',
    '<linearGradient id="bottomFade" x1="0" x2="0" y1="0" y2="1">',
    '<stop offset="0%" stop-color="#05070c" stop-opacity="0"/>',
    '<stop offset="100%" stop-color="#05070c" stop-opacity="0.68"/>',
    '</linearGradient>',
    '</defs>',
    radius ? '<g clip-path="url(#clip)">' : '<g>',
    `<image href="${dataUri}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`,
    `<rect width="${width}" height="${height}" fill="url(#shadow)"/>`,
    `<rect width="${width}" height="${height}" fill="url(#bottomFade)"/>`,
    !isBackdrop ? `<rect x="48" y="48" width="${width - 96}" height="${height - 96}" rx="42" fill="#ffffff" fill-opacity="0.02" stroke="#ffffff" stroke-opacity="0.18" stroke-width="4"/>` : '',
    `<text x="72" y="${topLabelY}" fill="#ffffff" font-family="Arial,sans-serif" font-size="${isBackdrop ? 42 : 34}" font-weight="800" letter-spacing="3">TMDB GENRES</text>`,
    `<rect x="72" y="${isBackdrop ? 108 : 88}" width="${isBackdrop ? 232 : 188}" height="${isBackdrop ? 60 : 52}" rx="18" fill="#dc2626" fill-opacity="0.95"/>`,
    `<text x="${72 + (isBackdrop ? 116 : 94)}" y="${isBackdrop ? 149 : 123}" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="${isBackdrop ? 34 : 28}" font-weight="900" letter-spacing="4">${typeLabel}</text>`,
    `<text x="72" y="${mainLabelY}" fill="#ffffff" font-family="Arial,sans-serif" font-size="${isBackdrop ? 122 : 92}" font-weight="900">${label}</text>`,
    '</g>',
    '</svg>'
  ].filter(Boolean).join('');
}


const PROVIDERS = [
  { slug: 'netflix', label: 'Netflix', aliases: ['Netflix', 'Netflix Standard with Ads'], monetizationTypes: ['flatrate'] },
  { slug: 'prime-video', label: 'Prime Video', aliases: ['Amazon Prime Video', 'Prime Video', 'Amazon Prime Video with Ads'], monetizationTypes: ['flatrate'] },
  { slug: 'disney-plus', label: 'Disney+', aliases: ['Disney Plus', 'Disney+'], monetizationTypes: ['flatrate'] },
  { slug: 'hbo-max', label: 'HBO Max', aliases: ['HBO Max', 'Max', 'HBO Max Amazon Channel', 'Max Amazon Channel'], matchPrefixes: ['hbo max', 'max'], monetizationTypes: ['flatrate'] },
  { slug: 'apple-tv-plus', label: 'Apple TV+', aliases: ['Apple TV Plus', 'Apple TV+'], monetizationTypes: ['flatrate'] },
  { slug: 'canal-plus', label: 'CANAL+', aliases: ['Canal+', 'Canal Plus', 'CANAL+', 'Canal+ Séries', 'Canal+ Series', 'Canal+ Ciné Séries', 'Canal+ Cine Series'], matchPrefixes: ['canal plus', 'canal+'], monetizationTypes: ['flatrate'] },
  { slug: 'paramount-plus', label: 'Paramount+', aliases: ['Paramount Plus', 'Paramount+', 'Paramount+ Amazon Channel', 'Paramount Plus Amazon Channel', 'Paramount Plus Apple TV Channel'], matchPrefixes: ['paramount plus', 'paramount'], monetizationTypes: ['flatrate'] },
  { slug: 'france-tv', label: 'france.tv', aliases: ['France TV', 'france.tv', 'FranceTV', 'France.tv'], matchPrefixes: ['france tv'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'tf1-plus', label: 'TF1+', aliases: ['TF1+', 'TF1 Plus', 'TF1'], matchPrefixes: ['tf1 plus', 'tf1'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'm6-plus', label: 'M6+', aliases: ['M6+', 'M6 Plus', 'M6'], matchPrefixes: ['m6 plus', 'm6'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'arte', label: 'ARTE', aliases: ['ARTE', 'Arte', 'ARTE.tv', 'Arte France'], matchPrefixes: ['arte'], monetizationTypes: ['flatrate', 'free', 'ads'] },
  { slug: 'crunchyroll', label: 'Crunchyroll', aliases: ['Crunchyroll'], matchPrefixes: ['crunchyroll'], monetizationTypes: ['flatrate'] },
  { slug: 'adn', label: 'ADN', aliases: ['Animation Digital Network', 'ADN', 'ADN - Animation Digital Network'], matchPrefixes: ['animation digital network', 'adn'], monetizationTypes: ['flatrate'] }
];

const PROVIDER_BY_SLUG = new Map(PROVIDERS.map((provider) => [provider.slug, provider]));

const ARCHIVE_MIN_YEAR = 2015;
const ARCHIVE_MAX_YEAR = 2030;
const ARCHIVE_ID_PREFIX = 'archives-fr-v1';
const ARCHIVE_PREWIRE_FUTURE_YEARS = 4;
const ARCHIVE_MONTHS_FR = Object.freeze([
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
]);
const ARCHIVE_VOD_PROVIDER = Object.freeze({ slug: 'vod-fr', label: 'VOD France', aliases: [] });
const ARCHIVE_SERIES_PROVIDERS = Object.freeze(PROVIDERS.slice());
const ARCHIVE_FILM_PROVIDERS = Object.freeze([
  ...PROVIDERS,
  ARCHIVE_VOD_PROVIDER
]);
const ARCHIVE_PROVIDER_BY_SLUG = new Map([
  ...PROVIDERS.map((provider) => [provider.slug, provider]),
  [ARCHIVE_VOD_PROVIDER.slug, ARCHIVE_VOD_PROVIDER]
]);
const ARCHIVE_TYPES = Object.freeze([
  { key: 'series', type: 'series', title: 'Séries', providers: ARCHIVE_SERIES_PROVIDERS },
  { key: 'films', type: 'movie', title: 'Films', providers: ARCHIVE_FILM_PROVIDERS }
]);

// Every platform/category folder begins with the same five rolling periods.
// IDs are deliberately stable: their date windows move with the viewer-local day,
// so no Collection re-import is needed when Today/Tomorrow/Weeks advance.
const ARCHIVE_DYNAMIC_PERIODS = Object.freeze([
  { key: 'today', period: 'today', label: 'Aujourd’hui' },
  { key: 'tomorrow', period: 'tomorrow', label: 'Demain' },
  { key: 'yesterday', period: 'yesterday', label: 'Hier' },
  { key: 'lastweek', period: 'lastweek', label: 'Semaine passée' },
  { key: 'nextweek', period: 'nextweek', label: 'La semaine suivante' }
]);
const ARCHIVE_DYNAMIC_PERIOD_BY_KEY = new Map(ARCHIVE_DYNAMIC_PERIODS.map((entry) => [entry.key, entry]));
const ARCHIVE_DYNAMIC_PERIOD_ORDER = new Map(ARCHIVE_DYNAMIC_PERIODS.map((entry, index) => [entry.key, index]));

// Native Nuvio hierarchy used by the France edition:
//   Collection parent = streaming platform
//   Folder child      = Séries / Films
//   Folder rows       = dynamic periods first, then months + years descending
// Future months are pre-wired but return an empty catalog. Dynamic period IDs
// never change, so all five period rows and month rollovers update automatically.
const PLATFORM_COLLECTIONS = Object.freeze([
  ...PROVIDERS.map((provider) => ({
    provider,
    categories: [
      { key: 'series', type: 'series', title: 'Séries' },
      ...(ARCHIVE_FILM_PROVIDERS.some((entry) => entry.slug === provider.slug)
        ? [{ key: 'films', type: 'movie', title: 'Films' }]
        : [])
    ]
  })),
  { provider: ARCHIVE_VOD_PROVIDER, categories: [{ key: 'films', type: 'movie', title: 'Films' }] }
]);

const PLATFORM_COLLECTION_ID_OVERRIDES = Object.freeze({});


const TMDB_MOVIE_GENRES = Object.freeze([
  { id: 28, slug: 'action', name: 'Action', color: '#ef4444', icon: '⚡' },
  { id: 12, slug: 'adventure', name: 'Aventure', color: '#f59e0b', icon: '🧭' },
  { id: 16, slug: 'animation', name: 'Animation', color: '#8b5cf6', icon: '✨' },
  { id: 35, slug: 'comedy', name: 'Comédie', color: '#22c55e', icon: '😄' },
  { id: 80, slug: 'crime', name: 'Crime', color: '#64748b', icon: '🕵️' },
  { id: 99, slug: 'documentary', name: 'Documentaire', color: '#06b6d4', icon: '📘' },
  { id: 18, slug: 'drama', name: 'Drame', color: '#3b82f6', icon: '🎭' },
  { id: 10751, slug: 'family', name: 'Famille', color: '#ec4899', icon: '👨‍👩‍👧' },
  { id: 14, slug: 'fantasy', name: 'Fantastique', color: '#a855f7', icon: '🪄' },
  { id: 36, slug: 'history', name: 'Histoire', color: '#b45309', icon: '🏛️' },
  { id: 27, slug: 'horror', name: 'Horreur', color: '#991b1b', icon: '🩸' },
  { id: 10402, slug: 'music', name: 'Musique', color: '#10b981', icon: '🎵' },
  { id: 9648, slug: 'mystery', name: 'Mystère', color: '#6366f1', icon: '🧩' },
  { id: 10749, slug: 'romance', name: 'Romance', color: '#f43f5e', icon: '❤️' },
  { id: 878, slug: 'science-fiction', name: 'Science-Fiction', color: '#38bdf8', icon: '🚀' },
  { id: 10770, slug: 'tv-movie', name: 'Téléfilm', color: '#14b8a6', icon: '📺' },
  { id: 53, slug: 'thriller', name: 'Thriller', color: '#e11d48', icon: '🔪' },
  { id: 10752, slug: 'war', name: 'Guerre', color: '#78716c', icon: '🪖' },
  { id: 37, slug: 'western', name: 'Western', color: '#ca8a04', icon: '🤠' }
]);
const TMDB_TV_GENRES = Object.freeze([
  { id: 10759, slug: 'action-adventure', name: 'Action & Aventure', color: '#ef4444', icon: '⚡' },
  { id: 16, slug: 'animation', name: 'Animation', color: '#8b5cf6', icon: '✨' },
  { id: 35, slug: 'comedy', name: 'Comédie', color: '#22c55e', icon: '😄' },
  { id: 80, slug: 'crime', name: 'Crime', color: '#64748b', icon: '🕵️' },
  { id: 99, slug: 'documentary', name: 'Documentaire', color: '#06b6d4', icon: '📘' },
  { id: 18, slug: 'drama', name: 'Drame', color: '#3b82f6', icon: '🎭' },
  { id: 10751, slug: 'family', name: 'Famille', color: '#ec4899', icon: '👨‍👩‍👧' },
  { id: 10762, slug: 'kids', name: 'Jeunesse', color: '#f97316', icon: '🧒' },
  { id: 9648, slug: 'mystery', name: 'Mystère', color: '#6366f1', icon: '🧩' },
  { id: 10763, slug: 'news', name: 'Actualités', color: '#0ea5e9', icon: '📰' },
  { id: 10764, slug: 'reality', name: 'Téléréalité', color: '#f59e0b', icon: '🎬' },
  { id: 10765, slug: 'scifi-fantasy', name: 'SF & Fantastique', color: '#38bdf8', icon: '🪐' },
  { id: 10766, slug: 'soap', name: 'Soap', color: '#fb7185', icon: '💞' },
  { id: 10767, slug: 'talk', name: 'Talk', color: '#84cc16', icon: '🎤' },
  { id: 10768, slug: 'war-politics', name: 'Guerre & Politique', color: '#78716c', icon: '🏛️' },
  { id: 37, slug: 'western', name: 'Western', color: '#ca8a04', icon: '🤠' }
]);
const TMDB_GENRE_COLLECTION = Object.freeze({ slug: 'tmdb-genres', label: 'Genres TMDb' });

const GENRE_POSTER_FILES = Object.freeze({
  'movie:action': 'action.png',
  'movie:animation': 'animation.png',
  'movie:comedy': 'comedy.png',
  'movie:crime': 'crime.png',
  'movie:documentary': 'documentary.png',
  'movie:drama': 'drama.png',
  'movie:fantasy': 'fantasy.png',
  'movie:horror': 'horror.png',
  'movie:romance': 'romance.png',
  'movie:science-fiction': 'science-fiction.png',
  'series:action-adventure': 'action.png',
  'series:animation': 'animation.png',
  'series:comedy': 'comedy.png',
  'series:crime': 'crime.png',
  'series:documentary': 'documentary.png',
  'series:drama': 'drama.png',
  'series:scifi-fantasy': 'fantasy.png'
});
const GENRE_POSTER_DIR_SAFE = path.resolve(__dirname, '../../../assets/genre-posters');

function genrePosterFile(type, genreSlug) {
  return GENRE_POSTER_FILES[`${type}:${genreSlug}`] || null;
}

function genrePosterUrl(origin, genre, type) {
  const typeToken = type === 'series' ? 'series' : 'movie';
  const fileName = genrePosterFile(typeToken, genre.slug);
  if (!origin || !fileName) return null;
  return `${origin}/genre-poster.png?type=${encodeURIComponent(typeToken)}&genre=${encodeURIComponent(genre.slug)}&v=${VISUAL_REV}`;
}


function genreCatalogBaseId(type, genreId) {
  return `genres-fr-${type === 'movie' ? 'movie' : 'series'}-${genreId}`;
}

// Backward compatibility: the old genre catalog ID is now the stable "Aujourd’hui/Today" row.
function genreCatalogId(type, genreId) {
  return genreCatalogBaseId(type, genreId);
}

function genreDynamicCatalogId(type, genreId, periodKey) {
  if (periodKey === 'today') return genreCatalogBaseId(type, genreId);
  return `${genreCatalogBaseId(type, genreId)}-${periodKey}`;
}

function genreMonthlyCatalogId(type, genreId, year, month) {
  return `${genreCatalogBaseId(type, genreId)}-${year}-${String(month).padStart(2, '0')}`;
}

function genreDescriptor(type, genre, options = {}) {
  const period = options.period || 'today';
  const name = options.name || genre.name;
  const descriptor = {
    type,
    name,
    providerSlug: TMDB_GENRE_COLLECTION.slug,
    cardProvider: `${TMDB_GENRE_COLLECTION.label} • ${genre.name}`,
    period,
    source: 'tmdb-streaming-genre',
    section: type === 'movie' ? 'films' : 'series-streaming',
    noFilters: true,
    explore: true,
    tmdbGenreId: genre.id,
    tmdbGenreSlug: genre.slug,
    genreName: genre.name,
    genreColor: genre.color,
    genreIcon: genre.icon,
    genreCategory: type === 'movie' ? 'films' : 'series',
    archiveProvider: TMDB_GENRE_COLLECTION.slug,
    archiveProviderLabel: TMDB_GENRE_COLLECTION.label,
    archiveCategory: type === 'movie' ? 'films' : 'series',
    archiveKind: options.archivePeriodKey ? 'genre-period' : 'genre-month'
  };
  if (options.archivePeriodKey) descriptor.archivePeriodKey = options.archivePeriodKey;
  if (Number.isInteger(options.archiveYear)) descriptor.archiveYear = options.archiveYear;
  if (Number.isInteger(options.archiveMonth)) descriptor.archiveMonth = options.archiveMonth;
  return descriptor;
}

function buildGenreCatalogEntries(now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  const entries = [];
  const groups = [
    { type: 'movie', genres: TMDB_MOVIE_GENRES },
    { type: 'series', genres: TMDB_TV_GENRES }
  ];

  // Exactly the same five predefined rolling periods as every platform folder.
  for (const group of groups) {
    for (const genre of group.genres) {
      for (const definition of ARCHIVE_DYNAMIC_PERIODS) {
        entries.push({
          id: genreDynamicCatalogId(group.type, genre.id, definition.key),
          catalog: genreDescriptor(group.type, genre, {
            name: definition.label,
            period: definition.period,
            archivePeriodKey: definition.key
          })
        });
      }
    }
  }

  // Then the same pre-wired month/year rows, in the same range as the platform archives.
  for (const year of archivePrewiredYears(now, timeZone)) {
    for (const group of groups) {
      for (const genre of group.genres) {
        for (let month = 12; month >= 1; month -= 1) {
          entries.push({
            id: genreMonthlyCatalogId(group.type, genre.id, year, month),
            catalog: genreDescriptor(group.type, genre, {
              name: `${ARCHIVE_MONTHS_FR[month - 1]} ${year}`,
              period: archivePeriod(year, month),
              archiveYear: year,
              archiveMonth: month
            })
          });
        }
      }
    }
  }
  return entries;
}

function genreImageUrls(origin, genre, type = 'movie') {
  if (!origin) return { card: null, backdrop: null, logo: null };
  const typeToken = type === 'series' ? 'series' : 'movie';
  const params = `genre=${encodeURIComponent(genre.slug)}&label=${encodeURIComponent(genre.name)}&type=${typeToken}&color=${encodeURIComponent(genre.color)}&icon=${encodeURIComponent(genre.icon)}&v=${VISUAL_REV}`;
  return { card: `${origin}/genre-folder-art.svg?variant=card&${params}`, backdrop: `${origin}/genre-folder-art.svg?variant=backdrop&${params}`, logo: `${origin}/genre-folder-art.svg?variant=logo&${params}` };
}

function genreSourceEntries(entries, type, genreId) {
  return entries
    .filter((entry) => entry.catalog.source === 'tmdb-streaming-genre' && entry.catalog.type === type && entry.catalog.tmdbGenreId === genreId)
    .sort((a, b) => {
      const aPeriod = a.catalog.archivePeriodKey;
      const bPeriod = b.catalog.archivePeriodKey;
      if (aPeriod || bPeriod) {
        if (aPeriod && bPeriod) return ARCHIVE_DYNAMIC_PERIOD_ORDER.get(aPeriod) - ARCHIVE_DYNAMIC_PERIOD_ORDER.get(bPeriod);
        return aPeriod ? -1 : 1;
      }
      if (a.catalog.archiveYear !== b.catalog.archiveYear) return b.catalog.archiveYear - a.catalog.archiveYear;
      return b.catalog.archiveMonth - a.catalog.archiveMonth;
    });
}

function buildGenreFolder(entries, origin, genre, type) {
  const isMovie = type === 'movie';
  const sourceEntries = genreSourceEntries(entries, type, genre.id);
  const images = genreImageUrls(origin, genre, type);
  return {
    id: `genres-fr-${isMovie ? 'movie' : 'series'}-folder-${genre.id}`,
    title: genre.name,
    coverImageUrl: images.card,
    focusGifEnabled: false,
    coverEmoji: genre.icon,
    tileShape: 'LANDSCAPE',
    hideTitle: true,
    heroBackdropUrl: images.backdrop,
    heroVideoUrl: null,
    titleLogoUrl: images.logo,
    sources: sourceEntries.map(collectionAddonSource),
    catalogSources: sourceEntries.map(collectionLegacyCatalogSource)
  };
}

function buildGenreCollectionByType(entries, origin = null, type = 'movie') {
  const isMovie = type === 'movie';
  const genres = isMovie ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
  return {
    // Keep the old Collection id for Films so importing this release updates the
    // existing Genres parent instead of duplicating it. Series gets one new id.
    id: isMovie ? 'calendar-archives-fr-genres' : 'calendar-archives-fr-genres-series',
    title: isMovie ? '🇫🇷 Genres · Films' : '🇫🇷 Genres · Séries',
    backdropImageUrl: origin ? `${origin}/genre-collection-art.jpg?type=${isMovie ? 'movie' : 'series'}&v=${VISUAL_REV}` : null,
    pinToTop: true,
    focusGlowEnabled: true,
    viewMode: 'FOLLOW_LAYOUT',
    showAllTab: false,
    genreRow: isMovie ? 1 : 2,
    folders: genres.map((genre) => buildGenreFolder(entries, origin, genre, type))
  };
}

function buildGenreCollections(entries, origin = null) {
  // Nuvio has only Collection -> Folder -> Sources, no recursive genre folder.
  // Two adjacent Collections are therefore the native, functional equivalent of
  // the requested two horizontal genre blocks: Films first, Series second.
  return [
    buildGenreCollectionByType(entries, origin, 'movie'),
    buildGenreCollectionByType(entries, origin, 'series')
  ];
}

// Backward-compatible helper retained for old tests/integrations.
function buildGenreCollection(entries, origin = null) {
  return buildGenreCollectionByType(entries, origin, 'movie');
}

async function resolveAllStreamingProviderIds(type) {
  const directory = await providerDirectory(type);
  const ids = new Set();
  for (const provider of PROVIDERS) {
    const resolved = resolveProviderFromDirectory(provider, directory);
    for (const id of resolved?.ids || []) ids.add(Number(id));
  }
  return [...ids].filter(Number.isFinite);
}

function genreDiscoverParams(catalog, providerIds, page, window) {
  const common = {
    language: getConfig().language,
    page,
    include_adult: false,
    sort_by: 'popularity.desc',
    with_genres: String(catalog.tmdbGenreId),
    watch_region: DEFAULT_COUNTRY,
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: 'flatrate|free|ads'
  };
  if (catalog.type === 'movie') return {
    ...common,
    region: DEFAULT_COUNTRY,
    with_release_type: '4',
    'release_date.gte': window.start,
    'release_date.lte': window.end
  };
  return {
    ...common,
    'first_air_date.gte': window.start,
    'first_air_date.lte': window.end,
    include_null_first_air_dates: false
  };
}

async function discoverGenreCandidates(catalog, providerIds, window) {
  const endpoint = catalog.type === 'movie' ? '/discover/movie' : '/discover/tv';
  const maxCandidates = Math.max(getConfig().maxItems, 120);
  const items = [];
  for (let page = 1; page <= 8 && items.length < maxCandidates; page += 1) {
    const payload = await tmdbFetch(endpoint, genreDiscoverParams(catalog, providerIds, page, window));
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

function genreMovieDigitalDate(details, window) {
  const country = (details?.release_dates?.results || []).find((entry) => entry?.iso_3166_1 === DEFAULT_COUNTRY);
  const dates = (country?.release_dates || [])
    .filter((entry) => Number(entry?.type) === 4)
    .map((entry) => normalizeIsoDate(entry?.release_date))
    .filter(Boolean)
    .sort();
  return dates.find((date) => date >= window.start && date <= window.end) || null;
}

function detailsToGenreMeta(details, catalog, window) {
  const type = catalog.type === 'movie' ? 'movie' : 'series';
  const date = type === 'movie'
    ? genreMovieDigitalDate(details, window)
    : normalizeIsoDate(details?.first_air_date);
  if (!date) return { meta: null, reason: 'date-unknown' };
  if (date < window.start || date > window.end) return { meta: null, reason: date < window.today ? 'past' : 'outside-window' };
  const label = `${TMDB_GENRE_COLLECTION.label} • ${catalog.type === 'movie' ? 'Films' : 'Séries'} • ${catalog.genreName}`;
  const meta = baseMeta(details, type, date, label);
  meta.description = [
    `${label} • Marché France`,
    meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventMode = EVENT_MODES.STREAMING_DATE;
  return { meta, reason: null };
}

async function buildGenreStreamingCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({ providerSlug: `${TMDB_GENRE_COLLECTION.slug}:${catalog.type}:${catalog.tmdbGenreId}`, type: catalog.type, period, timeZone, today: window.today, sourceVersion: `${SOURCE_VERSION}-genres-periods-v2` });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats({ label: `${TMDB_GENRE_COLLECTION.label} ${catalog.genreName}`, ids: [] }, { ...catalog, period }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const providerIds = await resolveAllStreamingProviderIds(catalog.type);
  if (!providerIds.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const raw = await discoverGenreCandidates(catalog, providerIds, window);
  stats.candidates = raw.length;
  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails(catalog.type, candidate.id);
    return detailsToGenreMeta(details, catalog, window);
  });
  const metas = [];
  for (const result of settled) {
    if (result?.error) { stats.enrichmentErrors += 1; continue; }
    if (!result?.meta) { countReason(stats, result?.reason); continue; }
    metas.push(result.meta);
  }
  const sorted = sortAndDedupeMetas(metas).slice(0, getConfig().maxItems);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  stats.final = sorted.length;
  const result = { metas: sorted.map(cleanCatalogMeta), stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

function genreFolderArtSvg(params = {}) {
  const label = escapeXml(String(params.label || 'Genre'));
  const rawLabel = String(params.label || 'Genre');
  const variant = String(params.variant || 'card');
  const typeToken = String(params.type || 'movie') === 'series' ? 'series' : 'movie';
  const typeLabel = typeToken === 'series' ? 'SÉRIES' : 'FILMS';
  const color = /^#?[0-9a-fA-F]{6}$/.test(String(params.color || '').replace('#','')) ? (String(params.color).startsWith('#') ? String(params.color) : `#${String(params.color)}`) : '#38bdf8';
  const photoDataUri = genreCinematicDataUri(params.genre, variant === 'backdrop' ? 'backdrop' : 'card');
  const compactLen = rawLabel.replace(/\s/g, '').length;
  const logoFont = compactLen > 22 ? 104 : compactLen > 16 ? 122 : compactLen > 11 ? 140 : 158;
  const cardFont = compactLen > 22 ? 112 : compactLen > 16 ? 130 : compactLen > 11 ? 152 : 178;
  const backdropFont = compactLen > 22 ? 142 : compactLen > 16 ? 164 : compactLen > 11 ? 190 : 224;
  if (variant === 'logo') return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="300" viewBox="0 0 1400 300"><rect width="1400" height="300" fill="none"/><rect x="20" y="38" width="12" height="220" rx="6" fill="${color}"/><text x="72" y="164" fill="#fff" font-family="Arial,sans-serif" font-size="${logoFont}" font-weight="900" letter-spacing="-2">${label}</text><text x="78" y="244" fill="${color}" font-family="Arial,sans-serif" font-size="52" font-weight="900" letter-spacing="7">${typeLabel}</text></svg>`;
  const isBackdrop = variant === 'backdrop';
  const width = isBackdrop ? 1920 : 1600;
  const height = isBackdrop ? 1080 : 900;
  const image = photoDataUri ? `<image href="${escapeXml(photoDataUri)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${width}" height="${height}" fill="#07111f"/>`;
  if (isBackdrop) return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="r" x1="0" x2="1"><stop stop-color="#02040a" stop-opacity=".90"/><stop offset=".56" stop-color="#02040a" stop-opacity=".48"/><stop offset="1" stop-color="#02040a" stop-opacity=".04"/></linearGradient></defs>${image}<rect width="1920" height="1080" fill="url(#r)"/><rect x="104" y="116" width="12" height="390" rx="6" fill="${color}"/><text x="154" y="205" fill="#fff" font-family="Arial,sans-serif" font-size="68" font-weight="900" letter-spacing="5">TMDb GENRES</text><text x="154" y="315" fill="${color}" font-family="Arial,sans-serif" font-size="56" font-weight="900" letter-spacing="6">${typeLabel}</text><text x="150" y="505" fill="#fff" font-family="Arial,sans-serif" font-size="${backdropFont}" font-weight="900" letter-spacing="-3">${label}</text></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><clipPath id="c"><rect width="1600" height="900" rx="44"/></clipPath><linearGradient id="r" x1="0" x2="1"><stop stop-color="#02040a" stop-opacity=".94"/><stop offset=".55" stop-color="#02040a" stop-opacity=".56"/><stop offset="1" stop-color="#02040a" stop-opacity=".05"/></linearGradient></defs><g clip-path="url(#c)">${image}<rect width="1600" height="900" fill="url(#r)"/></g><rect x="76" y="70" width="12" height="305" rx="6" fill="${color}"/><text x="124" y="143" fill="#e7edf7" font-family="Arial,sans-serif" font-size="44" font-weight="900" letter-spacing="5">TMDb GENRES</text><text x="120" y="300" fill="#fff" font-family="Arial,sans-serif" font-size="${cardFont}" font-weight="900" letter-spacing="-3">${label}</text><text x="126" y="380" fill="${color}" font-family="Arial,sans-serif" font-size="58" font-weight="900" letter-spacing="7">${typeLabel}</text><rect x="0" y="0" width="1600" height="900" rx="44" fill="none" stroke="#fff" stroke-opacity=".20" stroke-width="5"/></svg>`;
}

function archiveNowParts(now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  const today = localIsoDate(now, timeZone);
  const [year, month] = today.split('-').map(Number);
  return { today, year, month };
}

function archivePeriod(year, month) {
  return `archive-${year}-${String(month).padStart(2, '0')}`;
}

function archiveCatalogId(type, providerSlug, year, month) {
  const typeToken = type === 'movie' ? 'movie' : 'series';
  return `${ARCHIVE_ID_PREFIX}-${typeToken}-${providerSlug}-${year}-${String(month).padStart(2, '0')}`;
}

function archiveDynamicCatalogId(type, providerSlug, periodKey) {
  const typeToken = type === 'movie' ? 'movie' : 'series';
  return `${ARCHIVE_ID_PREFIX}-${typeToken}-${providerSlug}-${periodKey}`;
}

function archiveSourceFor(type, provider) {
  if (type === 'movie' && provider.slug === ARCHIVE_VOD_PROVIDER.slug) return 'tmdb-vod';
  if (type === 'series' && provider.slug === 'crunchyroll') return 'crunchyroll-anime-combined';
  return 'tmdb-streaming';
}

function archiveDescriptor(type, provider, year, month) {
  const monthLabel = ARCHIVE_MONTHS_FR[month - 1];
  const source = archiveSourceFor(type, provider);
  const isVod = source === 'tmdb-vod';
  const isCrunchyrollAnime = source === 'crunchyroll-anime-combined';
  return {
    type,
    // Platform and category are already represented by Collection -> Folder,
    // so the row itself is only the month + year.
    name: `${monthLabel} ${year}`,
    providerSlug: provider.slug,
    cardProvider: provider.label,
    period: archivePeriod(year, month),
    source,
    section: isCrunchyrollAnime ? 'anime' : (type === 'movie' ? 'films' : 'series-streaming'),
    noFilters: true,
    explore: true,
    archiveYear: year,
    archiveMonth: month,
    archiveProvider: provider.slug,
    archiveProviderLabel: provider.label,
    archiveCategory: type === 'movie' ? 'films' : 'series',
    archiveKind: isVod ? 'vod' : (isCrunchyrollAnime ? 'crunchyroll+anime' : 'streaming')
  };
}

function archiveDynamicDescriptor(type, provider, periodKey) {
  const definition = ARCHIVE_DYNAMIC_PERIOD_BY_KEY.get(periodKey);
  if (!definition) return null;
  const source = archiveSourceFor(type, provider);
  const isVod = source === 'tmdb-vod';
  const isCrunchyrollAnime = source === 'crunchyroll-anime-combined';
  return {
    type,
    name: definition.label,
    providerSlug: provider.slug,
    cardProvider: provider.label,
    period: definition.period,
    source,
    section: isCrunchyrollAnime ? 'anime' : (type === 'movie' ? 'films' : 'series-streaming'),
    noFilters: true,
    explore: true,
    archivePeriodKey: definition.key,
    archiveProvider: provider.slug,
    archiveProviderLabel: provider.label,
    archiveCategory: type === 'movie' ? 'films' : 'series',
    archiveKind: isVod ? 'vod-period' : (isCrunchyrollAnime ? 'crunchyroll+anime-period' : 'streaming-period')
  };
}

function archivePrewiredYears(now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  // Fixed archive contract requested by the Collection UI: December 2030 down to January 2015.
  // Keeping this range stable prevents imports from changing shape as the current year moves.
  const years = [];
  for (let year = ARCHIVE_MAX_YEAR; year >= ARCHIVE_MIN_YEAR; year -= 1) years.push(year);
  return years;
}

function archiveYearIsVisible(year, now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  // Every pre-defined archive month is a real, selectable period. Historical rows must not
  // silently turn empty just because they are older than a rolling two-year window.
  return Number.isInteger(year) && year >= ARCHIVE_MIN_YEAR && year <= ARCHIVE_MAX_YEAR;
}

function buildArchiveCatalogEntries(now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  const entries = [];

  // Stable rolling periods are first in every folder.
  for (const category of ARCHIVE_TYPES) {
    for (const provider of category.providers) {
      for (const definition of ARCHIVE_DYNAMIC_PERIODS) {
        const catalog = archiveDynamicDescriptor(category.type, provider, definition.key);
        entries.push({ id: archiveDynamicCatalogId(category.type, provider.slug, definition.key), catalog });
      }
    }
  }

  // Month rows are pre-wired across previous/current/next year.
  for (const year of archivePrewiredYears(now, timeZone)) {
    for (const category of ARCHIVE_TYPES) {
      for (const provider of category.providers) {
        for (let month = 12; month >= 1; month -= 1) {
          const catalog = archiveDescriptor(category.type, provider, year, month);
          entries.push({ id: archiveCatalogId(category.type, provider.slug, year, month), catalog });
        }
      }
    }
  }
  return entries;
}

function archiveProviderAllowed(expectedType, providerSlug) {
  if (expectedType === 'movie') return ARCHIVE_FILM_PROVIDERS.some((entry) => entry.slug === providerSlug);
  return ARCHIVE_SERIES_PROVIDERS.some((entry) => entry.slug === providerSlug);
}

function resolveArchiveCatalog(catalogId, type, now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  const raw = String(catalogId || '');

  const genreMonthly = raw.match(/^genres-fr-(series|movie)-(\d+)-(\d{4})-(\d{2})$/);
  if (genreMonthly) {
    const expectedType = genreMonthly[1] === 'movie' ? 'movie' : 'series';
    const genreId = Number(genreMonthly[2]);
    const year = Number(genreMonthly[3]);
    const month = Number(genreMonthly[4]);
    const allowedYears = new Set(archivePrewiredYears(now, timeZone));
    if (type !== expectedType || !allowedYears.has(year) || month < 1 || month > 12) return null;
    const list = expectedType === 'movie' ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
    const match = list.find((entry) => entry.id === genreId);
    return match ? genreDescriptor(expectedType, match, {
      name: `${ARCHIVE_MONTHS_FR[month - 1]} ${year}`,
      period: archivePeriod(year, month),
      archiveYear: year,
      archiveMonth: month
    }) : null;
  }

  const genreDynamic = raw.match(/^genres-fr-(series|movie)-(\d+)(?:-(today|tomorrow|yesterday|lastweek|nextweek))?$/);
  if (genreDynamic) {
    const expectedType = genreDynamic[1] === 'movie' ? 'movie' : 'series';
    if (type !== expectedType) return null;
    const periodKey = genreDynamic[3] || 'today';
    const definition = ARCHIVE_DYNAMIC_PERIOD_BY_KEY.get(periodKey);
    if (!definition) return null;
    const list = expectedType === 'movie' ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
    const match = list.find((entry) => entry.id === Number(genreDynamic[2]));
    return match ? genreDescriptor(expectedType, match, { name: definition.label, period: definition.period, archivePeriodKey: definition.key }) : null;
  }

  const dynamic = raw.match(/^archives-fr-v1-(series|movie)-([a-z0-9-]+)-(today|tomorrow|yesterday|lastweek|nextweek)$/);
  if (dynamic) {
    const expectedType = dynamic[1] === 'movie' ? 'movie' : 'series';
    const providerSlug = dynamic[2];
    const periodKey = dynamic[3];
    if (type !== expectedType || !archiveProviderAllowed(expectedType, providerSlug)) return null;
    const provider = ARCHIVE_PROVIDER_BY_SLUG.get(providerSlug);
    if (!provider) return null;
    return archiveDynamicDescriptor(expectedType, provider, periodKey);
  }

  const monthly = raw.match(/^archives-fr-v1-(series|movie)-([a-z0-9-]+)-(\d{4})-(\d{2})$/);
  if (!monthly) return null;
  const expectedType = monthly[1] === 'movie' ? 'movie' : 'series';
  const providerSlug = monthly[2];
  const year = Number(monthly[3]);
  const month = Number(monthly[4]);
  const allowedYears = new Set(archivePrewiredYears(now, timeZone));
  if (type !== expectedType || !allowedYears.has(year) || month < 1 || month > 12) return null;
  const provider = ARCHIVE_PROVIDER_BY_SLUG.get(providerSlug);
  if (!provider || !archiveProviderAllowed(expectedType, providerSlug)) return null;
  return archiveDescriptor(expectedType, provider, year, month);
}

function collectionAddonSource(entry) {
  return {
    provider: 'addon',
    addonId: 'com.nuvio.calendar.archives.fr.coexist',
    type: entry.catalog.type,
    catalogId: entry.id
  };
}

function collectionLegacyCatalogSource(entry) {
  return {
    addonId: 'com.nuvio.calendar.archives.fr.coexist',
    type: entry.catalog.type,
    catalogId: entry.id
  };
}

function platformCollectionId(providerSlug) {
  return `calendar-archives-fr-${providerSlug}`;
}

function platformImageUrls(origin, providerSlug, categoryType = 'movie') {
  if (!origin) return { backdrop: null, logo: null };
  const type = categoryType === 'series' ? 'series' : 'movie';
  return {
    backdrop: `${origin}/platform-backdrop.svg?provider=${encodeURIComponent(providerSlug)}&type=${type}&v=${VISUAL_REV}`,
    logo: `${origin}/platform-logo?provider=${encodeURIComponent(providerSlug)}&type=${type}&v=${VISUAL_REV}`
  };
}

function buildPlatformCollection(definition, entries, origin = null) {
  const { provider, categories } = definition;
  const collectionImages = platformImageUrls(origin, provider.slug, categories[0]?.type || 'movie');
  const folders = categories.map((category) => {
    const sourceEntries = entries
      .filter((entry) => entry.catalog.providerSlug === provider.slug && entry.catalog.type === category.type)
      .sort((a, b) => {
        const aPeriod = a.catalog.archivePeriodKey;
        const bPeriod = b.catalog.archivePeriodKey;
        if (aPeriod || bPeriod) {
          if (aPeriod && bPeriod) return ARCHIVE_DYNAMIC_PERIOD_ORDER.get(aPeriod) - ARCHIVE_DYNAMIC_PERIOD_ORDER.get(bPeriod);
          return aPeriod ? -1 : 1;
        }
        if (a.catalog.archiveYear !== b.catalog.archiveYear) return b.catalog.archiveYear - a.catalog.archiveYear;
        return b.catalog.archiveMonth - a.catalog.archiveMonth;
      });
    const images = platformImageUrls(origin, provider.slug, category.type);
    return {
      id: `archives-fr-${provider.slug}-${category.key}`,
      title: category.title,
      coverImageUrl: origin ? `${origin}/platform-category-card.svg?provider=${encodeURIComponent(provider.slug)}&category=${category.key}&v=${VISUAL_REV}` : null,
      focusGifEnabled: false,
      coverEmoji: category.type === 'movie' ? '🎬' : '📺',
      tileShape: 'LANDSCAPE',
      hideTitle: true,
      heroBackdropUrl: images.backdrop,
      heroVideoUrl: null,
      titleLogoUrl: images.logo,
      sources: sourceEntries.map(collectionAddonSource),
      catalogSources: sourceEntries.map(collectionLegacyCatalogSource)
    };
  });
  return {
    id: platformCollectionId(provider.slug),
    title: regionCollectionTitle(provider.slug),
    backdropImageUrl: collectionImages.backdrop,
    pinToTop: true,
    focusGlowEnabled: true,
    viewMode: 'FOLLOW_LAYOUT',
    showAllTab: false,
    folders
  };
}

function buildNuvioCollectionsImport(now = runtimeNow(), timeZone = DEFAULT_TIMEZONE, origin = null) {
  const entries = [...buildArchiveCatalogEntries(now, timeZone), ...buildGenreCatalogEntries(now, timeZone)];
  return [...PLATFORM_COLLECTIONS.map((definition) => buildPlatformCollection(definition, entries, origin)), ...buildGenreCollections(entries, origin)];
}

function buildArchiveBlueprint(now = runtimeNow(), timeZone = DEFAULT_TIMEZONE, origin = null) {
  const collections = buildNuvioCollectionsImport(now, timeZone, origin);
  return {
    schema: 'nuvio-calendar-archives-fr-blueprint-v1.0.2',
    generatedForTimezone: timeZone,
    market: 'FR',
    language: 'fr-FR',
    archiveMinYear: ARCHIVE_MIN_YEAR,
    visibleRollingYears: 2,
    prewiredFutureYears: ARCHIVE_PREWIRE_FUTURE_YEARS,
    dynamicPeriods: ARCHIVE_DYNAMIC_PERIODS.map((entry) => ({ key: entry.key, label: entry.label, period: entry.period })),
    hierarchy: 'platform collection -> Series/Films folder -> dynamic periods -> month+year rows descending -> content',
    platformParents: PLATFORM_COLLECTIONS.map((entry) => regionCollectionTitle(entry.provider.slug)),
    collections,
    importPayload: collections,
    importPath: '/nuvio-collections.json',
    note: 'Chaque plateforme est un parent Nuvio. Dans le parent, Séries et/ou Films sont les cartes Modern. Chaque dossier commence par Aujourd’hui, Demain, Hier, Semaine passée et La semaine suivante, puis les mois + années décroissants. Les périodes suivent automatiquement la date locale. Les mois futurs sont pré-câblés et apparaissent automatiquement. Crunchyroll + AniList fusionne son catalogue streaming avec les animes AniList et ajoute aussi les films d’anime. VOD France est Films uniquement. Les cartes utilisent les logos plateformes haute définition et un habillage vectoriel Modern.'
  };
}

// Archive source/filter definitions reused from the live Calendar engine.
const PERIOD_OPTIONS = Object.freeze([
  { label: 'Mois dernier', value: 'lastmonth' },
  { label: 'Ce mois', value: 'month' },
  { label: '7 derniers jours', value: 'past7' },
  { label: 'Aujourd’hui', value: 'today' },
  { label: 'Demain', value: 'tomorrow' },
  { label: 'Dans les 7 jours', value: 'next7' }
]);
const FILM_EXTRA_CATALOGS = Object.freeze([
  { label: 'Actuellement au cinéma', value: 'nowplaying' },
  { label: 'Upcoming Movies — 1 an', value: 'upcomingyear' }
]);
const PERIOD_LABELS = new Map([...PERIOD_OPTIONS, ...FILM_EXTRA_CATALOGS].map((entry) => [entry.value, entry.label]));
const STREAMING_PROVIDERS = Object.freeze(PROVIDERS.filter((provider) => provider.slug !== 'crunchyroll'));
const SERIES_STREAMING_FILTERS = Object.freeze([
  { label: 'Avec heure précise', value: 'timed', kind: 'special' },
  { label: 'Multi-plateformes', value: 'multi', kind: 'special' }
]);
const TVUSA_FILTERS = Object.freeze([
  { label: 'TV France • Prioritaire', value: 'tv-fr', kind: 'source' },
  { label: 'TV France • Tout', value: 'tv-fr-all', kind: 'source' }
]);
const ANIME_FILTERS = Object.freeze([
  { label: 'Airing anime', value: 'anime-airing', kind: 'source' },
  { label: 'Crunchyroll', value: 'crunchyroll', kind: 'provider' },
  { label: 'Avec heure précise', value: 'timed', kind: 'special' }
]);
const MOVIE_SPECIAL_FILTERS = Object.freeze([
  { label: 'VOD France', value: 'vod', kind: 'source' },
  { label: 'Multi-plateformes', value: 'multi', kind: 'special' }
]);
function catalogSection(catalog) {
  if (typeof catalog === 'string') return catalog === 'movie' ? 'films' : 'series-streaming';
  return catalog?.section || (catalog?.type === 'movie' ? 'films' : 'series-streaming');
}
function filterOptionsForCatalog(catalog) {
  if (catalog?.noFilters) return [];
  const section = catalogSection(catalog);
  if (section === 'tvusa') return [...TVUSA_FILTERS];
  if (section === 'anime') return [...ANIME_FILTERS];
  const providers = STREAMING_PROVIDERS.map((provider) => ({ label: provider.label, value: provider.slug, kind: 'provider' }));
  return section === 'films' ? [...MOVIE_SPECIAL_FILTERS, ...providers] : [...SERIES_STREAMING_FILTERS, ...providers];
}
function filterOptionsForType(type) {
  return filterOptionsForCatalog({ type, section: type === 'movie' ? 'films' : 'series-streaming' });
}

function normalizedFilterValue(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .trim()
    .toLowerCase();
}

function filterFromExtra(value, catalog) {
  const normalized = normalizedFilterValue(value);
  if (!normalized) return null;
  for (const option of filterOptionsForCatalog(catalog)) {
    const aliases = [option.value, option.label, option.label.replace(/\+/g, ' plus ')].map(normalizedFilterValue);
    if (aliases.includes(normalized)) return option;
  }
  return null;
}

function filterCombinedMetas(metas, filter, type) {
  if (!filter) return metas || [];
  if (filter.kind === 'provider') {
    const provider = PROVIDER_BY_SLUG.get(filter.value);
    if (!provider) return [];
    return (metas || []).filter((meta) => (meta._calendarProviders || []).includes(provider.label));
  }
  if (filter.value === 'multi') {
    return (metas || []).filter((meta) => (meta._calendarProviders || []).length > 1);
  }
  if (filter.value === 'timed') {
    return (metas || []).filter((meta) => releaseClockMinutes(meta) !== null);
  }
  if (filter.value === 'vod') {
    return (metas || []).filter((meta) => (meta._calendarProviders || []).includes('VOD France') || meta._calendarSource === 'tmdb-vod');
  }
  if (type !== 'series') return metas || [];
  if (filter.value === 'tv-fr' || filter.value === 'tv-fr-all') return (metas || []).filter((meta) => meta._calendarSource === 'tvmaze-broadcast');
  if (filter.value === 'anime-airing') return (metas || []).filter((meta) => meta._calendarSource === 'anilist-airing');
  return metas || [];
}

function parseSkip(value) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 10000);
}

function normalizePeriodLabel(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .trim()
    .toLowerCase();
}

function periodFromExtra(value, fallback = 'today') {
  const normalized = normalizePeriodLabel(value);
  if (!normalized) return fallback;
  if (['lastyear', 'annee derniere', 'previous year', 'last year'].includes(normalized)) return 'lastyear';
  if (['lastmonth', 'mois dernier', 'previous month', 'mois precedent'].includes(normalized)) return 'lastmonth';
  if (['lastweek', 'semaine derniere', 'previous week', '7 jours precedents'].includes(normalized)) return 'lastweek';
  if (['today', "aujourd'hui", 'aujourdhui'].includes(normalized)) return 'today';
  if (['tomorrow', 'demain'].includes(normalized)) return 'tomorrow';
  if (['next7', 'dans les 7 jours', 'prochains jours sans demain', 'j+2 -> j+7'].includes(normalized)) return 'next7';
  if (['nowplaying', 'actuellement au cinema', 'cinema actuel', 'now playing'].includes(normalized)) return 'nowplaying';
  if (['upcomingyear', 'upcoming movies 1 an', 'upcoming movies — 1 an', 'films a venir 1 an'].includes(normalized)) return 'upcomingyear';
  // Legacy aliases remain callable but are no longer advertised.
  if (['month', 'ce mois', 'mois en cours', "ce mois jusqu'a hier", 'month to date', 'month-to-date'].includes(normalized)) return 'month';
  if (['past7', 'last 7 days', '7 derniers jours', 'derniers 7 jours'].includes(normalized)) return 'past7';
  if (['week', '7 days', '7 jours', '7 prochains jours', 'cette semaine'].includes(normalized)) return 'week';
  if (['upcoming', 'a venir', 'a venir (j+1 -> j+6)'].includes(normalized)) return 'upcoming';
  return fallback;
}

function parseCatalogExtraSegment(segment = '') {
  if (!segment) return {};
  const output = {};
  for (const part of String(segment).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq >= 0 ? part.slice(0, eq) : part;
    const rawValue = eq >= 0 ? part.slice(eq + 1) : '';
    let key = rawKey;
    let value = rawValue;
    try { key = decodeURIComponent(rawKey); } catch {}
    try { value = decodeURIComponent(rawValue); } catch {}
    if (key) output[key] = value;
  }
  return output;
}

const CATALOGS = {};
const EXPLORE_CATALOG_IDS = [];

class MemoryCache {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear() {
    this.map.clear();
  }
}

const catalogCache = new MemoryCache();
const detailsCache = new MemoryCache();
const providerCache = new MemoryCache();
const tvmazeCache = new MemoryCache();
const anilistCache = new MemoryCache();
const mappingCache = new MemoryCache();

function json(res, status, body, cache = 'private, max-age=60') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

function html(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(body);
}

function svg(res, body, cache = 'public, max-age=86400, s-maxage=86400') {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(body);
}

function serveGenrePosterPng(res, params = {}) {
  const typeToken = String(params.type || 'movie') === 'series' ? 'series' : 'movie';
  const genreSlug = String(params.genre || '').trim().toLowerCase();
  const fileName = genrePosterFile(typeToken, genreSlug);
  if (!fileName) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  try {
    const data = fs.readFileSync(path.join(GENRE_POSTER_DIR_SAFE, fileName));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.end(data);
  } catch (_) {
    res.statusCode = 404;
    res.end('Not found');
  }
}

function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const prefix = String(req.headers['x-nuvio-base-path'] || '').replace(/\/$/, '');
  return `${proto}://${host}${prefix}`;
}


const ALLOWED_POSTER_HOSTS = new Set([
  'image.tmdb.org',
  'static.tvmaze.com',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
  's4.anilist.co',
  'img.anili.st'
]);

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function compactCardText(value, max = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cardLines(value, maxPerLine = 24, maxLines = 2) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxPerLine || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (consumed < words.length && lines.length) {
    lines[lines.length - 1] = compactCardText(lines[lines.length - 1], maxPerLine);
  }
  return lines.slice(0, maxLines);
}


// TV typography is intentionally tiered instead of using one font size for
// every title. Short titles should feel cinematic and large; long titles must
// shrink gracefully without stealing the append/date/platform area.
function calendarTitleProfile(value, layout = 'landscape') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const compactLength = text.replace(/\s/g, '').length;
  const landscape = normalizedCardLayout(layout) === 'landscape';

  // Shield-first typography. The labels are intentionally oversized because
  // they are rendered under the artwork box and must remain readable from a
  // sofa. Short titles get the biggest treatment, while long titles shrink
  // progressively and may use up to three balanced lines.
  if (compactLength <= 16) {
    return landscape
      ? { tier: 'short', fontSize: 142, lineHeight: 146, maxPerLine: 20, maxLines: 1 }
      : { tier: 'short', fontSize: 108, lineHeight: 114, maxPerLine: 18, maxLines: 1 };
  }
  if (compactLength <= 34) {
    return landscape
      ? { tier: 'medium', fontSize: 104, lineHeight: 110, maxPerLine: 24, maxLines: 2 }
      : { tier: 'medium', fontSize: 84, lineHeight: 90, maxPerLine: 21, maxLines: 2 };
  }
  return landscape
    ? { tier: 'long', fontSize: 82, lineHeight: 88, maxPerLine: 29, maxLines: 3 }
    : { tier: 'long', fontSize: 66, lineHeight: 72, maxPerLine: 24, maxLines: 3 };
}

function isAllowedPosterSource(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ALLOWED_POSTER_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizedCardLayout(value) {
  return String(value || '').toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
}

function optimizedCardSource(value, layout = 'portrait') {
  if (!isAllowedPosterSource(value)) return value;
  try {
    const url = new URL(String(value));
    if (url.hostname.toLowerCase() === 'image.tmdb.org') {
      const targetSize = normalizedCardLayout(layout) === 'landscape' ? 'w780' : 'w500';
      url.pathname = url.pathname.replace(/\/t\/p\/(?:original|w\d+)\//, `/t/p/${targetSize}/`);
      return url.toString();
    }
  } catch {
    // Keep the original URL when it cannot be normalized.
  }
  return value;
}

function normalizedCardToken(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function calendarSourceLabel(source) {
  if (source === 'tvmaze-broadcast') return 'TV France';
  if (source === 'anilist-airing') return 'AIRING ANIME';
  if (source === 'tmdb-streaming') return 'STREAMING US';
  return 'CALENDRIER FRANCE';
}

function calendarCardEventInfo(meta, dateLabel = '') {
  const releaseInfo = String(meta?.releaseInfo || '');
  const dateTokens = new Set([
    normalizedCardToken(dateLabel),
    normalizedCardToken(meta?.released),
    'aujourd hui',
    "aujourd'hui",
    'aujourdhui',
    'demain'
  ].filter(Boolean));
  const parts = releaseInfo
    .split('•')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !dateTokens.has(normalizedCardToken(part)));
  const compact = parts.join(' • ');
  if (compact) return compact;
  return meta?.type === 'movie' ? 'SORTIE US' : 'NOUVEL ÉPISODE';
}

const FR_CARD_WEEKDAYS = Object.freeze(['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']);
const FR_CARD_MONTHS = Object.freeze(['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC']);

function frenchCardDate(value) {
  const iso = normalizeIsoDate(value);
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${FR_CARD_WEEKDAYS[date.getUTCDay()]} ${String(date.getUTCDate()).padStart(2, '0')} ${FR_CARD_MONTHS[date.getUTCMonth()]}`;
}

function compactEpisodeToken(meta) {
  const token = releaseEpisodeToken(meta);
  if (!token) return null;
  const seasonEpisode = token.match(/S(\d{1,2})E(\d{1,3})/i);
  if (seasonEpisode) return `S${String(Number(seasonEpisode[1])).padStart(2, '0')}E${String(Number(seasonEpisode[2])).padStart(2, '0')}`;
  const episode = token.match(/(?:Épisode|Episode|EP)\s*(\d+)/i);
  if (episode) return `EP${String(Number(episode[1])).padStart(2, '0')}`;
  return token.toUpperCase();
}

function exactClockToken(meta) {
  const match = String(meta?.releaseInfo || '').match(/(?:^|\s|•)([01]\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function calendarAppend(meta, catalog) {
  const period = catalog?.period || 'today';
  const dateToken = period === 'today'
    ? 'AUJOURD’HUI'
    : period === 'tomorrow'
      ? 'DEMAIN'
      : (frenchCardDate(meta?.released) || PERIOD_LABELS.get(period)?.toUpperCase() || 'CALENDRIER');
  const provider = compactCardText(meta?._calendarProvider || catalog?.cardProvider || 'CALENDRIER FRANCE', 34).toUpperCase();
  const parts = [];
  if (meta?.type === 'series') {
    const episode = compactEpisodeToken(meta);
    if (episode) parts.push(episode);
  }
  if (dateToken) parts.push(dateToken);
  const clock = exactClockToken(meta);
  if (clock) parts.push(clock);
  if (provider) parts.push(provider);
  return compactCardText(parts.join(' • '), 82);
}

function isHomeCalendarPeriod(period) {
  if (/^archive-\d{4}-\d{2}$/.test(String(period || ''))) return true;
  // Archive rows must use exactly the same Shield / Android TV Modern landscape
  // decoration as the live Calendar project, even though showInHome=false in this addon.
  return ['lastmonth', 'month', 'lastweek', 'past7', 'today', 'tomorrow', 'yesterday', 'nextweek', 'next7', 'nowplaying', 'upcomingyear', 'week'].includes(period);
}

function calendarCardUrl(origin, meta, catalog, timeZone, layout = 'portrait', sourceOverride = null) {
  const cardLayout = normalizedCardLayout(layout);
  const source = optimizedCardSource(sourceOverride || meta?.poster, cardLayout);
  if (!getConfig().calendarCards || !source || !isAllowedPosterSource(source)) return sourceOverride || meta?.poster || null;
  const append = calendarAppend(meta, catalog);
  const base = `${String(origin || '').replace(/\/$/, '')}/`;
  const url = new URL('calendar-card.svg', base);
  url.searchParams.set('v', `${VERSION}-${VISUAL_REV}`);
  url.searchParams.set('src', source);
  url.searchParams.set('layout', cardLayout);
  url.searchParams.set('title', compactCardText(meta.name, 62));
  url.searchParams.set('provider', compactCardText(meta?._calendarProvider || catalog?.cardProvider || catalog?.name || 'FRANCE', 36));
  url.searchParams.set('append', append);
  url.searchParams.set('tz', timeZone || DEFAULT_TIMEZONE);
  url.searchParams.set('type', meta.type || catalog?.type || '');
  if (meta.released) url.searchParams.set('date', meta.released);
  if (meta?._calendarSource) url.searchParams.set('source', meta._calendarSource);
  return url.toString();
}

function desktopContentCardUrl(origin, meta, catalog, sourceOverride = null) {
  const source = optimizedCardSource(
    sourceOverride || meta?.landscapePoster || meta?.background || meta?.poster,
    'landscape'
  );
  if (!source || !isAllowedPosterSource(source)) return sourceOverride || meta?.landscapePoster || meta?.background || meta?.poster || null;
  const base = `${String(origin || '').replace(/\/$/, '')}/`;
  const url = new URL('desktop-content-card.jpg', base);
  url.searchParams.set('v', `${VERSION}-${VISUAL_REV}-desktop5`);
  url.searchParams.set('src', source);
  const providerSlug = String(catalog?.providerSlug || catalog?.archiveProvider || '').trim().toLowerCase();
  if (providerSlug) url.searchParams.set('provider', providerSlug);
  url.searchParams.set('type', meta?.type || catalog?.type || 'series');
  url.searchParams.set('title', compactCardText(meta?.name || '', 62));
  url.searchParams.set('append', calendarAppend(meta, catalog));
  url.searchParams.set('label', compactCardText(meta?._calendarProvider || catalog?.cardProvider || platformCollectionTitle(providerSlug), 28));
  if (catalog?.genreColor) url.searchParams.set('color', catalog.genreColor);
  return url.toString();
}

function transparentModernLogoUrl(origin) {
  const base = `${String(origin || '').replace(/\/$/, '')}/`;
  const url = new URL('calendar-transparent-logo.svg', base);
  url.searchParams.set('v', `${VERSION}-${VISUAL_REV}`);
  return url.toString();
}

function decorateCatalogMetas(origin, metas, catalog, timeZone) {
  return (metas || []).map((meta) => {
    const originalPoster = meta?.poster || null;
    const originalBackground = meta?.background || null;
    const originalLandscape = meta?.landscapePoster || originalBackground || originalPoster;
    const append = calendarAppend(meta, catalog);
    const homeVisible = isHomeCalendarPeriod(catalog?.period);

    // Nuvio Modern Home is special: with "landscape posters" enabled it does
    // NOT prefer landscapePoster. buildCatalogItem() resolves item.backdropUrl,
    // and MetaPreview.backdropUrl prioritizes background before landscapePoster.
    // Therefore every Home-capable calendar period intentionally publishes the Calendar 16:9 card
    // as `background`. ModernCarouselCard then freezes that first backdrop for
    // the row card, while /meta/... still returns the real TMDb artwork on detail.
    // Explore ignores background for its grid and keeps using `poster`, so it gets
    // its own portrait Calendar card from the same catalog payload.
    const portraitPoster = getConfig().calendarCards && originalPoster
      ? (calendarCardUrl(origin, meta, catalog, timeZone, 'portrait', originalPoster) || originalPoster)
      : originalPoster;
    const wideSource = originalLandscape || originalPoster;
    const widePoster = getConfig().calendarCards && wideSource
      ? (calendarCardUrl(origin, meta, catalog, timeZone, 'landscape', wideSource) || wideSource)
      : (meta?.landscapePoster || wideSource);
    const desktopPoster = homeVisible
      ? desktopContentCardUrl(origin, meta, catalog, wideSource)
      : null;

    const copy = {
      ...meta,
      poster: portraitPoster || originalPoster,
      posterShape: homeVisible ? 'landscape' : (meta?.posterShape || 'poster'),
      landscapePoster: widePoster,
      // NuvioDesktop landscape cards prefer `banner`. Mirror the exact same
      // approved 16:9 cinematic card there; the Shield renderer stays unchanged.
      banner: homeVisible ? (desktopPoster || originalLandscape || originalBackground || originalPoster || widePoster) : (meta?.banner || null),
      // Critical Modern View targeting: when landscape-card style is active,
      // Nuvio reads/freeze-selects the backdrop. Feed it the Calendar card here.
      background: homeVisible ? (widePoster || originalBackground || portraitPoster) : originalBackground,
      // Modern Home draws a logo/title overlay on landscape cards. A valid but
      // transparent logo freezes that overlay slot so our card artwork remains
      // the single source of truth. Detail metadata later restores the real logo.
      logo: homeVisible && getConfig().calendarCards
        ? transparentModernLogoUrl(origin)
        : meta?.logo,
      // Classic Home can still render this as a native second line when labels
      // are enabled; Modern Home intentionally disables native labels.
      releaseInfo: append
    };
    for (const key of Object.keys(copy)) {
      if (key.startsWith('_')) delete copy[key];
    }
    return copy;
  });
}

function providerAccentColor(provider = '') {
  const value = normalizedCardToken(provider);
  if (value.includes('netflix')) return '#e50914';
  if (value.includes('prime')) return '#22a6f2';
  if (value.includes('disney')) return '#32d4ff';
  if (value === 'max' || value.includes('hbo max')) return '#7c3aed';
  if (value.includes('apple')) return '#94a3b8';
  if (value.includes('hulu')) return '#1ce783';
  if (value.includes('paramount')) return '#2d7ff9';
  if (value.includes('canal')) return '#f4f4f5';
  if (value.includes('france tv')) return '#2f80ed';
  if (value.includes('tf1')) return '#3b82f6';
  if (value.includes('m6')) return '#f97316';
  if (value.includes('arte')) return '#fa481c';
  if (value.includes('adn') || value.includes('animation digital network')) return '#ef4444';
  if (value.includes('hbo max') || value === 'max') return '#7c3aed';
  if (value.includes('peacock')) return '#facc15';
  if (value.includes('crunchyroll')) return '#f97316';
  if (value.includes('tv france')) return '#38bdf8';
  if (value.includes('anime')) return '#a855f7';
  return '#38bdf8';
}

function calendarCardSvg({ imageDataUri = null, title = '', provider = '', append = '', type = '', layout = 'portrait' }) {
  const cardLayout = normalizedCardLayout(layout);
  const landscape = cardLayout === 'landscape';
  const providerRaw = compactCardText(provider || 'FRANCE', landscape ? 28 : 24).toUpperCase();
  const providerText = escapeXml(providerRaw);
  const appendParts = String(append || (type === 'movie' ? 'SORTIE US' : 'NOUVEL ÉPISODE'))
    .split('•').map((part) => part.trim()).filter(Boolean);
  const appendProviderRaw = appendParts.length > 1 ? appendParts.pop() : providerRaw;
  const appendMainRaw = appendParts.join(' • ') || (type === 'movie' ? 'SORTIE US' : 'NOUVEL ÉPISODE');
  const typeText = type === 'movie' ? 'FILM' : type === 'series' ? 'SÉRIE' : '';
  const accent = providerAccentColor(providerRaw);

  if (landscape) {
    const width = 1600;
    const height = 900;
    const providerW = Math.min(540, Math.max(300, 170 + providerRaw.length * 22));
    const typeW = typeText ? 224 : 0;
    const badgeGap = 22;
    const rightPad = 44;
    const typeX = width - rightPad - typeW;
    const providerX = typeText ? typeX - badgeGap - providerW : width - rightPad - providerW;

    const profile = calendarTitleProfile(title, 'landscape');
    const tvProfile = profile.tier === 'short'
      ? { fontSize: 120, lineHeight: 122, maxPerLine: 21, maxLines: 1 }
      : profile.tier === 'medium'
        ? { fontSize: 94, lineHeight: 98, maxPerLine: 28, maxLines: 2 }
        : { fontSize: 76, lineHeight: 80, maxPerLine: 34, maxLines: 2 };
    const lines = cardLines(title, tvProfile.maxPerLine, tvProfile.maxLines);
    const overlayY = 490;
    const titleY = 616;
    const titleSpans = lines.map((line, index) =>
      `<tspan x="68" dy="${index === 0 ? 0 : tvProfile.lineHeight}">${escapeXml(line)}</tspan>`
    ).join('');
    const appendY = titleY + Math.max(0, lines.length - 1) * tvProfile.lineHeight + 92;
    const platformY = Math.min(850, appendY + 80);
    const appendMainText = escapeXml(compactCardText(appendMainRaw, 72));
    const appendProviderText = escapeXml(compactCardText(appendProviderRaw, 36).toUpperCase());

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <clipPath id="cardClip"><rect x="0" y="0" width="1600" height="900" rx="38"/></clipPath>
    <linearGradient id="blueOverlay" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#03152f" stop-opacity=".82"/>
      <stop offset=".55" stop-color="#062b5c" stop-opacity=".76"/>
      <stop offset="1" stop-color="#0369a1" stop-opacity=".62"/>
    </linearGradient>
    <linearGradient id="topReadability" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#020617" stop-opacity=".22"/>
      <stop offset=".56" stop-color="#020617" stop-opacity=".04"/>
      <stop offset="1" stop-color="#020617" stop-opacity=".16"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#cardClip)">
    ${imageDataUri ? `<image x="0" y="0" width="1600" height="900" href="${escapeXml(imageDataUri)}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="1600" height="900" fill="#07111f"/>`}
    <rect width="1600" height="900" fill="url(#topReadability)"/>
    <rect x="0" y="${overlayY}" width="1600" height="${height-overlayY}" fill="url(#blueOverlay)"/>
    <rect x="0" y="${overlayY}" width="1600" height="5" fill="#38bdf8" fill-opacity=".78"/>
  </g>

  <rect x="${providerX}" y="38" width="${providerW}" height="116" rx="32" fill="#020617" fill-opacity=".86" stroke="${accent}" stroke-width="7"/>
  <text x="${providerX + providerW/2}" y="116" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="58" font-weight="900">${providerText}</text>
  ${typeText ? `<rect x="${typeX}" y="38" width="${typeW}" height="116" rx="32" fill="${accent}" fill-opacity=".96"/><text x="${typeX + typeW/2}" y="116" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="56" font-weight="900">${typeText}</text>` : ''}

  <text x="68" y="${titleY}" fill="#fff" font-family="sans-serif" font-size="${tvProfile.fontSize}" font-weight="900" letter-spacing="-1.2">${titleSpans}</text>
  <text x="68" y="${appendY}" fill="#f8fafc" font-family="sans-serif" font-size="66" font-weight="850">${appendMainText}</text>
  <text x="68" y="${platformY}" fill="${accent}" font-family="sans-serif" font-size="64" font-weight="900">${appendProviderText}</text>
  <rect x="0" y="0" width="1600" height="900" rx="38" fill="none" stroke="#fff" stroke-opacity=".20" stroke-width="5"/>
</svg>`;
  }

  const width = 1000;
  const height = 1500;
  const providerW = Math.min(510, Math.max(275, 150 + providerRaw.length * 20));
  const typeW = typeText ? 196 : 0;
  const badgeGap = 16;
  const rightPad = 34;
  const typeX = width - rightPad - typeW;
  const providerX = typeText ? typeX - badgeGap - providerW : width - rightPad - providerW;
  const profile = calendarTitleProfile(title, 'portrait');
  const portraitProfile = profile.tier === 'short'
    ? { fontSize: 104, lineHeight: 108, maxPerLine: 15, maxLines: 1 }
    : profile.tier === 'medium'
      ? { fontSize: 82, lineHeight: 86, maxPerLine: 18, maxLines: 2 }
      : { fontSize: 66, lineHeight: 70, maxPerLine: 20, maxLines: 2 };
  const lines = cardLines(title, portraitProfile.maxPerLine, portraitProfile.maxLines);
  const overlayY = 930;
  const titleY = 1080;
  const titleSpans = lines.map((line, index) =>
    `<tspan x="56" dy="${index === 0 ? 0 : portraitProfile.lineHeight}">${escapeXml(line)}</tspan>`
  ).join('');
  const appendY = titleY + Math.max(0, lines.length - 1) * portraitProfile.lineHeight + 96;
  const platformY = Math.min(1450, appendY + 86);
  const appendMainText = escapeXml(compactCardText(appendMainRaw, 58));
  const appendProviderText = escapeXml(compactCardText(appendProviderRaw, 30).toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500">
  <defs>
    <clipPath id="cardClip"><rect x="0" y="0" width="1000" height="1500" rx="42"/></clipPath>
    <linearGradient id="blueOverlay" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#03152f" stop-opacity=".84"/>
      <stop offset=".58" stop-color="#062b5c" stop-opacity=".78"/>
      <stop offset="1" stop-color="#0369a1" stop-opacity=".64"/>
    </linearGradient>
    <linearGradient id="topReadability" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020617" stop-opacity=".24"/><stop offset=".72" stop-color="#020617" stop-opacity=".03"/><stop offset="1" stop-color="#020617" stop-opacity=".18"/></linearGradient>
  </defs>
  <g clip-path="url(#cardClip)">
    ${imageDataUri ? `<image x="0" y="0" width="1000" height="1500" href="${escapeXml(imageDataUri)}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="1000" height="1500" fill="#07111f"/>`}
    <rect width="1000" height="1500" fill="url(#topReadability)"/>
    <rect x="0" y="${overlayY}" width="1000" height="${height-overlayY}" fill="url(#blueOverlay)"/>
    <rect x="0" y="${overlayY}" width="1000" height="6" fill="#38bdf8" fill-opacity=".78"/>
  </g>

  <rect x="${providerX}" y="42" width="${providerW}" height="108" rx="30" fill="#020617" fill-opacity=".86" stroke="${accent}" stroke-width="7"/>
  <text x="${providerX + providerW/2}" y="115" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="52" font-weight="900">${providerText}</text>
  ${typeText ? `<rect x="${typeX}" y="42" width="${typeW}" height="108" rx="30" fill="${accent}" fill-opacity=".96"/><text x="${typeX + typeW/2}" y="115" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="48" font-weight="900">${typeText}</text>` : ''}

  <text x="56" y="${titleY}" fill="#fff" font-family="sans-serif" font-size="${portraitProfile.fontSize}" font-weight="900" letter-spacing="-.8">${titleSpans}</text>
  <text x="56" y="${appendY}" fill="#f8fafc" font-family="sans-serif" font-size="52" font-weight="850">${appendMainText}</text>
  <text x="56" y="${platformY}" fill="${accent}" font-family="sans-serif" font-size="54" font-weight="900">${appendProviderText}</text>
  <rect x="0" y="0" width="1000" height="1500" rx="42" fill="none" stroke="#fff" stroke-opacity=".20" stroke-width="5"/>
</svg>`;
}

async function handleCalendarCard(res, url) {
  const src = optimizedCardSource(url.searchParams.get('src') || '', url.searchParams.get('layout'));
  const title = url.searchParams.get('title') || '';
  const provider = url.searchParams.get('provider') || '';
  const append = url.searchParams.get('append') || url.searchParams.get('info') || '';
  const type = url.searchParams.get('type') || '';
  const layout = normalizedCardLayout(url.searchParams.get('layout'));
  if (!isAllowedPosterSource(src)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    return res.end(calendarCardSvg({ title, provider, append, type, layout }));
  }

  let imageDataUri = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(src, {
      signal: controller.signal,
      headers: { Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8', 'User-Agent': `NuvioCalendar/${VERSION}` }
    });
    if (response.ok) {
      const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/^image\/(jpeg|jpg|png|webp)$/.test(contentType)) {
        const declaredLength = Number(response.headers?.get?.('content-length') || 0);
        if (!declaredLength || declaredLength <= 3.5 * 1024 * 1024) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length <= 3.5 * 1024 * 1024) imageDataUri = `data:${contentType};base64,${bytes.toString('base64')}`;
        }
      }
    }
  } catch {
    imageDataUri = null;
  } finally {
    clearTimeout(timeout);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  return res.end(calendarCardSvg({ imageDataUri, title, provider, append, type, layout }));
}

function requestTimeZone(req) {
  return DEFAULT_TIMEZONE;
}

function runtimeNow() {
  const override = process.env.NUVIO_NOW_OVERRIDE;
  if (override) {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function getConfig() {
  return {
    language: process.env.TMDB_LANGUAGE || DEFAULT_LANGUAGE,
    maxCandidates: Math.max(10, Math.min(200, Number(process.env.MAX_CANDIDATES || DEFAULT_MAX_CANDIDATES))),
    maxItems: Math.max(60, Math.min(400, Number(process.env.MAX_ITEMS || DEFAULT_MAX_ITEMS))),
    pageSize: Math.max(20, Math.min(100, Number(process.env.PAGE_SIZE || DEFAULT_PAGE_SIZE))),
    token: process.env.TMDB_READ_TOKEN || null,
    apiKey: process.env.TMDB_API_KEY || null,
    debug: /^(1|true|yes|on)$/i.test(process.env.DEBUG || ''),
    tmdbTimeoutMs: Math.max(1000, Math.min(20000, Number(process.env.TMDB_TIMEOUT_MS || 8000))),
    sourceTimeoutMs: Math.max(1000, Math.min(20000, Number(process.env.SOURCE_TIMEOUT_MS || 8000))),
    retryBaseMs: Math.max(1, Math.min(5000, Number(process.env.RETRY_BASE_MS || process.env.TMDB_RETRY_BASE_MS || 250))),
    calendarCards: !/^(0|false|no|off)$/i.test(process.env.CALENDAR_CARDS || 'true')
  };
}

function requireTmdbConfig() {
  const config = getConfig();
  if (!config.token && !config.apiKey) {
    const err = new Error('TMDB_READ_TOKEN or TMDB_API_KEY is required');
    err.code = 'TMDB_CONFIG_MISSING';
    throw err;
  }
  return config;
}

function buildManifest(origin, now = runtimeNow(), timeZone = DEFAULT_TIMEZONE) {
  const catalogs = [...buildArchiveCatalogEntries(now, timeZone), ...buildGenreCatalogEntries(now, timeZone)].map(({ id, catalog }) => {
    const filters = filterOptionsForCatalog(catalog).map((entry) => entry.label);
    return {
      type: catalog.type,
      id,
      name: catalog.name,
      pageSize: getConfig().pageSize,
      showInHome: false,
      extra: [
        ...(filters.length ? [{ name: 'genre', isRequired: false, options: filters }] : []),
        { name: 'skip', isRequired: false }
      ],
      extraSupported: [...(filters.length ? ['genre'] : []), 'skip']
    };
  });

  return {
    id: 'com.nuvio.calendar.archives.fr.coexist',
    version: VERSION,
    name: 'Nuvio Calendar Archives France',
    description: 'Archives France pour Nuvio Shield Modern : plateformes FR + Genres TMDb + VOD France + Crunchyroll/AniList, covers HD 16:9.',
    logo: `${origin}/logo.svg`,
    background: `${origin}/background.svg`,
    resources: [
      { name: 'catalog', types: ['movie', 'series'] },
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:'] }
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:movie:', 'tmdb:tv:'],
    catalogs,
    behaviorHints: { configurable: false, configurationRequired: false, newEpisodeNotifications: false },
    language: 'fr'
  };
}

class SourceHttpError extends Error {
  constructor(source, status, path, statusMessage = null) {
    super(`${source} ${status} on ${path}${statusMessage ? `: ${statusMessage}` : ''}`);
    this.name = 'SourceHttpError';
    this.code = `${source.toUpperCase()}_HTTP_ERROR`;
    this.source = source;
    this.status = status;
    this.path = path;
    this.statusMessage = statusMessage;
  }
}

class TmdbHttpError extends SourceHttpError {
  constructor(status, path, statusMessage = null) {
    super('tmdb', status, path, statusMessage);
    this.name = 'TmdbHttpError';
    this.code = 'TMDB_HTTP_ERROR';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 429 || [500, 502, 503, 504].includes(status);
}

async function tmdbFetch(path, params = {}) {
  const config = requireTmdbConfig();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(`${TMDB_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    if (!config.token && config.apiKey) url.searchParams.set('api_key', config.apiKey);

    const headers = { Accept: 'application/json', 'User-Agent': `NuvioCalendar/${VERSION}` };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.tmdbTimeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) return await response.json();

      let statusMessage = null;
      try {
        const payload = await response.json();
        statusMessage = payload?.status_message || payload?.message || null;
      } catch {}

      if (attempt < maxAttempts && retryableStatus(response.status)) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(3000, retryAfter * 1000)
          : config.retryBaseMs * (2 ** (attempt - 1));
        await sleep(waitMs);
        continue;
      }
      throw new TmdbHttpError(response.status, path, statusMessage);
    } catch (error) {
      if (error?.name === 'AbortError' && attempt < maxAttempts) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`TMDb timeout on ${path}`);
        timeoutError.code = 'TMDB_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`TMDb request failed on ${path}`);
}

async function sourceFetchJson(source, url, options = {}, maxAttempts = 2) {
  const config = getConfig();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.sourceTimeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok) return await response.json();
      let message = null;
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || payload?.errors?.[0]?.message || null;
      } catch {}
      if (attempt < maxAttempts && retryableStatus(response.status)) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      throw new SourceHttpError(source, response.status, new URL(url).pathname, message);
    } catch (error) {
      if (error?.name === 'AbortError' && attempt < maxAttempts) {
        await sleep(config.retryBaseMs * (2 ** (attempt - 1)));
        continue;
      }
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`${source} timeout`);
        timeoutError.code = `${source.toUpperCase()}_TIMEOUT`;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${source} request failed`);
}

function normalizeProviderName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function providerDirectory(type) {
  const namespace = type === 'movie' ? 'movie' : 'tv';
  const cacheKey = `providers:${namespace}:${DEFAULT_COUNTRY}:${getConfig().language}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;
  const payload = await tmdbFetch(`/watch/providers/${namespace}`, {
    language: getConfig().language,
    watch_region: DEFAULT_COUNTRY
  });
  const list = (payload?.results || []).map((entry) => ({
    id: Number(entry?.provider_id),
    name: entry?.provider_name || '',
    normalized: normalizeProviderName(entry?.provider_name),
    logoPath: entry?.logo_path || null
  })).filter((entry) => Number.isFinite(entry.id) && entry.name);
  return providerCache.set(cacheKey, list, PROVIDERS_TTL_MS);
}

function resolveProviderFromDirectory(definition, directory) {
  const aliasSet = new Set((definition.aliases || []).map(normalizeProviderName));
  const prefixes = (definition.matchPrefixes || []).map(normalizeProviderName).filter(Boolean);
  const matches = directory.filter((entry) => {
    if (aliasSet.has(entry.normalized)) return true;
    return prefixes.some((prefix) => entry.normalized === prefix || entry.normalized.startsWith(`${prefix} `));
  });
  // Prefer the canonical provider before Amazon/Apple/Premium variants so the
  // artwork stays consistent, but retain all matching IDs for availability.
  matches.sort((a, b) => {
    const canonical = normalizeProviderName(definition.aliases?.[0] || definition.label);
    const ar = a.normalized === canonical ? 0 : 1;
    const br = b.normalized === canonical ? 0 : 1;
    return ar - br || a.id - b.id;
  });
  const ids = [...new Set(matches.map((entry) => entry.id))];
  if (!ids.length && Array.isArray(definition.fallbackIds)) ids.push(...definition.fallbackIds);
  return {
    ...definition,
    ids: [...new Set(ids)],
    matchedNames: [...new Set(matches.map((entry) => entry.name))],
    logoPaths: [...new Set(matches.map((entry) => entry.logoPath).filter(Boolean))]
  };
}

async function resolveProvider(providerSlug, type) {
  const definition = PROVIDER_BY_SLUG.get(providerSlug);
  if (!definition) return null;
  const directory = await providerDirectory(type);
  return resolveProviderFromDirectory(definition, directory);
}


const platformLogoAssetCache = new Map();

function platformProviderDefinition(providerSlug) {
  if (providerSlug === ARCHIVE_VOD_PROVIDER.slug) return ARCHIVE_VOD_PROVIDER;
  return ARCHIVE_PROVIDER_BY_SLUG.get(providerSlug) || null;
}

function providerMonetizationTypes(providerSlug) {
  const provider = platformProviderDefinition(providerSlug);
  const types = Array.isArray(provider?.monetizationTypes) && provider.monetizationTypes.length
    ? provider.monetizationTypes
    : ['flatrate'];
  return [...new Set(types)];
}

function hasProviderAccess(details, provider) {
  if (!provider?.ids?.length) return false;
  const watch = details?.['watch/providers']?.results?.[DEFAULT_COUNTRY] || {};
  const allowed = new Set(providerMonetizationTypes(provider.slug));
  const activeIds = new Set();
  for (const mode of allowed) {
    for (const entry of watch?.[mode] || []) {
      const id = Number(entry?.provider_id);
      if (Number.isFinite(id)) activeIds.add(id);
    }
  }
  return provider.ids.some((id) => activeIds.has(Number(id)));
}

function platformCollectionTitle(providerSlug) {
  if (providerSlug === 'crunchyroll') return 'Crunchyroll + AniList';
  return platformProviderDefinition(providerSlug)?.label || 'Streaming';
}

function regionCollectionTitle(providerSlug) {
  return '🇫🇷 ' + platformCollectionTitle(providerSlug);
}

function platformWordmarkSvg(providerSlug, logoDataUri = null, type = 'movie') {
  const label = escapeXml(platformCollectionTitle(providerSlug));
  const accent = providerAccentColor(platformCollectionTitle(providerSlug));
  const long = label.length > 16;
  const fontSize = long ? 104 : label.length > 11 ? 126 : 150;
  const icon = logoDataUri
    ? `<image href="${logoDataUri}" x="34" y="38" width="224" height="224" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="48" y="52" width="196" height="196" rx="48" fill="${accent}" fill-opacity=".20"/><text x="146" y="183" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="72" font-weight="900">${escapeXml(platformProviderDefinition(providerSlug)?.label?.[0] || 'S')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="300" viewBox="0 0 1400 300"><rect width="1400" height="300" fill="none"/>${icon}<text x="292" y="184" fill="#fff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="-5">${label}</text><rect x="296" y="226" width="620" height="12" rx="6" fill="${accent}" opacity=".92"/></svg>`;
}

async function platformLogoAsset(providerSlug, type = 'movie') {
  if (providerSlug === ARCHIVE_VOD_PROVIDER.slug) return null;
  const cacheKey = `${providerSlug}:${type === 'series' ? 'series' : 'movie'}`;
  if (platformLogoAssetCache.has(cacheKey)) return platformLogoAssetCache.get(cacheKey);
  try {
    const resolved = await resolveProvider(providerSlug, type === 'movie' ? 'movie' : 'series');
    const logoPath = resolved?.logoPaths?.[0];
    if (!logoPath) {
      platformLogoAssetCache.set(cacheKey, null);
      return null;
    }
    const response = await fetch(`https://image.tmdb.org/t/p/original${logoPath}`);
    if (!response.ok) {
      platformLogoAssetCache.set(cacheKey, null);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    const asset = {
      buffer,
      contentType,
      dataUri: `data:${contentType};base64,${buffer.toString('base64')}`,
      logoPath
    };
    platformLogoAssetCache.set(cacheKey, asset);
    return asset;
  } catch {
    platformLogoAssetCache.set(cacheKey, null);
    return null;
  }
}

function platformCategoryIcon(category = 'series') {
  if (category === 'films') {
    return `<g><rect x="0" y="0" width="330" height="240" rx="34" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".22" stroke-width="5"/><path d="M62 52h206v136H62z" fill="none" stroke="#fff" stroke-width="18"/><path d="M62 94h206M105 52v136M225 52v136" stroke="#fff" stroke-width="10" opacity=".75"/><path d="M144 74l72 46-72 46z" fill="#fff"/></g>`;
  }
  return `<g><rect x="0" y="0" width="330" height="240" rx="34" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".22" stroke-width="5"/><rect x="54" y="45" width="222" height="142" rx="20" fill="none" stroke="#fff" stroke-width="18"/><path d="M138 82l70 34-70 34z" fill="#fff"/><path d="M115 214h100" stroke="#fff" stroke-width="18" stroke-linecap="round"/></g>`;
}

function platformFallbackLogoSvg(providerSlug) {
  const label = escapeXml(platformCollectionTitle(providerSlug));
  const accent = providerAccentColor(platformCollectionTitle(providerSlug));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360"><rect width="1200" height="360" fill="none"/><text x="600" y="214" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="126" font-weight="900" letter-spacing="-4">${label}</text><rect x="300" y="274" width="600" height="12" rx="6" fill="${accent}" opacity=".92"/></svg>`;
}

function platformBrandBadge(providerSlug, logoDataUri, opts = {}) {
  const {
    x = 110,
    y = 96,
    width = 860,
    height = 170,
    compact = false
  } = opts;
  const label = escapeXml(platformCollectionTitle(providerSlug));
  const accent = providerAccentColor(platformCollectionTitle(providerSlug));
  const iconSize = compact ? 94 : 118;
  const iconX = x + 24;
  const iconY = y + (height - iconSize) / 2;
  const textX = iconX + iconSize + 28;
  const titleY = y + (compact ? 77 : 90);
  const subtitleY = y + (compact ? 118 : 128);
  const fontSize = compact
    ? (label.length > 18 ? 44 : label.length > 12 ? 50 : 54)
    : (label.length > 18 ? 58 : label.length > 12 ? 64 : 70);
  const subSize = compact ? 19 : 22;
  const icon = logoDataUri
    ? `<rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="24" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".18"/><image href="${logoDataUri}" x="${iconX + 12}" y="${iconY + 12}" width="${iconSize - 24}" height="${iconSize - 24}" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="24" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".18"/><text x="${iconX + iconSize / 2}" y="${iconY + iconSize * 0.64}" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="${compact ? 28 : 34}" font-weight="900">${escapeXml(platformProviderDefinition(providerSlug)?.label?.[0] || 'S')}</text>`;
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="#02060d" fill-opacity=".52" stroke="#ffffff" stroke-opacity=".12"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="url(#brandAccent)" fill-opacity=".18"/>${icon}<text x="${textX}" y="${titleY}" fill="#fff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="-2">${label}</text><text x="${textX}" y="${subtitleY}" fill="#c9d6e5" font-family="Arial,sans-serif" font-size="${subSize}" font-weight="700" letter-spacing="4">STREAMING PLATFORM</text></g>`;
}

function platformBackdropSvg(providerSlug, type = 'movie', logoDataUri = null, photoDataUri = null) {
  const label=escapeXml(platformCollectionTitle(providerSlug)); const accent=providerAccentColor(platformCollectionTitle(providerSlug)); const typeLabel=type==='series'?'SÉRIES':'FILMS';
  const photo=photoDataUri?`<image href="${escapeXml(photoDataUri)}" x="0" y="0" width="1920" height="1080" preserveAspectRatio="xMidYMid slice"/>`:`<rect width="1920" height="1080" fill="#060a12"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="r" x1="0" x2="1"><stop stop-color="#02040a" stop-opacity=".90"/><stop offset=".48" stop-color="#02040a" stop-opacity=".55"/><stop offset="1" stop-color="#02040a" stop-opacity=".05"/></linearGradient></defs>${photo}<rect width="1920" height="1080" fill="url(#r)"/><rect x="92" y="116" width="10" height="245" rx="5" fill="${accent}"/><text x="132" y="205" fill="#fff" font-family="Arial,sans-serif" font-size="64" font-weight="900" letter-spacing="7">${typeLabel}</text><text x="130" y="307" fill="#fff" font-family="Arial,sans-serif" font-size="132" font-weight="900" letter-spacing="-3">${label}</text><text x="132" y="388" fill="#d5e0ee" font-family="Arial,sans-serif" font-size="30" font-weight="800" letter-spacing="5">NUVIO · CALENDAR ARCHIVES</text></svg>`;
}

function platformCategoryCardSvg(providerSlug, category = 'series', logoDataUri = null, photoDataUri = null) {
  const label=escapeXml(platformCollectionTitle(providerSlug)); const accent=providerAccentColor(platformCollectionTitle(providerSlug)); const isFilms=category==='films'; const categoryLabel=isFilms?'FILMS':'SÉRIES';
  const detailLabel=providerSlug==='crunchyroll'?(isFilms?'ANIME MOVIES · STREAMING':'CRUNCHYROLL + ANILIST'):(isFilms?'SORTIES STREAMING':'NOUVELLES SÉRIES');
  const photo=photoDataUri?`<image href="${escapeXml(photoDataUri)}" x="0" y="0" width="1600" height="900" preserveAspectRatio="xMidYMid slice"/>`:`<rect width="1600" height="900" fill="#07111f"/>`;
  const icon=logoDataUri?`<rect x="74" y="65" width="270" height="150" rx="32" fill="#02050a" fill-opacity=".72" stroke="#fff" stroke-opacity=".14"/><image href="${escapeXml(logoDataUri)}" x="94" y="83" width="230" height="114" preserveAspectRatio="xMidYMid meet"/><text x="510" y="155" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="82" font-weight="900" letter-spacing="-2">${label}</text>`:`<text x="210" y="174" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="132" font-weight="900" letter-spacing="-3">${label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><clipPath id="c"><rect width="1600" height="900" rx="44"/></clipPath><linearGradient id="l" x1="0" x2="1"><stop stop-color="#02040a" stop-opacity=".94"/><stop offset=".5" stop-color="#02040a" stop-opacity=".62"/><stop offset="1" stop-color="#02040a" stop-opacity=".08"/></linearGradient></defs><g clip-path="url(#c)">${photo}<rect width="1600" height="900" fill="url(#l)"/></g>${icon}<rect x="74" y="592" width="10" height="208" rx="5" fill="${accent}"/><text x="112" y="704" fill="#fff" font-family="Arial,sans-serif" font-size="198" font-weight="900" letter-spacing="-4">${categoryLabel}</text><text x="118" y="770" fill="${accent}" font-family="Arial,sans-serif" font-size="44" font-weight="900" letter-spacing="4">${detailLabel}</text><text x="118" y="820" fill="#d7e2ef" font-family="Arial,sans-serif" font-size="30" font-weight="800" letter-spacing="3">PÉRIODES · MOIS · ARCHIVES</text><rect x="0" y="0" width="1600" height="900" rx="44" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="5"/></svg>`;
}

async function handlePlatformLogo(res, url) {
  const providerSlug = url.searchParams.get('provider') || '';
  const type = url.searchParams.get('type') === 'series' ? 'series' : 'movie';
  const provider = platformProviderDefinition(providerSlug);
  if (!provider) return svg(res, platformWordmarkSvg('', null, type), 'public, max-age=3600');
  const asset = await platformLogoAsset(providerSlug, type);
  return svg(res, platformWordmarkSvg(providerSlug, asset?.dataUri || null, type), 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
}

async function handlePlatformBackdrop(res, url) {
  const providerSlug = url.searchParams.get('provider') || '';
  const type = url.searchParams.get('type') === 'series' ? 'series' : 'movie';
  const provider = platformProviderDefinition(providerSlug);
  if (!provider) return svg(res, platformBackdropSvg('', type, null), 'public, max-age=3600');
  const asset = await platformLogoAsset(providerSlug, type);
  const photo = platformPhotoDataUri(providerSlug, 'backdrop');
  return svg(res, platformBackdropSvg(providerSlug, type, asset?.dataUri || null, photo), 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
}

async function handlePlatformCategoryCard(res, url) {
  const providerSlug = url.searchParams.get('provider') || '';
  const category = url.searchParams.get('category') === 'films' ? 'films' : 'series';
  const provider = platformProviderDefinition(providerSlug);
  if (!provider) return svg(res, platformCategoryCardSvg('', category, null), 'public, max-age=3600');
  const asset = await platformLogoAsset(providerSlug, category === 'films' ? 'movie' : 'series');
  const photo = platformPhotoDataUri(providerSlug, 'card');
  return svg(res, platformCategoryCardSvg(providerSlug, category, asset?.dataUri || null, photo), 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
}

function discoverParams(catalog, window, providerIds, page, timeZone = DEFAULT_TIMEZONE) {
  const common = {
    language: getConfig().language,
    page,
    include_adult: false,
    sort_by: 'popularity.desc',
    watch_region: DEFAULT_COUNTRY,
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: providerMonetizationTypes(catalog.providerSlug).join('|')
  };

  if (catalog.type === 'movie') {
    return {
      ...common,
      region: DEFAULT_COUNTRY,
      'release_date.gte': window.start,
      'release_date.lte': window.end,
      with_release_type: '4'
    };
  }

  // For streaming series, TMDb air_date is used only as a candidate date.
  // It remains a calendar date and is never converted as a timezone instant.
  return {
    ...common,
    'air_date.gte': window.start,
    'air_date.lte': window.end,
    include_null_first_air_dates: false
  };
}

function fallbackDiscoverParams(catalog, window, providerIds, page, timeZone) {
  const params = discoverParams(catalog, window, providerIds, page, timeZone);
  delete params.watch_region;
  delete params.with_watch_providers;
  delete params.with_watch_monetization_types;
  return params;
}

async function discoverCandidates(catalog, window, providerIds, timeZone) {
  const endpoint = catalog.type === 'movie' ? '/discover/movie' : '/discover/tv';
  const maxCandidates = getConfig().maxCandidates;
  const items = [];
  for (let page = 1; page <= 5 && items.length < maxCandidates; page += 1) {
    let payload;
    try {
      payload = await tmdbFetch(endpoint, discoverParams(catalog, window, providerIds, page, timeZone));
    } catch (error) {
      if (error?.code === 'TMDB_HTTP_ERROR' && [400, 422].includes(error.status)) {
        payload = await tmdbFetch(endpoint, fallbackDiscoverParams(catalog, window, providerIds, page, timeZone));
      } else {
        throw error;
      }
    }
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

function vodDiscoverParams(window, page) {
  // VOD = date de sortie numérique régionale, PAS disponibilité achat/location.
  // TMDb release type 4 = Digital. Le filtre region force FR ou US selon l'addon.
  return {
    language: getConfig().language,
    page,
    include_adult: false,
    include_video: false,
    sort_by: 'popularity.desc',
    region: DEFAULT_COUNTRY,
    'release_date.gte': window.start,
    'release_date.lte': window.end,
    with_release_type: '4'
  };
}

async function discoverVodCandidates(window) {
  const maxCandidates = getConfig().maxCandidates;
  const items = [];
  for (let page = 1; page <= 5 && items.length < maxCandidates; page += 1) {
    const payload = await tmdbFetch('/discover/movie', vodDiscoverParams(window, page));
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

function usTheatricalReleaseDates(details) {
  const country = (details?.release_dates?.results || []).find((entry) => entry?.iso_3166_1 === DEFAULT_COUNTRY);
  return (country?.release_dates || [])
    .filter((entry) => [2, 3].includes(Number(entry?.type)))
    .map((entry) => ({ ...entry, type: Number(entry.type), date: normalizeIsoDate(entry?.release_date) }))
    .filter((entry) => entry.date)
    .sort((a, b) => a.date.localeCompare(b.date) || b.type - a.type);
}

function selectUsTheatricalRelease(details, window, mode = 'upcoming') {
  const dates = usTheatricalReleaseDates(details);
  if (!dates.length) return null;
  const preferred = (list) => list.find((entry) => entry.type === 3) || list.find((entry) => entry.type === 2) || null;
  if (mode === 'nowplaying') {
    // The now_playing endpoint determines whether the film is currently in French theatres.
    // Here we only choose the best verified French theatrical date for display.
    const eligible = dates.filter((entry) => entry.date <= window.today);
    return preferred(eligible) || null;
  }
  return preferred(dates.filter((entry) => entry.date >= window.start && entry.date <= window.end));
}

async function discoverNowPlayingCandidates() {
  const maxCandidates = getConfig().maxCandidates;
  const items = [];
  for (let page = 1; page <= 5 && items.length < maxCandidates; page += 1) {
    const payload = await tmdbFetch('/movie/now_playing', {
      language: getConfig().language,
      region: DEFAULT_COUNTRY,
      page
    });
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

function upcomingTheatricalDiscoverParams(window, page) {
  return {
    language: getConfig().language,
    page,
    include_adult: false,
    include_video: false,
    region: DEFAULT_COUNTRY,
    sort_by: 'popularity.desc',
    with_release_type: '3|2',
    'release_date.gte': window.start,
    'release_date.lte': window.end
  };
}

async function discoverUpcomingTheatricalCandidates(window) {
  const maxCandidates = getConfig().maxCandidates;
  const items = [];
  for (let page = 1; page <= 5 && items.length < maxCandidates; page += 1) {
    const payload = await tmdbFetch('/discover/movie', upcomingTheatricalDiscoverParams(window, page));
    items.push(...(payload?.results || []));
    if (page >= Number(payload?.total_pages || 1)) break;
  }
  return items.slice(0, maxCandidates);
}

function theatricalMovieToMeta(details, window, mode) {
  const release = selectUsTheatricalRelease(details, window, mode);
  if (!release) return { meta: null, reason: 'date-unknown' };
  const provider = mode === 'nowplaying' ? 'CINÉMA US' : 'UPCOMING US';
  const prefix = mode === 'nowplaying' ? 'Actuellement au cinéma France' : 'Sortie cinéma France à venir';
  const meta = baseMeta(details, 'movie', release.date, `${prefix} • ${humanCalendarDate(release.date)}`);
  meta.description = [prefix, `Date cinéma France : ${humanCalendarDate(release.date)}`, meta.description].filter(Boolean).join('\n\n');
  meta._calendarProvider = provider;
  meta._calendarSource = mode === 'nowplaying' ? 'tmdb-theatrical-now' : 'tmdb-theatrical-upcoming';
  meta._dedupeKey = `theatrical:movie:${details.id}:${release.date}`;
  return { meta, reason: null };
}

async function buildTheatricalCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const mode = catalog.source === 'tmdb-theatrical-now' ? 'nowplaying' : 'upcoming';
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug, type: 'movie', period, timeZone, today: window.today,
    sourceVersion: `${SOURCE_VERSION}-${mode}`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats({ label: catalog.cardProvider || catalog.providerSlug, ids: [] }, catalog, window, timeZone);
  const raw = mode === 'nowplaying' ? await discoverNowPlayingCandidates() : await discoverUpcomingTheatricalCandidates(window);
  stats.candidates = raw.length;
  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails('movie', candidate.id);
    return theatricalMovieToMeta(details, window, mode);
  });
  const metas = [];
  for (const result of settled) {
    if (result?.error) { stats.enrichmentErrors += 1; continue; }
    if (!result?.meta) { stats.excludedDateUnknown += 1; continue; }
    metas.push(result.meta);
  }
  const deduped = [...new Map(metas.map((meta) => [meta._dedupeKey || meta.id, meta])).values()];
  deduped.sort((a, b) => {
    const dateCmp = String(a.released || '').localeCompare(String(b.released || ''));
    if (dateCmp) return mode === 'nowplaying' ? -dateCmp : dateCmp;
    return Number(b._popularity || 0) - Number(a._popularity || 0);
  });
  const finalMetas = deduped.slice(0, getConfig().maxItems);
  stats.duplicatesRemoved = Math.max(0, metas.length - deduped.length);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

async function mapLimitSettled(items, limit, mapper) {
  const results = [];
  for (let start = 0; start < items.length; start += limit) {
    const chunk = items.slice(start, start + limit);
    const settled = await Promise.allSettled(chunk.map((item, index) => mapper(item, start + index)));
    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(result.value);
      else results.push({ error: result.reason });
    }
  }
  return results;
}

async function fetchDetails(type, tmdbId) {
  const cacheKey = `details:${type}:${tmdbId}:${getConfig().language}`;
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const namespace = type === 'movie' ? 'movie' : 'tv';
  const append = type === 'movie'
    ? 'external_ids,watch/providers,release_dates'
    : 'external_ids,watch/providers';
  const details = await tmdbFetch(`/${namespace}/${tmdbId}`, {
    language: getConfig().language,
    append_to_response: append
  });
  return detailsCache.set(cacheKey, details, DETAILS_TTL_MS);
}

async function fetchSeasonDetails(tmdbId, seasonNumber) {
  const cacheKey = `season:${tmdbId}:${seasonNumber}:${getConfig().language}`;
  const cached = detailsCache.get(cacheKey);
  if (cached) return cached;
  const details = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, { language: getConfig().language });
  return detailsCache.set(cacheKey, details, DETAILS_TTL_MS);
}

function seasonCandidatesForWindow(details, window) {
  const lowerGuard = addIsoDays(window.start, -370);
  return (details?.seasons || [])
    .filter((season) => Number(season?.season_number) > 0)
    .map((season) => ({ ...season, date: normalizeIsoDate(season?.air_date) }))
    .filter((season) => !season.date || (season.date <= window.end && season.date >= lowerGuard))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 2);
}

function archiveEpisodeToMeta(details, episode, providerLabel, window) {
  const date = normalizeIsoDate(episode?.air_date);
  if (!date || date < window.start || date > window.end) return null;
  const code = episodeCode(episode);
  const meta = baseMeta(details, 'series', date, `${code} • ${humanCalendarDate(date)}`);
  meta.description = [
    `${providerLabel} France • épisode diffusé en ${String(window.start).slice(0, 4)}`,
    episode?.name ? `${code} — ${episode.name}` : code,
    stripHtml(episode?.overview),
    meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventMode = EVENT_MODES.STREAMING_DATE;
  meta._dedupeKey = `archive:${details.id}:${episode?.season_number || 0}:${episode?.episode_number || episode?.id || date}`;
  return meta;
}

async function buildStreamingSeriesYearArchive({ catalog, timeZone, now = new Date(), period = 'lastyear', useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug, type: 'series', period, timeZone, today: window.today,
    sourceVersion: `${SOURCE_VERSION}-series-year-archive`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  if (window.empty) {
    const stats = emptyStats({ label: catalog.cardProvider || catalog.providerSlug, ids: [] }, { ...catalog, period, source: 'tmdb-season-archive' }, window, timeZone);
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const provider = await resolveProvider(catalog.providerSlug, 'series');
  const stats = emptyStats(provider, { ...catalog, period, source: 'tmdb-season-archive' }, window, timeZone);
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  let raw = await discoverCandidates({ ...catalog, period }, window, provider.ids, timeZone);
  raw = raw.slice(0, Math.min(24, getConfig().maxCandidates));
  stats.candidates = raw.length;
  const settled = await mapLimitSettled(raw, 5, async (candidate) => {
    const details = await fetchDetails('series', candidate.id);
    if (!hasProviderAccess(details, provider)) return { metas: [], reason: 'wrong-provider' };
    const seasons = seasonCandidatesForWindow(details, window);
    const seasonResults = await mapLimitSettled(seasons, 2, (season) => fetchSeasonDetails(details.id, season.season_number));
    const metas = [];
    for (const seasonResult of seasonResults) {
      if (seasonResult?.error) continue;
      for (const episode of seasonResult?.episodes || []) {
        const meta = archiveEpisodeToMeta(details, episode, provider.label, window);
        if (meta) metas.push(meta);
      }
    }
    if (!metas.length) {
      const fallback = seriesDetailsToMeta(details, provider.label, window);
      if (fallback?.meta) metas.push(fallback.meta);
    }
    return { metas };
  });
  const metas = [];
  for (const result of settled) {
    if (result?.error) { stats.enrichmentErrors += 1; continue; }
    if (result?.reason === 'wrong-provider') { stats.excludedWrongProvider += 1; continue; }
    metas.push(...(result?.metas || []));
  }
  const sorted = sortAndDedupeMetas(metas).reverse().slice(0, getConfig().maxItems);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  stats.final = sorted.length;
  const result = { metas: sorted.map(cleanCatalogMeta), stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

function emptyStats(provider, catalog, window, timeZone) {
  return {
    provider: provider?.label || catalog.providerSlug,
    providerSlug: catalog.providerSlug,
    source: catalog.source,
    providerIds: provider?.ids || [],
    type: catalog.type,
    period: catalog.period,
    timezone: timeZone,
    today: window.today,
    start: window.start,
    end: window.end,
    candidates: 0,
    excludedPast: 0,
    excludedDateUnknown: 0,
    excludedOutsideWindow: 0,
    excludedWrongProvider: 0,
    excludedNoImdb: 0,
    excludedMapping: 0,
    enrichmentErrors: 0,
    duplicatesRemoved: 0,
    final: 0
  };
}

function countReason(stats, reason) {
  if (reason === 'past') stats.excludedPast += 1;
  else if (reason === 'date-unknown') stats.excludedDateUnknown += 1;
  else if (reason === 'outside-window') stats.excludedOutsideWindow += 1;
}

async function buildStreamingCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug,
    type: catalog.type,
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  if (window.empty) {
    const stats = emptyStats({ label: catalog.cardProvider || catalog.providerSlug, ids: [] }, { ...catalog, period }, window, timeZone);
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const provider = await resolveProvider(catalog.providerSlug, catalog.type);
  const stats = emptyStats(provider, { ...catalog, period }, window, timeZone);
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const raw = await discoverCandidates({ ...catalog, period }, window, provider.ids, timeZone);
  stats.candidates = raw.length;

  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails(catalog.type, candidate.id);
    if (!hasProviderAccess(details, provider)) return { meta: null, reason: 'wrong-provider' };
    if (catalog.type === 'movie') return movieDetailsToMeta(details, provider.label, window);
    return seriesDetailsToMeta(details, provider.label, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

async function buildVodCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'vod-fr',
    type: 'movie',
    period,
    timeZone,
    today: window.today,
    sourceVersion: `${SOURCE_VERSION}-vod`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const stats = emptyStats({ label: 'VOD France · Sorties digitales', ids: [] }, { ...catalog, period, providerSlug: 'vod-fr' }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const raw = await discoverVodCandidates(window);
  stats.candidates = raw.length;
  const settled = await mapLimitSettled(raw, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails('movie', candidate.id);
    // La seule condition VOD est une vraie date Digital (type 4) dans le marché FR.
    // Aucune exigence de buy/rent/watch provider.
    return movieVodDetailsToMeta(details, 'VOD France · Sortie digitale', window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) { stats.enrichmentErrors += 1; continue; }
    if (result?.reason === 'wrong-provider') { stats.excludedWrongProvider += 1; continue; }
    if (!result?.meta) { countReason(stats, result?.reason); continue; }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}


function isoDateRange(start, end) {
  const values = [];
  for (let current = normalizeIsoDate(start); current && current <= end; current = addIsoDays(current, 1)) {
    values.push(current);
  }
  return values;
}

async function tvmazeFetch(path, params = {}) {
  const url = new URL(`${TVMAZE_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return sourceFetchJson('tvmaze', url, { headers: { Accept: 'application/json', 'User-Agent': `NuvioCalendar/${VERSION}` } });
}

async function tvmazeScheduleDate(sourceDate) {
  const key = `tvmaze:schedule:US:${sourceDate}`;
  const cached = tvmazeCache.get(key);
  if (cached) return cached;
  const payload = await tvmazeFetch('/schedule', { country: 'FR', date: sourceDate });
  const list = Array.isArray(payload) ? payload : [];
  return tvmazeCache.set(key, list, TVMAZE_SCHEDULE_TTL_MS);
}

function tvmazeShowFromEpisode(episode) {
  return episode?._embedded?.show || episode?.show || null;
}

function tvmazeSourceTimezone(show) {
  const zone = show?.network?.country?.timezone || null;
  return isValidTimeZone(zone) ? zone : null;
}

const TV_USA_LOW_SIGNAL_TYPES = new Set(['news', 'talk show', 'sports']);
const TV_USA_LOW_SIGNAL_TITLE_RE = /\b(news|nightly news|evening news|world news|news tonight|newscast|morning news|daily news|financial news|weather center|sportscenter|sports center)\b/i;

function isLowSignalTvUsaEpisode(episode) {
  const show = tvmazeShowFromEpisode(episode);
  const type = normalizedCardToken(show?.type);
  const title = String(show?.name || '');
  if (TV_USA_LOW_SIGNAL_TYPES.has(type)) return true;
  if (TV_USA_LOW_SIGNAL_TITLE_RE.test(title)) return true;
  return false;
}

function tvmazeBroadcastToMeta(episode, timeZone, window, now = new Date()) {
  const show = tvmazeShowFromEpisode(episode);
  if (!show?.network || show?.network?.country?.code !== 'US') return { meta: null, reason: 'not-us-broadcast' };
  if (!episode?.airstamp) return { meta: null, reason: 'date-unknown' };
  const imdbId = show?.externals?.imdb || null;
  if (!/^tt\d+$/.test(String(imdbId || ''))) return { meta: null, reason: 'no-imdb' };

  const sourceTimezone = tvmazeSourceTimezone(show);
  const sourceLocal = sourceTimezone ? viewerDateTimeFromInstant(episode.airstamp, sourceTimezone) : null;
  const eventResult = buildInstantEvent({
    eventMode: EVENT_MODES.BROADCAST_INSTANT,
    eventInstant: episode.airstamp,
    viewerTimezone: timeZone,
    window,
    sourceTimezone,
    sourceDate: sourceLocal?.date || episode.airdate || null,
    sourceTime: sourceLocal?.time || episode.airtime || null
  });
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const code = episodeCode({ season: episode.season, number: episode.number });
  const viewerLabel = `${humanDate(event.viewerDate, timeZone, window.today)} • ${event.viewerTime}`;
  const sourceLabel = sourceLocal
    ? `${humanCalendarDate(sourceLocal.date)} • ${sourceLocal.time}${sourceLocal.timeZoneLabel ? ` ${sourceLocal.timeZoneLabel}` : ''}`
    : [episode.airdate, episode.airtime].filter(Boolean).join(' • ');
  const episodeTitle = episode?.name ? `${code} — ${episode.name}` : code;
  const summary = stripHtml(episode?.summary) || stripHtml(show?.summary);
  const description = [
    episodeTitle,
    sourceLabel ? `Diffusion France : ${sourceLabel}` : null,
    'Horaires : TVmaze',
    summary
  ].filter(Boolean).join('\n\n');

  const runtime = Number(episode?.runtime || show?.runtime || 0) || null;
  const meta = {
    id: imdbId,
    type: 'series',
    name: show.name || 'Sans titre',
    poster: show?.image?.original || show?.image?.medium || null,
    posterShape: 'poster',
    background: show?.image?.original || null,
    landscapePoster: show?.image?.original || null,
    description,
    releaseInfo: `${code} • ${viewerLabel}`,
    released: event.viewerDate,
    status: show?.status || null,
    imdbRating: Number.isFinite(show?.rating?.average) ? Number(show.rating.average).toFixed(1) : null,
    imdb_id: imdbId,
    genres: Array.isArray(show?.genres) ? show.genres : [],
    runtime: runtime ? `${runtime} min` : null,
    country: 'France',
    language: show?.language || null,
    behaviorHints: { hasScheduledVideos: true },
    _popularity: Number(show?.weight || 0),
    _voteCount: 0,
    _dedupeKey: `tvmaze:${show.id}:${episode.id || `${episode.season}:${episode.number}`}`,
    _eventInstantMs: event.eventInstantMs,
    _eventHasTime: true,
    _eventMode: event.eventMode,
    _eventStatus: event.eventInstant ? temporalStatus(event, now, runtime) : null
  };
  return { meta, reason: null, event };
}

function temporalStatus(event, now, runtime) {
  const start = new Date(event.eventInstant).getTime();
  if (!Number.isFinite(start)) return null;
  const diff = start - now.getTime();
  const end = start + (Number(runtime) > 0 ? Number(runtime) * 60_000 : 0);
  if (diff > 60 * 60_000) return 'UPCOMING';
  if (diff > 0) return 'AIRING_SOON';
  if (end > start && now.getTime() < end) return 'AIRING_NOW';
  return 'RELEASED_TODAY';
}

async function buildTvBroadcastCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog?.includeLowSignal ? 'tv-fr-all' : 'tv-fr-clean',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  let scheduleResults = [];
  if (period === 'lastyear') {
    // Do not hammer TVmaze with 365 daily calls. The catalog itself is capped at
    // MAX_ITEMS, so scan backwards from Dec 31 and stop once we have a generous
    // candidate buffer for the latest archive page(s). This keeps the Home row fast.
    const floor = addIsoDays(window.start, -2);
    let cursor = addIsoDays(window.end, 2);
    let scannedDays = 0;
    let rawCount = 0;
    const rawTarget = getConfig().maxItems * 4;
    while (cursor >= floor && scannedDays < 56 && rawCount < rawTarget) {
      const batch = [];
      for (let i = 0; i < 7 && cursor >= floor; i += 1) {
        batch.push(cursor);
        cursor = addIsoDays(cursor, -1);
        scannedDays += 1;
      }
      const settledBatch = await mapLimitSettled(batch, 4, async (sourceDate) => tvmazeScheduleDate(sourceDate));
      scheduleResults.push(...settledBatch);
      rawCount += settledBatch.reduce((sum, result) => sum + (Array.isArray(result) ? result.length : 0), 0);
    }
    stats.archiveScannedDays = scannedDays;
  } else {
    const sourceDates = isoDateRange(addIsoDays(window.start, -2), addIsoDays(window.end, 2));
    scheduleResults = await mapLimitSettled(sourceDates, 4, async (sourceDate) => tvmazeScheduleDate(sourceDate));
  }
  const raw = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  stats.candidates = raw.length;
  stats.enrichmentErrors += scheduleResults.filter((result) => result?.error).length;
  stats.excludedLowSignal = 0;

  const metas = [];
  for (const episode of raw) {
    if (!catalog?.includeLowSignal && isLowSignalTvUsaEpisode(episode)) {
      stats.excludedLowSignal += 1;
      continue;
    }
    const converted = tvmazeBroadcastToMeta(episode, timeZone, window, now);
    if (!converted.meta) {
      if (converted.reason === 'no-imdb') stats.excludedNoImdb += 1;
      else if (converted.reason !== 'not-us-broadcast') countReason(stats, converted.reason);
      continue;
    }
    metas.push(converted.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  const ordered = (period === 'lastyear' || /^archive-\d{4}-\d{2}$/.test(String(period || ''))) ? sorted.reverse() : sorted;
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = ordered.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}


async function tvmazeWebScheduleDate(calendarDate) {
  const key = `tvmaze:web-schedule:${calendarDate}`;
  const cached = tvmazeCache.get(key);
  if (cached) return cached;
  // No country parameter: TVmaze returns both local and global web channels.
  // Global services keep their announced civil airdate and normally have no airtime.
  const payload = await tvmazeFetch('/schedule/web', { date: calendarDate });
  const list = Array.isArray(payload) ? payload : [];
  return tvmazeCache.set(key, list, TVMAZE_SCHEDULE_TTL_MS);
}

function webChannelMatchesProvider(show, provider) {
  const name = show?.webChannel?.name || '';
  if (!name || !provider) return false;
  const normalized = normalizeProviderName(name);
  const aliases = new Set([provider.label, ...(provider.aliases || [])].map(normalizeProviderName));
  return aliases.has(normalized);
}

async function resolveTvmazeShowToTmdb(show) {
  const cacheKey = `tvmaze-map:${show?.id}`;
  const cached = mappingCache.get(cacheKey);
  if (cached !== null && cached !== undefined) return cached || null;
  let tmdbId = null;
  const imdb = show?.externals?.imdb;
  const tvdb = Number(show?.externals?.thetvdb);
  if (/^tt\d+$/.test(String(imdb || ''))) {
    tmdbId = await lookupTmdbFromExternal(imdb, 'series', 'imdb_id');
  } else if (Number.isFinite(tvdb) && tvdb > 0) {
    tmdbId = await lookupTmdbFromExternal(tvdb, 'series', 'tvdb_id');
  }
  mappingCache.set(cacheKey, tmdbId || 0, MAPPING_TTL_MS);
  return tmdbId || null;
}

function tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window) {
  const show = tvmazeShowFromEpisode(episode);
  const calendarDate = normalizeIsoDate(episode?.airdate);
  if (!calendarDate) return { meta: null, reason: 'date-unknown' };
  if (!window.allowPast && calendarDate < window.today) return { meta: null, reason: 'past' };
  if (window.empty || calendarDate < window.start || calendarDate > window.end) return { meta: null, reason: 'outside-window' };

  const code = episodeCode({ season: episode.season, number: episode.number });
  const isLocalFrenchWebChannel = show?.webChannel?.country?.code === 'FR';
  let event = {
    eventMode: EVENT_MODES.STREAMING_DATE,
    calendarDate,
    viewerDate: calendarDate,
    viewerTime: null,
    eventInstant: null,
    eventInstantMs: null
  };

  // TVmaze documents airtime for local web channels as the time the episode
  // was first made available. Global web channels intentionally have no release time.
  if (isLocalFrenchWebChannel && episode?.airstamp) {
    const viewer = viewerDateTimeFromInstant(episode.airstamp, timeZone);
    if (viewer) {
      event = {
        ...event,
        eventMode: EVENT_MODES.STREAMING_INSTANT,
        eventInstant: viewer.instant,
        eventInstantMs: new Date(viewer.instant).getTime(),
        viewerTime: viewer.time,
        convertedViewerDate: viewer.date
      };
    }
  }

  const dateLabel = humanDate(calendarDate, timeZone, window.today);
  const releaseInfo = event.viewerTime
    ? `${code} • ${dateLabel} • ${event.viewerTime}`
    : `${code} • ${dateLabel}`;
  const meta = baseMeta(details, 'series', calendarDate, releaseInfo);
  const episodeSummary = stripHtml(episode?.summary);
  const timingNote = event.viewerTime
    ? `${provider.label} France • heure de mise en ligne TVmaze convertie en ${timeZone}`
    : `${provider.label} France • date streaming officielle, heure non annoncée`;
  meta.description = [
    `${code}${episode?.name ? ` — ${episode.name}` : ''}`,
    timingNote,
    episodeSummary,
    meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventInstantMs = event.eventInstantMs;
  meta._eventHasTime = Boolean(event.viewerTime);
  meta._eventMode = event.eventMode;
  meta._dedupeKey = `stream:${details.id}:${episode.season || 0}:${episode.number || episode.id}`;
  return { meta, reason: null, event };
}

async function buildStreamingSeriesCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  // A full previous-year TVmaze day-by-day scan would be far too expensive on
  // Shield/Vercel. For this archive row we use TMDb provider validation plus
  // exact episode air dates from season data instead of first_air_date.
  if (period === 'lastyear' || /^archive-\d{4}-\d{2}$/.test(String(period || ''))) return buildStreamingSeriesYearArchive({ catalog, timeZone, now, period, useCache });
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: catalog.providerSlug,
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: `${SOURCE_VERSION}-webschedule+tmdb-fallback`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const provider = await resolveProvider(catalog.providerSlug, 'series');
  const stats = emptyStats(provider, { ...catalog, period, source: 'tvmaze-web+tmdb-fallback' }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  if (!provider?.ids?.length) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const metas = [];

  // Pass 1 — provider-specific TVmaze web schedule. This is the highest confidence
  // source because it can name the web channel and sometimes provides a real time.
  const dates = isoDateRange(window.start, window.end);
  const scheduleResults = await mapLimitSettled(dates, 4, (date) => tvmazeWebScheduleDate(date));
  const allEpisodes = scheduleResults.flatMap((result) => Array.isArray(result) ? result : []);
  stats.enrichmentErrors += scheduleResults.filter((result) => result?.error).length;
  const providerEpisodes = allEpisodes.filter((episode) => webChannelMatchesProvider(tvmazeShowFromEpisode(episode), provider));
  stats.candidates += providerEpisodes.length;

  const exactSettled = await mapLimitSettled(providerEpisodes.slice(0, getConfig().maxCandidates), 5, async (episode) => {
    const show = tvmazeShowFromEpisode(episode);
    const tmdbId = await resolveTvmazeShowToTmdb(show);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    if (!hasProviderAccess(details, provider)) return { meta: null, reason: 'wrong-provider' };
    return tvmazeStreamingEpisodeToMeta(episode, details, provider, timeZone, window);
  });

  for (const result of exactSettled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'mapping') {
      stats.excludedMapping += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  // Pass 2 — TMDb fallback. TVmaze's web schedule does not list every streaming
  // service/title, which previously made whole series catalogs look empty. TMDb is
  // used only as a fallback candidate source, then each title is revalidated against
  // the French streaming provider list and MUST have last_episode_to_air or
  // next_episode_to_air inside the requested window. Old shows with no current/new
  // episode are still rejected.
  let tmdbCandidates = [];
  try {
    tmdbCandidates = await discoverCandidates({ ...catalog, period }, window, provider.ids, timeZone);
  } catch (error) {
    stats.enrichmentErrors += 1;
  }
  stats.candidates += tmdbCandidates.length;

  const fallbackSettled = await mapLimitSettled(tmdbCandidates, ENRICH_CONCURRENCY, async (candidate) => {
    const details = await fetchDetails('series', candidate.id);
    if (!hasProviderAccess(details, provider)) return { meta: null, reason: 'wrong-provider' };
    const converted = seriesDetailsToMeta(details, provider.label, window);
    if (!converted.meta) return converted;
    converted.meta._dedupeKey = `series:${details.id}`;
    converted.meta.description = [
      `${provider.label} France • nouvel épisode confirmé TMDb`,
      'Heure de mise en ligne non confirmée par la plateforme.',
      converted.meta.description
    ].filter(Boolean).join('\n\n');
    return converted;
  });

  for (const result of fallbackSettled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'wrong-provider') {
      stats.excludedWrongProvider += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

const ANILIST_AIRING_QUERY = `
query ($page: Int, $start: Int, $end: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME_DESC) {
      id
      airingAt
      episode
      mediaId
      media {
        id
        idMal
        title { romaji english native }
        seasonYear
        countryOfOrigin
        format
        status
        isAdult
        duration
        popularity
        averageScore
        genres
        description(asHtml: false)
        coverImage { extraLarge large }
        bannerImage
      }
    }
  }
}`;

const ANILIST_AIRING_BY_ID_QUERY = `
query ($id: Int) {
  AiringSchedule(id: $id) {
    id
    airingAt
    episode
    mediaId
    media {
      id idMal seasonYear countryOfOrigin format status isAdult duration popularity averageScore genres
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
    }
  }
}`;

async function anilistFetch(query, variables = {}) {
  return sourceFetchJson('anilist', ANILIST_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `NuvioCalendar/${VERSION}`
    },
    body: JSON.stringify({ query, variables })
  });
}

async function anilistSchedules(window, timeZone) {
  const bounds = viewerWindowEpochBounds(window, timeZone);
  if (!bounds) return [];
  const key = `anilist:schedule:${timeZone}:${window.start}:${window.end}`;
  const cached = anilistCache.get(key);
  if (cached) return cached;

  const all = [];
  for (let page = 1; page <= 8; page += 1) {
    const payload = await anilistFetch(ANILIST_AIRING_QUERY, {
      page,
      start: bounds.startEpoch - 1,
      end: bounds.endExclusiveEpoch
    });
    if (payload?.errors?.length) throw new SourceHttpError('anilist', 502, '/graphql', payload.errors[0]?.message || 'GraphQL error');
    const section = payload?.data?.Page;
    all.push(...(section?.airingSchedules || []));
    if (!section?.pageInfo?.hasNextPage) break;
  }
  return anilistCache.set(key, all, ANILIST_SCHEDULE_TTL_MS);
}

function animeTitles(media) {
  return [...new Set([
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native
  ].filter(Boolean))];
}

function candidateMatchesAnime(candidate, media) {
  const expected = new Set(animeTitles(media).map(normalizeTitle).filter(Boolean));
  if (!expected.size) return false;
  const names = [candidate?.name, candidate?.original_name].map(normalizeTitle).filter(Boolean);
  if (!names.some((name) => expected.has(name))) return false;
  const year = Number(media?.seasonYear);
  if (Number.isFinite(year)) {
    const candidateYear = Number(String(candidate?.first_air_date || '').slice(0, 4));
    if (!Number.isFinite(candidateYear) || candidateYear !== year) return false;
  }
  return true;
}

async function resolveAnimeToTmdb(media) {
  const key = `anime-map:${media?.id}`;
  const cached = mappingCache.get(key);
  if (cached !== null && cached !== undefined) return cached;
  const titles = animeTitles(media).slice(0, 2);
  let candidates = [];
  for (const title of titles) {
    const params = { query: title, include_adult: false, language: getConfig().language };
    if (Number.isFinite(Number(media?.seasonYear))) params.first_air_date_year = Number(media.seasonYear);
    const payload = await tmdbFetch('/search/tv', params);
    candidates.push(...(payload?.results || []));
  }
  const unique = [...new Map(candidates.map((candidate) => [Number(candidate.id), candidate])).values()];
  const matches = unique.filter((candidate) => candidateMatchesAnime(candidate, media));
  matches.sort((a, b) => {
    const langA = a.original_language === 'ja' ? 1 : 0;
    const langB = b.original_language === 'ja' ? 1 : 0;
    if (langA !== langB) return langB - langA;
    return Number(b.popularity || 0) - Number(a.popularity || 0);
  });
  const tmdbId = Number(matches[0]?.id) || null;
  mappingCache.set(key, tmdbId || 0, MAPPING_TTL_MS);
  return tmdbId || null;
}

function animeScheduleToMeta(schedule, details, timeZone, window) {
  if (!schedule?.airingAt || !schedule?.episode || schedule?.media?.isAdult) return { meta: null, reason: 'date-unknown' };
  const eventResult = buildInstantEvent({
    eventMode: EVENT_MODES.ANIME_ORIGINAL_AIRING,
    eventInstant: new Date(Number(schedule.airingAt) * 1000),
    viewerTimezone: timeZone,
    window,
    sourceTimezone: null
  });
  if (!eventResult.event) return { meta: null, reason: eventResult.reason };
  const event = eventResult.event;
  const episodeLabel = `Épisode ${schedule.episode}`;
  const info = `${episodeLabel} • ${humanDate(event.viewerDate, timeZone, window.today)} • ${event.viewerTime}`;
  const meta = baseMeta(details, 'series', event.viewerDate, info);
  const anilistTitle = schedule?.media?.title?.english || schedule?.media?.title?.romaji || null;
  if (anilistTitle) meta.name = anilistTitle;
  if (schedule?.media?.coverImage?.extraLarge) meta.poster = schedule.media.coverImage.extraLarge;
  if (schedule?.media?.bannerImage) {
    meta.background = schedule.media.bannerImage;
    meta.landscapePoster = schedule.media.bannerImage;
  }
  meta.description = [
    `${episodeLabel} • Diffusion originale`,
    `Heure locale : ${humanCalendarDate(event.viewerDate)} • ${event.viewerTime}`,
    'Cette heure est l’airing original AniList ; elle n’est pas présentée comme une heure de mise en ligne Crunchyroll/Netflix.',
    schedule?.media?.description || meta.description
  ].filter(Boolean).join('\n\n');
  meta._eventInstantMs = event.eventInstantMs;
  meta._eventHasTime = true;
  meta._eventMode = event.eventMode;
  meta._dedupeKey = `anime:${schedule.mediaId}:${schedule.episode}`;
  meta._popularity = Number(schedule?.media?.popularity || meta._popularity || 0);
  meta._voteCount = Number(schedule?.media?.averageScore || 0);
  return { meta, reason: null, event };
}

async function buildAnimeCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'anime',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: SOURCE_VERSION
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }
  const stats = emptyStats(null, { ...catalog, period }, window, timeZone);
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }
  const schedules = await anilistSchedules(window, timeZone);
  const filtered = schedules.filter((schedule) => !schedule?.media?.isAdult);
  stats.candidates = filtered.length;

  const animeCandidateLimit = period === 'lastyear'
    ? Math.min(32, getConfig().maxCandidates)
    : getConfig().maxCandidates;
  const settled = await mapLimitSettled(filtered.slice(0, animeCandidateLimit), 5, async (schedule) => {
    const tmdbId = await resolveAnimeToTmdb(schedule.media);
    if (!tmdbId) return { meta: null, reason: 'mapping' };
    const details = await fetchDetails('series', tmdbId);
    return animeScheduleToMeta(schedule, details, timeZone, window);
  });

  const metas = [];
  for (const result of settled) {
    if (result?.error) {
      stats.enrichmentErrors += 1;
      continue;
    }
    if (result?.reason === 'mapping') {
      stats.excludedMapping += 1;
      continue;
    }
    if (!result?.meta) {
      countReason(stats, result?.reason);
      continue;
    }
    metas.push(result.meta);
  }

  const sorted = sortAndDedupeMetas(metas);
  stats.duplicatesRemoved = Math.max(0, metas.length - sorted.length);
  const finalMetas = sorted.slice(0, getConfig().maxItems).map(cleanCatalogMeta);
  stats.final = finalMetas.length;
  const result = { metas: finalMetas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}


function combinedLeafCatalogs(catalogOrType) {
  const catalog = typeof catalogOrType === 'string' ? { type: catalogOrType, section: catalogOrType === 'movie' ? 'films' : 'series-streaming' } : catalogOrType;
  const type = catalog.type;
  const section = catalogSection(catalog);

  if (section === 'archive-month') {
    const seriesStreaming = STREAMING_PROVIDERS.map((provider) => ({
      type: 'series', name: provider.label, providerSlug: provider.slug, period: 'today', source: 'tmdb-streaming', explore: false, section: 'series-streaming'
    }));
    const movieStreaming = STREAMING_PROVIDERS.map((provider) => ({
      type: 'movie', name: provider.label, providerSlug: provider.slug, period: 'today', source: 'tmdb-streaming', explore: false, section: 'films'
    }));
    return [
      ...seriesStreaming,
      ...movieStreaming,
      { type: 'movie', name: 'VOD France', providerSlug: 'vod-fr', period: 'today', source: 'tmdb-vod', explore: false, section: 'films' },
      { type: 'series', name: 'Crunchyroll', providerSlug: 'crunchyroll', period: 'today', source: 'tmdb-streaming', explore: false, section: 'anime' },
      { type: 'series', name: 'Anime', providerSlug: 'anime', period: 'today', source: 'anilist-airing', explore: false, section: 'anime' },
      { type: 'series', name: 'TV France', providerSlug: 'tv-fr', period: 'today', source: 'tvmaze-broadcast', includeLowSignal: false, explore: false, section: 'tvusa' }
    ];
  }

  if (section === 'tvusa') return [{ type: 'series', name: 'TV France', providerSlug: 'tv-fr', period: 'today', source: 'tvmaze-broadcast', includeLowSignal: false, explore: false, section: 'tvusa' }];
  if (section === 'anime') return [
    { type: 'series', name: 'Crunchyroll', providerSlug: 'crunchyroll', period: 'today', source: 'tmdb-streaming', explore: false, section: 'anime' },
    { type: 'series', name: 'Anime', providerSlug: 'anime', period: 'today', source: 'anilist-airing', explore: false, section: 'anime' }
  ];
  const streaming = STREAMING_PROVIDERS.map((provider) => ({ type, name: provider.label, providerSlug: provider.slug, period: 'today', source: 'tmdb-streaming', explore: false, section }));
  if (section === 'films') {
    return [
      ...streaming,
      { type: 'movie', name: 'VOD France', providerSlug: 'vod-fr', period: 'today', source: 'tmdb-vod', explore: false, section: 'films' }
    ];
  }
  return streaming;
}

function releaseEpisodeToken(meta) {
  const text = String(meta?.releaseInfo || '');
  return text.match(/S\d{1,2}E\d{1,3}/i)?.[0]?.toUpperCase()
    || text.match(/Épisode\s+\d+/i)?.[0]?.toLowerCase()
    || '';
}

function releaseClockMinutes(meta) {
  const match = String(meta?.releaseInfo || '').match(/(?:^|\s|•)([01]\d|2[0-3]):([0-5]\d)\b/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function combinedEventKey(meta, leaf) {
  const base = `${meta?.id || meta?.name || 'unknown'}:${meta?.released || ''}`;
  if (leaf.type === 'movie' && (leaf.source === 'tmdb-streaming' || leaf.source === 'tmdb-vod')) {
    // Subscription streaming and transactional VOD are one digital movie event
    // when TMDb gives the same French digital date. This prevents duplicate cards.
    return `digital:movie:${base}`;
  }
  if (leaf.source === 'tmdb-streaming') {
    const episode = releaseEpisodeToken(meta);
    return `streaming:series:${base}:${episode || String(meta?.releaseInfo || '')}`;
  }
  // TV broadcast and original anime airing are distinct events even when the
  // same title also has a streaming release on the same civil date.
  return `${leaf.source}:${base}:${String(meta?.releaseInfo || '')}`;
}

function stripProviderLead(description) {
  const parts = String(description || '').split(/\n\n+/).filter(Boolean);
  if (parts.length && /\bUS\s*•/i.test(parts[0])) parts.shift();
  return parts.join('\n\n');
}

function mergeCombinedMetas(results, type, period = 'week') {
  const map = new Map();
  for (const entry of results) {
    if (!entry || entry.error || !entry.leaf || !entry.result) continue;
    const leaf = entry.leaf;
    for (const original of entry.result.metas || []) {
      const provider = leaf.name;
      const key = combinedEventKey(original, leaf);
      const current = map.get(key);
      if (!current) {
        const meta = { ...original };
        meta._calendarProviders = [provider];
        meta._calendarProvider = provider;
        meta._calendarSource = leaf.source;
        map.set(key, meta);
        continue;
      }

      const currentDigital = current._calendarSource === 'tmdb-streaming' || current._calendarSource === 'tmdb-vod' || current._calendarSource === 'tmdb-digital';
      const incomingDigital = leaf.source === 'tmdb-streaming' || leaf.source === 'tmdb-vod';
      if (currentDigital && incomingDigital) {
        if (!current._calendarProviders.includes(provider)) current._calendarProviders.push(provider);
        const currentTime = releaseClockMinutes(current);
        const incomingTime = releaseClockMinutes(original);
        // Prefer a provider-specific real schedule time over a date-only fallback.
        if (currentTime === null && incomingTime !== null) {
          const providers = current._calendarProviders;
          Object.assign(current, original);
          current._calendarProviders = providers;
        }
        current._calendarSource = 'tmdb-digital';
      }
    }
  }

  const values = [...map.values()];
  for (const meta of values) {
    const providers = [...new Set(meta._calendarProviders || [])];
    meta._calendarProvider = providers.join(' + ') || 'Calendar France';
    if (meta._calendarSource === 'tmdb-streaming' || meta._calendarSource === 'tmdb-vod' || meta._calendarSource === 'tmdb-digital') {
      const body = stripProviderLead(meta.description);
      meta.description = [
        `Plateforme${providers.length > 1 ? 's' : ''} France : ${providers.join(' • ')}`,
        body
      ].filter(Boolean).join('\n\n');
    }
  }

  const historical = /^archive-\d{4}-\d{2}$/.test(String(period || '')) || ['lastyear', 'lastmonth', 'lastweek', 'month', 'past7', 'nowplaying'].includes(period);
  values.sort((a, b) => {
    const dateCmp = String(a.released || '').localeCompare(String(b.released || ''));
    if (dateCmp) return historical ? -dateCmp : dateCmp;
    const at = releaseClockMinutes(a);
    const bt = releaseClockMinutes(b);
    if (at !== null || bt !== null) {
      if (at === null) return 1;
      if (bt === null) return -1;
      if (at !== bt) return historical ? bt - at : at - bt;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });

  return values.slice(0, getConfig().maxItems);
}

async function buildCombinedCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true, filter = null }) {
  const window = dateWindow(period, now, timeZone);
  const filterKey = filter?.value || 'all';
  const section = catalogSection(catalog);
  const key = catalogCacheKey({
    providerSlug: `${section}-${filterKey}`,
    type: catalog.type,
    period,
    timeZone,
    today: window.today,
    sourceVersion: `${SOURCE_VERSION}-aggregate`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const stats = {
    provider: section,
    providerSlug: section,
    source: 'combined-calendar',
    section,
    providerIds: [],
    type: catalog.type,
    period,
    timezone: timeZone,
    today: window.today,
    start: window.start,
    end: window.end,
    sourceErrors: 0,
    sources: {},
    final: 0
  };
  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  let leaves = combinedLeafCatalogs(catalog);
  if (filter?.kind === 'provider') {
    leaves = leaves.filter((leaf) => leaf.providerSlug === filter.value);
  } else if (filter?.value === 'tv-fr') {
    leaves = leaves.filter((leaf) => leaf.source === 'tvmaze-broadcast').map((leaf) => ({ ...leaf, includeLowSignal: false }));
  } else if (filter?.value === 'tv-fr-all') {
    leaves = leaves.filter((leaf) => leaf.source === 'tvmaze-broadcast').map((leaf) => ({ ...leaf, includeLowSignal: true }));
  } else if (filter?.value === 'anime-airing') {
    leaves = leaves.filter((leaf) => leaf.source === 'anilist-airing');
  } else if (filter?.value === 'vod') {
    leaves = leaves.filter((leaf) => leaf.source === 'tmdb-vod');
  }
  const settled = await mapLimitSettled(leaves, 3, async (leaf) => {
    const result = await buildCatalog({ catalog: { ...leaf, period }, timeZone, now, period, useCache });
    return { leaf, result };
  });

  const normalized = settled.map((entry, index) => {
    if (entry?.error) {
      stats.sourceErrors += 1;
      const leaf = leaves[index];
      stats.sources[leaf?.name || `source-${index}`] = { error: true };
      return { error: entry.error, leaf };
    }
    stats.sources[entry.leaf.name] = {
      error: false,
      final: Number(entry.result?.stats?.final || entry.result?.metas?.length || 0)
    };
    return entry;
  });

  const metas = mergeCombinedMetas(normalized, catalog.type, period);
  stats.final = metas.length;
  const result = { metas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}


function crunchyrollAnimeDedupeKey(meta) {
  const episode = releaseEpisodeToken(meta);
  return [
    normalizeTitle(meta?.name),
    normalizeIsoDate(meta?.released) || '',
    episode || ''
  ].join(':');
}

async function buildCrunchyrollAnimeCatalog({ catalog, timeZone, now = new Date(), period = catalog.period, useCache = true }) {
  const window = dateWindow(period, now, timeZone);
  const key = catalogCacheKey({
    providerSlug: 'crunchyroll+anime',
    type: 'series',
    period,
    timeZone,
    today: window.today,
    sourceVersion: `${SOURCE_VERSION}-crunchyroll-anime`
  });
  if (useCache) {
    const cached = catalogCache.get(key);
    if (cached) return cached;
  }

  const stats = {
    provider: 'Crunchyroll',
    providerSlug: 'crunchyroll',
    source: 'crunchyroll-anime-combined',
    type: 'series',
    period,
    timezone: timeZone,
    today: window.today,
    start: window.start,
    end: window.end,
    sourceErrors: 0,
    sources: {},
    final: 0
  };

  if (window.empty) {
    const result = { metas: [], stats };
    return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
  }

  const crunchyCatalog = {
    ...catalog,
    providerSlug: 'crunchyroll',
    cardProvider: 'Crunchyroll',
    source: 'tmdb-streaming',
    section: 'series-streaming'
  };
  const animeCatalog = {
    ...catalog,
    providerSlug: 'anime',
    cardProvider: 'Crunchyroll',
    name: 'Anime',
    source: 'anilist-airing',
    section: 'anime'
  };

  const [crunchyResult, animeResult] = await Promise.allSettled([
    buildStreamingSeriesCatalog({ catalog: crunchyCatalog, timeZone, now, period, useCache }),
    buildAnimeCatalog({ catalog: animeCatalog, timeZone, now, period, useCache })
  ]);

  const merged = new Map();
  const consume = (result, sourceLabel) => {
    if (result.status !== 'fulfilled') {
      stats.sourceErrors += 1;
      stats.sources[sourceLabel] = { error: true };
      return;
    }
    const metas = result.value?.metas || [];
    stats.sources[sourceLabel] = { error: false, final: metas.length };
    for (const original of metas) {
      const meta = { ...original };
      // The user-facing parent is Crunchyroll: AniList anime is intentionally
      // folded into this parent instead of appearing as a separate Anime branch.
      meta._calendarProvider = 'Crunchyroll';
      if (sourceLabel === 'AniList Anime') {
        meta._calendarSource = 'anilist-airing';
        meta.description = [
          'Crunchyroll • Anime combiné',
          meta.description
        ].filter(Boolean).join('\n\n');
      }
      const dedupeKey = crunchyrollAnimeDedupeKey(meta);
      const previous = merged.get(dedupeKey);
      if (!previous) {
        merged.set(dedupeKey, meta);
        continue;
      }
      const previousTimed = Number.isFinite(previous._eventInstantMs);
      const currentTimed = Number.isFinite(meta._eventInstantMs);
      if (!previousTimed && currentTimed) merged.set(dedupeKey, meta);
    }
  };

  consume(crunchyResult, 'Crunchyroll');
  consume(animeResult, 'AniList Anime');

  const historical = /^archive-\d{4}-\d{2}$/.test(String(period || '')) ||
    ['yesterday', 'lastweek', 'lastmonth', 'past7'].includes(period);
  const metas = [...merged.values()].sort((a, b) => {
    const dateCmp = String(a.released || '').localeCompare(String(b.released || ''));
    if (dateCmp) return historical ? -dateCmp : dateCmp;
    const at = Number.isFinite(a._eventInstantMs) ? a._eventInstantMs : null;
    const bt = Number.isFinite(b._eventInstantMs) ? b._eventInstantMs : null;
    if (at !== null || bt !== null) {
      if (at === null) return 1;
      if (bt === null) return -1;
      if (at !== bt) return historical ? bt - at : at - bt;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  }).slice(0, getConfig().maxItems);

  stats.final = metas.length;
  const result = { metas, stats };
  return useCache ? catalogCache.set(key, result, CATALOG_TTL_MS) : result;
}

async function buildCatalog(options) {
  const source = options.catalog.source;
  if (source === 'combined-calendar') return buildCombinedCatalog(options);
  if (source === 'crunchyroll-anime-combined') return buildCrunchyrollAnimeCatalog(options);
  if (source === 'tvmaze-broadcast') return buildTvBroadcastCatalog(options);
  if (source === 'anilist-airing') return buildAnimeCatalog(options);
  if (source === 'tmdb-vod') return buildVodCatalog(options);
  if (source === 'tmdb-streaming-genre') return buildGenreStreamingCatalog(options);
  if (source === 'tmdb-theatrical-now' || source === 'tmdb-theatrical-upcoming') return buildTheatricalCatalog(options);
  if (source === 'tmdb-streaming' && options.catalog.type === 'series') return buildStreamingSeriesCatalog(options);
  return buildStreamingCatalog(options);
}

async function handleCatalog(req, res, type, catalogId, extras = {}, url = null) {
  const startedAt = Date.now();
  const timeZone = requestTimeZone(req);
  const now = runtimeNow();
  const catalog = resolveArchiveCatalog(catalogId, type, now, timeZone);
  if (!catalog) return json(res, 404, { metas: [] });
  // Period is fixed by the archive catalog ID. Dynamic periods have stable IDs
  // whose windows move with the viewer-local day; month IDs stay month-scoped.
  const period = catalog.period;
  const window = dateWindow(period, now, timeZone);
  const outsideRollingTwoYears = Number.isInteger(catalog.archiveYear)
    ? !archiveYearIsVisible(catalog.archiveYear, now, timeZone)
    : false;
  if (window.empty || outsideRollingTwoYears) {
    res.setHeader('Vary', 'x-vercel-ip-timezone');
    res.setHeader('X-Nuvio-Calendar-Date', window.today);
    res.setHeader('X-Nuvio-Calendar-Period', period);
    res.setHeader('X-Nuvio-Calendar-Filter', 'all');
    res.setHeader('X-Nuvio-Calendar-Skip', '0');
    res.setHeader('X-Nuvio-Calendar-Total', '0');
    res.setHeader('X-Nuvio-Calendar-Source-Errors', '0');
    return json(res, 200, { metas: [] }, 'public, max-age=300, s-maxage=3600');
  }
  const requestedFilter = extras.genre || url?.searchParams?.get('genre') || url?.searchParams?.get('filter');
  const filter = catalog.source === 'combined-calendar' ? filterFromExtra(requestedFilter, catalog) : null;
  const skip = parseSkip(extras.skip ?? url?.searchParams?.get('skip'));
  let result;
  try {
    result = await buildCatalog({ catalog, timeZone, now, period, useCache: true, filter });
  } catch (error) {
    // Nuvio's Collection folder should never be taken down by one provider API
    // failure. Return a valid empty Stremio catalog so Shield stays navigable.
    console.error(`[catalog-soft-fail] ${catalogId}`, error);
    res.setHeader('Vary', 'x-vercel-ip-timezone');
    res.setHeader('X-Nuvio-Calendar-Date', window.today);
    res.setHeader('X-Nuvio-Calendar-Period', period);
    res.setHeader('X-Nuvio-Calendar-Filter', filter?.value || 'all');
    res.setHeader('X-Nuvio-Calendar-Skip', String(skip));
    res.setHeader('X-Nuvio-Calendar-Total', '0');
    res.setHeader('X-Nuvio-Calendar-Source-Errors', '1');
    res.setHeader('X-Nuvio-Upstream-Error', '1');
    return json(res, 200, { metas: [] }, 'private, max-age=30');
  }
  const allMetas = catalog.source === 'combined-calendar'
    ? filterCombinedMetas(result.metas, filter, type)
    : result.metas;
  const pageSize = getConfig().pageSize;
  const pagedMetas = allMetas.slice(skip, skip + pageSize);
  const origin = requestOrigin(req);
  const decoratedMetas = decorateCatalogMetas(origin, pagedMetas, catalog, timeZone);
  res.setHeader('Vary', 'x-vercel-ip-timezone');
  res.setHeader('X-Nuvio-Calendar-Date', result.stats.today);
  res.setHeader('X-Nuvio-Calendar-Period', period);
  res.setHeader('X-Nuvio-Calendar-Filter', filter?.value || 'all');
  res.setHeader('X-Nuvio-Calendar-Skip', String(skip));
  res.setHeader('X-Nuvio-Calendar-Total', String(allMetas.length));
  res.setHeader('X-Nuvio-Calendar-Source-Errors', String(Number(result.stats?.sourceErrors || 0)));
  res.setHeader('Server-Timing', `calendar;dur=${Date.now() - startedAt}`);
  const currentMonth = period === `archive-${window.today.slice(0, 7)}`;
  const dynamicPeriod = Boolean(catalog.archivePeriodKey);
  const cacheControl = window.empty
    ? 'public, max-age=300, s-maxage=3600'
    : (dynamicPeriod || currentMonth
      ? 'private, max-age=60'
      : 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400');
  return json(res, 200, { metas: decoratedMetas }, cacheControl);
}

async function lookupTmdbFromExternal(id, type, externalSource = 'imdb_id') {
  const payload = await tmdbFetch(`/find/${id}`, { external_source: externalSource, language: getConfig().language });
  const list = type === 'movie' ? payload.movie_results : payload.tv_results;
  return list?.[0]?.id || null;
}

async function resolveTmdbId(id, type) {
  const fallback = parseTmdbFallbackId(id, type);
  if (fallback) return fallback;
  if (/^tt\d+$/.test(id)) return lookupTmdbFromExternal(id, type, 'imdb_id');
  return null;
}

async function handleMeta(res, type, id) {
  const tmdbId = await resolveTmdbId(id, type);
  if (!tmdbId) return json(res, 404, { meta: null });
  const details = await fetchDetails(type, tmdbId);
  let releaseDate;
  let releaseInfo;
  if (type === 'series' && details?.next_episode_to_air?.air_date) {
    releaseDate = details.next_episode_to_air.air_date;
    releaseInfo = `${episodeCode(details.next_episode_to_air)} • ${humanCalendarDate(releaseDate)}`;
  } else {
    releaseDate = type === 'movie' ? details?.release_date : details?.first_air_date;
    releaseInfo = releaseDate || null;
  }
  const meta = cleanCatalogMeta(baseMeta(details, type, releaseDate, releaseInfo));
  meta.id = id;
  return json(res, 200, { meta }, 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
}

async function providerHealth() {
  const [movieDirectory, tvDirectory] = await Promise.all([
    providerDirectory('movie'),
    providerDirectory('series')
  ]);
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const movie = resolveProviderFromDirectory(provider, movieDirectory);
    const series = resolveProviderFromDirectory(provider, tvDirectory);
    return [provider.label, Boolean(movie.ids.length || series.ids.length)];
  }));
}

async function sourceHealth() {
  const [tvmaze, anilist] = await Promise.allSettled([
    tvmazeFetch('/shows/1'),
    anilistFetch('query { Media(id: 1) { id } }')
  ]);
  return {
    tvmaze: tvmaze.status === 'fulfilled' ? 'ok' : 'error',
    anilist: anilist.status === 'fulfilled' && anilist.value?.data?.Media?.id ? 'ok' : 'error'
  };
}

async function handleHealth(req, res) {
  const configured = Boolean(getConfig().token || getConfig().apiKey);
  const timeZone = requestTimeZone(req);
  const now = runtimeNow();
  const today = localIsoDate(now, timeZone);
  const currentTime = localTime(now, timeZone);
  if (!configured) {
    const sources = await sourceHealth().catch(() => ({ tvmaze: 'error', anilist: 'error' }));
    return json(res, 503, {
      ok: false,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      mode: 'calendar-archives-fr-modern-shield-v1.0',
      archive: { minYear: ARCHIVE_MIN_YEAR, granularity: 'periods+month', dynamicPeriods: ARCHIVE_DYNAMIC_PERIODS.map((entry) => entry.label), months: ARCHIVE_MONTHS_FR },
      filters: { movie: filterOptionsForType('movie').map((entry) => entry.label), series: filterOptionsForType('series').map((entry) => entry.label) },
      pageSize: getConfig().pageSize,
      cards: { enabled: getConfig().calendarCards, appendFirst: true, livePoster: '16:9 center-safe', portrait: '2:3', landscape: '16:9', androidTvSafeSvg: true },
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'missing',
      ...sources
    }, 'no-store');
  }

  try {
    await tmdbFetch('/configuration');
    const [providers, sources] = await Promise.all([
      providerHealth(),
      sourceHealth()
    ]);
    return json(res, 200, {
      ok: true,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      mode: 'calendar-archives-fr-modern-shield-v1.0',
      archive: { minYear: ARCHIVE_MIN_YEAR, granularity: 'periods+month', dynamicPeriods: ARCHIVE_DYNAMIC_PERIODS.map((entry) => entry.label), months: ARCHIVE_MONTHS_FR },
      filters: { movie: filterOptionsForType('movie').map((entry) => entry.label), series: filterOptionsForType('series').map((entry) => entry.label) },
      pageSize: getConfig().pageSize,
      cards: { enabled: getConfig().calendarCards, appendFirst: true, livePoster: '16:9 center-safe', portrait: '2:3', landscape: '16:9', androidTvSafeSvg: true },
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'ok',
      tvmaze: sources.tvmaze,
      anilist: sources.anilist,
      providers
    }, 'no-store');
  } catch (error) {
    const sources = await sourceHealth().catch(() => ({ tvmaze: 'error', anilist: 'error' }));
    return json(res, 503, {
      ok: false,
      version: VERSION,
      market: DEFAULT_COUNTRY,
      mode: 'calendar-archives-fr-modern-shield-v1.0',
      archive: { minYear: ARCHIVE_MIN_YEAR, granularity: 'periods+month', dynamicPeriods: ARCHIVE_DYNAMIC_PERIODS.map((entry) => entry.label), months: ARCHIVE_MONTHS_FR },
      filters: { movie: filterOptionsForType('movie').map((entry) => entry.label), series: filterOptionsForType('series').map((entry) => entry.label) },
      pageSize: getConfig().pageSize,
      cards: { enabled: getConfig().calendarCards, appendFirst: true, livePoster: '16:9 center-safe', portrait: '2:3', landscape: '16:9', androidTvSafeSvg: true },
      timezone: timeZone,
      today,
      currentTime,
      tmdb: 'error',
      tvmaze: sources.tvmaze,
      anilist: sources.anilist,
      tmdbStatus: error?.status || null,
      tmdbMessage: error?.statusMessage || error?.code || 'TMDb inaccessible'
    }, 'no-store');
  }
}

async function handleDebugProvider(req, res, providerSlug, url) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const definition = PROVIDER_BY_SLUG.get(providerSlug);
  if (!definition) return json(res, 404, { error: 'Unknown provider' }, 'no-store');
  const period = ['lastmonth', 'lastweek', 'today', 'tomorrow', 'yesterday', 'nextweek', 'next7', 'month', 'past7', 'week', 'upcoming'].includes(url.searchParams.get('period'))
    ? url.searchParams.get('period')
    : 'week';
  const timeZone = requestTimeZone(req);
  const output = {};
  for (const type of ['movie', 'series']) {
    const catalog = {
      type,
      name: `${definition.label} • ${type === 'movie' ? 'Films' : 'Séries'}`,
      providerSlug,
      period,
      source: 'tmdb-streaming'
    };
    const result = await buildCatalog({ catalog, timeZone, now: new Date(), period, useCache: false });
    output[type] = result.stats;
  }
  return json(res, 200, {
    ok: true,
    version: VERSION,
    market: DEFAULT_COUNTRY,
    provider: definition.label,
    timezone: timeZone,
    today: localIsoDate(runtimeNow(), timeZone),
    period,
    stats: output
  }, 'no-store');
}

async function handleDebugCatalog(req, res, type, period) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  if (!['movie', 'series'].includes(type) || !['lastmonth', 'lastweek', 'today', 'tomorrow', 'yesterday', 'nextweek', 'next7', 'month', 'past7', 'week'].includes(period)) {
    return json(res, 400, { error: 'Invalid type or period' }, 'no-store');
  }
  const timeZone = requestTimeZone(req);
  const catalog = CATALOGS[`calendar-${period}-${type}`];
  if (!catalog) return json(res, 404, { error: 'Catalog not found' }, 'no-store');
  const result = await buildCombinedCatalog({ catalog, timeZone, now: runtimeNow(), period, useCache: false, filter: null });
  const providerCounts = {};
  const sourceCounts = {};
  for (const meta of result.metas || []) {
    for (const provider of meta._calendarProviders || []) providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    const source = meta._calendarSource || 'unknown';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  return json(res, 200, {
    ok: true,
    version: VERSION,
    market: DEFAULT_COUNTRY,
    type,
    period,
    timezone: timeZone,
    start: result.stats?.start || null,
    end: result.stats?.end || null,
    total: result.metas?.length || 0,
    sourceErrors: result.stats?.sourceErrors || 0,
    sources: result.stats?.sources || {},
    sourceCounts,
    providerCounts
  }, 'no-store');
}

async function handleDebugTime(req, res) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const viewerTimezone = requestTimeZone(req);
  const now = runtimeNow();
  return json(res, 200, {
    viewerTimezone,
    viewerNow: {
      date: localIsoDate(now, viewerTimezone),
      time: localTime(now, viewerTimezone)
    },
    utcNow: now.toISOString()
  }, 'no-store');
}

async function anilistScheduleById(id) {
  const payload = await anilistFetch(ANILIST_AIRING_BY_ID_QUERY, { id: Number(id) });
  if (payload?.errors?.length) throw new SourceHttpError('anilist', 502, '/graphql', payload.errors[0]?.message || 'GraphQL error');
  return payload?.data?.AiringSchedule || null;
}

async function handleDebugAiring(req, res, debugId) {
  if (!getConfig().debug) return json(res, 404, { error: 'Not found' }, 'no-store');
  const timeZone = requestTimeZone(req);
  const now = runtimeNow();
  const window = dateWindow('week', now, timeZone);
  if (/^tvmaze-\d+$/.test(debugId)) {
    const id = Number(debugId.slice('tvmaze-'.length));
    const episode = await tvmazeFetch(`/episodes/${id}`, { embed: 'show' });
    const converted = tvmazeBroadcastToMeta(episode, timeZone, window, now);
    return json(res, 200, {
      source: 'tvmaze',
      id,
      event: converted.event || null,
      reason: converted.reason || null
    }, 'no-store');
  }
  if (/^anilist-\d+$/.test(debugId)) {
    const id = Number(debugId.slice('anilist-'.length));
    const schedule = await anilistScheduleById(id);
    const eventResult = schedule ? buildInstantEvent({
      eventMode: EVENT_MODES.ANIME_ORIGINAL_AIRING,
      eventInstant: new Date(Number(schedule.airingAt) * 1000),
      viewerTimezone: timeZone,
      window
    }) : { event: null, reason: 'not-found' };
    return json(res, 200, {
      source: 'anilist',
      id,
      event: eventResult.event || null,
      reason: eventResult.reason || null
    }, 'no-store');
  }
  return json(res, 404, { error: 'Unknown airing id' }, 'no-store');
}

function landing(origin, timeZone = DEFAULT_TIMEZONE) {
  const manifest = `${origin}/manifest.json`;
  const blueprint = `${origin}/archive-blueprint.json`;
  const collectionsImport = `${origin}/nuvio-collections.json`;
  const configured = Boolean(getConfig().token || getConfig().apiKey);
  const { year, month } = archiveNowParts(runtimeNow(), timeZone);
  const currentMonth = ARCHIVE_MONTHS_FR[month - 1];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nuvio Calendar Archives France</title><style>body{margin:0;background:#050a12;color:#f8fbff;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:980px;margin:24px;padding:32px;border:1px solid #17365e;border-radius:24px;background:linear-gradient(145deg,#08111f,#0a2344)}h1{margin-top:0}.pill{display:inline-block;background:#0b67c2;padding:8px 14px;border-radius:999px;font-weight:800}code{display:block;overflow-wrap:anywhere;background:#030912;padding:14px;border-radius:12px;margin:14px 0}a{color:#58c7ff}.muted{color:#a9bdd4}.ok{color:#7ee787}.bad{color:#ff7b72}</style></head><body><main class="card"><span class="pill">ARCHIVES MODERN SHIELD · PLATEFORMES</span><h1>Nuvio Calendar Archives France ${VERSION}</h1><p>Hiérarchie native : <b>plateforme → Séries / Films → périodes dynamiques → mois + année → contenus</b>.</p><p>Parents France : <b>Netflix, Prime Video, Disney+, HBO Max, Apple TV+, CANAL+, Paramount+, france.tv, TF1+, M6+, ARTE, Crunchyroll + AniList, ADN et VOD France</b> (sorties digitales TMDb type 4, sans filtre achat/location).</p><p>Chaque dossier commence par <b>Aujourd’hui, Demain, Hier, Semaine passée, La semaine suivante</b>, puis les mois. Les cinq périodes se recalculent chaque jour selon le fuseau Europe/Paris. Aujourd’hui : <b>${currentMonth} ${year}</b> est le premier mois courant; quand septembre arrive, <b>Septembre ${year}</b> apparaît automatiquement sans réimport.</p><p>Visuels : cartes 16:9 Modern vectorielles, backgrounds nets et <b>logos plateforme TMDb en résolution originale, grands et centrés</b>, avec overlay Séries / Films.</p><p>Fuseau France : <b>${timeZone}</b> — marché streaming : <b>France</b> — TMDb : <b class="${configured ? 'ok' : 'bad'}">${configured ? 'configuré' : 'clé manquante'}</b></p><p>Manifest :</p><code>${manifest}</code><p><a href="${manifest}">manifest.json</a> · <a href="${collectionsImport}">JSON Collections importable</a> · <a href="${blueprint}">blueprint</a> · <a href="${origin}/health">health</a></p><p class="muted">Pour avoir les vraies images sur la Shield, importe le JSON depuis l’URL déployée <b>/nuvio-collections.json</b> : il injecte automatiquement les URLs du déploiement dans les cartes et les backdrops.</p></main></body></html>`;
}

function archiveYearCardSvg(year, category = '') {
  const safeYear = String(year || '').match(/^\d{4}$/)?.[0] || 'ARCHIVES';
  const categoryLabel = category === 'films' ? 'FILMS' : (category === 'series' ? 'SÉRIES' : 'ARCHIVES');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050a12"/><stop offset="0.58" stop-color="#07346a"/><stop offset="1" stop-color="#0b67c2"/></linearGradient><linearGradient id="o" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#118ee9" stop-opacity=".16"/><stop offset="1" stop-color="#002a5d" stop-opacity=".88"/></linearGradient></defs><rect width="1600" height="900" rx="42" fill="url(#g)"/><circle cx="1240" cy="180" r="330" fill="#38bdf8" opacity=".13"/><rect x="0" y="510" width="1600" height="390" fill="url(#o)"/><text x="90" y="170" fill="#64c9ff" font-family="Arial,sans-serif" font-size="42" font-weight="700" letter-spacing="8">CALENDAR ${categoryLabel}</text><text x="86" y="650" fill="#ffffff" font-family="Arial,sans-serif" font-size="230" font-weight="900">${safeYear}</text><text x="96" y="760" fill="#b9ddff" font-family="Arial,sans-serif" font-size="48" font-weight="700">JANVIER — DÉCEMBRE</text><rect x="86" y="805" width="520" height="10" rx="5" fill="#38bdf8"/></svg>`;
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0b0f17"/><rect x="80" y="84" width="352" height="344" rx="76" fill="#171d2a" stroke="#38bdf8" stroke-width="18"/><path d="M128 188h256M128 260h256M128 332h172" stroke="#fff" stroke-width="26" stroke-linecap="round"/><text x="317" y="359" fill="#38bdf8" font-family="Arial,sans-serif" font-size="92" font-weight="700">CAL</text></svg>`;
const BG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0f17"/><stop offset="1" stop-color="#24154a"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="1500" cy="220" r="420" fill="#38bdf8" opacity=".18"/></svg>`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const origin = requestOrigin(req);
  const url = new URL(req.url, origin);
  const path = decodeURIComponent(url.pathname);

  try {
    if (path === '/' || path === '/index.html') return html(res, landing(origin, requestTimeZone(req)));
    if (path === '/manifest.json') { const tz = requestTimeZone(req); return json(res, 200, buildManifest(origin, runtimeNow(), tz), 'public, max-age=300, s-maxage=900'); }
    if (path === '/logo.svg') return svg(res, LOGO);
    if (path === '/background.svg') return svg(res, BG);
    if (path === '/calendar-transparent-logo.svg') return svg(res, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="16" viewBox="0 0 64 16"><rect width="64" height="16" fill="none"/></svg>', 'public, max-age=31536000, immutable');
    if (path === '/archive-year-card.svg') return svg(res, archiveYearCardSvg(url.searchParams.get('year'), url.searchParams.get('category')), 'public, max-age=86400, s-maxage=86400');
    if (path === '/platform-logo') return await handlePlatformLogo(res, url);
    if (path === '/platform-backdrop.svg') return await handlePlatformBackdrop(res, url);
    if (path === '/desktop-folder-card.jpg') return await handleDesktopFolderCard(res, url);
    if (path === '/desktop-content-card.jpg') return await handleDesktopContentCard(res, url);
    if (path === '/desktop-genre-card.jpg') return await handleDesktopGenreCard(res, url);
    if (path === '/platform-card.jpg') return servePlatformArtJpeg(res, url, 'card');
    if (path === '/platform-backdrop.jpg') return servePlatformArtJpeg(res, url, 'backdrop');
    if (path === '/platform-category-card.svg') return await handlePlatformCategoryCard(res, url);
    if (path === '/genre-poster.png') return serveGenrePosterPng(res, Object.fromEntries(url.searchParams.entries()));
    if (path === '/genre-folder-art.svg') return svg(res, genreFolderArtSvg(Object.fromEntries(url.searchParams.entries())), 'public, max-age=3600, s-maxage=86400');
    if (path === '/genre-card.jpg') return serveGenreCinematicJpeg(res, url, 'card');
    if (path === '/genre-backdrop.jpg') return serveGenreCinematicJpeg(res, url, 'backdrop');
    if (path === '/genre-collection-art.jpg') return serveLocalJpeg(res, `${COLLECTION_CINEMATIC_ART_DIR}/fr-genres-backdrop.jpg`);
    if (path === '/calendar-card.svg') return await handleCalendarCard(res, url);
    if (path === '/health') return await handleHealth(req, res);
    if (path === '/nuvio-collections.json' || path === '/collections.json') return json(res, 200, buildNuvioCollectionsImport(runtimeNow(), requestTimeZone(req), origin), 'no-store');
    if (path === '/archive-blueprint.json') return json(res, 200, buildArchiveBlueprint(runtimeNow(), requestTimeZone(req), origin), 'no-store');

    if (path === '/debug/time') return await handleDebugTime(req, res);
    const debugCatalogMatch = path.match(/^\/debug\/catalog\/(movie|series)\/(month|past7|today|tomorrow|yesterday|lastweek|nextweek|week)$/);
    if (debugCatalogMatch) return await handleDebugCatalog(req, res, debugCatalogMatch[1], debugCatalogMatch[2]);
    const debugProviderMatch = path.match(/^\/debug\/provider\/([^/]+)$/);
    if (debugProviderMatch) return await handleDebugProvider(req, res, debugProviderMatch[1], url);
    const debugAiringMatch = path.match(/^\/debug\/airing\/([^/]+)$/);
    if (debugAiringMatch) return await handleDebugAiring(req, res, debugAiringMatch[1]);

    const catalogMatch = path.match(/^\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
    if (catalogMatch) {
      const extras = parseCatalogExtraSegment(catalogMatch[3] || '');
      return await handleCatalog(req, res, catalogMatch[1], catalogMatch[2], extras, url);
    }

    const metaMatch = path.match(/^\/meta\/(movie|series)\/([^/]+)\.json$/);
    if (metaMatch) return await handleMeta(res, metaMatch[1], metaMatch[2]);

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    if (error?.code === 'TMDB_CONFIG_MISSING') {
      return json(res, 503, { error: 'Configure TMDB_READ_TOKEN ou TMDB_API_KEY sur le serveur.' }, 'no-store');
    }
    if (error?.code === 'TMDB_HTTP_ERROR') {
      return json(res, 502, {
        error: 'Impossible de charger les nouvelles sorties France pour le moment.',
        tmdbStatus: error.status || null,
        tmdbMessage: error.statusMessage || null
      }, 'no-store');
    }
    if (error?.code === 'TMDB_TIMEOUT') return json(res, 504, { error: 'TMDb a mis trop de temps à répondre.' }, 'no-store');
    if (error?.source === 'tvmaze' || String(error?.code || '').startsWith('TVMAZE_')) {
      return json(res, 502, { error: 'TVmaze est momentanément indisponible.' }, 'no-store');
    }
    if (error?.source === 'anilist' || String(error?.code || '').startsWith('ANILIST_')) {
      return json(res, 502, { error: 'AniList est momentanément indisponible.' }, 'no-store');
    }
    return json(res, 502, { error: 'Impossible de charger le calendrier France pour le moment.' }, 'no-store');
  }
};

module.exports._internals = {
  VERSION,
  PROVIDERS,
  ARCHIVE_MIN_YEAR,
  ARCHIVE_ID_PREFIX,
  ARCHIVE_PREWIRE_FUTURE_YEARS,
  ARCHIVE_MONTHS_FR,
  ARCHIVE_VOD_PROVIDER,
  ARCHIVE_SERIES_PROVIDERS,
  ARCHIVE_FILM_PROVIDERS,
  ARCHIVE_TYPES,
  ARCHIVE_DYNAMIC_PERIODS,
  PLATFORM_COLLECTIONS,
  PLATFORM_COLLECTION_ID_OVERRIDES,
  archiveNowParts,
  archivePeriod,
  archiveCatalogId,
  archiveDynamicCatalogId,
  archiveDescriptor,
  archiveDynamicDescriptor,
  archivePrewiredYears,
  archiveYearIsVisible,
  buildArchiveCatalogEntries,
  resolveArchiveCatalog,
  platformCollectionId,
  platformImageUrls,
  buildNuvioCollectionsImport,
  buildGenreCatalogEntries,
  buildGenreCollection,
  buildGenreCollections,
  buildGenreCollectionByType,
  TMDB_MOVIE_GENRES,
  TMDB_TV_GENRES,
  buildGenreStreamingCatalog,
  buildArchiveBlueprint,
  PERIOD_OPTIONS,
  FILM_EXTRA_CATALOGS,
  PERIOD_LABELS,
  SERIES_STREAMING_FILTERS,
  TVUSA_FILTERS,
  ANIME_FILTERS,
  MOVIE_SPECIAL_FILTERS,
  STREAMING_PROVIDERS,
  catalogSection,
  filterOptionsForCatalog,
  filterOptionsForType,
  filterFromExtra,
  filterCombinedMetas,
  parseSkip,
  CATALOGS,
  EXPLORE_CATALOG_IDS,
  EVENT_MODES,
  MemoryCache,
  buildManifest,
  getConfig,
  requestTimeZone,
  runtimeNow,
  normalizePeriodLabel,
  periodFromExtra,
  parseCatalogExtraSegment,
  isAllowedPosterSource,
  normalizedCardLayout,
  optimizedCardSource,
  calendarCardUrl,
  calendarCardEventInfo,
  frenchCardDate,
  calendarAppend,
  exactClockToken,
  providerAccentColor,
  calendarSourceLabel,
  isHomeCalendarPeriod,
  decorateCatalogMetas,
  calendarCardSvg,
  archiveYearCardSvg,
  calendarTitleProfile,
  normalizeProviderName,
  resolveProviderFromDirectory,
  platformProviderDefinition,
  providerMonetizationTypes,
  hasProviderAccess,
  platformCollectionTitle,
  regionCollectionTitle,
  platformLogoAsset,
  platformFallbackLogoSvg,
  platformWordmarkSvg,
  platformBackdropSvg,
  platformCategoryCardSvg,
  discoverParams,
  fallbackDiscoverParams,
  vodDiscoverParams,
  discoverVodCandidates,
  usTheatricalReleaseDates,
  selectUsTheatricalRelease,
  discoverNowPlayingCandidates,
  upcomingTheatricalDiscoverParams,
  discoverUpcomingTheatricalCandidates,
  theatricalMovieToMeta,
  buildTheatricalCatalog,
  providerDirectory,
  resolveProvider,
  fetchDetails,
  fetchSeasonDetails,
  seasonCandidatesForWindow,
  archiveEpisodeToMeta,
  buildStreamingSeriesYearArchive,
  buildStreamingCatalog,
  buildVodCatalog,
  buildStreamingSeriesCatalog,
  buildTvBroadcastCatalog,
  buildAnimeCatalog,
  buildCrunchyrollAnimeCatalog,
  combinedLeafCatalogs,
  mergeCombinedMetas,
  buildCombinedCatalog,
  releaseClockMinutes,
  buildCatalog,
  mapLimitSettled,
  tmdbFetch,
  tvmazeFetch,
  tvmazeScheduleDate,
  tvmazeWebScheduleDate,
  isLowSignalTvUsaEpisode,
  tvmazeBroadcastToMeta,
  tvmazeStreamingEpisodeToMeta,
  webChannelMatchesProvider,
  resolveTvmazeShowToTmdb,
  anilistFetch,
  anilistSchedules,
  anilistScheduleById,
  animeScheduleToMeta,
  candidateMatchesAnime,
  resolveAnimeToTmdb,
  SourceHttpError,
  TmdbHttpError,
  catalogCache,
  detailsCache,
  providerCache,
  tvmazeCache,
  anilistCache,
  mappingCache,
  providerHealth,
  sourceHealth,
  isoDateRange
};
