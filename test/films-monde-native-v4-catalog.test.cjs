'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { decorateMovieMetas,withoutFilmTitleLogo }=require('../regions/movies/src/presentation.cjs');
const { nativeBridgePayload }=require('../runtime/native-bridge.cjs');
const ORIGIN='https://nuvio.example/movies';
const P='https://image.tmdb.org/t/p/w500/portrait.jpg';
const B='https://image.tmdb.org/t/p/w1280/landscape.jpg';

test('Films Monde canonical catalog itself serves only original TMDB images, no legacy JPEG renderers',()=>{
  const meta={
    id:'tt1234567',type:'movie',name:'Film international',
    poster:P,background:B,posterShape:'poster',logo:'https://image.tmdb.org/t/p/original/logo.png',
    releaseInfo:'2026',released:'2026-11-02T00:00:00.000Z',
    originalReleaseDate:'2026-10-31',streamingProviders:['Netflix'],
    providersByKind:{streaming:['Netflix'],vod:[]},genres:['Action'],
    description:'Vérifiée',links:[{url:'https://www.themoviedb.org/movie/123',name:'TMDB'}]
  };
  const originals=JSON.stringify(meta);
  const result=decorateMovieMetas(ORIGIN,[meta],{view:'all',period:'2026-11'})[0];
  assert.equal(result.poster,'https://image.tmdb.org/t/p/w780/landscape.jpg');
  assert.equal(result.background,B);
  assert.equal(result.landscapePoster,result.poster);
  assert.equal(result.banner,result.poster);
  assert.equal(result._rawPosterUrl,P);
  assert.equal(result.posterShape,'landscape');
  assert.match(result.logo,/\/fr\/calendar-transparent-logo\.svg/);
  for(const field of ['id','name','releaseInfo','released','originalReleaseDate','description','links','genres','providersByKind','streamingProviders'])
    assert.deepEqual(result[field],meta[field],field+' preserved');
  assert.doesNotMatch(JSON.stringify(result),/calendar-card|desktop-content-card|generated-covers|\.jpg\?/);
  assert.equal(JSON.stringify(meta),originals,'source not mutated');
  const bridged=nativeBridgePayload({metas:[result]},'https://nuvio.example',{landscapeCatalog:true}).metas[0];
  assert.equal(bridged.poster,result.poster);
  assert.deepEqual(bridged.streamingProviders,result.streamingProviders);
});

test('Films Monde works without a TMDB landscape and never invents a converted poster',()=>{
  const portraitOnly=decorateMovieMetas(ORIGIN,[{
    id:'tmdb:movie:123',type:'movie',name:'Portrait seulement',poster:P,background:P,
    released:'2025-08-17T00:00:00.000Z'
  }],{view:'all',period:'2025-08'})[0];
  assert.equal(portraitOnly.poster,P);
  assert.equal(portraitOnly.posterShape,'poster');
  assert.equal(portraitOnly.background,P);
  assert.equal(portraitOnly.landscapePoster,P);
  const missing=decorateMovieMetas(ORIGIN,[{
    id:'tmdb:movie:124',type:'movie',name:'Sans image',poster:'https://unsafe.invalid/j.jpg',
    background:'https://unsafe.invalid/b.jpg',released:'2025-08-17T00:00:00.000Z'
  }],{view:'all',period:'2025-08'})[0];
  assert.ok(!missing.poster);
  assert.ok(!missing.background);
  assert.ok(!missing.banner);
  assert.equal(missing.name,'Sans image');
  assert.equal(missing.released,'2025-08-17T00:00:00.000Z');
});

test('film detail metadata remains original and drops native duplicate logo',()=>{
  const meta={name:'Film',poster:P,background:B,logo:'https://image.tmdb.org/t/p/w500/logo.png'};
  const detail=withoutFilmTitleLogo(meta);
  assert.equal(detail.poster,P);
  assert.equal(detail.background,B);
  assert.ok(!Object.hasOwn(detail,'logo'));
});

test('Films Monde bypasses old original.jpg Sharp relay even with V4 env flag disabled',async()=>{
  const { relayOriginalImages } = await import('../runtime/original-images.mjs');
  const env=process.env.NUVIO_V4_NATIVE_ART;
  try {
    process.env.NUVIO_V4_NATIVE_ART='0'; // reproduce the Oracle stale configuration
    const payload={metas:[{id:'tt1234567',poster:P,background:B}]};
    const request=new Request('https://nuvio.example/movies/catalog/movie/movies-fr-all-all-all.json');
    const original=new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
    const response=await relayOriginalImages(request,original);
    assert.equal(response,original,'no JSON rewrite, no /images/original.jpg conversion');
    assert.deepEqual(await response.json(),payload);
  } finally {
    if(env===undefined) delete process.env.NUVIO_V4_NATIVE_ART;
    else process.env.NUVIO_V4_NATIVE_ART=env;
  }
});

test('Films Monde cannot dynamically generate JPEGs even from obsolete installed links',async()=>{
  const movies=require('../regions/movies/index.cjs');
  const invoke=(uri)=>new Promise((resolve,reject)=>{
    const req={url:uri,headers:{host:'nuvio.example','x-forwarded-proto':'https'}};
    const headers={};
    const res={
      statusCode:200,setHeader(k,v){headers[k.toLowerCase()]=v;},
      end(body){resolve({status:this.statusCode,headers,body:body||''});}
    };
    Promise.resolve(movies(req,res)).catch(reject);
  });
  const legacy=await invoke('/content-card.jpg?title=old-film');
  assert.equal(legacy.status,410);
  assert.equal(legacy.headers['cache-control'],'no-store');
  const parent=await invoke('/cover.jpg?title=old-film');
  assert.equal(parent.status,302);
  assert.match(parent.headers.location,/\/movies\/artwork\/genre\/all\.webp\?/);
  assert.equal(parent.headers['cache-control'],'no-store');
  const backdrop=await invoke('/backdrop.jpg?title=old-film');
  assert.equal(backdrop.status,302);
  assert.match(backdrop.headers.location,/\.webp\?/);
  assert.ok(!Object.hasOwn(require('../regions/movies/src/artwork.cjs'),'fallbackCard'),
    'Sharp/JPEG fallback must be deleted from Films Monde');
});
