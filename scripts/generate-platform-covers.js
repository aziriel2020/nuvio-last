#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const opentype = require('opentype.js');

const rootHandler = require('../api/index.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'assets', 'generated-covers');
const PLATFORM_ART_ROOT = path.join(ROOT, 'assets', 'platform-art');
const GENRE_ART_ROOT = path.join(ROOT, 'assets', 'genre-art', 'shared');
const APPROVED_BOARD_ROOT = path.join(ROOT, 'assets', 'approved-board');
const REVISION = 'generated-v7-approved-board-canonical-direct';

const APPROVED_BOARD_REFERENCE_SIZE = Object.freeze({ width: 1536, height: 864 });
const APPROVED_BOARD_PARTS = Object.freeze([
  'canonical.b64.00',
  'canonical.b64.01',
  'canonical.b64.02a',
  'canonical.b64.02b',
  'canonical.b64.03a',
  'canonical.b64.03b',
  'canonical.b64.04a',
  'canonical.b64.04b',
  'canonical.b64.05a',
  'canonical.b64.05b',
  'canonical.b64.06-00',
  'canonical.b64.06-01',
  'canonical.b64.06-02',
  'canonical.b64.06-03',
  'canonical.b64.06-04',
  'canonical.b64.06-05',
  'canonical.b64.06-06',
  'canonical.b64.06-07'
]);
const APPROVED_BOARD_SHA256 = '32167e94380ba826dc3e1d39a4dd6742a6df7671ad9b1bc9b38dfc2b5b7f8bef';

// Coordinates are measured from the validated board supplied by the user.
// They are scaled against the decoded canonical master at runtime, so the
// source may be stored at a different pixel density without changing the crop.
const APPROVED_BOARD_PLATFORM_CELLS = Object.freeze({
  'netflix':        { x: 11,   y: 43,  w: 294, h: 120 },
  'prime-video':    { x: 311,  y: 43,  w: 296, h: 120 },
  'disney-plus':    { x: 614,  y: 43,  w: 308, h: 120 },
  'max':            { x: 929,  y: 43,  w: 296, h: 120 },
  'apple-tv-plus':  { x: 1233, y: 44,  w: 294, h: 119 },
  'paramount-plus': { x: 11,   y: 169, w: 294, h: 117 },
  'canal-plus':     { x: 311,  y: 169, w: 296, h: 117 },
  'crunchyroll':    { x: 614,  y: 169, w: 308, h: 117 },
  'anime-asia':     { x: 929,  y: 169, w: 296, h: 117 },
  'tod':            { x: 1233, y: 169, w: 294, h: 117 },
  'tabii':          { x: 11,   y: 291, w: 294, h: 108 },
  'exxen':          { x: 312,  y: 291, w: 295, h: 108 },
  'puhutv':         { x: 614,  y: 291, w: 308, h: 108 },
  'tv-plus':        { x: 929,  y: 291, w: 296, h: 108 },
  'tivibu':         { x: 1233, y: 291, w: 295, h: 108 },
  'd-smart-go':     { x: 11,   y: 404, w: 294, h: 107 },
  's-sport-plus':   { x: 312,  y: 404, w: 295, h: 107 },
  'bein-connect':   { x: 614,  y: 404, w: 308, h: 107 },
  'blutv':          { x: 930,  y: 404, w: 295, h: 107 },
  'mubi':           { x: 1233, y: 404, w: 294, h: 107 }
});

const APPROVED_BOARD_GENRE_CELLS = Object.freeze({
  'action':          { x: 11,   y: 547, w: 252, h: 78 },
  'thriller':        { x: 268,  y: 547, w: 247, h: 78 },
  'crime':           { x: 520,  y: 547, w: 246, h: 78 },
  'science-fiction': { x: 771,  y: 547, w: 245, h: 78 },
  'fantasy':         { x: 1022, y: 547, w: 248, h: 78 },
  'horror':          { x: 1276, y: 547, w: 251, h: 78 },
  'comedy':          { x: 11,   y: 629, w: 251, h: 80 },
  'romance':         { x: 268,  y: 629, w: 247, h: 80 },
  'documentary':     { x: 521,  y: 629, w: 244, h: 80 },
  'adventure':       { x: 771,  y: 629, w: 245, h: 80 },
  'animation':       { x: 1022, y: 629, w: 248, h: 80 },
  'anime':           { x: 1276, y: 629, w: 251, h: 80 },
  'drama':           { x: 11,   y: 714, w: 252, h: 82 },
  'mystery':         { x: 267,  y: 714, w: 248, h: 82 },
  'western':         { x: 520,  y: 714, w: 246, h: 82 },
  'music':           { x: 771,  y: 714, w: 245, h: 82 },
  'sport':           { x: 1022, y: 714, w: 248, h: 82 },
  'family':          { x: 1276, y: 714, w: 251, h: 82 }
});

const PROVIDER_BOARD_KEY = Object.freeze({
  'netflix': 'netflix',
  'prime-video': 'prime-video',
  'disney-plus': 'disney-plus',
  'hbo-max': 'max',
  'max': 'max',
  'apple-tv-plus': 'apple-tv-plus',
  'paramount-plus': 'paramount-plus',
  'canal-plus': 'canal-plus',
  'crunchyroll': 'crunchyroll',
  'anime-asia': 'anime-asia',
  'tod': 'tod',
  'tabii': 'tabii',
  'exxen': 'exxen',
  'puhutv': 'puhutv',
  'tv-plus': 'tv-plus',
  'tivibu': 'tivibu',
  'd-smart-go': 'd-smart-go',
  's-sport-plus': 's-sport-plus',
  'bein-connect': 'bein-connect',
  'blutv': 'blutv',
  'mubi': 'mubi'
});

const BOARD_ACCENTS = Object.freeze({
  'netflix': '#e50914',
  'prime-video': '#00a8e1',
  'disney-plus': '#5b7cff',
  'max': '#6f67ff',
  'apple-tv-plus': '#d7e0e8',
  'paramount-plus': '#1476d4',
  'canal-plus': '#ffffff',
  'crunchyroll': '#ff6400',
  'anime-asia': '#ff4f88',
  'tod': '#f4c400',
  'tabii': '#1dd3b0',
  'exxen': '#f4d400',
  'puhutv': '#ffffff',
  'tv-plus': '#f2c800',
  'tivibu': '#4ec5ef',
  'd-smart-go': '#ff9718',
  's-sport-plus': '#44b8ff',
  'bein-connect': '#7657ff',
  'blutv': '#5bbcff',
  'mubi': '#ffffff',
  'action': '#ef4444',
  'thriller': '#2f84bf',
  'crime': '#64748b',
  'science-fiction': '#38bdf8',
  'fantasy': '#c084fc',
  'horror': '#dc2626',
  'comedy': '#22c55e',
  'romance': '#fb7185',
  'documentary': '#d6a65a',
  'adventure': '#60a5fa',
  'animation': '#8b5cf6',
  'anime': '#22d3ee',
  'drama': '#3b82f6',
  'mystery': '#6366f1',
  'western': '#d97706',
  'music': '#d946ef',
  'sport': '#38bdf8',
  'family': '#ec4899'
});

let APPROVED_BOARD_CACHE = null;

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

async function approvedBoardMaster() {
  if (APPROVED_BOARD_CACHE) return APPROVED_BOARD_CACHE;
  const chunks = await Promise.all(APPROVED_BOARD_PARTS.map((name) =>
    fsp.readFile(path.join(APPROVED_BOARD_ROOT, name), 'utf8')
  ));
  const base64 = chunks.join('').replace(/\s+/g, '');
  const buffer = Buffer.from(base64, 'base64');
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('approved-board canonical master has no dimensions');
  if (metadata.width < 1200 || metadata.height < 675) {
    throw new Error('approved-board canonical master is unexpectedly small: ' + metadata.width + 'x' + metadata.height);
  }
  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - (16 / 9)) > 0.04) {
    throw new Error('approved-board canonical master aspect ratio drifted: ' + metadata.width + 'x' + metadata.height);
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (sha256 !== APPROVED_BOARD_SHA256) {
    throw new Error('approved-board canonical master sha256 drifted: ' + sha256);
  }
  APPROVED_BOARD_CACHE = {
    buffer,
    metadata,
    sha256,
    sourceFile: 'assets/approved-board/canonical.b64.*'
  };
  return APPROVED_BOARD_CACHE;
}

