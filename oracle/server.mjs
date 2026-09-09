#!/usr/bin/env node
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../cloudflare/worker-entry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const CACHE_DIR = process.env.NUVIO_CACHE_DIR || '/var/cache/nuvio';
const CACHE_MAX_ENTRIES = Math.max(128, Number(process.env.NUVIO_CACHE_MAX_ENTRIES || 2048));
const DEFAULT_TIMEZONE = process.env.NUVIO_TIMEZONE || 'Europe/Brussels';
const MAX_RESPONSE_BYTES = Math.max(1024 * 1024, Number(process.env.NUVIO_MAX_RESPONSE_BYTES || 24 * 1024 * 1024));
const CACHE_NAMESPACE = String(process.env.NUVIO_GIT_SHA || process.env.NUVIO_CACHE_NAMESPACE || 'unversioned').trim() || 'unversioned';

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function cacheMaxAge(headers, fallback = 300) {
  const cc = String(headers.get('cache-control') || '');
  const match = cc.match(/(?:^|,|\s)max-age=(\d+)/i);
  if (!match) return fallback;
  return Math.max(1, Math.min(Number(match[1]) || fallback, 7 * 24 * 3600));
}

class FileCache {
  constructor(dir, maxEntries) {
    this.dir = dir;
    this.maxEntries = maxEntries;
    this.puts = 0;
    this.lastPrune = 0;
    this.writes = new Map();
  }

  key(input) {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    return sha(CACHE_NAMESPACE + '\n' + url);
  }

  paths(input) {
    const key = this.key(input);
    return {
      meta: path.join(this.dir, key + '.json'),
      body: path.join(this.dir, key + '.bin')
    };
  }

  async ensure() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async match(input) {
    const files = this.paths(input);
    try {
      const meta = JSON.parse(await fs.readFile(files.meta, 'utf8'));
      if (!meta?.expiresAt || meta.expiresAt <= Date.now()) {
        await Promise.allSettled([fs.unlink(files.meta), fs.unlink(files.body)]);
        return undefined;
      }
      const body = await fs.readFile(files.body);
      const headers = new Headers(meta.headers || {});
      headers.set('x-nuvio-disk-cache', 'HIT');
      return new Response(body, {
        status: meta.status || 200,
        statusText: meta.statusText || '',
        headers
      });
    } catch {
      return undefined;
    }
  }

  async put(input, response) {
    if (!response?.ok) return;

    // Serialize writes per cache key. Multiple simultaneous Nuvio requests can
    // render the same card/catalog in the same millisecond; without this guard
    // concurrent temp-file renames can race and leave a partial cache entry.
    const key = this.key(input);
    const stored = response.clone();
    const previous = this.writes.get(key) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(() => this.writeEntry(input, stored));
    this.writes.set(key, task);
    try {
      await task;
    } finally {
      if (this.writes.get(key) === task) this.writes.delete(key);
    }
  }

  async writeEntry(input, response) {
    try {
      await this.ensure();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES) return;

      const ttl = cacheMaxAge(response.headers);
      const files = this.paths(input);
      const meta = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        expiresAt: Date.now() + ttl * 1000,
        createdAt: Date.now(),
        bytes: bytes.length,
        namespace: CACHE_NAMESPACE
      };
      const suffix = '.tmp-' + process.pid + '-' + Date.now() + '-' + randomUUID();
      const bodyTmp = files.body + suffix;
      const metaTmp = files.meta + suffix;
      await fs.writeFile(bodyTmp, bytes);
      await fs.writeFile(metaTmp, JSON.stringify(meta));
      await fs.rename(bodyTmp, files.body);
      await fs.rename(metaTmp, files.meta);

      this.puts += 1;
      if (this.puts % 64 === 0 || Date.now() - this.lastPrune > 10 * 60 * 1000) {
        this.lastPrune = Date.now();
        void this.prune();
      }
    } catch (error) {
      console.warn('[oracle-cache-put]', error?.message || error);
    }
  }

  async prune() {
    try {
      await this.ensure();
      const names = (await fs.readdir(this.dir)).filter((name) => name.endsWith('.json'));
      if (names.length <= this.maxEntries) return;
      const rows = [];
      for (const name of names) {
        const full = path.join(this.dir, name);
        try {
          const stat = await fs.stat(full);
          rows.push({ name, mtime: stat.mtimeMs });
        } catch {}
      }
      rows.sort((a, b) => a.mtime - b.mtime);
      const remove = rows.slice(0, Math.max(0, rows.length - this.maxEntries));
      await Promise.allSettled(remove.flatMap(({ name }) => {
        const stem = name.slice(0, -5);
        return [
          fs.unlink(path.join(this.dir, stem + '.json')),
          fs.unlink(path.join(this.dir, stem + '.bin'))
        ];
      }));
    } catch (error) {
      console.warn('[oracle-cache-prune]', error?.message || error);
    }
  }
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function safeDistPath(urlLike) {
  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const relative = pathname.replace(/^\/+/, '');
  const resolved = path.resolve(DIST, relative);
  if (resolved !== DIST && !resolved.startsWith(DIST + path.sep)) return null;
  return resolved;
}

