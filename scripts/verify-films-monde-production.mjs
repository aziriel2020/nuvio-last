#!/usr/bin/env node
// Strict *live* Movies World production gate, unlike synthetic SQLite tests.
import assert from 'node:assert/strict';

const ORIGIN = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
async function get(path) {
  const url = ORIGIN + path;
  let last;
  for(let n=0;n<3;n++){
    try {
      const response = await fetch(url,{signal:AbortSignal.timeout(40000),headers:{accept:'application/json'}});
      assert(response.ok,`${path} HTTP ${response.status}`);
      assert(response.headers.get('x-nuvio-origin')==='oracle-vm',`${path}: non-Oracle response`);
      const data = await response.json();
      return {data,response};
    } catch(error){last=error;if(n<2)await new Promise(r=>setTimeout(r,500*(n+1)));}
  }
  throw last;
}
function ids(collection) {return collection.folders.flatMap(f=>(f.sources||[]).map(s=>s.catalogId));}
const {data:status}=await get('/movies/status.json');
assert(status.ok===true,'Films Monde SQLite index unavailable');
assert(status.eligible>1000,`Too few indexed films: ${status.eligible}`);
assert(status.datePolicy==='first-release-worldwide','World premiere date policy changed');
const {data:regular}=await get('/movies/nuvio-collections.json');
const {data:fast}=await get('/movies/nuvio-collections-fast.json');
assert.equal(regular.length,4);
assert.equal(fast.length,4);
for(let i=0;i<regular.length;i++){
  assert.equal(regular[i].id,fast[i].id,'collection ID changed');
  assert.deepEqual(regular[i].folders.map(f=>f.id),
    fast[i].folders.slice(0,regular[i].folders.length).map(f=>f.id),
    'original genre IDs must lead fast collection');
  assert.deepEqual(ids(regular[i]).sort(),ids(fast[i]).sort(),
    'archival period lost or duplicated');
  assert(fast[i].folders.length>regular[i].folders.length,'fast archive groups missing');
  assert(fast[i].folders.every(f=>f.sources.length>0&&f.sources.length<=24),
    'a folder still loads more than 24 sources');
  for(let j=0;j<regular[i].folders.length;j++){
    assert.equal(regular[i].folders[j].coverImageUrl,fast[i].folders[j].coverImageUrl,
      'approved genre cover changed');
  }
}
const {data:manifest}=await get('/movies/native-bridge/manifest.json');
assert(manifest.id==='com.nuvio.movies.france.world.v1','addon identity changed');
for(const source of fast[0].folders[0].sources){
  assert(manifest.catalogs.some(c=>c.id===source.catalogId),'period missing in Bridge manifest');
}
const {data:raw}=await get('/movies/catalog/movie/movies-fr-all-all-all.json');
const {data:native}=await get('/movies/native-bridge/catalog/movie/movies-fr-all-all-all.json');
assert(raw.metas?.length>0,'original catalogue empty');
assert(native.metas?.length===raw.metas.length,'Bridge changed film count');
assert.deepEqual(native.metas.map(m=>[m.id,m.released,m.originalReleaseDate]),
  raw.metas.map(m=>[m.id,m.released,m.originalReleaseDate]),
  'Native Bridge changed film IDs or original dates');
const direct=native.metas.filter(m=>/^https:\/\/(?:image\.tmdb\.org|artworks\.thetvdb\.com)\//.test(m.poster||'')).length;
assert(direct>=Math.min(3,native.metas.length),'Native Bridge still sends Oracle posters instead of provider images');
const summary={ok:true,eligible:status.eligible,collections:regular.length,
  periodRefs:regular.reduce((s,c)=>s+ids(c).length,0),
  fastFolders:fast.map(c=>c.folders.length),
  maxSourcesPerFolder:Math.max(...fast.flatMap(c=>c.folders.map(f=>f.sources.length))),
  sampleMovies:native.metas.length,directPosters:direct,sha:process.env.GITHUB_SHA||null};
console.log('FILMS_MONDE_PRODUCTION_GATE='+JSON.stringify(summary));
