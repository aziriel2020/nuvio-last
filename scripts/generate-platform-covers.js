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
const REVISION = 'generated-v5-approved-board-exact';

const REGION_APIS = {
  fr: rootHandler._internals.frHandler._internals,
  global: rootHandler._internals.globalHandler._internals,
  tr: rootHandler._internals.trHandler._internals,
  us: rootHandler._internals.usHandler._internals
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
  return `<path d="${pathData}" fill="${options.fill || '#ffffff'}" opacity="${options.opacity == null ? 1 : Number(options.opacity)}"/>`;
}

function centeredPathText(text, centerX, baselineY, maxWidth, preferredSize, options = {}) {
  const fitted = fitText(text, maxWidth, preferredSize, options.minSize || 20);
  if (!fitted.text) return '';
  const font = boldFont();
  const width = font.getAdvanceWidth(fitted.text, fitted.size, { kerning: true });
  const pathData = font.getPath(fitted.text, centerX - width / 2, baselineY, fitted.size, { kerning: true }).toPathData(2);
  return `<path d="${pathData}" fill="${options.fill || '#ffffff'}" opacity="${options.opacity == null ? 1 : Number(options.opacity)}"/>`;
}

function safeSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeType(value) {
  return String(value || '').toLowerCase() === 'movie' ? 'movie' : 'series';
}

function mediaLabel(type) {
  return normalizeType(type) === 'movie' ? 'Films' : 'Séries';
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
    card: path.join(GENRE_ART_ROOT, `${resolved}-card.jpg`),
    backdrop: path.join(GENRE_ART_ROOT, `${resolved}-backdrop.jpg`)
  };
}

async function providerSource(region, providerSlug) {
  const providerDir = path.join(PLATFORM_ART_ROOT, region);
  const card = path.join(providerDir, `${providerSlug}-card.jpg`);
  const source = await firstExisting([card]);
  if (source) {
    return {
      buffer: source.buffer,
      file: source.file,
      sourceFile: path.relative(ROOT, source.file),
      sourceKind: 'approved-card',
      derived: false
    };
  }

  // Bi Kanal is the only active service absent from the validated board/source set.
  // Give it one explicit, deterministic local visual instead of silently falling
  // back to a random provider/backdrop or changing any approved service artwork.
  if (region === 'tr' && providerSlug === 'bi-kanal') {
    const news = genreArtFiles('news').card;
    const buffer = await readIfExists(news);
    if (!buffer) throw new Error('tr/bi-kanal: dedicated derived source is missing');
    return {
      buffer,
      file: news,
      sourceFile: path.relative(ROOT, news),
      sourceKind: 'approved-derived-bi-kanal',
      derived: true
    };
  }

  throw new Error(`${region}/${providerSlug}: approved platform *-card.jpg artwork missing`);
}

