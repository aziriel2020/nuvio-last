'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectMovieLogo } = require('../src/logos.cjs');
const { fromTmdb } = require('../src/model.cjs');
const { MovieStore } = require('../src/store.cjs');

function film(images) {
  return fromTmdb({
    id: 1234567, title: 'Le Film', original_language: 'fr',
    release_date: '2026-10-30', genres: [{ id: 18 }],
    poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg',
    'watch/providers': { results: { FR: { flatrate: [{ provider_id:8,provider_name:'Netflix' }] } } },
    release_dates: { results: [] }, ...(images === undefined ? {} : { images })
  });
}
const img = (file_path, iso_639_1, width = 1200, vote_average = 5, vote_count = 10) =>
  ({ file_path, iso_639_1, width, height: 500, vote_average, vote_count });

test('TMDB title logo selection prefers French then original language, English and neutral',()=>{
  const logos=[img('/en.png','en'),img('/neutral.png',null),img('/fr.png','fr',600,0,0),
    img('/original.png','ja',1600)];
  assert.equal(selectMovieLogo({logos},'ja').url,'https://image.tmdb.org/t/p/w500/fr.png');
  assert.equal(selectMovieLogo({logos:logos.filter(l=>l.iso_639_1!=='fr')},'ja').language,'ja');
  assert.equal(selectMovieLogo({logos:logos.filter(l=>!['fr','ja'].includes(l.iso_639_1))},'ja').language,'en');
  assert.equal(selectMovieLogo({logos:[logos[1]]},'ja').language,null);
});

test('TMDB logo selection rejects SVG, malformed paths and undersized art for client compatibility',()=>{
  assert.equal(selectMovieLogo({logos:[img('/vector.svg','fr'),img('/tiny.png','fr',100)]},'fr'),null);
  assert.equal(selectMovieLogo({logos:[img('//evil.example/logo.png','fr')]},'fr'),null);
  assert.equal(selectMovieLogo({logos:[img('/good.png','fr',600)]},'fr').url,'https://image.tmdb.org/t/p/w500/good.png');
  assert.equal(selectMovieLogo({},'fr'),null);
  assert.equal(selectMovieLogo(null,'fr'),null);
});

test('MovieStore persists logos and exposes them without changing dates, poster or film ID',(t)=>{
  const store=new MovieStore(':memory:');
  t.after(()=>store.close());
  const full=film({logos:[img('/film-title.png','fr')]});
  assert.equal(full.logo,'https://image.tmdb.org/t/p/w500/film-title.png');
  store.upsert(full);
  const id=store.row('tmdb:1234567').id;
  assert.equal(store.row(id).logo,full.logo);
  const meta=store.meta(store.row(id));
  assert.equal(meta.logo,full.logo);
  assert.equal(meta.poster,'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(meta.originalReleaseDate,'2026-10-30');
  assert.equal(meta.id,'tmdb:movie:1234567');
  store.upsert(film()); // discover refresh with no 'images'
  assert.equal(store.row(id).logo,full.logo,'discovery does not erase enriched transparent logo');
  store.upsert(film({logos:[]}));
  assert.equal(store.row(id).logo,null,'explicit no-logo detail clears stale logo');
  assert.equal(store.meta(store.row(id)).logo,undefined);
});
