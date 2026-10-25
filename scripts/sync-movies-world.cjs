#!/usr/bin/env node
'use strict';

const { MovieStore, defaultPath } = require('../regions/movies/src/store.cjs');
const { fromTmdb, candidateRecord, isoDate, localDay, shiftDay, windowFor } = require('../regions/movies/src/model.cjs');
const { providerDirectory } = require('../regions/series/src/france.cjs');
const { tmdb, pause, mapLimit } = require('../regions/series/src/upstream.cjs');
const { splitDateTask } = require('./sync-series-world.cjs');
const REFRESH = 6 * 3600000;
const SCAN_REVISION = 2;
let stopping = false;
if (require.main === module) for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });

function discoverParams(kind, task, page) {
  const market = ['streaming', 'vod'].includes(kind);
  const params = { language: 'fr-FR', include_adult: false, include_video: false, without_genres: '16',
    sort_by: task.probe ? 'primary_release_date.asc' : 'primary_release_date.desc', page };
  if (market) {
    // With monetization types + watch_region TMDB searches all services.
    // Do not restrict discovery to a hardcoded or incomplete provider list.
    params.watch_region = 'FR';
    params.with_watch_monetization_types = kind === 'streaming' ? 'flatrate|free|ads' : 'rent|buy';
  } else {
    params.region = 'FR'; params.with_release_type = kind === 'cinema' ? '3|2' : '4';
  }
  const prefix = market ? 'primary_release_date' : 'release_date';
  if (task.from) params[`${prefix}.gte`] = task.from;
  if (task.to) params[`${prefix}.lte`] = task.to;
  return params;
}

function freshScan(kind, now) {
  const today = localDay(new Date(now));
  const horizon = windowFor('nextweek', new Date(now)).end;
  const tasks = kind === 'recent'
    ? ['cinema', 'digital'].map((lane) => ({ lane, from: shiftDay(today, -31), to: horizon, page: 1 }))
    : [{ lane: kind, page: 1, ...(['cinema', 'digital'].includes(kind) ? { to: horizon } : {}) }];
  return { id: `${kind}-${now}`, revision: SCAN_REVISION, startedAt: now, lastProgressAt: now, complete: false,
    requests: 0, pages: 0, uniqueCandidates: 0, tasks, overflow: [] };
}

function splitMovieDates(task) {
  // TMDB silently ignores bounds such as 0001/9999. Use ordinary dates only
  // to calculate a midpoint; preserve the outer open ends in the requests.
  // This still covers every date, rather than imposing an 1800–2100 cutoff.
  const shards = splitDateTask({ ...task, ids: [], from: task.from || '1800-01-01', to: task.to || '2100-12-31' });
  if (!shards) return null;
  if (!task.from) delete shards[0].from;
  if (!task.to) delete shards[1].to;
  return shards;
}

function ingest(store, scan, task, payload, today) {
  let sawDated = false;
  store.transaction(() => {
    for (const data of payload.results) {
      if (!Number.isSafeInteger(data.id) || data.id < 1) throw new Error('Invalid movie discovery ID');
      const date = isoDate(data.release_date);
      if (task.probe && date) { sawDated = true; continue; }
      const existing = store.db.prepare("SELECT show_id FROM sources WHERE source='tmdb' AND source_id=?").get(data.id);
      let id = existing?.show_id;
      if (!id) {
        const record = candidateRecord(data);
        // Regional discover returns a FR event date, not the global premiere.
        if (['cinema', 'digital'].includes(task.lane)) record.firstAirDate = null;
        id = store.upsert(record);
      }
      if (['streaming', 'vod'].includes(task.lane)) store.markDiscovered(data.id, task.lane);
      else if (date && (!task.from || date >= task.from) && (!task.to || date <= task.to)) store.addRelease(id, task.lane, date);
      store.db.prepare('INSERT OR IGNORE INTO movie_seen VALUES (?,?,?)').run(scan.id, task.lane, data.id);
      const recent = scan.id.startsWith('recent-') || (date && date >= shiftDay(today, -31));
      store.enqueue('movie-detail', [data.id], recent ? 1 : 10, { refresh: true });
    }
  });
  return sawDated;
}

