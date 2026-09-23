'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar');
const api=require('../api/index');

const fixedNow=new Date('2026-08-24T12:28:00Z');
const fixedSep=new Date('2026-09-01T12:28:00Z');
const tz='Europe/Paris';
const expectedParents=['🇫🇷 Tendances & Cinéma','🇫🇷 Netflix','🇫🇷 Prime Video','🇫🇷 Disney+','🇫🇷 HBO Max','🇫🇷 Apple TV+','🇫🇷 CANAL+','🇫🇷 Paramount+','🇫🇷 france.tv','🇫🇷 TF1+','🇫🇷 M6+','🇫🇷 ARTE','🇫🇷 Crunchyroll + AniList','🇫🇷 ADN','🇫🇷 VOD France','🇫🇷 Genres · Films','🇫🇷 Genres · Séries'];

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

test('Cinema uses its own real week/month windows instead of the generic fallback',()=>{
  const zone='Europe/Brussels';
  assert.deepEqual(api._internals.cinemaDateWindow('thisweek',fixedNow,zone),{
    start:'2026-08-24',end:'2026-08-30',today:'2026-08-24',allowPast:true
  });
  assert.deepEqual(api._internals.cinemaDateWindow('thismonth',fixedNow,zone),{
    start:'2026-08-01',end:'2026-08-31',today:'2026-08-24',allowPast:true
  });
  assert.deepEqual(api._internals.cinemaDateWindow('previousmonth',fixedNow,zone),{
    start:'2026-07-01',end:'2026-07-31',today:'2026-08-24',allowPast:true
  });
  assert.deepEqual(api._internals.cinemaDateWindow('nextmonth',fixedNow,zone),{
    start:'2026-09-01',end:'2026-09-30',today:'2026-08-24'
  });
});

test('Cinema runtime is bounded so a slow Torrentio cannot hold Nuvio open indefinitely',()=>{
  assert(api._internals.CINEMA_RESPONSE_BUDGET_MS<=12000);
  assert(api._internals.CINEMA_MAX_DISCOVERY_CANDIDATES<=80);
  assert(api._internals.CINEMA_SCAN_BATCH_SIZE<=16);
  assert(api._internals.CINEMA_TARGET_ITEMS<=24);
  assert(api._internals.CINEMA_CANDIDATE_TIMEOUT_MS<=5000);
  assert(api._internals.CINEMA_TORRENTIO_REQUEST_TIMEOUT_MS<=5000);
  for(const period of ['thisweek','thismonth','previousmonth','nextmonth']){
    assert.equal(api._internals.isHomeCalendarPeriod(period),true);
  }
  const nowPlaying=api._internals.resolveArchiveCatalog('cinema-torrentio-nowplaying','movie',fixedNow,'Europe/Brussels');
  assert.equal(nowPlaying.source,'torrentio-theatrical');
  assert.equal(nowPlaying.cinemaBucket,'nowplaying');
  const cinema=api._internals.resolveArchiveCatalog('cinema-torrentio-thismonth','movie',fixedNow,'Europe/Brussels');
  assert.equal(cinema.source,'torrentio-theatrical');
  assert.equal(cinema.cinemaBucket,'thismonth');
});

test('Cinema card renderer uses a real Cinema label and no fake platform identity',()=>{
  assert.equal(api._internals.platformCollectionTitle('cinema-torrentio'),'Cinéma · Torrentio');
  assert.equal(api._internals.providerAccentColor('Cinéma · Torrentio'),'#e11d48');
});


