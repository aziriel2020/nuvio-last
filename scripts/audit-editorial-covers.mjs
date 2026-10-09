/**
 * Render and visually audit all six Nuvio Tendances & Cinéma cards.
 * No API key, network access, production service, or image generation required.
 * Run: npm run audit:editorial-covers
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import handler from '../api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'editorial-cover-audit');
const cards = [
  ['series-top-rated', 'Séries les mieux notées'],
  ['series-trendy', 'Séries les plus trendy'],
  ['series-new', 'Nouvelles séries'],
  ['series-returning', 'Séries renouvelées'],
  ['movies-new', 'Nouveaux films'],
  ['cinema-now', 'Films au cinéma actuellement'],
];

function requestCard(key) {
  return new Promise((resolve, reject) => {
    const response = { statusCode: 200, headers: {}, chunks: [] };
    const req = {
      method: 'GET',
      url: '/fr/editorial-cover.jpg?key=' + encodeURIComponent(key),
      headers: { host: 'editorial-audit.invalid', 'x-forwarded-proto': 'https' },
    };
    const res = {
      get statusCode() { return response.statusCode; },
      set statusCode(value) { response.statusCode = value; },
      setHeader(name, value) { response.headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return response.headers[String(name).toLowerCase()]; },
      end(body = '') {
        if (body) response.chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
        resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(response.chunks) });
      },
    };
    Promise.resolve().then(() => handler(req, res)).catch(reject);
  });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function main() {
  await mkdir(out, { recursive: true });
  const approved = JSON.parse(await readFile(
    path.join(root, 'assets/collection-art/editorial-approved/manifest.json'), 'utf8'));
  check(approved.revision === 'editorial-approved-art-v1-2026-10-09',
    'Approved art manifest revision does not match');
  check(approved.renderer === 'precomposed-jpeg-direct',
    'Approved artwork must be served without an additional overlay');
  check(Object.keys(approved.images).length === cards.length,
    'Approved manifest must contain exactly six covers');
  const checks = [];
  const composites = [];
  const digests = new Set();
  const sourceDigests = new Set();
  const sheet = { cellWidth: 600, cellHeight: 338, margin: 30, gap: 30, labelHeight: 52 };
  const width = 3 * sheet.cellWidth + 4 * sheet.gap;
  const height = 2 * (sheet.cellHeight + sheet.labelHeight) + 3 * sheet.gap;

  for (const [index, [key, title]] of cards.entries()) {
    const url = '/fr/editorial-cover.jpg?key=' + key + '&v=tv-readable-v4';
    const first = await requestCard(key);
    check(first.statusCode === 200, key + ': expected HTTP 200, got ' + first.statusCode);
    check(first.headers['content-type']?.includes('image/jpeg'), key + ': not JPEG');
    check(first.headers['x-nuvio-editorial-cover'] === key, key + ': wrong cover route');
    check(first.headers['x-nuvio-editorial-style'] === 'tv-readable-v4', key + ': missing TV-readable title revision');
    check(first.body.length > 100000, key + ': cover too small / possibly placeholder');
    check(first.body[0] === 0xff && first.body[1] === 0xd8, key + ': wrong JPEG signature');

    const metadata = await sharp(first.body).metadata();
    check(metadata.format === 'jpeg' && metadata.width === 1600 && metadata.height === 900,
      key + ': expected 1600x900 JPEG');
    const corner = await sharp(first.body).extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha().raw().toBuffer();
    check(Math.max(...corner) <= 28, key + ': Netflix rounded frame corner missing');
    const digest = createHash('sha256').update(first.body).digest('hex');
    check(!digests.has(digest), key + ': duplicated finished card');
    digests.add(digest);
    const sourceSha256 = first.headers['x-nuvio-editorial-source-sha256'];
    check(/^[a-f0-9]{64}$/.test(sourceSha256 || ''), key + ': missing source SHA-256');
    check(!sourceDigests.has(sourceSha256), key + ': reused the same underlying artwork');
    sourceDigests.add(sourceSha256);
    const locked = approved.images[key];
    check(locked && locked.sha256 === sourceSha256, key + ': approved visual source has changed');
    const original = await readFile(path.join(root, 'assets/collection-art/editorial-approved', locked.file));
    check(locked.bytes === original.length, key + ': approved source file size changed');
    check(locked.sha256 === createHash('sha256').update(original).digest('hex'),
      key + ': approved source JPEG mutated');
    check(digest !== locked.sha256, key + ': TV cover still uses unreadable baked-in lettering');

    const second = await requestCard(key);
    check(second.statusCode === 200 && second.headers['x-nuvio-editorial-render'] === 'memory',
      key + ': second render was not cached');
    check(second.body.equals(first.body), key + ': second render changed bytes');
    await writeFile(path.join(out, key + '.jpg'), first.body);

    const col = index % 3;
    const row = Math.floor(index / 3);
    const left = sheet.gap + col * (sheet.cellWidth + sheet.gap);
    const top = sheet.gap + row * (sheet.cellHeight + sheet.labelHeight + sheet.gap);
    const thumb = await sharp(first.body).resize(sheet.cellWidth, sheet.cellHeight, { fit: 'fill' })
      .jpeg({ quality: 90 }).toBuffer();
    composites.push({ input: thumb, left, top });
    const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="52">' +
      '<text x="3" y="38" fill="#f3f4f6" font-size="26" font-weight="700" font-family="DejaVu Sans,Arial,sans-serif">' +
      xmlEscape(title) + '</text></svg>');
    composites.push({ input: label, left, top: top + sheet.cellHeight });

    checks.push({ key, title, url, width: metadata.width, height: metadata.height,
      size: first.body.length, sha256: digest, sourceSha256, roundedFrame: true, tvReadableTitle: true, warmCache: true });
  }

  await sharp({ create: { width, height, channels: 3, background: '#080b12' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(out, 'contact-sheet.jpg'));
  const result = {
    revision: 'tv-readable-v4',
    checked: cards.length,
    region: 'fr',
    consumers: ['Shield', 'Desktop'],
    identicalSecondRender: true,
    checks,
  };
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: six TV-legible short titles, approved sources unchanged, rounded corners, 1600x900 JPEG and deterministic cached renders.');
  console.log('Preview: editorial-cover-audit/contact-sheet.jpg');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
