#!/usr/bin/env node
const ORIGIN=String(process.env.PUBLIC_ORIGIN||'https://nuvio-last-aziriel2020-1343705637.pages.dev').replace(/\/$/,'');
const REGIONS=String(process.env.AUDIT_REGIONS||'fr,global,tr,us').split(',').map(s=>s.trim()).filter(Boolean);
const CONC=Math.max(1,Number(process.env.AUDIT_CONCURRENCY||8));
const TIMEOUT=Math.max(3000,Number(process.env.AUDIT_TIMEOUT_MS||18000));
const ATTEMPTS=Math.max(1,Number(process.env.AUDIT_ATTEMPTS||2));
const STRICT=!['0','false','no'].includes(String(process.env.AUDIT_STRICT||'1').toLowerCase());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function get(path,{accepted=[]}={}){
  let last;
  for(let i=1;i<=ATTEMPTS;i++){
    const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),TIMEOUT); const start=Date.now();
    try{
      const r=await fetch(ORIGIN+path,{redirect:'follow',signal:ac.signal,headers:{accept:'application/json,image/svg+xml;q=.9,*/*;q=.8','user-agent':'NuvioCatalogAudit/1.0'}});
      clearTimeout(t);
      if(r.ok||accepted.includes(r.status)) return {r,ms:Date.now()-start};
      last=new Error('HTTP '+r.status+': '+(await r.clone().text()).replace(/\s+/g,' ').slice(0,300));
    }catch(e){clearTimeout(t);last=e}
    if(i<ATTEMPTS) await sleep(Math.min(i*1000,2500));
  }
  throw last||new Error('request failed');
}
async function json(path){const {r,ms}=await get(path);return {j:await r.json(),r,ms}}
function collect(v,out){
  if(!v||typeof v!=='object')return;
  if(Array.isArray(v)){for(const x of v)collect(x,out);return}
  if((v.type==='movie'||v.type==='series')&&typeof v.catalogId==='string')out.set(v.type+':'+v.catalogId,{type:v.type,id:v.catalogId,collection:true});
  for(const x of Object.values(v))collect(x,out);
}
function family(id){return String(id).replace(/-(today|tomorrow|yesterday|lastweek|nextweek|past7|next7|week|month|lastmonth|nowplaying)$/i,'').replace(/-\d{4}-\d{2}$/,'')}
function urlOk(x){try{const u=new URL(String(x||''));return /^https?:$/.test(u.protocol)}catch{return false}}
function shape(m){
  const e=[]; if(!m||typeof m!=='object')return ['not object'];
  if(!m.id)e.push('id'); if(!['movie','series'].includes(m.type))e.push('type'); if(!m.name)e.push('name');
  if(!urlOk(m.poster))e.push('poster'); if(m.background&&!urlOk(m.background))e.push('background');
  if(m.landscapePoster&&!urlOk(m.landscapePoster))e.push('landscapePoster'); if(m.banner&&!urlOk(m.banner))e.push('banner');
  return e;
}
async function pool(items,n,fn){
  const out=new Array(items.length); let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length||1)},async()=>{for(;;){const k=i++;if(k>=items.length)return;out[k]=await fn(items[k])}}));
  return out;
}
const metaCache=new Map();
async function checkMeta(region,m){
  const key=region+':'+m.type+':'+m.id; if(metaCache.has(key))return metaCache.get(key);
  const p=(async()=>{const path='/'+region+'/meta/'+m.type+'/'+encodeURIComponent(m.id)+'.json';const {j,r}=await json(path);if(j?.meta?.id!==m.id)throw new Error('meta unresolved '+m.id);if(r.headers.get('x-nuvio-origin')!=='cloudflare-only')throw new Error('meta not cloudflare-only');return true})();
  metaCache.set(key,p); return p;
}
async function discover(region){
  const [mf,co]=await Promise.all([json('/'+region+'/manifest.json'),json('/'+region+'/nuvio-collections.json')]);
  if(!Array.isArray(mf.j?.catalogs))throw new Error(region+' manifest catalogs missing');
  const map=new Map();
  for(const c of mf.j.catalogs||[])if((c.type==='movie'||c.type==='series')&&c.id)map.set(c.type+':'+c.id,{region,type:c.type,id:c.id,name:c.name||'',manifest:true});
  const cm=new Map();collect(co.j,cm);for(const [k,c] of cm)map.set(k,{...(map.get(k)||{region,...c}),collection:true});
  console.log('[DISCOVER] '+region.toUpperCase()+' manifest='+mf.j.catalogs.length+' unique='+map.size);
  return [...map.values()];
}
async function audit(c){
  const path='/'+c.region+'/catalog/'+c.type+'/'+encodeURIComponent(c.id)+'.json'; const start=Date.now();
  try{
    const {j,r,ms}=await json(path); if(r.headers.get('x-nuvio-origin')!=='cloudflare-only')throw new Error('not cloudflare-only');
    if(!Array.isArray(j?.metas))throw new Error('metas missing');
    for(const m of j.metas.slice(0,3)){const e=shape(m);if(e.length)throw new Error('bad meta '+(m?.id||'?')+': '+e.join(','))}
    for(const m of j.metas.slice(0,2))await checkMeta(c.region,m);
    const status=j.metas.length?'OK':'EMPTY'; const src=r.headers.get('x-nuvio-anime-source')||'cloudflare';
    console.log('['+status+'] '+c.region.toUpperCase()+' | '+c.type+' | '+c.id+' | '+r.status+' | '+j.metas.length+' metas | '+ms+' ms | '+src);
    return {...c,path,status,count:j.metas.length,family:family(c.id)};
  }catch(e){console.error('[FAIL] '+c.region.toUpperCase()+' | '+c.type+' | '+c.id+' | '+(Date.now()-start)+' ms | '+(e.message||e));return {...c,path,status:'FAIL',count:0,error:String(e.message||e),family:family(c.id)}}
}
async function desktop(region,results){
  for(const x of results.filter(r=>r.region===region&&r.status==='OK').slice(0,40)){
    try{
      const {j}=await json(x.path); const m=(j.metas||[]).find(z=>String(z?.banner||'').includes('/desktop-content-card.jpg')); if(!m)continue;
      const u=new URL(m.banner); if(!/desktop11$/.test(u.searchParams.get('v')||''))throw new Error('cache is not desktop11'); if(u.searchParams.get('design')!=='shield3')throw new Error('missing shield3 cache key');
      for(const q of ['title','append','label'])if(!u.searchParams.get(q))throw new Error('missing '+q);
      const {r}=await get(u.pathname+u.search); if(r.headers.get('x-nuvio-card-renderer')!=='calendar-overlay-v2')throw new Error('legacy renderer contract changed');
      const svg=await r.text(); for(const token of ['data-renderer="shield-desktop-v3"','desktop-title','desktop-subtitle','desktop-provider'])if(!svg.includes(token))throw new Error('svg missing '+token);
      console.log('[DESKTOP OK] '+region.toUpperCase()+' | '+m.name); return null;
    }catch(e){return region+': '+(e.message||e)}
  }
  return region+': no desktop card found in sampled non-empty catalogs';
}
async function main(){
  console.log('Nuvio exhaustive catalog audit: '+ORIGIN);
  const catalogs=[];for(const r of REGIONS)catalogs.push(...await discover(r));
  const results=await pool(catalogs,CONC,audit);
  const fails=results.filter(r=>r.status==='FAIL'), empty=results.filter(r=>r.status==='EMPTY'), ok=results.filter(r=>r.status==='OK');
  const fam=new Map();for(const r of results){const k=r.region+':'+r.type+':'+r.family;if(!fam.has(k))fam.set(k,[]);fam.get(k).push(r)}
  const systemic=[];for(const [k,a] of fam){const t=a.filter(x=>x.status!=='FAIL');if(t.length>=6&&t.every(x=>x.count===0)){systemic.push(k);console.error('[SYSTEMIC EMPTY] '+k+' | '+t.length+' routes')}}
  const desk=[];for(const r of REGIONS){const e=await desktop(r,results);if(e){desk.push(e);console.error('[DESKTOP FAIL] '+e)}}
  console.log('\n=== AUDIT SUMMARY ===');
  console.log('TOTAL catalogues: '+results.length);console.log('Functional non-empty: '+ok.length);console.log('Empty: '+empty.length);console.log('Failures: '+fails.length);console.log('Systemically empty families: '+systemic.length);console.log('Desktop failures: '+desk.length);console.log('Unique meta routes checked: '+metaCache.size);
  for(const r of REGIONS){const a=results.filter(x=>x.region===r),b=a.filter(x=>x.status==='FAIL').length;console.log(r.toUpperCase()+': '+(a.length-b)+'/'+a.length+' HTTP/payload/meta OK | non-empty='+a.filter(x=>x.status==='OK').length+' | empty='+a.filter(x=>x.status==='EMPTY').length+' | fail='+b)}
  if(fails.length){console.error('\nFailures:');for(const f of fails.slice(0,100))console.error('- '+f.region+' '+f.type+' '+f.id+': '+f.error)}
  if(STRICT&&(fails.length||systemic.length||desk.length))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exit(1)});
