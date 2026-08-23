'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

function mockResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return payload; }
  };
}

function request(url, timezone = 'Europe/Brussels') {
  return {
    method: 'GET',
    url,
    headers: {
      host: 'example.vercel.app',
      'x-forwarded-proto': 'https',
      'x-vercel-ip-timezone': timezone
    }
  };
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body += value; }
  };
}

async function call(url, timezone) {
  const res = response();
  await handler(request(url, timezone), res);
  return { status: res.statusCode, headers: res.headers, body: res.body, json: JSON.parse(res.body) };
}

function clearCaches() {
  for (const key of ['catalogCache', 'detailsCache', 'providerCache', 'tvmazeCache', 'anilistCache', 'mappingCache']) {
    handler._internals[key].clear();
  }
}

function tmdbMovie(id = 101) {
  return {
    id,
    title: 'Fresh Film',
    overview: 'Fresh',
    popularity: 10,
    vote_count: 20,
    vote_average: 7.2,
    external_ids: { imdb_id: 'tt7654321' },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-08-23T00:00:00Z' }] }] },
    'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
    genres: [{ name: 'Drama' }]
  };
}

function tvEpisode() {
  return {
    id: 222,
    name: 'Tonight',
    season: 1,
    number: 2,
    airdate: '2026-08-23',
    airtime: '12:00',
    airstamp: '2026-08-23T12:00:00-04:00',
    runtime: 60,
    _embedded: { show: {
      id: 333,
      name: 'Network Show',
      language: 'English',
      genres: ['Drama'],
      status: 'Running',
      weight: 50,
      rating: { average: 7.5 },
      image: { original: 'https://img/show.jpg' },
      externals: { imdb: 'tt1234567' },
      network: { name: 'ABC', country: { code: 'US', timezone: 'America/New_York' } }
    } }
  };
}


function netflixWebEpisode() {
  return {
    id: 991,
    name: 'Drop Day',
    season: 2,
    number: 1,
    airdate: '2026-08-23',
    airtime: '',
    airstamp: '2026-08-23T00:00:00Z',
    runtime: 50,
    _embedded: { show: {
      id: 992,
      name: 'Netflix Fresh Series',
      externals: { imdb: 'tt9999999' },
      network: null,
      webChannel: { id: 1, name: 'Netflix', country: null }
    } }
  };
}

function netflixSeriesDetails() {
  return {
    id: 993,
    name: 'Netflix Fresh Series',
    first_air_date: '2026-08-23',
    popularity: 80,
    vote_count: 20,
    vote_average: 8,
    external_ids: { imdb_id: 'tt9999999' },
    'watch/providers': { results: { US: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } } },
    genres: [{ name: 'Drama' }]
  };
}

function animeSchedule() {
  return {
    id: 444,
    airingAt: Math.floor(new Date('2026-08-23T15:30:00Z').getTime() / 1000),
    episode: 8,
    mediaId: 555,
    media: {
      id: 555,
      title: { english: 'Exact Anime', romaji: 'Exact Anime', native: null },
      seasonYear: 2026,
      countryOfOrigin: 'JP',
      isAdult: false,
      popularity: 1000,
      averageScore: 80,
      genres: ['Action'],
      description: 'Anime',
      coverImage: { extraLarge: 'https://img/anime.jpg' },
      bannerImage: 'https://img/anime-bg.jpg'
    }
  };
}

function tmdbSeries() {
  return {
    id: 777,
    name: 'Exact Anime',
    first_air_date: '2026-01-01',
    original_language: 'ja',
    popularity: 100,
    vote_count: 20,
    vote_average: 8,
    external_ids: { imdb_id: 'tt8888888' },
    'watch/providers': { results: { US: { flatrate: [] } } },
    genres: [{ name: 'Animation' }]
  };
}

test('manifest route exposes v4 temporal catalogs', async () => {
  const result = await call('/manifest.json');
  assert.equal(result.status, 200);
  assert.equal(result.json.version, '4.0.1');
  assert.ok(result.json.catalogs.some((c) => c.id === 'us-tv-today'));
  assert.ok(result.json.catalogs.some((c) => c.id === 'anime-today'));
});

test('health checks TMDb, TVmaze and AniList without exposing secrets', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'super-secret';
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/configuration') return mockResponse(200, { images: {} });
    if (u.pathname === '/3/watch/providers/movie' || u.pathname === '/3/watch/providers/tv') {
      return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    }
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/shows/1') return mockResponse(200, { id: 1 });
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, { data: { Media: { id: 1 } } });
    throw new Error(`Unexpected ${u} ${options.method || 'GET'}`);
  };
  try {
    const result = await call('/health');
    assert.equal(result.status, 200);
    assert.equal(result.json.tmdb, 'ok');
    assert.equal(result.json.tvmaze, 'ok');
    assert.equal(result.json.anilist, 'ok');
    assert.equal(result.json.timezone, 'Europe/Brussels');
    assert.equal(result.body.includes('super-secret'), false);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('Netflix film route returns date-only streaming release', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') return mockResponse(200, { results: [{ id: 101 }], total_pages: 1 });
    if (u.pathname === '/3/movie/101') return mockResponse(200, tmdbMovie());
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/movie/netflix-movie-upcoming.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-23');
    assert.doesNotMatch(result.json.metas[0].releaseInfo, /00:00/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});


test('Netflix series route is validated by TVmaze web schedule and keeps same civil date', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/tv') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule/web') {
      return u.searchParams.get('date') === '2026-08-23' ? mockResponse(200, [netflixWebEpisode()]) : mockResponse(200, []);
    }
    if (u.pathname === '/3/find/tt9999999') return mockResponse(200, { tv_results: [{ id: 993 }] });
    if (u.pathname === '/3/tv/993') return mockResponse(200, netflixSeriesDetails());
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/series/netflix-series-upcoming.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.equal(result.json.metas[0].released, '2026-08-23');
    assert.doesNotMatch(result.json.metas[0].releaseInfo, /00:00/);
    assert.match(result.json.metas[0].description, /date streaming officielle/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});

test('TV USA route returns converted Belgian broadcast time', async () => {
  clearCaches();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule') return mockResponse(200, [tvEpisode()]);
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await call('/catalog/series/us-tv-today.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.match(result.json.metas[0].releaseInfo, /18:00/);
    assert.match(result.json.metas[0].description, /Diffusion US/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Anime route returns original airing converted locally, not fake Crunchyroll time', async () => {
  clearCaches();
  const old = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test';
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, {
      data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [animeSchedule()] } }
    });
    if (u.pathname === '/3/search/tv') return mockResponse(200, { results: [{
      id: 777, name: 'Exact Anime', original_name: 'Exact Anime', first_air_date: '2026-01-01', original_language: 'ja', popularity: 100
    }] });
    if (u.pathname === '/3/tv/777') return mockResponse(200, tmdbSeries());
    throw new Error(`Unexpected ${u} ${options.method || 'GET'}`);
  };
  try {
    const result = await call('/catalog/series/anime-today.json');
    assert.equal(result.status, 200);
    assert.equal(result.json.metas.length, 1);
    assert.match(result.json.metas[0].releaseInfo, /17:30/);
    assert.match(result.json.metas[0].description, /airing original AniList/);
    assert.doesNotMatch(result.json.metas[0].releaseInfo, /Crunchyroll/);
  } finally {
    global.fetch = originalFetch;
    if (old === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = old;
  }
});
