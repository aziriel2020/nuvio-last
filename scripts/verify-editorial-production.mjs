import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const { manifest } = createRequire(import.meta.url)('../regions/fr/api/editorial-art.cjs');
const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const expectedSha = process.env.ARTWORK_EXPECTED_SHA;
const mapping = [
  ['editorial-series-top-rated','series-top-rated'],['editorial-series-trendy','series-trendy'],
  ['editorial-series-new','series-new'],['editorial-series-returning','series-returning'],
  ['editorial-movies-new','movies-new'],['editorial-binge-watch-series','binge-watch'],['editorial-cinema-now','cinema-now']
];
const urls = new Map();
async function request(url) {
  const r = await fetch(new URL(url,origin),{signal:AbortSignal.timeout(30000),cache:'no-store'});
  assert.equal(r.status,200,String(url));
  assert.equal(r.headers.get('x-nuvio-origin'),'oracle-vm',String(url));
  return r;
}
const result = {origin,revision:manifest.revision,folders:0,images:0,exactAssets:0};
try {
  const health = await (await request('/_oracle/health')).json();
  assert(health.ok);result.gitSha=health.gitSha;
  if(expectedSha)assert.equal(health.gitSha,expectedSha,'Exact deployed commit');
  for(const mode of ['shield','desktop']) {
    const all = await (await request('/nuvio-collections-'+mode+'.json')).json();
    const collection = all.find(c=>c.id==='calendar-archives-fr-editorial-now');
    assert(collection,mode+' collection');assert.equal(collection.folders.length,7,mode+' folders');
    assert.equal(new URL(collection.backdropImageUrl).searchParams.get('v'),manifest.revision,'Parent backdrop revision');
    for(const [id,key] of mapping) {
      const folder=collection.folders.find(f=>f.id===id);assert(folder,id);assert(folder.sources.length,id+' catalog sources');
      for(const [field,variant] of [['coverImageUrl','cover'],['heroBackdropUrl','backdrop']]) {
        const u=new URL(folder[field]);assert.equal(u.origin,origin);assert.equal(u.searchParams.get('v'),manifest.revision,id+' cache revision');
        const pathname=key==='binge-watch'?'/fr/binge-watch-'+variant+'.jpg':'/fr/editorial-'+variant+'.jpg';
        assert.equal(u.pathname,pathname,id+' route');
        if(key!=='binge-watch')assert.equal(u.searchParams.get('key'),key,id+' artwork key');
        urls.set(u.href,{key,variant,expected:manifest.images[key][variant]});
      }
      result.folders++;
    }
  }
  const entries=[...urls];let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{for(;;){const i=cursor++;if(i>=entries.length)return;
    const [url,{key,variant,expected}]=entries[i];const r=await request(url);const bytes=Buffer.from(await r.arrayBuffer());
    assert.match(r.headers.get('content-type'),/^image\/jpeg/);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,key+' '+variant+' approved bytes');
    const meta=await sharp(bytes).metadata();assert.equal(meta.width,expected.width);assert.equal(meta.height,expected.height);
    result.images++;result.exactAssets++;
  }}));
  assert.equal(result.images,14);console.log(JSON.stringify({...result,ok:true},null,2));
} catch(error) {console.error(JSON.stringify({...result,ok:false,error:error.message},null,2));process.exitCode=1;}
