#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const MASTER_INDEX = require('./individual-master-index.js');

const ROOT = path.resolve(__dirname, '..');
const PACK_ROOT = path.join(ROOT, 'assets', 'collection-masters', 'pack');
const MATERIALIZED = path.join(ROOT, 'assets', 'collection-masters', 'materialized');
const GENERATED = path.join(ROOT, 'assets', 'generated-covers');
const PREVIEW = path.join(ROOT, 'artifacts', 'individual-assets-preview');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function meta(file) {
  const value = await sharp(file).metadata();
  return { width: value.width, height: value.height, format: value.format };
}

async function contactSheet(files, outFile, title) {
  const thumbW = 400;
  const thumbH = 225;
  const cols = 4;
  const rows = Math.ceil(files.length / cols);
  const headerH = 64;
  const width = thumbW * cols;
  const height = headerH + rows * thumbH;
  const composites = [];
  for (let i = 0; i < files.length; i++) {
    const image = await sharp(files[i].file).resize(thumbW, thumbH, { fit: 'contain', background: '#000' }).jpeg({ quality: 90 }).toBuffer();
    composites.push({ input: image, left: (i % cols) * thumbW, top: headerH + Math.floor(i / cols) * thumbH });
  }
  const safe = String(title).replace(/[<>&]/g, '');
  const header = Buffer.from('<svg width="' + width + '" height="' + headerH + '" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#020817"/><text x="24" y="43" font-size="28" fill="#fff" font-family="Arial, sans-serif">' + safe + '</text></svg>');
  composites.push({ input: header, left: 0, top: 0 });
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#020817' } }).composite(composites).jpeg({ quality: 92 }).toFile(outFile);
}

async function main() {
  const chunks = fs.readdirSync(PACK_ROOT).filter((name) => /^pack\.b64\.\d+$/.test(name)).sort();
  assert(chunks.length === MASTER_INDEX.packChunks, 'Expected ' + MASTER_INDEX.packChunks + ' pack chunks, got ' + chunks.length);
  chunks.forEach((name, i) => assert(name === 'pack.b64.' + String(i).padStart(2, '0'), 'Chunk sequence mismatch at ' + i + ': ' + name));
  const encoded = chunks.map((name) => fs.readFileSync(path.join(PACK_ROOT, name), 'utf8').trim()).join('');
  const pack = Buffer.from(encoded, 'base64');
  assert(sha256(pack) === MASTER_INDEX.packSha256, 'Master pack SHA mismatch');

  const platformEntries = MASTER_INDEX.entries.filter((x) => x.kind === 'platforms');
  const genreEntries = MASTER_INDEX.entries.filter((x) => x.kind === 'genres');
  assert(platformEntries.length === 20, 'Expected 20 platform masters');
  assert(genreEntries.length === 18, 'Expected 18 genre masters');

  const cardPreview = [];
  const bgPreview = [];

  for (const entry of MASTER_INDEX.entries) {
    const master = path.join(MATERIALIZED, entry.kind, entry.key + '.avif');
    assert(fs.existsSync(master), 'Missing materialized master ' + master);
    const masterBuffer = fs.readFileSync(master);
    assert(sha256(masterBuffer) === entry.sha256, 'Materialized SHA mismatch for ' + entry.kind + '/' + entry.key);
    const mm = await meta(master);
    assert(mm.width === 1600 && mm.height === 900, 'Master dimension mismatch for ' + entry.kind + '/' + entry.key + ': ' + mm.width + 'x' + mm.height);

    const base = path.join(GENERATED, '_canonical', entry.kind);
    const shield = path.join(base, entry.key + '-shield.jpg');
    const desktop = path.join(base, entry.key + '-desktop.jpg');
    const hero = path.join(base, entry.key + '-hero.jpg');
    for (const file of [shield, desktop, hero]) assert(fs.existsSync(file), 'Missing canonical derivative ' + file);

    const sm = await meta(shield);
    const dm = await meta(desktop);
    const hm = await meta(hero);
    assert(sm.width === 1600 && sm.height === 900, 'Shield must be exactly 1600x900: ' + shield);
    assert(dm.width === 1600 && dm.height === 900, 'Desktop must be exactly 1600x900: ' + desktop);
    assert(hm.width === 3840 && hm.height === 2160, 'Background/hero must be exactly 3840x2160: ' + hero);
    assert(sm.width > sm.height, 'Shield must be landscape: ' + shield);
    cardPreview.push({ key: entry.kind + '/' + entry.key, file: shield });
    bgPreview.push({ key: entry.kind + '/' + entry.key, file: hero });
  }

  const manifestPath = path.join(GENERATED, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.revision === 'generated-v8-individual-hq-lots', 'Unexpected generated cover revision: ' + manifest.revision);
  assert(manifest.artDirection === 'individual-hq-lots-no-crop-v8', 'Unexpected art direction');
  assert(manifest.masterSource?.platformMasters === 20, 'Manifest platform count mismatch');
  assert(manifest.masterSource?.genreMasters === 18, 'Manifest genre count mismatch');
  assert(manifest.masterSource?.backgroundWidth === 3840 && manifest.masterSource?.backgroundHeight === 2160, 'Manifest hero dimensions mismatch');
  assert(manifest.backgroundPolicy?.individualMastersArePrimary === true, 'Individual masters are not primary');
  assert(manifest.backgroundPolicy?.tmdbBackdropDependency === false, 'TMDb backdrop dependency must remain disabled');

  const apiText = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8');
  assert(apiText.includes("generated-v8-individual-hq-lots"), 'API is not pinned to v8 individual masters');
  assert(!apiText.includes("generated-v7-approved-board-canonical-direct"), 'Legacy v7 revision remains active in API');

  await fs.promises.rm(PREVIEW, { recursive: true, force: true });
  await contactSheet(cardPreview.filter((x) => x.key.startsWith('platforms/')), path.join(PREVIEW, 'platforms-shield.jpg'), '20 platform masters — Shield 1600x900');
  await contactSheet(cardPreview.filter((x) => x.key.startsWith('genres/')), path.join(PREVIEW, 'genres-shield.jpg'), '18 genre masters — Shield 1600x900');
  await contactSheet(bgPreview.slice(0, 20), path.join(PREVIEW, 'backgrounds-sample.jpg'), 'HQ backgrounds — 3840x2160 no destructive crop');

  console.log(JSON.stringify({
    ok: true,
    revision: manifest.revision,
    packSha256: MASTER_INDEX.packSha256,
    platformMasters: platformEntries.length,
    genreMasters: genreEntries.length,
    cardDimensions: '1600x900',
    heroDimensions: '3840x2160',
    shieldLandscape: true,
    destructiveCrop: false,
    preview: path.relative(ROOT, PREVIEW)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
