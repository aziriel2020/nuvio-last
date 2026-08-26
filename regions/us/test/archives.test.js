'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar');
const api=require('../api/index');

const fixedNow=new Date('2026-08-24T12:28:00Z');
const fixedTomorrow=new Date('2026-08-25T12:28:00Z');
const fixedSepNow=new Date('2026-09-01T12:28:00Z');
const fixedJan2027=new Date('2027-01-05T12:28:00Z');
const tz='Europe/Brussels';

function collection(title, now=fixedNow, origin='https://archives.example'){
  return api._internals.buildNuvioCollectionsImport(now,tz,origin).find(c=>c.title===title||c.title.endsWith(` ${title}`));
}
function folder(parent,title){return parent.folders.find(f=>f.title===title)}

test('archive month windows are complete/current/future aware',()=>{
  assert.deepEqual(calendar.dateWindow('archive-2025-02',fixedNow,tz),{start:'2025-02-01',end:'2025-02-28',kind:'archive-month',today:'2026-08-24',allowPast:true,empty:false,archiveYear:2025,archiveMonth:2});
  assert.equal(calendar.dateWindow('archive-2026-08',fixedNow,tz).end,'2026-08-24');
  assert.equal(calendar.dateWindow('archive-2026-09',fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow('archive-2026-09',fixedSepNow,tz).empty,false);
});

test('five rolling periods follow the viewer-local day automatically',()=>{
  assert.deepEqual(calendar.dateWindow('today',fixedNow,tz),{start:'2026-08-24',end:'2026-08-24',kind:'today',today:'2026-08-24'});
  assert.deepEqual(calendar.dateWindow('tomorrow',fixedNow,tz),{start:'2026-08-25',end:'2026-08-25',kind:'tomorrow',today:'2026-08-24'});
  assert.deepEqual(calendar.dateWindow('yesterday',fixedNow,tz),{start:'2026-08-23',end:'2026-08-23',kind:'yesterday',today:'2026-08-24',allowPast:true});
  assert.deepEqual(calendar.dateWindow('lastweek',fixedNow,tz),{start:'2026-08-17',end:'2026-08-23',kind:'lastweek',today:'2026-08-24',allowPast:true});
  assert.deepEqual(calendar.dateWindow('nextweek',fixedNow,tz),{start:'2026-08-31',end:'2026-09-06',kind:'nextweek',today:'2026-08-24'});
  assert.equal(calendar.dateWindow('today',fixedTomorrow,tz).start,'2026-08-25');
  assert.equal(calendar.dateWindow('yesterday',fixedTomorrow,tz).start,'2026-08-24');
});

test('prewire includes previous, current and next year for rollover without monthly reimport',()=>{
  assert.deepEqual(api._internals.archivePrewiredYears(fixedNow,tz),[2027,2026,2025]);
  assert.equal(api._internals.archiveYearIsVisible(2027,fixedNow,tz),false);
  assert.equal(api._internals.archiveYearIsVisible(2026,fixedNow,tz),true);
  assert.equal(api._internals.archiveYearIsVisible(2025,fixedNow,tz),true);
  assert.equal(api._internals.archiveYearIsVisible(2025,fixedJan2027,tz),false);
  assert.equal(api._internals.archiveYearIsVisible(2027,fixedJan2027,tz),true);
});

test('manifest entries include five dynamic periods plus prewired month+year rows',()=>{
  const e=api._internals.buildArchiveCatalogEntries(fixedNow,tz);
  const providerCategoryCount=api._internals.ARCHIVE_SERIES_PROVIDERS.length+api._internals.ARCHIVE_FILM_PROVIDERS.length;
  const monthly=12*providerCategoryCount*3;
  const dynamic=5*providerCategoryCount;
  assert.equal(monthly,684);
  assert.equal(dynamic,95);
  assert.equal(e.length,779);
  assert.equal(e.find(x=>x.id==='archives-v3-series-netflix-today').catalog.name,'Aujourd’hui');
  assert.equal(e.find(x=>x.id==='archives-v3-series-netflix-nextweek').catalog.name,'La semaine suivante');
  assert.equal(e.find(x=>x.id==='archives-v3-series-netflix-2026-08').catalog.name,'Août 2026');
  assert.equal(e.find(x=>x.id==='archives-v3-movie-vod-us-2025-12').catalog.name,'Décembre 2025');
});

test('VOD is Films-only for periods and months',()=>{
  const vodMonth=api._internals.resolveArchiveCatalog('archives-v3-movie-vod-us-2026-08','movie',fixedNow,tz);
  const vodToday=api._internals.resolveArchiveCatalog('archives-v3-movie-vod-us-today','movie',fixedNow,tz);
  assert(vodMonth&&vodToday);
  assert.equal(vodMonth.source,'tmdb-vod');
  assert.equal(vodToday.name,'Aujourd’hui');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-vod-us-today','series',fixedNow,tz),null);
});

test('manifest v1.5 stays hidden from normal Home because Collections own the UI',()=>{
  const m=api._internals.buildManifest('https://archives.example',fixedNow,tz);
  assert.equal(m.version,'1.5.3');
  assert.equal(m.catalogs.length,779);
  assert(m.catalogs.every(c=>c.showInHome===false));
  assert(m.catalogs.every(c=>c.extraSupported.includes('skip')));
  assert(m.catalogs.some(c=>c.type==='series'&&c.name==='Aujourd’hui'));
  assert(m.catalogs.some(c=>c.type==='series'&&c.name==='Août 2026'));
  assert(!m.catalogs.some(c=>c.name==='Netflix — Août 2026'));
});

test('catalog IDs resolve only with the correct Nuvio media type',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-netflix-2025-04','series',fixedNow,tz).type,'series');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-movie-netflix-2025-04','movie',fixedNow,tz).type,'movie');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-netflix-today','series',fixedNow,tz).period,'today');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-netflix-2025-04','movie',fixedNow,tz),null);
});

