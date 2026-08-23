'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calendar = require('../src/calendar');
const api = require('../api/index');
const { parseEnv } = require('../src/env');

const {
  EVENT_MODES,
  localIsoDate,
  localTime,
  dateWindow,
  viewerDateTimeFromInstant,
  zonedDateTimeToUtc,
  viewerWindowEpochBounds,
  buildInstantEvent,
  buildStreamingDateEvent,
  selectDigitalRelease,
  selectRelevantEpisode,
  hasProviderInFlatrate,
  movieDetailsToMeta,
  seriesDetailsToMeta,
  sortAndDedupeMetas,
  catalogCacheKey
} = calendar;

const fixedNow = new Date('2026-08-23T15:00:00Z');
const week = dateWindow('week', fixedNow, 'Europe/Brussels');
const netflixIds = [8, 1796];

function movieDetails({ id = 1, digitalDate, providerIds = netflixIds, title = 'Movie', popularity = 10, voteCount = 100 } = {}) {
  return {
    id,
    title,
    overview: 'Description',
    release_date: digitalDate,
    vote_average: 7.4,
    vote_count: voteCount,
    popularity,
    external_ids: { imdb_id: `tt${String(id).padStart(7, '0')}` },
    release_dates: {
      results: digitalDate ? [{
        iso_3166_1: 'US',
        release_dates: [{ type: 4, release_date: `${digitalDate}T00:00:00.000Z` }]
      }] : []
    },
    'watch/providers': {
      results: {
        US: { flatrate: providerIds.map((provider_id) => ({ provider_id, provider_name: 'Netflix' })) }
      }
    },
    genres: [{ name: 'Drama' }]
  };
}

function seriesDetails({ id = 2, firstAir = '2024-01-01', lastEpisode = null, nextEpisode = null, providerIds = netflixIds, name = 'Series' } = {}) {
  return {
    id,
    name,
    first_air_date: firstAir,
    vote_average: 8,
    vote_count: 50,
    popularity: 30,
    external_ids: { imdb_id: `tt${String(id).padStart(7, '0')}` },
    last_episode_to_air: lastEpisode,
    next_episode_to_air: nextEpisode,
    'watch/providers': {
      results: {
        US: { flatrate: providerIds.map((provider_id) => ({ provider_id, provider_name: 'Netflix' })) }
      }
    },
    genres: [{ name: 'Animation' }]
  };
}

function tvmazeEpisode({
  id = 9001,
  airstamp = '2026-08-23T21:00:00-04:00',
  airdate = '2026-08-23',
  airtime = '21:00',
  season = 3,
  number = 4,
  network = true,
  imdb = 'tt1234567'
} = {}) {
  return {
    id,
    name: 'Fresh Episode',
    season,
    number,
    airdate,
    airtime,
    airstamp,
    runtime: 60,
    summary: '<p>Episode summary</p>',
    _embedded: {
      show: {
        id: 99,
        name: 'US Show',
        language: 'English',
        genres: ['Drama'],
        status: 'Running',
        runtime: 60,
        weight: 90,
        rating: { average: 8.2 },
        image: { medium: 'https://img/medium.jpg', original: 'https://img/original.jpg' },
        externals: { imdb },
        network: network ? {
          id: 1,
          name: 'ABC',
          country: { name: 'United States', code: 'US', timezone: 'America/New_York' }
        } : null,
        webChannel: network ? null : { id: 2, name: 'Some Streamer', country: { code: 'US', timezone: 'America/New_York' } }
      }
    }
  };
}


function tvmazeWebEpisode({
  id = 9100,
  airdate = '2026-08-24',
  airtime = '',
  airstamp = '2026-08-24T00:00:00+00:00',
  provider = 'Netflix',
  localCountry = null,
  imdb = 'tt7654321'
} = {}) {
  return {
    id,
    name: 'Streaming Episode',
    season: 2,
    number: 3,
    airdate,
    airtime,
    airstamp,
    runtime: 45,
    summary: '<p>Streaming episode</p>',
    _embedded: {
      show: {
        id: 120,
        name: 'Streaming Show',
        externals: { imdb, thetvdb: 123 },
        webChannel: {
          id: 50,
          name: provider,
          country: localCountry ? { code: localCountry, timezone: 'America/Los_Angeles' } : null
        },
        network: null
      }
    }
  };
}

