import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathFor, matchPremiere, allMovieTodaySources, allPlatformTodaySources, duplicateCatalogCards } from '../scripts/check-premiere-coverage.mjs';
const require = createRequire(import.meta.url);
const { RECORDS, verifiedForCatalog, retainVerifiedMetas, verifiedMeta } = require('../runtime/verified-streaming-premieres.cjs');

test('provenance registry routes any provider to its own market and archive folder', () => {
  const p=RECORDS.find(entry=>entry.market==='FR');
  assert.equal(pathFor(p),'/fr/catalog/movie/archives-fr-v1-movie-prime-video-2026-10.json');
  assert.deepEqual(verifiedForCatalog({type:'movie',providerSlug:'netflix'}, {start:p.platformDate,end:p.platformDate},'FR'),[]);
  assert.deepEqual(verifiedForCatalog({type:'movie',providerSlug:'prime-video'}, {start:p.platformDate,end:p.platformDate},'BE'),[]);
  assert.equal(verifiedForCatalog({type:'movie',providerSlug:'prime-video'}, {start:p.platformDate,end:p.platformDate},'FR').length,1);
  for (const market of ['US','TR']) {
    const matches=verifiedForCatalog({type:'movie',providerSlug:'prime-video'},
      {start:'2026-10-30',end:'2026-10-30'},market);
    assert.equal(matches.length,1,'global Amazon release must cover '+market);
    assert.match(pathFor(matches[0]),/\/catalog\/movie\/archives-(?:v3|tr-v1)-movie-prime-video-2026-10\.json$/);
  }
});
test('coverage detects a genuinely missing card rather than matching a similar title', () => {
  const p=RECORDS.find(entry=>entry.market==='FR');
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

test('episode-aware duplicate detection preserves distinct episodes but rejects true duplicates', () => {
  const episode = (code, date='2026-10-30') => ({
    type: 'series', id: 'tt1234567', name: 'Test show',
    released: date, releaseInfo: code + ' • 30 octobre', poster: 'https://example.com/show.jpg'
  });
  assert.deepEqual(duplicateCatalogCards([episode('S01E01'),episode('S01E02')]), []);
  assert.equal(duplicateCatalogCards([episode('S01E01'),episode('S01E01')]).length, 1);
  assert.deepEqual(duplicateCatalogCards([episode('S01E01'),episode('S01E01','2026-10-31')]), []);
  assert.equal(duplicateCatalogCards([{type:'movie',id:'tt500',released:'2026-10-10'},
    {type:'movie',id:'tt500',released:'2026-10-30'}]).length, 1);
});
