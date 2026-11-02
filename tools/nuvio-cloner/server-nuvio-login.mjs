import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMirrorProfileUpdate } from './profile-mirror-fields.mjs';
import { createHomeManagerApi } from './home-manager-api.mjs';

const PREFIX = '/cloner';
const PORT = Number(process.env.CLONER_PORT || '3001');
const ANON_KEY = process.env.NUVIO_SUPABASE_ANON_KEY || '';
const DEPLOY_REVISION = process.env.CLONER_REVISION || 'unknown';
const API = 'https://api.nuvio.tv';
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const MANAGER_PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home-manager.html');
if (!ANON_KEY) throw new Error('Missing NUVIO_SUPABASE_ANON_KEY');
function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"
  });
  res.end(JSON.stringify(body));
}
function appError(message, status=400) { const e = new Error(message); e.status=status; return e; }
async function bodyJson(req,maxBytes=128*1024) {
  let size=0, parts=[];
  for await (const part of req) {
    size+=part.length;
    if (size>maxBytes) throw appError('Requête trop volumineuse',413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw appError('JSON invalide'); }
}
function validAccount(a) {
  if (!a || typeof a.email!=='string' || !/^[^@\s]+@[^@\s]+$/.test(a.email) ||
      typeof a.password!=='string' || !a.password || a.password.length>512) throw appError('Identifiants Nuvio invalides');
}
function validPid(pid) {
  if (!Number.isInteger(pid) || pid<1 || pid>100) throw appError('Profil invalide');
}
async function api(pathname, method='POST', token, body) {
  const res=await fetch(API+pathname,{
    method, signal: AbortSignal.timeout(25000),
    headers:{apikey:ANON_KEY, 'Content-Type':'application/json', ...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const txt=await res.text();
  let data; try { data=txt?JSON.parse(txt):null; } catch { data=null; }
  if (!res.ok) throw appError(res.status===401?'Authentification Nuvio refusée':'Erreur API Nuvio ('+res.status+')',502);
  return data;
}
async function login(account) {
  validAccount(account);
  const session=await api('/auth/v1/token?grant_type=password','POST',null,{email:account.email,password:account.password});
  if (!session?.access_token) throw appError('Connexion Nuvio impossible',401);
  return session.access_token;
}
async function profiles(token) {
  const result=await api('/rest/v1/rpc/sync_pull_profiles','POST',token,{});
  if (!Array.isArray(result)) throw appError('Profils Nuvio indisponibles',502);
  return result.map(p=>({id:p.profile_index,name:p.name})).filter(p=>Number.isInteger(p.id));
}
function accountId(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')).sub; }
  catch { throw appError('Identité Nuvio non vérifiable',401); }
}
async function checkedProfile(token,pid) {
  validPid(pid);
  if (!(await profiles(token)).some(p=>p.id===pid)) throw appError('Le profil '+pid+' ne fait pas partie de ce compte Nuvio',400);
}
async function rpc(token,name,payload) {
  return api('/rest/v1/rpc/'+name,'POST',token,payload);
}
async function pullTable(token,table,pid) {
  const all=[];
  for(let start=0;start<100000;start+=500) {
    const tail='?select=*&profile_id=eq.'+pid+'&order=sort_order&limit=500&offset='+start;
    const chunk=await api('/rest/v1/'+table+tail,'GET',token);
    if (!Array.isArray(chunk)) throw appError(table+' renvoie une réponse invalide',502);
    all.push(...chunk);
    if(chunk.length<500) return all;
  }
  throw appError('Pagination '+table+' interrompue par sécurité',502);
}
async function pullPaged(token,name,pid,makeArgs) {
  const all=[];
  for(let page=0;page<200;page++) {
    const chunk=await rpc(token,name,makeArgs(page));
    if (!Array.isArray(chunk)) throw appError('Pagination '+name+' invalide',502);
    all.push(...chunk);
    if(chunk.length<500) return all;
  }
  throw appError('Trop de résultats pour '+name,502);
}
async function readCategories(token,pid,options) {
  const d={};
  const profilesRaw=await rpc(token,'sync_pull_profiles',{});
  const sourceProfile=profilesRaw?.find(p=>p.profile_index===pid);
  if(!sourceProfile) throw appError('Profil source introuvable',404);
  if(options.profile) {
    // Never copy the source name or avatar: each destination keeps its identity.
    // Only appearance background and independent addon/plugin configuration mirror.
    d.profile=createMirrorProfileUpdate(sourceProfile);
  }
  const addonsPid=sourceProfile.uses_primary_addons?1:pid;
  const pluginsPid=sourceProfile.uses_primary_plugins?1:pid;
  if(options.addons) d.addons=(await pullTable(token,'addons',addonsPid)).map((v,i)=>
    ({url:v.url,name:v.name,enabled:v.enabled,sort_order:i}));
  if(options.plugins) d.plugins=(await pullTable(token,'plugins',pluginsPid)).map((v,i)=>
    ({url:v.url,name:v.name,enabled:v.enabled,sort_order:i,repo_type:v.repo_type}));
  if(options.collections) {
    const r=await rpc(token,'sync_pull_collections',{p_profile_id:pid});
    const raw=r?.[0]?.collections_json;
    d.collections=typeof raw==='string'?JSON.parse(raw):raw;
    if(d.collections == null) d.collections=[];
    if(!Array.isArray(d.collections)) throw appError('Collections source invalides',502);
  }
  if(options.home) {
    const rows=await rpc(token,'sync_pull_home_catalog_settings',{p_profile_id:pid,p_platform:'home_catalog_shared'});
    const raw=rows?.[0]?.settings_json ?? null;
    if(raw == null) throw appError('Configuration Home source non synchronisée : impossible de garantir le miroir',409);
    d.home=typeof raw==='string'?JSON.parse(raw):raw;
  }
  if(options.library) d.library=await pullPaged(token,'sync_pull_library',pid,i=>({p_profile_id:pid,p_limit:500,p_offset:i*500}));
  if(options.watched) d.watched=await pullPaged(token,'sync_pull_watched_items',pid,i=>({p_profile_id:pid,p_page:i+1,p_page_size:500}));
  if(options.settings || options.posters) {
    d.settings={};
    for(const platform of ['tv','mobile']) {
      const r=await rpc(token,'sync_pull_profile_settings_blob',{p_profile_id:pid,p_platform:platform});
      const raw=r?.[0]?.settings_json || r?.[0]?.settingsJson || null;
      if(raw) d.settings[platform]=typeof raw==='string'?JSON.parse(raw):raw;
    }
  }
  return d;
}
function filteredSettings(source,target,postersOnly) {
  const incoming=source?.features || {};
  const previous=target?.features || {};
  if(postersOnly) {
    const keys=['custom_poster_url_pattern','custom_poster_enabled_screens'];
    const next=structuredClone(previous);
    if(incoming.layout_settings){
      next.layout_settings={...previous.layout_settings};
      for(const key of keys){
        if(Object.hasOwn(incoming.layout_settings,key))
          next.layout_settings[key]=incoming.layout_settings[key];
        else delete next.layout_settings[key];
      }
    }
    return {...(target||{}),features:next};
  }
  // Full replace: target-only layout/theme/player keys do not survive.
  // Only excluded resume-position settings may be carried forward.
  const next=structuredClone(incoming);
  const exempt=/^(?:continue_watching|watch_progress|resume_position|playback_position)(?:_|$)/i;
  for(const [feature,values] of Object.entries(previous)){
    if(!values || typeof values!=='object' || Array.isArray(values))continue;
    for(const [key,value] of Object.entries(values)){
      if(exempt.test(key)) {
        if(!next[feature] || typeof next[feature]!=='object')next[feature]={};
        next[feature][key]=value;
      }
    }
  }
  for(const [feature,values] of Object.entries(next)){
    if(!values || typeof values!=='object' || Array.isArray(values))continue;
    for(const key of Object.keys(values))
      if(exempt.test(key) && !Object.hasOwn(previous[feature]||{},key)) delete values[key];
  }
  return {...(source||{}),features:next};
}
async function apply(token,pid,data,options) {
  const done={};
  const run=async(enabled,key,name,payload)=>{
    if(!enabled) return;
    await rpc(token,name,payload);
    done[key]=Array.isArray(data[key])?data[key].length:'copié';
  };
  await run(options.addons,'addons','sync_push_addons',{p_profile_id:pid,p_addons:data.addons});
  await run(options.plugins,'plugins','sync_push_plugins',{p_profile_id:pid,p_plugins:data.plugins});
  await run(options.collections,'collections','sync_push_collections',{p_profile_id:pid,p_collections_json:data.collections});
  if(options.profile){
    // Defense-in-depth: allowlist the PATCH fields even if a source snapshot changes.
    await api('/rest/v1/profiles?profile_index=eq.'+pid,'PATCH',token,createMirrorProfileUpdate(data.profile));
    done.profile='copié';
  }
  if(options.home){
    await rpc(token,'sync_push_home_catalog_settings',{p_profile_id:pid,p_platform:'home_catalog_shared',p_settings_json:data.home});
    done.home='copié';
  }
  // sync_push_library is a full-snapshot RPC: it also removes target-only titles.
  await run(options.library,'library','sync_push_library',{p_profile_id:pid,p_items:data.library});
  if(options.watched){
    // sync_push_watched_items upserts, so target-only items must be deleted explicitly.
    // These RPCs operate on 'watched_items', NEVER on 'watch_progress'.
    const existing=await pullPaged(token,'sync_pull_watched_items',pid,i=>({p_profile_id:pid,p_page:i+1,p_page_size:500}));
    const key=x=>JSON.stringify([String(x.content_id),x.season??null,x.episode??null]);
    const desired=new Set(data.watched.map(key));
    const obsolete=existing.filter(x=>!desired.has(key(x)))
      .map(x=>({content_id:x.content_id,...(x.season==null?{}:{season:x.season}),
        ...(x.episode==null?{}:{episode:x.episode})}));
    for(let i=0;i<obsolete.length;i+=250){
      await rpc(token,'sync_delete_watched_items',{p_profile_id:pid,p_keys:obsolete.slice(i,i+250)});
    }
    for(let i=0;i<data.watched.length;i+=250){
      await rpc(token,'sync_push_watched_items',{p_profile_id:pid,p_items:data.watched.slice(i,i+250)});
    }
    done.watched=data.watched.length;
  }
  if(options.settings || options.posters) {
    for(const platform of ['tv','mobile']) {
      const src=data.settings?.[platform];
      if(!src) {done[platform]='source non synchronisée';continue;}
      const rows=await rpc(token,'sync_pull_profile_settings_blob',{p_profile_id:pid,p_platform:platform});
      const raw=rows?.[0]?.settings_json || rows?.[0]?.settingsJson || {};
      const dest=typeof raw==='string'?JSON.parse(raw):raw;
      const settingsJson=filteredSettings(src,dest,!options.settings);
      await rpc(token,'sync_push_profile_settings_blob',{p_profile_id:pid,p_platform:platform,p_settings_json:settingsJson});
      done[platform]='copié';
    }
  }
  return done;
}
const managerApi=createHomeManagerApi({login,checkedProfile,rpc,appError});
const loginAttempts = new Map();
let running=false;
async function route(req,res) {
  if(req.method==='GET' && (req.url===PREFIX || req.url===PREFIX+'/')) {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    return res.end(await readFile(PAGE));
  }
  if(req.method==='GET' && (req.url===PREFIX+'/manage' || req.url===PREFIX+'/manage/')) {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    return res.end(await readFile(MANAGER_PAGE));
  }
  if(req.method==='GET' && req.url===PREFIX+'/health') return json(res,200,{ok:true,app:'nuvio-mirror',revision:DEPLOY_REVISION});
  if(req.method!=='POST'|| !req.url?.startsWith(PREFIX+'/api/'))return json(res,404,{error:'Not found'});
  const origin=req.headers.origin;
  const host=req.headers['x-forwarded-host']||req.headers.host;
  if(!origin || new URL(origin).host!==host || req.headers['x-requested-with']!=='NuvioMirror')return json(res,403,{error:'Vérification de sécurité refusée'});
  if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{error:'JSON requis'});
  try {
    const ip=String(req.socket.remoteAddress || 'unknown');
    const now=Date.now();
    const prior=loginAttempts.get(ip)||{start:now,count:0};
    if(now-prior.start>600000){prior.start=now;prior.count=0;}
    prior.count+=1;loginAttempts.set(ip,prior);
    if(loginAttempts.size>5000) loginAttempts.clear();
    if(prior.count>60) throw appError('Trop de requêtes, réessayer plus tard',429);
    const payload=await bodyJson(req,req.url===PREFIX+'/api/manage/save'?2*1024*1024:128*1024);
    if(req.url===PREFIX+'/api/manage/load') return json(res,200,await managerApi.load(payload));
    if(req.url===PREFIX+'/api/manage/save') {
      if(running)throw appError('Une autre opération est en cours',409);
      running=true;
      try {return json(res,200,await managerApi.save(payload));}finally{running=false;}
    }
    if(req.url===PREFIX+'/api/profiles') {
      const token=await login(payload.account);
      return json(res,200,{profiles:await profiles(token)});
    }
    if(req.url===PREFIX+'/api/mirror') {
      if(running) return json(res,409,{error:'Clonage déjà en cours'});
      running=true;
      try {
        const source=payload.source, targets=payload.targets, opt=payload.options;
        validAccount(source);validPid(source.profileId);
        if(!Array.isArray(targets)||targets.length<1||targets.length>12)throw appError('Entre 1 et 12 destinations requises');
        const options={addons:!!opt?.addons,plugins:!!opt?.plugins,collections:!!opt?.collections,
          library:!!opt?.library,watched:!!opt?.watched,home:!!opt?.home,profile:!!opt?.profile,settings:!!opt?.settings,posters:!!opt?.posters};
        if(!Object.values(options).some(Boolean))throw appError('Aucune catégorie sélectionnée');
        const token=await login(source);
        await checkedProfile(token,source.profileId);
        const data=await readCategories(token,source.profileId,options);
        const results=[];
        for(const t of targets) {
          let title='Profil '+t.profileId;
          try {
            validPid(t.profileId);
            const targetAccount=t.sameAccount?source:t;
            const targetToken=t.sameAccount?token:await login(targetAccount);
            await checkedProfile(targetToken,t.profileId);
            if(accountId(targetToken)===accountId(token) && t.profileId===source.profileId)
              throw appError('La destination ne peut pas être le profil source');
            title=(t.sameAccount?'Même compte':String(t.email||'Autre compte'))+' · '+title;
            const changes=await apply(targetToken,t.profileId,data,options);
            results.push({target:title,ok:true,changes});
          } catch(err) {results.push({target:title,ok:false,error:String(err.message||err)});}
        }
        return json(res,200,{results,warning:'Continuer à regarder exclu. Les listes Nuvio peuvent fusionner selon les RPC; équivalence parfaite non garantie.'});
      } finally {running=false;}
    }
    return json(res,404,{error:'Not found'});
  } catch(err) {
    return json(res,err.status||502,{error:String(err.message||'Erreur')});
  }
}
http.createServer((req,res)=>{
  route(req,res).catch(()=>json(res,500,{error:'Erreur interne du cloneur'}));
}).listen(PORT,'127.0.0.1',()=>console.log('Nuvio Mirror bound to localhost:'+PORT));