function animeSchedule({
  id = 501,
  airingAt = Math.floor(new Date('2026-08-23T15:30:00Z').getTime() / 1000),
  episode = 8,
  mediaId = 700,
  title = 'Exact Anime',
  seasonYear = 2026
} = {}) {
  return {
    id,
    airingAt,
    episode,
    mediaId,
    media: {
      id: mediaId,
      idMal: 42,
      title: { english: title, romaji: title, native: null },
      seasonYear,
      countryOfOrigin: 'JP',
      format: 'TV',
      status: 'RELEASING',
      isAdult: false,
      duration: 24,
      popularity: 10000,
      averageScore: 82,
      genres: ['Action'],
      description: 'Anime description',
      coverImage: { extraLarge: 'https://img/anime.jpg', large: 'https://img/anime-small.jpg' },
      bannerImage: 'https://img/banner.jpg'
    }
  };
}

function mockResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    async json() { return payload; }
  };
}

function resetCaches() {
  for (const key of ['catalogCache', 'detailsCache', 'providerCache', 'tvmazeCache', 'anilistCache', 'mappingCache']) {
    api._internals[key].clear();
  }
}

function withTmdbToken(fn) {
  const previous = process.env.TMDB_READ_TOKEN;
  process.env.TMDB_READ_TOKEN = 'test-token';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.TMDB_READ_TOKEN;
      else process.env.TMDB_READ_TOKEN = previous;
    });
}

test('viewer dates diverge correctly near midnight', () => {
  const nearMidnight = new Date('2026-08-24T00:30:00Z');
  assert.equal(localIsoDate(nearMidnight, 'Europe/Brussels'), '2026-08-24');
  assert.equal(localIsoDate(nearMidnight, 'America/Los_Angeles'), '2026-08-23');
});

test('rolling week is today through J+6 and upcoming is tomorrow through J+6', () => {
  assert.deepEqual(week, { start: '2026-08-23', end: '2026-08-29', kind: 'week', today: '2026-08-23' });
  assert.deepEqual(dateWindow('upcoming', fixedNow, 'Europe/Brussels'), {
    start: '2026-08-24', end: '2026-08-29', kind: 'upcoming', today: '2026-08-23'
  });
});

test('streaming calendar date stays the same instead of becoming midnight timestamp', () => {
  const result = buildStreamingDateEvent('2026-08-24', week, 'Netflix');
  assert.equal(result.event.eventMode, EVENT_MODES.STREAMING_DATE);
  assert.equal(result.event.calendarDate, '2026-08-24');
  assert.equal(result.event.viewerDate, '2026-08-24');
  assert.equal(result.event.eventInstant, null);
  assert.equal(result.event.viewerTime, null);
});

test('US 21:00 ET becomes next day 03:00 in Brussels in summer', () => {
  const viewer = viewerDateTimeFromInstant('2026-08-23T21:00:00-04:00', 'Europe/Brussels');
  assert.equal(viewer.date, '2026-08-24');
  assert.equal(viewer.time, '03:00');
});

test('US 21:00 PT becomes next day 06:00 in Brussels in summer', () => {
  const viewer = viewerDateTimeFromInstant('2026-08-23T21:00:00-07:00', 'Europe/Brussels');
  assert.equal(viewer.date, '2026-08-24');
  assert.equal(viewer.time, '06:00');
});

test('DST is not hardcoded to +6 hours', () => {
  const source = zonedDateTimeToUtc('2026-03-15', 'America/New_York', '21:00:00');
  assert.equal(source.toISOString(), '2026-03-16T01:00:00.000Z');
  const brussels = viewerDateTimeFromInstant(source, 'Europe/Brussels');
  assert.equal(brussels.date, '2026-03-16');
  assert.equal(brussels.time, '02:00');
});

test('viewer window epoch bounds respect local midnight', () => {
  const window = dateWindow('today', new Date('2026-08-23T10:00:00Z'), 'Europe/Brussels');
  const bounds = viewerWindowEpochBounds(window, 'Europe/Brussels');
  assert.equal(new Date(bounds.startMs).toISOString(), '2026-08-22T22:00:00.000Z');
  assert.equal(new Date(bounds.endExclusiveMs).toISOString(), '2026-08-23T22:00:00.000Z');
});

test('film yesterday is excluded, today included, 10 days outside', () => {
  assert.equal(selectDigitalRelease(movieDetails({ digitalDate: '2026-08-22' }), week).reason, 'past');
  assert.ok(movieDetailsToMeta(movieDetails({ digitalDate: '2026-08-23' }), 'Netflix', week).meta);
  assert.equal(selectDigitalRelease(movieDetails({ digitalDate: '2026-09-02' }), week).reason, 'outside-window');
});

