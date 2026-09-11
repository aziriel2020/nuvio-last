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
const PLATFORM_ART_ROOT = path.join(ROOT, 'assets', 'platform-art');
const GENRE_ART_ROOT = path.join(ROOT, 'assets', 'genre-art', 'shared');
const REVISION = 'generated-v4-original-premium';

const REGION_APIS = {
  fr: rootHandler._internals.frHandler._internals,
  global: rootHandler._internals.globalHandler._internals,
  tr: rootHandler._internals.trHandler._internals,
  us: rootHandler._internals.usHandler._internals
};

const PROVIDER_MOOD = {
  netflix: 'thriller',
  'prime-video': 'action',
  'disney-plus': 'fantasy',
  'hbo-max': 'crime',
  max: 'crime',
  'apple-tv-plus': 'science-fiction',
  'paramount-plus': 'adventure',
  'canal-plus': 'drama',
  crunchyroll: 'animation',
  'anime-asia': 'animation',
  adn: 'animation',
  arte: 'documentary',
  'france-tv': 'drama',
  'tf1-plus': 'family',
  'm6-plus': 'comedy',
  exxen: 'action-adventure',
  gain: 'thriller',
  tabii: 'history',
  tod: 'action',
  puhutv: 'drama',
  'tv-plus': 'science-fiction',
  tivibu: 'action-adventure',
  'd-smart-go': 'crime',
  's-sport-plus': 'action',
  'bi-kanal': 'news',
  'turkiye-takvim': 'news',
  mubi: 'drama',
  hulu: 'mystery',
  peacock: 'comedy',
  'vod-fr': 'action-adventure',
  'vod-global': 'adventure',
  'vod-tr': 'action',
  'vod-us': 'action-adventure'
};

const PROVIDER_SUBTITLE = {
  netflix: 'Thriller premium',
  'prime-video': 'Action grand spectacle',
  'disney-plus': 'Aventure & magie',
  'hbo-max': 'Prestige & crime',
  max: 'Prestige & crime',
  'apple-tv-plus': 'Science-fiction prestige',
  'paramount-plus': 'Grandes aventures',
  'canal-plus': 'Cinéma premium',
  crunchyroll: 'Anime intense',
  'anime-asia': 'Univers anime',
  adn: 'Animation japonaise',
  arte: 'Culture & documentaire',
  'france-tv': 'Histoires françaises',
  'tf1-plus': 'Divertissement',
  'm6-plus': 'Comédie & divertissement',
  exxen: 'Exclusivités',
  gain: 'Thriller & drama',
  tabii: 'Histoires & culture',
  tod: 'Action & sport',
  puhutv: 'Séries & cinéma',
  'tv-plus': 'Entertainment',
  tivibu: 'Cinéma & sport',
  'd-smart-go': 'Action & cinéma',
  's-sport-plus': 'Sport en grand',
  'bi-kanal': 'Actualité & événements',
  'turkiye-takvim': 'Calendrier Türkiye',
  mubi: 'Cinéma auteur',
  hulu: 'Mystère & séries',
  peacock: 'Divertissement US'
};

const GENRE_SUBTITLE = {
  action: 'Adrénaline pure',
  'action-adventure': 'Action & aventure',
  adventure: 'Des mondes à explorer',
  animation: 'Imaginer sans limites',
  comedy: 'Rire. Partager.',
  crime: 'Enquêtes & tension',
  documentary: 'Le réel en grand',
  drama: 'Émotions fortes',
  family: 'Ensemble toujours',
  fantasy: 'Royaumes & légendes',
  history: 'Le passé vivant',
  horror: 'Frissons garantis',
  kids: 'Pour les plus jeunes',
  music: 'Le son en images',
  mystery: 'L’inconnu vous attend',
  news: 'Le monde maintenant',
  reality: 'Plus vrai que nature',
  romance: 'Passion & émotion',
  'science-fiction': 'Au-delà du réel',
  'scifi-fantasy': 'Futurs & légendes',
  soap: 'Destins croisés',
  talk: 'Paroles & débats',
  thriller: 'Suspense garanti',
  'tv-movie': 'Cinéma télévision',
  war: 'Conflits & courage',
  'war-politics': 'Pouvoir & conflits',
  western: 'L’Ouest sauvage'
};

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
  return `<path d="${pathData}" fill="${options.fill || '#ffffff'}"/>`;
}

function normalizeType(value) {
  return String(value || '').toLowerCase() === 'movie' ? 'movie' : 'series';
}

function categoryLabel(category, type) {
  const raw = String(category?.title || '').trim();
  if (raw) return raw;
  return type === 'movie' ? 'Films' : 'Séries';
}