test('Shield Modern decoration keeps real content type and landscape artwork for periods and months',()=>{
  const meta={id:'tt1234567',type:'movie',name:'Archive Film',poster:'https://image.tmdb.org/t/p/w500/demo.jpg',background:'https://image.tmdb.org/t/p/original/demo-bg.jpg',landscapePoster:'https://image.tmdb.org/t/p/original/demo-bg.jpg',releaseInfo:'4 avr. 2025',released:'2025-04-04',_calendarProvider:'🇺🇸 Netflix',_calendarSource:'tmdb-streaming'};
  for(const id of ['archives-v3-movie-netflix-2025-04','archives-v3-movie-netflix-yesterday']){
    const c=api._internals.resolveArchiveCatalog(id,'movie',fixedNow,tz);
    const [d]=api._internals.decorateCatalogMetas('https://archives.example',[meta],c,tz);
    assert.equal(d.type,'movie');
    assert.equal(d.posterShape,'landscape');
    assert.match(d.background,/calendar-card\.svg/);
    assert.match(d.releaseInfo,/NETFLIX/);
  }
});

test('Nuvio import has platform names as the 10 parent Collections',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert.deepEqual(payload.map(c=>c.title),['🇺🇸 Netflix','🇺🇸 Prime Video','🇺🇸 Disney+','🇺🇸 Max','🇺🇸 Apple TV+','🇺🇸 Paramount+','🇺🇸 Peacock','🇺🇸 Hulu','🇺🇸 Crunchyroll + AniList','🇺🇸 VOD']);
  assert.equal(payload.length,10);
  assert(payload.every(c=>c.pinToTop===true&&c.viewMode==='FOLLOW_LAYOUT'&&c.showAllTab===false));
});

test('old parent IDs are reused by Netflix and Prime Video for a clean upgrade',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  assert.equal(payload[0].id,'calendar-archives');
  assert.equal(payload[0].title,'🇺🇸 Netflix');
  assert.equal(payload[1].id,'calendar-archives-films');
  assert.equal(payload[1].title,'🇺🇸 Prime Video');
});

test('normal streaming parent contains Modern Series and Films cards',()=>{
  const netflix=collection('🇺🇸 Netflix');
  assert.deepEqual(netflix.folders.map(f=>f.title),['Séries','Films']);
  for(const f of netflix.folders){
    assert.equal(f.tileShape,'LANDSCAPE');
    assert.equal(f.hideTitle,true);
    assert.match(f.coverImageUrl,/platform-category-card\.svg\?provider=netflix&category=(series|films)&v=coex-us100$/);
    assert.match(f.heroBackdropUrl,/platform-backdrop\.svg\?provider=netflix&type=(series|movie)&v=coex-us100$/);
    assert.match(f.titleLogoUrl,/platform-logo\?provider=netflix&type=(series|movie)&v=coex-us100$/);
  }
});