async function approvedBoardCrop(kind, key) {
  const cells = kind === 'platform' ? APPROVED_BOARD_PLATFORM_CELLS : APPROVED_BOARD_GENRE_CELLS;
  const cell = cells[key];
  if (!cell) return null;
  const master = await approvedBoardMaster();
  const sx = master.metadata.width / APPROVED_BOARD_REFERENCE_SIZE.width;
  const sy = master.metadata.height / APPROVED_BOARD_REFERENCE_SIZE.height;
  const left = Math.max(0, Math.round(cell.x * sx));
  const top = Math.max(0, Math.round(cell.y * sy));
  const width = Math.min(master.metadata.width - left, Math.max(2, Math.round(cell.w * sx)));
  const height = Math.min(master.metadata.height - top, Math.max(2, Math.round(cell.h * sy)));
  const buffer = await sharp(master.buffer)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  return {
    buffer,
    sourceFile: master.sourceFile,
    sourceKind: 'approved-board-crop',
    boardExact: true,
    boardKey: key,
    boardKind: kind,
    boardRect: { left, top, width, height },
    sourceDigest: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

async function approvedBoardCardFrame(buffer, width = 1600, height = 900) {
  // The board cell itself is the canonical card. Keep every pixel visible and
  // extend only the unused 16:9 area with a soft version of the same cell.
  const background = await sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'centre', withoutEnlargement: false })
    .blur(18)
    .modulate({ brightness: 0.68, saturation: 1.04 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const foreground = await sharp(buffer)
    .resize(width, height, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false
    })
    .sharpen({ sigma: 0.45 })
    .png()
    .toBuffer();
  return sharp(background)
    .composite([{ input: foreground, left: 0, top: 0 }])
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function approvedBoardHeroFrame(source, accent) {
  const width = 1920;
  const height = 1080;
  const meta = await sharp(source.buffer).metadata();
  const inset = Math.max(1, Math.round(Math.min(meta.width || 0, meta.height || 0) * 0.012));
  let scene = source.buffer;
  if ((meta.width || 0) > inset * 2 + 10 && (meta.height || 0) > inset * 2 + 10) {
    scene = await sharp(source.buffer)
      .extract({
        left: inset,
        top: inset,
        width: meta.width - inset * 2,
        height: meta.height - inset * 2
      })
      .toBuffer();
  }
  // East anchoring intentionally removes most of the baked left-side logo/text
  // while preserving the exact character/background scene from the validated card.
  const background = await sharp(scene)
    .resize(width, height, { fit: 'cover', position: 'east', withoutEnlargement: false })
    .modulate({ brightness: 0.86, saturation: 1.04 })
    .sharpen({ sigma: 0.35 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return sharp(background)
    .composite([{ input: heroOverlay(width, height, accent), left: 0, top: 0 }])
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
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
  const boardKey = PROVIDER_BOARD_KEY[providerSlug];
  if (boardKey && APPROVED_BOARD_PLATFORM_CELLS[boardKey]) {
    const board = await approvedBoardCrop('platform', boardKey);
    return {
      ...board,
      file: null,
      derived: false,
      crossRegion: false
    };
  }

  const providerDir = path.join(PLATFORM_ART_ROOT, region);
  const card = path.join(providerDir, providerSlug + '-card.jpg');
  const source = await firstExisting([card]);
  if (source) {
    return {
      buffer: source.buffer,
      file: source.file,
      sourceFile: path.relative(ROOT, source.file),
      sourceKind: 'approved-card-local',
      boardExact: false,
      boardKey: null,
      derived: false,
      crossRegion: false,
      sourceDigest: crypto.createHash('sha256').update(source.buffer).digest('hex')
    };
  }

  if (region === 'tr' && providerSlug === 'bi-kanal') {
    const news = genreArtFiles('news').card;
    const buffer = await readIfExists(news);
    if (!buffer) throw new Error('tr/bi-kanal: dedicated derived source is missing');
    return {
      buffer,
      file: news,
      sourceFile: path.relative(ROOT, news),
      sourceKind: 'approved-derived-bi-kanal',
      boardExact: false,
      boardKey: null,
      derived: true,
      crossRegion: false,
      sourceDigest: crypto.createHash('sha256').update(buffer).digest('hex')
    };
  }

  throw new Error(region + '/' + providerSlug + ': approved platform artwork missing');
}

async function genreSource(slug) {
  const clean = safeSlug(slug);
  if (APPROVED_BOARD_GENRE_CELLS[clean]) {
    const board = await approvedBoardCrop('genre', clean);
    return {
      ...board,
      file: null,
      resolvedSlug: clean
    };
  }

  const files = genreArtFiles(clean);
  const source = await firstExisting([files.card, files.backdrop]);
  if (!source) throw new Error('genre/' + slug + ': approved genre artwork missing');
  return {
    buffer: source.buffer,
    file: source.file,
    sourceFile: path.relative(ROOT, source.file),
    sourceKind: source.file.endsWith('-card.jpg') ? 'approved-card-local' : 'fallback-backdrop',
    boardExact: false,
    boardKey: null,
    sourceDigest: crypto.createHash('sha256').update(source.buffer).digest('hex'),
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
  if (source.boardExact === true) return approvedBoardCardFrame(source.buffer, width, height);
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
  if (source.boardExact === true) return approvedBoardCardFrame(source.buffer, width, height);
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
  if (source.boardExact === true) return approvedBoardHeroFrame(source, accent);
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
      canonicalBoard: source.boardExact === true,
      boardKey: source.boardKey || null,
      sourceDigest: source.sourceDigest || null,
      derived: source.derived === true,
      crossRegion: source.crossRegion === true
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
    canonicalBoard: source.boardExact === true,
    boardKey: source.boardKey || null,
    sourceDigest: source.sourceDigest || null,
    boardRect: source.boardRect || null,
    derived: source.derived === true,
    crossRegion: source.crossRegion === true,
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
    sourceKind: source.sourceKind,
    canonicalBoard: source.boardExact === true,
    boardKey: source.boardKey || null,
    sourceDigest: source.sourceDigest || null,
    boardRect: source.boardRect || null
  };
}

async function canonicalLibraryJob() {
  const files = [];
  const platformResults = [];
  const genreResults = [];
  const platformDir = path.join(OUT_ROOT, '_canonical', 'platforms');
  const genreDir = path.join(OUT_ROOT, '_canonical', 'genres');

  for (const key of Object.keys(APPROVED_BOARD_PLATFORM_CELLS)) {
    const source = await approvedBoardCrop('platform', key);
    const accent = BOARD_ACCENTS[key] || '#38bdf8';
    const [card, hero] = await Promise.all([
      approvedBoardCardFrame(source.buffer, 1600, 900),
      approvedBoardHeroFrame(source, accent)
    ]);
    const names = [
      '_canonical/platforms/' + key + '-shield.jpg',
      '_canonical/platforms/' + key + '-desktop.jpg',
      '_canonical/platforms/' + key + '-hero.jpg'
    ];
    await Promise.all([
      writeAtomic(path.join(platformDir, key + '-shield.jpg'), card),
      writeAtomic(path.join(platformDir, key + '-desktop.jpg'), card),
      writeAtomic(path.join(platformDir, key + '-hero.jpg'), hero)
    ]);
    files.push(...names);
    platformResults.push({ key, sourceDigest: source.sourceDigest, boardRect: source.boardRect, files: names });
  }

  for (const key of Object.keys(APPROVED_BOARD_GENRE_CELLS)) {
    const source = await approvedBoardCrop('genre', key);
    const accent = BOARD_ACCENTS[key] || '#38bdf8';
    const [card, hero] = await Promise.all([
      approvedBoardCardFrame(source.buffer, 1600, 900),
      approvedBoardHeroFrame(source, accent)
    ]);
    const names = [
      '_canonical/genres/' + key + '-shield.jpg',
      '_canonical/genres/' + key + '-desktop.jpg',
      '_canonical/genres/' + key + '-hero.jpg'
    ];
    await Promise.all([
      writeAtomic(path.join(genreDir, key + '-shield.jpg'), card),
      writeAtomic(path.join(genreDir, key + '-desktop.jpg'), card),
      writeAtomic(path.join(genreDir, key + '-hero.jpg'), hero)
    ]);
    files.push(...names);
    genreResults.push({ key, sourceDigest: source.sourceDigest, boardRect: source.boardRect, files: names });
  }

  return { files, platforms: platformResults, genres: genreResults };
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

  const boardMaster = await approvedBoardMaster();
  console.log('Canonical approved board: ' + boardMaster.metadata.width + 'x' + boardMaster.metadata.height + ' ' + boardMaster.metadata.format + ' sha256=' + boardMaster.sha256.slice(0, 16));
  const canonicalLibrary = await canonicalLibraryJob();

  const providerJobs = [];
  const genreJobs = [];
  for (const [region, api] of Object.entries(REGION_APIS)) {
    for (const definition of api.PLATFORM_COLLECTIONS || []) providerJobs.push({ region, api, definition });
    for (const genre of uniqueGenres(api)) genreJobs.push({ region, genre });
  }

  console.log(`Generating Nuvio Approved Board Canonical Direct v7: ${providerJobs.length} service parents + ${genreJobs.length} genre identities`);

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
    canonicalLibrary.files.length +
    providerResults.reduce((sum, item) => sum + item.files.length, 0) +
    genreResults.reduce((sum, item) => sum + item.files.length, 0);

  const derivedSources = [
    ...providerResults.filter((item) => item.derived === true).map((item) => `${item.region}/${item.provider}`),
    ...genreResults.filter((item) => item.derived === true).map((item) => `${item.region}/genres/${item.genre}`)
  ];
  const crossRegionApprovedSources = providerResults
    .filter((item) => item.crossRegion === true)
    .map((item) => `${item.region}/${item.provider}<=${item.sourceFile}`);

  const manifest = {
    revision: REVISION,
    complete: true,
    generatedAt: new Date().toISOString(),
    artDirection: 'approved-board-canonical-direct-v7',
    visualReference: 'validated-streaming-platforms-and-genres-board',
    boardSource: {
      sourceFile: boardMaster.sourceFile,
      sha256: boardMaster.sha256,
      format: boardMaster.metadata.format,
      width: boardMaster.metadata.width,
      height: boardMaster.metadata.height,
      referenceWidth: APPROVED_BOARD_REFERENCE_SIZE.width,
      referenceHeight: APPROVED_BOARD_REFERENCE_SIZE.height,
      platformCells: Object.keys(APPROVED_BOARD_PLATFORM_CELLS).length,
      genreCells: Object.keys(APPROVED_BOARD_GENRE_CELLS).length
    },
    backgroundPolicy: {
      tmdbBackdropDependency: false,
      moodMixing: false,
      secondaryCompositing: false,
      hueMutation: false,
      horizontalMirroring: false,
      exactApprovedCardSource: true,
      uniquePerService: true,
      uniquePerGenre: true,
      source: 'canonical-approved-board-crops-with-local-approved-fallbacks',
      canonicalBoardCellsArePrimary: true,
      canonicalBoardCellPreservedInFull: true,
      heroUsesCanonicalScene: true
    },
    generatedFiles,
    platformParents: providerResults.length,
    genreIdentities: genreResults.length,
    approvedCardFallbacks: [],
    explicitDerivedSources: derivedSources,
    crossRegionApprovedSources,
    canonicalLibrary: {
      platformCount: canonicalLibrary.platforms.length,
      genreCount: canonicalLibrary.genres.length,
      files: canonicalLibrary.files,
      platforms: canonicalLibrary.platforms,
      genres: canonicalLibrary.genres
    },
    canonicalCoverage: {
      activeServiceParents: providerResults.filter((item) => item.canonicalBoard === true).map((item) => item.region + '/' + item.provider),
      activeGenreIdentities: genreResults.filter((item) => item.canonicalBoard === true).map((item) => item.region + '/genres/' + item.genre)
    },
    designProfile: {
      shield: {
        target: '83-inch-tv-distance',
        layout: 'approved-board-platform-card',
        canonicalBoardCrop: true,
        canonicalCellFit: 'contain-on-self-derived-blur',
        mediaLabelPx: 62,
        logoWidthPx: 560,
        borderPx: 5
      },
      desktop: {
        layout: 'approved-board-platform-card',
        canonicalBoardCrop: true,
        canonicalCellFit: 'contain-on-self-derived-blur',
        mediaLabelPx: 50,
        logoWidthPx: 480,
        borderPx: 5
      },
      genres: {
        layout: 'approved-board-genre-card',
        canonicalBoardCrop: true,
        shieldTitlePx: 76,
        desktopTitlePx: 60
      },
      hero: {
        layout: 'approved-card-scene-only',
        canonicalSceneCrop: 'east-cover',
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
    crossRegionApprovedSources,
    output: path.relative(ROOT, OUT_ROOT)
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
