'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/index');
function call(path,headers={}){return new Promise((resolve,reject)=>{const req={method:'GET',url:path,headers:{host:'archives.example','x-forwarded-proto':'https',...headers}};const out={statusCode:200,headers:{},body:Buffer.alloc(0)};const chunks=[];const res={get statusCode(){return out.statusCode},set statusCode(v){out.statusCode=v},setHeader(k,v){out.headers[String(k).toLowerCase()]=v},end(v=''){if(v){chunks.push(Buffer.isBuffer(v)?v:Buffer.from(String(v)))}out.body=Buffer.concat(chunks);out.text=out.body.toString('utf8');resolve(out)},getHeader(k){return out.headers[String(k).toLowerCase()]}};Promise.resolve(handler(req,res)).catch(reject)})}
const tz={'x-vercel-ip-timezone':'Europe/Brussels'};

test('manifest route exposes v1.5 periods first plus month+year catalogs',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/manifest.json',tz);assert.equal(r.statusCode,200);const m=JSON.parse(r.text);
    assert.equal(m.version,'1.6.1');assert.equal(m.catalogs.length,4158);
    assert(m.catalogs.some(c=>c.name==='Aujourd’hui'&&c.type==='series'));
    assert(m.catalogs.some(c=>c.name==='La semaine suivante'&&c.type==='movie'));
    assert(m.catalogs.some(c=>c.name==='Août 2026'&&c.type==='series'));
    assert(!m.catalogs.some(c=>c.name==='Netflix — Août 2026'));
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('future September row is already wired and makes zero upstream calls in August',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/series/archives-v3-series-netflix-2026-09.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('prewired 2027 row also makes zero upstream calls while still in 2026',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/movie/archives-v3-movie-prime-video-2027-01.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});


test('prewired 2030 row is already valid and zero-upstream while still in 2026',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/movie/archives-v3-movie-prime-video-2030-12.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('old 2025 rows become empty automatically in 2027 so only two years remain visible',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2027-01-05T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/series/archives-v3-series-netflix-2025-12.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('VOD future row is Films-only and zero-upstream',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not call upstream')};
  try{const r=await call('/catalog/movie/archives-v3-movie-vod-us-2026-10.json',tz);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});



test('current Paramount+ catalog soft-fails to HTTP 200 instead of crashing Nuvio when upstream fails',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  const oldFetch=global.fetch;const oldKey=process.env.TMDB_API_KEY;process.env.TMDB_API_KEY='test-key';
  global.fetch=async()=>{throw new Error('simulated upstream outage')};
  try{
    handler._internals.providerCache.clear();handler._internals.catalogCache.clear();
    const series=await call('/catalog/series/archives-v3-series-paramount-plus-2026-08.json',tz);
    assert.equal(series.statusCode,200);
    assert.deepEqual(JSON.parse(series.text),{metas:[]});
    assert.equal(series.headers['x-nuvio-upstream-error'],'1');
    const movie=await call('/catalog/movie/archives-v3-movie-paramount-plus-2026-08.json',tz);
    assert.equal(movie.statusCode,200);
    assert.deepEqual(JSON.parse(movie.text),{metas:[]});
    assert.equal(movie.headers['x-nuvio-upstream-error'],'1');
  }finally{global.fetch=oldFetch;delete process.env.NUVIO_NOW_OVERRIDE;if(oldKey===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=oldKey}
});

test('collections route is platform parents -> Series/Films -> five periods -> months',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/nuvio-collections.json',tz);assert.equal(r.statusCode,200);const p=JSON.parse(r.text);
    assert.deepEqual(p.map(x=>x.title),['🇺🇸 Netflix','🇺🇸 Prime Video','🇺🇸 Disney+','🇺🇸 Max','🇺🇸 Apple TV+','🇺🇸 Paramount+','🇺🇸 Peacock','🇺🇸 Hulu','🇺🇸 Crunchyroll + AniList','🇺🇸 VOD','🇺🇸 TMDb Genres']);
    assert.deepEqual(p[0].folders.map(x=>x.title),['Séries','Films']);
    assert.deepEqual(p[8].folders.map(x=>x.title),['Séries','Films']);
    assert.deepEqual(p[9].folders.map(x=>x.title),['Films']);
    assert.equal(p[0].folders[0].sources.length,77);
    assert.deepEqual(p[0].folders[0].sources.slice(0,5).map(x=>x.catalogId),[
      'archives-v3-series-netflix-today','archives-v3-series-netflix-tomorrow','archives-v3-series-netflix-yesterday','archives-v3-series-netflix-lastweek','archives-v3-series-netflix-nextweek'
    ]);
    assert.equal(p[0].folders[0].sources[57].catalogId,'archives-v3-series-netflix-2026-08');
    assert.equal(p[0].pinToTop,true);
    assert.equal(p[0].folders[0].hideTitle,true);
    assert.equal(p[0].folders[1].hideTitle,true);
    assert.equal(p[0].folders[0].coverImageUrl,'https://archives.example/platform-category-card.svg?provider=netflix&category=series&v=coex-us170-cinematic');
    assert.equal(p[0].folders[1].titleLogoUrl,'https://archives.example/platform-logo?provider=netflix&type=movie&v=coex-us170-cinematic');
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});



test('Paramount+ collection exposes both Series and Films with correct routed catalog IDs',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/nuvio-collections.json',tz);const p=JSON.parse(r.text);const c=p.find(x=>x.title==='🇺🇸 Paramount+');
    assert.deepEqual(c.folders.map(x=>x.title),['Séries','Films']);
    assert(c.folders[0].sources.some(x=>x.catalogId==='archives-v3-series-paramount-plus-2026-08'));
    assert(c.folders[1].sources.some(x=>x.catalogId==='archives-v3-movie-paramount-plus-2026-08'));
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('Crunchyroll collection points every Series row at the Crunchyroll parent catalog IDs',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/nuvio-collections.json',tz);const p=JSON.parse(r.text);const c=p.find(x=>x.title==='🇺🇸 Crunchyroll + AniList');
    assert.equal(c.folders.length,2);
    assert(c.folders[0].sources.every(x=>x.catalogId.startsWith('archives-v3-series-crunchyroll-')));assert(c.folders[1].sources.every(x=>x.catalogId.startsWith('archives-v3-movie-crunchyroll-')));
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('blueprint route describes periods, rolling months and Crunchyroll anime merge',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{const r=await call('/archive-blueprint.json',tz);const b=JSON.parse(r.text);assert.equal(b.schema,'nuvio-calendar-archives-blueprint-v1.5.5');assert.equal(b.hierarchy,'platform collection -> Series/Films folder -> dynamic periods -> month+year rows descending -> content');assert.equal(b.visibleRollingYears,2);assert.equal(b.prewiredFutureYears,4);assert.equal(b.platformParents.at(-1),'🇺🇸 VOD');assert.match(b.note,/Crunchyroll.*AniList/)}finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('modern category-card route renders a clean centered provider cover when credentials are absent',async()=>{
  const oldKey=process.env.TMDB_API_KEY;const oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{const r=await call('/platform-category-card.svg?provider=netflix&category=series');assert.equal(r.statusCode,200);assert.match(r.headers['content-type'],/image\/svg\+xml/);assert.match(r.text,/SÉRIES/);assert.match(r.text,/Netflix/);assert.match(r.text,/text-anchor="middle"/);assert.match(r.text,/PÉRIODES \+ MOIS/)}finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});

test('Crunchyroll card announces combined anime',async()=>{
  const oldKey=process.env.TMDB_API_KEY;const oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{const r=await call('/platform-category-card.svg?provider=crunchyroll&category=series');assert.equal(r.statusCode,200);assert.match(r.text,/CRUNCHYROLL \+ ANILIST/)}finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});



test('platform-logo route returns a wide SVG wordmark, not the raw square provider icon',async()=>{
  const oldKey=process.env.TMDB_API_KEY;const oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{
    const r=await call('/platform-logo?provider=paramount-plus&type=series');
    assert.equal(r.statusCode,200);
    assert.match(r.headers['content-type'],/image\/svg\+xml/);
    assert.match(r.text,/width="1400" height="300"/);
    assert.match(r.text,/Paramount\+/);
  }finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});

test('platform backdrop route is HD vector artwork with platform and category',async()=>{
  const oldKey=process.env.TMDB_API_KEY;const oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{const r=await call('/platform-backdrop.svg?provider=disney-plus&type=movie');assert.equal(r.statusCode,200);assert.match(r.text,/width="1920" height="1080"/);assert.match(r.text,/Disney\+/);assert.match(r.text,/FILMS/);assert.match(r.text,/CALENDAR ARCHIVES/)}finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});
