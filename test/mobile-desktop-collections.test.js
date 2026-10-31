'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');

function request(path) {
  return new Promise((resolve, reject) => {
    const req = {method: 'GET', url: path, headers: {
      host: 'nuvio.test', 'x-forwarded-proto': 'https',
      'x-nuvio-timezone': 'Europe/Brussels'
    }};
    const out = {status: 200, headers: {}, body: ''};
    const res = {
      get statusCode() { return out.status; },
      set statusCode(value) { out.status = value; },
      setHeader(name,value) { out.headers[String(name).toLowerCase()] = value; },
      end(body = '') {out.body = String(body); resolve(out);}
    };
    Promise.resolve(handler(req,res)).catch(reject);
  });
}

const regions = ['fr','us','tr','global','movies','series-v2'];
test('Mobile/Desktop alternative manifests avoid Home work while preserving every source descriptor',async () => {
  for (const region of regions) {
    const [standard,compat,tv] = await Promise.all([
      request(`/${region}/manifest.json`),
      request(`/${region}/mobile-desktop-collections/manifest.json`),
      request(`/${region}/collections-only/manifest.json`)
    ]);
    assert.equal(standard.status, 200, region);
    assert.equal(compat.status, 200, region);
    assert.equal(tv.status, 200, region);
    const base = JSON.parse(standard.body);
    const mobileDesktop = JSON.parse(compat.body);
    const television = JSON.parse(tv.body);
    assert.equal(base.id,mobileDesktop.id,`same addon ID / collection binding: ${region}`);
    assert.equal(base.version,mobileDesktop.version);
    assert.deepEqual(base.resources,mobileDesktop.resources);
    assert.deepEqual(base.types,mobileDesktop.types);
    assert.deepEqual(base.idPrefixes,mobileDesktop.idPrefixes);
    assert(base.catalogs.length > 0);
    assert.deepEqual(base.catalogs.map(c=>[c.type,c.id]),
      mobileDesktop.catalogs.map(c=>[c.type,c.id]),
      `every imported catalog must still resolve: ${region}`);
    assert.deepEqual(television.catalogs.map(c=>[c.id,c.type,c.name]),
      base.catalogs.map(c=>[c.id,c.type,c.name]),
      `Shield now preserves named periods without changing Mobile/Desktop IDs: ${region}`);
    for(const cat of mobileDesktop.catalogs){
      assert.equal(cat.showInHome,false);
      assert(cat.extra.some(e=>e.name==='genre'&&e.isRequired===true&&e.options?.length===0),
        `required genre with zero options suppresses Home and Discover: ${region}/${cat.id}`);
      assert(cat.extra.every(e=> !e.isRequired || e.name==='genre'),
        `required non-genre would break the collection editor: ${region}/${cat.id}`);
      assert(!cat.extra.some(e=>e.name==='search'),
        `collection-only catalog must not advertise itself as a search provider: ${region}/${cat.id}`);
      assert(!cat.extraSupported?.includes('search'),`search extra not advertised: ${region}/${cat.id}`);
      // Mirror exact Nuvio Mobile and Desktop common client filters:
      // HomeCatalogDefinitions.kt: none { it.isRequired }
      // SearchRepository.kt#supportsSearch: search present and no required non-search
      // SearchRepository.kt#supportsDiscover: required genre without options is excluded
      const home = cat.extra.every(e=>!e.isRequired);
      const search = cat.extra.some(e=>e.name==='search') &&
        cat.extra.every(e=>!e.isRequired||e.name==='search');
      const discover = !cat.extra.some(e=>e.name==='search'&&e.isRequired) &&
        cat.extra.every(e=>e.name!=='genre' ? !e.isRequired || ['skip','search'].includes(e.name) : !e.isRequired || Boolean(e.options?.length));
      assert.equal(home,false,`must not load Home: ${region}/${cat.id}`);
      assert.equal(search,false,`must not join global Search: ${region}/${cat.id}`);
      assert.equal(discover,false,`must not appear in Discover: ${region}/${cat.id}`);
    }
    assert.equal(compat.headers['cache-control'],'no-store');
  }
});

test('alternative manifests leave canonical routes and visual handlers addressable',async()=>{
  for(const region of ['fr','us','tr','global']){
    const response=await request(`/${region}/mobile-desktop-collections/logo.svg`);
    assert.equal(response.status,200,`logo route ${region}`);
    assert.match(response.body,/<svg/);
  }
});

test('collection manifest transformation is nonmutating, preserves catalog IDs and marks only allowed genre as required',()=>{
  const source = {id:'demo',version:'1.0.0',catalogs:[
    {id:'day',type:'movie',name:'Day',showInHome:false,extra:[{name:'skip',isRequired:false},{name:'search',isRequired:false}]},
    {id:'genre',type:'series',name:'Genre',extra:[{name:'genre',isRequired:false,options:['Drama']},{name:'skip',isRequired:false}]}
  ]};
  const input=JSON.stringify(source);
  const result=handler._internals.mobileDesktopCollectionManifest(source);
  assert.equal(JSON.stringify(source),input,'canonical manifest is never mutated');
  assert.deepEqual(result.catalogs.map(c=>c.id),['day','genre']);
  assert.deepEqual(result.catalogs[1].extra[0].options,[],'Discover must not advertise source genres');
  assert(result.catalogs.every(c=>c.extra.some(e=>e.name==='genre'&&e.isRequired)));
  assert(result.catalogs[0].extra.every(e=>e.name!=='search'));
});