test('old 2024 movie still on Netflix is excluded', () => {
  const details = movieDetails({ digitalDate: '2024-10-10', providerIds: netflixIds });
  assert.equal(hasProviderInFlatrate(details, netflixIds), true);
  const result = movieDetailsToMeta(details, 'Netflix', week);
  assert.equal(result.meta, null);
  assert.equal(result.reason, 'past');
});

test('movie with no reliable digital US date is excluded', () => {
  assert.equal(movieDetailsToMeta(movieDetails({ digitalDate: null }), 'Netflix', week).reason, 'date-unknown');
});

test('series from 2024 with episode today is included as streaming date only', () => {
  const details = seriesDetails({
    firstAir: '2024-02-01',
    lastEpisode: { season_number: 3, episode_number: 4, air_date: '2026-08-23' },
    nextEpisode: { season_number: 3, episode_number: 5, air_date: '2026-08-30' }
  });
  const result = seriesDetailsToMeta(details, 'Netflix', week);
  assert.ok(result.meta);
  assert.equal(result.meta.released, '2026-08-23');
  assert.match(result.meta.releaseInfo, /S03E04/);
  assert.doesNotMatch(result.meta.releaseInfo, /00:00/);
  assert.equal(result.event.eventInstant, null);
});

test('series with last episode yesterday and no future episode is excluded', () => {
  const details = seriesDetails({
    firstAir: '2026-01-01',
    lastEpisode: { season_number: 1, episode_number: 8, air_date: '2026-08-22' },
    nextEpisode: null
  });
  assert.equal(selectRelevantEpisode(details, week).reason, 'past');
});

test('wrong provider and missing US provider are rejected', () => {
  const wrong = movieDetails({ digitalDate: '2026-08-23', providerIds: [9] });
  assert.equal(hasProviderInFlatrate(wrong, netflixIds), false);
  const noUs = { ...wrong, 'watch/providers': { results: { GB: { flatrate: [{ provider_id: 8 }] } } } };
  assert.equal(hasProviderInFlatrate(noUs, netflixIds), false);
});

test('timed events sort before date-only events on the same day', () => {
  const timed = { id: 'tt1', name: 'Timed', released: '2026-08-24', _dedupeKey: 'a', _eventInstantMs: 100, _popularity: 1 };
  const dateOnly = { id: 'tt2', name: 'Date', released: '2026-08-24', _dedupeKey: 'b', _eventInstantMs: null, _popularity: 99 };
  const output = sortAndDedupeMetas([dateOnly, timed]);
  assert.equal(output[0].id, 'tt1');
});

test('cache key includes provider/type/period/timezone/local date and changes next day', () => {
  const first = catalogCacheKey({ providerSlug: 'netflix', type: 'movie', period: 'week', timeZone: 'Europe/Brussels', today: '2026-08-23', sourceVersion: 'x' });
  const second = catalogCacheKey({ providerSlug: 'netflix', type: 'movie', period: 'week', timeZone: 'Europe/Brussels', today: '2026-08-24', sourceVersion: 'x' });
  assert.notEqual(first, second);
  assert.match(first, /Europe\/Brussels:2026-08-23/);
});

test('manifest is platform-first and adds TV USA + Anime calendars', () => {
  const manifest = api._internals.buildManifest('https://example.com');
  assert.equal(manifest.version, '4.0.1');
  assert.equal(manifest.catalogs[0].name, 'Netflix • Films');
  assert.equal(manifest.catalogs[1].name, 'Netflix • Séries');
  assert.equal(manifest.catalogs[2].name, 'Prime Video • Films');
  assert.ok(manifest.catalogs.some((c) => c.id === 'us-tv-today'));
  assert.ok(manifest.catalogs.some((c) => c.id === 'us-tv-upcoming'));
  assert.ok(manifest.catalogs.some((c) => c.id === 'anime-today'));
  assert.ok(manifest.catalogs.some((c) => c.id === 'anime-upcoming'));
  assert.equal(manifest.catalogs.length, 22);
});

