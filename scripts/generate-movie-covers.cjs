#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { GENRES } = require('../regions/movies/src/model.cjs');
const { ROOT, REVISION, cardSvg } = require('../regions/movies/src/artwork.cjs');
const { genreCoverBuffer } = require('../regions/series/index.cjs')._internals;
const APPROVED_PHOTOS = { '28': '10759', '35': '35', '80': '80', '99': '99', '18': '18',
  '10751': '10751', '14': '10765', '36': 'history', '27': 'horror', '9648': '9648',
  '10749': 'romance', '53': 'thriller', '37': '37' };
async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const master = process.env.NUVIO_MOVIES_MASTER || path.join(ROOT, 'movies-world-master.jpg');
  if (!fs.existsSync(master)) throw new Error('Missing generated Films Monde master');
  const items = [];
  for (const genre of GENRES) {
    const output = path.join(ROOT, `${genre.id}.webp`);
    let buffer;
    if (genre.id === 'all') buffer = await sharp(master).resize(1600, 900, { fit: 'contain', background: '#06090f' }).webp({ quality: 90 }).toBuffer();
    else {
      // Retain the approved genre photography while replacing the complete UI
      // panel with movie-specific typography. Keep baked-in old labels out.
      const approved = APPROVED_PHOTOS[genre.id] && genreCoverBuffer(APPROVED_PHOTOS[genre.id]);
      const photo = genre.id === 'unclassified' ? master : path.resolve(__dirname, `../assets/genre-art/shared/${genre.slug}-card.jpg`);
      const source = approved ? sharp(approved).extract({ left: 28, top: 25, width: 590, height: 800 }) : sharp(photo);
      const bytes = await source.resize(596, 852, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer();
      const svg = cardSvg({ image: `data:image/jpeg;base64,${bytes.toString('base64')}`, title: genre.name });
      buffer = await sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer();
    }
    fs.writeFileSync(output, buffer);
    items.push({ id: genre.id, title: genre.name, file: `${genre.id}.webp`, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
  }
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify({ revision: REVISION, styleReference: 'series-covers-25-approved.zip', width: 1600, height: 900, items }, null, 2));
  console.log(`Generated ${items.length} Films Monde covers in ${ROOT}`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