test('Editorial collection has six folders and periods are catalogs inside each folder',()=>{
  const editorial=api._internals.buildEditorialCollection('https://fr-archives.example');
  assert.equal(editorial.id,'calendar-archives-fr-editorial-now');
  assert.equal(editorial.title,'🇫🇷 Tendances & Cinéma');
  assert.deepEqual(editorial.folders.map((f)=>f.title),[
    '⭐ Séries les mieux notées',
    '🔥 Séries les plus trendy',
    '🆕 Nouvelles séries',
    '🔁 Séries renouvelées',
    '🎬 Nouveaux films',
    '🎬 Films au cinéma actuellement'
  ]);
  assert.deepEqual(editorial.folders[0].sources.map((x)=>x.catalogId),[
    'editorial-series-top-rated-yesterday',
    'editorial-series-top-rated-lastweek',
    'editorial-series-top-rated-lastmonth'
  ]);
  assert.deepEqual(editorial.folders[0].sources.map((x)=>x.genre),[
    'Hier','Semaine passée','Mois dernier'
  ]);
  assert.deepEqual(editorial.folders[1].sources.map((x)=>x.catalogId),[
    'editorial-series-trendy-yesterday',
    'editorial-series-trendy-lastweek',
    'editorial-series-trendy-lastmonth'
  ]);
  assert.deepEqual(editorial.folders[1].sources.map((x)=>x.genre),[
    'Hier','Semaine passée','Mois dernier'
  ]);
  assert.deepEqual(editorial.folders[2].sources.map((x)=>x.catalogId),[
    'editorial-series-new-thisweek',
    'editorial-series-new-thismonth'
  ]);
  assert.deepEqual(editorial.folders[2].sources.map((x)=>x.genre),[
    'Cette semaine','Ce mois'
  ]);
  assert.deepEqual(editorial.folders[3].sources.map((x)=>x.catalogId),[
    'editorial-series-returning-thisweek',
    'editorial-series-returning-thismonth'
  ]);
  assert.deepEqual(editorial.folders[3].sources.map((x)=>x.genre),[
    'Cette semaine','Ce mois'
  ]);
  assert.deepEqual(editorial.folders[4].sources.map((x)=>x.catalogId),[
    'editorial-movies-new-thisweek',
    'editorial-movies-new-thismonth'
  ]);
  assert.deepEqual(editorial.folders[4].sources.map((x)=>x.genre),[
    'Cette semaine','Ce mois'
  ]);
  assert.deepEqual(editorial.folders[5].sources.map((x)=>x.catalogId),[
    'editorial-movies-cinema-now'
  ]);
  assert.deepEqual(editorial.folders[5].sources.map((x)=>x.genre),[
    'À l’affiche actuellement'
  ]);
  assert(editorial.folders.every((f)=>f.coverImageUrl&&f.heroBackdropUrl&&f.titleLogoUrl));
  assert.match(editorial.folders[0].coverImageUrl,/\/editorial-cover\.jpg\?key=series-top-rated/);
  assert.match(editorial.folders[1].coverImageUrl,/\/editorial-cover\.jpg\?key=series-trendy/);
  assert.match(editorial.folders[2].coverImageUrl,/genre-folder-art\.svg/);
  assert.match(editorial.folders[3].coverImageUrl,/genre-folder-art\.svg/);
  assert.match(editorial.folders[4].coverImageUrl,/platform-category-card\.svg/);
  assert.match(editorial.folders[5].coverImageUrl,/\/editorial-cover\.jpg\?key=cinema-now/);

  const top=api._internals.resolveArchiveCatalog('editorial-series-top-rated-yesterday','series',fixedNow,tz);
  const trendy=api._internals.resolveArchiveCatalog('editorial-series-trendy-lastweek','series',fixedNow,tz);
  const newSeries=api._internals.resolveArchiveCatalog('editorial-series-new-thisweek','series',fixedNow,tz);
  const returning=api._internals.resolveArchiveCatalog('editorial-series-returning-thismonth','series',fixedNow,tz);
  const newMovie=api._internals.resolveArchiveCatalog('editorial-movies-new-thisweek','movie',fixedNow,tz);
  const cinema=api._internals.resolveArchiveCatalog('editorial-movies-cinema-now','movie',fixedNow,tz);
  assert.equal(top.source,'editorial-series');
  assert.equal(top.editorialMode,'top-rated');
  assert.equal(trendy.source,'editorial-series');
  assert.equal(trendy.editorialMode,'trendy');
  assert.equal(newSeries.source,'editorial-fresh');
  assert.equal(newSeries.editorialMode,'series-new');
  assert.equal(returning.source,'editorial-fresh');
  assert.equal(returning.editorialMode,'series-returning');
  assert.equal(newMovie.source,'editorial-fresh');
  assert.equal(newMovie.editorialMode,'movie-new');
  assert.equal(cinema.source,'editorial-cinema');
  assert.equal(cinema.editorialMode,'cinema-now');
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
  for(const parent of payload.filter(c=>!['🇫🇷 Tendances & Cinéma','🇫🇷 VOD France','🇫🇷 Genres · Films','🇫🇷 Genres · Séries'].includes(c.title))) assert.deepEqual(parent.folders.map(f=>f.title),['Séries','Films']);
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
  assert.equal(manifest.version,'1.3.2');
  assert.equal(manifest.name,'Nuvio Calendar Archives France');
  assert.equal(manifest.catalogs.length,providerCategoryCount*(5+192)+35*(5+192)+23);
  assert.deepEqual(
    manifest.catalogs.filter(c=>c.id.startsWith('cinema-torrentio-')).map(c=>c.id),
    ['cinema-torrentio-nowplaying','cinema-torrentio-recent','cinema-torrentio-today','cinema-torrentio-yesterday','cinema-torrentio-thisweek','cinema-torrentio-lastweek','cinema-torrentio-thismonth','cinema-torrentio-previousmonth','cinema-torrentio-nextweek','cinema-torrentio-nextmonth']
  );
  assert.deepEqual(
    manifest.catalogs.filter(c=>c.id.startsWith('editorial-')).map(c=>c.id),
    [
      'editorial-series-top-rated-yesterday','editorial-series-trendy-yesterday',
      'editorial-series-top-rated-lastweek','editorial-series-trendy-lastweek',
      'editorial-series-top-rated-lastmonth','editorial-series-trendy-lastmonth',
      'editorial-series-new-thisweek','editorial-series-returning-thisweek','editorial-movies-new-thisweek',
      'editorial-series-new-thismonth','editorial-series-returning-thismonth','editorial-movies-new-thismonth',
      'editorial-movies-cinema-now'
    ]
  );
  assert(manifest.catalogs.filter(c=>c.id.startsWith('editorial-series-')).every(c=>c.name==='Séries'));
  assert.equal(manifest.catalogs.find(c=>c.id==='editorial-movies-cinema-now')?.name,'Films');
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
  const netflix=august.find((c)=>c.title==='🇫🇷 Netflix');
  const sources=folder(netflix,'Séries').sources.map(s=>s.catalogId);
  assert.deepEqual(sources.slice(0,5),[
    'archives-fr-v1-series-netflix-today','archives-fr-v1-series-netflix-tomorrow','archives-fr-v1-series-netflix-yesterday','archives-fr-v1-series-netflix-lastweek','archives-fr-v1-series-netflix-nextweek'
  ]);
  assert(sources.indexOf('archives-fr-v1-series-netflix-2026-09')<sources.indexOf('archives-fr-v1-series-netflix-2026-08'));
});


