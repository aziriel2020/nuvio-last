import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const port=41000+Math.floor(Math.random()*10000);
const base='http://127.0.0.1:'+port;
test('Nuvio login only, isolated clone route, CSRF protection',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('server-nuvio-login.mjs',import.meta.url))],{
    env:{...process.env,CLONER_PORT:String(port),NUVIO_SUPABASE_ANON_KEY:'public-test-anon'},
    stdio:'ignore'
  });
  try{
    let ready=false;
    for(let i=0;i<40;i++){
      try{ const r=await fetch(base+'/cloner/health');
        if(r.status===200){ready=true;break;}
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
  }finally {child.kill('SIGTERM');}
});