const assetBinding = {
  async fetch(input) {
    try {
      const request = input instanceof Request ? input : new Request(String(input));
      const file = safeDistPath(request.url);
      if (!file) return new Response('Not found', { status: 404 });
      const stat = await fs.stat(file);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const headers = new Headers({
        'content-type': mime(file),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(stat.size)
      });
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(await fs.readFile(file), { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
};

const diskCache = new FileCache(CACHE_DIR, CACHE_MAX_ENTRIES);
globalThis.caches = { default: diskCache };

function envBindings() {
  const env = { ASSETS: assetBinding };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

function publicOrigin(req) {
  const explicit = String(process.env.PUBLIC_ORIGIN || '').trim();
  if (explicit) return new URL(explicit).origin;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return forwardedProto + '://' + forwardedHost;
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
    else headers.set(key, String(value));
  }
  if (!headers.has('x-nuvio-timezone')) headers.set('x-nuvio-timezone', DEFAULT_TIMEZONE);
  return headers;
}

async function oracleHealth() {
  const memory = process.memoryUsage();
  return {
    ok: true,
    runtime: 'oracle-vm',
    node: process.version,
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    gitSha: process.env.NUVIO_GIT_SHA || null,
    publicOrigin: process.env.PUBLIC_ORIGIN || null,
    cache: { dir: CACHE_DIR, maxEntries: CACHE_MAX_ENTRIES, namespace: CACHE_NAMESPACE },
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024)
    },
    now: new Date().toISOString()
  };
}

async function handle(req, res) {
  if (req.url === '/_oracle/health' || req.url?.startsWith('/_oracle/health?')) {
    const payload = Buffer.from(JSON.stringify(await oracleHealth()));
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': payload.length,
      'access-control-allow-origin': '*',
      'x-nuvio-origin': 'oracle-vm',
      'x-nuvio-edge': 'oracle-node',
      'x-nuvio-runtime': 'oracle-vm'
    });
    return res.end(payload);
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
    const payload = Buffer.from(JSON.stringify({ error: 'Method not allowed' }));
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length });
    return res.end(payload);
  }

  try {
    const origin = publicOrigin(req);
    const requestUrl = new URL(req.url || '/', origin);
    const request = new Request(requestUrl, {
      method: req.method,
      headers: requestHeaders(req)
    });

    const pending = [];
    const ctx = {
      waitUntil(promise) {
        const safe = Promise.resolve(promise).catch((error) => console.warn('[oracle-wait-until]', error?.message || error));
        pending.push(safe);
      }
    };

    const response = await worker.fetch(request, envBindings(), ctx);
    const body = req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());

    // The same renderer is reused, but the public runtime must be truthful.
    headers['x-nuvio-origin'] = 'oracle-vm';
    headers['x-nuvio-edge'] = 'oracle-node';
    headers['x-nuvio-runtime'] = 'oracle-vm';
    headers['x-content-type-options'] = headers['x-content-type-options'] || 'nosniff';
    headers['content-length'] = String(body.length);
    delete headers['transfer-encoding'];

    res.writeHead(response.status, headers);
    res.end(body);
    void Promise.allSettled(pending);
  } catch (error) {
    console.error('[oracle-request]', req.method, req.url, error);
    const payload = Buffer.from(JSON.stringify({
      error: 'Oracle Nuvio runtime error',
      message: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined
    }));
    res.writeHead(502, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': payload.length,
      'x-nuvio-origin': 'oracle-vm',
      'x-nuvio-edge': 'oracle-node'
    });
    res.end(payload);
  }
}

await diskCache.ensure();
const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[oracle-fatal-request]', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 45_000;
server.listen(PORT, HOST, () => {
  console.log('Nuvio Oracle runtime listening on http://' + HOST + ':' + PORT);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log('Received ' + signal + ', shutting down.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
