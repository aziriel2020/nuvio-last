#!/usr/bin/env node
'use strict';
const sharp = require('sharp');
const { GENRES } = require('../regions/series/src/model.cjs');
const { genreCoverProgress, genreCoverBuffer } = require('../regions/series/index.cjs')._internals;
const required = process.argv.includes('--require-complete');
const result = { installed: 0, expected: GENRES.length, missing: [], invalid: [], ready: false };
(async () => {
  for (const genre of GENRES) {
    const bytes = genreCoverBuffer(genre.id);
    if (!bytes) { result.missing.push(genre.id); continue; }
    const meta = await sharp(bytes).metadata().catch(() => null);
    if (!meta || meta.format !== 'webp' || meta.width !== 1600 || meta.height !== 900) {
      result.invalid.push(genre.id); continue;
    }
    result.installed++;
  }
  result.ready = result.installed === result.expected;
  const probe = genreCoverProgress();
  if (probe.loaded !== result.installed + result.invalid.length) throw new Error('Artwork count mismatch');
  console.log(JSON.stringify(result));
  if (result.invalid.length || (required && !result.ready) || (result.installed && !result.ready)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
