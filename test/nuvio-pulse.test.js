'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/index');
const {windowFor,parseCatalog:seriesCatalog}=require('../regions/series/src/model.cjs');
const {parseCatalog:movieCatalog}=require('../regions/movies/src/model.cjs');
const {PULSE_PERIODS}=require('../runtime/pulse-periods.cjs');
const {MAX_FOLDER_SOURCES}=require('../runtime/nuvio-pulse.cjs');

function get(path){
 return new Promise((resolve,reject)=>{
  const req={method:'GET',url:path,headers:{host:'nuvio.test','x-forwarded-proto':'https','x-nuvio-timezone':'Europe/Brussels'}};
  const result={status:200,headers:{},body:''};
  const res={get statusCode(){return result.status;},set statusCode(v){result.status=v;},
    setHeader(k,v){result.headers[k.toLowerCase()]=v;},end(b=''){result.body=String(b);resolve(result);}};
  Promise.resolve(handler(req,res)).catch(reject);
 });
}

test('Nuvio Pulse builds 4 independent premium collections, 1 import and <=4 sources per folder',async()=>{
 const response=await get('/nuvio-collections-pulse.json');
 assert.equal(response.status,200,response.body.slice(0,200));
 const collections=JSON.parse(response.body);
 assert.deepEqual(collections.map(c=>c.id),['nuvio-pulse-france','nuvio-pulse-movies',
   'nuvio-pulse-series-v2','nuvio-pulse-global']);
 assert.deepEqual(collections.map(c=>c.folders.length),[4,4,2,3]);
 for(const c of collections){
   assert(c.backdropImageUrl?.startsWith('https://nuvio.test/'),c.id+' cinematic hero');
   assert.equal(c.viewMode,'FOLLOW_LAYOUT');
   assert.equal(c.showAllTab,false);
   for(const f of c.folders){
     assert(f.coverImageUrl?.startsWith('https://nuvio.test/'),f.id+' cover');
     assert(f.heroBackdropUrl?.startsWith('https://nuvio.test/'),f.id+' backdrop');
     assert.match(f.titleLogoUrl||'',/\/collection-title\.svg\?/,f.id+' custom hero text');
     assert(f.sources.length>0&&f.sources.length<=MAX_FOLDER_SOURCES,f.id+' bounded sources');
     assert.equal(f.catalogSources.length,f.sources.length);
     const unique=new Set(f.sources.map(s=>s.addonId+':'+s.type+':'+s.catalogId));
     assert.equal(unique.size,f.sources.length);
     assert(f.sources.every(s=>!/\.?(?:us|tr)\b|archives-v3|archives-tr-v1/.test(s.catalogId)),
       'US and Türkiye catalog names are explicitly out of scope');
   }
 }
 assert.equal(response.headers['cache-control'],'public, max-age=300, s-maxage=300');
});

test('every Pulse catalog exists in the installed hidden Shield manifests, with no search eligibility',async()=>{
 const data=JSON.parse((await get('/nuvio-collections-pulse.json')).body);
 const manifestById=new Map();
 for(const region of ['fr','movies','series-v2','global']){
   const response=await get('/'+region+'/collections-only/manifest.json');
   assert.equal(response.status,200,region);
   const manifest=JSON.parse(response.body);
   manifestById.set(manifest.id,manifest);
 }
 for(const c of data)for(const f of c.folders)for(const source of f.sources){
   const manifest=manifestById.get(source.addonId);
   assert(manifest,'unknown addon '+source.addonId);
   const registered=manifest.catalogs.find(x=>x.id===source.catalogId && x.type===source.type);
   assert(registered,'unregistered '+source.catalogId);
   assert(registered.extra.some(e=>e.name==='search' && e.isRequired));
   assert(registered.extra.some(e=>e.name==='genre' && e.isRequired));
   assert.equal(registered.showInHome,false);
 }
});
test('7 and 30 days roll daily without ever referring to a fixed month or violating Brussels local days',()=>{
 const sunday=new Date('2026-11-01T12:00:00Z');
 assert.deepEqual(windowFor('last7',sunday),{start:'2026-10-26',end:'2026-11-01'});
 assert.deepEqual(windowFor('last30',sunday),{start:'2026-10-03',end:'2026-11-01'});
 assert.deepEqual(windowFor('next7',sunday),{start:'2026-11-02',end:'2026-11-08'});
 const yearEnd=new Date('2026-12-31T12:00:00Z');
 assert.deepEqual(windowFor('next7',yearEnd),{start:'2027-01-01',end:'2027-01-07'});
 const tomorrow=new Date('2026-11-02T12:00:00Z');
 assert.deepEqual(windowFor('last7',tomorrow),{start:'2026-10-27',end:'2026-11-02'});
 assert.deepEqual(PULSE_PERIODS.map(p=>p.key),['last7','last30','next7']);
 for(const period of PULSE_PERIODS){
   assert.deepEqual(movieCatalog('movies-fr-streaming-all-'+period.key),
     {view:'streaming',genre:'all',period:period.key});
   assert.deepEqual(seriesCatalog('series-fr-premieres-all-'+period.key),
     {mode:'premieres',genre:'all',period:period.key});
 }
});
test('Pulse is opt-in: original four movie parents and two V2 series parents, collection IDs and artworks stay unchanged',async()=>{
 const index=JSON.parse((await get('/install.json')).body);
 assert.equal(index.pulseCollections,'https://nuvio.test/nuvio-collections-pulse.json');
 const [regularMovies,regularSeries]=await Promise.all([
   get('/movies/nuvio-collections-fast.json'),get('/series-v2/nuvio-collections.json')]);
 const movies=JSON.parse(regularMovies.body);
 const series=JSON.parse(regularSeries.body);
 assert.deepEqual(movies.map(c=>c.id),['movies-world-all','movies-world-streaming','movies-world-vod','movies-world-cinema']);
 assert.deepEqual(series.map(c=>c.id),['series-world-premieres','series-world-seasons']);
 assert(movies.every(c=>c.folders.some(f=>f.id.startsWith('movies-world-'))));
 assert(series.every(c=>c.folders.some(f=>f.id.startsWith('series-world-'))));
});