test('Paramount+ keeps both Series and Films folders with valid archive sources',()=>{
  const paramount=collection('Paramount+');
  assert.deepEqual(paramount.folders.map(f=>f.title),['Séries','Films']);
  assert(paramount.folders[0].sources.some(s=>s.catalogId==='archives-v3-series-paramount-plus-2026-08'));
  assert(paramount.folders[1].sources.some(s=>s.catalogId==='archives-v3-movie-paramount-plus-2026-08'));
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-paramount-plus-2026-08','series',fixedNow,tz).providerSlug,'paramount-plus');
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-movie-paramount-plus-2026-08','movie',fixedNow,tz).providerSlug,'paramount-plus');
});



test('Paramount+ resolver accepts canonical, Amazon, Apple and premium provider variants',()=>{
  const definition=api._internals.PROVIDERS.find(p=>p.slug==='paramount-plus');
  const directory=[
    {id:531,name:'Paramount Plus',normalized:api._internals.normalizeProviderName('Paramount Plus'),logoPath:'/canonical.png'},
    {id:582,name:'Paramount+ Amazon Channel',normalized:api._internals.normalizeProviderName('Paramount+ Amazon Channel'),logoPath:'/amazon.png'},
    {id:1853,name:'Paramount Plus Apple TV Channel ',normalized:api._internals.normalizeProviderName('Paramount Plus Apple TV Channel '),logoPath:'/apple.png'},
    {id:2303,name:'Paramount Plus Premium',normalized:api._internals.normalizeProviderName('Paramount Plus Premium'),logoPath:'/premium.png'},
    {id:2304,name:'Paramount Plus Basic with Ads',normalized:api._internals.normalizeProviderName('Paramount Plus Basic with Ads'),logoPath:'/ads.png'}
  ];
  const resolved=api._internals.resolveProviderFromDirectory(definition,directory);
  assert.deepEqual(resolved.ids,[531,582,1853,2303,2304]);
  assert.equal(resolved.logoPaths[0],'/canonical.png');
});

test('Paramount+ resolver has safe fallback IDs when provider directory naming changes',()=>{
  const definition=api._internals.PROVIDERS.find(p=>p.slug==='paramount-plus');
  const resolved=api._internals.resolveProviderFromDirectory(definition,[]);
  assert(resolved.ids.includes(531));
  assert(resolved.ids.includes(582));
});

test('platform wordmark is horizontal and keeps the provider logo large',()=>{
  const fake='data:image/png;base64,AAAA';
  const svg=api._internals.platformWordmarkSvg('paramount-plus',fake,'series');
  assert.match(svg,/width="1400" height="300"/);
  assert.match(svg,/Paramount\+/);
  assert.match(svg,/width="224" height="224"/);
  assert.match(svg,/data:image\/png;base64,AAAA/);
});

test('Crunchyroll + AniList has Series and Films, VOD has Films only, and Crunchyroll series rows merge anime',()=>{
  assert.deepEqual(collection('Crunchyroll + AniList').folders.map(f=>f.title),['Séries','Films']);
  assert.deepEqual(collection('VOD').folders.map(f=>f.title),['Films']);
  const today=api._internals.resolveArchiveCatalog('archives-v3-series-crunchyroll-today','series',fixedNow,tz);
  const month=api._internals.resolveArchiveCatalog('archives-v3-series-crunchyroll-2026-08','series',fixedNow,tz);
  assert.equal(today.source,'crunchyroll-anime-combined');
  assert.equal(month.source,'crunchyroll-anime-combined');
  assert.equal(today.archiveKind,'crunchyroll+anime-period');
  assert.equal(month.archiveKind,'crunchyroll+anime');
  const movieToday=api._internals.resolveArchiveCatalog('archives-v3-movie-crunchyroll-today','movie',fixedNow,tz);
  const movieMonth=api._internals.resolveArchiveCatalog('archives-v3-movie-crunchyroll-2026-08','movie',fixedNow,tz);
  assert.equal(movieToday.source,'tmdb-streaming');
  assert.equal(movieMonth.source,'tmdb-streaming');
});

test('every folder starts with the five periods, then months+years descending',()=>{
  const s=folder(collection('🇺🇸 Netflix'),'Séries');
  assert.equal(s.sources.length,41);
  assert.deepEqual(s.sources.slice(0,5).map(x=>x.catalogId),[
    'archives-v3-series-netflix-today',
    'archives-v3-series-netflix-tomorrow',
    'archives-v3-series-netflix-yesterday',
    'archives-v3-series-netflix-lastweek',
    'archives-v3-series-netflix-nextweek'
  ]);
  assert.equal(s.sources[5].catalogId,'archives-v3-series-netflix-2027-12');
  assert.equal(s.sources[16].catalogId,'archives-v3-series-netflix-2027-01');
  assert.equal(s.sources[17].catalogId,'archives-v3-series-netflix-2026-12');
  assert.equal(s.sources[21].catalogId,'archives-v3-series-netflix-2026-08');
  assert.equal(s.sources[28].catalogId,'archives-v3-series-netflix-2026-01');
  assert.equal(s.sources[29].catalogId,'archives-v3-series-netflix-2025-12');
  assert.equal(s.sources.at(-1).catalogId,'archives-v3-series-netflix-2025-01');
});

