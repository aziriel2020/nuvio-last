'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const movie = require('../regions/movies/index.cjs');
const api = require('../api/index');
const { GENRES } = require('../regions/movies/src/model.cjs');

function fetchLocal(path) {
  return new Promise((resolve, reject) => {
    const req={method:'GET',url:path,headers:{host:'example.test','x-forwarded-proto':'https'}};
    let status=200,headers={};
    const res={get statusCode(){return status},set statusCode(v){status=v},
      setHeader(k,v){headers[k.toLowerCase()]=v},getHeader(k){return headers[k.toLowerCase()]},
      end(v=''){resolve({status,headers,body:typeof v==='string'?v:Buffer.from(v).toString('utf8')})}};
    Promise.resolve(api(req,res)).catch(reject);
  });
}

function allSources(collection) {
  return collection.folders.flatMap(f=>f.sources.map(s=>s.catalogId));
}

test('Films Monde fast import retains exact source coverage, original folder identities and premium cover design', () => {
  const origin='https://example.test/movies';
  const now=new Date('2026-10-31T13:00:00.000Z');
  const original=movie._internals.buildCollections(origin,now,'shield');
  const fast=movie._internals.buildFastCollections(origin,now,'shield');
  assert.equal(original.length,4);
  assert.equal(fast.length,4);
  for(let i=0;i<fast.length;i++){
    const before=original[i], after=fast[i];
    assert.equal(after.id,before.id);
    assert.equal(after.title,before.title);
    assert.equal(after.backdropImageUrl,before.backdropImageUrl);
    assert.deepEqual(after.folders.slice(0,before.folders.length).map(f=>f.id),before.folders.map(f=>f.id));
    assert.deepEqual(allSources(after).sort(),allSources(before).sort(), 'never delete/duplicate an archive period');
    assert.equal(new Set(allSources(after)).size,allSources(after).length, 'unique catalog source IDs');
    assert(after.folders.length>before.folders.length, 'older years must remain reachable in archive folders');
    for(const folder of after.folders){
      assert(folder.sources.length>0&&folder.sources.length<=24, folder.id+' must bound eager Nuvio requests');
      assert.deepEqual(folder.catalogSources.map(c=>c.catalogId),folder.sources.map(s=>s.catalogId));
    }
    for(let j=0;j<before.folders.length;j++){
      assert.equal(after.folders[j].coverImageUrl,before.folders[j].coverImageUrl);
      assert.equal(after.folders[j].heroBackdropUrl,before.folders[j].heroBackdropUrl);
      assert.equal(after.folders[j].title,before.folders[j].title);
      assert(after.folders[j].sources.some(s=>s.catalogId.endsWith('-today')));
      assert(after.folders[j].sources.some(s=>s.catalogId.endsWith('-2026-10')));
    }
    assert(after.folders.slice(before.folders.length).every(f=>/Archives/.test(f.title) && f.hideTitle===false));
  }
  assert.equal(original[0].folders.length,GENRES.length-1);
});

test('Films Monde fast import honors automated 2030 rollover and retains Western historical sources',()=>{
  const now=new Date('2030-12-31T13:00:00.000Z');
  const output=movie._internals.buildFastCollections('https://example.test/movies',now);
  for(const collection of output){
    const western=collection.folders.filter(f=>f.id.startsWith('movies-world-'+collection.id.split('-').at(-1)+'-37'));
    assert(western.length>1,'western archives split into browsable groups');
    const periods=allSources(collection);
    assert(periods.some(x=>x.endsWith('-2030-12')), '2030-12 survives rollover');
    assert(periods.some(x=>x.endsWith('-2018-01')), '2018 archive survives');
  }
});

test('Films Monde original import is untouched; opt-in fast endpoint remains installable',async()=>{
  const [oldImport,fastImport,desktopFast]=await Promise.all([
    fetchLocal('/movies/nuvio-collections.json'),
    fetchLocal('/movies/nuvio-collections-fast.json'),
    fetchLocal('/movies/nuvio-collections-fast-desktop.json')
  ]);
  assert.equal(oldImport.status,200);
  assert.equal(fastImport.status,200);
  assert.equal(desktopFast.status,200);
  const old=JSON.parse(oldImport.body), fast=JSON.parse(fastImport.body),desktop=JSON.parse(desktopFast.body);
  assert.equal(fast.length,4);
  assert.equal(desktop.length,4);
  assert.equal(old[0].folders.length,20);
  assert(fast[0].folders.length>20);
  assert.deepEqual(allSources(fast[0]).sort(),allSources(old[0]).sort());
});
