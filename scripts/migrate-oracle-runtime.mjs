#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RUNTIME = path.join(ROOT, 'runtime');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function assertNoLegacyRuntime(content, rel) {
  const forbidden = /cloudflare|pages\.dev|workers\.dev|vercel\.app|sslip\.io/i;
  if (forbidden.test(content)) throw new Error(`${rel} still contains a legacy production/runtime dependency`);
}

function neutralizeCommon(content) {
  return content
    .replaceAll('cloudflare-native', 'oracle-node')
    .replaceAll('cloudflare-only', 'oracle-vm')
    .replaceAll('cloudflare-static', 'oracle-static')
    .replaceAll('Cloudflare', 'Oracle')
    .replaceAll('CLOUDFLARE', 'ORACLE');
}

function buildRouter() {
  let source = read('cloudflare/worker.mjs');
  source = neutralizeCommon(source);

  source = source.replace(
    /export function requestTimeZone\(request\) \{[\s\S]*?\n\}/,
    `export function requestTimeZone(request) {\n  const explicit = request.headers.get('x-nuvio-timezone');\n  return explicit || '';\n}`
  );

  // Node/Oracle uses the standard Fetch API. Remove provider-specific fetch hints.
  source = source.replace(/,\n\s*cf:\s*\{\s*cacheEverything:\s*true,\s*cacheTtl:\s*GENERATED_ART_TTL\s*\}/g, '');
  source = source.replace(/\n\s*headers\['x-vercel-ip-timezone'\]\s*=\s*timeZone;?/g, '');

  assertNoLegacyRuntime(source, 'runtime/router.mjs');
  return source;
}

function buildAnimeResilience() {
  let source = neutralizeCommon(read('cloudflare/anilist-resilience.mjs'));
  source = source.replaceAll('Oracle-AniList-Resilience', 'Oracle-AniList-Resilience');
  source = source.replaceAll('Oracle/Oracle renderer', 'Oracle renderer');
  assertNoLegacyRuntime(source, 'runtime/anime-resilience.mjs');
  return source;
}

function buildEntry() {
  let source = read('cloudflare/worker-entry.mjs')
    .replace("./worker.mjs", "./router.mjs")
    .replaceAll("./anilist-resilience.mjs", "./anime-resilience.mjs")
    .replaceAll('staticPagesAsset', 'staticRuntimeAsset')
    .replaceAll('isStaticPagesAsset', 'isStaticRuntimeAsset');
  source = neutralizeCommon(source).replaceAll('Pages', 'runtime');
  assertNoLegacyRuntime(source, 'runtime/index.mjs');
  return source;
}

function buildOracleServer() {
  let source = read('oracle/server.mjs');
  source = source.replace("import worker from '../cloudflare/worker-entry.mjs';", "import runtime from '../runtime/index.mjs';");
  source = source.replace('const response = await worker.fetch(request, envBindings(), ctx);', 'const response = await runtime.fetch(request, envBindings(), ctx);');

  const oldSafe = /function safeDistPath\(urlLike\) \{[\s\S]*?\n\}/;
  const replacement = `function safeRuntimePath(urlLike) {\n  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));\n  let pathname = decodeURIComponent(url.pathname);\n\n  let base = DIST;\n  let relative;\n  if (pathname.startsWith('/static/assets/')) {\n    base = path.join(ROOT, 'assets');\n    relative = pathname.slice('/static/assets/'.length);\n  } else {\n    if (pathname === '/') pathname = '/index.html';\n    relative = pathname.replace(/^\\/+/, '');\n  }\n\n  const resolved = path.resolve(base, relative);\n  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;\n  return resolved;\n}`;
  if (!oldSafe.test(source)) throw new Error('oracle/server.mjs safeDistPath block not found');
  source = source.replace(oldSafe, replacement).replace('const file = safeDistPath(request.url);', 'const file = safeRuntimePath(request.url);');

  assertNoLegacyRuntime(source, 'oracle/server.mjs');
  return source;
}

function buildApiIndex() {
  let source = read('api/index.js');
  source = source.replace(
    'Un seul déploiement Cloudflare avec <b>quatre addons isolés</b>.',
    'Une seule production Oracle avec <b>quatre addons isolés</b>.'
  );
  return source;
}

fs.mkdirSync(RUNTIME, { recursive: true });
write('runtime/router.mjs', buildRouter());
write('runtime/anime-resilience.mjs', buildAnimeResilience());
write('runtime/index.mjs', buildEntry());
write('oracle/server.mjs', buildOracleServer());
write('api/index.js', buildApiIndex());

console.log('Oracle-neutral runtime extracted successfully.');
