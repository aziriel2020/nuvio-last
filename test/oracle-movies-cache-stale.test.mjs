import test from 'node:test';
import assert from 'node:assert/strict';
import {historyGraceMs as grace} from '../oracle/movie-history-grace.mjs';
const o='https://141-145-215-202.nip.io';
const date=new Date('2026-11-07T06:00:00Z');
test('bounded stale grace applies only to historical Films Monde monthly and annual catalogs',()=>{
  for(const path of [
    '/movies/catalog/movie/movies-fr-all-all-2026-10.json',
    '/movies/collections-only/catalog/movie/movies-fr-vod-35-2026-08.json',
    '/movies/native-bridge/catalog/movie/movies-fr-cinema-28-annual-2025.json'
  ])assert.equal(grace(o+path,date),180000,path);
  for(const path of [
    '/movies/catalog/movie/movies-fr-all-all-2026-11.json',
    '/movies/catalog/movie/movies-fr-all-all-today.json',
    '/movies/catalog/movie/movies-fr-all-all-yesterday.json',
    '/movies/catalog/movie/movies-fr-all-all-annual-2026.json',
    '/movies/catalog/movie/movies-fr-all-all-2026-12.json',
    '/movies/catalog/movie/movies-fr-all-all-all.json',
    '/movies/meta/movie/tt456.json',
    '/movies/artwork/genre/all.webp',
    '/design-meta/art/movie/tt1/landscape.svg',
    '/series-v2/catalog/series/movies-fr-all-all-2026-10.json'
  ])assert.equal(grace(o+path,date),0,path);
});
test('Europe/Brussels month boundary and DST remain safe',()=>{
  const u=o+'/movies/catalog/movie/movies-fr-all-28-2026-10.json';
  assert.equal(grace(u,new Date('2026-10-31T22:59:00Z')),0);
  assert.equal(grace(u,new Date('2026-10-31T23:01:00Z')),180000);
});

test('historical TTL tracks the authoritative archive cache and leaves live dates alone',async()=>{
  const {edgeTtl}=await import('../runtime/router.mjs');
  const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit'}).format(new Date());
  const historical=Number(month.slice(0,4))-2;
  assert.equal(edgeTtl(o+'/movies/catalog/movie/movies-fr-all-all-annual-'+historical+'.json'),900);
  assert.equal(edgeTtl(o+'/movies/catalog/movie/movies-fr-all-all-'+month+'.json'),300);
  assert.equal(edgeTtl(o+'/movies/catalog/movie/movies-fr-all-all-today.json'),60);
  assert.equal(edgeTtl(o+'/movies/artwork/genre/all.webp?v=abc'),604800);
});