test('Fresh editorial windows stop at today and returning means a real S2+ premiere',()=>{
  const now=new Date('2026-09-23T07:00:00Z');
  assert.deepEqual(api._internals.editorialFreshWindow('thisweek',now,'Europe/Brussels'),{
    start:'2026-09-21',end:'2026-09-23',today:'2026-09-23',kind:'thisweek',allowPast:true
  });
  assert.deepEqual(api._internals.editorialFreshWindow('thismonth',now,'Europe/Brussels'),{
    start:'2026-09-01',end:'2026-09-23',today:'2026-09-23',kind:'thismonth',allowPast:true
  });
  const season=api._internals.editorialReturningSeason({
    seasons:[
      {season_number:1,air_date:'2025-01-02'},
      {season_number:2,air_date:'2026-09-22'},
      {season_number:3,air_date:'2027-01-01'}
    ]
  },{start:'2026-09-21',end:'2026-09-23'});
  assert.deepEqual(season,{seasonNumber:2,airDate:'2026-09-22'});
  assert.equal(api._internals.editorialReturningSeason({
    seasons:[{season_number:1,air_date:'2026-09-22'}]
  },{start:'2026-09-21',end:'2026-09-23'}),null);
  assert.deepEqual(api._internals.editorialFreshMovieRelease({
    release_dates:{results:[{iso_3166_1:'BE',release_dates:[
      {type:3,release_date:'2026-09-22T00:00:00.000Z'}
    ]}]}
  },{release_date:'2026-09-01'},{start:'2026-09-21',end:'2026-09-23'}),{type:3,date:'2026-09-22'});
});

