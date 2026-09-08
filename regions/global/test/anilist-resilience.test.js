'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const airingAt = Math.floor(new Date('2026-09-09T12:30:00.000Z').getTime() / 1000);

const jpMedia = {
  id: 777,
  title: { english: 'Fallback Anime', romaji: 'Fallback Anime JP', native: 'フォールバック' },
  format: 'TV',
  duration: 24,
  genres: ['Action', 'Fantasy'],
  status: 'RELEASING',
  popularity: 1234,
  averageScore: 82,
  isAdult: false,
  countryOfOrigin: 'JP',
  season: 'SUMMER',
  seasonYear: 2026,
  description: '<b>Anime description</b>',
  coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/test.jpg' },
  bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/test.jpg',
  airingSchedule: { nodes: [{ airingAt, episode: 7 }] }
};

const cnMedia = { ...jpMedia, id: 778, countryOfOrigin: 'CN', title: { english: 'China Anime' } };
const movieMedia = { ...jpMedia, id: 779, format: 'MOVIE', title: { english: 'Anime Movie' } };
const adultMedia = { ...jpMedia, id: 780, isAdult: true, title: { english: 'Adult Anime' } };

function fallbackFetch(url) {
  const href = String(url);
  if (href.includes('/schedule?')) {
    return Promise.resolve(json({
      ok: true,
      episodes: [
        { mediaId: 777, episode: 7, airingAt, title: 'Fallback Anime' },
        { mediaId: 778, episode: 7, airingAt, title: 'China Anime' },
        { mediaId: 779, episode: 1, airingAt, title: 'Anime Movie' },
        { mediaId: 780, episode: 7, airingAt, title: 'Adult Anime' }
      ],
      attribution: 'Data from AniList, corrected by Tsuzuki.'
    }));
  }
  if (href.includes('/seasons/')) {
    return Promise.resolve(json({ ok: true, media: [jpMedia, cnMedia, movieMedia, adultMedia] }));
  }
  if (href.includes('/airing?full=1')) {
    return Promise.resolve(json({ ok: true, media: [] }));
  }
  if (href.endsWith('/anime/777?full=1')) {
    return Promise.resolve(json({ ok: true, media: jpMedia }));
  }
  return Promise.resolve(json({ ok: false, error: 'not found' }, 404));
}

test('Cloudflare resilience keeps JP AniList content when the primary runtime soft-fails empty', async () => {
  const resilience = await import('../../../cloudflare/anilist-resilience.mjs');
  const request = new Request('https://edge.example/global/catalog/series/archives-global-v1-series-anime-asia-today.json');
  const baseResponse = json({ metas: [], stats: { anilistFallbacks: 0 } });
  const response = await resilience.recoverGlobalAnimeResponse(request, baseResponse, {
    fetchFn: fallbackFetch,
    now: new Date('2026-09-08T21:00:00.000Z')
  });
  const payload = await response.json();

  assert.equal(payload.metas.length, 1);
  assert.equal(payload.metas[0].id, 'anilist:777');
  assert.match(payload.metas[0].releaseInfo, /Épisode 7/);
  assert.equal(payload.metas[0].country, 'Japon');
  assert.deepEqual(payload.metas[0].genres, ['Action', 'Fantasy']);
  assert.equal(payload.metas[0].runtime, '24 min');
  assert.equal(payload.metas[0].imdbRating, '8.2');
  assert.match(payload.metas[0].description, /AniList/);
  assert.match(payload.metas[0].description, /Tsuzuki/);
  assert.match(payload.metas[0].banner, /desktop-content-card\.jpg/);
  assert.match(payload.metas[0].banner, /desktop11/);
  assert.equal(payload.stats.anilistFallbacks, 1);
  assert.equal(response.headers.get('x-nuvio-anime-source'), 'anilist-cache-tsuzuki');
});

test('Cloudflare resilience meta route reconstructs anilist:<id> from cached full AniList metadata', async () => {
  const resilience = await import('../../../cloudflare/anilist-resilience.mjs');
  const request = new Request('https://edge.example/global/meta/series/anilist:777.json');
  const baseResponse = json({ error: 'AniList unavailable' }, 502);
  const response = await resilience.recoverGlobalAnimeResponse(request, baseResponse, {
    fetchFn: fallbackFetch,
    now: new Date('2026-09-08T21:00:00.000Z')
  });
  const payload = await response.json();

  assert.equal(payload.meta.id, 'anilist:777');
  assert.equal(payload.meta.name, 'Fallback Anime');
  assert.equal(payload.meta.poster, jpMedia.coverImage.large);
  assert.equal(payload.meta.background, jpMedia.bannerImage);
  assert.match(payload.meta.releaseInfo, /Épisode 7/);
  assert.equal(payload.meta.country, 'Japon');
  assert.equal(payload.meta.runtime, '24 min');
  assert.equal(payload.meta.imdbRating, '8.2');
  assert.equal(response.headers.get('x-nuvio-origin'), 'cloudflare-only');
});

test('Cloudflare resilience never overrides a non-empty AniList-authoritative catalog', async () => {
  const resilience = await import('../../../cloudflare/anilist-resilience.mjs');
  const request = new Request('https://edge.example/global/catalog/series/archives-global-v1-series-anime-asia-today.json');
  const baseResponse = json({ metas: [{ id: 'tmdb:series:123' }] });
  let calls = 0;
  const response = await resilience.recoverGlobalAnimeResponse(request, baseResponse, {
    fetchFn: async () => { calls += 1; return json({ ok: false }, 500); }
  });
  assert.strictEqual(response, baseResponse);
  assert.equal(calls, 0);
});
