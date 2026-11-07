#!/usr/bin/env node
// Read-only, bounded production sampling: NO cache invalidation, load tests or writes.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ORIGIN = process.env.NUVIO_BENCH_ORIGIN || 'https://141-145-215-202.nip.io';
const OUT = process.env.NUVIO_BENCH_OUTPUT || 'films-monde-oracle-benchmark.json';
const date = new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Brussels', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
const month = date.slice(0, 7);
const choices = ['all-all','streaming-all','all-28','vod-all'].map(x => 'movies-fr-'+x+'-'+month);
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const percentile = (a,p) => a.length ? [...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)] : null;
async function sample(path) {
  const start=performance.now(), record={path};
  try {
    const res=await fetch(ORIGIN+path, {signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}});
    record.ttfbMs=+(performance.now()-start).toFixed(2);
    const content=await res.text();
    record.totalMs=+(performance.now()-start).toFixed(2);
    record.status=res.status; record.bytes=Buffer.byteLength(content);
    record.disk=res.headers.get('x-nuvio-disk-cache');
    record.hot=res.headers.get('x-nuvio-hot-cache');
    record.catalog=res.headers.get('x-nuvio-catalog-cache');
    record.serverTiming=res.headers.get('server-timing');
    if(res.ok) {
      const json=JSON.parse(content);
      const metas=Array.isArray(json.metas)?json.metas:[];
      record.count=metas.length;
      record.posterHosts=metas.reduce((r,m)=>{try{const host=new URL(m.poster).hostname;r[host]=(r[host]||0)+1}catch{}return r},{});
      record.idsSha256=createHash('sha256').update(metas.map(m=>m.id).join('|')).digest('hex');
      record.posterUrlsSha256=createHash('sha256').update(metas.map(m=>m.poster).join('|')).digest('hex');
      record.firstPoster=metas[0]?.poster || null;
    }
  } catch(error) {record.error=String(error.message||error);record.totalMs=+(performance.now()-start).toFixed(2)}
  return record;
}
async function main(){
  const healthStart=performance.now();
  let health=null;
  try {const r=await fetch(ORIGIN+'/_oracle/health',{signal:AbortSignal.timeout(12000)});health=await r.json()}catch(e){health={error:String(e.message||e)}}
  const samples=[];
  for(const id of choices) {
    const path='/movies/catalog/movie/'+id+'.json';
    samples.push(await sample(path));
    samples.push(await sample(path));
  }
  // Bounded real-world fanout. NEVER stress the production Oracle.
  const fanoutIds=['all-all','all-28','all-35','streaming-all','vod-all','cinema-all','all-18','all-878'].map(x=>'movies-fr-'+x+'-'+month);
  for(let offset=0;offset<fanoutIds.length;offset+=2){
    const next=await Promise.all(fanoutIds.slice(offset,offset+2).map(id=>sample('/movies/catalog/movie/'+id+'.json')));
    samples.push(...next);
  }
  const successful=samples.filter(x=>x.status===200);
  const report={
    label:'READ-ONLY production samples; first pass is NOT a guaranteed cold cache',
    at:new Date().toISOString(), origin:ORIGIN, month, requests:samples.length,
    health:health&&{ok:health.ok,gitSha:health.gitSha,rssMb:health.memory?.rssMb,heapUsedMb:health.memory?.heapUsedMb,node:health.node,uptimeSeconds:health.uptimeSeconds},
    summary:{successes:successful.length,errors:samples.length-successful.length,
      p50TotalMs:percentile(successful.map(x=>x.totalMs),0.5),
      p95TotalMs:percentile(successful.map(x=>x.totalMs),0.95),
      meanTotalMs:+mean(successful.map(x=>x.totalMs)).toFixed(2),
      p50TtfbMs:percentile(successful.map(x=>x.ttfbMs),0.5),
      p95TtfbMs:percentile(successful.map(x=>x.ttfbMs),0.95),
      diskHits:successful.filter(x=>x.disk==='HIT').length,
      hotHits:successful.filter(x=>x.hot==='HIT').length,
      catalogHits:successful.filter(x=>x.catalog==='HIT').length
    },samples
  };
  writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({event:'films-monde-readonly-sampling',out:OUT,summary:report.summary,health:report.health,samples:samples.map(x=>({path:x.path,status:x.status,totalMs:x.totalMs,cache:x.catalog,sourceHosts:x.posterHosts}))}));
  if(samples.some(x=>x.status!==200))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
