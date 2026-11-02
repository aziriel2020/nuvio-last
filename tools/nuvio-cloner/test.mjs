import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Script } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createMirrorProfileUpdate } from './profile-mirror-fields.mjs';
import { fingerprint,validateHome,validateCollections,parseHome,parseCollections } from './home-manager-logic.mjs';
import { createHomeManagerApi } from './home-manager-api.mjs';

test('profile mirror preserves target name and avatar, copying only background and inheritance settings',()=>{
  const src={name:'Compte source',avatar_id:'src-avatar',avatar_url:'src-photo',avatar_color_hex:'#ff0000',profile_background_id:'source-background',profile_background_url:'source-bg-url',uses_primary_addons:true,uses_primary_plugins:true,unrelated:'not allowed'};
  const dst={name:'Profil cible',avatar_id:'dst-avatar',avatar_url:'dst-photo',avatar_color_hex:'#00ff00',profile_background_id:'old-bg',uses_primary_addons:true};
  const patch=createMirrorProfileUpdate(src);
  assert.deepEqual(patch,{profile_background_id:'source-background',profile_background_url:'source-bg-url',uses_primary_addons:false,uses_primary_plugins:false});
  const mirrored={...dst,...patch};
  assert.equal(mirrored.name,dst.name);
  assert.equal(mirrored.avatar_id,dst.avatar_id);
  assert.equal(mirrored.avatar_url,dst.avatar_url);
  assert.equal(mirrored.avatar_color_hex,dst.avatar_color_hex);
  assert.equal(mirrored.profile_background_id,src.profile_background_id);
  assert.deepEqual(createMirrorProfileUpdate({name:'source',avatar_url:'source-picture'}),{uses_primary_addons:false,uses_primary_plugins:false});
});


const row=(addon_id,catalog_id,order=0)=>({addon_id,type:'movie',catalog_id,enabled:true,
 order,custom_title:'',is_collection:false,collection_id:''});
const sampleHome={hide_unreleased_content:false,items:[row('myaddon','popular',0),row('myaddon','latest',1)],
  v4_unrelated_setting:'keep unchanged'};
const sampleCollections=[{id:'f1',title:'Films Monde',pinToTop:true,folders:[
  {id:'f2',title:'Catégorie',sources:[{provider:'addon',addonId:'myaddon',type:'movie',catalogId:'popular'}]}
]}];

test('Home editor validates catalogs without touching other keys and rejects fabricated rows',()=>{
  const updated=structuredClone(sampleHome);
  updated.items.reverse();updated.items[0].enabled=false;updated.items[0].custom_title='Films récents';
  const normalized=validateHome(updated,sampleHome,sampleCollections);
  assert.equal(normalized.v4_unrelated_setting,'keep unchanged');
  assert.deepEqual(normalized.items.map(i=>i.order),[0,1]);
  assert.equal(normalized.items[0].custom_title,'Films récents');
  assert.throws(()=>validateHome({...updated,items:[row('fakeaddon','bad')]},sampleHome,sampleCollections),
    /catalogue|Masque/);
  assert.deepEqual(parseHome([{settings_json:sampleHome}]),sampleHome);
  assert.deepEqual(parseCollections([{collections_json:sampleCollections}]),sampleCollections);
  assert.equal(fingerprint(sampleHome),fingerprint(structuredClone(sampleHome)));
});

test('Collections editor saves only target Home/collections and rejects stale concurrent edits',async()=>{
  let remoteHome=structuredClone(sampleHome),remoteCollections=structuredClone(sampleCollections);
  const called=[];
  const rpc=async (_token,name,body)=>{
    called.push(name);
    if(name==='sync_pull_home_catalog_settings')return [{settings_json:remoteHome}];
    if(name==='sync_pull_collections')return [{collections_json:remoteCollections}];
    if(name==='sync_push_home_catalog_settings'){remoteHome=structuredClone(body.p_settings_json);return null;}
    if(name==='sync_push_collections'){remoteCollections=structuredClone(body.p_collections_json);return null;}
    throw Error('Unexpected RPC '+name);
  };
  const appError=(msg,status)=>Object.assign(new Error(msg),{status});
  const manage=createHomeManagerApi({login:async()=> 'token',checkedProfile:async()=>{},rpc,appError});
  const auth={account:{email:'a@b.com',password:'x'},profileId:1};
  const initial=await manage.load(auth);
  const home=structuredClone(initial.home),collections=structuredClone(initial.collections);
  home.items[0].enabled=false;collections[0].title='Films et séries';
  const result=await manage.save({...auth,expected:initial.hashes,changes:{home:true,collections:true},home,collections});
  assert.deepEqual(result.saved,['collections','home']);
  assert.equal(remoteCollections[0].title,'Films et séries');
  assert.equal(remoteHome.items[0].enabled,false);
  assert.equal(remoteHome.v4_unrelated_setting,'keep unchanged');
  assert(!called.some(x=>/profile|watch|addon|plugin|library/i.test(x)));
  await assert.rejects(()=>manage.save({...auth,expected:initial.hashes,changes:{home:true},
    home,collections}),/changé sur un autre appareil/);
  assert.throws(()=>validateCollections([{id:'x',title:' ',folders:[]}]),/Titre/);
});

