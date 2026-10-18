#!/usr/bin/env node
'use strict';

// Keep the installed service entry point; its scope is now streaming in FR.
const { SeriesStore, defaultPath } = require('../regions/series/src/store.cjs');
const { fromTmdb } = require('../regions/series/src/model.cjs');
const { providerDirectory, discoverParams } = require('../regions/series/src/france.cjs');
const { tmdb, pause } = require('../regions/series/src/upstream.cjs');

const REFRESH = 6 * 3600000;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
const log = (event, details = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));

function candidateRecord(data) {
  return fromTmdb({ ...data, genres: (data.genre_ids || []).map((id) => ({ id })) });
}

async function scanFrance(store, { api = tmdb, maxPages = 80, delay = 250, now = Date.now() } = {}) {
  let scan = store.state('frScanProgress');
  if (!scan || scan.complete && now - scan.completedAt >= REFRESH) {
    const providers = providerDirectory(await api('/watch/providers/tv', { watch_region: 'FR', language: 'fr-FR' }));
    store.setFranceProviders(providers);
    scan = { id: String(now), startedAt: now, complete: false, pages: 0, uniqueCandidates: 0,
      providers: providers.length, tasks: [{ ids: providers.map((p) => p.id), page: 1 }], overflow: [] };
    store.state('frScanProgress', scan);
  }
  if (scan.complete) return scan;
  let budget = maxPages;
  while (scan.tasks.length && budget-- > 0 && !stopping) {
    const task = scan.tasks[0];
    const payload = await api('/discover/tv', discoverParams(task.ids, task.page));
    if (!Array.isArray(payload.results)) throw new Error('Malformed France discovery response');
    const pages = Number(payload.total_pages || 1);
    if (pages > 500) {
      scan.tasks.shift();
      if (task.ids.length > 1) {
        const middle = Math.ceil(task.ids.length / 2);
        scan.tasks.unshift({ ids: task.ids.slice(0, middle), page: 1 }, { ids: task.ids.slice(middle), page: 1 });
      } else {
        // Never turn a capped scan into a falsely complete catalog.
        scan.overflow.push({ providerId: task.ids[0], totalResults: payload.total_results });
      }
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
    store.state('frScanProgress', scan);
    if (delay) await pause(delay);
  }
  if (!scan.tasks.length && !scan.overflow.length) {
    store.transaction(() => {
      // Remove departed titles only after a complete, successful market scan.
      store.db.prepare('UPDATE fr_availability SET available=0 WHERE tmdb_id NOT IN (SELECT tmdb_id FROM fr_seen WHERE scan_id=?)').run(scan.id);
      store.db.prepare('DELETE FROM fr_seen WHERE scan_id!=?').run(scan.id);
      scan.complete = true; scan.completedAt = Date.now();
      store.state('frScanProgress', scan);
    });
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
  try { await scanFrance(store); } catch (e) { errors.push(e.message); }
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
module.exports = { scanFrance, runFranceJobs, syncCycle, candidateRecord };
