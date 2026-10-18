#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const { SeriesStore, defaultPath } = require('../regions/series/src/store.cjs');
const { fromTmdb, fromTvmaze, isoDate, shiftDay } = require('../regions/series/src/model.cjs');
const { tmdb, tvmaze, pause } = require('../regions/series/src/upstream.cjs');

const DAY = 86400000;
const log = (event, details = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });

function exportDay(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return now.getUTCHours() < 8 ? shiftDay(day, -1) : day;
}

async function ingestIds(store, input) {
  let batch = []; let count = 0;
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (stopping) throw new Error('Interrupted while importing export');
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!Number.isSafeInteger(row.id) || row.id <= 0) throw new Error('Malformed TMDB export ID');
    batch.push(row.id); count++;
    if (batch.length === 500) { store.enqueue('tmdb', batch); batch = []; await new Promise((resolve) => setImmediate(resolve)); }
  }
  if (batch.length) store.enqueue('tmdb', batch);
  if (!count) throw new Error('Empty TMDB export; keeping previous index');
  return count;
}

async function seedTmdb(store, { fetcher = globalThis.fetch, now = new Date() } = {}) {
  const day = exportDay(now);
  if (store.state('tmdbExport') === day) return;
  const [year, month, date] = day.split('-');
  const url = `https://files.tmdb.org/p/exports/tv_series_ids_${month}_${date}_${year}.json.gz`;
  const filename = path.join(path.dirname(store.filename), 'tmdb-tv-latest.json.gz');
  const tmp = `${filename}.${process.pid}.tmp`;
  // Keep the download local and resumable: streaming avoids a full archive in RAM.
  const response = await fetcher(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'NuvioSeriesMonde/1.0' } });
  if (!response.ok) throw new Error(`TMDB export HTTP ${response.status}`);
  try { await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp)); fs.renameSync(tmp, filename); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  const count = await ingestIds(store, fs.createReadStream(filename).pipe(createGunzip()));
  store.state('tmdbExport', day); store.state('tmdbExportCount', count);
  log('tmdb-export-seeded', { day, count });
}

async function enqueueTmdbChanges(store, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (store.state('tmdbChangesThrough') === today) return;
  const previous = store.state('tmdbChangesThrough');
  // TMDB permits up to 14 days. Overlap one day, and split windows recursively
  // if a response hits TMDB's 500-page bound instead of silently truncating.
  const start = previous && previous > shiftDay(today, -13) ? previous : shiftDay(today, -13);
  async function window(startDate, endDate) {
    const first = await tmdb('/tv/changes', { start_date: startDate, end_date: endDate, page: 1 });
    if (Number(first.total_pages) > 500) {
      if (startDate === endDate) throw new Error('TMDB changes overflow for one day; checkpoint retained for retry');
      const middle = new Date((+new Date(`${startDate}T00:00Z`) + +new Date(`${endDate}T00:00Z`)) / 2).toISOString().slice(0, 10);
      await window(startDate, middle); await window(shiftDay(middle, 1), endDate); return;
    }
    store.enqueue('tmdb', (first.results || []).map((s) => s.id), 1, { refresh: true });
    for (let page = 2; page <= Number(first.total_pages || 1); page++) {
      if (stopping) throw new Error('Interrupted changes sync');
      await pause(350);
      const result = await tmdb('/tv/changes', { start_date: startDate, end_date: endDate, page });
      store.enqueue('tmdb', (result.results || []).map((s) => s.id), 1, { refresh: true });
    }
  }
  await window(start, today); store.state('tmdbChangesThrough', today);
}

async function scanTvmaze(store, maxPages = 10) {
  let page = Number(store.state('tvmazePage') || 0);
  for (let n = 0; n < maxPages && !stopping; n++) {
    let list;
    try { list = await tvmaze(`/shows?page=${page}`); }
    catch (error) {
      if (error.status !== 404) throw error;
      store.state('tvmazeBaselineComplete', true); store.state('tvmazeLastScan', new Date().toISOString().slice(0, 10));
      // Revisit the last existing page on the next day, including partially-filled pages.
      store.state('tvmazePage', Math.max(0, page - 1)); return;
    }
    if (!Array.isArray(list)) throw new Error('Malformed TVmaze show index');
    for (const data of list) {
      const record = fromTvmaze(data); store.upsert(record);
      if (record.classification === 'eligible') store.enqueue('tvmaze-seasons', [data.id]);
    }
    page++; store.state('tvmazePage', page); await pause(600);
  }
}

