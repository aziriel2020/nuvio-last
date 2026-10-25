'use strict';
const sharp = require('sharp');

// Share source photos between the Shield/desktop renders, and collapse bursts
// requesting the same card. Only successful photos/renders enter either cache.
class ByteCache {
  constructor(maxBytes, maxEntries = 512) { this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.bytes = 0; this.items = new Map(); }
  get(key) {
    const hit = this.items.get(key);
    if (!hit) return null;
    this.items.delete(key);
    if (hit.until <= Date.now()) { this.bytes -= hit.size; return null; }
    this.items.set(key, hit); return hit.value;
  }
  put(key, value, size, ttl) {
    const previous = this.items.get(key);
    if (previous) { this.bytes -= previous.size; this.items.delete(key); }
    if (size > this.maxBytes) return;
    this.items.set(key, { value, size, until: Date.now() + ttl }); this.bytes += size;
    while (this.bytes > this.maxBytes || this.items.size > this.maxEntries) {
      const oldest = this.items.keys().next().value;
      this.bytes -= this.items.get(oldest).size; this.items.delete(oldest);
    }
  }
}

function createArtworkCache({ fetcher = (...args) => fetch(...args), disk = () => globalThis.caches?.default,
  concurrency = 4, sourceBytes = 32 * 1024 * 1024, renderBytes = 64 * 1024 * 1024 } = {}) {
  const photos = new ByteCache(sourceBytes, 256), rendered = new ByteCache(renderBytes);
  const downloading = new Map(), rendering = new Map();
  function pool(limit) {
    const queue = []; let active = 0;
    return async (work) => {
      if (active >= limit) await new Promise((resolve) => queue.push(resolve)); else active++;
      try { return await work(); }
      finally { if (queue.length) queue.shift()(); else active--; }
    };
  }
  const raster = pool(concurrency), download = pool(12);
  async function photo(src) {
    const hit = photos.get(src); if (hit) return hit;
    if (downloading.has(src)) return downloading.get(src);
    const pending = download(async () => {
      const key = new Request(src);
      const cache = disk();
      let response = await cache?.match(key).catch(() => undefined);
      const cached = Boolean(response);
      if (!response) response = await fetcher(src, { signal: AbortSignal.timeout(2500),
        headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'NuvioArtwork/2' } });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Photo unavailable'); }
      const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const limit = 3.5 * 1024 * 1024;
      if (!/^image\/(jpeg|jpg|png|webp)$/.test(type) || Number(response.headers.get('content-length') || 0) > limit) {
        await response.body?.cancel(); throw new Error('Invalid photo');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > limit) throw new Error('Invalid photo size');
      const info = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
      if (!info.width || !info.height) throw new Error('Invalid photo bitmap');
      const result = { bytes, type };
      photos.put(src, result, bytes.length, 7 * 86400000);
      if (!cached && cache) await cache.put(key, new Response(bytes, { headers: {
        'content-type': type, 'cache-control': 'public, max-age=604800'
      } })).catch(() => {});
      return result;
    });
    downloading.set(src, pending);
    try { return await pending; } finally { downloading.delete(src); }
  }
  async function render(key, work) {
    const hit = rendered.get(key); if (hit) return { ...hit, cache: 'memory' };
    if (rendering.has(key)) return rendering.get(key);
    const pending = Promise.resolve().then(async () => {
      const result = await work();
      if (result.cacheable !== false) rendered.put(key, result, result.data.length, 86400000);
      return { ...result, cache: 'generated' };
    });
    rendering.set(key, pending);
    try { return await pending; } finally { rendering.delete(key); }
  }
  return { photo, render, raster };
}

module.exports = { ByteCache, createArtworkCache, artworkCache: createArtworkCache() };
