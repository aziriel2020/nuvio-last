import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathFor, matchPremiere, allMovieTodaySources, allPlatformTodaySources } from '../scripts/check-premiere-coverage.mjs';
const require = createRequire(import.meta.url);
const { RECORDS, verifiedForCatalog, retainVerifiedMetas, verifiedMeta } = require('../runtime/verified-streaming-premieres.cjs');

test('provenance registry routes any provider to its own market and archive folder', () => {
  const p=RECORDS[0];
  assert.equal(pathFor(p),'/fr/catalog/movie/archives-fr-v1-movie-prime-video-2026-10.json');
  assert.deepEqual(verifiedForCatalog({type:'movie',providerSlug:'netflix'}, {start:p.platformDate,end:p.platformDate},'FR'),[]);
  assert.deepEqual(verifiedForCatalog({type:'movie',providerSlug:'prime-video'}, {start:p.platformDate,end:p.platformDate},'BE'),[]);
  assert.equal(verifiedForCatalog({type:'movie',providerSlug:'prime-video'}, {start:p.platformDate,end:p.platformDate},'FR').length,1);
});
test('coverage detects a genuinely missing card rather than matching a similar title', () => {
  const p=RECORDS[0];
  assert.equal(matchPremiere([{type:'movie',id:'tt12345678',name:'Apocalypse Z : Nouveau Monde',released:'2026-10-09'}],p),undefined);
  assert.equal(matchPremiere([{type:'movie',id:p.imdbId,name:p.title,released:p.platformDate}],p)?.id,p.imdbId);
});
test('platform scan covers every dated movie platform folder and ignores editorials',()=>{
  const entries=[
    {title:'🇫🇷 Prime Video',folders:[{title:'Films',sources:[
      {type:'movie',catalogId:'archives-fr-v1-movie-prime-video-today'},
      {type:'movie',catalogId:'archives-fr-v1-movie-prime-video-2026-10'}]}]},
    {title:'🇫🇷 Netflix',folders:[{title:'Films',sources:[
      {type:'movie',catalogId:'archives-fr-v1-movie-netflix-today'}]}]},
    {title:'Editorial',folders:[{sources:[{type:'movie',catalogId:'editorial-movies-new-today'}]}]}
  ];
  entries[0].folders[0].sources.push({type:'series',catalogId:'archives-fr-v1-series-prime-video-today'});
  assert.equal(allPlatformTodaySources(entries,'FR').length,3);
  assert.deepEqual(allMovieTodaySources(entries,'FR').map(x=>x.id).sort(),[
    'archives-fr-v1-movie-netflix-today','archives-fr-v1-movie-prime-video-today'
  ]);
});
test('verified premieres survive maxItems cap without dupes or changing historical order',()=>{
  const raw=[{id:'a',_dedupeKey:'movie:1',released:'2026-10-01'},
    {id:'b',_dedupeKey:'movie:2',released:'2026-10-05'},
    {id:'v',_dedupeKey:'movie:3',released:'2026-10-30',_calendarSource:'verified-platform-premiere'}];
  assert.deepEqual(retainVerifiedMetas(raw,2).map(x=>x.id),['a','v']);
  assert.deepEqual(retainVerifiedMetas(raw,3).map(x=>x.id),['a','b','v']);
});
