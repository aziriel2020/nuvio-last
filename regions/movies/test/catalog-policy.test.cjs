'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {MovieStore}=require('../src/store.cjs');const {fromTmdb}=require('../src/model.cjs');
const NOW=new Date('2026-10-26T12:00:00Z');
const {contentKind}=require('../src/content-policy.cjs');
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

test('stand-up has an exclusive category across every view, genre, search and detail gate',t=>{
  const s=new MovieStore(':memory:');t.after(()=>s.close());
  const offers={results:{FR:{flatrate:[{provider_id:8,provider_name:'Netflix'}],rent:[{provider_id:2,provider_name:'Apple TV Store'}]}}};
  const evidence={results:[{iso_3166_1:'FR',release_dates:[{type:3,release_date:'2026-10-20'}]}]};
  const extra={title:'Format sample',release_dates:evidence,'watch/providers':offers};
  s.upsert(record(701,[35],[8],{...extra,keywords:{keywords:[{name:'stand-up comedy'}]}}));
  s.upsert(record(702,[35],[8],{...extra,credits:{cast:[{character:'Fictional hero'},{character:'Fictional friend'}]}}));
  s.upsert(record(703,[35,99],[8],{...extra,overview:'A documentary about the history of stand-up comedy.',keywords:{keywords:[{name:'stand-up comedy'}]}}));
  s.upsert(record(704,[10402,99],[8],{...extra,keywords:{keywords:[{name:'concert film'}]}}));
  s.upsert(record(705,[35],[8],{...extra,keywords:{keywords:[{name:'talk show'}]}}));
  s.upsert(record(706,[35],[8],extra));
  for(const view of ['all','streaming','vod','cinema']) {
    const query=genre=>s.query({view,genre,search:'Format sample',period:'2026-10',curated:true,now:NOW});
    for(const genre of ['all','35'])assert.deepEqual(query(genre).map(m=>m.id),['tmdb:movie:702']);
    assert.deepEqual(query('standup').map(m=>m.id),['tmdb:movie:701']);
    assert.deepEqual(query('standup')[0].genres,['Stand-up']);
    assert.equal(query('standup')[0].movieContentKind,'standup');
    assert.deepEqual(query('99').map(m=>m.id),['tmdb:movie:703']);
    assert.equal(query('10402').length,0);
  }
  for(const id of [701,702,703])assert(s.visible(`tmdb:${id}`,{curated:true}));
  for(const id of [704,705,706])assert(!s.visible(`tmdb:${id}`,{curated:true}));
  assert.equal(s.stats({curated:true}).eligible,1);
});

test('format evidence preserves fictional comedian/music stories and rejects filmed events',()=>{
  const fiction={genres:[35,18],title:'The comedian',description:'A comedian dreams of appearing on television.',keywords:['stand-up comedy','talk show']};
  assert.equal(contentKind(fiction),'fiction');
  assert.equal(contentKind({genres:[35],cast:[{character:'Robert'},{character:'Self'}]}),'fiction');
  assert.equal(contentKind({genres:[35],cast:[{character:'Self - Host'},{character:'Himself'}]}),'performance');
  assert.equal(contentKind({genres:[10402,18],keywords:['music','concert']}),'fiction');
  assert.equal(contentKind({genres:[35,99],description:'Spectacle de stand-up enregistré à Paris.'}),'standup');
  assert.equal(contentKind({genres:[99],keywords:['stand-up comedy'],description:'Portrait de la vie d’un humoriste.'}),'documentary');
  assert.equal(contentKind({genres:[35],description:'Une captation théâtrale avec trois comédiens.'}),'performance');
  assert.equal(contentKind({genres:[35],video:true}),'video');
  for(const genre of [10763,10764,10767])assert.equal(contentKind({genres:[genre,99]}),'television');
  assert.equal(contentKind({genres:[18],keywords:['television special']}),'television');
  assert.equal(contentKind({genres:[28],keywords:['sports event']}),'performance');
});

test('legacy ambiguous comedy is withheld until enriched, and metadata corrections apply immediately',t=>{
  const s=new MovieStore(':memory:');t.after(()=>s.close());
  s.upsert(record(801,[35],[8],{title:'Legacy special'}));
  const payload=JSON.parse(s.db.prepare("SELECT payload FROM sources WHERE show_id='tmdb:801'").get().payload);delete payload.movieContentKind;
  s.db.prepare("UPDATE sources SET payload=? WHERE show_id='tmdb:801'").run(JSON.stringify(payload));
  assert.equal(s.query({curated:true,now:NOW}).length,0);
  assert.equal(s.query({genre:'standup',curated:true,now:NOW}).length,0);
  s.upsert(record(801,[35],[8],{title:'Legacy special',keywords:{keywords:[{name:'stand-up comedy'}]}}));
  assert.equal(s.query({genre:'standup',curated:true,now:NOW}).length,1);
  assert.equal(s.query({genre:'35',curated:true,now:NOW}).length,0);
  s.upsert(record(801,[35],[8],{title:'Legacy fiction',credits:{cast:[{character:'A fictional character'}]}}));
  assert.equal(s.query({genre:'standup',curated:true,now:NOW}).length,0);
  assert.equal(s.query({genre:'35',curated:true,now:NOW}).length,1);
});

test('existing database upgrade queues format checks once without deleting history or writing from a reader',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'movie-format-upgrade-')),file=path.join(dir,'movies.sqlite');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let s=new MovieStore(file);
  s.upsert(record(901,[35],[8]));s.upsert(record(902,[18],[8]));
  s.db.prepare("UPDATE sources SET payload=json_remove(payload,'$.movieContentKind')").run();
  s.db.prepare("DELETE FROM state WHERE key='movieContentRevision'").run();s.close();
  s=new MovieStore(file,{readonly:true});assert.equal(s.jobs('movie-detail').length,0);s.close();
  s=new MovieStore(file);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM shows').get().n,2);
  assert.deepEqual(s.jobs('movie-detail').map(j=>j.source_id),[901]);
  s.done('movie-detail',901,3600000);s.close();
  s=new MovieStore(file);assert.equal(s.jobs('movie-detail').length,0);s.close();
});
