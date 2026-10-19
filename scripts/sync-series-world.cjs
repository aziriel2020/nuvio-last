#!/usr/bin/env node
'use strict';

// Keep the installed service entry point; its scope is now streaming in FR.
const { SeriesStore, defaultPath } = require('../regions/series/src/store.cjs');
const { fromTmdb } = require('../regions/series/src/model.cjs');
const { providerDirectory, discoverParams } = require('../regions/series/src/france.cjs');
const { tmdb, pause } = require('../regions/series/src/upstream.cjs');

const REFRESH = 6 * 3600000;
const MAX_STALLED_SCAN_AGE = 12 * 3600000;
const DAY = 86400000;
const PROVIDERS_PER_REQUEST = 24;

// TMDb discover cannot paginate beyond page 500. Subdivide one provider
// by inclusive first-air-date ranges instead of silently dropping its shows.
function splitDateTask(task) {
  const from = task.from || '0001-01-01';
  const to = task.to || '9999-12-31';
  const first = Date.parse(from + 'T00:00:00Z');
  const last = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last) return null;
  const midpoint = new Date(Math.floor((first + last) / (2 * DAY)) * DAY).toISOString().slice(0, 10);
  if (midpoint < from || midpoint >= to) return null;
  const next = new Date(Date.parse(midpoint + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
  return [
    { ids: [...task.ids], from, to: midpoint, page: 1 },
    { ids: [...task.ids], from: next, to, page: 1 }
  ];
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
const log = (event, details = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));

function candidateRecord(data) {
  return fromTmdb({ ...data, genres: (data.genre_ids || []).map((id) => ({ id })) });
}

async function scanFrance(store, { api = tmdb, maxPages = 80, delay = 250, now = Date.now() } = {}) {
  let scan = store.state('frScanProgress');
  // Previous releases could persist {tasks: [], overflow: [...]} forever.
  // Reopen them on upgrade; resume genuinely stalled in-progress snapshots.
  const exhausted = scan && !scan.complete && !scan.tasks?.length && scan.overflow?.length;
  const stalled = scan && !scan.complete && scan.tasks?.length
    && now - (scan.lastProgressAt || scan.startedAt || now) >= MAX_STALLED_SCAN_AGE;
  if (!scan || (scan.complete && now - scan.completedAt >= REFRESH)
    || (exhausted && (!scan.retryAt || now >= scan.retryAt)) || stalled) {
    const providers = providerDirectory(await api('/watch/providers/tv', { watch_region: 'FR', language: 'fr-FR' }));
    store.setFranceProviders(providers);
    scan = { id: String(now), startedAt: now, complete: false, pages: 0, uniqueCandidates: 0,
      providers: providers.length, lastProgressAt: now,
      tasks: Array.from({ length: Math.ceil(providers.length / PROVIDERS_PER_REQUEST) },
        (_, i) => ({ ids: providers.slice(i * PROVIDERS_PER_REQUEST, (i + 1) * PROVIDERS_PER_REQUEST).map((p) => p.id), page: 1 })),
      overflow: [] };
    store.state('frScanProgress', scan);
  }
  if (scan.complete) return scan;
  let budget = maxPages;
  while (scan.tasks.length && budget-- > 0 && !stopping) {
    const task = scan.tasks[0];
    if (task.ids.length > PROVIDERS_PER_REQUEST) {
      // Repair oversized tasks persisted by older releases before making a request.
      scan.tasks.shift();
      const groups = Array.from({ length: Math.ceil(task.ids.length / PROVIDERS_PER_REQUEST) },
        (_, i) => ({ ...task, ids: task.ids.slice(i * PROVIDERS_PER_REQUEST, (i + 1) * PROVIDERS_PER_REQUEST), page: 1 }));
      scan.tasks.unshift(...groups);
      scan.lastProgressAt = Date.now();
      store.state('frScanProgress', scan);
      continue;
    }
    const dates = task.from ? { 'first_air_date.gte': task.from, 'first_air_date.lte': task.to } : {};
    const payload = await api('/discover/tv', discoverParams(task.ids, task.page, dates));
    if (!Array.isArray(payload.results)) throw new Error('Malformed France discovery response');
    const pages = Number(payload.total_pages || 1);
    if (pages > 500 || Number(payload.total_results || 0) > 10000) {
      scan.tasks.shift();
      if (task.ids.length > 1) {
        const middle = Math.ceil(task.ids.length / 2);
        scan.tasks.unshift({ ids: task.ids.slice(0, middle), page: 1 }, { ids: task.ids.slice(middle), page: 1 });
      } else {
        const shards = splitDateTask(task);
        if (shards) scan.tasks.unshift(...shards);
        else {
          // A single date still exceeds the cap: retain the old catalog,
          // report incomplete coverage and retry the scan in six hours.
          scan.overflow.push({ providerId: task.ids[0], from: task.from, to: task.to,
            totalResults: payload.total_results, reason: 'TMDb page limit' });
        }
      }
      scan.lastProgressAt = Date.now();
      store.state('frScanProgress', scan); continue;
    }
    store.transaction(() => { for (const data of payload.results) {
      if (!Number.isSafeInteger(data.id) || data.id <= 0) throw new Error('Invalid France candidate ID');
      if ((data.genre_ids || []).includes(16)) continue;
      const existing = store.db.prepare("SELECT source_id FROM sources WHERE source='tmdb' AND source_id=?").get(data.id);
      if (!existing) store.upsert(candidateRecord(data));
      // This evidence comes only from discover/tv with watch_region=FR and
      // the full provider directory. Full per-title offers enrich it below.
      store.markFranceDiscovered(data.id);
      store.db.prepare('INSERT OR IGNORE INTO fr_seen VALUES (?,?)').run(scan.id, data.id);
      store.enqueue('fr-detail', [data.id], 1, { refresh: true });
    } });
    scan.pages++;
    scan.uniqueCandidates = store.db.prepare('SELECT COUNT(*) AS count FROM fr_seen WHERE scan_id=?').get(scan.id).count;
    if (task.page >= pages) scan.tasks.shift(); else task.page++;
    scan.lastProgressAt = Date.now();
    store.state('lastFranceDiscoveryAt', new Date(scan.lastProgressAt).toISOString());
    store.state('frScanProgress', scan);
    if (delay) await pause(delay);
  }
  if (!scan.tasks.length && scan.overflow.length && !scan.retryAt) {
    scan.retryAt = Date.now() + REFRESH;
    store.state('frScanProgress', scan);
  }
  if (!scan.tasks.length && !scan.overflow.length) {
    store.transaction(() => {
      // Remove departed titles only after a complete, successful market scan.
      store.db.prepare('UPDATE fr_availability SET available=0 WHERE tmdb_id NOT IN (SELECT tmdb_id FROM fr_seen WHERE scan_id=?)').run(scan.id);
      store.db.prepare('DELETE FROM fr_seen WHERE scan_id!=?').run(scan.id);
      scan.complete = true; scan.completedAt = Date.now();
      scan.lastProgressAt = scan.completedAt;
      store.state('frScanProgress', scan);
    });
  }
  return scan;
}


function utcIsoDay(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }

// Recent episodes need a separate discovery lane. The historical scan sorts by
// first_air_date, so a 2010 show with a new 2026 episode would never be reached
// promptly. Keep this lane independent of full market scan/removal bookkeeping.
async function scanRecentAirings(store, { api = tmdb, maxPages = 36, delay = 250, now = Date.now() } = {}) {
  let scan = store.state('frAirScanProgress');
  const stalled = scan && !scan.complete && scan.tasks?.length
    && now - (scan.lastProgressAt || scan.startedAt || now) >= MAX_STALLED_SCAN_AGE;
  const exhausted = scan && !scan.complete && !scan.tasks?.length;
  if (!scan || (scan.complete && now - scan.completedAt >= REFRESH)
    || stalled || (exhausted && (!scan.retryAt || now >= scan.retryAt))) {
    let providers = store.franceProviders();
    if (!providers.length) {
      providers = providerDirectory(await api('/watch/providers/tv', { watch_region: 'FR', language: 'fr-FR' }));
      store.setFranceProviders(providers);
    }
    const from = utcIsoDay(now - 21 * DAY);
    const to = utcIsoDay(now + 7 * DAY);
    scan = {
      id: String(now), startedAt: now, lastProgressAt: now, from, to, complete: false,
      pages: 0, matches: 0, overflow: [],
      tasks: Array.from({ length: Math.ceil(providers.length / PROVIDERS_PER_REQUEST) },
        (_, i) => ({ ids: providers.slice(i * PROVIDERS_PER_REQUEST, (i + 1) * PROVIDERS_PER_REQUEST).map((p) => p.id),
          from, to, page: 1 }))
    };
    store.state('frAirScanProgress', scan);
  }
  if (scan.complete) return scan;
  let budget = maxPages;
  while (scan.tasks.length && budget-- > 0 && !stopping) {
    const task = scan.tasks[0];
    const params = discoverParams(task.ids, task.page, {
      'air_date.gte': task.from, 'air_date.lte': task.to,
      sort_by: 'popularity.desc', include_null_first_air_dates: false
    });
    const payload = await api('/discover/tv', params);
    if (!Array.isArray(payload.results)) throw new Error('Invalid recent-airing discovery response');
    const pages = Number(payload.total_pages || 1);
    if (pages > 500 || Number(payload.total_results || 0) > 10000) {
      scan.tasks.shift();
      if (task.ids.length > 1) {
        const middle = Math.ceil(task.ids.length / 2);
        scan.tasks.unshift({ ...task, ids: task.ids.slice(0, middle), page: 1 },
          { ...task, ids: task.ids.slice(middle), page: 1 });
      } else {
        const split = splitDateTask(task);
        if (split) scan.tasks.unshift(...split);
        else scan.overflow.push({ providerId: task.ids[0], from: task.from, to: task.to, totalResults: payload.total_results });
      }
    } else {
      store.transaction(() => {
        for (const data of payload.results) {
          if (!Number.isSafeInteger(data.id) || data.id <= 0 || (data.genre_ids || []).includes(16)) continue;
          const found = store.db.prepare("SELECT source_id FROM sources WHERE source='tmdb' AND source_id=?").get(data.id);
          if (!found) store.upsert(candidateRecord(data));
          store.markFranceDiscovered(data.id);
          // Aired this week must be enriched before the deep historical queue.
          store.enqueue('fr-detail', [data.id], 1, { refresh: true });
          scan.matches++;
        }
      });
      if (task.page >= pages) scan.tasks.shift(); else task.page++;
      scan.pages++;
      store.state('lastFranceAirDiscoveryAt', new Date().toISOString());
    }
    scan.lastProgressAt = Date.now();
    store.state('frAirScanProgress', scan);
    if (delay) await pause(delay);
  }
  if (!scan.tasks.length) {
    if (scan.overflow.length) scan.retryAt = Date.now() + REFRESH;
    else { scan.complete = true; scan.completedAt = Date.now(); }
    store.state('frAirScanProgress', scan);
  }
  return scan;
}

async function runFranceJobs(store, { api = tmdb, limit = 160, delay = 250 } = {}) {
  for (const job of store.jobs('fr-detail', limit)) {
    if (stopping) break;
    try {
      const data = await api(`/tv/${job.source_id}`, { append_to_response: 'external_ids,keywords,watch/providers', language: 'fr-FR' });
      if (!Object.prototype.hasOwnProperty.call(data, 'watch/providers')) throw new Error('France availability missing from title response');
      const record = fromTmdb(data); record.seasonsComplete = true;
      store.upsert(record);
      store.done('fr-detail', job.source_id, REFRESH);
    } catch (error) {
      if (error.status === 404) {
        store.setFranceOffers(job.source_id, []); store.done('fr-detail', job.source_id, REFRESH);
      } else store.failed('fr-detail', job.source_id, error);
    }
    if (delay) await pause(delay);
  }
}

async function syncCycle(store) {
  if (!process.env.TMDB_READ_TOKEN && !process.env.TMDB_API_KEY) throw new Error('TMDB credentials required for France availability');
  if (!store.state('frModeV1')) {
    // Stop the unrelated worldwide backlog; existing metadata remains available
    // for identity mapping, but it cannot pass the France availability gate.
    store.db.exec("DELETE FROM jobs WHERE source IN ('tmdb','tvmaze-show','tvmaze-seasons')");
    store.state('frModeV1', true);
  }
  const errors = [];
  // Prioritize new airings (including returning seasons) before older premieres.
  try { await scanRecentAirings(store); } catch (e) { errors.push('recent-airings: ' + e.message); }
  try { await scanFrance(store); } catch (e) { errors.push('market: ' + e.message); }
  await runFranceJobs(store);
  store.state('lastSync', { at: new Date().toISOString(), market: 'FR', errors });
  store.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  log('france-sync-cycle', store.stats());
}

async function main() {
  const store = new SeriesStore(defaultPath());
  try {
    do {
      await syncCycle(store);
      if (!process.argv.includes('--once')) for (let n = 0; n < 10 && !stopping; n++) await pause(1000);
    } while (!stopping && !process.argv.includes('--once'));
  } finally { store.close(); }
}
if (require.main === module) main().catch((e) => { log('france-sync-fatal', { message: e.message }); process.exitCode = 1; });
module.exports = { scanFrance, scanRecentAirings, runFranceJobs, syncCycle, candidateRecord, splitDateTask };