test('provider aliases resolve dynamically without hardcoded IDs', () => {
  const prime = api._internals.PROVIDERS.find((p) => p.slug === 'prime-video');
  const resolved = api._internals.resolveProviderFromDirectory(prime, [
    { id: 9, name: 'Amazon Prime Video', normalized: api._internals.normalizeProviderName('Amazon Prime Video') },
    { id: 119, name: 'Amazon Prime Video with Ads', normalized: api._internals.normalizeProviderName('Amazon Prime Video with Ads') }
  ]);
  assert.deepEqual(resolved.ids, [9, 119]);
});

test('request timezone uses Vercel timezone and falls back to UTC', () => {
  assert.equal(api._internals.requestTimeZone({ headers: { 'x-vercel-ip-timezone': 'Europe/Brussels' } }), 'Europe/Brussels');
  assert.equal(api._internals.requestTimeZone({ headers: { 'x-vercel-ip-timezone': 'Invalid/Zone' } }), 'UTC');
});

test('streaming discover remains US flatrate and does not add timezone conversion to TV dates', () => {
  const catalog = api._internals.CATALOGS['netflix-series-upcoming'];
  const params = api._internals.discoverParams(catalog, week, [8], 1, 'America/Los_Angeles');
  assert.equal(params.watch_region, 'US');
  assert.equal(params.with_watch_monetization_types, 'flatrate');
  assert.equal(params['air_date.gte'], '2026-08-23');
  assert.equal('timezone' in params, false);
});

test('TVmaze airstamp wins over airdate and classifies by viewer date', () => {
  const window = dateWindow('today', new Date('2026-08-24T04:00:00Z'), 'Europe/Brussels');
  const episode = tvmazeEpisode({
    airdate: '2026-08-23',
    airtime: '00:35',
    airstamp: '2026-08-24T00:35:00-04:00'
  });
  const result = api._internals.tvmazeBroadcastToMeta(episode, 'Europe/Brussels', window, new Date('2026-08-24T04:00:00Z'));
  assert.ok(result.meta);
  assert.equal(result.event.viewerDate, '2026-08-24');
  assert.equal(result.event.viewerTime, '06:35');
  assert.equal(result.meta.released, '2026-08-24');
  assert.match(result.meta.releaseInfo, /06:35/);
});

test('TVmaze local web channel is not misclassified as broadcast TV', () => {
  const result = api._internals.tvmazeBroadcastToMeta(tvmazeEpisode({ network: false }), 'Europe/Brussels', week, fixedNow);
  assert.equal(result.meta, null);
  assert.equal(result.reason, 'not-us-broadcast');
});

test('TVmaze broadcast without IMDb is excluded for Nuvio playback compatibility', () => {
  const result = api._internals.tvmazeBroadcastToMeta(tvmazeEpisode({ imdb: null }), 'Europe/Brussels', week, fixedNow);
  assert.equal(result.meta, null);
  assert.equal(result.reason, 'no-imdb');
});

test('broadcast yesterday local is excluded but earlier today stays visible', () => {
  const todayWindow = dateWindow('today', new Date('2026-08-24T10:00:00Z'), 'Europe/Brussels');
  const earlierToday = buildInstantEvent({
    eventMode: EVENT_MODES.BROADCAST_INSTANT,
    eventInstant: '2026-08-24T01:00:00Z',
    viewerTimezone: 'Europe/Brussels',
    window: todayWindow
  });
  assert.ok(earlierToday.event);
  const yesterday = buildInstantEvent({
    eventMode: EVENT_MODES.BROADCAST_INSTANT,
    eventInstant: '2026-08-23T20:00:00Z',
    viewerTimezone: 'Europe/Brussels',
    window: todayWindow
  });
  assert.equal(yesterday.reason, 'past');
});


test('global streaming web schedule keeps official calendar date and ignores fake/global airstamp time', () => {
  const provider = api._internals.PROVIDERS.find((p) => p.slug === 'netflix');
  const details = seriesDetails({ id: 444, name: 'Streaming Show' });
  const episode = tvmazeWebEpisode({
    airdate: '2026-08-24',
    airstamp: '2026-08-23T22:00:00Z',
    provider: 'Netflix',
    localCountry: null
  });
  const result = api._internals.tvmazeStreamingEpisodeToMeta(episode, details, provider, 'Europe/Brussels', week);
  assert.ok(result.meta);
  assert.equal(result.meta.released, '2026-08-24');
  assert.equal(result.event.eventMode, EVENT_MODES.STREAMING_DATE);
  assert.equal(result.event.viewerTime, null);
  assert.doesNotMatch(result.meta.releaseInfo, /00:00/);
});

