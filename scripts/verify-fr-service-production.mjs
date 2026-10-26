import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const { manifest } = createRequire(import.meta.url)('../regions/fr/api/service-art.cjs');
const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const expectedSha = process.env.ARTWORK_EXPECTED_SHA;
const result = {origin,revision:manifest.revision,imports:0,folders:0,images:0,exactAssets:0};
const urls = new Map();
async function request(url, status = 200) {
  const r = await fetch(new URL(url,origin),{signal:AbortSignal.timeout(30000),cache:'no-store'});
  assert.equal(r.status,status,String(url));
  assert.equal(r.headers.get('x-nuvio-origin'),'oracle-vm',String(url));
  return r;
}
try {
  assert.equal(manifest.approved,true);
  assert.equal(Object.keys(manifest.images).length,14);
  assert.deepEqual(manifest.pendingProviders,[]);
  assert.equal(manifest.images['disney-plus'].approved,true,'Disney+ proposal approved');
  const health = await (await request('/_oracle/health')).json();
  assert(health.ok);result.gitSha=health.gitSha;
  if(expectedSha)assert.equal(health.gitSha,expectedSha,'Exact deployed commit');
  for(const route of ['/nuvio-collections-shield.json','/nuvio-collections-desktop.json','/fr/nuvio-collections.json']) {
    const all = await (await request(route)).json();
    let folders=0;
    for(const [key,item] of Object.entries(manifest.images)) {
      const parent=all.find(c=>c.id==='calendar-archives-fr-'+key);assert(parent,route+' '+key);
      const categories=['series','films'].filter(v=>item[v]);
      assert.equal(parent.folders.length,categories.length,key+' folder count');
      const backdrop=new URL('/fr/service-backdrop.jpg',origin);
      backdrop.search=new URLSearchParams({key,v:manifest.revision});
      assert.equal(parent.backdropImageUrl,backdrop.href,key+' parent backdrop');
      urls.set(backdrop.href,{key,variant:'backdrop',expected:item.backdrop});
      for(const category of categories) {
        const folder=parent.folders.find(f=>f.id===`archives-fr-${key}-${category}`);assert(folder,key+' '+category);
        assert(folder.sources.length>0,key+' catalog sources');assert.equal(folder.tileShape,'LANDSCAPE');
        const cover=new URL('/fr/service-cover.jpg',origin);
        cover.search=new URLSearchParams({key,category,v:manifest.revision});
        assert.equal(folder.coverImageUrl,cover.href,key+' '+category+' cover');
        assert.equal(folder.heroBackdropUrl,backdrop.href,key+' '+category+' backdrop');
        urls.set(cover.href,{key,variant:category,expected:item[category]});
        folders++;result.folders++;
      }
    }
    assert.equal(folders,27,route+' approved folders');result.imports++;
  }
  const entries=[...urls];let cursor=0;const digests=new Set();
  await Promise.all(Array.from({length:4},async()=>{for(;;){const i=cursor++;if(i>=entries.length)return;
    const [url,{key,variant,expected}]=entries[i];const r=await request(url);const bytes=Buffer.from(await r.arrayBuffer());
    assert.match(r.headers.get('content-type'),/^image\/jpeg/);
    const digest=createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest,expected.sha256,key+' '+variant+' approved bytes');assert.equal(bytes.length,expected.bytes);
    assert.equal(r.headers.get('x-nuvio-service-source-sha256'),digest);
    assert.equal(r.headers.get('x-nuvio-service-style'),manifest.revision);
    assert(!digests.has(digest),key+' duplicate artwork');digests.add(digest);
    const meta=await sharp(bytes).metadata();assert.equal(meta.width,expected.width);assert.equal(meta.height,expected.height);
    result.images++;result.exactAssets++;
  }}));
  assert.equal(result.images,41);
  for(const route of ['/fr/service-cover.jpg?key=unknown&category=films','/fr/service-cover.jpg?key=vod-fr&category=series',
    '/fr/service-cover.jpg?key=netflix&category=unknown','/fr/service-backdrop.jpg?key=unknown']) await request(route,404);
  console.log(JSON.stringify({...result,ok:true},null,2));
} catch(error) {console.error(JSON.stringify({...result,ok:false,error:error.message},null,2));process.exitCode=1;}
