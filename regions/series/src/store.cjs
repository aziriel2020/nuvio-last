'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { GENRES, unique, windowFor } = require('./model.cjs');
const { AVAILABILITY_TTL } = require('./france.cjs');

const defaultPath = () => process.env.NUVIO_SERIES_DB || '/var/lib/nuvio-series/index.sqlite';
const json = (value) => JSON.stringify(value);
const parse = (value, fallback = []) => { try { return JSON.parse(value); } catch { return fallback; } };

class SeriesStore {
  constructor(filename = defaultPath(), { readonly = false } = {}) {
    this.filename = filename;
    if (filename !== ':memory:' && !readonly) fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename, { readOnly: readonly });
    this.db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
    if (!readonly) {
      this.db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS shows (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, original_title TEXT, description TEXT,
          first_air_date TEXT, poster TEXT, background TEXT, genres TEXT NOT NULL,
          countries TEXT NOT NULL, languages TEXT NOT NULL, status TEXT,
          classification TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sources (
          source TEXT NOT NULL, source_id INTEGER NOT NULL, show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
          imdb_id TEXT, tvdb_id INTEGER, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(source, source_id)
        );
        CREATE INDEX IF NOT EXISTS source_imdb ON sources(imdb_id);
        CREATE INDEX IF NOT EXISTS source_tvdb ON sources(tvdb_id);
        CREATE INDEX IF NOT EXISTS source_show ON sources(show_id);
        CREATE INDEX IF NOT EXISTS show_date ON shows(classification, first_air_date DESC, id);
        CREATE TABLE IF NOT EXISTS seasons (
          show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE, source TEXT NOT NULL,
          number INTEGER NOT NULL, air_date TEXT, name TEXT, PRIMARY KEY(show_id, source, number)
        );
        CREATE INDEX IF NOT EXISTS season_date ON seasons(air_date DESC, show_id);
        CREATE TABLE IF NOT EXISTS show_airings (
          show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
          season INTEGER NOT NULL, episode INTEGER NOT NULL,
          air_date TEXT NOT NULL, name TEXT,
          PRIMARY KEY(show_id,season,episode)
        );
        CREATE INDEX IF NOT EXISTS show_airing_date ON show_airings(air_date DESC,show_id);
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (
          source TEXT NOT NULL, source_id INTEGER NOT NULL, due INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, PRIMARY KEY(source, source_id)
        );
        CREATE INDEX IF NOT EXISTS job_due ON jobs(source, due, source_id);
        CREATE TABLE IF NOT EXISTS overrides (
          source TEXT NOT NULL, source_id INTEGER NOT NULL, classification TEXT NOT NULL,
          reason TEXT NOT NULL, PRIMARY KEY(source, source_id)
        );
        CREATE TABLE IF NOT EXISTS fr_availability (
          tmdb_id INTEGER PRIMARY KEY, available INTEGER NOT NULL, checked_at INTEGER NOT NULL,
          evidence TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fr_offers (
          tmdb_id INTEGER NOT NULL, provider_id INTEGER NOT NULL, kind TEXT NOT NULL,
          name TEXT NOT NULL, logo TEXT, url TEXT, PRIMARY KEY(tmdb_id,provider_id,kind)
        );
        CREATE TABLE IF NOT EXISTS fr_providers (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, logo TEXT
        );
        CREATE TABLE IF NOT EXISTS fr_seen (
          scan_id TEXT NOT NULL, tmdb_id INTEGER NOT NULL, PRIMARY KEY(scan_id,tmdb_id)
        );
      `);
    }
  }

  close() { this.db.close(); }
  state(key, value) {
    if (value === undefined) return parse(this.db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value, null);
    this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, json(value));
    return value;
  }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.inTransaction = false; }
  }

  upsert(record) {
    return this.transaction(() => {
      const matches = this.db.prepare(`SELECT DISTINCT show_id FROM sources WHERE
        (source=? AND source_id=?) OR (imdb_id IS NOT NULL AND imdb_id=?) OR (tvdb_id IS NOT NULL AND tvdb_id=?)`)
        .all(record.source, record.sourceId, record.imdbId || null, record.tvdbId || null).map((r) => r.show_id);
      const id = matches.find((key) => key.startsWith('tmdb:')) || (record.source === 'tmdb' ? record.key : matches[0]) || record.key;
      this.db.prepare(`INSERT OR IGNORE INTO shows(id,title,genres,countries,languages,classification,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, record.title, '[]', '[]', '[]', 'review', Date.now());
      for (const old of matches.filter((key) => key !== id)) {
        this.db.prepare('INSERT OR REPLACE INTO seasons SELECT ?,source,number,air_date,name FROM seasons WHERE show_id=?').run(id, old);
        this.db.prepare('UPDATE sources SET show_id=? WHERE show_id=?').run(id, old);
        this.db.prepare('INSERT OR IGNORE INTO show_airings SELECT ?,season,episode,air_date,name FROM show_airings WHERE show_id=?').run(id, old);
        this.db.prepare('DELETE FROM shows WHERE id=?').run(old);
      }
      // Seasons are stored separately, keeping the primary payload compact.
      const payload = { ...record }; delete payload.seasons;
      this.db.prepare(`INSERT INTO sources VALUES (?,?,?,?,?,?,?) ON CONFLICT(source,source_id)
        DO UPDATE SET show_id=excluded.show_id,imdb_id=excluded.imdb_id,tvdb_id=excluded.tvdb_id,payload=excluded.payload,updated_at=excluded.updated_at`)
        .run(record.source, record.sourceId, id, record.imdbId || null, record.tvdbId || null, json(payload), Date.now());
      if (record.seasonsComplete) this.db.prepare('DELETE FROM seasons WHERE show_id=? AND source=?').run(id, record.source);
      const seasonInsert = this.db.prepare('INSERT OR REPLACE INTO seasons VALUES (?,?,?,?,?)');
      for (const s of record.seasons || []) if (s.number > 0) seasonInsert.run(id, record.source, s.number, s.date || null, s.name || null);
      if (record.source === 'tmdb') {
        const eventInsert = this.db.prepare('INSERT INTO show_airings VALUES (?,?,?,?,?) ON CONFLICT(show_id,season,episode) DO UPDATE SET air_date=excluded.air_date,name=excluded.name');
        for (const event of record.episodeEvents || []) eventInsert.run(id, event.season, event.episode, event.date, event.name);
      }
      this.rebuild(id);
      if (record.source === 'tmdb' && record.franceOffers !== undefined) this.setFranceOffers(record.sourceId, record.franceOffers);
      return id;
    });
  }