test('Editorial series uses period air-date filters and keeps only new or active shows',async()=>{
  const oldFetch=global.fetch;
  const oldKey=process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY='test-key';
  global.fetch=async(url)=>{
    const u=new URL(String(url));
    if(u.pathname.endsWith('/discover/tv')){
      assert.equal(u.searchParams.get('air_date.gte'),'2026-08-23');
      assert.equal(u.searchParams.get('air_date.lte'),'2026-08-23');
      assert.equal(u.searchParams.get('sort_by'),'vote_average.desc');
      assert.equal(u.searchParams.get('vote_count.gte'),'200');
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        page:1,total_pages:1,results:[
          {id:701,vote_average:8.7,vote_count:1200,popularity:80},
          {id:702,vote_average:9.1,vote_count:400,popularity:40},
          {id:703,vote_average:9.8,vote_count:900,popularity:20}
        ]
      })};
    }
    const m=u.pathname.match(/\/tv\/(701|702|703)$/);
    if(m){
      const id=Number(m[1]);
      const defs={
        701:{name:'Active Hit',status:'Returning Series',first_air_date:'2024-01-01',last_air_date:'2026-08-23',vote_average:8.7,vote_count:1200,popularity:80,imdb:'tt7000001'},
        702:{name:'New Limited',status:'Ended',first_air_date:'2026-08-23',last_air_date:'2026-08-23',vote_average:9.1,vote_count:400,popularity:40,imdb:'tt7000002'},
        703:{name:'Old Ended',status:'Ended',first_air_date:'2020-01-01',last_air_date:'2020-02-01',vote_average:9.8,vote_count:900,popularity:20,imdb:'tt7000003'}
      }[id];
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        id,name:defs.name,overview:'Test',status:defs.status,first_air_date:defs.first_air_date,last_air_date:defs.last_air_date,
        last_episode_to_air:{air_date:defs.last_air_date},next_episode_to_air:null,
        vote_average:defs.vote_average,vote_count:defs.vote_count,popularity:defs.popularity,
        poster_path:'/p.jpg',backdrop_path:'/b.jpg',genres:[{name:'Drama'}],external_ids:{imdb_id:defs.imdb}
      })};
    }
    throw new Error('unexpected '+u.pathname);
  };
  try{
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
    const catalog=api._internals.resolveArchiveCatalog('editorial-series-top-rated-yesterday','series',fixedNow,tz);
    const result=await api._internals.buildEditorialSeriesCatalog({catalog,timeZone:tz,now:fixedNow,useCache:false});
    assert.deepEqual(result.metas.map((m)=>m.name),['New Limited','Active Hit']);
    assert.equal(result.stats.final,2);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY=oldKey;
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
  }
});

test('Cinema Yesterday and Last Week use targeted Belgian release discovery when shared index misses them',async()=>{
  const oldFetch=global.fetch;
  const oldKey=process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY='test-key';
  global.fetch=async(url)=>{
    const u=new URL(String(url));
    if(u.hostname==='torrentio.strem.fun'){
      return {ok:false,status:403,headers:{get:()=>null},json:async()=>({})};
    }
    if(u.pathname.endsWith('/discover/movie')){
      assert.equal(u.searchParams.get('region'),'BE');
      assert.equal(u.searchParams.get('with_release_type'),'2|3');
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        page:1,total_pages:1,results:[{id:901,popularity:123,release_date:'2026-08-23'}]
      })};
    }
    if(u.pathname.endsWith('/movie/901')){
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        id:901,title:'Historical Cinema',overview:'Test',release_date:'2026-08-23',popularity:123,
        vote_average:7.1,vote_count:321,poster_path:'/p.jpg',backdrop_path:'/b.jpg',
        external_ids:{imdb_id:'tt9000001'},
        release_dates:{results:[{iso_3166_1:'BE',release_dates:[{type:3,release_date:'2026-08-23T00:00:00.000Z'}]}]}
      })};
    }
    throw new Error('unexpected '+u.toString());
  };
  try{
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();

    const yesterday=api._internals.resolveArchiveCatalog('cinema-torrentio-yesterday','movie',fixedNow,'Europe/Brussels');
    const y=await api._internals.buildTargetedCinemaHistoricalCatalog({
      catalog:yesterday,timeZone:'Europe/Brussels',now:fixedNow,useCache:false
    });
    assert.equal(y.metas.length,1);
    assert.equal(y.metas[0].name,'Historical Cinema');

    const lastweek=api._internals.resolveArchiveCatalog('cinema-torrentio-lastweek','movie',fixedNow,'Europe/Brussels');
    const w=await api._internals.buildTargetedCinemaHistoricalCatalog({
      catalog:lastweek,timeZone:'Europe/Brussels',now:fixedNow,useCache:false
    });
    assert.equal(w.metas.length,1);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY=oldKey;
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
  }
});

