#!/usr/bin/env node
// Four-region-only quality gate. Never queries US / Türkiye.
// Read-only: no TMDB mutation, no data repair or new Oracle service.
import assert from 'node:assert/strict';
const ORIGIN=new URL(process.env.PUBLIC_ORIGIN||'https://141-145-215-202.nip.io').origin;
const REGIONS=['fr','movies','series-v2','global'];
const AGE_LIMITS={movies:3*3600000,'series-v2':2*3600000};

async function json(path){
  const signal=AbortSignal.timeout(25000);
  const response=await fetch(ORIGIN+path,{signal,headers:{accept:'application/json','cache-control':'no-cache'}});
  assert(response.ok,path+' HTTP '+response.status);
  return response.json();
}
const checkAge=(s,limit,label)=>{
 const at=Date.parse(s?.lastSync?.at||'');
 assert(Number.isFinite(at)&&Date.now()-at<limit,label+' index heartbeat missing or stale');
 assert(!s.lastSync?.errors?.length,label+' background sync reported errors: '+s.lastSync.errors?.join(' | '));
};
try{
 const [health,pulse,install,films,series,...manifests]=await Promise.all([
   json('/_oracle/health'),json('/nuvio-collections-pulse.json'),
   json('/install.json'),json('/movies/status.json'),json('/series-v2/status.json'),
   ...REGIONS.map(region=>json('/'+region+'/collections-only/manifest.json'))
 ]);
 assert(health.ok&&health.runtime==='oracle-vm','Oracle health is not OK');
 assert.equal(install.pulseCollections,ORIGIN+'/nuvio-collections-pulse.json');
 assert(films.ok&&films.eligible>0,'Films Monde index missing/empty');
 assert(series.ok&&series.eligible>0,'Series V2 index missing/empty');
 checkAge(films,AGE_LIMITS.movies,'Films Monde');
 checkAge(series,AGE_LIMITS['series-v2'],'Séries France V2');
 assert.deepEqual(pulse.map(c=>c.id),['nuvio-pulse-france','nuvio-pulse-movies','nuvio-pulse-series-v2','nuvio-pulse-global']);
 const byId=new Map(manifests.map(m=>[m.id,new Set(m.catalogs.map(c=>c.type+':'+c.id))]));
 let folders=0,sources=0;
 for(const collection of pulse)for(const folder of collection.folders){
   folders++;
   assert(folder.sources?.length>0 && folder.sources.length<=4,'Oversized/empty folder '+folder.id);
   assert(folder.coverImageUrl&&folder.heroBackdropUrl,'Missing premium artwork '+folder.id);
   for(const s of folder.sources){
     sources++;
     assert(byId.get(s.addonId)?.has(s.type+':'+s.catalogId),'Unregistered source '+s.catalogId);
     assert(!/archives-(?:tr|v3)-|(?:^|-)us(?:-|$)/.test(s.catalogId),'Unauthorized US/TR source');
   }
 }
 const result={ok:true,scope:REGIONS,parents:pulse.length,folders,sources,
   moviesEligible:films.eligible,seriesEligible:series.eligible,
   moviesLastSync:films.lastSync?.at,seriesLastSync:series.lastSync?.at,
   deployment:health.gitSha,at:new Date().toISOString()};
 console.log('NUVIO_PULSE_PRODUCTION_GATE='+JSON.stringify(result));
}catch(e){console.error('NUVIO_PULSE_PRODUCTION_GATE_FAIL',e?.stack||String(e));process.exitCode=1;}
