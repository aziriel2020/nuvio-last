#!/usr/bin/env node
// Continuously check every provenance-confirmed streaming premiere and
// sample every platform movie folder. The registry exposes actionable
// missing-card failures, not misleading "all films accounted for" claims.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { RECORDS } = require('../runtime/verified-streaming-premieres.cjs');
const { displayDateForPremiere } = require('../regions/movies/src/model.cjs');
const PREFIX = { FR:'archives-fr-v1', US:'archives-v3', TR:'archives-tr-v1', GLOBAL:'archives-global-v1' };
const REGION = { FR:'fr', US:'us', TR:'tr', GLOBAL:'global' };
const ORIGIN = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const DATE = process.env.NUVIO_CHECK_DATE || new Date().toISOString().slice(0,10);
const FULL_SCAN = process.env.AUDIT_ALL_PLATFORMS === '1';
const ZONES = { FR:'Europe/Paris', US:'America/New_York', TR:'Europe/Istanbul', GLOBAL:'UTC' };
const ANIME_JP_KR_SOURCE = /^archives-global-v1-(?:movie|series)-anime-asia-(?:today|yesterday)$/;
// The Anime Japon + Corée addon schedules ORIGINAL releases in Asia/Tokyo,
// not UTC. Other Global sources (such as VOD Mondiale) still use GLOBAL UTC.
function calendarTimeZone(market, source = null) {
  const id = typeof source === 'string' ? source : source?.id || source?.catalogId || '';
  return market === 'GLOBAL' && ANIME_JP_KR_SOURCE.test(id)
    ? 'Asia/Tokyo' : ZONES[market];
}
function localDay(market, clock = new Date(), source = null) {
  if (process.env.NUVIO_CHECK_DATE) return process.env.NUVIO_CHECK_DATE;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: calendarTimeZone(market, source), year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(clock);
  const get = k => parts.find(p => p.type === k)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function previousDay(date) {
  return new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
}

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
function allPlatformTodaySources(collections, region) {
  const prefix = PREFIX[region];
  if (!Array.isArray(collections)) throw Error('Collection import is not an array');
  const found = new Map();
  for (const collection of collections) {
    for (const folder of collection?.folders || []) {
      for (const source of folder?.sources || []) {
        if (!['movie','series'].includes(source.type) || typeof source.catalogId !== 'string') continue;
        if (!source.catalogId.startsWith(prefix+'-'+source.type+'-') || !source.catalogId.endsWith('-today')) continue;
        found.set(source.catalogId, { type:source.type, provider:collection.title, id:source.catalogId });
      }
    }
  }
  return [...found.values()];
}
function allMovieTodaySources(collections, region) {
  return allPlatformTodaySources(collections, region).filter(source => source.type === 'movie');
}
function allPlatformDaySources(collections, region) {
  return allPlatformTodaySources(collections, region).flatMap(source =>
    ['today','yesterday'].map(period => ({
      ...source, period, id: source.id.replace(/-today$/, '-'+period)
    })));
}
function releasedDayForMarket(released, market, source = null) {
  const value = String(released || '');
  // Pure civil dates have no time zone; genuine instants must be converted
  // to the viewer's market before comparing with Today/Yesterday folders.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const instant = new Date(value);
  if (!Number.isFinite(+instant)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: calendarTimeZone(market, source), year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(instant);
  const get = name => parts.find(part => part.type === name)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function invalidCalendarDates(metas, expectedDate, market='FR', source = null) {
  return (metas || []).filter(meta => releasedDayForMarket(meta?.released, market, source) !== expectedDate)
    .map(meta => ({ id: meta?.id, name: meta?.name, released: meta?.released || null }));
}

function duplicateCatalogCards(metas) {
  // Movies represent a title once. A series may legitimately publish several
  // different episodes under the same IMDb/TMDb series id, even on one day.
  const seen = new Set();
  const duplicates = [];
  for (const meta of metas || []) {
    if (!meta?.id || !['movie', 'series'].includes(meta.type)) continue;
    const episode = String(meta.episodeCode || '').trim()
      || (String(meta.releaseInfo || '').match(/S[0-9]{1,3}E[0-9]{1,4}/i)?.[0] || '');
    const event = episode || String(meta.releaseInfo || '').trim();
    const key = meta.type === 'series'
      ? ['series', meta.id, String(meta.released || '').slice(0, 10), event].join(':')
      : ['movie', meta.id].join(':');
    if (seen.has(key)) duplicates.push({ id: meta.id, episode: episode || null, released: meta.released || null });
    seen.add(key);
  }
  return duplicates;
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
async function verifyLivePremiere(p) {
  const current = localDay(p.market);
  if (p.platformDate > current) return;
  const yesterday = previousDay(current);
  for (const period of ['today','yesterday']) {
    const path = pathFor(p, period);
    const shouldExist = p.platformDate === (period === 'today' ? current : yesterday);
    try {
      const data = await getJson(path);
      if (!Array.isArray(data?.metas)) throw Error('metas[] missing');
      const found = matchPremiere(data.metas, p);
      if (Boolean(found) !== shouldExist) throw Error(
        `${p.title}: ${period} expected ${shouldExist ? 'present' : 'absent'}, found ${Boolean(found)}`);
      if (found && String(found.released || '').slice(0,10) !== p.platformDate)
        throw Error(`${p.title}: ${period} contains wrong platform date ${found.released}`);
      observations.push({status:'verified',market:p.market,provider:p.providerSlug,period,
        title:p.title,visible:shouldExist});
    } catch(error) { failures.push({status:'missing',market:p.market,period,title:p.title,error:error.message}); }
  }
}
async function verifyWorldPremiere(p) {
  if (p.market !== 'FR' || !p.worldPremiereDate || p.platformDate > localDay(p.market)) return;
  const displayDate = displayDateForPremiere(p);
  const current = localDay(p.market);
  const yesterday = previousDay(current);
  for (const view of ['all','streaming']) {
    const path = `/movies/catalog/movie/movies-fr-${view}-all-${displayDate.slice(0,7)}.json`;
    try {
      const data = await getJson(path);
      if (!Array.isArray(data?.metas)) throw Error('metas[] missing');
      const meta = data.metas.find(m => m.type === 'movie' &&
        (m.id === p.imdbId || m.id === `tmdb:movie:${p.tmdbId}`));
      if (!meta) throw Error(`MISSING ${p.title} in first page of Films Monde ${view}`);
      if (String(meta.released || '').slice(0,10) !== displayDate)
        throw Error(`WRONG DISPLAY DATE ${meta.released}, expected ${displayDate}`);
      if (meta.originalReleaseDate !== p.worldPremiereDate)
        throw Error(`WRONG ORIGINAL DATE ${meta.originalReleaseDate}, expected ${p.worldPremiereDate}`);
      observations.push({status:'verified',market:'WORLD',view,title:p.title,displayDate,originalDate:p.worldPremiereDate});
    } catch(error) { failures.push({status:'missing',market:'WORLD',view,title:p.title,error:error.message}); }
  }
  // Daily collections must roll over automatically; the archive remains.
  for (const period of ['today','yesterday']) {
    const expected = period === 'today' ? current : yesterday;
    const path = `/movies/catalog/movie/movies-fr-all-all-${period}.json`;
    try {
      const data = await getJson(path);
      if (!Array.isArray(data?.metas)) throw Error('metas[] missing');
      const found = data.metas.find(m => m.type === 'movie' &&
        (m.id === p.imdbId || m.id === `tmdb:movie:${p.tmdbId}`));
      if (Boolean(found) !== (displayDate === expected))
        throw Error(`${period} expected ${displayDate === expected ? 'present' : 'absent'}, got ${Boolean(found)}`);
      if (found && String(found.released || '').slice(0,10) !== displayDate)
        throw Error(`${period} wrong date ${found.released}`);
      observations.push({status:'verified',market:'WORLD',period,title:p.title,visible:Boolean(found)});
    } catch(error) { failures.push({status:'missing',market:'WORLD',period,title:p.title,error:error.message}); }
  }
  // The film must resolve when the user opens its detail card.
  const path = `/movies/meta/movie/${encodeURIComponent(p.imdbId || `tmdb:movie:${p.tmdbId}`)}.json`;
  try {
    const data = await getJson(path);
    if (String(data?.meta?.released || '').slice(0,10) !== displayDate)
      throw Error(`Display-release metadata missing or wrong: ${data?.meta?.released}`);
    if (data?.meta?.originalReleaseDate !== p.worldPremiereDate)
      throw Error(`Original-release provenance wrong: ${data?.meta?.originalReleaseDate}`);
    observations.push({status:'verified',market:'WORLD',view:'meta',title:p.title,displayDate,originalDate:p.worldPremiereDate});
  } catch(error) { failures.push({status:'missing',market:'WORLD',view:'meta',title:p.title,error:error.message}); }
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
  const sources=allPlatformDaySources(collections,region);
  if (!sources.length) { failures.push({market:region,error:'No active streaming platform folders discovered'});return; }
  try {
    const manifest=await getJson('/'+root+'/manifest.json');
    if (!Array.isArray(manifest.catalogs)) throw Error('No catalogs in manifest');
    const ids=new Set(manifest.catalogs.map(c=>c.type+':'+c.id));
    for (const source of sources) {
      if (!ids.has(source.type+':'+source.id))
        failures.push({market:region,catalog:source.id,error:'Platform catalog not declared in manifest'});
    }
  } catch(error) {
    failures.push({market:region,error:'Cannot validate active platform catalog links: '+error.message});
  }
  // Bound concurrency and rate to respect the upstream TMDb rate budget.
  for (let i=0;i<sources.length;i+=3) {
    const batch=sources.slice(i,i+3);
    await Promise.all(batch.map(async source=>{
      const path=`/${root}/catalog/${source.type}/${encodeURIComponent(source.id)}.json`;
      try{
        const data=await getJson(path);
        if (!Array.isArray(data?.metas)) throw Error('metas[] missing');
        const duplicates=duplicateCatalogCards(data.metas);
        if (duplicates.length) throw Error('Duplicate catalog cards: '+JSON.stringify(duplicates.slice(0, 5)));
        if (data.metas.some(m=>m.type!==source.type || !m.id || !m.name)) throw Error('Malformed catalog card');
        // Compare with the same calendar as the catalog itself: anime-asia
        // rolls at Tokyo midnight, not at UTC midnight like Global VOD.
        const sourceToday = localDay(region, new Date(), source);
        const expected = source.period === 'today' ? sourceToday : previousDay(sourceToday);
        const invalid = invalidCalendarDates(data.metas, expected, region, source);
        if (invalid.length) throw Error('Incorrect daily release dates: '+JSON.stringify(invalid.slice(0,5)));
        observations.push({status:'healthy',market:region,provider:source.provider,
          period:source.period,catalog:source.id,count:data.metas.length});
      }catch(error){failures.push({market:region,provider:source.provider,catalog:source.id,error:error.message});}
    }));
  }
}
export { pathFor, matchPremiere, allMovieTodaySources, allPlatformTodaySources, allPlatformDaySources, invalidCalendarDates, releasedDayForMarket, duplicateCatalogCards, localDay, previousDay, calendarTimeZone };
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (FULL_SCAN) for (const region of Object.keys(REGION)) await checkMovieFolders(region);
  for (const p of RECORDS) { await verifyRecord(p); await verifyLivePremiere(p); await verifyWorldPremiere(p); }
  console.log(JSON.stringify({date:DATE,origin:ORIGIN,fullScan:FULL_SCAN,
    checks:observations.length,failures,observations},null,2));
  if(failures.length) process.exitCode=1;
}