  rebuild(id) {
    const rows = this.db.prepare(`SELECT s.payload,o.classification AS override FROM sources s
      LEFT JOIN overrides o ON o.source=s.source AND o.source_id=s.source_id WHERE s.show_id=? ORDER BY CASE s.source WHEN 'tmdb' THEN 0 ELSE 1 END`).all(id);
    if (!rows.length) { this.db.prepare('DELETE FROM shows WHERE id=?').run(id); return; }
    const records = rows.map((r) => ({ ...parse(r.payload, {}), classification: r.override || parse(r.payload, {}).classification }));
    const pick = (key) => records.find((r) => r[key])?.[key] || null;
    const genres = unique(records.flatMap((r) => r.genres || []));
    const classification = records.some((r) => r.classification === 'animation') ? 'animation'
      : records.some((r) => r.classification === 'eligible') ? 'eligible' : 'review';
    this.db.prepare(`UPDATE shows SET title=?,original_title=?,description=?,first_air_date=?,poster=?,background=?,genres=?,countries=?,languages=?,status=?,classification=?,updated_at=? WHERE id=?`)
      .run(pick('title'), pick('originalTitle'), pick('description'), pick('firstAirDate'), pick('poster'), pick('background'), json(genres),
        json(unique(records.flatMap((r) => r.countries || []))), json(unique(records.flatMap((r) => r.languages || []))), pick('status'), classification, Date.now(), id);
  }