async function enqueueTvmazeChanges(store, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (!store.state('tvmazeBaselineComplete') || store.state('tvmazeChangesThrough') === today) return;
  // Full update timestamps also cover returning after more than a month offline.
  const updates = await tvmaze('/updates/shows');
  const checkpoint = Number(store.state('tvmazeUpdateTimestamp') || 0);
  let through = checkpoint;
  for (const [id, timestamp] of Object.entries(updates)) {
    if (Number(timestamp) >= checkpoint) store.enqueue('tvmaze-show', [Number(id)], 1, { refresh: true });
    through = Math.max(through, Number(timestamp));
  }
  store.state('tvmazeUpdateTimestamp', through); store.state('tvmazeChangesThrough', today);
}

async function runJobs(store, source, limit) {
  const jobs = store.jobs(source, limit);
  for (const job of jobs) {
    if (stopping) break;
    try {
      if (source === 'tmdb') {
        const data = await tmdb(`/tv/${job.source_id}`, { append_to_response: 'external_ids,keywords' });
        // TMDB may have no translated name/overview. Keep original metadata instead of dropping the show.
        if (!data.overview) {
          const fallback = await tmdb(`/tv/${job.source_id}`, { language: 'en-US' });
          data.overview = fallback.overview || null; data.name = data.name || fallback.name;
        }
        const record = fromTmdb(data); record.seasonsComplete = true; store.upsert(record);
        store.done(source, job.source_id, /Ended|Canceled/i.test(record.status || '') ? 90 * DAY : DAY);
      } else if (source === 'tvmaze-show') {
        const record = fromTvmaze(await tvmaze(`/shows/${job.source_id}`)); store.upsert(record);
        if (record.classification === 'eligible') store.enqueue('tvmaze-seasons', [job.source_id], 1, { refresh: true });
        store.done(source, job.source_id, 90 * DAY);
      } else {
        const show = await tvmaze(`/shows/${job.source_id}`);
        const record = fromTvmaze(show);
        if (record.classification === 'eligible') {
          const seasons = await tvmaze(`/shows/${job.source_id}/seasons`);
          record.seasons = seasons.filter((s) => Number(s.number) > 0).map((s) => ({ number: Number(s.number), date: isoDate(s.premiereDate), name: s.name || null }));
          record.seasonsComplete = true;
        }
        store.upsert(record); store.done(source, job.source_id, /Ended/i.test(record.status || '') ? 90 * DAY : DAY);
      }
    } catch (error) {
      if (error.status === 404) {
        store.removeSource(source === 'tmdb' ? 'tmdb' : 'tvmaze', job.source_id);
        store.done(source, job.source_id, 30 * DAY);
      } else { store.failed(source, job.source_id, error); }
    }
    await pause(source === 'tmdb' ? 350 : 600);
  }
}

async function syncCycle(store) {
  const errors = [];
  const safe = async (label, fn) => { try { await fn(); } catch (e) { errors.push(label); log('sync-step-failed', { step: label, message: e.message }); } };
  const hasTmdb = Boolean(process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY);
  if (hasTmdb) {
    await safe('tmdb-export', () => seedTmdb(store));
    await safe('tmdb-changes', () => enqueueTmdbChanges(store));
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!store.state('tvmazeBaselineComplete') || store.state('tvmazeLastScan') !== today) await safe('tvmaze-index', () => scanTvmaze(store));
  await safe('tvmaze-changes', () => enqueueTvmazeChanges(store));
  if (hasTmdb) await runJobs(store, 'tmdb', 200);
  await runJobs(store, 'tvmaze-show', 50);
  await runJobs(store, 'tvmaze-seasons', 100);
  store.state('lastSync', { at: new Date().toISOString(), stepsFailed: errors, tmdbConfigured: hasTmdb });
  store.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  log('sync-cycle-finished', store.stats());
}

async function main() {
  const store = new SeriesStore(defaultPath());
  try {
    do {
      await syncCycle(store);
      if (!process.argv.includes('--once')) for (let second = 0; second < 60 && !stopping; second++) await pause(1000);
    }
    while (!stopping && !process.argv.includes('--once'));
  } finally { store.close(); }
}

if (require.main === module) main().catch((error) => { log('sync-fatal', { message: error.message }); process.exitCode = 1; });
module.exports = { exportDay, ingestIds, seedTmdb, enqueueTmdbChanges, scanTvmaze, runJobs, syncCycle };