test('folder sources use the addon id and the folder real media type',()=>{
  for(const parent of api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example')){
    for(const f of parent.folders){
      const expected=f.title==='Films'?'movie':'series';
      assert(f.sources.every(s=>s.provider==='addon'&&s.addonId==='com.nuvio.calendar.archives.us.coexist'&&s.type===expected));
    }
  }
});

test('Collection import is identical across days and month rollover',()=>{
  const august24=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://archives.example');
  const august25=api._internals.buildNuvioCollectionsImport(fixedTomorrow,tz,'https://archives.example');
  const september=api._internals.buildNuvioCollectionsImport(fixedSepNow,tz,'https://archives.example');
  assert.deepEqual(august25,august24);
  assert.deepEqual(september,august24);
  const ids=folder(august24[0],'Séries').sources.map(s=>s.catalogId);
  assert(ids.indexOf('archives-v3-series-netflix-2026-09')<ids.indexOf('archives-v3-series-netflix-2026-08'));
});

test('future current-year and prewired next-year catalogs exist but are date-empty',()=>{
  const sep=api._internals.resolveArchiveCatalog('archives-v3-series-netflix-2026-09','series',fixedNow,tz);
  const y2027=api._internals.resolveArchiveCatalog('archives-v3-movie-netflix-2027-01','movie',fixedNow,tz);
  assert(sep&&y2027);
  assert.equal(calendar.dateWindow(sep.period,fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow(y2027.period,fixedNow,tz).empty,true);
});

test('Modern category artwork uses a huge centered logo area and keeps the Series overlay',()=>{
  const fake='data:image/png;base64,AAECAwQ=';
  const svg=api._internals.platformCategoryCardSvg('netflix','series',fake);
  assert.match(svg,/SÉRIES/);
  assert.match(svg,/data:image\/png;base64,AAECAwQ=/);
  assert.match(svg,/Netflix/);
  assert.match(svg,/PÉRIODES \+ MOIS/);
  assert.match(svg,/#e50914/i);
});

test('Crunchyroll category artwork explicitly says anime is combined',()=>{
  const svg=api._internals.platformCategoryCardSvg('crunchyroll','series',null);
  assert.match(svg,/CRUNCHYROLL \+ ANILIST/);
  assert.match(svg,/SÉRIES/);
  const movieSvg=api._internals.platformCategoryCardSvg('crunchyroll','films',null);
  assert.match(movieSvg,/FILMS D’ANIME \+ STREAMING/);
  assert.match(movieSvg,/FILMS/);
});

test('Modern provider backdrop is all-vector around a branded platform badge',()=>{
  const fake='data:image/png;base64,AAAA';
  const svg=api._internals.platformBackdropSvg('prime-video','series',fake);
  assert.match(svg,/Prime Video/);
  assert.match(svg,/CALENDAR ARCHIVES/);
  assert.match(svg,/SÉRIES/);
});

test('TMDb watch-provider logo is fetched at original resolution for non-pixelated covers',async()=>{
  const oldFetch=global.fetch;
  const oldKey=process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY='test-key';
  global.fetch=async(url)=>{
    const u=String(url);
    if(u.includes('/watch/providers/movie')){
      return new Response(JSON.stringify({results:[{provider_id:8,provider_name:'🇺🇸 Netflix',logo_path:'/netflix.png'}]}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(u==='https://image.tmdb.org/t/p/original/netflix.png'){
      return new Response(Uint8Array.from([137,80,78,71]),{status:200,headers:{'content-type':'image/png'}});
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  try{
    api._internals.providerCache.clear();
    const asset=await api._internals.platformLogoAsset('netflix','movie');
    assert(asset);
    assert.equal(asset.contentType,'image/png');
    assert.match(asset.dataUri,/^data:image\/png;base64,/);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY=oldKey;
  }
});

test('invalid provider, pre-2025 and legacy catalog IDs are rejected',()=>{
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-netflix-2024-12','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v3-series-made-up-2026-01','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v2-series-netflix-2025-01','series',fixedNow,tz),null);
  assert.equal(api._internals.resolveArchiveCatalog('archives-v1-month-2025-01','series',fixedNow,tz),null);
});
