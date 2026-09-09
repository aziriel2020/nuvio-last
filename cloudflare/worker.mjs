import nodeHandler from '../api/index.js';

const DYNAMIC_CATALOG_TTL = 300;
const HISTORICAL_CATALOG_TTL = 21600;
const META_TTL = 21600;
const GENERATED_ART_TTL = 604800;
const DEFAULT_TTL = 60;
const EDGE_CACHE_REV = 'anime-jpkr-v4-anilist-authoritative';

const POSTER_HOSTS = new Set([
  'image.tmdb.org',
  'static.tvmaze.com',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
  's4.anilist.co',
  'img.anili.st'
]);

const GENRE_POSTER_FILES = Object.freeze({
  action: 'action.png',
  'action-adventure': 'action.png',
  animation: 'animation.png',
  comedy: 'comedy.png',
  crime: 'crime.png',
  documentary: 'documentary.png',
  drama: 'drama.png',
  fantasy: 'fantasy.png',
  'scifi-fantasy': 'fantasy.png',
  horror: 'horror.png',
  romance: 'romance.png',
  'science-fiction': 'science-fiction.png'
});

function normalizedUrl(input) {
  return input instanceof URL ? input : new URL(String(input), 'https://edge.invalid');
}

export function edgeTtl(input) {
  const url = normalizedUrl(input);
  const path = url.pathname;

  if (path === '/health' || path.includes('/debug/') || path.startsWith('/internal/')) return 0;

  if (path.includes('/catalog/')) {
    if (/(?:today|tomorrow|yesterday|lastweek|nextweek)/i.test(path)) return DYNAMIC_CATALOG_TTL;
    const match = path.match(/-(\d{4})-(\d{2})(?:[/.]|$)/);
    if (!match) return DYNAMIC_CATALOG_TTL;
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${match[1]}-${match[2]}` === current ? DYNAMIC_CATALOG_TTL : HISTORICAL_CATALOG_TTL;
  }

  if (path.includes('/meta/')) return META_TTL;

  if (
    /\/(?:calendar-card\.svg|desktop-content-card\.jpg|desktop-folder-card\.jpg|desktop-genre-card\.jpg|platform-category-card\.svg|platform-backdrop\.svg|platform-logo|archive-year-card\.svg|genre-folder-art\.svg|genre-poster\.png)$/.test(path)
  ) {
    return GENERATED_ART_TTL;
  }

  return DEFAULT_TTL;
}

function validSlug(value) {
  return /^[a-z0-9-]+$/.test(String(value || ''));
}

export function localAssetPath(input) {
  const url = normalizedUrl(input);
  const path = url.pathname;

  let match = path.match(/^\/(fr|global|tr|us)\/(platform-card|platform-backdrop)\.jpg$/);
  if (match) {
    const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
    if (!validSlug(provider)) return null;
    const variant = match[2] === 'platform-backdrop' ? 'backdrop' : 'card';
    return `/static/assets/platform-art/${match[1]}/${provider}-${variant}.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/(genre-card|genre-backdrop)\.jpg$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    if (!validSlug(genre)) return null;
    const variant = match[2] === 'genre-backdrop' ? 'backdrop' : 'card';
    return `/static/assets/genre-art/shared/${genre}-${variant}.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/genre-collection-art\.jpg$/);
  if (match) {
    const file = match[1] === 'us' ? 'us-genres-backdrop.jpg' : 'fr-genres-backdrop.jpg';
    return `/static/assets/collection-art/${file}`;
  }

  match = path.match(/^\/(fr|tr|us)\/desktop-genre-card\.jpg$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    if (!validSlug(genre)) return null;
    return `/static/assets/genre-art/shared/${genre}-card.jpg`;
  }

  match = path.match(/^\/(fr|tr|us)\/genre-poster\.png$/);
  if (match) {
    const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
    const file = GENRE_POSTER_FILES[genre];
    return file ? `/static/assets/genre-posters/${file}` : null;
  }

  return null;
}

export function requestTimeZone(request) {
  const explicit = request.headers.get('x-nuvio-timezone');
  if (explicit) return explicit;
  const cf = request.cf && typeof request.cf === 'object' ? request.cf : null;
  return typeof cf?.timezone === 'string' && cf.timezone ? cf.timezone : '';
}

function withHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Nuvio-Edge', 'cloudflare-native');
  headers.set('X-Nuvio-Origin', 'cloudflare-only');
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function serveLocalAsset(request, env, assetPath) {
  const assetUrl = new URL(assetPath, request.url);
  const assetRequest = new Request(assetUrl.toString(), {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: request.headers
  });
  const response = await env.ASSETS.fetch(assetRequest);
  if (!response.ok) return withHeaders(response, { 'Cache-Control': 'public, max-age=60' });
  return withHeaders(response, { 'Cache-Control': 'public, max-age=31536000, immutable' });
}

function isAllowedPosterSource(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && POSTER_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function regionCalendarInternals(url) {
  const region = url.pathname.match(/^\/(fr|global|tr|us)\//)?.[1] || 'us';
  const handler = nodeHandler?._internals?.[`${region}Handler`];
  return handler?._internals || nodeHandler?._internals?.usHandler?._internals || null;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function staticAssetDataUri(request, env, assetPath) {
  const assetUrl = new URL(assetPath, request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString()));
  if (!response.ok) return null;

  const contentType = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(contentType)) return null;

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) return null;
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

function platformAssetInfo(url) {
  const match = url.pathname.match(/^\/(fr|global|tr|us)\/(?:platform-category-card\.svg|platform-backdrop\.svg|desktop-folder-card\.jpg)$/);
  if (!match) return null;
  const region = match[1];
  const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  if (!validSlug(provider)) return null;
  const desktop = url.pathname.endsWith('/desktop-folder-card.jpg');
  const backdrop = url.pathname.endsWith('/platform-backdrop.svg');
  const category = desktop
    ? (String(url.searchParams.get('type') || 'series').toLowerCase() === 'movie' ? 'films' : 'series')
    : (String(url.searchParams.get('category') || 'series').toLowerCase() === 'films' ? 'films' : 'series');
  const type = backdrop
    ? (String(url.searchParams.get('type') || 'movie').toLowerCase() === 'series' ? 'series' : 'movie')
    : (category === 'films' ? 'movie' : 'series');
  return { region, provider, category, type, desktop, backdrop };
}

export function platformStaticAssetPath(urlLike) {
  const url = normalizedUrl(urlLike);
  const info = platformAssetInfo(url);
  if (!info) return null;
  const variant = info.backdrop ? 'backdrop' : 'card';
  return `/static/assets/platform-art/${info.region}/${info.provider}-${variant}.jpg`;
}

async function servePlatformVisual(request, env, url) {
  const info = platformAssetInfo(url);
  if (!info) return new Response('Not found', { status: 404 });

  const internals = regionCalendarInternals(url);
  const assetPath = platformStaticAssetPath(url);
  const photoDataUri = assetPath ? await staticAssetDataUri(request, env, assetPath) : null;

  let logoDataUri = null;
  if (typeof internals?.platformLogoAsset === 'function') {
    try {
      const logo = await internals.platformLogoAsset(info.provider, info.type);
      logoDataUri = logo?.dataUri || null;
    } catch {
      logoDataUri = null;
    }
  }

  let svg;
  if (info.backdrop && typeof internals?.platformBackdropSvg === 'function') {
    svg = internals.platformBackdropSvg(info.provider, info.type, logoDataUri, photoDataUri);
  } else if (typeof internals?.platformCategoryCardSvg === 'function') {
    svg = internals.platformCategoryCardSvg(info.provider, info.category, logoDataUri, photoDataUri);
  } else {
    const label = escapeXml(url.searchParams.get('label') || info.provider.replace(/-/g, ' '));
    const category = info.category === 'films' ? 'FILMS' : 'SÉRIES';
    const width = info.backdrop ? 1920 : 1600;
    const height = info.backdrop ? 1080 : 900;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${photoDataUri ? `<image href="${escapeXml(photoDataUri)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${width}" height="${height}" fill="#07111f"/>`}
      <rect width="${width}" height="${height}" fill="#02040a" fill-opacity=".58"/>
      <text x="90" y="${height - 190}" fill="#fff" font-family="Arial,sans-serif" font-size="120" font-weight="900">${category}</text>
      <text x="94" y="${height - 90}" fill="#38bdf8" font-family="Arial,sans-serif" font-size="54" font-weight="900">${label.toUpperCase()}</text>
    </svg>`;
  }

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=86400, s-maxage=${GENERATED_ART_TTL}, stale-while-revalidate=2592000`,
      'X-Nuvio-Edge': 'cloudflare-native',
      'X-Nuvio-Origin': 'cloudflare-only',
      'X-Nuvio-Asset-Background': photoDataUri ? 'embedded' : 'missing',
      'X-Nuvio-Visual-Renderer': 'platform-assets-v2'
    }
  });
}

async function embeddedPosterDataUri(src) {
  if (!isAllowedPosterSource(src)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const upstream = await fetch(src, {
      signal: controller.signal,
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8',
        'User-Agent': 'NuvioCalendar/1.4.0 Cloudflare'
      },
      cf: {
        cacheEverything: true,
        cacheTtl: GENERATED_ART_TTL
      }
    });

    if (!upstream.ok) return null;
    const contentType = String(upstream.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(contentType)) return null;

    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > 3.5 * 1024 * 1024) return null;

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > 3.5 * 1024 * 1024) return null;
    return `data:${contentType};base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function wrapDesktopTitle(value, maxChars = 30) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  if (text.length <= maxChars) return [text];

  const words = text.split(' ');
  const lines = [''];
  for (const word of words) {
    const current = lines[lines.length - 1];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      lines[lines.length - 1] = candidate;
      continue;
    }
    if (lines.length === 1) lines.push(word);
    else lines[1] = `${lines[1]} ${word}`;
  }

  if (lines.length > 1 && lines[1].length > maxChars + 7) {
    lines[1] = `${lines[1].slice(0, maxChars + 4).trimEnd()}…`;
  }
  return lines.slice(0, 2);
}