async function scanLane(store, kind, { api = tmdb, maxPages = 90, concurrency = 3, delay = 100, now = Date.now() } = {}) {
  let scan = store.state(`scan:${kind}`);
  const refresh = kind === 'recent' ? 3600000 : REFRESH;
  const stalled = scan && !scan.complete && now - scan.lastProgressAt > 12 * 3600000;
  if (!scan || scan.revision !== SCAN_REVISION || (scan.complete && now - scan.completedAt >= refresh) || stalled
    || (!scan.complete && !scan.tasks.length && scan.retryAt && now >= scan.retryAt)) {
    scan = freshScan(kind, now); store.state(`scan:${kind}`, scan);
  }
  if (scan.complete) return scan;
  let budget = maxPages;
  while (scan.tasks.length && budget > 0 && !stopping) {
    const task = scan.tasks[0];
    const count = task.pages ? Math.min(concurrency, budget, task.pages - task.page + 1) : 1;
    // Apply pages in order. On an upstream failure, the checkpoint stays at
    // the failed page even if later prefetched pages have already arrived.
    const responses = await Promise.allSettled(Array.from({ length: count }, (_, i) =>
      api('/discover/movie', discoverParams(task.lane, task, task.page + i))));
    // Subdivision requests consume the same budget as successful pages. A
    // malformed/ignored filter must never monopolize the worker indefinitely.
    budget -= count; scan.requests += count;
    for (const result of responses) {
      if (result.status === 'rejected') throw result.reason;
      const payload = result.value;
      if (!Array.isArray(payload.results) || !Number.isFinite(Number(payload.total_pages))) throw new Error('Malformed movie discovery response');
      const total = Math.max(1, Number(payload.total_pages));
      if (!task.probe && (total > 500 || Number(payload.total_results || 0) > 10000)) {
        scan.tasks.shift();
        const shards = splitMovieDates(task);
        if (shards) {
          const pieces = shards.map((piece) => ({ lane: task.lane, from: piece.from, to: piece.to, page: 1 }));
          // Null dates do not match date shards. Probe the undated tail
          // independently, rather than silently dropping these films.
          if (!task.from && ['streaming', 'vod'].includes(task.lane)) pieces.unshift({ lane: task.lane, probe: true, page: 1 });
          scan.tasks.unshift(...pieces);
        } else scan.overflow.push({ lane: task.lane, from: task.from, to: task.to, totalResults: payload.total_results });
        break;
      }
      const sawDated = ingest(store, scan, task, payload, localDay(new Date(now)));
      scan.pages++;
      task.pages = Math.min(500, total);
      if (task.probe && task.page >= 500 && !sawDated && (total > 500 || Number(payload.total_results || 0) > 10000))
        scan.overflow.push({ lane: task.lane, reason: 'More than 10000 undated candidates' });
      const done = task.page >= task.pages || (task.probe && sawDated);
      if (done) scan.tasks.shift(); else task.page++;
      scan.uniqueCandidates = store.db.prepare('SELECT COUNT(DISTINCT tmdb_id) AS count FROM movie_seen WHERE scan_id=?').get(scan.id).count;
      scan.lastProgressAt = Date.now(); store.state(`scan:${kind}`, scan);
      if (done) break;
    }
    scan.lastProgressAt = Date.now(); store.state(`scan:${kind}`, scan);
    if (delay) await pause(delay);
  }
  if (!scan.tasks.length) {
    if (!scan.uniqueCandidates && ['streaming', 'vod'].includes(kind)
      && store.db.prepare('SELECT COUNT(*) AS count FROM movie_lanes WHERE kind=? AND available=1').get(kind).count)
      scan.overflow.push({ lane: kind, reason: 'Unexpected empty full-market scan; previous availability retained' });
    if (scan.overflow.length) { if (!scan.retryAt) scan.retryAt = Date.now() + REFRESH; }
    else store.transaction(() => {
      if (['streaming', 'vod'].includes(kind)) store.finishMarket(scan.id, kind);
      else store.db.prepare('DELETE FROM movie_seen WHERE lane IN (\'cinema\',\'digital\') AND scan_id!=? AND scan_id LIKE ?').run(scan.id, `${kind}-%`);
      scan.complete = true; scan.completedAt = Date.now();
    });
    store.state(`scan:${kind}`, scan);
  }
  return scan;
}

async function runDetailJobs(store, { api = tmdb, limit = 60, concurrency = 3, delay = 100 } = {}) {
  const jobs = store.jobs('movie-detail', limit);
  for (let i = 0; i < jobs.length && !stopping; i += concurrency) {
    await mapLimit(jobs.slice(i, i + concurrency), concurrency, async (job) => {
      try {
        const data = await api(`/movie/${job.source_id}`, { language: 'fr-FR', append_to_response: 'external_ids,keywords,watch/providers,release_dates' });
        if (!Object.hasOwn(data, 'watch/providers') || !Object.hasOwn(data, 'release_dates')) throw new Error('Incomplete movie availability/release response');
        store.upsert(fromTmdb(data)); store.done('movie-detail', job.source_id, REFRESH);
      } catch (error) {
        if (error.status === 404) {
          store.setFranceOffers(job.source_id, []);
          const row = store.row(`tmdb:${job.source_id}`);
          if (row) store.db.prepare('DELETE FROM movie_releases WHERE show_id=?').run(row.id);
          store.done('movie-detail', job.source_id, REFRESH);
        } else store.failed('movie-detail', job.source_id, error);
      }
    });
    if (delay) await pause(delay);
  }
}

async function syncCycle(store, options = {}) {
  const api = options.api || tmdb;
  const errors = [];
  if (!store.state('providersAt') || Date.now() - store.state('providersAt') >= REFRESH) {
    try {
      store.setFranceProviders(providerDirectory(await api('/watch/providers/movie', { watch_region: 'FR', language: 'fr-FR' })));
      store.state('providersAt', Date.now());
    } catch (error) { errors.push(`providers: ${error.message}`); }
  }
  // Recent cinema/digital events land first; deep archives resume afterwards.
  for (const lane of ['recent', 'streaming', 'vod', 'cinema', 'digital']) {
    try { await scanLane(store, lane, { ...options, api, maxPages: lane === 'recent' ? 24 : 90 }); }
    catch (error) { errors.push(`${lane}: ${error.message}`); }
  }
  await runDetailJobs(store, { ...options, api });
  store.state('lastSync', { at: new Date().toISOString(), market: 'FR', errors });
  store.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  const stats = store.stats();
  console.log(JSON.stringify({ event: 'movies-world-sync', eligible: stats.eligible,
    pages: Object.fromEntries(Object.entries(stats.scans).map(([k, v]) => [k, v?.pages])), errors }));
}
async function main() {
  const store = new MovieStore(defaultPath());
  try {
    do {
      await syncCycle(store);
      if (!process.argv.includes('--once')) for (let i = 0; i < 3 && !stopping; i++) await pause(1000);
    } while (!stopping && !process.argv.includes('--once'));
  } finally { store.close(); }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { discoverParams, freshScan, splitMovieDates, scanLane, runDetailJobs, syncCycle };
