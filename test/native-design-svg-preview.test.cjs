'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAddon } = require('../runtime/native-design-meta-addon.cjs');
const { renderSvg, remoteImage, validImage } = require('../runtime/native-design-svg.cjs');

function response() {
  return {
    headers: {}, statusCode: 200, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
}

function fakeImageResponse(url) {
  const mime = url.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return {
    ok: true,
    headers: { get: (name) => ({
      'content-type': mime, 'content-length': '12'
    })[name.toLowerCase()] || null },
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer
  };
}

function movie() {
  return {
    id: 456, title: 'LE FILM & SON HISTOIRE', backdrop_path: '/landscape.jpg',
    images: { logos: [{ file_path: '/logo.png', width: 450, height: 120, iso_639_1: 'fr' }] },
    vote_average: 8.2, genres: [{ name: 'Action' }, { name: 'Science-fiction' }],
    release_date: '2026-01-15', original_language: 'fr',
    'watch/providers': { results: { FR: { flatrate: [{ provider_name: 'Netflix' }] } } }
  };
}

test('vector preview serves full 16:9 artwork, badges and metadata, without a generated JPEG', async () => {
  let imageCalls = 0;
  const addon = createAddon({
    tmdb: async (path) => {
      assert.equal(path, '/movie/456');
      return movie();
    },
    imageFetcher: async (url) => {
      imageCalls++;
      assert.ok(validImage(url));
      return fakeImageResponse(url);
    }
  });
  const req = {url: '/design-meta/preview/movie/tmdb%3Amovie%3A456.svg'};
  const first = response();
  await addon.handle(req, first, 'https://example.test');
  assert.equal(first.statusCode, 200);
  assert.match(first.headers['content-type'], /image\/svg\+xml/);
  assert.match(first.body, /viewBox="0 0 1600 900"/);
  assert.match(first.body, /NETFLIX/);
  assert.match(first.body, /★ TMDB 8\.2\/10/);
  assert.match(first.body, /15\/01\/2026/);
  assert.match(first.body, /Science-fiction/);
  assert.match(first.body, /image\/jpeg;base64/);
  assert.match(first.body, /image\/png;base64/);
  assert.doesNotMatch(first.body, /<script\b/);
  const next = response();
  await addon.handle(req, next, 'https://example.test');
  assert.equal(next.statusCode, 200);
  assert.equal(imageCalls, 2, 'vector assets must be cached across requests');
});

test('Shield SVG enlarges key text and shows confirmed TV season, episode and broadcast date', async () => {
  const { latestAiredEpisode } = require('../runtime/native-design-meta-addon.cjs');
  const data = {
    last_episode_to_air: { season_number: 4, episode_number: 5, air_date: '2026-10-14' }
  };
  assert.deepEqual(latestAiredEpisode(data,'2026-11-02'),
    { season: 4, episode: 5, date: '2026-10-14' });
  assert.equal(latestAiredEpisode({
    last_episode_to_air: { season_number: 4, episode_number: 6, air_date: '2026-12-01' }
  },'2026-11-02'),null, 'future airings must never be presented as already released');
  const art = {
    genres: ['Drame'], platforms: ['Netflix'], firstRelease:'2024-01-01',
    tmdbScore:7.5, seasonCount:4,
    latestEpisode:latestAiredEpisode(data,'2026-11-02')
  };
  const svg = renderSvg({type:'series',name:'Exemple de série'},art,'data:image/png;base64,AA==');
  assert.match(svg,/DERNIER ÉPISODE  •  S04 E05/);
  assert.match(svg,/DIFFUSION : 14\/10\/2026/);
  assert.match(svg,/font-size="67"/);
  assert.match(svg,/font-size="60"/);
  const movieSvg = renderSvg({type:'movie',name:'Exemple de film'},art,'data:image/png;base64,AA==');
  assert.doesNotMatch(movieSvg,/DERNIER ÉPISODE/);
  assert.match(movieSvg,/SORTIE : 01\/01\/2024/);
});

test('v4 uses bigger text for films and series with correct episode date', () => {
  const art={firstRelease:'2024-01-01',tmdbScore:7.5,seasonCount:4,genres:['Drame'],latestEpisode:{season:4,episode:5,date:'2026-10-14'}};
  const bg='data:image/png;base64,AA==';
  const old=renderSvg({type:'movie',name:'Exemple de film'},art,bg);
  const film=renderSvg({type:'movie',name:'Exemple de film'},art,bg,null,{large:true});
  const tv=renderSvg({type:'series',name:'Exemple de série'},art,bg,null,{large:true});
  assert.ok(old.includes('font-size="60"'));
  assert.ok(film.includes('font-size="69"'));
  assert.ok(film.includes('font-size="65"'));
  assert.ok(tv.includes('font-size="77"'));
  assert.ok(tv.includes('S04 E05'));
  assert.ok(tv.includes('14/10/2026'));
  assert.ok(!film.includes('DERNIER ÉPISODE'));
  assert.notEqual(old,film);
});

test('film-only V4 detail boost keeps movie logos and series SVG unchanged', async () => {
  const art={firstRelease:'2024-01-01',tmdbScore:7.5,seasonCount:4,
    genres:['Science-fiction','Aventure','Fantastique'],
    latestEpisode:{season:4,episode:5,date:'2026-10-14'}};
  const bg='data:image/png;base64,AA==',logo='data:image/png;base64,AQ==';
  const film={type:'movie',name:'Exemple de film'};
  const series={type:'series',name:'Exemple de série'};
  const v4=renderSvg(film,art,bg,logo,{large:true});
  const boosted=renderSvg(film,art,bg,logo,{large:true,filmDetails:true});
  assert.ok(v4.includes('font-size="69"'));
  assert.ok(v4.includes('font-size="64"'));
  assert.ok(v4.includes('font-size="65"'));
  assert.ok(boosted.includes('font-size="80"'));
  assert.ok(boosted.includes('font-size="75"'));
  assert.ok(boosted.includes('font-size="77"'));
  assert.ok(boosted.includes('SORTIE : 01/01/2024'));
  assert.ok(boosted.includes('★ TMDB 7.5/10'));
  assert.equal(v4.match(/<image x="72"[^>]+/)[0],
    boosted.match(/<image x="72"[^>]+/)[0], 'logo unchanged');
  assert.equal(renderSvg(series,art,bg,logo,{large:true}),
    renderSvg(series,art,bg,logo,{large:true,filmDetails:true}),
    'series V4 SVG remains byte-for-byte identical');
  const addon=createAddon({
    tmdb:async(route)=>route.startsWith('/tv/')?
      {...movie(),name:'Exemple de série',first_air_date:'2024-01-01',number_of_seasons:4}:
      movie(),
    imageFetcher:fakeImageResponse
  });
  const result=response();
  await addon.handle({url:'/design-meta/art/movie/tmdb%3Amovie%3A456/landscape.svg?v=oracle-vector-v4-film-details'},result,'https://example.test');
  assert.equal(result.statusCode,200);
  assert.ok(result.body.includes('font-size="80"'));
  const tv=response();
  await addon.handle({url:'/design-meta/art/series/tmdb%3Atv%3A456/landscape.svg?v=oracle-vector-v4-film-details'},tv,'https://example.test');
  assert.equal(tv.statusCode,200);
  assert.ok(tv.body.includes('font-size="69"'));
  assert.ok(!tv.body.includes('font-size="80"'));
});

test('multiple services must not be mislabeled as one platform', async () => {
  const addon = createAddon({
    tmdb: async () => {
      const item = movie();
      item['watch/providers'].results.FR.flatrate.push({provider_name: 'Prime Video'});
      return item;
    },
    imageFetcher: async url => fakeImageResponse(url)
  });
  const res = response();
  await addon.handle({url:'/design-meta/preview/movie/tmdb%3Amovie%3A456.svg'},res,'https://example.test');
  assert.equal(res.statusCode,200);
  assert.doesNotMatch(res.body, />NETFLIX</);
  assert.doesNotMatch(res.body, />PRIME VIDEO</);
});

test('SVG rendering escapes hostile metadata and rejects non-TMDB image hosts', async () => {
  assert.equal(validImage('https://bad.example/img.jpg'),false);
  await assert.rejects(() => remoteImage('http://image.tmdb.org/t/p/w500/hi.jpg'),/Invalid TMDB image URL/);
  const art = {platforms:['Test & <site>'],genres:['Action <script>'],firstRelease:'2020-03-05',tmdbScore:7};
  const out = renderSvg({type:'movie',name:'<script>bad</script>'},art,'data:image/png;base64,AA==');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /Test &amp; &lt;site&gt;/i);
});

