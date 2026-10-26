'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SeriesStore } = require('../src/store.cjs');
const { fromTmdb } = require('../src/model.cjs');
const { allowedOffer } = require('../src/catalog-policy.cjs');
const NOW = new Date('2026-10-26T12:00:00Z');
function put(store,id,genres=[18],providers=[8],extra={}) {
  const names={8:'Netflix',147:'M6+',1967:'Molotov TV',2672:'M6plus Amazon Channel',1754:'TF1+'};
  store.upsert(fromTmdb({id,name:`Policy ${id}`,first_air_date:'2026-10-20',type:'Scripted',
    genres:genres.map(id=>({id})), 'watch/providers':{results:{FR:{flatrate:providers.map(provider_id=>({provider_id,provider_name:names[provider_id]||'Niche service'}))}}},
    seasons:[{season_number:2,air_date:'2026-10-20'}],...extra}));
}
test('major eligibility never treats an arbitrary Amazon channel as Prime Video',()=>{
  assert(allowedOffer({provider_id:119,kind:'flatrate'}));
  assert(allowedOffer({provider_id:1796,kind:'flatrate'}));
  assert(!allowedOffer({provider_id:2672,name:'M6plus Amazon Channel',kind:'flatrate'}));
  assert(!allowedOffer({provider_id:1967,kind:'flatrate'}));
});
test('V2 keeps TV programmes exclusively in their real specialist genres, in both date views',t=>{
  const s=new SeriesStore(':memory:');t.after(()=>s.close());
  put(s,1);put(s,2,[18],[147]);put(s,3,[18],[1967]);put(s,4,[18],[2672]);
  put(s,5,[18,99],[147]);put(s,6,[35,10764],[8]);put(s,7,[35,10767],[1754]);put(s,8,[10763],[8]);
  put(s,9,[16,99],[8],{origin_country:['JP'],original_language:'ja'});
  put(s,10,[18],[147,8]);
  for(const mode of ['premieres','seasons']) {
    const query=genre=>s.query({curated:true,genre,mode,period:'2026-10',now:NOW});
    assert.deepEqual(query('all').map(m=>m.name),['Policy 1','Policy 10']);
    assert.deepEqual(query('18').map(m=>m.name),['Policy 1','Policy 10']);
    assert.deepEqual(query('99').map(m=>m.name),['Policy 5']);
    assert.deepEqual(query('10764').map(m=>m.name),['Policy 6']);
    assert.deepEqual(query('10767').map(m=>m.name),['Policy 7']);
    assert.equal(query('35').length,0);assert.equal(query('10763').length,0);assert.equal(query('unclassified').length,0);
    assert.deepEqual(query('all').find(m=>m.name==='Policy 10').streamingProviders,['Netflix']);
  }
  assert.equal(s.hasCuratedAvailability('tmdb:2'),false);
  assert.equal(s.hasCuratedAvailability('tmdb:5'),true);
  assert.equal(s.hasCuratedAvailability('tmdb:9'),false);
  assert.equal(s.stats({curated:true}).eligible,5);
});
test('unverified discovery and renewed stale offers cannot prove a major-platform subscription',t=>{
  const s=new SeriesStore(':memory:');t.after(()=>s.close());
  put(s,1,[18],[8]);
  s.db.prepare('UPDATE fr_availability SET checked_at=?').run(Date.now()-49*3600000);
  s.markFranceDiscovered(1);
  assert.equal(s.query({curated:true,now:NOW}).length,0);
  put(s,2,[18],[8],{'watch/providers':undefined});s.markFranceDiscovered(2);
  assert.equal(s.query({curated:true,now:NOW}).length,0);
});