test('local US web channel may expose a real release time without changing official streaming date', () => {
  const provider = api._internals.PROVIDERS.find((p) => p.slug === 'hulu');
  const details = seriesDetails({ id: 445, name: 'Streaming Show' });
  const episode = tvmazeWebEpisode({
    airdate: '2026-08-24',
    airstamp: '2026-08-24T23:00:00-07:00',
    provider: 'Hulu',
    localCountry: 'US'
  });
  const result = api._internals.tvmazeStreamingEpisodeToMeta(episode, details, provider, 'Europe/Brussels', week);
  assert.ok(result.meta);
  assert.equal(result.meta.released, '2026-08-24');
  assert.equal(result.event.eventMode, EVENT_MODES.STREAMING_INSTANT);
  assert.equal(result.event.viewerTime, '08:00');
  assert.equal(result.event.convertedViewerDate, '2026-08-25');
});

test('web channel provider matching uses controlled aliases', () => {
  const prime = api._internals.PROVIDERS.find((p) => p.slug === 'prime-video');
  assert.equal(api._internals.webChannelMatchesProvider(tvmazeWebEpisode({ provider: 'Amazon Prime Video' })._embedded.show, prime), true);
  assert.equal(api._internals.webChannelMatchesProvider(tvmazeWebEpisode({ provider: 'Netflix' })._embedded.show, prime), false);
});

test('AniList airing timestamp is converted to viewer timezone', () => {
  const schedule = animeSchedule({ airingAt: Math.floor(new Date('2026-08-23T23:30:00Z').getTime() / 1000) });
  const details = seriesDetails({ id: 333, name: 'Exact Anime' });
  const window = dateWindow('today', new Date('2026-08-24T01:00:00Z'), 'Europe/Brussels');
  const result = api._internals.animeScheduleToMeta(schedule, details, 'Europe/Brussels', window);
  assert.ok(result.meta);
  assert.equal(result.event.viewerDate, '2026-08-24');
  assert.equal(result.event.viewerTime, '01:30');
  assert.match(result.meta.releaseInfo, /Épisode 8/);
  assert.match(result.meta.description, /n’est pas présentée comme une heure de mise en ligne/);
});

test('anime exact title + exact season year matches TMDb candidate', () => {
  const media = animeSchedule().media;
  assert.equal(api._internals.candidateMatchesAnime({
    id: 1,
    name: 'Exact Anime',
    original_name: 'Exact Anime',
    first_air_date: '2026-01-10'
  }, media), true);
  assert.equal(api._internals.candidateMatchesAnime({
    id: 2,
    name: 'Exact Anime',
    first_air_date: '2025-01-10'
  }, media), false);
  assert.equal(api._internals.candidateMatchesAnime({
    id: 3,
    name: 'Different Anime',
    first_air_date: '2026-01-10'
  }, media), false);
});