test('Top cover badges stay fully inside the 1600x900 safe frame',()=>{
  const svg=api._internals.desktopOverlaySvg('series','#ff5a36',{
    title:'Séries les plus trendy',
    subtitle:'Tendances & Cinéma',
    providerLabel:'Tendances & Cinéma',
    bottomTag:'Tendances & Cinéma'
  }).toString('utf8');
  assert.match(svg,/x="1022" y="56" width="344" height="112"/);
  assert.match(svg,/x="1378" y="56" width="164" height="112"/);
  assert.doesNotMatch(svg,/x="1392" y="32"/);
  assert.doesNotMatch(svg,/x="1018" y="32"/);
});

test('Editorial cinema uses Belgian TMDb now-playing and does not require Torrentio',async()=>{
  const oldFetch=global.fetch;
  const oldKey=process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY='test-key';
  global.fetch=async(url)=>{
    const u=new URL(String(url));
    if(u.pathname.endsWith('/movie/now_playing')){
      assert.equal(u.searchParams.get('region'),'BE');
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        page:1,total_pages:1,results:[{id:801,popularity:333,release_date:'2026-08-20'}]
      })};
    }
    if(u.pathname.endsWith('/movie/801')){
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({
        id:801,title:'Cinema Belgium',overview:'Test',release_date:'2026-08-20',popularity:333,
        vote_average:7.4,vote_count:500,poster_path:'/p.jpg',backdrop_path:'/b.jpg',
        external_ids:{imdb_id:'tt8000001'},
        release_dates:{results:[{iso_3166_1:'BE',release_dates:[{type:3,release_date:'2026-08-20T00:00:00.000Z'}]}]}
      })};
    }
    throw new Error('unexpected '+u.pathname);
  };
  try{
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
    const catalog=api._internals.resolveArchiveCatalog('editorial-movies-cinema-now','movie',fixedNow,'Europe/Brussels');
    const result=await api._internals.buildEditorialCinemaCatalog({catalog,timeZone:'Europe/Brussels',now:fixedNow,useCache:false});
    assert.equal(result.metas.length,1);
    assert.equal(result.metas[0].name,'Cinema Belgium');
    assert.match(result.metas[0].releaseInfo,/À l’affiche en Belgique/);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY=oldKey;
    api._internals.catalogCache.clear?.();
    api._internals.detailsCache.clear?.();
  }
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


test('desktop gets a dedicated cinematic JPEG while Shield keeps its SVG background', () => {
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
  assert.match(decorated.banner, /desktop-content-card\.jpg/);
  assert.notEqual(decorated.banner, decorated.background);
});


test('France manifest 1.3.2 explicitly publishes every Cinema du moment catalog',()=>{
  const manifest=api._internals.buildManifest('https://example.invalid/fr',fixedNow,'Europe/Brussels');
  assert.equal(manifest.version,'1.3.2');
  const cinemaIds=manifest.catalogs.filter(c=>c.type==='movie'&&c.id.startsWith('cinema-torrentio-')).map(c=>c.id);
  assert.deepEqual(cinemaIds,[
    'cinema-torrentio-nowplaying',
    'cinema-torrentio-recent',
    'cinema-torrentio-today',
    'cinema-torrentio-yesterday',
    'cinema-torrentio-thisweek',
    'cinema-torrentio-lastweek',
    'cinema-torrentio-thismonth',
    'cinema-torrentio-previousmonth',
    'cinema-torrentio-nextweek',
    'cinema-torrentio-nextmonth'
  ]);
});
