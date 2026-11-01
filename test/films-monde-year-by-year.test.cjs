'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');
const movies = require('../regions/movies/index.cjs');

const ORIGIN = 'https://nuvio.test/movies';
const original = (now) => movies._internals.buildCollections(ORIGIN, now, 'shield');
const byYear = (now) => movies._internals.buildYearByYearCollections(ORIGIN, now, 'shield');
const sourceIds = (c) => c.folders.flatMap(f => f.sources.map(x => x.catalogId)).sort();
function get(path) {
 return new Promise((resolve,reject) => {
  let status=200; const headers={};
  const req={method:'GET',url:path,headers:{host:'nuvio.test','x-forwarded-proto':'https'}};
  const res={
   get statusCode(){return status},set statusCode(v){status=v},
   setHeader(k,v){headers[k.toLowerCase()]=v},getHeader(k){return headers[k.toLowerCase()]},
   end(b=''){resolve({status,headers,body:Buffer.isBuffer(b)?b.toString('utf8'):String(b)})}
  };
  Promise.resolve(handler(req,res)).catch(reject);
 });
}

test('year-by-year import preserves every original catalog period, exact approved genre art and 4 collection identities',()=>{
 const date=new Date('2026-11-01T12:00:00.000Z');
 const before=original(date), after=byYear(date);
 assert.equal(after.length,4);
 for(let i=0;i<before.length;i++){
  const orig=before[i], next=after[i];
  assert.equal(next.id,orig.id);
  assert.equal(next.title,orig.title);
  assert.equal(next.backdropImageUrl,orig.backdropImageUrl);
  assert.deepEqual(sourceIds(next),sourceIds(orig),'Never delete or duplicate a 2018+ period');
  assert(next.folders.length>orig.folders.length,'Must visibly expose historical years');
  assert(next.folders.every(f=>f.sources.length>0&&f.sources.length<=17),'At most 17 eager sources per folder');
  const ids=new Set(next.folders.flatMap(f=>f.sources.map(x=>x.catalogId)));
  assert.equal(ids.size,sourceIds(next).length,'No duplicated period');
  for(const f of next.folders){
   const g=orig.folders.find(x=>f.id===x.id||f.id.startsWith(x.id+'-year-')||
    f.id.startsWith(x.id+'-heritage-'));
   assert(g,'Unknown genre in year shelves '+f.id);
   assert.equal(f.coverImageUrl,g.coverImageUrl,'Approved genre cover is untouched');
   assert.equal(f.heroBackdropUrl,g.heroBackdropUrl,'Approved backdrop is untouched');
   assert.deepEqual(f.catalogSources.map(x=>x.catalogId),f.sources.map(x=>x.catalogId));
   assert.equal(f.tileShape,'LANDSCAPE');
  }
  const actionCurrent=next.folders.find(f=>f.id==='movies-world-'+orig.id.split('-').at(-1)+'-28');
  assert(actionCurrent,'Original genre id must remain first-class');
  assert(actionCurrent.sources.some(x=>x.catalogId.endsWith('-today')));
  assert(actionCurrent.sources.some(x=>x.catalogId.endsWith('-2026-11')));
  const older=next.folders.find(f=>f.title==='Action · 2025');
  assert(older,'2025 visible as a named Action year, not hidden by a generic archives folder');
  assert(older.sources.some(x=>x.catalogId.endsWith('-2025-12')));
  assert(older.sources.some(x=>x.catalogId.endsWith('-2025-01')));
  assert(next.folders.some(f=>f.title==='Action · 2018'));
  assert(older.hideTitle===false,'Archive year label must be visible');
 }
});

test('Western complete old history and future 2030 month rollover stay visible',()=>{
 const date=new Date('2030-12-31T15:00:00.000Z'),items=byYear(date);
 for(const c of items){
  const ids=sourceIds(c);
  assert(ids.some(x=>x.endsWith('-2030-12')));
  assert(ids.some(x=>x.endsWith('-2018-01')));
  assert(ids.some(x=>x.endsWith('-2015-01')));
  assert(ids.some(x=>x.endsWith('-before1900')));
  assert(ids.some(x=>x.endsWith('-undated')));
  assert(ids.some(x=>x.endsWith('-1900')));
  assert(c.folders.some(f=>f.title==='Western · Archives historiques'));
  assert(c.folders.some(f=>f.title.startsWith('Western · 2014–')));
 }
});

test('year-by-year import is additional and retains full and fast existing routes, with same collection-only addon IDs',async()=>{
 const [full,fast,year,desktop,install,manifest]=await Promise.all([
  get('/movies/nuvio-collections.json'),
  get('/movies/nuvio-collections-fast.json'),
  get('/movies/nuvio-collections-year-by-year.json'),
  get('/movies/nuvio-collections-year-by-year-desktop.json'),
  get('/install.json'),
  get('/movies/collections-only/manifest.json')
 ]);
 for(const response of [full,fast,year,desktop,install,manifest])assert.equal(response.status,200);
 const f=JSON.parse(full.body),y=JSON.parse(year.body),d=JSON.parse(desktop.body);
 assert.deepEqual(y.map(c=>c.id),f.map(c=>c.id));
 assert.deepEqual(y.map(c=>sourceIds(c)),f.map(c=>sourceIds(c)));
 assert.deepEqual(y.map(c=>sourceIds(c)),d.map(c=>sourceIds(c)));
 assert(y.every(c=>c.folders.every(folder=>folder.sources.length<=17)));
 assert(JSON.parse(fast.body)[0].folders.length>f[0].folders.length);
 const manifestObj=JSON.parse(manifest.body);
 for(const source of y[0].folders.flatMap(x=>x.sources)){
  assert(manifestObj.catalogs.some(m=>m.type===source.type&&m.id===source.catalogId),
   source.catalogId+' missing in original collection-only manifest');
 }
 assert(manifestObj.catalogs.every(x=>x.showInHome===false));
 const links=JSON.parse(install.body);
 assert.equal(links.moviesYearByYearCollections,'https://nuvio.test/movies/nuvio-collections-year-by-year.json');
 assert.equal(links.moviesYearByYearDesktopCollections,
  'https://nuvio.test/movies/nuvio-collections-year-by-year-desktop.json');
});
