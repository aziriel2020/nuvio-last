#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { GENRES } = require('../regions/series/src/model.cjs');
const dir = path.resolve(__dirname, '../assets/series-covers');
const required = process.argv.includes('--require-complete');
const result = { installed: 0, expected: GENRES.length, missing: [], invalid: [], ready: false };
(async () => {
  for (const genre of GENRES) {
    const file = path.join(dir, genre.id + '.webp');
    if (!fs.existsSync(file)) { result.missing.push(genre.id); continue; }
    const meta = await sharp(file).metadata().catch(() => null);
    if (!meta || meta.format !== 'webp' || meta.width !== 1600 || meta.height !== 900) {
      result.invalid.push(genre.id); continue;
    }
    result.installed++;
  }
  result.ready = result.installed === result.expected;
  console.log(JSON.stringify(result));
  if (result.invalid.length || (required && !result.ready) || (result.installed && !result.ready)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
