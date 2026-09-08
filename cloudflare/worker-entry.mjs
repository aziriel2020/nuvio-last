import baseWorker from './worker.mjs';
import {
  ANIME_RESILIENCE_REV,
  isGlobalAnimeResilienceRequest,
  recoverGlobalAnimeResponse
} from './anilist-resilience.mjs';

export * from './worker.mjs';

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
