'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {MovieStore}=require('../src/store.cjs');const {fromTmdb}=require('../src/model.cjs');
const NOW=new Date('2026-10-26T12:00:00Z');
function record(id,genres=[18],providers=[8],extra={}) {
  return fromTmdb({id,title:`Movie policy ${id}`,release_date:'2026-10-20',genres:genres.map(id=>({id})),
    'watch/providers':{results:{FR:{flatrate:providers.map(provider_id=>({provider_id,provider_name:provider_id===8?'Netflix':'Molotov TV'}))}}},
    release_dates:{results:[]},...extra});
}
test('curated movies reject replay-only fiction and isolate documentary replay',t=>{
  const s=new MovieStore(':memory:');t.after(()=>s.close());
  s.upsert(record(1));s.upsert(record(2,[18],[1967]));s.upsert(record(3,[18,10770],[147]));
  s.upsert(record(4,[18,99],[1967]));s.upsert(record(5,[16,99],[8],{original_language:'ja'}));
  s.upsert(record(6,[18],[1967,8]));
  for(const view of ['all','streaming']) {
    const query=genre=>s.query({view,genre,curated:true,now:NOW});
    assert.deepEqual(query('all').map(m=>m.name),['Movie policy 1','Movie policy 6']);
    assert.deepEqual(query('99').map(m=>m.name),['Movie policy 4']);
    assert.equal(query('10770').length,0);assert.equal(query('unclassified').length,0);
    assert.deepEqual(query('all').find(m=>m.name==='Movie policy 6').streamingProviders,['Netflix']);
  }
  assert.equal(s.stats({curated:true}).streaming,2);
});
test('all four movie views sort and filter by first worldwide release, never a 2026 reissue',t=>{
  const s=new MovieStore(':memory:');t.after(()=>s.close());
  const r=record(80,[37],[8],{release_date:'1980-06-01',
    'watch/providers':{results:{FR:{flatrate:[{provider_id:8,provider_name:'Netflix'}],buy:[{provider_id:10,provider_name:'Amazon Video'}]}}},
    release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:1,release_date:'1980-05-01T00:00:00Z'}]},
      {iso_3166_1:'FR',release_dates:[{type:3,release_date:'2026-10-20T00:00:00Z'},{type:4,release_date:'2026-10-25T00:00:00Z'}]}]}});
  assert.equal(r.firstAirDate,'1980-05-01');s.upsert(r);
  for(const view of ['all','streaming','vod','cinema']) {
    assert.equal(s.query({view,genre:'37',period:'2026-10',curated:true,now:NOW}).length,0);
    const rows=s.query({view,genre:'37',period:'1980',curated:true,now:NOW});assert.equal(rows.length,1);
    assert.equal(rows[0].released.slice(0,10),'1980-05-01');assert.equal(rows[0].originalReleaseDate,'1980-05-01');
    assert.match(rows[0].description,/2026-10-25/,'reissue information remains secondary');
  }
});
test('major VOD stores and genuine cinema evidence remain separate from replay availability',t=>{
  const s=new MovieStore(':memory:');t.after(()=>s.close());
  s.upsert(record(1,[18],[],{'watch/providers':{results:{FR:{rent:[{provider_id:2,provider_name:'Apple TV Store'}]}}}}));
  s.upsert(record(2,[18],[],{'watch/providers':{results:{FR:{rent:[{provider_id:9999,provider_name:'Niche VOD'}]}}}}));
  s.upsert(record(3,[18],[],{release_dates:{results:[{iso_3166_1:'FR',release_dates:[{type:3,release_date:'2026-10-20'}]}]}}));
  assert.deepEqual(s.query({view:'vod',curated:true,now:NOW}).map(m=>m.name),['Movie policy 1']);
  assert.deepEqual(s.query({view:'cinema',curated:true,now:NOW}).map(m=>m.name),['Movie policy 3']);
  assert.deepEqual(s.query({view:'all',curated:true,now:NOW}).map(m=>m.name),['Movie policy 1','Movie policy 3']);
});
test('original-year ordering applies to every era and every movie view',t=>{
  const s=new MovieStore(':memory:');t.after(()=>s.close());
  const years=[1965,1999,2005,2019,2020,2025];
  for(const year of years) s.upsert(record(year,[37],[8],{release_date:`${year}-05-01`,
    'watch/providers':{results:{FR:{flatrate:[{provider_id:8,provider_name:'Netflix'}],rent:[{provider_id:2,provider_name:'Apple TV Store'}]}}},
    release_dates:{results:[{iso_3166_1:'FR',release_dates:[{type:3,release_date:'2026-10-20'},{type:4,release_date:'2026-10-25'}]}]}}));
  for(const view of ['all','streaming','vod','cinema']) {
    const query=period=>s.query({view,genre:'37',period,curated:true,now:NOW});
    assert.deepEqual(query('all').map(m=>m.originalReleaseDate),[...years].reverse().map(y=>`${y}-05-01`));
    assert.equal(query('2026').length,0);
    for(const year of years) assert.equal(query(String(year))[0].originalReleaseDate,`${year}-05-01`);
  }
  const undated=record(999,[18],[8],{release_date:'',release_dates:{results:[{iso_3166_1:'FR',release_dates:[{type:4,release_date:'2026-10-25'}]}]}});
  assert.equal(undated.firstAirDate,null,'a lone regional reissue cannot invent an unknown original release date');
});
