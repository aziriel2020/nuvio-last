#!/usr/bin/env node
// Bounded low-priority Films Monde prewarming on Oracle localhost.
// This requests EXISTING original catalog IDs and EXISTING approved image
// URLs; never touches collections, images, movie dates, layouts, apps or APKs.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const LOCAL = 'http://127.0.0.1:3000';
const DEFAULT_ORIGIN = 'https://141-145-215-202.nip.io';
const MAX_JPEGS = 96;
const TIME_BUDGET_MS = 165000;
const CONCURRENCY = 2;
const ZONE = 'Europe/Brussels';

function month(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(now).slice(0, 7);
}

export function catalogIds(now = new Date(), iteration = 0) {
  const m = month(now);
  // One safe next-month page when it exists, otherwise these stay empty.
  const genres = ['all', '28', '12', '35', '80', '99', '18', '10751',
    '14', '36', '27', '10402', '9648', '10749', '878', '10770', '53', '10752', '37', 'standup'];
  const selected = genres.filter((_, i) => (i % 5) === ((iteration % 5 + 5) % 5));
  const primary = ['all', 'streaming', 'vod', 'cinema'].flatMap(v =>
    ['today','yesterday',m].map(p => 'movies-fr-'+v+'-all-'+p));
  const rotated = selected.flatMap(g => ['all','streaming','vod','cinema'].map(v =>
    'movies-fr-'+v+'-'+g+'-'+m));
  return [...new Set([...primary,...rotated])];
}

export function sameArtworkUrl(value, approvedOrigin = DEFAULT_ORIGIN) {
  try {
    const u = new URL(String(value));
    if (u.origin !== new URL(approvedOrigin).origin ||
        u.pathname !== '/fr/calendar-card.jpg' ||
        u.searchParams.get('world') !== '1' ||
        u.searchParams.get('type') !== 'movie' ||
        u.searchParams.get('layout') !== 'landscape') return null;
    return LOCAL + u.pathname + u.search;
  } catch { return null; }
}

async function fetchJson(url, signalMs = 10000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(signalMs),
    headers: {accept:'application/json'} });
  if (!r.ok || r.headers.get('x-nuvio-origin') !== 'oracle-vm')
    throw new Error('Oracle-only HTTP ' + r.status);
  return r.json();
}

export async function run({now=new Date(),iteration=Math.floor(Date.now()/1800000)}={}) {
  const health = await fetchJson(LOCAL + '/_oracle/health');
  if (!health.ok || health.runtime !== 'oracle-vm') throw Error('Oracle unhealthy');
  const publicOrigin = new URL(health.publicOrigin || DEFAULT_ORIGIN).origin;
  if (publicOrigin !== DEFAULT_ORIGIN) throw Error('Unknown public origin');
  const deadline = Date.now() + TIME_BUDGET_MS;
  const art = new Set(), failures = [],catalogTimes = [];
  for (const id of catalogIds(now,iteration)) {
    if (Date.now() >= deadline || art.size >= MAX_JPEGS) break;
    const start=performance.now();
    try {
      const json = await fetchJson(LOCAL + '/movies/catalog/movie/' + id + '.json',9000);
      catalogTimes.push(Math.round(performance.now()-start));
      for(const m of (json.metas || []).slice(0,6)) {
        const url = sameArtworkUrl(m.poster,publicOrigin);
        if(url) art.add(url);
        if(art.size>=MAX_JPEGS)break;
      }
    }catch(error){failures.push({id,error:String(error.message||error)});}
  }
  const urls = [...art].slice(0,MAX_JPEGS);
  let cursor=0;
  const cards=[];
  await Promise.all(Array.from({length:CONCURRENCY},async()=>{
    while(cursor<urls.length && Date.now()<deadline) {
      const url=urls[cursor++],started=performance.now();
      try {
        const result=await fetch(url,{signal:AbortSignal.timeout(15000)});
        if(!result.ok||!/^image\/jpeg\b/.test(result.headers.get('content-type')||'')){
          await result.body?.cancel();
          throw Error('JPEG HTTP '+result.status);
        }
        // Consume full image to allow completion of Oracle cache writes.
        const bytes=(await result.arrayBuffer()).byteLength;
        if(bytes<1000||bytes>1400000)throw Error('Invalid JPEG bytes '+bytes);
        cards.push({ms:Math.round(performance.now()-started),
          hit:result.headers.get('x-nuvio-cache')==='HIT'});
      } catch(error){failures.push({image:'approved-FR-card',error:String(error.message||error)});}
    }
  }));
  const times=cards.map(x=>x.ms).sort((a,b)=>a-b);
  const median=xs=>xs.length?xs[Math.floor(xs.length/2)]:0;
  const result={
    event:'oracle-films-monde-warm',at:new Date().toISOString(),
    release:health.gitSha,scope:'movies-only',permanentDesignChange:false,
    posterCandidates:urls.length,finished:cards.length,
    hits:cards.filter(x=>x.hit).length,
    medianMs:median(times),p95Ms:times[Math.floor(times.length*.95)]||0,
    medianCatalogMs:median(catalogTimes.sort((a,b)=>a-b)),
    failures:failures.slice(0,10)
  };
  console.log(JSON.stringify(result));
  // Missing upstream photos never block boot, upgrades, or catalog indexing.
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch(e=>{console.error('Oracle artwork warm failed:',e.message);process.exitCode=1;});
}
