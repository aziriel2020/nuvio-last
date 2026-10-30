'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals: api } = require('../api/index');
const source = { type: 'movie', providerSlug: 'prime-video', period: 'today' };
const now = { start: '2026-10-30', end: '2026-10-30', empty: false };
test('Prime official premiere is present in today and October but not yesterday or November', () => {
  assert.equal(api.verifiedPremieresForCatalog(source, now).length, 1);
  assert.equal(api.verifiedPremieresForCatalog(source, { start:'2026-10-01',end:'2026-10-30' }).length,1);
  assert.equal(api.verifiedPremieresForCatalog(source, { start:'2026-10-29',end:'2026-10-29' }).length,0);
  assert.equal(api.verifiedPremieresForCatalog(source, { start:'2026-11-01',end:'2026-11-30' }).length,0);
});
test('Other providers and TV cannot inherit Prime release', () => {
  assert.deepEqual(api.verifiedPremieresForCatalog({...source,providerSlug:'netflix'},now),[]);
  assert.deepEqual(api.verifiedPremieresForCatalog({...source,type:'series'},now),[]);
  assert.deepEqual(api.verifiedPremieresForCatalog(source,{...now,empty:true}),[]);
});
test('Verified card uses platform release, canonical movie identity and official link', () => {
  const p=api.verifiedPremieresForCatalog(source,now)[0];
  const m=api.verifiedPremiereMovieMeta(p,{
    id:1507696,release_date:'2026-10-09',title:'Incorrect TMDb title',
    poster_path:'/poster.jpg',backdrop_path:'/backdrop.jpg',
    external_ids:{ imdb_id:'tt37522541' },overview:'Real plot'
  });
  assert.equal(m.type,'movie');
  assert.equal(m.id,'tt37522541');
  assert.equal(m._dedupeKey,'movie:1507696');
  assert.equal(m.released,'2026-10-30');
  assert.equal(m.name,'Apocalypse Z : Nouveau Monde');
  assert.match(m.poster,/poster.jpg/);
  assert.match(m.description,/30 (?:oct\.|octobre) 2026/);
  assert(m.links.some(l=>l.category==='Regarder'&&/primevideo.com/.test(l.url)));
});
test('Missing TMDb details still yields verified metadata without inventing an image', () => {
  const p=api.verifiedPremieresForCatalog(source,now)[0];
  const m=api.verifiedPremiereMovieMeta(p);
  assert.equal(m.id,'tt37522541');
  assert.equal(m.released,'2026-10-30');
  assert.equal(m.poster,null);
});
