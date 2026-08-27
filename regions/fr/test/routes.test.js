'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/index');

function call(path,headers={}){return new Promise((resolve,reject)=>{const req={method:'GET',url:path,headers:{host:'fr-archives.example','x-forwarded-proto':'https',...headers}};const chunks=[];const out={statusCode:200,headers:{}};const res={get statusCode(){return out.statusCode},set statusCode(v){out.statusCode=v},setHeader(k,v){out.headers[String(k).toLowerCase()]=v},getHeader(k){return out.headers[String(k).toLowerCase()]},end(v=''){if(v)chunks.push(Buffer.isBuffer(v)?v:Buffer.from(String(v)));out.body=Buffer.concat(chunks);out.text=out.body.toString('utf8');resolve(out)}};Promise.resolve(handler(req,res)).catch(reject)})}

test('manifest route is France-specific',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/manifest.json',{'x-vercel-ip-timezone':'America/New_York'});
    assert.equal(r.statusCode,200);
    const m=JSON.parse(r.text);
    assert.equal(m.id,'com.nuvio.calendar.archives.fr.coexist');
    assert.equal(m.version,'1.1.1');
    assert.match(m.name,/France/);
    assert(m.catalogs.some(c=>c.id==='archives-fr-v1-series-canal-plus-2026-08'));
    assert(m.catalogs.some(c=>c.id==='archives-fr-v1-movie-vod-fr-2026-08'));
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('collections route exposes French platform parents and hosted Modern images',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  try{
    const r=await call('/nuvio-collections.json');assert.equal(r.statusCode,200);const p=JSON.parse(r.text);
    assert.deepEqual(p.map(x=>x.title),['🇫🇷 Netflix','🇫🇷 Prime Video','🇫🇷 Disney+','🇫🇷 HBO Max','🇫🇷 Apple TV+','🇫🇷 CANAL+','🇫🇷 Paramount+','🇫🇷 france.tv','🇫🇷 TF1+','🇫🇷 M6+','🇫🇷 ARTE','🇫🇷 Crunchyroll + AniList','🇫🇷 ADN','🇫🇷 VOD France','🇫🇷 Genres TMDb']);
    const canal=p.find(x=>x.title==='🇫🇷 CANAL+');
    assert.deepEqual(canal.folders.map(f=>f.title),['Séries','Films']);
    assert.match(canal.folders[0].coverImageUrl,/platform-category-card\.svg\?provider=canal-plus&category=series&v=coex-fr120-cinematic$/);
    assert.match(canal.folders[0].titleLogoUrl,/platform-logo\?provider=canal-plus&type=series&v=coex-fr120-cinematic$/);
  }finally{delete process.env.NUVIO_NOW_OVERRIDE}
});

test('France timezone is forced even when request header says another country',async()=>{
  const r=await call('/archive-blueprint.json',{'x-vercel-ip-timezone':'America/Los_Angeles'});
  const b=JSON.parse(r.text);
  assert.equal(b.generatedForTimezone,'Europe/Paris');
  assert.equal(b.market,'FR');
  assert.equal(b.language,'fr-FR');
});

test('future September catalog is prewired and zero-upstream in August',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not fetch')};
  try{const r=await call('/catalog/series/archives-fr-v1-series-netflix-2026-09.json');assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});


test('France 2030 row is prewired now and stays zero-upstream until its active year',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw new Error('must not fetch')};
  try{const r=await call('/catalog/series/archives-fr-v1-series-netflix-2030-12.json');assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]});assert.equal(calls,0)}finally{global.fetch=old;delete process.env.NUVIO_NOW_OVERRIDE}
});

test('active France catalog soft-fails to HTTP 200 if TMDb is unavailable',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  const oldFetch=global.fetch, oldKey=process.env.TMDB_API_KEY, oldToken=process.env.TMDB_READ_TOKEN;
  process.env.TMDB_API_KEY='test';delete process.env.TMDB_READ_TOKEN;
  global.fetch=async()=>{throw new Error('simulated upstream outage')};
  try{
    const r=await call('/catalog/series/archives-fr-v1-series-paramount-plus-2026-08.json');
    assert.equal(r.statusCode,200);
    assert.deepEqual(JSON.parse(r.text),{metas:[]});
    assert.equal(r.headers['x-nuvio-upstream-error'],'1');
  }finally{global.fetch=oldFetch;delete process.env.NUVIO_NOW_OVERRIDE;if(oldKey===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=oldKey;if(oldToken===undefined)delete process.env.TMDB_READ_TOKEN;else process.env.TMDB_READ_TOKEN=oldToken}
});

test('France local free platform also soft-fails safely',async()=>{
  process.env.NUVIO_NOW_OVERRIDE='2026-08-24T12:28:00Z';
  const oldFetch=global.fetch, oldKey=process.env.TMDB_API_KEY;process.env.TMDB_API_KEY='test';global.fetch=async()=>{throw new Error('offline')};
  try{const r=await call('/catalog/movie/archives-fr-v1-movie-france-tv-2026-08.json');assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.text),{metas:[]})}finally{global.fetch=oldFetch;delete process.env.NUVIO_NOW_OVERRIDE;if(oldKey===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=oldKey}
});

test('France category-card and hero routes render large platform names even without TMDb credentials',async()=>{
  const oldKey=process.env.TMDB_API_KEY, oldToken=process.env.TMDB_READ_TOKEN;delete process.env.TMDB_API_KEY;delete process.env.TMDB_READ_TOKEN;
  try{
    const card=await call('/platform-category-card.svg?provider=canal-plus&category=films&v=coex-fr120-cinematic');
    assert.equal(card.statusCode,200);assert.match(card.text,/CANAL\+/);assert.match(card.text,/FILMS/);
    const logo=await call('/platform-logo?provider=hbo-max&type=series&v=coex-fr120-cinematic');
    assert.equal(logo.statusCode,200);assert.match(logo.text,/HBO Max/);assert.match(logo.text,/width="1400" height="300"/);
  }finally{if(oldKey!==undefined)process.env.TMDB_API_KEY=oldKey;if(oldToken!==undefined)process.env.TMDB_READ_TOKEN=oldToken}
});