test('mobile and mouse sorting handlers compile, preserve existing save flow',async()=>{
  const html=await readFile(fileURLToPath(new URL('home-manager.html',import.meta.url)),'utf8');
  const script=html.split('<script>')[1]?.split('</script>')[0];
  assert(script,'missing Home Manager script');
  new Script(script,{filename:'home-manager-inline.js'});
  for(const term of ['touch-action:none','setPointerCapture','pointercancel',
    'pointermove','moveTo(list,old','reorderHandle(rows,r',
    'reorderHandle(state.collections,c','reorderHandle(collection.folders,folder,',
    'Enregistrer les modifications']) {
    assert((html+script).includes(term),'Missing expected drag feature: '+term);
  }
});

const port=41000+Math.floor(Math.random()*10000);
const base='http://127.0.0.1:'+port;
test('Nuvio login only, isolated clone route, CSRF protection',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('server-nuvio-login.mjs',import.meta.url))],{
    env:{...process.env,CLONER_PORT:String(port),NUVIO_SUPABASE_ANON_KEY:'public-test-anon',CLONER_REVISION:'test-profile-preserve'},
    stdio:'ignore'
  });
  try{
    let ready=false;
    for(let i=0;i<40;i++){
      try{ const r=await fetch(base+'/cloner/health');
        if(r.status===200 && (await r.json()).revision==='test-profile-preserve'){ready=true;break;}
      }catch{}
      await delay(125);
    }
    assert.equal(ready,true,'server should start with the public Nuvio key');
    const page=await fetch(base+'/cloner/');
    assert.equal(page.status,200,'no separate administrator login required');
    const html=await page.text();
    assert.match(html,/Même compte/);
    assert.match(html,/Continuer à regarder/);
    assert.match(html,/data-opt="home"/);
    assert.match(html,/data-opt="profile"/);
    const manager=await fetch(base+'/cloner/manage/');
    assert.equal(manager.status,200);
    const managerHtml=await manager.text();
    assert.match(managerHtml,/Gestionnaire de l’accueil/);
    assert.match(managerHtml,/Continuer à regarder/);
    const forbidden=await fetch(base+'/fr/manifest.json');
    assert.equal(forbidden.status,404,'cannot serve catalog paths');
    const attacker=await fetch(base+'/cloner/api/mirror',{method:'POST',headers:{
      'Content-Type':'application/json','X-Requested-With':'NuvioMirror',
      'Origin':'https://attacker.invalid','Host':'141-145-215-202.nip.io'
    },body:'{}'});
    assert.equal(attacker.status,403,'cross-site write denied');
    const noPassword=await fetch(base+'/cloner/api/mirror',{method:'POST',headers:{
      'Content-Type':'application/json','X-Requested-With':'NuvioMirror',
      'Origin':base,'Host':'127.0.0.1:'+port
    },body:JSON.stringify({source:{email:'',password:'',profileId:1},targets:[],options:{home:true}})});
    assert.equal(noPassword.status,400,'Nuvio login required before cloning');
    const badManager=await fetch(base+'/cloner/api/manage/load',{method:'POST',headers:{
      'Content-Type':'application/json','X-Requested-With':'NuvioMirror','Origin':base,
    },body:JSON.stringify({account:{email:'',password:''},profileId:1})});
    assert.equal(badManager.status,400,'Nuvio account login required before Home editing');
  }finally {child.kill('SIGTERM');}
});
