'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { posterPattern,parsePosterQuery,handle }=require('../runtime/design-plugin.cjs');

const parse=(s)=>parsePosterQuery(new URL('https://example.test/design-plugin/poster.jpg?'+s));
function response() {
  const headers={};
  return {statusCode:200,headers,setHeader(k,v){headers[k.toLowerCase()]=v;},
    end(body){this.body=body;}};
}

test('a single native Custom Posters pattern targets the entire existing app without APK changes',()=>{
  const pattern=posterPattern('https://example.test');
  assert.equal(pattern,'https://example.test/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details');
  assert.deepEqual(parse('type=movie&id=tt1234567&shape=landscape'),{kind:'movie',id:'tt1234567',shape:'landscape'});
  assert.deepEqual(parse('type=series&id=tmdb%3Atv%3A123&shape=poster'),{kind:'series',id:'tmdb:tv:123',shape:'poster'});
  assert.deepEqual(parse('type=movie&id=tmdb%3Amovie%3A123&shape=poster'),{kind:'movie',id:'tmdb:movie:123',shape:'poster'});
  for(const p of ['type=movie&id=abc&shape=landscape','type=movie&id=tmdb%3Atv%3A123','type=series&id=tmdb%3Amovie%3A123','type=movie&id=tt1234567&shape=evil','type=other&id=tt1234567','type=movie&id=https%3A%2F%2Fevil.test']) {
    assert.equal(parse(p),null,p);
  }
});

test('legacy Custom Posters JPEG endpoint redirects without generating image bytes', async () => {
  const res=response();
  await handle({url:'/design-plugin/poster.jpg?type=movie&id=tt1234567&shape=landscape',headers:{}},
    res,'https://example.test');
  assert.equal(res.statusCode,307);
  assert.equal(res.headers.location,
    'https://example.test/design-meta/art/movie/tt1234567/landscape.svg?v=oracle-vector-v4-film-details');
  assert.equal(res.body,'');
  const portrait=response();
  await handle({url:'/design-plugin/poster.jpg?type=series&id=tmdb%3Atv%3A123&shape=poster',headers:{}},
    portrait,'https://example.test');
  assert.equal(portrait.statusCode,404);
});

test('plugin gives one configuration URL, and unknown IDs fall back instead of showing an invented poster',async()=>{
  const config=response();
  await handle({url:'/design-plugin/config.json',headers:{}},config,'https://example.test');
  const result=JSON.parse(config.body);
  assert.equal(config.statusCode,200);
  assert.equal(result.requiresModifiedApk,false);
  assert.match(result.posterPattern,/\{id\}/);
  assert.match(result.existingCollections,/nuvio-collections-unified\.json$/);
  const bad=response();
  await handle({url:'/design-plugin/poster.jpg?type=movie&id=unknown&shape=landscape',headers:{}},bad,'https://example.test');
  assert.equal(bad.statusCode,400);
  assert.equal(bad.headers['cache-control'],'no-store');
});
