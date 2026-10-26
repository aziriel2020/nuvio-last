import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import handler from '../api/index.js';
const require = createRequire(import.meta.url);
const approved = require('../regions/fr/api/editorial-art.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function call(route) {
  return new Promise((resolve, reject) => {
    const state = { status:200, headers:{} }, chunks = [];
    const req = {method:'GET',url:route,headers:{host:'editorial-audit.invalid','x-forwarded-proto':'https'}};
    const res = { get statusCode(){return state.status;},set statusCode(n){state.status=n;},
      setHeader(k,v){state.headers[String(k).toLowerCase()]=v;},getHeader(k){return state.headers[String(k).toLowerCase()];},
      end(data=''){if(data)chunks.push(Buffer.isBuffer(data)?data:Buffer.from(data));resolve({...state,body:Buffer.concat(chunks)});} };
    Promise.resolve(handler(req,res)).catch(reject);
  });
}

export async function auditEditorial(variant) {
  assert(['cover','backdrop'].includes(variant));
  const manifest = approved.manifest;
  assert.equal(manifest.approved,true);
  assert.equal(manifest.revision,'editorial-night-b-20261026-v1');
  assert.equal(manifest.renderer,'precomposed-jpeg-direct');
  assert.equal(Object.keys(manifest.images).length,7);
  const output=path.join(root,'editorial-cover-audit');await mkdir(output,{recursive:true});
  const checks=[],tiles=[],seen=new Set(),width=variant==='cover'?1600:1920,height=variant==='cover'?900:1080;
  for(const [i,[key,item]] of Object.entries(manifest.images).entries()) {
    const expected=item[variant];
    const route=key==='binge-watch'?`/fr/binge-watch-${variant}.jpg?v=${manifest.revision}`
      :`/fr/editorial-${variant}.jpg?key=${key}&v=${manifest.revision}`;
    const first=await call(route),source=await readFile(path.join(approved.root,expected.file));
    assert.equal(first.status,200,key);assert.equal(first.headers['content-type'],'image/jpeg',key);
    const hash=createHash('sha256').update(first.body).digest('hex');
    assert.equal(hash,expected.sha256,key+' approved output checksum');
    assert.equal(source.length,expected.bytes,key+' source length');assert(first.body.equals(source),key+' output was altered');
    const header=key==='binge-watch'?'x-nuvio-binge-watch-source-sha256':'x-nuvio-editorial-source-sha256';
    assert.equal(first.headers[header],hash,key+' source identity');
    assert(!seen.has(hash),key+' duplicate image');seen.add(hash);
    const meta=await sharp(first.body).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.width,width);assert.equal(meta.height,height);
    const warm=await call(route);assert(first.body.equals(warm.body),key+' cache changed bytes');
    assert.equal(warm.headers[key==='binge-watch'?'x-nuvio-binge-watch-render':'x-nuvio-editorial-render'],'memory');
    const filename=(variant==='cover'?'':'backdrop-')+key+'.jpg';await writeFile(path.join(output,filename),first.body);
    tiles.push({input:await sharp(first.body).resize(600,338,{fit:'contain',background:'#050609'}).jpeg({quality:90}).toBuffer(),left:20+(i%3)*620,top:20+Math.floor(i/3)*358});
    checks.push({key,route,file:filename,width,height,bytes:first.body.length,sha256:hash,warmCache:true,exactApprovedOutput:true});
  }
  assert.equal((await call('/fr/editorial-'+variant+'.jpg?key=unknown')).status,404);
  const sheet=await sharp({create:{width:1880,height:1094,channels:3,background:'#080b12'}}).composite(tiles).jpeg({quality:92}).toBuffer();
  await writeFile(path.join(output,variant==='cover'?'contact-sheet.jpg':'backdrops-contact-sheet.jpg'),sheet);
  const result={revision:manifest.revision,variant,checked:checks.length,consumers:['Shield','Desktop'],checks};
  await writeFile(path.join(output,variant==='cover'?'manifest.json':'backdrops-manifest.json'),JSON.stringify(result,null,2)+'\n');
  console.log(`PASS: seven approved ${variant}s, native ${width}x${height} JPEGs, exact hashes, unique files and deterministic cache.`);
  return result;
}