test('buildStreamingCatalog excludes wrong provider after local revalidation', async () => withTmdbToken(async () => {
  resetCaches();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/watch/providers/movie') return mockResponse(200, { results: [{ provider_id: 8, provider_name: 'Netflix' }] });
    if (u.pathname === '/3/discover/movie') return mockResponse(200, { results: [{ id: 101 }], total_pages: 1 });
    if (u.pathname === '/3/movie/101') return mockResponse(200, movieDetails({ id: 101, digitalDate: '2026-08-23', providerIds: [9] }));
    throw new Error(`Unexpected ${u.pathname}`);
  };
  try {
    const result = await api._internals.buildStreamingCatalog({
      catalog: api._internals.CATALOGS['netflix-movie-upcoming'],
      timeZone: 'Europe/Brussels',
      now: fixedNow,
      useCache: false
    });
    assert.equal(result.metas.length, 0);
    assert.equal(result.stats.excludedWrongProvider, 1);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('buildTvBroadcastCatalog keeps real viewer time and ignores other source dates', async () => withTmdbToken(async () => {
  resetCaches();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.tvmaze.com' && u.pathname === '/schedule') {
      if (u.searchParams.get('date') === '2026-08-23') return mockResponse(200, [tvmazeEpisode()]);
      return mockResponse(200, []);
    }
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await api._internals.buildTvBroadcastCatalog({
      catalog: api._internals.CATALOGS['us-tv-upcoming'],
      timeZone: 'Europe/Brussels',
      now: new Date('2026-08-23T10:00:00Z'),
      useCache: false
    });
    assert.equal(result.metas.length, 1);
    assert.match(result.metas[0].releaseInfo, /03:00/);
    assert.equal(result.metas[0].released, '2026-08-24');
  } finally {
    global.fetch = originalFetch;
  }
}));

test('buildAnimeCatalog maps exact anime to TMDb and returns converted airing', async () => withTmdbToken(async () => {
  resetCaches();
  const originalFetch = global.fetch;
  const schedule = animeSchedule({ airingAt: Math.floor(new Date('2026-08-24T00:30:00Z').getTime() / 1000) });
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'graphql.anilist.co') {
      const body = JSON.parse(options.body);
      assert.match(body.query, /airingSchedules/);
      return mockResponse(200, {
        data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [schedule] } }
      });
    }
    if (u.pathname === '/3/search/tv') {
      return mockResponse(200, { results: [{
        id: 333,
        name: 'Exact Anime',
        original_name: 'Exact Anime',
        first_air_date: '2026-01-10',
        original_language: 'ja',
        popularity: 100
      }] });
    }
    if (u.pathname === '/3/tv/333') return mockResponse(200, seriesDetails({ id: 333, name: 'Exact Anime' }));
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await api._internals.buildAnimeCatalog({
      catalog: api._internals.CATALOGS['anime-today'],
      timeZone: 'Europe/Brussels',
      now: new Date('2026-08-24T01:00:00Z'),
      useCache: false
    });
    assert.equal(result.metas.length, 1);
    assert.equal(result.metas[0].released, '2026-08-24');
    assert.match(result.metas[0].releaseInfo, /02:30/);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('AniList mapping failure is excluded instead of guessed', async () => withTmdbToken(async () => {
  resetCaches();
  const originalFetch = global.fetch;
  const schedule = animeSchedule();
  global.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'graphql.anilist.co') return mockResponse(200, {
      data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, airingSchedules: [schedule] } }
    });
    if (u.pathname === '/3/search/tv') return mockResponse(200, { results: [{ id: 999, name: 'Wrong Title', first_air_date: '2026-01-10' }] });
    throw new Error(`Unexpected ${u}`);
  };
  try {
    const result = await api._internals.buildAnimeCatalog({
      catalog: api._internals.CATALOGS['anime-today'],
      timeZone: 'Europe/Brussels',
      now: fixedNow,
      useCache: false
    });
    assert.equal(result.metas.length, 0);
    assert.equal(result.stats.excludedMapping, 1);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('TMDb 401 diagnostic does not leak token', async () => withTmdbToken(async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => mockResponse(401, { status_message: 'Invalid API key' });
  try {
    await assert.rejects(
      () => api._internals.tmdbFetch('/configuration'),
      (error) => error.status === 401 && error.statusMessage === 'Invalid API key' && !error.message.includes('test-token')
    );
  } finally {
    global.fetch = originalFetch;
  }
}));

test('TMDb 429 retries in controlled manner', async () => withTmdbToken(async () => {
  const previousRetry = process.env.RETRY_BASE_MS;
  process.env.RETRY_BASE_MS = '1';
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return mockResponse(429, { status_message: 'Rate limited' });
    return mockResponse(200, { ok: true });
  };
  try {
    const result = await api._internals.tmdbFetch('/configuration');
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
    if (previousRetry === undefined) delete process.env.RETRY_BASE_MS;
    else process.env.RETRY_BASE_MS = previousRetry;
  }
}));

test('source 429 retries without affecting TMDb credentials', async () => {
  const previousRetry = process.env.RETRY_BASE_MS;
  process.env.RETRY_BASE_MS = '1';
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return mockResponse(429, { message: 'slow down' });
    return mockResponse(200, { id: 1 });
  };
  try {
    const result = await api._internals.tvmazeFetch('/shows/1');
    assert.equal(result.id, 1);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
    if (previousRetry === undefined) delete process.env.RETRY_BASE_MS;
    else process.env.RETRY_BASE_MS = previousRetry;
  }
});

test('local time formatter reports viewer clock rather than server UTC', () => {
  const now = new Date('2026-08-23T23:30:00Z');
  assert.equal(localTime(now, 'Europe/Brussels'), '01:30');
  assert.equal(localIsoDate(now, 'Europe/Brussels'), '2026-08-24');
});

test('local env parser supports server-side secret and debug settings', () => {
  const parsed = parseEnv('TMDB_READ_TOKEN=abc123\nDEBUG=true\n');
  assert.equal(parsed.TMDB_READ_TOKEN, 'abc123');
  assert.equal(parsed.DEBUG, 'true');
});
