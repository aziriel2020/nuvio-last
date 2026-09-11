#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');

const rootHandler = require('../api/index.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'assets', 'generated-covers');
const REVISION = 'generated-v2';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w1280';

const REGION_APIS = {
  fr: rootHandler._internals.frHandler._internals,
  global: rootHandler._internals.globalHandler._internals,
  tr: rootHandler._internals.trHandler._internals,
  us: rootHandler._internals.usHandler._internals
};

const REGION_COUNTRY = {
  fr: 'FR',
  global: null,
  tr: 'TR',
  us: 'US'
};

const SPECIAL_VOD = new Set(['vod-fr', 'vod-global', 'vod-tr', 'vod-us']);
const ANIME_PROVIDERS = new Set(['anime-asia', 'crunchyroll']);

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


const FONT_CACHE = { bold: null };

function boldFont() {
  if (FONT_CACHE.bold) return FONT_CACHE.bold;
  const fontPath = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
  FONT_CACHE.bold = opentype.loadSync(fontPath);
  return FONT_CACHE.bold;
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function fitText(text, maxWidth, preferredSize, minSize = 22) {
  const value = normalizedText(text);
  if (!value) return { text: '', size: preferredSize };
  const font = boldFont();
  let size = preferredSize;
  while (size > minSize && font.getAdvanceWidth(value, size, { kerning: true }) > maxWidth) size -= 2;
  if (font.getAdvanceWidth(value, size, { kerning: true }) <= maxWidth) return { text: value, size };
  let clipped = value;
  while (clipped.length > 3) {
    clipped = clipped.slice(0, -1).trimEnd();
    const candidate = clipped + '…';
    if (font.getAdvanceWidth(candidate, size, { kerning: true }) <= maxWidth) return { text: candidate, size };
  }
  return { text: value.slice(0, 1) + '…', size };
}

function pathText(text, x, baselineY, maxWidth, preferredSize, options = {}) {
  const fitted = fitText(text, maxWidth, preferredSize, options.minSize || 22);
  if (!fitted.text) return '';
  const font = boldFont();
  const pathData = font.getPath(fitted.text, x, baselineY, fitted.size, { kerning: true }).toPathData(2);
  const fill = options.fill || '#ffffff';
  const opacity = options.opacity == null ? 1 : Number(options.opacity);
  return `<path d="${pathData}" fill="${fill}" opacity="${opacity}"/>`;
}

function centeredPathText(text, centerX, baselineY, maxWidth, preferredSize, options = {}) {
  const fitted = fitText(text, maxWidth, preferredSize, options.minSize || 20);
  if (!fitted.text) return '';
  const font = boldFont();
  const width = font.getAdvanceWidth(fitted.text, fitted.size, { kerning: true });
  const pathData = font.getPath(fitted.text, centerX - width / 2, baselineY, fitted.size, { kerning: true }).toPathData(2);
  const fill = options.fill || '#ffffff';
  return `<path d="${pathData}" fill="${fill}"/>`;
}

function normalizeType(value) {
  return String(value || '').toLowerCase() === 'movie' ? 'movie' : 'series';
}

function categoryLabel(category, type) {
  const raw = String(category?.title || '').trim();
  if (raw) return raw;
  return type === 'movie' ? 'Films' : 'Séries';
}

function scoreCandidate(entry) {
  return Number(entry?.popularity || 0)
    + Math.min(Number(entry?.vote_count || 0), 8000) / 70
    + Number(entry?.vote_average || 0) * 6;
}

function selectCandidates(results, providerSlug) {
  const all = (results || [])
    .filter((entry) => typeof entry?.backdrop_path === 'string' && entry.backdrop_path.startsWith('/'));
  const live = ANIME_PROVIDERS.has(providerSlug)
    ? all
    : all.filter((entry) => !(entry?.genre_ids || []).map(Number).includes(16));
  const pool = live.length >= 2 ? live : all;
  return pool.sort((a, b) => scoreCandidate(b) - scoreCandidate(a)).slice(0, 5);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      output[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return output;
}

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'image/jpeg,image/webp,*/*;q=0.8',
        'User-Agent': 'NuvioGeneratedCovers/2.0'
      }
    });
    if (!response.ok) return null;
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length >= 16000 ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadLocalFallback(region, providerSlug) {
  const candidates = [
    path.join(ROOT, 'assets', 'platform-art', region, `${providerSlug}-backdrop.jpg`),
    path.join(ROOT, 'assets', 'platform-art', region, `${providerSlug}-card.jpg`)
  ];
  if (region === 'tr' && providerSlug === 'crunchyroll') {
    candidates.unshift(
      path.join(ROOT, 'assets', 'platform-art', 'global', 'anime-asia-backdrop.jpg'),
      path.join(ROOT, 'assets', 'platform-art', 'global', 'anime-asia-card.jpg')
    );
  }
  for (const file of candidates) {
    try {
      return await fsp.readFile(file);
    } catch {}
  }
  return null;
}

