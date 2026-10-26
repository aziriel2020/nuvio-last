'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const api = require('../api/index');
const { landscapeArtwork, renderAnimeCatalogCard } = require('../api/anime-cards.cjs');

test('mapped anime prioritises its TMDb backdrop over a portrait AniList cover', () => {
  const schedule = { mediaId: 99001, episode: 2, airingAt: Date.parse('2026-09-09T12:30:00Z') / 1000,
    media: { id: 99001, countryOfOrigin: 'JP', format: 'TV', title: { english: 'Artwork Regression' },
      coverImage: { extraLarge: 'https://s4.anilist.co/portrait.jpg' } } };
  const result = api._internals.animeScheduleToMeta(schedule,
    { id: 88, name: 'Artwork Regression', backdrop_path: '/wide.jpg', poster_path: '/poster.jpg' },
    'Asia/Tokyo', { start: '2026-09-09', end: '2026-09-09', today: '2026-09-09' });
  assert(result.meta);
  assert.match(result.meta.background, /image\.tmdb\.org.*wide\.jpg/);
  assert.match(result.meta.poster, /image\.tmdb\.org.*poster\.jpg/);
  const [decorated] = api._internals.decorateCatalogMetas('https://anime.example/global', [result.meta],
    { period: 'archive-2026-09', type: 'series', providerSlug: 'anime-asia' }, 'Asia/Tokyo');
  const url = new URL(decorated.poster);
  assert.match(url.searchParams.get('src'), /\/w1280\/wide\.jpg$/);
  assert.equal(decorated.posterShape, 'landscape');
  for (const key of ['background','landscapePoster','banner']) assert.equal(decorated[key], decorated.poster);
  assert.match(decorated.logo, /calendar-transparent-logo/);
});

test('portrait anime key art retains both its top and bottom in a 16:9 composition', async () => {
  const image = await sharp({ create: { width: 400, height: 800, channels: 3, background: '#121212' } })
    .composite([
      { input: await sharp({ create: { width: 400, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer(), top: 0, left: 0 },
      { input: await sharp({ create: { width: 400, height: 100, channels: 3, background: '#00ff00' } }).png().toBuffer(), top: 700, left: 0 }
    ]).png().toBuffer();
  const output = await landscapeArtwork(image);
  const meta = await sharp(output).metadata();
  assert.equal(meta.width,1600); assert.equal(meta.height,900);
  for (const [top,channel] of [[20,0],[880,1]]) {
    const pixel = await sharp(output).extract({left:800,top,width:1,height:1}).raw().toBuffer();
    assert(pixel[channel] > 220, 'the full poster edge must survive the landscape conversion');
  }
});

test('anime cards keep the shared calendar design and recover a broken primary source', async (t) => {
  const image=await sharp({create:{width:1600,height:900,channels:3,background:'#3f718a'}}).jpeg().toBuffer();
  const calls=[];
  t.mock.method(global,'fetch',async input=>{
    const src=String(input);calls.push(src);
    return src.endsWith('broken-anime-test.jpg') ? new Response('',{status:503})
      : new Response(image,{headers:{'content-type':'image/jpeg'}});
  });
  const url=new URL('https://anime.example/global/desktop-content-card.jpg');
  url.search=new URLSearchParams({provider:'anime-asia',src:'https://image.tmdb.org/t/p/w1280/broken-anime-test.jpg',
    fallback:'https://s4.anilist.co/working-anime-test.jpg',title:'Anime Recovery',append:'EP02 • AUJOURD’HUI • ANIME JP/KR'});
  let renderedLayout;
  const result=await renderAnimeCatalogCard(url,{isAllowedSource:api._internals.isAllowedPosterSource,calendarCardSvg:options=>{
    renderedLayout=options.layout;return api._internals.calendarCardSvg(options);
  }});
  assert.equal(renderedLayout,'landscape');assert.equal(result.photo,true);
  assert.match(result.selectedSource,/working-anime-test/);assert.equal(calls.length,2);
  const meta=await sharp(result.data).metadata();assert.equal(meta.width,1600);assert.equal(meta.height,900);
});

test('the public anime card route returns a 1600x900 JPEG and does not cache an unavailable photo', async (t) => {
  t.mock.method(global,'fetch',async()=>new Response('',{status:503}));
  const output=await new Promise((resolve,reject)=>{
    const out={status:200,headers:{}};
    const response={
      get statusCode(){return out.status;}, set statusCode(value){out.status=value;},
      setHeader(key,value){out.headers[key.toLowerCase()]=value;},
      end(data){out.data=Buffer.isBuffer(data)?data:Buffer.from(data||'');resolve(out);}
    };
    api({method:'GET',url:'/desktop-content-card.jpg?'+new URLSearchParams({provider:'anime-asia',
      src:'https://image.tmdb.org/t/p/w1280/unavailable-anime-route.jpg',title:'Route recovery'}),
      headers:{host:'anime.example','x-forwarded-proto':'https'}},response).catch(reject);
  });
  assert.equal(output.status,200);assert.equal(output.headers['content-type'],'image/jpeg');
  assert.equal(output.headers['cache-control'],'no-store');
  assert.equal(output.headers['x-nuvio-anime-design'],'calendar-16x9-v1');
  const meta=await sharp(output.data).metadata();assert.equal(meta.width,1600);assert.equal(meta.height,900);
});
