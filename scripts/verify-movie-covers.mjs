#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { GENRES } = require('../regions/movies/src/model.cjs');
const { ROOT, REVISION, genreBytes } = require('../regions/movies/src/artwork.cjs');
const manifest = JSON.parse(fs.readFileSync(`${ROOT}/manifest.json`, 'utf8'));
if (manifest.revision !== REVISION) throw new Error('Movie artwork revision mismatch');
for (const genre of GENRES) {
  const bytes = genreBytes(genre.id);
  if (!bytes) throw new Error(`Missing film cover ${genre.id}`);
  const info = await sharp(bytes).metadata();
  if (info.width !== 1600 || info.height !== 900 || info.format !== 'webp') throw new Error(`Invalid film cover ${genre.id}`);
  const expected = manifest.items.find((item) => item.id === genre.id);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected?.sha256) throw new Error(`Movie artwork checksum mismatch ${genre.id}`);
}
console.log(`Verified ${GENRES.length} Films Monde covers: 1600×900 WebP, matching artwork revision and checksums.`);
