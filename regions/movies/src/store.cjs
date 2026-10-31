'use strict';

const { SeriesStore } = require('../../series/src/store.cjs');
const { AVAILABILITY_TTL } = require('../../series/src/france.cjs');
const { GENRES, VIEWS, catalogWindowFor } = require('./model.cjs');
const content = require('./content-policy.cjs');
const policy = require('../../series/src/catalog-policy.cjs');
const { RECORDS: PREMIERES } = require('../../../runtime/verified-streaming-premieres.cjs');
// Official positive evidence temporarily bridges delayed third-party FR provider indexes.
const VERIFIED_FR = PREMIERES.filter(p => p.market === 'FR' && p.type === 'movie');
// A past officially documented streaming premiere is a permanent historical
// release signal, not an expiring claim that an offer remains available today.
const premiereActive = (p, now = Date.now()) => now >= Date.parse(p.platformDate + 'T00:00:00Z');
const defaultPath = () => process.env.NUVIO_MOVIES_DB || '/var/lib/nuvio-movies/index.sqlite';
const parse = (value) => { try { return JSON.parse(value); } catch { return []; } };

// Reuse the proven identity, retry queue, transaction and provider storage.
// This is a separate database; movie IDs can never merge with TV series IDs.
class MovieStore extends SeriesStore {
  constructor(filename = defaultPath(), options = {}) {
    super(filename, options);
    this.db.function('nuvio_movie_content_kind', { deterministic: true }, (genres,title,originalTitle,description) =>
      content.contentKind({ genres: parse(genres), title, originalTitle, description }));
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
    if (!options.readonly && this.state('movieContentRevision') !== content.REVISION) {
      const ids=this.db.prepare("SELECT src.source_id FROM sources src JOIN shows s ON s.id=src.show_id WHERE src.source='tmdb' AND json_extract(src.payload,'$.movieContentKind') IS NULL AND (nuvio_movie_content_kind(s.genres,s.title,s.original_title,s.description)!='fiction')").all().map(r=>Number(r.source_id));
      this.enqueue('movie-detail',ids,1,{refresh:true});
      this.state('movieContentRevision',content.REVISION);
    }
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
  laneClause(kind, alias = 's', curated = false) {
    return `EXISTS (SELECT 1 FROM sources src JOIN movie_lanes ml ON ml.tmdb_id=src.source_id
      WHERE src.source='tmdb' AND src.show_id=${alias}.id AND ml.kind='${kind}' AND ml.available=1 AND ml.checked_at>${Date.now() - AVAILABILITY_TTL})
      ${curated ? `AND ${policy.offerClause(kind === 'vod' ? 'vod' : 'streaming',alias)}` : ''}`;
  }
  verifiedStreamingClause(alias = 's', now = new Date()) {
    const ids = VERIFIED_FR.filter(p => premiereActive(p, +new Date(now))).map(p => p.tmdbId);
    // This list contains only formally verified providers, never unproven discovery hits.
    return ids.length ? `EXISTS (SELECT 1 FROM sources verified_src
      WHERE verified_src.source='tmdb' AND verified_src.show_id=${alias}.id
      AND CAST(verified_src.source_id AS INTEGER) IN (${ids.join(',')}))` : '0';
  }
  admissionClause(view = 'all', genre = 'all', curated = false, alias = 's', now = new Date()) {
    const specialist = ['99','standup'].includes(genre);
    const streaming = `(${this.laneClause('streaming',alias,curated && !specialist)} OR ${curated ? this.verifiedStreamingClause(alias, now) : '0'})`;
    const vod = `(${this.laneClause('vod',alias,curated)})`;
    const cinema = `EXISTS (SELECT 1 FROM movie_releases r WHERE r.show_id=${alias}.id AND r.kind='cinema')`;
    const digital = `EXISTS (SELECT 1 FROM movie_releases r WHERE r.show_id=${alias}.id AND r.kind='digital')`;
    if (view === 'cinema') return cinema;
    if (view === 'streaming') return streaming;
    if (view === 'vod') return curated ? vod : `(${vod} OR ${digital})`;
    return `(${streaming} OR ${vod} OR ${cinema}${curated ? '' : ` OR ${digital}`})`;
  }
  visible(id, { curated = false } = {}) {
    return Boolean(this.db.prepare(`SELECT s.id FROM shows s WHERE s.id=? AND s.classification='eligible'
      AND ${curated ? `((${content.clause()} AND NOT ${policy.broadcastClause()} AND ${this.admissionClause('all','all',true)}) OR (${policy.genreClause('99')} AND ${content.clause('99')} AND ${this.admissionClause('all','99',true)}) OR (${content.clause('standup')} AND ${this.admissionClause('all','standup',true)}))`
        : this.admissionClause()}`).get(id));
  }
  finishMarket(scanId, kind) {
    this.db.prepare(`UPDATE movie_lanes SET available=0 WHERE kind=? AND tmdb_id NOT IN
      (SELECT tmdb_id FROM movie_seen WHERE scan_id=? AND lane=?)`).run(kind, scanId, kind);
    this.db.prepare('DELETE FROM movie_seen WHERE lane=? AND scan_id!=?').run(kind, scanId);
  }
  query({ view = 'all', genre = 'all', period = 'all', skip = 0, search = '', now = new Date(), curated = false } = {}) {
    if (!VIEWS.some((v) => v.id === view) || !GENRES.some((g) => g.id === genre)) throw new Error('Invalid catalog');
    if (!Number.isSafeInteger(skip) || skip < 0) throw new Error('Invalid skip');
    const window = catalogWindowFor(period, genre, now);
    if (!window) return [];
    if (curated && genre === 'unclassified') return [];
    const where = ["s.classification='eligible'", this.admissionClause(view,genre,curated,'s',now)];
    if (curated || genre === 'standup') where.push(content.clause(genre));
    if (curated && !['99','standup'].includes(genre)) where.push(`NOT ${policy.broadcastClause()}`);
    const args = [];
    if (genre === 'unclassified') where.push("s.genres='[]'");
    else if (!['all','standup'].includes(genre)) { where.push('EXISTS (SELECT 1 FROM json_each(s.genres) WHERE value=?)'); args.push(genre); }
    if (search) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.original_title LIKE ? ESCAPE '\\')");
      const value = `%${search.replace(/[\\%_]/g, '\\$&')}%`; args.push(value, value);
    }
    // All views use the first worldwide release. Regional reissues and later
    // streaming/VOD availability never move an old film into a new calendar.
    if (window.undated) where.push('s.first_air_date IS NULL');
    else if (window.start) { where.push('s.first_air_date BETWEEN ? AND ?'); args.push(window.start, window.end); }
    else { where.push('(s.first_air_date<=? OR s.first_air_date IS NULL)'); args.push(window.end); }
    // Ensure a verified world premiere cannot be pushed off the first page by
    // hundreds of later releases. Sorting happens before LIMIT/OFFSET so pages
    // remain mutually exclusive.
    const priority = curated && ['all','streaming'].includes(view)
      ? `CASE WHEN ${this.verifiedStreamingClause('s',now)} THEN 0 ELSE 1 END,` : '';
    const rows = this.db.prepare(`SELECT s.*,${content.sqlKind()} AS content_kind,s.first_air_date AS event_date,'original' AS event_kind
      FROM shows s WHERE ${where.join(' AND ')} ORDER BY ${priority}s.first_air_date DESC,s.id ASC LIMIT 100 OFFSET ?`).all(...args, skip);
    return rows.map((row) => this.meta(row, { curated, genre, view, now }));
  }
  contentKind(row) {
    return this.db.prepare(`SELECT ${content.sqlKind()} AS kind FROM shows s WHERE s.id=?`).get(row.id)?.kind || 'review';
  }
  meta(row, { curated = false, genre = 'all', view = 'all', now = new Date() } = {}) {
    const source = this.sources(row.id).find((s) => s.source === 'tmdb');
    const imdb = source?.imdb_id;
    const official = VERIFIED_FR.find(p => p.tmdbId === Number(source?.source_id) && premiereActive(p, +new Date(now)));
    const id = imdb || `tmdb:movie:${source?.source_id || row.id.split(':')[1]}`;
    const offers = this.franceOffers(row.id).filter((o) => (!curated || ['99','standup'].includes(genre)
      || (view !== 'vod' && policy.allowedOffer(o)) || (view !== 'streaming' && policy.allowedOffer(o,'vod')))
      && this.db.prepare(`SELECT 1 FROM movie_lanes WHERE tmdb_id=?
      AND kind=? AND available=1 AND checked_at>?`).get(o.tmdb_id, ['rent', 'buy'].includes(o.kind) ? 'vod' : 'streaming', Date.now() - AVAILABILITY_TTL));
    const providers = [...new Set([...offers.map((o) => o.name), ...(official && view !== 'vod' ? [official.providerLabel] : [])])];
    const providersByKind = {
      streaming: [...new Set([...offers.filter((o) => ['flatrate', 'free', 'ads'].includes(o.kind)).map((o) => o.name), ...(official ? [official.providerLabel] : [])])],
      vod: [...new Set(offers.filter((o) => ['rent', 'buy'].includes(o.kind)).map((o) => o.name))]
    };
    const date = row.event_date || row.first_air_date;
    const releases = this.db.prepare('SELECT kind,date FROM movie_releases WHERE show_id=? ORDER BY date DESC').all(row.id);
    const dateLabel = row.event_kind === 'cinema' ? 'Sortie cinéma France' : row.event_kind === 'digital' ? 'Sortie numérique France' : 'Première sortie du film';
    return {
      id, type: 'movie', name: row.title, poster: row.poster || undefined, posterShape: 'poster',
      background: row.background || row.poster || undefined, streamingProviders: providers, providersByKind,
      movieContentKind: row.content_kind || this.contentKind(row),
      movieReleaseKind: 'original', originalReleaseDate: row.first_air_date || null,
      description: [date ? `${dateLabel} : ${date}` : 'Date de sortie inconnue',
        providers.length ? `Plateformes / offres France confirmées : ${providers.join(', ')}.` : 'Dates de sorties référencées ; disponibilité actuelle du film à vérifier.',
        'Dates : TMDB et preuves officielles de festival quand disponibles · Disponibilités : annonces officielles et JustWatch via TMDB. La date de sortie ne constitue pas une date d’arrivée sur chaque plateforme.',
        ...(official ? [`Sortie ${official.providerLabel} France : ${official.platformDate} (annonce officielle, distincte de la première mondiale).`] : []),
        ...releases.slice(0, 8).map((r) => `${r.kind === 'cinema' ? 'Cinéma France' : 'Numérique France'} : ${r.date}`), row.description].filter(Boolean).join('\n\n'),
      genres: genre === 'standup' ? ['Stand-up'] : GENRES.filter((g) => parse(row.genres).includes(g.id)).map((g) => g.name),
      releaseInfo: row.first_air_date?.slice(0, 4) || 'Date inconnue', released: date ? `${date}T00:00:00.000Z` : undefined,
      imdb_id: imdb || undefined, links: [
        { name: 'TMDB', category: 'Sources', url: `https://www.themoviedb.org/movie/${source?.source_id}` },
        ...(official ? [{ name: `Regarder sur ${official.providerLabel}`, category: 'Regarder', url: official.watchUrl },
          { name: 'Sortie streaming vérifiée', category: 'Sources', url: official.officialSource },
          ...(official.worldPremiereSource ? [{ name: 'Première mondiale vérifiée', category: 'Sources', url: official.worldPremiereSource }] : [])] : []),
        ...[...new Set(offers.map((o) => o.url).filter(Boolean))].map((url) => ({ name: 'France · JustWatch', category: 'Regarder', url }))
      ]
    };
  }
  stats({ curated = false } = {}) {
    return {
      market: 'FR', eligible: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE classification='eligible'
        AND ${this.admissionClause('all','all',curated)} ${curated ? `AND NOT ${policy.broadcastClause()} AND ${content.clause()}` : ''}`).get().count,
      streaming: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE classification='eligible' AND (${this.laneClause('streaming','s',curated)})
        ${curated ? `AND NOT ${policy.broadcastClause()} AND ${content.clause()}` : ''}`).get().count,
      vodAvailable: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE classification='eligible' AND (${this.laneClause('vod','s',curated)})
        ${curated ? `AND NOT ${policy.broadcastClause()} AND ${content.clause()}` : ''}`).get().count,
      cinemaReleases: this.db.prepare('SELECT COUNT(*) AS count FROM movie_releases WHERE kind=\'cinema\'').get().count,
      digitalReleases: this.db.prepare('SELECT COUNT(*) AS count FROM movie_releases WHERE kind=\'digital\'').get().count,
      animationExcluded: this.db.prepare("SELECT COUNT(*) AS count FROM shows WHERE classification='animation'").get().count,
      awaitingClassification: this.db.prepare("SELECT COUNT(*) AS count FROM shows WHERE classification='review'").get().count,
      franceProviders: this.franceProviders().length, lastSync: this.state('lastSync'),
      scans: Object.fromEntries(['streaming', 'vod', 'cinema', 'digital', 'recent'].map((kind) => [kind, this.state(`scan:${kind}`)])),
      jobs: this.db.prepare('SELECT COUNT(*) AS total,SUM(CASE WHEN due<=? THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN attempts>0 THEN 1 ELSE 0 END) AS failed FROM jobs').get(Date.now()),
      datePolicy: 'first-release-worldwide',
      filmContentPolicy: content.metadata(),
      awaitingFormat: this.db.prepare(`SELECT COUNT(*) AS count FROM shows s WHERE s.classification='eligible' AND ${content.sqlKind()}='review'`).get().count,
      ...(curated ? { catalogPolicy: policy.policy() } : {}),
      coverage: 'Films de tous pays, classés par première sortie mondiale. Les ressorties cinéma/VOD ne changent pas la date du film. Animation exclue.'
    };
  }
}
module.exports = { MovieStore, defaultPath };
