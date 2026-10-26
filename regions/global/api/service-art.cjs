'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '../../../assets/collection-art/anime-jpkr-night-b-20261026');
const manifest = require(path.join(root, 'manifest.json'));
const cache = new Map();
const has = key => Object.hasOwn(manifest.images, key);

function artwork(key, variant) {
  if (!has(key) || !['series', 'films', 'backdrop'].includes(variant) || !manifest.images[key][variant])
    throw new Error('Unknown approved Global service artwork');
  const cacheKey = key + ':' + variant;
  const hit = cache.get(cacheKey);
  if (hit) return { ...hit, cacheHit:true };
  const expected = manifest.images[key][variant];
  const data = fs.readFileSync(path.join(root, expected.file));
  const sourceSha256 = createHash('sha256').update(data).digest('hex');
  if (data.length !== expected.bytes || sourceSha256 !== expected.sha256)
    throw new Error('Approved Global service artwork checksum mismatch');
  const entry = { data, sourceSha256, width:expected.width, height:expected.height };
  cache.set(cacheKey, entry);
  return { ...entry, cacheHit:false };
}

module.exports = { root, manifest, has, artwork };
