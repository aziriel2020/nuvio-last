import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathFor, matchPremiere, allMovieTodaySources, allPlatformTodaySources, allPlatformDaySources, invalidCalendarDates, releasedDayForMarket, duplicateCatalogCards, localDay, previousDay, calendarTimeZone } from '../scripts/check-premiere-coverage.mjs';
const require = createRequire(import.meta.url);
const { RECORDS, verifiedForCatalog, retainVerifiedMetas, verifiedMeta } = require('../runtime/verified-streaming-premieres.cjs');
const { sortAndDedupeMetas } = require('../regions/fr/src/calendar.js');

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
test('platform coverage tests today and yesterday for every movie and series source',()=>{
  const collections = [{
    title: 'Prime Video', folders:[{sources:[
      {type:'movie',catalogId:'archives-fr-v1-movie-prime-video-today'},
      {type:'series',catalogId:'archives-fr-v1-series-prime-video-today'}
    ]}]
  }];
  const ids=allPlatformDaySources(collections,'FR').map(source=>source.id);
  assert.deepEqual(ids,[
    'archives-fr-v1-movie-prime-video-today',
    'archives-fr-v1-movie-prime-video-yesterday',
    'archives-fr-v1-series-prime-video-today',
    'archives-fr-v1-series-prime-video-yesterday'
  ]);
  assert.deepEqual(invalidCalendarDates([
    {id:'tt1',released:'2026-10-30T00:00:00Z'},
    {id:'tt2',released:'2026-10-29T00:00:00Z'},
    {id:'tt3',released:null}
  ],'2026-10-30').map(x=>x.id),['tt2','tt3']);
  assert.deepEqual(invalidCalendarDates([{id:'tt1',released:'2026-10-30'}],'2026-10-30'),[]);
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

test('series duplicates from different source keys collapse by episode and date', () => {
  const card = (episode, src, released='2026-10-30') => ({
    type:'series', id:'tt32625029', name:'Example series',
    released, releaseInfo: episode+' • Date de diffusion',
    _dedupeKey:src, _eventInstantMs: Date.parse(released+'T10:00:00Z')
  });
  const cards = sortAndDedupeMetas([
    card('S02E01','tmdb:season:2:episode:1'),
    card('S02E01','tvmaze:another-source'),
    card('S02E02','tmdb:season:2:episode:2'),
    card('S02E01','tmdb:season:2:episode:1','2026-10-31')
  ]);
  assert.equal(cards.length,3);
  assert.deepEqual(cards.map(x=>x.releaseInfo.slice(0,6)).sort(),
    ['S02E01','S02E01','S02E02']);
  const films = sortAndDedupeMetas([
    {type:'movie',id:'ttfilm',_dedupeKey:'film:a',released:'2026-10-30'},
    {type:'movie',id:'ttfilm',_dedupeKey:'film:b',released:'2026-10-30'}
  ]);
  assert.equal(films.length,2, 'movie event dedupe rules stay unchanged');
});

test('calendar audit honors the Turkey midnight UTC boundary', () => {
  assert.equal(releasedDayForMarket('2026-10-30T21:00:00.000Z','TR'),'2026-10-31');
  assert.deepEqual(invalidCalendarDates([
    {id:'dsmart:891961',released:'2026-10-30T21:00:00.000Z'}
  ],'2026-10-31','TR'), []);
  assert.equal(releasedDayForMarket('2026-10-30','FR'),'2026-10-30');
  assert.equal(releasedDayForMarket('invalid','FR'),null);
  assert.deepEqual(invalidCalendarDates([
    {id:'dsmart:891961',released:'2026-10-30T21:00:00.000Z'}
  ],'2026-10-31','FR').map(x=>x.id), ['dsmart:891961']);
});

test('all four regional catalogs dedupe one episode but preserve different episodes',()=>{
  for (const market of ['fr','us','tr','global']) {
    const {sortAndDedupeMetas} = require(`../regions/${market}/src/calendar.js`);
    const mk=(ep,source)=>({
      type:'series',id:'tt32625029',released:'2026-10-30',
      releaseInfo:ep+' • Friday',_dedupeKey:source
    });
    const cards=sortAndDedupeMetas([
      mk('S02E01','tmdb'),mk('S02E01','tvmaze'),mk('S02E02','tmdb')
    ]);
    assert.equal(cards.length,2,market);
    assert.deepEqual(cards.map(c=>c.releaseInfo.slice(0,6)).sort(),['S02E01','S02E02'],market);
  }
});

test('Anime Japon + Corée rolls at Tokyo midnight while Global VOD stays in UTC', () => {
  const atTokyoMidnight = new Date('2026-10-31T15:47:00.000Z');
  const anime = {
    id: 'archives-global-v1-series-anime-asia-today',
    type: 'series', period: 'today'
  };
  const animeMovies = {
    id: 'archives-global-v1-movie-anime-asia-yesterday',
    type: 'movie', period: 'yesterday'
  };
  const vod = {
    id: 'archives-global-v1-movie-vod-global-today',
    type: 'movie', period: 'today'
  };

  assert.equal(calendarTimeZone('GLOBAL',anime), 'Asia/Tokyo');
  assert.equal(calendarTimeZone('GLOBAL',animeMovies), 'Asia/Tokyo');
  assert.equal(calendarTimeZone('GLOBAL',vod), 'UTC');
  assert.equal(calendarTimeZone('FR',anime), 'Europe/Paris',
    'do not remap other regions just because the catalog ID resembles anime');
  assert.equal(localDay('GLOBAL',atTokyoMidnight,anime), '2026-11-01');
  assert.equal(previousDay(localDay('GLOBAL',atTokyoMidnight,animeMovies)), '2026-10-31');
  assert.equal(localDay('GLOBAL',atTokyoMidnight,vod), '2026-10-31');
  assert.equal(localDay('GLOBAL',atTokyoMidnight), '2026-10-31',
    'existing GLOBAL UTC audit semantics remain unchanged');

  const tokyoToday = [
    { id:'anilist:209872', name:'Ranma 1/2', released:'2026-11-01' },
    { id:'tt41296506', name:'Magical Explorer', released:'2026-11-01T00:00:00.000Z' },
    { id:'anilist:200', name:'Native 00:30 JST', released:'2026-10-31T15:30:00.000Z' }
  ];
  assert.deepEqual(invalidCalendarDates(tokyoToday,'2026-11-01','GLOBAL',anime), []);
  assert.deepEqual(invalidCalendarDates([
    {id:'anilist:yesterday',released:'2026-10-31'}
  ],'2026-10-31','GLOBAL',animeMovies),[]);
  assert.deepEqual(invalidCalendarDates(tokyoToday,'2026-10-31','GLOBAL',vod).map(x=>x.id),
    ['anilist:209872','tt41296506'],
    'ordinary Global VOD still checks UTC dates');
});

test('Calendar date-only strings retain their civil date across Tokyo midnight and Europe DST', () => {
  const anime = 'archives-global-v1-series-anime-asia-today';
  assert.equal(releasedDayForMarket('2026-11-01', 'GLOBAL', anime),'2026-11-01');
  assert.equal(releasedDayForMarket('2026-10-31T15:00:00Z','GLOBAL',anime),'2026-11-01');
  assert.equal(releasedDayForMarket('2026-10-31T14:59:59Z','GLOBAL',anime),'2026-10-31');
  assert.equal(releasedDayForMarket('2026-10-31T15:00:00Z','GLOBAL'),'2026-10-31');
  assert.equal(releasedDayForMarket('2026-10-31T21:00:00Z','GLOBAL',anime),'2026-11-01');
  assert.equal(releasedDayForMarket('2026-10-31T21:00:00Z','TR'),'2026-11-01');
  assert.deepEqual(invalidCalendarDates([{id:'x',released:null}],'2026-11-01','GLOBAL',anime)
    .map(x=>x.id),['x'],'missing dates remain failures');
});