function desktopTitleFontSize(lines) {
  const longest = Math.max(...lines.map((line) => line.length), 1);
  if (lines.length > 1 || longest > 27) return 70;
  if (longest > 20) return 80;
  return 92;
}

export function desktopContentCardSvg(urlLike, imageDataUri = null, logoDataUri = null) {
  const url = normalizedUrl(urlLike);
  const title = String(url.searchParams.get('title') || '').trim();
  const provider = String(
    url.searchParams.get('label') ||
    url.searchParams.get('provider') ||
    'NUVIO'
  ).trim();
  const append = String(url.searchParams.get('append') || '').replace(/\s+/g, ' ').trim();
  const type = String(url.searchParams.get('type') || 'series').toLowerCase() === 'movie'
    ? 'movie'
    : 'series';
  const accent = /^#[0-9a-f]{6}$/i.test(String(url.searchParams.get('color') || ''))
    ? String(url.searchParams.get('color'))
    : '#e50914';

  const lines = wrapDesktopTitle(title || (type === 'movie' ? 'Film' : 'Série'));
  const titleSize = desktopTitleFontSize(lines);
  const titleStartY = lines.length > 1 ? 625 : 690;
  const lineStep = Math.round(titleSize * 1.08);
  const safeProvider = escapeXml(provider.toUpperCase());
  const safeAppend = escapeXml(append || (type === 'movie' ? 'SORTIE' : 'NOUVEL ÉPISODE'));
  const titleNodes = lines.map((line, index) =>
    `<text class="desktop-title" x="104" y="${titleStartY + index * lineStep}" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing=".2">${escapeXml(line)}</text>`
  ).join('');
  const typeLabel = type === 'movie' ? 'FILM' : 'SÉRIE';
  const typeGlyph = type === 'movie'
    ? '<path d="M1437 69h78v58h-78zM1449 80h54v36h-54z" fill="none" stroke="#fff" stroke-width="6" rx="5"/>'
    : '<rect x="1438" y="70" width="76" height="54" rx="9" fill="none" stroke="#fff" stroke-width="6"/><path d="M1465 129h24" stroke="#fff" stroke-width="6" stroke-linecap="round"/>';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" data-renderer="shield-desktop-v3" data-title-lines="${lines.length}">
    <defs>
      <linearGradient id="leftShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#020203" stop-opacity=".88"/>
        <stop offset="46%" stop-color="#020203" stop-opacity=".40"/>
        <stop offset="76%" stop-color="#020203" stop-opacity=".08"/>
        <stop offset="100%" stop-color="#020203" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="34%" stop-color="#020203" stop-opacity="0"/>
        <stop offset="70%" stop-color="#020203" stop-opacity=".48"/>
        <stop offset="100%" stop-color="#020203" stop-opacity=".96"/>
      </linearGradient>
      <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#020203" stop-opacity=".36"/>
        <stop offset="100%" stop-color="#020203" stop-opacity="0"/>
      </linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity=".8"/></filter>
    </defs>
    ${imageDataUri ? `<image href="${escapeXml(imageDataUri)}" width="1600" height="900" preserveAspectRatio="xMidYMid slice"/>` : '<rect width="1600" height="900" fill="#101114"/>'}
    <rect width="1600" height="900" fill="url(#leftShade)"/>
    <rect width="1600" height="900" fill="url(#bottomShade)"/>
    <rect width="1600" height="230" fill="url(#topShade)"/>

    <g filter="url(#shadow)">
      <rect x="1110" y="42" width="294" height="104" rx="24" fill="#050506" fill-opacity=".90" stroke="${accent}" stroke-width="4"/>
      ${logoDataUri
        ? `<image href="${escapeXml(logoDataUri)}" x="1140" y="61" width="234" height="66" preserveAspectRatio="xMidYMid meet"/>`
        : `<text x="1257" y="108" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="32" font-weight="900">${safeProvider}</text>`}
      <rect x="1418" y="42" width="140" height="104" rx="24" fill="${accent}" fill-opacity=".98"/>
      ${typeGlyph}
      <text x="1488" y="139" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="900" letter-spacing="2">${typeLabel}</text>
    </g>

    <rect x="70" y="${lines.length > 1 ? 570 : 630}" width="12" height="${lines.length > 1 ? 205 : 150}" rx="6" fill="${accent}"/>
    <g filter="url(#shadow)">${titleNodes}</g>
    <text class="desktop-subtitle" x="106" y="796" fill="#f4f4f5" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="800" letter-spacing=".3">${safeAppend}</text>
    <text class="desktop-provider" x="106" y="852" fill="${accent}" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="900" letter-spacing="1.4">${safeProvider}</text>
    <rect x="106" y="870" width="360" height="5" rx="2.5" fill="${accent}" opacity=".92"/>
  </svg>`;
}

async function serveDesktopContentCard(request, env, url) {
  const src = String(url.searchParams.get('src') || '').trim();
  const imageDataUri = await embeddedPosterDataUri(src);
  const internals = regionCalendarInternals(url);
  const providerSlug = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  const type = String(url.searchParams.get('type') || 'series').toLowerCase() === 'movie' ? 'movie' : 'series';

  let logoDataUri = null;
  if (providerSlug && typeof internals?.platformLogoAsset === 'function') {
    try {
      const logo = await internals.platformLogoAsset(providerSlug, type);
      logoDataUri = logo?.dataUri || null;
    } catch {
      logoDataUri = null;
    }
  }

  const svg = desktopContentCardSvg(url, imageDataUri, logoDataUri);

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=86400, s-maxage=${GENERATED_ART_TTL}, stale-while-revalidate=2592000`,
      'X-Nuvio-Edge': 'cloudflare-native',
      'X-Nuvio-Origin': 'cloudflare-only',
      'X-Nuvio-Card-Renderer': 'calendar-overlay-v2'
    }
  });
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function serveGenreFolderArt(request, env, url) {
  const regionMatch = url.pathname.match(/^\/(fr|tr|us)\//);
  if (!regionMatch) return new Response('Not found', { status: 404 });

  const genre = String(url.searchParams.get('genre') || '').trim().toLowerCase();
  if (!validSlug(genre)) return new Response('Not found', { status: 404 });

  const variant = String(url.searchParams.get('variant') || 'card').toLowerCase();
  const sourceVariant = variant === 'backdrop' ? 'backdrop' : 'card';
  const assetPath = `/static/assets/genre-art/shared/${genre}-${sourceVariant}.jpg`;
  const assetUrl = new URL(assetPath, request.url);
  const image = await env.ASSETS.fetch(new Request(assetUrl.toString()));
  if (!image.ok) return withHeaders(image);

  const bytes = Buffer.from(await image.arrayBuffer());
  const dataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const label = escapeXml(url.searchParams.get('label') || genre.replace(/-/g, ' '));
  const type = String(url.searchParams.get('type') || 'movie') === 'series' ? 'SÉRIES' : 'FILMS';
  const color = /^#[0-9a-f]{6}$/i.test(String(url.searchParams.get('color') || ''))
    ? String(url.searchParams.get('color'))
    : '#38bdf8';

  const logo = variant === 'logo';
  const width = logo ? 1400 : 1600;
  const height = logo ? 300 : 900;
  const titleY = logo ? 138 : 700;
  const subY = logo ? 205 : 782;
  const imageX = logo ? 860 : 0;
  const imageWidth = logo ? 540 : width;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#02040a" stop-opacity=".98"/>
        <stop offset="55%" stop-color="#061222" stop-opacity=".72"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".22"/>
      </linearGradient>
    </defs>
    <image href="${dataUri}" x="${imageX}" y="0" width="${imageWidth}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${width}" height="${height}" fill="url(#shade)"/>
    <rect x="68" y="${logo ? 65 : 575}" width="12" height="${logo ? 160 : 230}" rx="6" fill="${color}"/>
    <text x="112" y="${titleY}" fill="#fff" font-family="Arial,sans-serif" font-size="${logo ? 68 : 92}" font-weight="900">${label}</text>
    <text x="114" y="${subY}" fill="${color}" font-family="Arial,sans-serif" font-size="${logo ? 30 : 42}" font-weight="800">${type}</text>
  </svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=86400, s-maxage=${GENERATED_ART_TTL}, stale-while-revalidate=2592000`,
      'X-Nuvio-Edge': 'cloudflare-native',
      'X-Nuvio-Origin': 'cloudflare-only'
    }
  });
}

function copyStringBindingsToProcessEnv(env) {
  if (typeof process === 'undefined' || !process.env) return;
  const names = [
    'TMDB_READ_TOKEN',
    'TMDB_API_KEY',
    'TMDB_LANGUAGE',
    'MAX_CANDIDATES',
    'MAX_ITEMS',
    'PAGE_SIZE',
    'TMDB_TIMEOUT_MS',
    'SOURCE_TIMEOUT_MS',
    'RETRY_BASE_MS',
    'TMDB_RETRY_BASE_MS',
    'CALENDAR_CARDS',
    'DEBUG',
    'NUVIO_NOW_OVERRIDE'
  ];
  for (const name of names) {
    if (typeof env?.[name] === 'string') process.env[name] = env[name];
  }
}

function cacheKeyFor(request, timeZone) {
  const url = new URL(request.url);
  // Internal-only cache revision: keeps public URLs/IDs unchanged while
  // invalidating stale empty anime responses after runtime fixes.
  url.searchParams.set('__nuvio_edge_rev', EDGE_CACHE_REV);
  if (
    timeZone &&
    (url.pathname.startsWith('/us/catalog/') || url.pathname.startsWith('/global/catalog/'))
  ) {
    url.searchParams.set('__nuvio_tz_cache', timeZone);
  }
  return new Request(url.toString(), { method: 'GET' });
}

async function invokeNodeHandler(request, timeZone) {
  const incoming = new URL(request.url);
  const headers = {};
  for (const [name, value] of request.headers) headers[name.toLowerCase()] = value;

  headers.host = incoming.host;
  headers['x-forwarded-host'] = incoming.host;
  headers['x-forwarded-proto'] = incoming.protocol.replace(':', '');
  headers['x-nuvio-public-origin'] = incoming.origin;
  if (timeZone) {
    headers['x-nuvio-timezone'] = timeZone;
    headers['x-vercel-ip-timezone'] = timeZone;
  }

  const req = {
    method: request.method,
    url: incoming.pathname + incoming.search,
    headers
  };

  return new Promise((resolve) => {
    const responseHeaders = new Headers();
    let statusCode = 200;
    let ended = false;

    const res = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(value) {
        statusCode = Number(value) || 200;
      },
      setHeader(name, value) {
        if (Array.isArray(value)) {
          responseHeaders.delete(name);
          for (const entry of value) responseHeaders.append(name, String(entry));
        } else {
          responseHeaders.set(name, String(value));
        }
      },
      getHeader(name) {
        return responseHeaders.get(name);
      },
      end(body = '') {
        if (ended) return;
        ended = true;
        resolve(new Response(body || null, { status: statusCode, headers: responseHeaders }));
      }
    };

    Promise.resolve(nodeHandler(req, res)).catch((error) => {
      console.error('Cloudflare native handler error', error);
      if (ended) return;
      ended = true;
      resolve(new Response(JSON.stringify({ error: 'Cloudflare runtime error' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }));
    });
  });
}

async function dynamicResponse(request, env, ctx) {
  copyStringBindingsToProcessEnv(env);
  const url = new URL(request.url);
  const timeZone = requestTimeZone(request);
  const ttl = request.method === 'GET' || request.method === 'HEAD' ? edgeTtl(url) : 0;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = ttl > 0 && cache ? cacheKeyFor(request, timeZone) : null;

  if (key && cache) {
    const hit = await cache.match(key);
    if (hit) return withHeaders(hit, { 'X-Nuvio-Cache': 'HIT' });
  }

  let response;
  if (/^\/(fr|global|tr|us)\/(?:platform-category-card\.svg|platform-backdrop\.svg|desktop-folder-card\.jpg)$/.test(url.pathname)) {
    response = await servePlatformVisual(request, env, url);
  } else if (/^\/(fr|global|tr|us)\/desktop-content-card\.jpg$/.test(url.pathname)) {
    response = await serveDesktopContentCard(request, env, url);
  } else if (/^\/(fr|tr|us)\/genre-folder-art\.svg$/.test(url.pathname)) {
    response = await serveGenreFolderArt(request, env, url);
  } else if (url.pathname.startsWith('/internal/')) {
    response = new Response('Not found', { status: 404 });
  } else {
    response = await invokeNodeHandler(request, timeZone);
  }

  let finalResponse = withHeaders(response, { 'X-Nuvio-Cache': 'MISS' });

  if (key && cache && finalResponse.ok && ttl > 0) {
    const headers = new Headers(finalResponse.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=${Math.max(ttl, 900)}`);
    finalResponse = new Response(finalResponse.body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers
    });
    const clone = finalResponse.clone();
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(key, clone));
    else await cache.put(key, clone);
  }

  return finalResponse;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
          'X-Nuvio-Edge': 'cloudflare-native',
          'X-Nuvio-Origin': 'cloudflare-only'
        }
      });
    }

    const url = new URL(request.url);
    const assetPath = localAssetPath(url);
    if (assetPath) return serveLocalAsset(request, env, assetPath);

    return dynamicResponse(request, env, ctx);
  }
};
