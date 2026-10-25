import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import router from '../runtime/router.mjs';

test('temporary photo fallback is not cached by the runtime, and the same URL recovers', async (t) => {
  const bytes = await sharp({ create: { width: 80, height: 45, channels: 3, background: '#9a6330' } }).jpeg().toBuffer();
  let up = false, calls = 0; const entries = new Map(), tasks = [];
  const previous = globalThis.caches;
  globalThis.caches = { default: { match: async (r) => entries.get(r.url)?.clone(), put: async (r, v) => { entries.set(r.url, v.clone()); } } };
  t.after(() => { globalThis.caches = previous; });
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; return up ? new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }) : new Response('', { status: 503 });
  });
  const request = () => new Request('https://artwork.example/fr/calendar-card.jpg?' + new URLSearchParams({
    src: 'https://image.tmdb.org/t/p/w780/runtime-recover.jpg', title: 'Récupération', layout: 'landscape' }));
  const ctx = { waitUntil: (p) => tasks.push(p) };
  const failed = await router.fetch(request(), {}, ctx);
  assert.equal(failed.status, 200); assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.equal(entries.size, 0); await failed.arrayBuffer();
  up = true;
  const recovered = await router.fetch(request(), {}, ctx); await recovered.arrayBuffer(); await Promise.all(tasks);
  assert.equal(recovered.headers.get('x-nuvio-artwork-photo'), 'ready'); assert.equal(calls, 2);
  const cached = await router.fetch(request(), {}, ctx);
  assert.equal(cached.headers.get('x-nuvio-cache'), 'HIT'); assert.equal(calls, 2); await cached.arrayBuffer();
});

test('Oracle keeps rendered photos warm across deployments', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-art-cache-'));
  const photo = await sharp({ create: { width: 80, height: 45, channels: 3, background: '#8d7040' } }).jpeg().toBuffer();
  fs.writeFileSync(path.join(dir, 'photo.jpg'), photo);
  const preload = path.join(dir, 'preload.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';\nconst original=globalThis.fetch;\nglobalThis.fetch=async(input,options)=>{const u=new URL(typeof input==='string'?input:input.url);if(u.hostname==='image.tmdb.org'){fs.appendFileSync(${JSON.stringify(path.join(dir, 'fetches'))},'1');return new Response(fs.readFileSync(${JSON.stringify(path.join(dir, 'photo.jpg'))}),{headers:{'content-type':'image/jpeg'}});}return original(input,options);};`);
  let child;
  const port = 3372, origin = `http://127.0.0.1:${port}`;
  async function start(revision) {
    child = spawn(process.execPath, ['--import', preload, 'oracle/server.mjs'], { env: { ...process.env,
      PORT: String(port), PUBLIC_ORIGIN: origin, HOST: '127.0.0.1', NUVIO_GIT_SHA: revision,
      NUVIO_CACHE_DIR: path.join(dir, 'cache') }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(origin + '/_oracle/health'); if (r.ok) { await r.arrayBuffer(); return; } } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Oracle artwork fixture failed to start');
  }
  async function stop() { if (child) { const current = child; child = null; current.kill('SIGTERM'); await new Promise((r) => current.once('exit', r)); } }
  const url = origin + '/fr/calendar-card.jpg?' + new URLSearchParams({ src: 'https://image.tmdb.org/t/p/w780/persistent.jpg', title: 'Persistant', layout: 'landscape', v: 'fast-artwork-v2' });
  try {
    await start('release-one');
    const first = await fetch(url); assert.equal(first.status, 200); await first.arrayBuffer();
    await new Promise((r) => setTimeout(r, 200)); await stop();
    await start('release-two');
    const second = await fetch(url); assert.equal(second.headers.get('x-nuvio-disk-cache'), 'HIT');
    const info = await sharp(Buffer.from(await second.arrayBuffer())).metadata(); assert.equal(info.width, 960);
    assert.equal(fs.readFileSync(path.join(dir, 'fetches'), 'utf8'), '1');
    assert.equal((await (await fetch(origin + '/_oracle/health')).json()).gitSha, 'release-two');
  } finally { await stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