async function discoverProviderCandidates(region, api, providerSlug, type) {
  const mediaType = normalizeType(type);
  const endpoint = mediaType === 'movie' ? '/discover/movie' : '/discover/tv';
  const language = api.getConfig?.().language || 'fr-FR';
  const params = {
    language,
    page: 1,
    include_adult: false,
    sort_by: 'popularity.desc'
  };

  if (ANIME_PROVIDERS.has(providerSlug)) {
    params.with_genres = '16';
    params.with_original_language = 'ja';
    if (mediaType === 'movie') params.region = 'JP';
  } else if (SPECIAL_VOD.has(providerSlug)) {
    if (REGION_COUNTRY[region]) params.region = REGION_COUNTRY[region];
  } else {
    let resolved = null;
    try {
      resolved = await api.resolveProvider(providerSlug, mediaType);
    } catch {}
    if (resolved?.ids?.length) {
      if (REGION_COUNTRY[region]) params.watch_region = REGION_COUNTRY[region];
      params.with_watch_providers = resolved.ids.join('|');
      params.with_watch_monetization_types = 'flatrate|free|ads';
    } else if (REGION_COUNTRY[region]) {
      params.region = REGION_COUNTRY[region];
    }
  }

  let payload = null;
  try {
    payload = await api.tmdbFetch(endpoint, params);
  } catch {
    if (params.with_watch_providers) {
      delete params.with_watch_providers;
      delete params.with_watch_monetization_types;
      delete params.watch_region;
      if (REGION_COUNTRY[region]) params.region = REGION_COUNTRY[region];
      try { payload = await api.tmdbFetch(endpoint, params); } catch {}
    }
  }
  return selectCandidates(payload?.results || [], providerSlug);
}

async function importedSources(region, api, providerSlug, type) {
  const candidates = await discoverProviderCandidates(region, api, providerSlug, type);
  const downloaded = [];
  for (const item of candidates) {
    const buffer = await downloadImage(`${IMAGE_BASE}${item.backdrop_path}`);
    if (!buffer) continue;
    downloaded.push({
      buffer,
      id: Number(item.id) || null,
      title: item.title || item.name || '',
      backdropPath: item.backdrop_path
    });
    if (downloaded.length >= 3) break;
  }

  const fallback = await loadLocalFallback(region, providerSlug);
  if (fallback && downloaded.length < 3) {
    downloaded.push({ buffer: fallback, id: null, title: 'local-fallback', backdropPath: null });
  }
  if (!downloaded.length) throw new Error(`${region}/${providerSlug}/${type}: no usable imagery`);
  while (downloaded.length < 3) downloaded.push(downloaded[downloaded.length - 1]);
  return downloaded.slice(0, 3);
}

function accentFor(api, providerSlug) {
  try {
    const title = api.platformCollectionTitle(providerSlug);
    const color = api.providerAccentColor(title);
    return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#38bdf8';
  } catch {
    return '#38bdf8';
  }
}

async function logoFor(api, providerSlug, type) {
  try {
    const asset = await api.platformLogoAsset(providerSlug, type);
    return asset?.buffer || null;
  } catch {
    return null;
  }
}

function brandLabel(api, providerSlug) {
  try {
    return String(api.platformCollectionTitle(providerSlug) || providerSlug.replace(/-/g, ' '));
  } catch {
    return providerSlug.replace(/-/g, ' ');
  }
}

function maskSvg(width, height, mode) {
  const stops = mode === 'middle'
    ? '<stop offset="0%" stop-color="white" stop-opacity="0"/><stop offset="18%" stop-color="white" stop-opacity=".92"/><stop offset="82%" stop-color="white" stop-opacity=".92"/><stop offset="100%" stop-color="white" stop-opacity="0"/>'
    : '<stop offset="0%" stop-color="white" stop-opacity=".08"/><stop offset="24%" stop-color="white" stop-opacity=".94"/><stop offset="100%" stop-color="white" stop-opacity="1"/>';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0%" stop-color="white" stop-opacity="0"/>${stops}</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`);
}

