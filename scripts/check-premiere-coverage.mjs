#!/usr/bin/env node
// Continuously check every provenance-confirmed streaming premiere and
// sample every platform movie folder. The registry exposes actionable
// missing-card failures, not misleading "all films accounted for" claims.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { RECORDS } = require('../runtime/verified-streaming-premieres.cjs');
const PREFIX = { FR:'archives-fr-v1', US:'archives-v3', TR:'archives-tr-v1', GLOBAL:'archives-global-v1' };
const REGION = { FR:'fr', US:'us', TR:'tr', GLOBAL:'global' };
const ORIGIN = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const DATE = process.env.NUVIO_CHECK_DATE || new Date().toISOString().slice(0,10);
const FULL_SCAN = process.env.AUDIT_ALL_PLATFORMS === '1';
const failures = [], observations = [];
function pathFor(p, period = p.platformDate.slice(0,7)) {
  if (!PREFIX[p.market] || !REGION[p.market]) throw Error('Unknown streaming market');
  return `/${REGION[p.market]}/catalog/${p.type}/${PREFIX[p.market]}-${p.type}-${p.providerSlug}-${period}.json`;
}
function matchPremiere(metas, p) {
  return (metas || []).find(m =>
    m?.type === p.type &&
    (m.id === p.imdbId || m.id === `tmdb:movie:${p.tmdbId}` ||
      (m.name === p.title && String(m.released || '').slice(0,10) === p.platformDate))
  );
}
function allMovieTodaySources(collections, region) {
  const prefix = PREFIX[region];
  if (!Array.isArray(collections)) throw Error('Collection import is not an array');
  const found = new Map();
  for (const collection of collections) {
    for (const folder of collection?.folders || []) {
      for (const source of folder?.sources || []) {
        if (source.type !== 'movie' || typeof source.catalogId !== 'string') continue;
        if (!source.catalogId.startsWith(prefix+'-movie-') || !source.catalogId.endsWith('-today')) continue;
        found.set(source.catalogId, { type:'movie', provider:collection.title, id:source.catalogId });
      }
    }
  }
  return [...found.values()];
}
async function getJson(path, { retries = 2 } = {}) {
  let lastError;
  for (let i=0;i<retries;i++) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 35000);
    try {
      const response = await fetch(new URL(path, ORIGIN), {
        signal:controller.signal,
        headers:{ accept:'application/json', 'cache-control':'no-cache', 'user-agent':'NuvioReleaseCoverage/1.0' }
      });
      if (!response.ok) throw Error(`${path} HTTP ${response.status}`);
      if (response.headers.get('x-nuvio-origin') !== 'oracle-vm') throw Error(`${path} is not Oracle`);
      if (response.headers.get('x-nuvio-upstream-error') === '1') throw Error(`${path} upstream-error flag`);
      const result=await response.json();
      return result;
    } catch(err) { lastError=err; if(i===0) await new Promise(resolve=>setTimeout(resolve,1000)); }
    finally { clearTimeout(timer); }
  }
  throw lastError;
}
async function verifyRecord(p) {
  if (p.platformDate > DATE) return;
  const path = pathFor(p);
  try {
    const data = await getJson(path);
    if (!Array.isArray(data?.metas)) throw Error('metas[] missing');
    const m=matchPremiere(data.metas,p);
    if (!m) throw Error(`MISSING ${p.title} (${p.tmdbId}) from ${path}`);
    if (String(m.released || '').slice(0,10)!==p.platformDate) throw Error(`WRONG DATE ${p.title} ${m.released}`);
    observations.push({status:'verified',market:p.market,provider:p.providerSlug,title:p.title,date:p.platformDate});
  } catch(error) { failures.push({status:'missing',market:p.market,provider:p.providerSlug,title:p.title,date:p.platformDate,error:error.message}); }
}
async function checkMovieFolders(region) {
  const root = REGION[region];
  let collections;
  try { collections = await getJson('/'+root+'/nuvio-collections.json'); }
  catch(error) { failures.push({market:region,error:'collections unavailable: '+error.message});return; }
  const sources=allMovieTodaySources(collections,region);
  if (!sources.length) { failures.push({market:region,error:'No platform movie folders discovered'});return; }
  // Bound concurrency and rate to respect the upstream TMDb rate budget.
  for (let i=0;i<sources.length;i+=3) {
    const batch=sources.slice(i,i+3);
    await Promise.all(batch.map(async source=>{
      const path=`/${root}/catalog/movie/${encodeURIComponent(source.id)}.json`;
      try{
        const data=await getJson(path);
        if (!Array.isArray(data?.metas)) throw Error('metas[] missing');
        const ids=data.metas.map(m=>m.id);
        if (ids.length!==new Set(ids).size) throw Error('Duplicate movie cards');
        if (data.metas.some(m=>m.type!=='movie' || !m.id || !m.name)) throw Error('Malformed movie card');
        observations.push({status:'healthy',market:region,provider:source.provider,catalog:source.id,count:ids.length});
      }catch(error){failures.push({market:region,provider:source.provider,catalog:source.id,error:error.message});}
    }));
  }
}
export { pathFor, matchPremiere, allMovieTodaySources };
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (FULL_SCAN) for (const region of Object.keys(REGION)) await checkMovieFolders(region);
  for (const p of RECORDS) await verifyRecord(p);
  console.log(JSON.stringify({date:DATE,origin:ORIGIN,fullScan:FULL_SCAN,
    checks:observations.length,failures,observations},null,2));
  if(failures.length) process.exitCode=1;
}
