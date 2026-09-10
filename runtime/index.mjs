import baseWorker from './router.mjs';
import {
  ANIME_RESILIENCE_REV,
  isGlobalAnimeResilienceRequest,
  recoverGlobalAnimeResponse
} from './anime-resilience.mjs';

export * from './router.mjs';

const STATIC_EXACT_PATHS = new Set([
  '/',
  '/index.html',
  '/install.json',
  '/coexistence-check.json',
  '/nuvio-collections-fr-global-tr-usa.json',
  '/nuvio-collections-fr-global-usa.json',
  '/nuvio-collections-usa-fr.json',
  '/collections.json',
  '/nuvio-collections-desktop.json',
  '/nuvio-collections-global.json',
  '/nuvio-collections-tr.json',
  '/nuvio-collections-turkiye.json',
  '/edge-build.json',
  '/fr/manifest.json',
  '/fr/nuvio-collections.json',
  '/fr/collections.json',
  '/fr/archive-blueprint.json',
  '/global/manifest.json',
  '/global/nuvio-collections.json',
  '/global/collections.json',
  '/global/archive-blueprint.json',
  '/tr/manifest.json',
  '/tr/nuvio-collections.json',
  '/tr/collections.json',
  '/tr/archive-blueprint.json',
  '/us/manifest.json',
  '/us/nuvio-collections.json',
  '/us/collections.json',
  '/us/archive-blueprint.json'
]);

function isStaticRuntimeAsset(pathname) {
  return STATIC_EXACT_PATHS.has(pathname) || pathname.startsWith('/static/');
}

async function staticRuntimeAsset(request, env) {
  if (!env?.ASSETS?.fetch) {
    return new Response('Oracle ASSETS binding unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Nuvio-Edge', 'oracle-node');
  headers.set('X-Nuvio-Origin', 'oracle-static');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function cacheRequest(request) {
  const url = new URL(request.url);
  url.searchParams.set('__nuvio_anime_resilience', ANIME_RESILIENCE_REV);
  return new Request(url.toString(), { method: 'GET', headers: request.headers });
}

async function cachePut(cache, key, response, ctx) {
  if (!cache || !response?.ok) return;
  const task = cache.put(key, response.clone());
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Advanced runtime mode: every request enters this Worker (runtime-first v2).
    // Static build artifacts are deliberately handed to the runtime ASSETS binding here;
    // all runtime routes stay inside Nuvio's Oracle runtime.
    if (['GET', 'HEAD'].includes(request.method) && isStaticRuntimeAsset(url.pathname)) {
      return staticRuntimeAsset(request, env);
    }

    if (!['GET', 'HEAD'].includes(request.method) || !isGlobalAnimeResilienceRequest(request.url)) {
      return baseWorker.fetch(request, env, ctx);
    }

    const cache = globalThis.caches?.default || null;
    const key = cache ? cacheRequest(request) : null;
    if (cache && key) {
      const cached = await cache.match(key);
      if (cached) return cached;
    }

    const baseResponse = await baseWorker.fetch(request, env, ctx);
    const response = await recoverGlobalAnimeResponse(request, baseResponse);
    if (response.headers.get('x-nuvio-anime-source') === 'anilist-cache-tsuzuki') {
      await cachePut(cache, key, response, ctx);
    }
    return response;
  }
};
