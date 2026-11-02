'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAddon, manifest, parseId, buildMeta, earliestMovieRelease,
  streamingPlatforms, tmdbImage
} = require('../runtime/native-design-meta-addon.cjs');

function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(k,v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = JSON.parse(body); }
  };
}
const request = (url) => ({ url, headers: {} });

test('an independent metadata-only addon has no catalogs and never registers video streams', () => {
  const config = manifest('https://example.test');
  assert.equal(config.catalogs.length, 0);
  assert.deepEqual(config.resources.map(r => r.name), ['meta']);
  assert.deepEqual(config.types, ['movie', 'series']);
  assert.match(config.name, /Metadata/);
});
test('reject invalid type/id combinations and arbitrary image URLs', () => {
  assert.equal(parseId('movie', 'tmdb:tv:33'), null);
  assert.equal(parseId('series', 'tmdb:movie:42'), null);
  assert.equal(parseId('movie', 'https://evil.example'), null);
  assert.equal(parseId('movie', 'tt1234567').id, 'tt1234567');
  assert.equal(parseId('series', 'tmdb:tv:55').id, 'tmdb:tv:55');
  assert.equal(tmdbImage('https://evil.example/p.jpg', 'w500'), null);
  assert.equal(tmdbImage('/picture.png','w500'), 'https://image.tmdb.org/t/p/w500/picture.png');
});
test('date is initial worldwide release, not a later re-release', () => {
  assert.equal(earliestMovieRelease({
    release_date: '2022-02-10',
    release_dates: { results: [
      {iso_3166_1:'US',release_dates:[{type:3,release_date:'2022-02-10T00:00:00Z'}]},
      {iso_3166_1:'FR',release_dates:[{type:4,release_date:'2026-10-30T00:00:00Z'}]},
      {iso_3166_1:'GB',release_dates:[{type:1,release_date:'2022-01-20T00:00:00Z'}]}
    ]}
  }), '2022-01-20');
});
test('multi-platform titles do not falsely claim one source', () => {
  assert.deepEqual(streamingPlatforms({'watch/providers':{results:{FR:{
    flatrate:[{provider_name:'Netflix'}, {provider_name:'Amazon Prime Video'}],
    rent:[{provider_name:'Apple TV'}]
  }}}}), ['Amazon Prime Video','Netflix']);
});
test('native movie fields keep TMDB image URLs with no generated JPEG', async () => {
  let calls=0;
  const fetcher=async (url, params) => {
    calls++;
    assert.equal(url, '/movie/123');
    assert.match(params.append_to_response, /images/);
    return {
      id:123, imdb_id:'tt1234567', title:'Un film',
      backdrop_path:'/scene.jpg', poster_path:'/poster.jpg',
      release_date:'2020-02-02', vote_average:8.1,
      images:{logos:[{file_path:'/un-film.png',iso_639_1:'fr',width:800,height:200}]},
      genres:[{name:'Thriller'}], runtime:101,
      'watch/providers':{results:{FR:{flatrate:[{provider_name:'Netflix'}]}}}
    };
  };
  const meta=await buildMeta({type:'movie',id:'tmdb:movie:123'},fetcher);
  assert.equal(calls,1);
  assert.equal(meta.poster,'https://image.tmdb.org/t/p/w780/scene.jpg');
  assert.equal(meta.background,'https://image.tmdb.org/t/p/w1280/scene.jpg');
  assert.equal(meta.logo,'https://image.tmdb.org/t/p/w500/un-film.png');
  assert.equal(meta.posterShape,'landscape');
  assert.equal(meta.releaseInfo,'2020');
  assert.deepEqual(meta.genres,['Thriller']);
  assert.match(meta.description,/Netflix/);
  assert.match(meta.description,/Note TMDB : 8\.1/);
  assert.equal(meta.imdbRating, undefined); // TMDB score must not be mislabeled IMDb.
  assert.equal(meta.videos, undefined);
});
test('series addon uses real TMDB episodes, not synthetic season placeholders', async () => {
  const visited=[];
  const fetcher=async (route) => {
    visited.push(route);
    if(route==='/tv/42')return {
      id:42,name:'La série', first_air_date:'2025-01-01',backdrop_path:'/tv.jpg',
      number_of_seasons:2, external_ids:{imdb_id:'tt1234567'},
      seasons:[{season_number:0},{season_number:1},{season_number:2}],
      genres:[{name:'Drame'}]
    };
    if(route==='/tv/42/season/1')return {
      episodes:[{name:'Début', season_number:1,episode_number:1,air_date:'2025-01-01'}]
    };
    if(route==='/tv/42/season/2')return {
      episodes:[{name:'Retour',season_number:2,episode_number:1,air_date:'2026-01-01'}]
    };
    throw new Error('Unexpected TMDB route '+route);
  };
  const meta=await buildMeta({type:'series',id:'tmdb:tv:42'},fetcher);
  assert.deepEqual(visited.sort(), ['/tv/42','/tv/42/season/1','/tv/42/season/2']);
  assert.deepEqual(meta.videos.map(e=>[e.season,e.episode,e.title]), [
    [1,1,'Début'],[2,1,'Retour']
  ]);
  assert.equal(meta.videos[0].id,'tt1234567:1:1');
  assert.match(meta.description,/2 saisons/);
});
test('failed season fetch returns HTTP 503 so Nuvio can fall back instead of losing episodes', async () => {
  const addon=createAddon({tmdb:async route => {
    if(route==='/tv/66')return {id:66,name:'Example',backdrop_path:'/ok.jpg',
      number_of_seasons:1,seasons:[{season_number:1}]};
    throw new Error('TMDB season timeout');
  }});
  const res=response();
  await addon.handle(request('/design-meta/meta/series/tmdb%3Atv%3A66.json'),res,'https://example.test');
  assert.equal(res.statusCode,503);
  assert.equal(res.body.error,'Metadata temporarily unavailable');
});
test('routes are installable, cache native metadata and contain no poster endpoint', async () => {
  let calls=0;
  const addon=createAddon({tmdb:async route => {
    calls++;
    if(route==='/find/tt1234567')return {movie_results:[{id:15}]};
    if(route==='/movie/15')return {id:15,title:'Film IMDb',backdrop_path:'/wide.jpg'};
    throw new Error(route);
  }});
  const config=response();
  await addon.handle(request('/design-meta/manifest.json'),config,'https://example.test');
  assert.equal(config.statusCode,200);
  assert.deepEqual(config.body.catalogs,[]);
  const first=response();
  await addon.handle(request('/design-meta/meta/movie/tt1234567.json'),first,'https://example.test');
  const second=response();
  await addon.handle(request('/design-meta/meta/movie/tt1234567.json'),second,'https://example.test');
  assert.equal(first.statusCode,200);
  assert.equal(second.statusCode,200);
  assert.equal(calls,2); // one IMDb -> TMDB mapping and one metadata call
  assert.equal(first.body.meta.id,'tt1234567');
  assert.equal(first.body.meta.poster,'https://image.tmdb.org/t/p/w780/wide.jpg');
  const nonexistent=response();
  await addon.handle(request('/design-meta/poster.jpg'),nonexistent,'https://example.test');
  assert.equal(nonexistent.statusCode,404);
});
