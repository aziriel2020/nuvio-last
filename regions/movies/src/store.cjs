'use strict';

const { SeriesStore } = require('../../series/src/store.cjs');
const { AVAILABILITY_TTL } = require('../../series/src/france.cjs');
const { GENRES, VIEWS, catalogWindowFor } = require('./model.cjs');
const defaultPath = () => process.env.NUVIO_MOVIES_DB || '/var/lib/nuvio-movies/index.sqlite';
const parse = (value) => { try { return JSON.parse(value); } catch { return []; } };

// Reuse the proven identity, retry queue, transaction and provider storage.
// This is a separate database; movie IDs can never merge with TV series IDs.
class MovieStore extends SeriesStore {
  constructor(filename = defaultPath(), options = {}) {
    super(filename, options);
    if (!options.readonly) this.db.exec(`
      CREATE TABLE IF NOT EXISTS movie_releases (
        show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, date TEXT NOT NULL, proof TEXT NOT NULL,
        PRIMARY KEY(show_id,kind,date)
      );
      CREATE INDEX IF NOT EXISTS movie_release_date ON movie_releases(kind,date DESC,show_id);
      CREATE TABLE IF NOT EXISTS movie_lanes (
        tmdb_id INTEGER NOT NULL, kind TEXT NOT NULL, available INTEGER NOT NULL,
        checked_at INTEGER NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(tmdb_id,kind)
      );
      CREATE TABLE IF NOT EXISTS movie_seen (
        scan_id TEXT NOT NULL, lane TEXT NOT NULL, tmdb_id INTEGER NOT NULL,
        PRIMARY KEY(scan_id,lane,tmdb_id)
      );
    `);
  }
  upsert(record) {
    return this.transaction(() => {
      const id = super.upsert(record);
      if (record.releasesComplete) this.db.prepare('DELETE FROM movie_releases WHERE show_id=?').run(id);
      for (const event of record.releases || []) this.addRelease(id, event.kind, event.date, event.proof);
      return id;
    });
  }
  addRelease(id, kind, date, proof = 'discover.FR') {
    if (!['cinema', 'digital'].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid release evidence');
    this.db.prepare(`INSERT INTO movie_releases VALUES (?,?,?,?) ON CONFLICT(show_id,kind,date)
      DO UPDATE SET proof=CASE WHEN movie_releases.proof='release_dates.FR' THEN movie_releases.proof ELSE excluded.proof END`)
      .run(id, kind, date, proof);
  }
  setFranceOffers(tmdbId, offers) {
    return this.transaction(() => {
      super.setFranceOffers(tmdbId, offers);
      const put = this.db.prepare('INSERT OR REPLACE INTO movie_lanes VALUES (?,?,?,?,?)');
      for (const kind of ['streaming', 'vod']) {
        const types = kind === 'streaming' ? ['flatrate', 'free', 'ads'] : ['rent', 'buy'];
        put.run(tmdbId, kind, offers.some((o) => types.includes(o.kind)) ? 1 : 0, Date.now(), 'watch-providers-FR');
      }
    });
  }
  markDiscovered(tmdbId, kind) {
    this.markFranceDiscovered(tmdbId);
    this.db.prepare(`INSERT INTO movie_lanes VALUES (?,?,1,?,'discover-FR') ON CONFLICT(tmdb_id,kind)
      DO UPDATE SET available=1,checked_at=excluded.checked_at,evidence=excluded.evidence
      WHERE movie_lanes.evidence!='watch-providers-FR' OR movie_lanes.checked_at<?`)
      .run(tmdbId, kind, Date.now(), Date.now() - 6 * 3600000);
  }
  laneClause(kind, alias = 's') {
    return `EXISTS (SELECT 1 FROM sources src JOIN movie_lanes ml ON ml.tmdb_id=src.source_id
      WHERE src.source='tmdb' AND src.show_id=${alias}.id AND ml.kind='${kind}' AND ml.available=1 AND ml.checked_at>${Date.now() - AVAILABILITY_TTL})`;
  }
  visible(id) {
    return Boolean(this.db.prepare(`SELECT s.id FROM shows s WHERE s.id=? AND s.classification='eligible'
      AND (${this.laneClause('streaming')} OR ${this.laneClause('vod')}
        OR EXISTS (SELECT 1 FROM movie_releases r WHERE r.show_id=s.id))`).get(id));
  }
  finishMarket(scanId, kind) {
    this.db.prepare(`UPDATE movie_lanes SET available=0 WHERE kind=? AND tmdb_id NOT IN
      (SELECT tmdb_id FROM movie_seen WHERE scan_id=? AND lane=?)`).run(kind, scanId, kind);
    this.db.prepare('DELETE FROM movie_seen WHERE lane=? AND scan_id!=?').run(kind, scanId);
  }
  query({ view = 'all', genre = 'all', period = 'all', skip = 0, search = '', now = new Date() } = {}) {
    if (!VIEWS.some((v) => v.id === view) || !GENRES.some((g) => g.id === genre)) throw new Error('Invalid catalog');
    if (!Number.isSafeInteger(skip) || skip < 0) throw new Error('Invalid skip');
    const window = catalogWindowFor(period, genre, now);
    if (!window) return [];
    const events = [];
    if (view === 'all' || view === 'cinema') events.push("SELECT show_id,date AS event_date,'cinema' AS event_kind,3 AS priority FROM movie_releases WHERE kind='cinema'");
    if (view === 'all' || view === 'vod') events.push("SELECT show_id,date AS event_date,'digital' AS event_kind,2 AS priority FROM movie_releases WHERE kind='digital'");
    if (view === 'all' || view === 'streaming' || view === 'vod') {
      const available = view === 'all' ? `(${this.laneClause('streaming')} OR ${this.laneClause('vod')})` : this.laneClause(view);
      events.push(`SELECT s.id AS show_id,s.first_air_date AS event_date,'original' AS event_kind,1 AS priority FROM shows s WHERE ${available}`);
      if (view === 'streaming') events.push(`SELECT r.show_id,r.date,'digital',2 FROM movie_releases r JOIN shows s ON s.id=r.show_id
        WHERE r.kind='digital' AND ${available}`);
    }
    const where = ["s.classification='eligible'"];
    const args = [];
    if (genre === 'unclassified') where.push("s.genres='[]'");
    else if (genre !== 'all') { where.push('EXISTS (SELECT 1 FROM json_each(s.genres) WHERE value=?)'); args.push(genre); }
    if (search) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.original_title LIKE ? ESCAPE '\\')");
      const value = `%${search.replace(/[\\%_]/g, '\\$&')}%`; args.push(value, value);
    }
    if (window.undated) where.push('e.event_date IS NULL');
    else if (window.start) { where.push('e.event_date BETWEEN ? AND ?'); args.push(window.start, window.end); }
    else { where.push('(e.event_date<=? OR e.event_date IS NULL)'); args.push(window.end); }
    const rows = this.db.prepare(`WITH events AS (${events.join(' UNION ALL ')}), ranked AS (
      SELECT s.*,e.event_date,e.event_kind,ROW_NUMBER() OVER(PARTITION BY s.id ORDER BY e.event_date DESC,e.priority DESC) AS position
      FROM events e JOIN shows s ON s.id=e.show_id WHERE ${where.join(' AND ')}
    ) SELECT * FROM ranked WHERE position=1 ORDER BY event_date DESC,id ASC LIMIT 100 OFFSET ?`).all(...args, skip);
    return rows.map((row) => this.meta(row));
  }
  meta(row) {
    const source = this.sources(row.id).find((s) => s.source === 'tmdb');
    const imdb = source?.imdb_id;
    const id = imdb || `tmdb:movie:${source?.source_id || row.id.split(':')[1]}`;
    const offers = this.franceOffers(row.id).filter((o) => this.db.prepare(`SELECT 1 FROM movie_lanes WHERE tmdb_id=?
      AND kind=? AND available=1 AND checked_at>?`).get(o.tmdb_id, ['rent', 'buy'].includes(o.kind) ? 'vod' : 'streaming', Date.now() - AVAILABILITY_TTL));
    const providers = [...new Set(offers.map((o) => o.name))];
    const providersByKind = {
      streaming: [...new Set(offers.filter((o) => ['flatrate', 'free', 'ads'].includes(o.kind)).map((o) => o.name))],
      vod: [...new Set(offers.filter((o) => ['rent', 'buy'].includes(o.kind)).map((o) => o.name))]
    };
    const date = row.event_date || row.first_air_date;
    const releases = this.db.prepare('SELECT kind,date FROM movie_releases WHERE show_id=? ORDER BY date DESC').all(row.id);
    const dateLabel = row.event_kind === 'cinema' ? 'Sortie cinéma France' : row.event_kind === 'digital' ? 'Sortie numérique France' : 'Première sortie du film';
    return {
      id, type: 'movie', name: row.title, poster: row.poster || undefined, posterShape: 'poster',
      background: row.background || row.poster || undefined, streamingProviders: providers, providersByKind,
      movieReleaseKind: row.event_kind || 'original',
      description: [date ? `${dateLabel} : ${date}` : 'Date de sortie inconnue',
        providers.length ? `Offres France : ${providers.join(', ')}.` : 'Dates de sorties référencées ; disponibilité actuelle du film à vérifier.',
        'Dates : TMDB · Disponibilités : JustWatch via TMDB. La date de sortie ne constitue pas une date d’arrivée sur chaque plateforme.',
        ...releases.slice(0, 8).map((r) => `${r.kind === 'cinema' ? 'Cinéma France' : 'Numérique France'} : ${r.date}`), row.description].filter(Boolean).join('\n\n'),
      genres: GENRES.filter((g) => parse(row.genres).includes(g.id)).map((g) => g.name),
      releaseInfo: row.first_air_date?.slice(0, 4) || 'Date inconnue', released: date ? `${date}T00:00:00.000Z` : undefined,
      imdb_id: imdb || undefined, links: [
        { name: 'TMDB', category: 'Sources', url: `https://www.themoviedb.org/movie/${source?.source_id}` },
        ...[...new Set(offers.map((o) => o.url).filter(Boolean))].map((url) => ({ name: 'France · JustWatch', category: 'Regarder', url }))
      ]
    };
  }
  stats() {
    return {
      market: 'FR', eligible: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE classification='eligible'
        AND (EXISTS(SELECT 1 FROM movie_releases r WHERE r.show_id=s.id) OR ${this.laneClause('streaming')} OR ${this.laneClause('vod')} )`).get().count,
      streaming: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE classification='eligible' AND ${this.laneClause('streaming')}`).get().count,
      vodAvailable: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE classification='eligible' AND ${this.laneClause('vod')}`).get().count,
      cinemaReleases: this.db.prepare('SELECT COUNT(*) AS count FROM movie_releases WHERE kind=\'cinema\'').get().count,
      digitalReleases: this.db.prepare('SELECT COUNT(*) AS count FROM movie_releases WHERE kind=\'digital\'').get().count,
      animationExcluded: this.db.prepare("SELECT COUNT(*) AS count FROM shows WHERE classification='animation'").get().count,
      awaitingClassification: this.db.prepare("SELECT COUNT(*) AS count FROM shows WHERE classification='review'").get().count,
      franceProviders: this.franceProviders().length, lastSync: this.state('lastSync'),
      scans: Object.fromEntries(['streaming', 'vod', 'cinema', 'digital', 'recent'].map((kind) => [kind, this.state(`scan:${kind}`)])),
      jobs: this.db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN due<=? THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN attempts>0 THEN 1 ELSE 0 END) AS failed FROM jobs').get(Date.now()),
      coverage: 'Films de tous pays : offres streaming/VOD FR et sorties cinéma/numériques FR référencées par TMDB/JustWatch. Animation exclue. Les scans complets sont paginés et repris sans plafond local de titres.'
    };
  }
}
module.exports = { MovieStore, defaultPath };