function stringHash(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function visualStyle(key, accent = '#38bdf8') {
  const hash = stringHash(key);
  return {
    hue: ((hash % 31) - 15),
    saturation: 1.02 + ((hash >>> 5) % 18) / 100,
    brightness: 0.88 + ((hash >>> 10) % 9) / 100,
    flop: Boolean((hash >>> 15) & 1),
    zoom: 1.03 + ((hash >>> 17) % 8) / 100,
    accent
  };
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function readIfExists(file) {
  try { return await fsp.readFile(file); } catch { return null; }
}

async function firstExisting(files) {
  for (const file of files) {
    const buffer = await readIfExists(file);
    if (buffer) return { buffer, file };
  }
  return null;
}

function genreArtFiles(slug) {
  const clean = safeSlug(slug);
  const aliases = {
    'sci-fi': 'science-fiction',
    scifi: 'science-fiction',
    sport: 'action',
    sports: 'action',
    anime: 'animation'
  };
  const resolved = aliases[clean] || clean;
  return {
    slug: resolved,
    backdrop: path.join(GENRE_ART_ROOT, `${resolved}-backdrop.jpg`),
    card: path.join(GENRE_ART_ROOT, `${resolved}-card.jpg`)
  };
}

async function providerSources(region, providerSlug, type) {
  const mediaType = normalizeType(type);
  const mood = PROVIDER_MOOD[providerSlug] || (mediaType === 'movie' ? 'action-adventure' : 'drama');
  const moodFiles = genreArtFiles(mood);
  const providerDir = path.join(PLATFORM_ART_ROOT, region);
  const providerBackdrop = path.join(providerDir, `${providerSlug}-backdrop.jpg`);
  const providerCard = path.join(providerDir, `${providerSlug}-card.jpg`);

  const primary = await firstExisting(mediaType === 'movie'
    ? [providerCard, providerBackdrop, moodFiles.backdrop, moodFiles.card]
    : [providerBackdrop, providerCard, moodFiles.backdrop, moodFiles.card]);
  const moodSource = await firstExisting([moodFiles.backdrop, moodFiles.card]);
  const alternateMood = await firstExisting([
    genreArtFiles(mediaType === 'movie' ? 'action-adventure' : 'mystery').backdrop,
    genreArtFiles('drama').backdrop,
    genreArtFiles('adventure').backdrop
  ]);

  if (!primary) throw new Error(`${region}/${providerSlug}: no local original art source`);
  return {
    primary: primary.buffer,
    secondary: moodSource?.buffer || primary.buffer,
    tertiary: alternateMood?.buffer || moodSource?.buffer || primary.buffer,
    sourceFiles: [primary.file, moodSource?.file, alternateMood?.file].filter(Boolean).map((file) => path.relative(ROOT, file)),
    mood
  };
}

async function genreSources(slug) {
  const files = genreArtFiles(slug);
  const primary = await firstExisting([files.backdrop, files.card, genreArtFiles('drama').backdrop]);
  const secondary = await firstExisting([files.card, files.backdrop, genreArtFiles('mystery').backdrop]);
  if (!primary) throw new Error(`genre/${slug}: no local original art source`);
  return {
    primary: primary.buffer,
    secondary: secondary?.buffer || primary.buffer,
    tertiary: primary.buffer,
    sourceFiles: [primary.file, secondary?.file].filter(Boolean).map((file) => path.relative(ROOT, file)),
    mood: files.slug
  };
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

function tintOverlay(width, height, accent, opacity = 0.12) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${accent}" fill-opacity="${opacity}"/></svg>`);
}

function fadeMask(width, height, side = 'right') {
  const reverse = side === 'left';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="${reverse ? 1 : 0}" x2="${reverse ? 0 : 1}"><stop offset="0%" stop-color="white" stop-opacity="0"/><stop offset="24%" stop-color="white" stop-opacity=".18"/><stop offset="58%" stop-color="white" stop-opacity=".78"/><stop offset="100%" stop-color="white" stop-opacity=".96"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}

async function preparedLayer(buffer, width, height, style, options = {}) {
  const zoom = options.zoom || style.zoom || 1;
  const targetW = Math.round(width * zoom);
  const targetH = Math.round(height * zoom);
  const rawHue = options.hue == null ? style.hue : options.hue;
  const hue = ((Math.round(Number(rawHue) || 0) % 360) + 360) % 360;
  let pipeline = sharp(buffer)
    .resize(targetW, targetH, { fit: 'cover', position: options.position || 'attention' })
    .extract({
      left: Math.max(0, Math.round((targetW - width) / 2)),
      top: Math.max(0, Math.round((targetH - height) / 2)),
      width,
      height
    })
    .modulate({
      brightness: options.brightness || style.brightness,
      saturation: options.saturation || style.saturation,
      hue
    });
  if (style.flop !== Boolean(options.noFlop)) pipeline = pipeline.flop();
  return pipeline.sharpen({ sigma: .65 }).ensureAlpha().toBuffer();
}

async function originalBackground(sources, width, height, style, type = 'series') {
  const base = await preparedLayer(sources.primary, width, height, style, {
    zoom: type === 'movie' ? style.zoom + .025 : style.zoom
  });
  const secondaryRaw = await preparedLayer(sources.secondary, Math.round(width * .66), height, {
    ...style,
    hue: style.hue / 2,
    saturation: Math.max(1, style.saturation - .03),
    brightness: Math.min(.97, style.brightness + .05),
    flop: !style.flop
  }, { noFlop: true, zoom: 1.06 });
  const secondary = await sharp(secondaryRaw)
    .composite([{ input: fadeMask(Math.round(width * .66), height, type === 'movie' ? 'left' : 'right'), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(base)
    .composite([
      {
        input: secondary,
        left: type === 'movie' ? 0 : width - Math.round(width * .66),
        top: 0,
        blend: 'over'
      },
      { input: tintOverlay(width, height, style.accent, .08), left: 0, top: 0, blend: 'soft-light' }
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function cardOverlaySvg(width, height, opts) {
  const { accent, providerLabel, category, subtitle, mode, showLogoBox = true } = opts;
  const shield = mode === 'shield';
  const providerSize = shield ? 50 : 36;
  const titleSize = shield ? 138 : 92;
  const subtitleSize = shield ? 48 : 34;
  const providerY = shield ? 640 : 658;
  const titleY = shield ? 765 : 758;
  const subtitleY = shield ? 846 : 824;
  const accentWidth = shield ? 18 : 12;
  const accentHeight = shield ? 244 : 185;
  const accentY = shield ? 604 : 620;
  const logoBoxWidth = shield ? 468 : 340;
  const logoBoxHeight = shield ? 164 : 118;
  const providerPath = pathText(providerLabel, 112, providerY, shield ? 930 : 820, providerSize, { minSize: shield ? 34 : 26, fill: '#ffffff' });
  const titlePath = pathText(category, 112, titleY, shield ? 1060 : 980, titleSize, { minSize: shield ? 78 : 54, fill: '#ffffff' });
  const subtitlePath = pathText(subtitle, 114, subtitleY, shield ? 970 : 850, subtitleSize, { minSize: shield ? 30 : 24, fill: '#dce5f2', opacity: .96 });

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="left" x1="0" x2="1"><stop offset="0%" stop-color="#01040a" stop-opacity=".82"/><stop offset="43%" stop-color="#01040a" stop-opacity=".38"/><stop offset="76%" stop-color="#01040a" stop-opacity=".06"/><stop offset="100%" stop-color="#01040a" stop-opacity="0"/></linearGradient>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="45%" stop-color="#01040a" stop-opacity="0"/><stop offset="72%" stop-color="#01040a" stop-opacity=".62"/><stop offset="100%" stop-color="#01040a" stop-opacity=".98"/></linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#left)"/>
    <rect width="${width}" height="${height}" fill="url(#bottom)"/>
    <rect x="${shield ? 70 : 72}" y="${accentY}" width="${accentWidth}" height="${accentHeight}" rx="${Math.ceil(accentWidth / 2)}" fill="${accent}"/>
    ${providerPath}
    ${titlePath}
    ${subtitlePath}
    ${showLogoBox ? `<rect x="${width - logoBoxWidth - (shield ? 34 : 44)}" y="${shield ? 28 : 34}" width="${logoBoxWidth}" height="${logoBoxHeight}" rx="${shield ? 30 : 25}" fill="#02050a" fill-opacity=".78" stroke="${accent}" stroke-opacity=".88" stroke-width="${shield ? 5 : 4}"/>` : ''}
    <rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="38" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="4"/>
  </svg>`);
}

async function composeCover(sources, logoBuffer, opts) {
  const width = 1600;
  const height = 900;
  const style = visualStyle(opts.identityKey, opts.accent);
  const background = await originalBackground(sources, width, height, style, opts.type);
  const composites = [{ input: cardOverlaySvg(width, height, opts), left: 0, top: 0 }];

  if (opts.showLogoBox !== false) {
    if (logoBuffer) {
      try {
        const shield = opts.mode === 'shield';
        const logoTarget = shield ? { width: 410, height: 118 } : { width: 285, height: 78 };
        const logo = await sharp(logoBuffer).resize({ ...logoTarget, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        const meta = await sharp(logo).metadata();
        const boxWidth = shield ? 468 : 340;
        const boxLeft = width - boxWidth - (shield ? 34 : 44);
        composites.push({
          input: logo,
          left: Math.round(boxLeft + (boxWidth - (meta.width || logoTarget.width)) / 2),
          top: shield ? 51 : 55
        });
      } catch {}
    } else {
      const shield = opts.mode === 'shield';
      const fallback = centeredPathText(opts.providerLabel.toUpperCase(), shield ? 1332 : 1386, shield ? 128 : 111, shield ? 410 : 300, shield ? 48 : 34, { minSize: shield ? 32 : 25, fill: '#ffffff' });
      composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">${fallback}</svg>`), left: 0, top: 0 });
    }
  }

  return sharp(background).composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function composeHero(sources, logoBuffer, opts) {
  const width = 1920;
  const height = 1080;
  const style = visualStyle(`${opts.identityKey}:hero`, opts.accent);
  const background = await originalBackground(sources, width, height, style, opts.type);
  const providerPath = pathText(opts.providerLabel, 138, 810, 980, 108, { minSize: 66, fill: '#ffffff' });
  const categoryPath = pathText(opts.category.toUpperCase(), 140, 902, 860, 52, { minSize: 36, fill: opts.accent });
  const subtitlePath = pathText(opts.subtitle, 142, 970, 850, 34, { minSize: 26, fill: '#dce5f2', opacity: .92 });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0%" stop-color="#010208" stop-opacity=".94"/><stop offset="38%" stop-color="#010208" stop-opacity=".60"/><stop offset="68%" stop-color="#010208" stop-opacity=".10"/><stop offset="100%" stop-color="#010208" stop-opacity="0"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="58%" stop-color="#02040a" stop-opacity="0"/><stop offset="100%" stop-color="#02040a" stop-opacity=".78"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/><rect width="${width}" height="${height}" fill="url(#b)"/>
    <rect x="94" y="680" width="18" height="310" rx="9" fill="${opts.accent}"/>
    ${providerPath}${categoryPath}${subtitlePath}
  </svg>`);
  const composites = [{ input: overlay, left: 0, top: 0 }];
  if (logoBuffer) {
    try {
      const logo = await sharp(logoBuffer).resize({ width: 540, height: 160, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      composites.push({ input: logo, left: 138, top: 92 });
    } catch {}
  }
  return sharp(background).composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
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
  const sourceSets = [];

  for (const category of definition.categories || []) {
    const type = normalizeType(category.type);
    const sources = await providerSources(region, providerSlug, type);
    const logo = await logoFor(api, providerSlug, type);
    const accent = accentFor(api, providerSlug);
    const categoryName = categoryLabel(category, type);
    const subtitle = PROVIDER_SUBTITLE[providerSlug] || GENRE_SUBTITLE[sources.mood] || 'Collection premium';
    const common = {
      accent,
      providerLabel,
      category: categoryName,
      subtitle,
      region,
      type,
      showLogoBox: true,
      identityKey: `service:${region}:${providerSlug}:${type}`
    };

    const [shield, desktop, hero] = await Promise.all([
      composeCover(sources, logo, { ...common, mode: 'shield' }),
      composeCover(sources, logo, { ...common, mode: 'desktop' }),
      composeHero(sources, logo, common)
    ]);
    const names = { shield: `${type}-shield.jpg`, desktop: `${type}-desktop.jpg`, hero: `${type}-hero.jpg` };
    await Promise.all([
      writeAtomic(path.join(outDir, names.shield), shield),
      writeAtomic(path.join(outDir, names.desktop), desktop),
      writeAtomic(path.join(outDir, names.hero), hero)
    ]);
    if (!firstHero) firstHero = hero;
    files.push(names.shield, names.desktop, names.hero);
    sourceSets.push({ type, mood: sources.mood, sourceFiles: sources.sourceFiles });
  }

  if (firstHero) {
    await writeAtomic(path.join(outDir, 'hero.jpg'), firstHero);
    files.push('hero.jpg');
  }

  return { region, provider: providerSlug, label: providerLabel, files, sourceMode: 'local-original-premium', sources: sourceSets };
}

function uniqueGenres(api) {
  const map = new Map();
  for (const genre of [...(api.TMDB_MOVIE_GENRES || []), ...(api.TMDB_TV_GENRES || [])]) {
    if (!genre?.slug) continue;
    map.set(genre.slug, genre);
  }
  return [...map.values()];
}

async function genreJob(region, api, genre) {
  const slug = safeSlug(genre.slug);
  const sources = await genreSources(slug);
  const outDir = path.join(OUT_ROOT, region, 'genres');
  const accent = /^#[0-9a-f]{6}$/i.test(String(genre.color || '')) ? genre.color : '#38bdf8';
  const label = String(genre.name || slug.replace(/-/g, ' '));
  const subtitle = GENRE_SUBTITLE[slug] || GENRE_SUBTITLE[sources.mood] || 'À découvrir';
  const common = {
    accent,
    providerLabel: 'Genre',
    category: label,
    subtitle,
    region,
    type: 'series',
    showLogoBox: false,
    identityKey: `genre:${region}:${slug}`
  };
  const [shield, desktop, hero] = await Promise.all([
    composeCover(sources, null, { ...common, mode: 'shield' }),
    composeCover(sources, null, { ...common, mode: 'desktop' }),
    composeHero(sources, null, common)
  ]);
  const files = {
    shield: `${slug}-shield.jpg`,
    desktop: `${slug}-desktop.jpg`,
    hero: `${slug}-hero.jpg`
  };
  await Promise.all([
    writeAtomic(path.join(outDir, files.shield), shield),
    writeAtomic(path.join(outDir, files.desktop), desktop),
    writeAtomic(path.join(outDir, files.hero), hero)
  ]);
  return { region, genre: slug, label, files: Object.values(files), sourceMode: 'local-original-premium', sourceFiles: sources.sourceFiles };
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

async function main() {
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

  const providerJobs = [];
  const genreJobs = [];
  for (const [region, api] of Object.entries(REGION_APIS)) {
    for (const definition of api.PLATFORM_COLLECTIONS || []) providerJobs.push({ region, api, definition });
    for (const genre of uniqueGenres(api)) genreJobs.push({ region, api, genre });
  }

  console.log(`Generating Nuvio Original Premium v4: ${providerJobs.length} service parents + ${genreJobs.length} unique genre identities`);
  const providerResults = await mapLimit(providerJobs, 3, async (job, index) => {
    process.stdout.write(`[service ${index + 1}/${providerJobs.length}] ${job.region}/${job.definition.provider.slug} ... `);
    const result = await providerJob(job.region, job.api, job.definition);
    console.log('ok');
    return result;
  });
  const genreResults = await mapLimit(genreJobs, 3, async (job, index) => {
    process.stdout.write(`[genre ${index + 1}/${genreJobs.length}] ${job.region}/${job.genre.slug} ... `);
    const result = await genreJob(job.region, job.api, job.genre);
    console.log('ok');
    return result;
  });

  const generatedFiles =
    providerResults.reduce((sum, item) => sum + item.files.length, 0) +
    genreResults.reduce((sum, item) => sum + item.files.length, 0);

  const manifest = {
    revision: REVISION,
    complete: true,
    generatedAt: new Date().toISOString(),
    artDirection: 'nuvio-original-premium-v4',
    backgroundPolicy: {
      tmdbBackdropDependency: false,
      uniquePerService: true,
      uniquePerGenre: true,
      uniquePerServiceMediaType: true,
      source: 'local-curated-original-art'
    },
    generatedFiles,
    platformParents: providerResults.length,
    genreIdentities: genreResults.length,
    designProfile: {
      shield: {
        target: '83-inch-tv-distance',
        layout: 'validated-model-v2',
        providerPx: 50,
        titlePx: 138,
        subtitlePx: 48,
        logoWidthPx: 410,
        logoBoxWidthPx: 468,
        accentWidthPx: 18
      },
      desktop: {
        layout: 'validated-model-v2',
        providerPx: 36,
        titlePx: 92,
        subtitlePx: 34,
        logoWidthPx: 285
      },
      hero: {
        providerPx: 108,
        categoryPx: 52,
        logoWidthPx: 540
      }
    },
    regions: Object.fromEntries(Object.keys(REGION_APIS).map((region) => [
      region,
      {
        services: providerResults.filter((item) => item.region === region).length,
        genres: genreResults.filter((item) => item.region === region).length
      }
    ])),
    results: providerResults,
    genres: genreResults
  };
  await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    revision: REVISION,
    artDirection: manifest.artDirection,
    generatedFiles,
    platformParents: providerResults.length,
    genreIdentities: genreResults.length,
    output: path.relative(ROOT, OUT_ROOT)
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
