'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar');
const api=require('../api/index');

const fixedNow=new Date('2026-08-24T12:28:00Z');
const fixedSep=new Date('2026-09-01T12:28:00Z');
const tz='Europe/Paris';
const expectedParents=['🇫🇷 Netflix','🇫🇷 Prime Video','🇫🇷 Disney+','🇫🇷 HBO Max','🇫🇷 Apple TV+','🇫🇷 CANAL+','🇫🇷 Paramount+','🇫🇷 france.tv','🇫🇷 TF1+','🇫🇷 M6+','🇫🇷 ARTE','🇫🇷 Crunchyroll + AniList','🇫🇷 ADN','🇫🇷 VOD France','🇫🇷 Genres · Films','🇫🇷 Genres · Séries'];

function collection(title, now=fixedNow, origin='https://fr-archives.example'){
  return api._internals.buildNuvioCollectionsImport(now,tz,origin).find(c=>c.title===title||c.title.endsWith(` ${title}`));
}
function folder(parent,title){return parent.folders.find(f=>f.title===title)}

test('France defaults are locked to Paris / FR / fr-FR',()=>{
  assert.equal(calendar.DEFAULT_TIMEZONE,'Europe/Paris');
  assert.equal(calendar.DEFAULT_COUNTRY,'FR');
  assert.equal(calendar.DEFAULT_LANGUAGE,'fr-FR');
});

test('France archive month windows roll automatically',()=>{
  assert.equal(calendar.dateWindow('archive-2026-08',fixedNow,tz).end,'2026-08-24');
  assert.equal(calendar.dateWindow('archive-2026-09',fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow('archive-2026-09',fixedSep,tz).empty,false);
});

test('France provider parents include French services and no US-only Hulu/Peacock',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  assert.deepEqual(payload.map(c=>c.title),expectedParents);
  assert(!payload.some(c=>['Hulu','Peacock'].includes(c.title)));
  assert(payload.some(c=>c.title==='🇫🇷 CANAL+'));
  assert(payload.some(c=>c.title==='🇫🇷 france.tv'));
  assert(payload.some(c=>c.title==='🇫🇷 TF1+'));
  assert(payload.some(c=>c.title==='🇫🇷 M6+'));
  assert(payload.some(c=>c.title==='🇫🇷 ARTE'));
  assert(payload.some(c=>c.title==='🇫🇷 ADN'));
});

test('all normal France platforms have Series and Films; VOD France is Films only',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  for(const parent of payload.filter(c=>!['🇫🇷 VOD France','🇫🇷 Genres · Films','🇫🇷 Genres · Séries'].includes(c.title))) assert.deepEqual(parent.folders.map(f=>f.title),['Séries','Films']);
  assert.deepEqual(collection('VOD France').folders.map(f=>f.title),['Films']);
  assert.equal(collection('Genres · Films').folders.length,19); assert.equal(collection('Genres · Séries').folders.length,16);
});

test('Crunchyroll + AniList keeps anime Series and anime Films',()=>{
  const crunchy=collection('Crunchyroll + AniList');
  assert.deepEqual(crunchy.folders.map(f=>f.title),['Séries','Films']);
  const series=api._internals.resolveArchiveCatalog('archives-fr-v1-series-crunchyroll-2026-08','series',fixedNow,tz);
  const films=api._internals.resolveArchiveCatalog('archives-fr-v1-movie-crunchyroll-2026-08','movie',fixedNow,tz);
  assert.equal(series.source,'crunchyroll-anime-combined');
  assert.equal(films.source,'tmdb-streaming');
});

test('France free/replay platforms accept free and ads monetization modes',()=>{
  assert.deepEqual(api._internals.providerMonetizationTypes('france-tv'),['flatrate','free','ads']);
  assert.deepEqual(api._internals.providerMonetizationTypes('tf1-plus'),['flatrate','free','ads']);
  assert.deepEqual(api._internals.providerMonetizationTypes('m6-plus'),['flatrate','free','ads']);
  assert.deepEqual(api._internals.providerMonetizationTypes('arte'),['flatrate','free','ads']);
  const provider={slug:'france-tv',ids:[42]};
  const details={'watch/providers':{results:{FR:{free:[{provider_id:42}]}}}};
  assert.equal(api._internals.hasProviderAccess(details,provider),true);
});

test('France paid platforms stay flatrate-scoped',()=>{
  for(const slug of ['netflix','prime-video','disney-plus','hbo-max','apple-tv-plus','canal-plus','paramount-plus','crunchyroll','adn']){
    assert.deepEqual(api._internals.providerMonetizationTypes(slug),['flatrate']);
  }
});

