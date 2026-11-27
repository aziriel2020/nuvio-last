#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import movieVectorArt from '../runtime/movie-vector-art.cjs';

const { FILM_DETAILS_PROFILE, movieVectorPath } = movieVectorArt;
const LOCAL = 'http://127.0.0.1:3000';
const MAX_POSTERS = 72;
const CATALOG_BUDGET_MS = 50_000;
const TIME_BUDGET_MS = 165_000;
const CONCURRENCY = 2;
const ZONE = 'Europe/Brussels';
const VIEWS = ['all', 'streaming', 'vod', 'cinema'];
const GENRES = ['all', '28', '12', '35', '80', '99', '18', '10751', '14', '36',
  '27', '10402', '9648', '10749', '878', '10770', '53', '10752', '37', 'standup'];

function catalogPath(profile, view, genre, period) {
  return '/movies' + profile + '/catalog/movie/movies-fr-' + view + '-' + genre + '-' + period + '.json';
}

export function catalogPaths(now = new Date(), iteration = 0) {
  const month = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, year: 'numeric', month: '2-digit' }).format(now);
  const year = Number(month.slice(0, 4));
  const primary = [
    ...VIEWS.map(view => catalogPath('', view, 'all', month)),
    ...['/native-bridge', '/native-bridge/mobile', '/collections-only', '/mobile-desktop-collections']
      .map(profile => catalogPath(profile, 'all', 'all', month))
  ];
  const rotation = ((iteration % GENRES.length) + GENRES.length) % GENRES.length;
  const view = VIEWS[rotation % VIEWS.length];
  const rotating = [
    catalogPath('', view, 'all', 'today'),
    catalogPath('', view, 'all', 'yesterday'),
    catalogPath('', view, 'all', 'annual-' + year),
    catalogPath('', view, 'all', 'annual-' + (year - 1)),
    catalogPath('', view, GENRES[rotation], month),
    catalogPath('', view, GENRES[rotation], 'annual-' + (year - 1))
  ];
  return [...new Set([...primary, ...rotating])];
}

function localPosterUrl(meta) {
  const path = meta?.type === 'movie' && movieVectorPath(meta.id);
  if (!path || !meta.poster) return null;
  return LOCAL + path + '?v=' + FILM_DETAILS_PROFILE;
}

async function fetchJson(fetcher, path, timeout) {
  const response = await fetcher(LOCAL + path, {
    signal: AbortSignal.timeout(timeout), redirect: 'error', headers: { accept: 'application/json' }
  });
  if (!response.ok || response.headers.get('x-nuvio-origin') !== 'oracle-vm') {
    await response.body?.cancel();
    throw new Error('Oracle HTTP ' + response.status);
  }
  return response.json();
}

export async function run({ now = new Date(), iteration = Math.floor(Date.now() / 240_000),
  fetcher = globalThis.fetch } = {}) {
  const health = await fetchJson(fetcher, '/_oracle/health', 5000);
  if (!health.ok || health.runtime !== 'oracle-vm') throw Error('Oracle unhealthy');
  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const catalogDeadline = startedAt + CATALOG_BUDGET_MS;
  const posters = new Set();
  const failures = [];
  let catalogs = 0;
  const paths = catalogPaths(now, iteration);
  for (const path of paths) {
    const remaining = catalogDeadline - Date.now();
    if (remaining <= 0) break;
    try {
      const { metas } = await fetchJson(fetcher, path, Math.min(remaining, 8000));
      catalogs++;
      const posterLimit = path === paths[0] ? 24 : 6;
      for (const meta of (Array.isArray(metas) ? metas : []).slice(0, posterLimit)) {
        if (posters.size >= MAX_POSTERS) break;
        const url = localPosterUrl(meta);
        if (url) posters.add(url);
      }
    } catch (error) {
      failures.push({ catalog: path, error: error.message });
    }
  }

  const urls = [...posters];
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < urls.length && Date.now() < deadline) {
      const url = urls[cursor++];
      try {
        const response = await fetcher(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(12_000, Math.max(1, deadline - Date.now())))
        });
        if (!response.ok || !/^image\/svg\+xml\b/.test(response.headers.get('content-type') || '')) {
          await response.body?.cancel();
          throw Error('SVG HTTP ' + response.status);
        }
        await response.arrayBuffer();
        results.push(response.headers.get('x-nuvio-cache'));
      } catch (error) {
        failures.push({ poster: new URL(url).pathname, error: error.message });
      }
    }
  }));
  const result = {
    event: 'oracle-films-monde-warm', release: health.gitSha, catalogs,
    posterCandidates: urls.length, finished: results.length,
    hits: results.filter(value => value === 'HIT' || value === 'STALE').length,
    failures: failures.slice(0, 10)
  };
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  run().catch(error => {
    console.error('Oracle artwork warm failed:', error.message);
    process.exitCode = 1;
  });
}
