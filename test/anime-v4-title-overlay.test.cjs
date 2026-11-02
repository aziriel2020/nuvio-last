'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { decorateCatalogMetas }=require('../regions/global/api/index.js')._internals;

test('anime cinematic card retains invisible native title overlay in V4 without legacy calendar JPEGs',()=>{
  const previous=process.env.CALENDAR_CARDS;
  try {
    process.env.CALENDAR_CARDS='0';
    const raw={id:'tmdb:tv:44321',type:'series',name:'Anime de test',
      poster:'https://image.tmdb.org/t/p/w500/p.jpg',
      background:'https://image.tmdb.org/t/p/w1280/b.jpg',
      released:'2026-11-01T00:00:00.000Z'};
    const catalog={providerSlug:'anime-asia',type:'series',period:'lastweek'};
    const result=decorateCatalogMetas('https://nuvio.example/global',[raw],catalog,'Asia/Tokyo')[0];
    assert.equal(result.posterShape,'landscape');
    assert.match(result.logo,/\/global\/calendar-transparent-logo\.svg\?v=/);
    assert.match(result.poster,/\/global\/desktop-content-card\.jpg\?/);
    for(const f of ['background','banner','landscapePoster']) assert.equal(result[f],result.poster);
    assert.equal(result.released,raw.released);
    assert.equal(raw.logo,undefined,'unmodified original metadata');
  }finally{
    if(previous===undefined)delete process.env.CALENDAR_CARDS;
    else process.env.CALENDAR_CARDS=previous;
  }
});