async function panel(buffer, width, height, mode) {
  const resized = await sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .modulate({ brightness: 0.96, saturation: 1.08 })
    .ensureAlpha()
    .toBuffer();
  return sharp(resized)
    .composite([{ input: maskSvg(width, height, mode), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

function overlaySvg(width, height, opts) {
  const { accent, providerLabel, category, mode, region } = opts;
  const shield = mode === 'shield';
  const titleSize = shield ? 96 : 86;
  const categoryY = shield ? 748 : 742;
  const subY = shield ? 825 : 820;
  const footerY = 866;
  const footer = shield ? 'NUVIO · CINEMATIC COLLECTION' : 'NUVIO DESKTOP · CINEMATIC';
  const logoBoxWidth = 340;

  const categoryPath = pathText(category, 108, categoryY, 1010, titleSize, { minSize: 50, fill: '#ffffff' });
  const providerPath = pathText(providerLabel.toUpperCase(), 110, subY, 790, 40, { minSize: 28, fill: accent });
  const footerPath = pathText(`${footer} · ${region.toUpperCase()}`, 110, footerY, 920, 22, { minSize: 18, fill: '#d5dbe6', opacity: .78 });

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="left" x1="0" x2="1">
        <stop offset="0%" stop-color="#02040a" stop-opacity=".90"/>
        <stop offset="36%" stop-color="#02040a" stop-opacity=".52"/>
        <stop offset="68%" stop-color="#02040a" stop-opacity=".12"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="40%" stop-color="#02040a" stop-opacity="0"/>
        <stop offset="70%" stop-color="#02040a" stop-opacity=".60"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".98"/>
      </linearGradient>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#02040a" stop-opacity=".44"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#left)"/>
    <rect width="${width}" height="${height}" fill="url(#bottom)"/>
    <rect width="${width}" height="190" fill="url(#top)"/>
    <rect x="72" y="650" width="12" height="178" rx="6" fill="${accent}"/>
    ${categoryPath}
    ${providerPath}
    ${footerPath}
    <rect x="${width - logoBoxWidth - 44}" y="34" width="${logoBoxWidth}" height="118" rx="25" fill="#02050a" fill-opacity=".82" stroke="${accent}" stroke-opacity=".86" stroke-width="4"/>
  </svg>`);
}

async function composeCover(sources, logoBuffer, opts) {
  const width = 1600;
  const height = 900;
  const base = await sharp(sources[0].buffer)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .modulate({ brightness: 0.90, saturation: 1.06 })
    .toBuffer();

  const middle = await panel(sources[1].buffer, 820, height, 'middle');
  const right = await panel(sources[2].buffer, 720, height, 'right');
  const composites = [
    { input: middle, left: 470, top: 0 },
    { input: right, left: 880, top: 0 },
    { input: overlaySvg(width, height, opts), left: 0, top: 0 }
  ];

  if (logoBuffer) {
    try {
      const logo = await sharp(logoBuffer)
        .resize({ width: 285, height: 78, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const meta = await sharp(logo).metadata();
      composites.push({
        input: logo,
        left: width - 214 - Math.round((meta.width || 285) / 2),
        top: 55
      });
    } catch {}
  } else {
    const providerFallback = centeredPathText(opts.providerLabel.toUpperCase(), 1386, 111, 300, 34, { minSize: 25, fill: '#ffffff' });
    const labelSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">${providerFallback}</svg>`);
    composites.push({ input: labelSvg, left: 0, top: 0 });
  }

  return sharp(base)
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function composeHero(sources, logoBuffer, opts) {
  const width = 1920;
  const height = 1080;
  const base = await sharp(sources[0].buffer)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .modulate({ brightness: 0.92, saturation: 1.07 })
    .toBuffer();
  const middle = await panel(sources[1].buffer, 980, height, 'middle');
  const right = await panel(sources[2].buffer, 860, height, 'right');
  const heroProviderPath = pathText(opts.providerLabel, 132, 830, 850, 76, { minSize: 48, fill: '#ffffff' });
  const heroCategoryPath = pathText(opts.category.toUpperCase(), 134, 900, 700, 36, { minSize: 28, fill: opts.accent });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" x2="1">
        <stop offset="0%" stop-color="#010208" stop-opacity=".94"/>
        <stop offset="36%" stop-color="#010208" stop-opacity=".62"/>
        <stop offset="66%" stop-color="#010208" stop-opacity=".14"/>
        <stop offset="100%" stop-color="#010208" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="58%" stop-color="#02040a" stop-opacity="0"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".76"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect width="${width}" height="${height}" fill="url(#b)"/>
    <rect x="92" y="738" width="12" height="205" rx="6" fill="${opts.accent}"/>
    ${heroProviderPath}
    ${heroCategoryPath}
  </svg>`);

  const composites = [
    { input: middle, left: 600, top: 0 },
    { input: right, left: 1080, top: 0 },
    { input: overlay, left: 0, top: 0 }
  ];
  if (logoBuffer) {
    try {
      const logo = await sharp(logoBuffer)
        .resize({ width: 400, height: 120, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      composites.push({ input: logo, left: 128, top: 115 });
    } catch {}
  }
  return sharp(base)
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function writeAtomic(file, buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(temp, buffer);
  await fsp.rename(temp, file);
}

async function providerJob(region, api, definition) {
  const providerSlug = definition.provider.slug;
  const providerLabel = brandLabel(api, providerSlug);
  const outDir = path.join(OUT_ROOT, region, providerSlug);
  await fsp.mkdir(outDir, { recursive: true });

  let firstHero = null;
  const files = [];
  const sourcesUsed = [];

  for (const category of definition.categories || []) {
    const type = normalizeType(category.type);
    const sources = await importedSources(region, api, providerSlug, type);
    const logo = await logoFor(api, providerSlug, type);
    const accent = accentFor(api, providerSlug);
    const title = categoryLabel(category, type);
    const common = { accent, providerLabel, category: title, region };

    const [shield, desktop, hero] = await Promise.all([
      composeCover(sources, logo, { ...common, mode: 'shield' }),
      composeCover(sources, logo, { ...common, mode: 'desktop' }),
      composeHero(sources, logo, common)
    ]);

    const names = {
      shield: `${type}-shield.jpg`,
      desktop: `${type}-desktop.jpg`,
      hero: `${type}-hero.jpg`
    };
    await Promise.all([
      writeAtomic(path.join(outDir, names.shield), shield),
      writeAtomic(path.join(outDir, names.desktop), desktop),
      writeAtomic(path.join(outDir, names.hero), hero)
    ]);
    if (!firstHero) firstHero = hero;
    files.push(names.shield, names.desktop, names.hero);
    sourcesUsed.push({
      type,
      imported: sources.map((source) => ({
        id: source.id,
        title: source.title,
        backdropPath: source.backdropPath
      }))
    });
  }

  if (firstHero) {
    await writeAtomic(path.join(outDir, 'hero.jpg'), firstHero);
    files.push('hero.jpg');
  }

  return {
    region,
    provider: providerSlug,
    label: providerLabel,
    files,
    sources: sourcesUsed
  };
}

async function main() {
  if (!process.env.TMDB_READ_TOKEN && !process.env.TMDB_API_KEY) {
    throw new Error('TMDB_READ_TOKEN or TMDB_API_KEY is required to generate covers');
  }

  const manifestFile = path.join(OUT_ROOT, 'manifest.json');
  if (process.env.NUVIO_FORCE_COVER_REGEN !== '1') {
    try {
      const existing = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
      if (existing?.revision === REVISION && existing?.complete === true && Number(existing?.generatedFiles || 0) > 0) {
        console.log(`Generated covers already current: ${existing.generatedFiles} files (${REVISION})`);
        return;
      }
    } catch {}
  }

  await fsp.rm(OUT_ROOT, { recursive: true, force: true });
  await fsp.mkdir(OUT_ROOT, { recursive: true });

  const jobs = [];
  for (const [region, api] of Object.entries(REGION_APIS)) {
    for (const definition of api.PLATFORM_COLLECTIONS || []) {
      jobs.push({ region, api, definition });
    }
  }

  console.log(`Generating Nuvio cinematic covers: ${jobs.length} platform parents`);
  const results = await mapLimit(jobs, 3, async (job, index) => {
    const provider = job.definition.provider.slug;
    process.stdout.write(`[${index + 1}/${jobs.length}] ${job.region}/${provider} ... `);
    try {
      const result = await providerJob(job.region, job.api, job.definition);
      console.log('ok');
      return result;
    } catch (error) {
      console.log('FAILED');
      throw error;
    }
  });

  const generatedFiles = results.reduce((sum, item) => sum + item.files.length, 0);
  const manifest = {
    revision: REVISION,
    complete: true,
    generatedAt: new Date().toISOString(),
    generatedFiles,
    platformParents: results.length,
    regions: Object.fromEntries(Object.keys(REGION_APIS).map((region) => [
      region,
      results.filter((item) => item.region === region).length
    ])),
    results
  };
  await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    revision: REVISION,
    generatedFiles,
    platformParents: results.length,
    output: path.relative(ROOT, OUT_ROOT)
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
