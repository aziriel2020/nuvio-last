'use strict';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, headers = {}, fetcher = globalThis.fetch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(url, { headers: { 'User-Agent': 'NuvioSeriesMonde/1.0', ...headers }, signal: AbortSignal.timeout(20000) });
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retry = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await pause(Math.min(30000, retry > 0 ? retry * 1000 : 1000 * 2 ** attempt));
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); const error = new Error(`Upstream HTTP ${response.status}`); error.status = response.status; throw error; }
    return response.json();
  }
}

function tmdb(endpoint, params = {}, fetcher) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  const token = process.env.TMDB_READ_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!token && !apiKey) throw new Error('TMDB credentials missing');
  if (!token) url.searchParams.set('api_key', apiKey);
  for (const [key, value] of Object.entries({ language: 'fr-FR', ...params })) url.searchParams.set(key, String(value));
  return getJson(url, token ? { Authorization: `Bearer ${token}` } : {}, fetcher);
}

const tvmaze = (endpoint, fetcher) => getJson(`https://api.tvmaze.com${endpoint}`, {}, fetcher);

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = cursor++; if (i >= items.length) return; results[i] = await fn(items[i], i); }
  }));
  return results;
}

module.exports = { pause, getJson, tmdb, tvmaze, mapLimit };