  removeSource(source, sourceId) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT show_id FROM sources WHERE source=? AND source_id=?').get(source, sourceId);
      if (!row) return;
      this.db.prepare('DELETE FROM sources WHERE source=? AND source_id=?').run(source, sourceId);
      this.db.prepare('DELETE FROM seasons WHERE source=? AND show_id=?').run(source, row.show_id);
      this.rebuild(row.show_id);
    });
  }

  override(source, sourceId, classification, reason) {
    if (!['eligible', 'animation', 'review'].includes(classification) || !String(reason).trim()) throw new Error('An override needs a valid classification and reason');
    this.db.prepare('INSERT OR REPLACE INTO overrides VALUES (?,?,?,?)').run(source, sourceId, classification, reason);
    const row = this.db.prepare('SELECT show_id FROM sources WHERE source=? AND source_id=?').get(source, sourceId);
    if (row) this.rebuild(row.show_id);
  }

  row(id) {
    let row = this.db.prepare('SELECT * FROM shows WHERE id=?').get(id);
    if (!row) {
      const alias = String(id).match(/^(tmdb|tvmaze):(\d+)$/);
      const source = alias
        ? this.db.prepare('SELECT show_id FROM sources WHERE source=? AND source_id=?').get(alias[1], Number(alias[2]))
        : this.db.prepare('SELECT show_id FROM sources WHERE imdb_id=? LIMIT 1').get(id);
      if (source) row = this.db.prepare('SELECT * FROM shows WHERE id=?').get(source.show_id);
    }
    return row || null;
  }
  sources(id) { return this.db.prepare('SELECT source,source_id,imdb_id,tvdb_id FROM sources WHERE show_id=?').all(id); }

  hasFranceSchema() {
    return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fr_availability'").get());
  }
  franceClause(alias = 's') {
    return `EXISTS (SELECT 1 FROM sources fsrc JOIN fr_availability fa ON fa.tmdb_id=fsrc.source_id WHERE fsrc.source='tmdb' AND fsrc.show_id=${alias}.id AND fa.available=1 AND fa.checked_at>${Date.now() - AVAILABILITY_TTL})`;
  }
  hasFranceAvailability(id) {
    if (!this.hasFranceSchema()) return false;
    return Boolean(this.db.prepare(`SELECT s.id FROM shows s WHERE s.id=? AND ${this.franceClause()}`).get(id));
  }
  setFranceOffers(tmdbId, offers) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM fr_offers WHERE tmdb_id=?').run(tmdbId);
      const insert = this.db.prepare('INSERT INTO fr_offers VALUES (?,?,?,?,?,?)');
      for (const offer of offers) insert.run(tmdbId, offer.providerId, offer.kind, offer.name, offer.logo || null, offer.url || null);
      this.db.prepare('INSERT OR REPLACE INTO fr_availability VALUES (?,?,?,?)').run(tmdbId, offers.length ? 1 : 0, Date.now(), 'watch-providers-FR');
    });
  }
  markFranceDiscovered(tmdbId) {
    // A recent explicit per-title negative check takes precedence over a stale
    // discovery index. A new detail job will re-evaluate it independently.
    this.db.prepare(`INSERT INTO fr_availability VALUES (?,1,?,'discover-FR') ON CONFLICT(tmdb_id)
      DO UPDATE SET available=1,checked_at=excluded.checked_at,evidence=excluded.evidence
      WHERE fr_availability.evidence!='watch-providers-FR' OR fr_availability.checked_at<?`)
      .run(tmdbId, Date.now(), Date.now() - 6 * 3600000);
  }
  franceOffers(id) {
    if (!this.hasFranceSchema()) return [];
    return this.db.prepare("SELECT DISTINCT o.* FROM fr_offers o JOIN sources s ON s.source='tmdb' AND s.source_id=o.tmdb_id WHERE s.show_id=? ORDER BY o.name,o.kind").all(id);
  }
  setFranceProviders(providers) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM fr_providers').run();
      const insert = this.db.prepare('INSERT INTO fr_providers VALUES (?,?,?)');
      for (const p of providers) insert.run(p.id, p.name, p.logo || null);
    });
  }
  franceProviders() { return this.hasFranceSchema() ? this.db.prepare('SELECT * FROM fr_providers ORDER BY name').all() : []; }

  query({ mode = 'premieres', genre = 'all', period = 'all', skip = 0, search = '', now = new Date() } = {}) {
    if (!GENRES.some((g) => g.id === genre) || !['premieres', 'seasons'].includes(mode)) throw new Error('Invalid catalog');
    if (!Number.isSafeInteger(skip) || skip < 0) throw new Error('Invalid skip');
    const window = windowFor(period, now);
    if (!this.hasFranceSchema()) return [];
    const clauses = ["s.classification='eligible'", this.franceClause()];
    const args = [];
    if (genre === 'unclassified') clauses.push("s.genres='[]'");
    else if (genre !== 'all') { clauses.push('EXISTS (SELECT 1 FROM json_each(s.genres) WHERE value=?)'); args.push(genre); }
    if (search) {
      clauses.push("(s.title LIKE ? ESCAPE '\\' OR s.original_title LIKE ? ESCAPE '\\')");
      const q = `%${search.replace(/[\\%_]/g, '\\$&')}%`; args.push(q, q);
    }
    if (mode === 'premieres') {
      // Prefer an airing inside the selected period; preserve original premieres
      // for new shows lacking an episode record. No duplicate show per period.
      const eventWhere = window.undated ? '1=0'
        : window.start ? 'e.air_date BETWEEN ? AND ?' : 'e.air_date<=?';
      const premiereWhere = window.undated ? 's.first_air_date IS NULL'
        : window.start ? 's.first_air_date BETWEEN ? AND ?' : 's.first_air_date<=?';
      const eventArgs = window.undated ? [] : window.start ? [window.start, window.end] : [window.end];
      const premiereArgs = window.undated ? [] : window.start ? [window.start, window.end] : [window.end];
      const noDate = window.undated ? 's.first_air_date IS NULL AND NOT EXISTS (SELECT 1 FROM show_airings e WHERE e.show_id=s.id)' : '0';
      const sql = `WITH live AS (
        SELECT s.*, COALESCE(
          (SELECT MAX(e.air_date) FROM show_airings e WHERE e.show_id=s.id AND ${eventWhere}),
          CASE WHEN ${premiereWhere} THEN s.first_air_date END
        ) AS event_date
        FROM shows s WHERE ${clauses.join(' AND ')}
      ) SELECT * FROM live
      WHERE event_date IS NOT NULL OR (${window.undated ? noDate : window.start ? '0' : 'first_air_date IS NULL'})
      ORDER BY event_date DESC,id ASC LIMIT 100 OFFSET ?`;
      const rows = this.db.prepare(sql).all(...eventArgs, ...premiereArgs, ...args, skip);
      return rows.map((row) => this.meta(row));
    }
    const date = mode === 'seasons' ? 'v.air_date' : 's.first_air_date';
    if (window.undated) clauses.push(`${date} IS NULL`);
    else if (window.start) { clauses.push(`${date} BETWEEN ? AND ?`); args.push(window.start, window.end); }
    else { clauses.push(`(${date}<=?${mode === 'premieres' ? ` OR ${date} IS NULL` : ''})`); args.push(window.end); }
    const joins = mode === 'seasons' ? `JOIN (SELECT show_id,number,COALESCE(MAX(CASE WHEN source='tmdb' THEN air_date END),MAX(air_date)) AS air_date FROM seasons WHERE number>1 GROUP BY show_id,number) v ON v.show_id=s.id` : '';
    // Return each show once in the period, using its latest qualifying season.
    const selection = mode === 'seasons' ? 's.*,MAX(v.air_date) AS event_date' : 's.*,s.first_air_date AS event_date';
    const rows = this.db.prepare(`SELECT ${selection} FROM shows s ${joins} WHERE ${clauses.join(' AND ')}
      ${mode === 'seasons' ? 'GROUP BY s.id' : ''} ORDER BY event_date DESC,s.id ASC LIMIT 100 OFFSET ?`).all(...args, skip);
    return rows.map((row) => this.meta(row));
  }

  meta(row) {
    const sources = this.sources(row.id);
    const imdb = sources.find((s) => s.imdb_id)?.imdb_id;
    const id = imdb || (row.id.startsWith('tmdb:') ? `tmdb:tv:${row.id.split(':')[1]}` : `tvmaze:${row.id.split(':')[1]}`);
    const date = row.event_date || row.first_air_date;
    const recentEpisode = date ? this.db.prepare('SELECT season,episode,name FROM show_airings WHERE show_id=? AND air_date=? ORDER BY season DESC,episode DESC LIMIT 1').get(row.id, date) : null;
    const genreIds = parse(row.genres);
    const tvmaze = sources.find((s) => s.source === 'tvmaze');
    const offers = this.franceOffers(row.id);
    const providers = [...new Set(offers.map((o) => o.name))];
    return {
      id, type: 'series', name: row.title, poster: row.poster || undefined, posterShape: 'poster',
      background: row.background || row.poster || undefined,
      streamingProviders: providers,
      description: [`Disponible en streaming en France${providers.length ? ` : ${providers.join(', ')}` : ''}. Disponibilité : JustWatch via TMDB.`,
        recentEpisode ? `Nouvel épisode : S${String(recentEpisode.season).padStart(2,'0')}E${String(recentEpisode.episode).padStart(2,'0')} · ${date}` : null,
        date ? `Première diffusion : ${row.first_air_date || 'inconnue'}${row.event_date && row.event_date !== row.first_air_date && !recentEpisode ? ` · Nouvelle saison : ${row.event_date}` : ''}` : 'Date de première diffusion inconnue', row.description,
        tvmaze ? `Données complémentaires : TVmaze · https://www.tvmaze.com/shows/${tvmaze.source_id}` : null].filter(Boolean).join('\n\n'),
      genres: GENRES.filter((g) => genreIds.includes(g.id)).map((g) => g.name),
      releaseInfo: row.first_air_date?.slice(0, 4) || 'Date inconnue',
      released: date ? `${date}T00:00:00.000Z` : undefined,
      episodeCode: recentEpisode ? `S${String(recentEpisode.season).padStart(2, '0')}E${String(recentEpisode.episode).padStart(2, '0')}` : undefined,
      status: row.status || undefined, imdb_id: imdb || undefined,
      links: [...sources.map((s) => ({ name: s.source === 'tmdb' ? 'TMDB' : 'TVmaze', category: 'Sources', url: s.source === 'tmdb' ? `https://www.themoviedb.org/tv/${s.source_id}` : `https://www.tvmaze.com/shows/${s.source_id}` })),
        ...[...new Set(offers.map((o) => o.url).filter(Boolean))].map((url) => ({ name: 'Disponibilité France · JustWatch', category: 'Regarder', url }))],
      behaviorHints: { hasScheduledVideos: true }
    };
  }

  enqueue(source, ids, due = 0, { refresh = false } = {}) {
    const statement = this.db.prepare(`INSERT INTO jobs(source,source_id,due) VALUES (?,?,?) ON CONFLICT(source,source_id) ${refresh ? 'DO UPDATE SET due=CASE WHEN jobs.due=0 THEN excluded.due ELSE MIN(jobs.due,excluded.due) END' : 'DO NOTHING'}`);
    this.transaction(() => { for (const id of ids) if (Number.isSafeInteger(id) && id > 0) statement.run(source, id, due); });
  }
  jobs(source, limit = 100, now = Date.now()) {
    return this.db.prepare('SELECT * FROM jobs WHERE source=? AND due<=? ORDER BY CASE WHEN due=0 THEN 1 ELSE 0 END,due,source_id DESC LIMIT ?').all(source, now, limit);
  }
  done(source, id, delay) { this.db.prepare('UPDATE jobs SET due=?,attempts=0,last_error=NULL WHERE source=? AND source_id=?').run(Date.now() + delay, source, id); }
  failed(source, id, error) {
    const attempts = this.db.prepare('SELECT attempts FROM jobs WHERE source=? AND source_id=?').get(source, id)?.attempts || 0;
    const delay = Math.min(86400000, 60000 * 2 ** Math.min(attempts, 10));
    this.db.prepare('UPDATE jobs SET due=?,attempts=attempts+1,last_error=? WHERE source=? AND source_id=?').run(Date.now() + delay, String(error?.message || error).slice(0, 160), source, id);
  }
  stats() {
    const counts = Object.fromEntries(this.db.prepare('SELECT classification,COUNT(*) AS count FROM shows GROUP BY classification').all().map((r) => [r.classification, r.count]));
    return {
      market: 'FR', eligible: this.hasFranceSchema() ? this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE s.classification='eligible' AND ${this.franceClause()}`).get().count : 0,
      animationExcluded: counts.animation || 0, awaitingClassification: counts.review || 0,
      withoutDate: this.hasFranceSchema() ? this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE s.classification='eligible' AND s.first_air_date IS NULL AND ${this.franceClause()}`).get().count : 0,
      sources: this.db.prepare('SELECT source,COUNT(*) AS count FROM sources GROUP BY source').all(),
      jobs: this.db.prepare('SELECT source,COUNT(*) AS total,SUM(CASE WHEN due<=? THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN attempts>0 THEN 1 ELSE 0 END) AS failed FROM jobs GROUP BY source').all(Date.now()),
      lastSync: this.state('lastSync'),
      franceLastDiscoveryAt: this.state('lastFranceDiscoveryAt'),
      franceLastAiringDiscoveryAt: this.state('lastFranceAirDiscoveryAt'),
      franceAirScan: this.state('frAirScanProgress'),
      indexedAirings: this.db.prepare('SELECT COUNT(*) AS total FROM show_airings').get().total,
      franceProviders: this.franceProviders().length,
      franceScan: this.state('frScanProgress'),
      coverage: 'Séries disponibles sur le marché français, toutes plateformes et offres recensées par JustWatch/TMDB. Animation exclue ; pays de production non filtré.'
    };
  }
}

module.exports = { SeriesStore, defaultPath };