test('French provider aliases resolve robustly',()=>{
  const defs=new Map(api._internals.PROVIDERS.map(p=>[p.slug,p]));
  const directory=[
    {id:101,name:'CANAL+',normalized:'canal',logoPath:'/canal.png'},
    {id:102,name:'HBO Max',normalized:'hbo max',logoPath:'/hbo.png'},
    {id:103,name:'Paramount Plus Amazon Channel',normalized:'paramount plus amazon channel',logoPath:'/paramount.png'},
    {id:104,name:'France TV',normalized:'france tv',logoPath:'/francetv.png'},
    {id:105,name:'TF1+',normalized:'tf1',logoPath:'/tf1.png'},
    {id:106,name:'Animation Digital Network',normalized:'animation digital network',logoPath:'/adn.png'}
  ];
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('canal-plus'),directory).ids,[101]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('hbo-max'),directory).ids,[102]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('paramount-plus'),directory).ids,[103]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('france-tv'),directory).ids,[104]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('tf1-plus'),directory).ids,[105]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('adn'),directory).ids,[106]);
});

test('manifest uses unique France addon id and remains Collection-only on Home',()=>{
  const manifest=api._internals.buildManifest('https://fr-archives.example',fixedNow,tz);
  const providerCategoryCount=api._internals.ARCHIVE_SERIES_PROVIDERS.length+api._internals.ARCHIVE_FILM_PROVIDERS.length;
  assert.equal(manifest.id,'com.nuvio.calendar.archives.fr.coexist');
  assert.equal(manifest.version,'1.3.1');
  assert.equal(manifest.name,'Nuvio Calendar Archives France');
  assert.equal(manifest.catalogs.length,providerCategoryCount*(5+192)+35*(5+192));
  assert(manifest.catalogs.every(c=>c.showInHome===false));
});

test('France Collections use unique IDs/addon ID so they do not overwrite the other project',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  assert(payload.every(c=>c.id.startsWith('calendar-archives-fr-')));
  for(const parent of payload){
    assert.equal(parent.pinToTop,true);
    assert.equal(parent.viewMode,'FOLLOW_LAYOUT');
    for(const f of parent.folders){
      assert.equal(f.tileShape,'LANDSCAPE');
      assert.equal(f.hideTitle,true);
      assert(f.sources.every(s=>s.addonId==='com.nuvio.calendar.archives.fr.coexist'));
    }
  }
});

test('periods then month+years are descending and import is stable across September rollover',()=>{
  const august=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  const september=api._internals.buildNuvioCollectionsImport(fixedSep,tz,'https://fr-archives.example');
  assert.deepEqual(september,august);
  const sources=folder(august[0],'Séries').sources.map(s=>s.catalogId);
  assert.deepEqual(sources.slice(0,5),[
    'archives-fr-v1-series-netflix-today','archives-fr-v1-series-netflix-tomorrow','archives-fr-v1-series-netflix-yesterday','archives-fr-v1-series-netflix-lastweek','archives-fr-v1-series-netflix-nextweek'
  ]);
  assert(sources.indexOf('archives-fr-v1-series-netflix-2026-09')<sources.indexOf('archives-fr-v1-series-netflix-2026-08'));
});


test('VOD is based on FR Digital release dates only, not buy/rent providers',async()=>{
  const params=api._internals.vodDiscoverParams({start:'2026-08-24',end:'2026-08-24'},1);
  assert.equal(params.region,'FR');
  assert.equal(params.with_release_type,'4');
  assert.equal(params['release_date.gte'],'2026-08-24');
  assert.equal(params['release_date.lte'],'2026-08-24');
  assert.equal('watch_region' in params,false);
  assert.equal('with_watch_monetization_types' in params,false);

  const oldFetch=global.fetch;
  const oldKey=process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY='test-key';
  global.fetch=async(url)=>{
    const u=new URL(String(url));
    if(u.pathname.endsWith('/discover/movie')){
      assert.equal(u.searchParams.get('region'),'FR');
      assert.equal(u.searchParams.get('with_release_type'),'4');
      assert.equal(u.searchParams.has('with_watch_monetization_types'),false);
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({page:1,total_pages:1,results:[{id:424242}]})};
    }
    if(u.pathname.endsWith('/movie/424242')){
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        id:424242,title:'Digital Test',overview:'Sans aucun watch provider',poster_path:'/p.jpg',backdrop_path:'/b.jpg',
        external_ids:{imdb_id:'tt4242424'},
        release_dates:{results:[{iso_3166_1:'FR',release_dates:[{type:4,release_date:'2026-08-24T00:00:00.000Z'}]}]}
      })};
    }
    throw new Error('unexpected '+u.pathname);
  };
  try{
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
    const catalog=api._internals.resolveArchiveCatalog('archives-fr-v1-movie-vod-fr-today','movie',fixedNow,tz);
    const result=await api._internals.buildVodCatalog({catalog,timeZone:tz,now:fixedNow,useCache:false});
    assert.equal(result.metas.length,1);
    assert.equal(result.metas[0].name,'Digital Test');
    assert.match(result.metas[0].releaseInfo,/Digital|digitale/i);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY=oldKey;
  }
});

