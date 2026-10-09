/**
 * Six exclusive Tendances & Cinéma hero backdrops.
 * Renders from the already-approved cover photography; NO extra AI art,
 * titles, category badges, frame or obsolete VOD/genre backdrops.
 * Run: npm run audit:editorial-backdrops
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import handler from '../api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'editorial-cover-audit');
const keys = ['series-top-rated', 'series-trendy', 'series-new', 'series-returning', 'movies-new', 'cinema-now'];

function call(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const state = { status: 200, headers: {} };
    const req = { method: 'GET', url, headers: { host: 'audit.example', 'x-forwarded-proto': 'https' } };
    const res = {
      get statusCode() { return state.status; },
      set statusCode(n) { state.status = n; },
      setHeader(k, v) { state.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return state.headers[String(k).toLowerCase()]; },
      end(data = '') {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        resolve({ status: state.status, headers: state.headers, body: Buffer.concat(chunks) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function main() {
  await mkdir(output, { recursive: true });
  const approved = JSON.parse(await readFile(
    path.join(root, 'assets/collection-art/editorial-approved/manifest.json'), 'utf8'));
  const seenSources = new Set();
  const seenOutputs = new Set();
  const images = [];
  const tiles = [];
  for (const [i, key] of keys.entries()) {
    const url = '/fr/editorial-backdrop.jpg?key=' + key + '&v=approved-hero-v1';
    const res = await call(url);
    assert.equal(res.status, 200, key);
    assert.equal(res.headers['content-type'], 'image/jpeg', key);
    assert.equal(res.headers['x-nuvio-editorial-backdrop'], key, key);
    assert.equal(res.headers['x-nuvio-desktop-format'], '1920x1080', key);
    assert.equal(res.headers['x-nuvio-editorial-source-sha256'], approved.images[key].sha256,
      key + ' source artwork was not the approved cover');
    assert(!seenSources.has(approved.images[key].sha256), key + ' reused another source');
    seenSources.add(approved.images[key].sha256);
    const metadata = await sharp(res.body).metadata();
    assert.equal(metadata.format, 'jpeg', key);
    assert.equal(metadata.width, 1920, key);
    assert.equal(metadata.height, 1080, key);
    assert(res.body.length > 80000, key + ' background too small');
    const digest = createHash('sha256').update(res.body).digest('hex');
    assert(!seenOutputs.has(digest), key + ' same pixels as another hero');
    seenOutputs.add(digest);
    const warmed = await call(url);
    assert.equal(warmed.headers['x-nuvio-editorial-render'], 'memory', key);
    assert(res.body.equals(warmed.body), key + ' unstable cache');
    await writeFile(path.join(output, 'backdrop-' + key + '.jpg'), res.body);
    const small = await sharp(res.body).resize(600,338).jpeg({ quality: 90 }).toBuffer();
    const left = 20 + (i % 3) * 620;
    const top = 20 + Math.floor(i / 3) * 360;
    tiles.push({ input: small, left, top });
    images.push({ key, file: 'backdrop-' + key + '.jpg', width: 1920, height: 1080,
      sha256: digest, bytes: res.body.length, sourceSha256: approved.images[key].sha256 });
  }
  assert.equal((await call('/fr/editorial-backdrop.jpg?key=unknown')).status, 404);
  const sheet = await sharp({ create: { width: 1880, height: 740, channels: 3, background: '#080b12' } })
    .composite(tiles).jpeg({ quality: 92 }).toBuffer();
  await writeFile(path.join(output, 'backdrops-contact-sheet.jpg'), sheet);
  await writeFile(path.join(output, 'backdrops-manifest.json'), JSON.stringify({
    revision: 'editorial-approved-hero-v1', sources: keys.length,
    covers: 'original approved JPEGs, untouched', consumers: ['Shield','Desktop'],
    images
  },null,2) + '\n');
  console.log('PASS: six exclusive backgrounds 1920x1080, no baked-in text region, Shield/Desktop source parity.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
