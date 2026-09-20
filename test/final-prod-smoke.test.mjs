import test from 'node:test';
import assert from 'node:assert/strict';

const BASE='https://141-145-215-202.nip.io';
const EXPECTED='0042e2cd2584e03b5dad0611a47062d7b99eb4f0';

async function j(path){
  const r=await fetch(BASE+path,{signal:AbortSignal.timeout(25000),headers:{'accept':'application/json','user-agent':'NuvioFinalProdCheck/1.0'}});
  const text=await r.text();
  console.log('PROBE',path,'HTTP',r.status,'BODY',text.slice(0,500));
  assert.equal(r.status,200,path+' HTTP');
  return JSON.parse(text);
}

test('live Oracle serves Cinema v8 and no clickable Cinema folder is empty', async()=>{
  const health=await j('/_oracle/health');
  console.log('HEALTH',health);
  assert.equal(health.gitSha,EXPECTED,'Oracle is not on merged Cinema v8 commit');

  const manifest=await j('/fr/manifest.json?probe=final-ci');
  assert(manifest.catalogs.some(c=>c.id==='cinema-torrentio-nowplaying'));

  const shield=await j('/nuvio-collections-shield.json?probe=final-ci');
  const cinema=shield.find(c=>c.id==='cinema-now-torrentio') || null;
  console.log('CINEMA_COLLECTION',JSON.stringify(cinema));

  if(!cinema){
    const np=await j('/fr/catalog/movie/cinema-torrentio-nowplaying.json?probe=final-ci');
    assert.equal(np.metas.length,0,'Cinema collection missing despite non-empty À l’affiche');
    return;
  }

  assert(cinema.folders.length>0,'Cinema collection exists with zero folders');
  for(const folder of cinema.folders){
    const src=folder.sources?.[0];
    assert(src?.catalogId,'Cinema folder missing catalogId');
    const cat=await j('/fr/catalog/movie/'+encodeURIComponent(src.catalogId)+'.json?probe=final-ci');
    console.log('FOLDER',folder.title,'METAS',cat.metas?.length);
    assert(Array.isArray(cat.metas) && cat.metas.length>0,'Empty clickable Cinema folder: '+folder.title);
  }
});

// sync trigger
