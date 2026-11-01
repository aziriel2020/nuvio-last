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
const {data:yearByYear}=await get('/movies/nuvio-collections-year-by-year.json');
const {data:recentYears}=await get('/movies/nuvio-collections-recent-years.json');
assert.equal(regular.length,4);
assert.equal(fast.length,4);
assert.equal(yearByYear.length,4);
assert.equal(recentYears.length,4);
for(let i=0;i<regular.length;i++){
  assert.equal(regular[i].id,fast[i].id,'collection ID changed');
  assert.equal(yearByYear[i].id,regular[i].id,'Year-by-year IDs changed');
  assert.equal(recentYears[i].id,regular[i].id,'Unified collection ID changed');
  assert.deepEqual(recentYears[i].folders.map(f=>f.id),regular[i].folders.map(f=>f.id),
    'Unified import must NOT create extra year folders or change genre grid');
  const present = new Date();
  const parts = new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Brussels',year:'numeric',month:'2-digit'
  }).formatToParts(present);
  const y = Number(parts.find(p=>p.type==='year').value);
  const m = Number(parts.find(p=>p.type==='month').value);
  const currentMonth = `${y}-${String(m).padStart(2,'0')}`;
  const previousMonth = new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
  const recentOrder = ['nextweek','tomorrow','today','yesterday','lastweek',previousMonth];
  const catalogPeriod = id => {
    const match=String(id).match(/-(annual-\d{4}|\d{4}-\d{2}|\d{4}|today|tomorrow|yesterday|lastweek|nextweek|before1900|undated)$/);
    assert(match,'unknown calendar source '+id);
    return match[1];
  };
  for (let j=0;j<regular[i].folders.length;j++) {
    const original=regular[i].folders[j], unified=recentYears[i].folders[j];
    const sourcePeriods=unified.sources.map(s=>catalogPeriod(s.catalogId));
    assert.deepEqual(sourcePeriods.slice(0,6),recentOrder,
      'Unified folder must retain six recent periods and previous month');
    const annual=sourcePeriods.filter(p=>p.startsWith('annual-'));
    assert.deepEqual(annual,[...annual].sort().reverse(),'annual catalogs not descending');
    const originalMonths=original.sources.map(s=>catalogPeriod(s.catalogId))
      .filter(p=>/^\d{4}-\d{2}$/.test(p));
    const oldMonths=originalMonths.filter(p=>p!==previousMonth);
    const expectedYears=[...new Set(oldMonths.map(p=>p.slice(0,4)))].map(y=>'annual-'+y);
    assert.deepEqual(annual,expectedYears,
      'a year is missing or duplicated in the unified genre');
    const originalHeritage=original.sources.map(s=>catalogPeriod(s.catalogId)).filter(p=>
      /^\d{4}$/.test(p)||['before1900','undated'].includes(p));
    assert.deepEqual(sourcePeriods.filter(p=>/^\d{4}$/.test(p)||['before1900','undated'].includes(p)),
      originalHeritage,'Western historical years disappeared');
    assert.equal(unified.coverImageUrl,original.coverImageUrl,'Approved cover changed');
    assert.equal(unified.heroBackdropUrl,original.heroBackdropUrl,'Approved backdrop changed');
    assert.equal(unified.tileShape,original.tileShape,'Original genre card shape changed');
    assert.equal(unified.sources.length,6+annual.length+originalHeritage.length,
      'Unified source count unexpected');
  }

  assert.deepEqual(ids(yearByYear[i]).sort(),ids(regular[i]).sort(),
    'Year-by-year import dropped or duplicated a period');
  assert(yearByYear[i].folders.every(f => f.sources.length>0&&f.sources.length<=12),
    'More than 12 eager period requests in a year-by-year folder');
  for(const f of yearByYear[i].folders) {
    const sourceFolder=regular[i].folders.find(g=>f.id===g.id||
      f.id.startsWith(g.id+'-year-')||f.id.startsWith(g.id+'-heritage-'));
    assert(sourceFolder && f.coverImageUrl===sourceFolder.coverImageUrl&&
      f.heroBackdropUrl===sourceFolder.heroBackdropUrl,'Approved genre artwork changed: '+f.id);
  }
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
// Live regression: annual catalogs must not display only December despite
// containing a whole year's eligible movies. Test Nuvio's actual 24-item page.
const annualCoverage=[];
for(const year of [2025,2024]) {
  const start=Date.now();
  const path=`/movies/catalog/movie/movies-fr-all-all-annual-${year}`;
  const {data:first,response:firstResponse}=await get(path+'.json');
  const months=[...new Set((first.metas||[]).map(meta=>String(meta.released||'').slice(0,7)))];
  assert(['HIT','MISS'].includes(firstResponse.headers.get('x-nuvio-catalog-cache')),
    'Films Monde annual catalog missing Series Monde-style cache instrumentation');
  const {data:repeated,response:repeatResponse}=await get(path+'.json');
  assert.deepEqual(repeated.metas,first.metas,'cached annual page mutated between requests');
  // Oracle first checks its shared disk/hot cache, then the movies engine's
  // in-memory catalog cache. A disk hit legitimately replays the stored
  // X-Nuvio-Catalog-Cache: MISS header from the original response, because
  // the handler has not been executed for this second request.
  const engineHit=repeatResponse.headers.get('x-nuvio-catalog-cache')==='HIT';
  const diskHit=repeatResponse.headers.get('x-nuvio-disk-cache')==='HIT'
    || repeatResponse.headers.get('x-nuvio-hot-cache')==='HIT';
  assert(engineHit||diskHit,
    'annual page must hit either Oracle disk cache or Films Monde in-memory cache');
  assert(first.metas?.length>0,`Annual catalog ${year} is empty`);
  assert(months.length>=6,`Annual catalog ${year} shows only ${months.length} months on its initial page: ${months.join(', ')}`);
  const {data:second}=await get(path+'/skip=24.json');
  const all=[...first.metas,...(second.metas||[])];
  assert.equal(new Set(all.map(meta=>meta.id)).size,all.length,
    `Annual ${year} loses pagination uniqueness`);
  assert(all.every(meta=>String(meta.released||'').startsWith(String(year))),
    `Annual ${year} contains releases from other years`);
  annualCoverage.push({year,months:months.length,firstPage:first.metas.length,
    secondPage:second.metas?.length||0,cache:diskHit?'ORACLE-DISK-HIT':'MOVIES-MEMORY-HIT',ms:Date.now()-start});
}
const {data:manifest}=await get('/movies/native-bridge/manifest.json');
assert(manifest.id==='com.nuvio.movies.france.world.v1','addon identity changed');
for(const source of fast[0].folders[0].sources){
  assert(manifest.catalogs.some(c=>c.id===source.catalogId),'period missing in Bridge manifest');
}
const {data:raw}=await get('/movies/catalog/movie/movies-fr-all-all-all.json');
const {data:native}=await get('/movies/native-bridge/catalog/movie/movies-fr-all-all-all.json');
assert(raw.metas?.length>0,'original catalogue empty');
// Protect the approved Films Monde no-film-logo policy in production.
// An invisible Modern placeholder is permitted, an actual TMDB clearlogo is not.
for (const [name, catalog] of [['canonical',raw],['native bridge',native]]) {
  assert(catalog.metas.every(meta => !meta.logo ||
    /\/fr\/calendar-transparent-logo\.svg\?/.test(meta.logo)),
    name+' published visible film title logos');
}
assert(native.metas?.length===raw.metas.length,'Bridge changed film count');
assert.deepEqual(native.metas.map(m=>[m.id,m.released,m.originalReleaseDate]),
  raw.metas.map(m=>[m.id,m.released,m.originalReleaseDate]),
  'Native Bridge changed film IDs or original dates');
