import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const port=41000+Math.floor(Math.random()*10000);
const base='http://127.0.0.1:'+port;
const username='integration-admin', password='a-long-test-password-123456789';
const auth='Basic '+Buffer.from(username+':'+password).toString('base64');
test('isolated protected mirror and no catalog route changes',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('server.mjs',import.meta.url))],{
  env:{...process.env,CLONER_PORT:String(port),CLONER_ADMIN_USER:username,
  CLONER_ADMIN_PASSWORD:password,NUVIO_SUPABASE_ANON_KEY:'public-test-anon'},stdio:'ignore'});
 try{
  let ready=false;
  for(let i=0;i<40;i++){
    try{let r=await fetch(base+'/cloner/health');if(r.status===401){ready=true;break;}}catch{}
    await delay(125);
  }
  assert.equal(ready,true);
  let r=await fetch(base+'/cloner/');assert.equal(r.status,401);
  assert.match(r.headers.get('www-authenticate')||'',/Basic/);
  r=await fetch(base+'/cloner/',{headers:{Authorization:auth}});
  assert.equal(r.status,200);
  const html=await r.text();
  assert.match(html,/Même compte/);assert.match(html,/Continuer à regarder/);
  r=await fetch(base+'/cloner/health',{headers:{Authorization:auth}});
  assert.equal(r.status,200);assert.equal((await r.json()).app,'nuvio-mirror');
  r=await fetch(base+'/fr/manifest.json',{headers:{Authorization:auth}});
  assert.equal(r.status,404);
  r=await fetch(base+'/cloner/api/mirror',{method:'POST',headers:{
   Authorization:auth,'Content-Type':'application/json',
   'X-Requested-With':'NuvioMirror',Origin:'https://attacker.invalid',
   Host:'141-145-215-202.nip.io'
  },body:'{}'});
  assert.equal(r.status,403);
 }finally{child.kill('SIGTERM');}
});