async function genreSource(slug) {
  const files = genreArtFiles(slug);
  const source = await firstExisting([files.card, files.backdrop]);
  if (!source) throw new Error(`genre/${slug}: approved genre artwork missing`);
  return {
    buffer: source.buffer,
    file: source.file,
    sourceFile: path.relative(ROOT, source.file),
    sourceKind: source.file.endsWith('-card.jpg') ? 'approved-card' : 'fallback-backdrop',
    resolvedSlug: files.slug
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

async function approvedBackground(buffer, width, height, { hero = false, derived = false } = {}) {
  // IMPORTANT: no mood blending, no hue shift, no mirroring, no generated secondary layer.
  // The approved *-card.jpg is the visual truth shown in the validated board.
  // The one Bi Kanal source absent from that board gets a fixed crop only.
  const pipeline = sharp(buffer).resize(width, height, {
    fit: 'cover',
    position: hero ? 'attention' : (derived ? 'east' : 'centre'),
    withoutEnlargement: false
  });
  if (derived) pipeline.sharpen({ sigma: 0.7 });
  else pipeline.sharpen({ sigma: 0.35 });
  return pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}

function serviceCardOverlay(width, height, opts) {
  const shield = opts.mode === 'shield';
  const labelSize = shield ? 62 : 50;
  const label = pathText(opts.mediaLabel, 78, height - 58, 650, labelSize, {
    minSize: shield ? 46 : 38,
    fill: '#ffffff'
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="48%" stop-color="#02040a" stop-opacity="0"/>
        <stop offset="76%" stop-color="#02040a" stop-opacity=".42"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".78"/>
      </linearGradient>
      <linearGradient id="left" x1="0" x2="1">
        <stop offset="0%" stop-color="#02040a" stop-opacity=".38"/>
        <stop offset="38%" stop-color="#02040a" stop-opacity=".08"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bottom)"/>
    <rect width="${width}" height="${height}" fill="url(#left)"/>
    ${label}
    <rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="32" fill="none" stroke="${opts.accent}" stroke-opacity=".88" stroke-width="5"/>
  </svg>`);
}

function genreCardOverlay(width, height, opts) {
  const shield = opts.mode === 'shield';
  const title = pathText(opts.label, 72, height - 58, width - 150, shield ? 76 : 60, {
    minSize: shield ? 52 : 44,
    fill: '#ffffff'
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="48%" stop-color="#02040a" stop-opacity="0"/>
        <stop offset="77%" stop-color="#02040a" stop-opacity=".48"/>
        <stop offset="100%" stop-color="#02040a" stop-opacity=".82"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bottom)"/>
    ${title}
    <rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="30" fill="none" stroke="#dce5f2" stroke-opacity=".46" stroke-width="4"/>
  </svg>`);
}

async function serviceCover(source, logoBuffer, opts) {
  const width = 1600;
  const height = 900;
  const background = await approvedBackground(source.buffer, width, height, { derived: source.derived === true });
  const composites = [{ input: serviceCardOverlay(width, height, opts), left: 0, top: 0 }];

  if (logoBuffer) {
    try {
      const shield = opts.mode === 'shield';
      const target = shield ? { width: 560, height: 205 } : { width: 480, height: 176 };
      const logo = await sharp(logoBuffer)
        .resize({ ...target, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      composites.push({ input: logo, left: 74, top: shield ? 66 : 72 });
    } catch {}
  } else {
    const fallback = pathText(opts.providerLabel.toUpperCase(), 76, 182, 700, 92, { minSize: 54, fill: '#ffffff' });
    composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">${fallback}</svg>`), left: 0, top: 0 });
  }

  return sharp(background)
    .composite(composites)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function genreCover(source, opts) {
  const width = 1600;
  const height = 900;
  const background = await approvedBackground(source.buffer, width, height);
  return sharp(background)
    .composite([{ input: genreCardOverlay(width, height, opts), left: 0, top: 0 }])
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function heroOverlay(width, height, accent) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="left" x1="0" x2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity=".96"/>
        <stop offset="28%" stop-color="#000000" stop-opacity=".82"/>
        <stop offset="48%" stop-color="#000000" stop-opacity=".48"/>
        <stop offset="66%" stop-color="#000000" stop-opacity=".13"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="63%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity=".46"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#left)"/>
    <rect width="${width}" height="${height}" fill="url(#bottom)"/>
    <rect x="0" y="0" width="8" height="${height}" fill="${accent}" fill-opacity=".74"/>
  </svg>`);
}

async function approvedHero(source, accent) {
  const width = 1920;
  const height = 1080;
  const background = await approvedBackground(source.buffer, width, height, { hero: true, derived: source.derived === true });
  return sharp(background)
    .composite([{ input: heroOverlay(width, height, accent), left: 0, top: 0 }])
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
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
  const accent = accentFor(api, providerSlug);
  const source = await providerSource(region, providerSlug);
  const outDir = path.join(OUT_ROOT, region, providerSlug);
  await fsp.mkdir(outDir, { recursive: true });

  const files = [];
  const sourceSets = [];
  let sharedHero = null;

  for (const category of definition.categories || []) {
    const type = normalizeType(category.type);
    const logo = await logoFor(api, providerSlug, type);
    const common = {
      accent,
      providerLabel,
      mediaLabel: mediaLabel(type),
      type
    };
    const [shield, desktop] = await Promise.all([
      serviceCover(source, logo, { ...common, mode: 'shield' }),
      serviceCover(source, logo, { ...common, mode: 'desktop' })
    ]);
    if (!sharedHero) sharedHero = await approvedHero(source, accent);

    const names = {
      shield: `${type}-shield.jpg`,
      desktop: `${type}-desktop.jpg`,
      hero: `${type}-hero.jpg`
    };
    await Promise.all([
      writeAtomic(path.join(outDir, names.shield), shield),
      writeAtomic(path.join(outDir, names.desktop), desktop),
      writeAtomic(path.join(outDir, names.hero), sharedHero)
    ]);
    files.push(names.shield, names.desktop, names.hero);
    sourceSets.push({
      type,
      sourceFile: source.sourceFile,
      sourceKind: source.sourceKind,
      derived: source.derived === true
    });
  }

  if (sharedHero) {
    await writeAtomic(path.join(outDir, 'hero.jpg'), sharedHero);
    files.push('hero.jpg');
  }

  return {
    region,
    provider: providerSlug,
    label: providerLabel,
    files,
    sourceMode: 'approved-board-exact',
    sourceFile: source.sourceFile,
    sourceKind: source.sourceKind,
    derived: source.derived === true,
    sources: sourceSets
  };
}

function uniqueGenres(api) {
  const map = new Map();
  for (const genre of [...(api.TMDB_MOVIE_GENRES || []), ...(api.TMDB_TV_GENRES || [])]) {
    if (!genre?.slug) continue;
    map.set(genre.slug, genre);
  }
  return [...map.values()];
}

async function genreJob(region, genre) {
  const slug = safeSlug(genre.slug);
  const source = await genreSource(slug);
  const outDir = path.join(OUT_ROOT, region, 'genres');
  const accent = /^#[0-9a-f]{6}$/i.test(String(genre.color || '')) ? genre.color : '#38bdf8';
  const label = String(genre.name || slug.replace(/-/g, ' '));

  const [shield, desktop, hero] = await Promise.all([
    genreCover(source, { mode: 'shield', label, accent }),
    genreCover(source, { mode: 'desktop', label, accent }),
    approvedHero(source, accent)
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

  return {
    region,
    genre: slug,
    label,
    files: Object.values(files),
    sourceMode: 'approved-board-exact',
    sourceFile: source.sourceFile,
    sourceKind: source.sourceKind
  };
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
    for (const genre of uniqueGenres(api)) genreJobs.push({ region, genre });
  }

  console.log(`Generating Nuvio Approved Board Exact v5: ${providerJobs.length} service parents + ${genreJobs.length} genre identities`);

  const providerResults = await mapLimit(providerJobs, 3, async (job, index) => {
    process.stdout.write(`[service ${index + 1}/${providerJobs.length}] ${job.region}/${job.definition.provider.slug} ... `);
    const result = await providerJob(job.region, job.api, job.definition);
    console.log('ok');
    return result;
  });

  const genreResults = await mapLimit(genreJobs, 3, async (job, index) => {
    process.stdout.write(`[genre ${index + 1}/${genreJobs.length}] ${job.region}/${job.genre.slug} ... `);
    const result = await genreJob(job.region, job.genre);
    console.log('ok');
    return result;
  });

  const generatedFiles =
    providerResults.reduce((sum, item) => sum + item.files.length, 0) +
    genreResults.reduce((sum, item) => sum + item.files.length, 0);

  const derivedSources = [
    ...providerResults.filter((item) => item.derived === true).map((item) => `${item.region}/${item.provider}`),
    ...genreResults.filter((item) => item.derived === true).map((item) => `${item.region}/genres/${item.genre}`)
  ];

  const manifest = {
    revision: REVISION,
    complete: true,
    generatedAt: new Date().toISOString(),
    artDirection: 'approved-board-exact-v5',
    visualReference: 'validated-streaming-platforms-and-genres-board',
    backgroundPolicy: {
      tmdbBackdropDependency: false,
      moodMixing: false,
      secondaryCompositing: false,
      hueMutation: false,
      horizontalMirroring: false,
      exactApprovedCardSource: true,
      uniquePerService: true,
      uniquePerGenre: true,
      source: 'repository-platform-card-and-genre-card'
    },
    generatedFiles,
    platformParents: providerResults.length,
    genreIdentities: genreResults.length,
    approvedCardFallbacks: [],
    explicitDerivedSources: derivedSources,
    designProfile: {
      shield: {
        target: '83-inch-tv-distance',
        layout: 'approved-board-platform-card',
        mediaLabelPx: 62,
        logoWidthPx: 560,
        borderPx: 5
      },
      desktop: {
        layout: 'approved-board-platform-card',
        mediaLabelPx: 50,
        logoWidthPx: 480,
        borderPx: 5
      },
      genres: {
        layout: 'approved-board-genre-card',
        shieldTitlePx: 76,
        desktopTitlePx: 60
      },
      hero: {
        layout: 'approved-card-scene-only',
        leftBlackStartOpacity: 0.96,
        noGeneratedCharacters: true,
        noGeneratedSecondaryScene: true
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
    approvedCardFallbacks: 0,
    explicitDerivedSources: derivedSources,
    output: path.relative(ROOT, OUT_ROOT)
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