test('French VOD is Films-only and uses FR archive IDs',()=>{
  const vod=api._internals.resolveArchiveCatalog('archives-fr-v1-movie-vod-fr-2026-08','movie',fixedNow,tz);
  assert(vod);
  assert.equal(vod.source,'tmdb-vod');
  assert.equal(api._internals.resolveArchiveCatalog('archives-fr-v1-series-vod-fr-2026-08','series',fixedNow,tz),null);
});

test('France Modern covers and hero wordmarks keep large platform branding',()=>{
  const fake='data:image/png;base64,AAECAwQ=';
  const card=api._internals.platformCategoryCardSvg('canal-plus','series',fake);
  const hero=api._internals.platformWordmarkSvg('canal-plus',fake,'series');
  const backdrop=api._internals.platformBackdropSvg('hbo-max','movie',fake);
  assert.match(card,/CANAL\+/);
  assert.match(card,/SÉRIES/);
  assert.match(card,/data:image\/png;base64,AAECAwQ=/);
  assert.match(hero,/CANAL\+/);
  assert.match(hero,/width="1400" height="300"/);
  assert.match(backdrop,/HBO Max/);
  assert.match(backdrop,/FILMS/);
});

test('France genres are split into Films first and Series second, both with exact periods',()=>{
  const films=collection('Genres · Films');
  const series=collection('Genres · Séries');
  assert(films&&series);
  assert.equal(films.id,'calendar-archives-fr-genres');
  assert.equal(series.id,'calendar-archives-fr-genres-series');
  assert.equal(films.folders.length,19);
  assert.equal(series.folders.length,16);
  assert(films.folders.every((f)=>f.sources.length===197));
  assert(series.folders.every((f)=>f.sources.length===197));
  const action=films.folders.find((f)=>f.title==='Action');
  assert(action);
  assert.deepEqual(action.sources.slice(0,5).map((s)=>s.catalogId),[
    'genres-fr-movie-28',
    'genres-fr-movie-28-tomorrow',
    'genres-fr-movie-28-yesterday',
    'genres-fr-movie-28-lastweek',
    'genres-fr-movie-28-nextweek'
  ]);
  assert.equal(action.sources[5].catalogId,'genres-fr-movie-28-2030-12');
  assert.equal(action.sources.at(-1).catalogId,'genres-fr-movie-28-2015-01');
  const actionSeries=series.folders.find((f)=>f.title==='Action & Aventure');
  assert(actionSeries);
  assert.equal(actionSeries.sources[0].catalogId,'genres-fr-series-10759');
  assert.equal(actionSeries.sources[5].catalogId,'genres-fr-series-10759-2030-12');
  assert.equal(actionSeries.sources.at(-1).catalogId,'genres-fr-series-10759-2015-01');
  assert.equal(api._internals.resolveArchiveCatalog('genres-fr-movie-28','movie',fixedNow,tz).period,'today');
  assert.equal(api._internals.resolveArchiveCatalog('genres-fr-series-10759-nextweek','series',fixedNow,tz).period,'nextweek');
  assert.equal(api._internals.resolveArchiveCatalog('genres-fr-movie-28-2026-08','movie',fixedNow,tz).period,'archive-2026-08');
});


test('desktop gets the exact cinematic 16:9 card through banner', () => {
  const meta = {
    id: 'tt1234567',
    type: 'movie',
    name: 'Desktop Cinematic Test',
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    releaseInfo: 'Test',
    released: '2026-08-30',
    _calendarProvider: 'Netflix',
    _calendarSource: 'tmdb-streaming'
  };
  const [decorated] = api._internals.decorateCatalogMetas(
    'https://catalog.example',
    [meta],
    { period: 'today', type: 'movie', cardProvider: 'Netflix' },
    'Europe/Paris'
  );
  assert.equal(decorated.posterShape, 'landscape');
  assert.match(decorated.background, /calendar-card\.svg/);
  assert.match(decorated.banner, /calendar-card\.svg/);
  assert.equal(decorated.banner, decorated.background);
});
