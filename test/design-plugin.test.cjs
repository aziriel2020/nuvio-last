'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { posterPattern,legacyPosterPattern,parsePosterQuery,sourceInfo,handle }=require('../runtime/design-plugin.cjs');

const parse=(s)=>parsePosterQuery(new URL('https://example.test/design-plugin/poster.jpg?'+s));
function response() {
  const headers={};
  return {statusCode:200,headers,setHeader(k,v){headers[k.toLowerCase()]=v;},
    end(body){this.body=body;}};
}

test('a single native Custom Posters pattern targets the entire existing app without APK changes',()=>{
  const pattern=posterPattern('https://example.test');
  assert.equal(pattern,'https://example.test/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details');
  assert.equal(legacyPosterPattern('https://example.test'),'https://example.test/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}');
  assert.deepEqual(parse('type=movie&id=tt1234567&shape=landscape'),{kind:'movie',id:'tt1234567',shape:'landscape'});
  assert.deepEqual(parse('type=series&id=tmdb%3Atv%3A123&shape=poster'),{kind:'series',id:'tmdb:tv:123',shape:'poster'});
  assert.deepEqual(parse('type=movie&id=tmdb%3Amovie%3A123&shape=poster'),{kind:'movie',id:'tmdb:movie:123',shape:'poster'});
  for(const p of ['type=movie&id=abc&shape=landscape','type=movie&id=tmdb%3Atv%3A123','type=series&id=tmdb%3Amovie%3A123','type=movie&id=tt1234567&shape=evil','type=other&id=tt1234567','type=movie&id=https%3A%2F%2Fevil.test']) {
    assert.equal(parse(p),null,p);
  }
});

test('plugin resolves only safe TMDB pictures from existing collections, retains original fallback',()=>{
  const row={title:'Titre français',poster:'https://image.tmdb.org/t/p/w500/film.jpg',background:'https://image.tmdb.org/t/p/w1280/backdrop.jpg'};
  const store={row(id){assert.equal(id,'tmdb:123');return row;}};
  assert.deepEqual(sourceInfo({kind:'movie',id:'tmdb:movie:123',shape:'landscape'},store,null),{
    type:'movie',layout:'landscape',src:row.background,fallback:row.poster,title:row.title
  });
  assert.deepEqual(sourceInfo({kind:'series',id:'tmdb:tv:123',shape:'poster'},null,store),{
    type:'series',layout:'portrait',src:row.poster,fallback:row.background,title:row.title
  });
  assert.equal(sourceInfo({kind:'movie',id:'tt12345',shape:'poster'},null,null),null);
  assert.equal(sourceInfo({kind:'movie',id:'tt12345',shape:'poster'},
    {row:()=>({title:'x',poster:'https://evil.test/a.jpg'})},null),null);
});

test('plugin gives one configuration URL, and unknown IDs fall back instead of showing an invented poster',async()=>{
  const config=response();
  await handle({url:'/design-plugin/config.json',headers:{}},config,'https://example.test');
  const result=JSON.parse(config.body);
  assert.equal(config.statusCode,200);
  assert.equal(result.requiresModifiedApk,false);
  assert.match(result.posterPattern,/\{id\}/);
  assert.match(result.posterPattern,/oracle-vector-v4-film-details/);
  assert.equal(result.jpegConversion,false);
  assert.equal(result.requiresClientSvgSupport,true);
  assert.match(result.legacyPosterPattern,/\.jpg\?/);
  assert.match(result.existingCollections,/nuvio-collections-unified\.json$/);
  const bad=response();
  await handle({url:'/design-plugin/poster.jpg?type=movie&id=unknown&shape=landscape',headers:{}},bad,'https://example.test');
  assert.equal(bad.statusCode,400);
  assert.equal(bad.headers['cache-control'],'no-store');
});