test('native metadata remains the default; experimental SVG is opt-in and cannot override third-party catalogs', async () => {
  const addon = createAddon({
    tmdb: async () => movie(),
    imageFetcher: async () => { throw Error('No network expected'); }
  });
  const status = response();
  await addon.handle({url:'/design-meta/status.json'},status,'https://example.test');
  const info = JSON.parse(status.body);
  assert.equal(info.svgEnabledForMetadata,false);
  assert.equal(info.catalogs,0);
  const json = response();
  await addon.handle({url:'/design-meta/meta/movie/tmdb%3Amovie%3A456.json'},json,'https://example.test');
  const meta = JSON.parse(json.body).meta;
  assert.ok(meta.poster.startsWith('https://image.tmdb.org/'));
  assert.ok(!meta.poster.endsWith('.svg'));
});


test('an optional installable vector manifest produces SVG poster URLs, while native one stays unchanged', async () => {
  const addon = createAddon({ tmdb: async () => movie() });
  const manifestResponse = response();
  await addon.handle({url:'/design-meta/vector/manifest.json'}, manifestResponse,'https://example.test');
  const manifest = JSON.parse(manifestResponse.body);
  assert.deepEqual(manifest.catalogs,[]);
  assert.equal(manifest.resources[0].name,'meta');
  assert.match(manifest.id,/vector\.preview$/);
  const vector = response();
  await addon.handle({url:'/design-meta/vector/meta/movie/tmdb%3Amovie%3A456.json'}, vector, 'https://example.test');
  const vectorMeta = JSON.parse(vector.body).meta;
  assert.equal(vector.statusCode,200);
  assert.equal(vectorMeta.posterShape,'landscape');
  assert.equal(vectorMeta.poster,'https://example.test/design-meta/preview/movie/tmdb%3Amovie%3A456.svg');
  assert.equal(vectorMeta.landscapePoster, vectorMeta.poster);
  assert.equal(vectorMeta.background, vectorMeta.poster, 'Nuvio metadata enrichment reads background, not poster');
  const native = response();
  await addon.handle({url:'/design-meta/meta/movie/tmdb%3Amovie%3A456.json'}, native,'https://example.test');
  const nativeMeta = JSON.parse(native.body).meta;
  assert.equal(nativeMeta.poster,'https://image.tmdb.org/t/p/w780/landscape.jpg');
});