const direct=native.metas.filter(m=>/^https:\/\/(?:image\.tmdb\.org|artworks\.thetvdb\.com)\//.test(m.poster||'')).length;
assert(direct>=Math.min(3,native.metas.length),'Native Bridge still sends Oracle posters instead of provider images');
// The Design Plugin is a standalone Custom Posters URL, not an APK patch.
// Check the real image pipeline from an indexed movie in Oracle production.
const {data:designConfig}=await get('/design-plugin/config.json');
assert.equal(designConfig.requiresModifiedApk,false);
assert.equal(designConfig.posterPattern, ORIGIN+'/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}');
assert.equal(designConfig.originalBackup,ORIGIN+'/movies/nuvio-collections.json');
let designPosterLoaded=false;
for(const meta of raw.metas.slice(0,10)){
  const url=ORIGIN+'/design-plugin/poster.jpg?type=movie&shape=landscape&id='+encodeURIComponent(meta.id);
  const response=await fetch(url,{signal:AbortSignal.timeout(18000)});
  if(response.status!==200){await response.body?.cancel();continue;}
  assert.match(response.headers.get('content-type')||'',/^image\/jpeg/,
    'plugin must deliver genuine cinematic artwork');
  const bytes=Buffer.from(await response.arrayBuffer());
  assert(bytes.length>1000&&bytes[0]===255&&bytes[1]===216,
    'plugin must return JPEG bytes, not error HTML');
  designPosterLoaded=true;break;
}
assert(designPosterLoaded,'design plugin failed to resolve any indexed Films Monde movie');
const invalidPoster=await fetch(ORIGIN+'/design-plugin/poster.jpg?type=movie&id=invalid&shape=landscape');
assert.equal(invalidPoster.status,400,'invalid Custom Posters ID should fall back to native art');
await invalidPoster.body?.cancel();
const summary={ok:true,eligible:status.eligible,collections:regular.length,
  periodRefs:regular.reduce((s,c)=>s+ids(c).length,0),
  fastFolders:fast.map(c=>c.folders.length),
  yearByYearFolders:yearByYear.map(c=>c.folders.length),
  unifiedFolders:recentYears.map(c=>c.folders.length),
  recentYearsFolders:recentYears.map(c=>c.folders.length),
  maxUnifiedGenreSources:Math.max(...recentYears.flatMap(c=>c.folders.map(f=>f.sources.length))),
  maxYearByYearSourceLoad:Math.max(...yearByYear.flatMap(c=>c.folders.map(f=>f.sources.length))),
  maxSourcesPerFolder:Math.max(...fast.flatMap(c=>c.folders.map(f=>f.sources.length))),
  annualCoverage,designPluginPoster:designPosterLoaded,sampleMovies:native.metas.length,directPosters:direct,sha:process.env.GITHUB_SHA||null};
console.log('FILMS_MONDE_PRODUCTION_GATE='+JSON.stringify(summary));