test('old v2 URL retains its original design while v3 uses large-screen typography', async () => {
  const addon = createAddon({
    tmdb: async () => movie(),
    imageFetcher: async url => fakeImageResponse(url)
  });
  const legacy=response(), improved=response();
  await addon.handle({url:'/design-meta/art/movie/tmdb%3Amovie%3A456/landscape.svg?v=oracle-vector-v2'},legacy,'https://example.test');
  await addon.handle({url:'/design-meta/art/movie/tmdb%3Amovie%3A456/landscape.svg?v=oracle-vector-v3'},improved,'https://example.test');
  assert.equal(legacy.statusCode,200);
  assert.equal(improved.statusCode,200);
  assert.match(legacy.body,/font-size="44"/,'original v2 text size stays unchanged');
  assert.match(improved.body,/font-size="60"/,'v3 text is enlarged for television');
  assert.notEqual(legacy.body,improved.body);
});

test('one global vector poster URL pattern renders art for any catalog source ID', async () => {
  const { vectorPosterPattern } = require('../runtime/native-design-meta-addon.cjs');
  assert.equal(vectorPosterPattern('https://example.test'),
    'https://example.test/design-meta/art/{type}/{id}/{shape}.svg?v=oracle-vector-v4-film-details');
  let lookupCalls = 0;
  const addon = createAddon({
    tmdb: async (route) => {
      lookupCalls++;
      if (route === '/find/tt1234567') return {movie_results:[{id:456}]};
      if (route === '/movie/456') return movie();
      throw Error('Unexpected TMDB route: ' + route);
    },
    imageFetcher: async url => fakeImageResponse(url)
  });
  const status = response();
  await addon.handle({url:'/design-meta/status.json'},status,'https://example.test');
  assert.equal(JSON.parse(status.body).vectorPosterPattern,
    vectorPosterPattern('https://example.test'));

  // Simulates the Nuvio CustomPosterUrlResolver replacements on a third-party catalog card.
  const svg = response();
  await addon.handle({url:'/design-meta/art/movie/tt1234567/landscape.svg'},svg,'https://example.test');
  assert.equal(svg.statusCode,200);
  assert.match(svg.headers['content-type'],/image\/svg\+xml/);
  assert.match(svg.body,/viewBox="0 0 1600 900"/);
  assert.match(svg.body,/NETFLIX/);
  assert.equal(lookupCalls,2,'the artwork comes from TMDB independently of any catalog provider');

  const portrait = response();
  await addon.handle({url:'/design-meta/art/movie/tt1234567/poster.svg'},portrait,'https://example.test');
  assert.equal(portrait.statusCode,404,'portrait should fall back to its original art');
  assert.equal(lookupCalls,2,'non-landscape requests should not trigger an upstream fetch');
});
test('global art rejects unsupported IDs and never fetches untrusted artwork URLs', async () => {
  const addon=createAddon({
    tmdb: async () => { throw Error('TMDB not expected'); },
    imageFetcher: async () => { throw Error('image fetch not expected'); }
  });
  const res=response();
  await addon.handle({url:'/design-meta/art/movie/tvdb%3A123/landscape.svg'},res,'https://example.test');
  assert.equal(res.statusCode,400);
  const invalid=response();
  await addon.handle({url:'/design-meta/art/movie/https%3A%2F%2Fevil.example/landscape.svg'},invalid,'https://example.test');
  assert.equal(invalid.statusCode,400);
});

test('Oracle routing caches artwork 15 minutes while status is always fresh', async () => {
  const { edgeTtl } = await import('../runtime/router.mjs');
  assert.equal(edgeTtl('https://oracle.test/design-meta/art/movie/tt1234567/landscape.svg?v=oracle-vector-v3'), 900);
  assert.equal(edgeTtl('https://oracle.test/design-meta/preview/series/tmdb%3Atv%3A123.svg'), 900);
  assert.equal(edgeTtl('https://oracle.test/design-meta/status.json'), 0);
  assert.equal(edgeTtl('https://oracle.test/design-meta/vector/manifest.json'), 300);
});
