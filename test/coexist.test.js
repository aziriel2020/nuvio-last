'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index');
const sharp = require('sharp');

function call(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: path, headers: { host: 'coexist.example', 'x-forwarded-proto': 'https', 'x-vercel-ip-timezone': 'Europe/Brussels', ...headers } };
    const out = { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
    const chunks = [];
    const res = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return out.headers[String(k).toLowerCase()]; },
      end(v = '') { if (v) chunks.push(Buffer.isBuffer(v) ? v : Buffer.from(String(v))); out.body = Buffer.concat(chunks); out.text = out.body.toString('utf8'); resolve(out); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const VERCEL_CDN_MAX_CACHEABLE_BYTES = 10 * 1024 * 1024;

function assertCdnCache(response, sMaxAge) {
  const cacheControl = String(response.headers['cache-control'] || '');
  assert(cacheControl.includes('public'), cacheControl);
  assert(cacheControl.includes(`s-maxage=${sMaxAge}`), cacheControl);
  assert(
    response.body.length < VERCEL_CDN_MAX_CACHEABLE_BYTES,
    `response is ${response.body.length} bytes and exceeds Vercel's 10 MB CDN cacheable-response limit`
  );
}


test('single deployment exposes four distinct addon manifests', async () => {
  const usResponse = await call('/us/manifest.json');
  const frResponse = await call('/fr/manifest.json');
  const globalResponse = await call('/global/manifest.json');
  const trResponse = await call('/tr/manifest.json');
  for (const response of [usResponse, frResponse, globalResponse, trResponse]) {
    assertCdnCache(response, 86400);
  }
  const us = JSON.parse(usResponse.text);
  const fr = JSON.parse(frResponse.text);
  const globalVod = JSON.parse(globalResponse.text);
  const tr = JSON.parse(trResponse.text);
  assert.equal(us.id, 'com.nuvio.calendar.archives.us.coexist');
  assert.equal(fr.id, 'com.nuvio.calendar.archives.fr.coexist');
  assert.equal(globalVod.id, 'com.nuvio.calendar.archives.global.coexist');
  assert.equal(tr.id, 'com.nuvio.calendar.archives.tr.coexist');
  assert.equal(new Set([us.id, fr.id, globalVod.id, tr.id]).size, 4);
  assert.equal(us.catalogs.length, 10638);
  assert.equal(fr.catalogs.length, 12242 + 19 * (133 - 197));
  assert.equal(globalVod.catalogs.length, 591);
  assert.equal(tr.catalogs.length, 6895);
});

test('combined live import fails closed without Cinema availability and keeps regional ordering', async () => {
  const response = await call('/nuvio-collections-fr-global-tr-usa.json');
  assert.equal(response.statusCode, 200);
  const combined = JSON.parse(response.text);
  const filmGenres = combined.find((collection) => collection.id === 'calendar-archives-fr-genres');
  assert(filmGenres && filmGenres.folders.length === 19, 'combined import must include all film genres');
  for (const folder of filmGenres.folders) {
    assert.equal(folder.sources.length, 133, 'Combined Shield must show 2026 to 1900 with no future-year rows');
    assert.deepEqual(folder.sources.slice(0, 5).map(src=>src.genre),
      ['Aujourd’hui','Demain','Hier','Semaine passée','Depuis toujours']);
    assert.equal(folder.sources[5].genre, '2026');
    assert(!folder.sources.some((src)=>src.catalogId.includes('-nextweek') || /-year-202[7-9]|-year-2030/.test(src.catalogId)));
    assert(folder.sources.every((src)=>src.genre && src.genre !== 'Films'));
    assert(folder.catalogSources.every((src,i)=>src.genre===folder.sources[i].genre));
    assert(folder.sources.some((src) => src.catalogId.endsWith('-year-1900')));
    assert(folder.sources.some((src) => src.catalogId.endsWith('-year-2014')));
    assert(folder.sources.some((src) => src.catalogId.endsWith('-alltime')));
    assert(folder.sources.length < 200);
  }
  assertCdnCache(response, 300);
  const collections = JSON.parse(response.text);
  assert.equal(collections.length, 50);
  const ids = collections.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(collections.some((c) => c.id === 'cinema-now-torrentio'), false);
  assert.equal(collections.filter((c) => c.title.startsWith('🇫🇷 ')).length, 17);
  assert.equal(collections.filter((c) => c.title.startsWith('🌍 ')).length, 2);
  assert.equal(collections.filter((c) => c.title.startsWith('🇹🇷 ')).length, 19);
  assert.equal(collections.filter((c) => c.title.startsWith('🇺🇸 ')).length, 12);
  assert.equal(collections[0].title, '🇫🇷 Tendances & Cinéma');
  assert.equal(collections[1].title, '🇫🇷 Netflix');
  assert.equal(collections[14].title, '🇫🇷 VOD France');
  assert.equal(collections[15].title, '🇫🇷 Genres · Films');
  assert.equal(collections[16].title, '🇫🇷 Genres · Séries');
  assert.equal(collections[17].title, '🌍 Anime Japon + Corée');
  assert.equal(collections[18].title, '🌍 VOD Mondiale');
  assert.equal(collections[19].title, '🇹🇷 Netflix');
  assert.equal(collections[37].title, '🇹🇷 VOD Türkiye');
  assert.equal(collections[38].title, '🇺🇸 Netflix');
  assert.equal(collections.at(-2).title, '🇺🇸 Genres · Films');
  assert.equal(collections.at(-1).title, '🇺🇸 Genres · Séries');
});

test('Editorial collection keeps period catalogs inside seven folders with Shield/Desktop covers', async () => {
  const shield = JSON.parse((await call('/nuvio-collections-shield.json')).text);
  const editorial = shield.find((c) => c.id === 'calendar-archives-fr-editorial-now');
  assert(editorial);
  assert.equal(editorial.title, '🇫🇷 Tendances & Cinéma');
  assert.deepEqual(editorial.folders.map((f) => f.title), [
    '⭐ Séries les mieux notées',
    '🔥 Séries les plus trendy',
    '🆕 Nouvelles séries',
    '🔁 Séries renouvelées',
    '🎬 Nouveaux films',
    '🍿 Binge Watch · Séries',
    '🎬 Films au cinéma actuellement'
  ]);
  assert.deepEqual(editorial.folders[0].sources.map((x) => x.catalogId), [
    'editorial-series-top-rated-yesterday',
    'editorial-series-top-rated-lastweek',
    'editorial-series-top-rated-lastmonth'
  ]);
  const manifest = JSON.parse((await call('/fr/manifest.json')).text);
  const titles = new Map(manifest.catalogs.map((c) => [c.id, c.name]));
  for (const folder of editorial.folders) for (const source of folder.sources) {
    assert.notEqual(titles.get(source.catalogId), 'Séries', 'generic series heading leaked');
    assert.notEqual(titles.get(source.catalogId), 'Films', 'generic films heading leaked');
    assert.equal(titles.get(source.catalogId), source.genre, 'editorial period heading must match its Nuvio row');
  }
  assert.deepEqual(editorial.folders[1].sources.map((x) => x.catalogId), [
    'editorial-series-trendy-yesterday',
    'editorial-series-trendy-lastweek',
    'editorial-series-trendy-lastmonth'
  ]);
  assert.deepEqual(editorial.folders[2].sources.map((x) => x.catalogId), [
    'editorial-series-new-thisweek','editorial-series-new-thismonth'
  ]);
  assert.deepEqual(editorial.folders[3].sources.map((x) => x.catalogId), [
    'editorial-series-returning-thisweek','editorial-series-returning-thismonth'
  ]);
  assert.deepEqual(editorial.folders[4].sources.map((x) => x.catalogId), [
    'editorial-movies-new-thisweek','editorial-movies-new-thismonth'
  ]);
  assert.deepEqual(editorial.folders[5].sources.map((x) => x.catalogId), [
    'editorial-binge-watch-series-thisweek',
    'editorial-binge-watch-series-lastweek',
    'editorial-binge-watch-series-thismonth',
    'editorial-binge-watch-series-lastmonth',
    'editorial-binge-watch-series-thisyear'
  ]);
  assert.deepEqual(editorial.folders[5].sources.map((x) => x.genre), [
    'Cette semaine','Semaine passée','Ce mois-ci','Le mois dernier','Cette année'
  ]);
  assert.deepEqual(editorial.folders[6].sources.map((x) => x.catalogId), [
    'editorial-movies-cinema-now'
  ]);
  assert.deepEqual(editorial.folders[2].sources.map((x) => x.genre), ['Cette semaine','Ce mois']);
  assert.deepEqual(editorial.folders[3].sources.map((x) => x.genre), ['Cette semaine','Ce mois']);
  assert.deepEqual(editorial.folders[4].sources.map((x) => x.genre), ['Cette semaine','Ce mois']);
  assert.match(editorial.folders[0].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-top-rated/);
  assert.match(editorial.folders[1].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-trendy/);
  assert.match(editorial.folders[2].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-new/);
  assert.match(editorial.folders[3].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-returning/);
  assert.match(editorial.folders[4].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=movies-new/);
  assert.match(editorial.folders[5].coverImageUrl, /\/fr\/binge-watch-cover\.jpg\?/);
  assert.match(editorial.folders[6].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=cinema-now/);

  const desktop = JSON.parse((await call('/nuvio-collections-desktop.json')).text);
  const desktopEditorial = desktop.find((c) => c.id === 'calendar-archives-fr-editorial-now');
  assert(desktopEditorial);
  assert.match(desktopEditorial.folders[0].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-top-rated/);
  assert.match(desktopEditorial.folders[1].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-trendy/);
  assert.match(desktopEditorial.folders[2].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-new/);
  assert.match(desktopEditorial.folders[3].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=series-returning/);
  assert.match(desktopEditorial.folders[4].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=movies-new/);
  assert.match(desktopEditorial.folders[5].coverImageUrl, /\/fr\/binge-watch-cover\.jpg\?/);
  assert.match(desktopEditorial.folders[6].coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=cinema-now/);
  const keys = ['series-top-rated', 'series-trendy', 'series-new', 'series-returning', 'movies-new', null, 'cinema-now'];
  for (const collection of [editorial, desktopEditorial]) {
    assert.match(collection.backdropImageUrl, /editorial-backdrop\.jpg\?key=series-top-rated/);
    for (let i = 0; i < keys.length; i += 1) {
      const folder = collection.folders[i];
      if (keys[i]) {
        assert.match(folder.heroBackdropUrl,
          new RegExp('editorial-backdrop\\.jpg\\?key=' + keys[i] + '(?:&|$)'), folder.title);
      } else {
        assert.match(folder.heroBackdropUrl, /\/fr\/binge-watch-backdrop\.jpg\?/);
      }
      assert(!folder.heroBackdropUrl.includes('/genre-backdrop.jpg'), folder.title + ' still uses legacy genre art');
      assert(!folder.heroBackdropUrl.includes('/platform-backdrop.svg'), folder.title + ' still uses VOD art');
    }
  }
});

test('Binge Watch premium covers are actual JPGs, cached and correctly sized for Shield/Desktop', async () => {
  const routes = [
    ['/fr/binge-watch-cover.jpg?v=editorial-night-b-20261026-v1', 1600, 900, 'cover'],
    ['/fr/binge-watch-backdrop.jpg?v=editorial-night-b-20261026-v1', 1920, 1080, 'backdrop']
  ];
  for (const [route, width, height, variant] of routes) {
    const first = await call(route);
    assert.equal(first.statusCode, 200, route);
    assert(String(first.headers['content-type']).includes('image/jpeg'), route);
    assert.equal(first.headers['x-nuvio-binge-watch-art'], variant);
    const original = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../assets/collection-art/editorial-night-b-20261026/binge-watch-' + variant + '.jpg')
    );
    assert.equal(first.headers['x-nuvio-binge-watch-source-sha256'],
      require('node:crypto').createHash('sha256').update(original).digest('hex'),
      variant + ' must render the approved photographic source');
    const metadata = await sharp(first.body).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, width, variant);
    assert.equal(metadata.height, height, variant);
    assert(first.body.length > 70000, 'Empty or over-compressed Binge Watch visual');
    const warmed = await call(route);
    assert.equal(warmed.headers['x-nuvio-binge-watch-render'], 'memory');
    assert.deepEqual(first.body, warmed.body);
  }
});

test('Editorial backdrops are unique, clean 1920x1080 JPEGs and cached', async () => {
  const keys = ['series-top-rated', 'series-trendy', 'series-new', 'series-returning', 'movies-new', 'cinema-now'];
  const sources = new Set();
  const heroes = new Set();
  for (const key of keys) {
    const route = '/fr/editorial-backdrop.jpg?key=' + key + '&v=editorial-night-b-20261026-v1';
    const [first, concurrent] = await Promise.all([call(route), call(route)]);
    assert.equal(first.statusCode, 200, key);
    assert.equal(first.headers['content-type'], 'image/jpeg', key);
    assert.equal(first.headers['x-nuvio-editorial-backdrop'], key, key);
    assert.equal(first.headers['x-nuvio-desktop-format'], '1920x1080', key);
    assert.match(first.headers['x-nuvio-editorial-source-sha256'], /^[a-f0-9]{64}$/, key);
    assert(!sources.has(first.headers['x-nuvio-editorial-source-sha256']), key + ' reused a cover source');
    sources.add(first.headers['x-nuvio-editorial-source-sha256']);
    const meta = await sharp(first.body).metadata();
    assert.equal(meta.width, 1920, key);
    assert.equal(meta.height, 1080, key);
    assert.equal(meta.format, 'jpeg', key);
    assert(first.body.length > 80000, key + ' empty backdrop');
    const heroDigest = require('node:crypto').createHash('sha256').update(first.body).digest('hex');
    assert(!heroes.has(heroDigest), key + ' duplicated backdrop');
    heroes.add(heroDigest);
    assert.deepEqual(first.body, concurrent.body, key + ' concurrent generation changed');
    const warm = await call(route);
    assert.equal(warm.headers['x-nuvio-editorial-render'], 'memory', key);
    assert.deepEqual(first.body, warm.body, key + ' cache instability');
  }
  assert.equal((await call('/fr/editorial-backdrop.jpg?key=unknown')).statusCode, 404);
});

test('static editorial Shield covers are real JPEG assets and stay untouched by Shield/Desktop transforms', async () => {
  const paths = [
    '/fr/editorial-cover.jpg?key=series-top-rated&v=editorial-night-b-20261026-v1',
    '/fr/editorial-cover.jpg?key=series-trendy&v=editorial-night-b-20261026-v1',
    '/fr/editorial-cover.jpg?key=series-new&v=editorial-night-b-20261026-v1',
    '/fr/editorial-cover.jpg?key=series-returning&v=editorial-night-b-20261026-v1',
    '/fr/editorial-cover.jpg?key=movies-new&v=editorial-night-b-20261026-v1',
    '/fr/editorial-cover.jpg?key=cinema-now&v=editorial-night-b-20261026-v1'
  ];
  const sourceDigests = new Set();
  for (const path of paths) {
    const response = await call(path);
    assert.equal(response.statusCode, 200, path);
    assert.match(response.headers['content-type'], /image\/jpeg/, path);
    assert.equal(response.body[0], 0xff, path);
    assert.equal(response.body[1], 0xd8, path);
    assert(response.body.length > 100000, path);
    assert.equal(response.headers['x-nuvio-editorial-style'], 'editorial-night-b-20261026-v1', path);
    const sourceDigest = response.headers['x-nuvio-editorial-source-sha256'];
    assert.match(sourceDigest, /^[a-f0-9]{64}$/, path + ' has no source fingerprint');
    const renderedDigest = require('node:crypto').createHash('sha256').update(response.body).digest('hex');
    assert.equal(renderedDigest, sourceDigest, path + ' must preserve the approved cover exactly');
    assert(!sourceDigests.has(sourceDigest), path + ' reuses another folder artwork');
    sourceDigests.add(sourceDigest);
    const metadata = await sharp(response.body).metadata();
    assert.equal(metadata.width, 1600, path);
    assert.equal(metadata.height, 900, path);
    const warmed = await call(path);
    assert.equal(warmed.statusCode, 200, path + ' warm cache status');
    assert.equal(warmed.headers['x-nuvio-editorial-cover'], new URL(path, 'https://localhost').searchParams.get('key'));
    assert.equal(warmed.headers['x-nuvio-editorial-render'], 'memory', path + ' was re-rendered');
    assert.deepEqual(warmed.body, response.body, path + ' rendered inconsistently');
  }

  const bad = await call('/fr/editorial-cover.jpg?key=does-not-exist');
  assert.equal(bad.statusCode, 404);

  const shield = JSON.parse((await call('/nuvio-collections-shield.json')).text)
    .find((c) => c.id === 'calendar-archives-fr-editorial-now');
  const desktop = JSON.parse((await call('/nuvio-collections-desktop.json')).text)
    .find((c) => c.id === 'calendar-archives-fr-editorial-now');
  for (const collection of [shield, desktop]) {
    assert(collection);
    assert.match(collection.folders[0].coverImageUrl, /editorial-cover\.jpg\?key=series-top-rated/);
    assert.match(collection.folders[1].coverImageUrl, /editorial-cover\.jpg\?key=series-trendy/);
    assert.match(collection.folders[2].coverImageUrl, /editorial-cover\.jpg\?key=series-new/);
    assert.match(collection.folders[3].coverImageUrl, /editorial-cover\.jpg\?key=series-returning/);
    assert.match(collection.folders[4].coverImageUrl, /editorial-cover\.jpg\?key=movies-new/);
    assert.match(collection.folders[6].coverImageUrl, /editorial-cover\.jpg\?key=cinema-now/);
    assert(collection.folders.every(f => f.coverImageUrl.includes('v=editorial-night-b-20261026-v1') && f.heroBackdropUrl.includes('v=editorial-night-b-20261026-v1')),
      'Shield/Desktop still reference the previous editorial artwork');
  }
});



test('the seven editorial hero titles remain visible with hidden Shield tile captions', async () => {
  const endpoints = [
    '/nuvio-collections-shield.json',
    '/nuvio-collections-desktop.json',
    '/nuvio-collections-fr-global-tr-usa.json'
  ];
  const ids = [
    'editorial-series-top-rated', 'editorial-series-trendy',
    'editorial-series-new', 'editorial-series-returning',
    'editorial-movies-new', 'editorial-binge-watch-series', 'editorial-cinema-now'
  ];
  for (const endpoint of endpoints) {
    const response = await call(endpoint);
    assert.equal(response.statusCode, 200, endpoint);
    const editorial = JSON.parse(response.text).find(c => c.id === 'calendar-archives-fr-editorial-now');
    assert(editorial, endpoint + ': editorial collection missing');
    assert.equal(editorial.folders.length, 7, endpoint);
    for (const id of ids) {
      const folder = editorial.folders.find(f => f.id === id);
      assert(folder, endpoint + ': missing ' + id);
      if (folder.hideTitle) {
        const titleUrl=new URL(folder.titleLogoUrl);
        assert.equal(titleUrl.pathname,'/collection-title.svg');
        assert.equal(titleUrl.searchParams.get('title'),folder.title.replace(/^[^\p{L}\p{N}]+/u,''));
      } else assert.equal(folder.titleLogoUrl,null);
      assert.equal(typeof folder.title, 'string', endpoint + ': native text title missing');
      assert(folder.title.trim().length > 3, endpoint + ': empty native title');
      if (id === 'editorial-binge-watch-series') {
        assert.match(folder.coverImageUrl, /\/fr\/binge-watch-cover\.jpg\?/);
        assert.match(folder.heroBackdropUrl, /\/fr\/binge-watch-backdrop\.jpg\?/);
      } else {
        assert.match(folder.coverImageUrl, /\/fr\/editorial-cover\.jpg\?key=/,
          endpoint + ': approved cover modified');
        assert.match(folder.heroBackdropUrl, /\/fr\/editorial-backdrop\.jpg\?key=/,
          endpoint + ': cinematic hero modified');
      }
    }
  }
});

test('every collection import supplies a visible hero without changing the Netflix wordmark',async()=>{
  for(const route of ['/nuvio-collections-shield.json','/nuvio-collections-desktop.json',
    '/fr/nuvio-collections.json','/global/nuvio-collections.json','/tr/nuvio-collections.json','/us/nuvio-collections.json',
    '/series/nuvio-collections.json','/series-v2/nuvio-collections.json','/movies/nuvio-collections.json']) {
    const response=await call(route);assert.equal(response.statusCode,200,route);
    const collections=JSON.parse(response.text);
    for(const collection of collections)for(const folder of collection.folders) {
      // This is Nuvio TV's actual hero predicate: hideTitle also blanks the
      // native hero title, so a hidden caption requires a separate wordmark.
      assert((!folder.hideTitle && folder.title.trim()) || folder.titleLogoUrl?.trim(),`${route}: ${collection.title} / ${folder.title}`);
    }
    const netflix=collections.find(c=>c.id==='calendar-archives-fr-netflix');
    if(netflix && !route.includes('desktop'))for(const folder of netflix.folders)assert.match(folder.titleLogoUrl,/\/fr\/platform-logo\?provider=netflix/);
  }
  const response=await call('/collection-title.svg?title=Stand-up&label=Films%20Monde');
  assert.equal(response.statusCode,200);assert.match(response.headers['content-type'],/^image\/svg\+xml/);
  assert.match(response.text,/<title>Stand-up<\/title>/);assert(!response.text.includes('<image'));
  const info=await sharp(response.body).metadata();assert.equal(info.width,1000);assert.equal(info.height,240);assert(info.hasAlpha);
  const escaped=await call('/collection-title.svg?title=%3Cscript%3E%26%22%27');
  assert(!escaped.text.includes('<script>'));assert.match(escaped.text,/&lt;script&gt;&amp;&quot;&apos;/);
  assert.equal((await call('/collection-title.svg')).statusCode,400);
});

test('Nouvelles séries and Nouveaux films always use their own source, cover and hero in Shield/Desktop', async () => {
  const approved = require('../assets/collection-art/editorial-night-b-20261026/manifest.json');
  const mappings = [
    { id: 'editorial-series-new', key: 'series-new', title: 'Nouvelles séries', prefix: 'editorial-series-new-' },
    { id: 'editorial-movies-new', key: 'movies-new', title: 'Nouveaux films', prefix: 'editorial-movies-new-' }
  ];
  const fingerprints = new Set();

  for (const route of ['/nuvio-collections-shield.json', '/nuvio-collections-desktop.json']) {
    const response = await call(route);
    assert.equal(response.statusCode, 200, route);
    const editorial = JSON.parse(response.text).find(c => c.id === 'calendar-archives-fr-editorial-now');
    assert(editorial, route);

    for (const expected of mappings) {
      const folder = editorial.folders.find(f => f.id === expected.id);
      assert(folder, route + ' missing ' + expected.id);
      assert(folder.title.includes(expected.title), route + ' incorrect title for ' + expected.key);
      assert.equal(new URL(folder.coverImageUrl).searchParams.get('key'), expected.key,
        route + ' cover points to the other editorial image');
      assert.equal(new URL(folder.heroBackdropUrl).searchParams.get('key'), expected.key,
        route + ' hero points to the other editorial image');
      assert(folder.sources.every(s => s.catalogId.startsWith(expected.prefix)),
        route + ' source catalog has wrong media type');

      const [cover, hero] = await Promise.all([
        call('/fr/editorial-cover.jpg?key=' + expected.key),
        call('/fr/editorial-backdrop.jpg?key=' + expected.key)
      ]);
      assert.equal(cover.statusCode, 200, expected.key + ' cover');
      assert.equal(hero.statusCode, 200, expected.key + ' backdrop');
      assert.equal(cover.headers['x-nuvio-editorial-cover'], expected.key);
      assert.equal(hero.headers['x-nuvio-editorial-backdrop'], expected.key);
      const sourceHash = approved.images[expected.key].cover.sha256;
      assert.equal(cover.headers['x-nuvio-editorial-source-sha256'], sourceHash,
        expected.key + ' cover reads the wrong approved JPEG');
      assert.equal(hero.headers['x-nuvio-editorial-source-sha256'], approved.images[expected.key].backdrop.sha256,
        expected.key + ' hero reads the wrong approved JPEG');
      fingerprints.add(sourceHash);
    }
  }
  assert.equal(fingerprints.size, 2, 'series and movies accidentally share the same photography');
});

test('Cinema du moment static schema exposes À l’affiche plus dated tiles and reuses the France addon', () => {
  const req = { headers: { host: 'coexist.example', 'x-forwarded-proto': 'https' } };
  const raw = handler._internals.cinemaTorrentioCollection(req);
  const cinema = handler._internals.desktopizeCollectionArt(raw);
  const shieldCinema = handler._internals.shieldizeCollectionArt(raw);
  assert.equal(cinema.title, '🎬 Cinéma du moment');
  assert.equal(cinema.folders.length, 10);
  assert.equal(shieldCinema.folders.length, 10);

  const expected = [
    ['cinema-now-nowplaying', 'À l’affiche', 'cinema-torrentio-nowplaying'],
    ['cinema-now-recent', 'Sorties cinéma récentes', 'cinema-torrentio-recent'],
    ['cinema-now-today', 'Aujourd’hui', 'cinema-torrentio-today'],
    ['cinema-now-yesterday', 'Hier', 'cinema-torrentio-yesterday'],
    ['cinema-now-thisweek', 'Cette semaine', 'cinema-torrentio-thisweek'],
    ['cinema-now-lastweek', 'Semaine dernière', 'cinema-torrentio-lastweek'],
    ['cinema-now-thismonth', 'Ce mois-ci', 'cinema-torrentio-thismonth'],
    ['cinema-now-previousmonth', 'Mois dernier', 'cinema-torrentio-previousmonth'],
    ['cinema-now-nextweek', 'Semaine prochaine', 'cinema-torrentio-nextweek'],
    ['cinema-now-nextmonth', 'Mois prochain', 'cinema-torrentio-nextmonth']
  ];

  assert.deepEqual(
    cinema.folders.map((folder) => [folder.id, folder.title, folder.sources[0]?.catalogId]),
    expected
  );
  assert(cinema.folders.every((folder) =>
    folder.sources.length === 1 &&
    folder.catalogSources.length === 1 &&
    folder.sources[0].addonId === 'com.nuvio.calendar.archives.fr.coexist' &&
    folder.sources[0].type === 'movie' &&
    folder.coverImageUrl.includes('/desktop-folder-card.jpg') &&
    folder.coverImageUrl.includes('dynamic=1') &&
    folder.coverImageUrl.includes('label=%F0%9F%8E%AC+Cin%C3%A9ma+du+moment')
  ));
  assert(shieldCinema.folders.every((folder) =>
    folder.sources.length === 1 &&
    folder.coverImageUrl.includes('/shield-folder-card.jpg') &&
    folder.coverImageUrl.includes('dynamic=1') &&
    folder.titleLogoUrl?.includes('/fr/platform-logo?provider=cinema-torrentio') &&
    folder.hideTitle === true
  ));
});

test('Cinema live collection filtering never exposes empty clickable folders', () => {
  const req = { headers: { host: 'coexist.example', 'x-forwarded-proto': 'https' } };
  const filtered = handler._internals.cinemaTorrentioCollection(req, new Set(['nowplaying', 'previousmonth']));
  assert.deepEqual(filtered.folders.map((folder) => folder.id), [
    'cinema-now-nowplaying',
    'cinema-now-previousmonth'
  ]);
  const withoutCinema = handler._internals.combinedRawCollections(req, new Set());
  assert.equal(withoutCinema.some((collection) => collection.id === 'cinema-now-torrentio'), false);
  const withLegacyAvailability = handler._internals.combinedRawCollections(req, new Set(['nowplaying', 'recent']));
  assert.equal(withLegacyAvailability.some((collection) => collection.id === 'cinema-now-torrentio'), false);
  assert(withLegacyAvailability.some((collection) => collection.id === 'calendar-archives-fr-editorial-now'));
});

test('Cinema live availability fails closed instead of exposing unverified folders', async () => {
  const req = { headers: { host: 'coexist.example', 'x-forwarded-proto': 'https' } };
  const original = handler._internals.frHandler._internals.cinemaAvailableBucketKeys;
  handler._internals.frHandler._internals.cinemaAvailableBucketKeys = async () => null;
  try {
    const collections = await handler._internals.combinedRawCollectionsLive(req);
    assert.equal(collections.some((collection) => collection.id === 'cinema-now-torrentio'), false);
  } finally {
    handler._internals.frHandler._internals.cinemaAvailableBucketKeys = original;
  }
});

test('Oracle health collection counts follow the same live-filtered collection payload', () => {
  const req = { headers: { host: 'coexist.example', 'x-forwarded-proto': 'https' } };
  const liveFiltered = handler._internals.combinedRawCollections(req, new Set())
    .map(handler._internals.shieldizeCollectionArt);
  const report = handler._internals.coexistenceReport(req, liveFiltered);
  assert.equal(report.collectionCount, liveFiltered.length);
  assert.equal(report.frCollectionCount, liveFiltered.filter((c) => c.title.startsWith('🇫🇷')).length);
  assert.equal(liveFiltered.some((c) => c.id === 'cinema-now-torrentio'), false);
});


test('France stays first, Global is next, Türkiye follows, and USA remains last on Modern Shield', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-tr-usa.json')).text);
  const fr = collections.filter((c) => c.title.startsWith('🇫🇷 '));
  const globalVod = collections.filter((c) => c.title.startsWith('🌍 '));
  const tr = collections.filter((c) => c.title.startsWith('🇹🇷 '));
  const us = collections.filter((c) => c.title.startsWith('🇺🇸 '));
  assert.equal(fr.length, 17);
  assert.equal(globalVod.length, 2);
  assert.equal(tr.length, 19);
  assert.equal(us.length, 12);
  assert(fr.every((c) => c.pinToTop === true));
  assert(globalVod.every((c) => c.pinToTop === true));
  assert(tr.every((c) => c.pinToTop === true));
  assert(us.every((c) => c.pinToTop === false));
});


test('USA, France, Global and Türkiye collection sources always reference their own addon', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-tr-usa.json')).text);
  const us = collections.filter((c) => c.title.startsWith('🇺🇸 '));
  const fr = collections.filter((c) => c.title.startsWith('🇫🇷 '));
  const globalVod = collections.filter((c) => c.title.startsWith('🌍 '));
  const tr = collections.filter((c) => c.title.startsWith('🇹🇷 '));
  for (const collection of us) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.us.coexist'));
  }
  for (const collection of fr) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.fr.coexist'));
  }
  for (const collection of globalVod) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.global.coexist'));
  }
  for (const collection of tr) for (const folder of collection.folders) {
    assert(folder.sources.every((source) => source.addonId === 'com.nuvio.calendar.archives.tr.coexist'));
  }
});


test('all hosted visual URLs stay inside the correct regional/global route prefix', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-tr-usa.json')).text);
  for (const collection of collections) {
    const prefix = collection.title.startsWith('🇺🇸 ')
      ? 'https://coexist.example/us/'
      : collection.title.startsWith('🌍 ')
        ? 'https://coexist.example/global/'
        : collection.title.startsWith('🇹🇷 ')
          ? 'https://coexist.example/tr/'
          : 'https://coexist.example/fr/';
    const region = prefix.match(/\/(fr|global|tr|us)\/$/)[1];
    const isOwnAsset = (value) => typeof value === 'string'
      && (value.startsWith(prefix)
        || value.startsWith(`https://coexist.example/static/assets/generated-covers/${region}/`));
    assert(isOwnAsset(collection.backdropImageUrl), 'wrong-region collection backdrop');
    for (const folder of collection.folders) {
      assert(isOwnAsset(folder.coverImageUrl), 'wrong-region folder cover');
      assert(isOwnAsset(folder.heroBackdropUrl), 'wrong-region folder backdrop');
      if (folder.titleLogoUrl != null) assert(isOwnAsset(folder.titleLogoUrl)
        || new URL(folder.titleLogoUrl).origin==='https://coexist.example' && new URL(folder.titleLogoUrl).pathname==='/collection-title.svg');
    }
  }
});


test('Modern content artwork URLs keep the /fr and /us sub-path instead of falling back to the root', () => {
  const frApi = handler._internals.frHandler._internals;
  const usApi = handler._internals.usHandler._internals;
  const globalApi = handler._internals.globalHandler._internals;
  const trApi = handler._internals.trHandler._internals;
  const meta = {
    id: 'tt1234567', type: 'series', name: 'Demo',
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    released: '2026-08-26', _calendarProvider: 'Netflix', _calendarSource: 'tmdb-streaming'
  };
  const catalog = { type: 'series', period: 'today', cardProvider: 'Netflix', name: 'Aujourd’hui' };
  const frDecorated = frApi.decorateCatalogMetas('https://coexist.example/fr', [meta], catalog, 'Europe/Paris')[0];
  const usDecorated = usApi.decorateCatalogMetas('https://coexist.example/us', [meta], catalog, 'America/New_York')[0];
  const globalCatalog = { type: 'movie', period: 'today', cardProvider: 'VOD Mondiale', name: 'Aujourd’hui' };
  const globalMeta = { ...meta, type: 'movie', _calendarProvider: 'VOD Mondiale', _calendarSource: 'tmdb-vod' };
  const globalDecorated = globalApi.decorateCatalogMetas('https://coexist.example/global', [globalMeta], globalCatalog, 'Europe/Paris')[0];
  const trDecorated = trApi.decorateCatalogMetas('https://coexist.example/tr', [meta], catalog, 'Europe/Istanbul')[0];
  assert.match(frDecorated.background, /^https:\/\/coexist\.example\/fr\/calendar-card\.svg\?/);
  assert.match(frDecorated.poster, /^https:\/\/coexist\.example\/fr\/calendar-card\.svg\?/);
  assert.match(frDecorated.logo, /^https:\/\/coexist\.example\/fr\/calendar-transparent-logo\.svg\?/);
  assert.match(usDecorated.background, /^https:\/\/coexist\.example\/us\/calendar-card\.svg\?/);
  assert.match(usDecorated.poster, /^https:\/\/coexist\.example\/us\/calendar-card\.svg\?/);
  assert.match(usDecorated.logo, /^https:\/\/coexist\.example\/us\/calendar-transparent-logo\.svg\?/);
  assert.match(globalDecorated.background, /^https:\/\/coexist\.example\/global\/calendar-card\.svg\?/);
  assert.match(globalDecorated.poster, /^https:\/\/coexist\.example\/global\/calendar-card\.svg\?/);
  assert.match(trDecorated.background, /^https:\/\/coexist\.example\/tr\/calendar-card\.svg\?/);
});

test('regional image routes are reachable through the wrapper', async () => {
  const us = await call('/us/platform-category-card.svg?provider=netflix&category=series');
  const fr = await call('/fr/platform-category-card.svg?provider=canal-plus&category=films');
  const globalVod = await call('/global/platform-category-card.svg?provider=vod-global&category=films');
  const tr = await call('/tr/platform-category-card.svg?provider=exxen&category=series');
  assert.equal(us.statusCode, 200);
  assert.equal(fr.statusCode, 200);
  assert.equal(globalVod.statusCode, 200);
  assert.equal(tr.statusCode, 200);
  assert.match(us.headers['content-type'], /image\/svg\+xml/);
  assert.match(fr.headers['content-type'], /image\/svg\+xml/);
  assert.match(globalVod.headers['content-type'], /image\/svg\+xml/);
  assert.match(tr.headers['content-type'], /image\/svg\+xml/);
  assert.match(us.text, /SÉRIES/);
  assert.match(fr.text, /FILMS/);
  assert.match(globalVod.text, /VOD Mondiale|VOD MONDIALE/i);
  assert.match(tr.text, /SÉRIES/);
});


test('regional Modern calendar-card SVG routes are reachable and embed artwork', async () => {
  const oldFetch = global.fetch;
  const validPng = await require('sharp')({ create: { width: 16, height: 9, channels: 3, background: '#486d8b' } }).png().toBuffer();
  global.fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('https://image.tmdb.org/')) {
      return new Response(validPng, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(validPng.length) }
      });
    }
    throw new Error(`unexpected fetch ${value}`);
  };
  try {
    const src = encodeURIComponent('https://image.tmdb.org/t/p/w780/demo.jpg');
    const fr = await call(`/fr/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=Netflix&type=series`);
    const us = await call(`/us/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=Netflix&type=series`);
    const globalVod = await call(`/global/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=VOD%20Mondiale&type=movie`);
    const tr = await call(`/tr/calendar-card.svg?src=${src}&layout=landscape&title=Demo&provider=Exxen&type=series`);
    assert.equal(fr.statusCode, 200);
    assert.equal(us.statusCode, 200);
    assert.equal(globalVod.statusCode, 200);
    assert.equal(tr.statusCode, 200);
    assert.match(fr.headers['content-type'], /image\/svg\+xml/);
    assert.match(us.headers['content-type'], /image\/svg\+xml/);
    assert.match(globalVod.headers['content-type'], /image\/svg\+xml/);
    assert.match(tr.headers['content-type'], /image\/svg\+xml/);
    assert.match(fr.text, /data:image\/png;base64,/);
    assert.match(us.text, /data:image\/png;base64,/);
    assert.match(globalVod.text, /data:image\/png;base64,/);
    assert.match(tr.text, /data:image\/png;base64,/);
  } finally {
    global.fetch = oldFetch;
  }
});

test('coexistence checker reports zero collisions', async () => {
  const report = JSON.parse((await call('/coexistence-check.json')).text);
  assert.equal(report.safe, true);
  assert.deepEqual(report.duplicateCollectionIds, []);
  assert.deepEqual(report.duplicateFolderKeys, []);
  assert.deepEqual(report.duplicateCatalogKeys, []);
  assert.deepEqual(report.addonIds, [
    'com.nuvio.calendar.archives.fr.coexist',
    'com.nuvio.calendar.archives.global.coexist',
    'com.nuvio.calendar.archives.tr.coexist',
    'com.nuvio.calendar.archives.us.coexist'
  ]);
  assert.equal(report.globalCollectionCount, 2);
  assert.equal(report.trCollectionCount, 19);
});

test('USA and France Paramount+ remain distinct and both expose Series and Films', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-fr-global-tr-usa.json')).text);
  const us = collections.find((c) => c.title === '🇺🇸 Paramount+');
  const fr = collections.find((c) => c.title === '🇫🇷 Paramount+');
  assert(us && fr);
  assert.deepEqual(us.folders.map((f) => f.title), ['Séries', 'Films']);
  assert.deepEqual(fr.folders.map((f) => f.title), ['Séries', 'Films']);
  assert.notEqual(us.id, fr.id);
  assert(us.folders[0].sources.every((s) => s.catalogId.startsWith('archives-v3-series-paramount-plus-')));
  assert(fr.folders[0].sources.every((s) => s.catalogId.startsWith('archives-fr-v1-series-paramount-plus-')));
});

test('civil-day catalogs are never cached across midnight while monthly and historical data remain cached', () => {
  const apis = [
    handler._internals.frHandler._internals,
    handler._internals.globalHandler._internals,
    handler._internals.trHandler._internals,
    handler._internals.usHandler._internals,
  ];
  const window = { today: '2026-09-07', empty: false };
  for (const api of apis) {
    for (const period of ['today', 'yesterday', 'tomorrow']) {
      assert.equal(
        api.catalogResponseCacheControl({ period, archivePeriodKey: period }, window),
        'no-store',
        `${period} must not return yesterday's data after midnight`
      );
    }
    assert.equal(
      api.catalogResponseCacheControl({ period: 'archive-2026-09' }, window),
      'public, max-age=60, s-maxage=300, stale-while-revalidate=900'
    );
    assert.equal(
      api.catalogResponseCacheControl({ period: 'archive-2025-08' }, window),
      'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400'
    );
    assert.equal(
      api.catalogResponseCacheControl({ period: 'archive-2030-12' }, { ...window, empty: true }),
      'public, max-age=300, s-maxage=3600'
    );
  }
});


test('health endpoint is green when all regions coexist safely', async () => {
  const response = await call('/health');
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.text);
  assert.equal(body.ok, true);
  assert.equal(body.safe, true);
});


test('Shield import uses dedicated cinematic raster covers while preserving TV title behavior', async () => {
  const response = await call('/nuvio-collections-shield.json');
  assert.equal(response.statusCode, 200);
  assertCdnCache(response, 300);
  const collections = JSON.parse(response.text);
  assert.equal(collections.length, 50);

  const targets = [
    collections.find((c) => c.title === '🇫🇷 Netflix'),
    collections.find((c) => c.title === '🌍 VOD Mondiale'),
    collections.find((c) => c.title === '🇹🇷 Netflix'),
    collections.find((c) => c.title === '🇺🇸 Netflix'),
  ];
  for (const collection of targets) {
    assert(collection);
    const generatedBackdrop = /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/hero\.jpg\?v=/;
    assert(/\/platform-backdrop\.jpg\?provider=/.test(collection.backdropImageUrl)
      || /\/fr\/service-backdrop\.jpg\?key=/.test(collection.backdropImageUrl)
      || generatedBackdrop.test(collection.backdropImageUrl), 'approved collection hero missing');
    for (const folder of collection.folders) {
      assert.equal(folder.hideTitle, true);
      assert.equal(folder.focusGifEnabled, false);
      assert.equal(folder.focusGifUrl, null);
      const generatedCard = /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-shield\.jpg\?v=/;
      if (new URL(folder.coverImageUrl).pathname === '/fr/service-cover.jpg') {
        const card = new URL(folder.coverImageUrl);
        assert.equal(card.searchParams.get('key'), 'netflix');
        assert(['series','films'].includes(card.searchParams.get('category')));
        assert.equal(card.searchParams.get('v'), 'fr-services-iconic-b-20261026-v1');
        assert.match(folder.heroBackdropUrl, /\/fr\/service-backdrop\.jpg\?key=netflix&v=fr-services-iconic-b-20261026-v1$/);
      } else if (generatedCard.test(folder.coverImageUrl)) {
        assert.match(folder.heroBackdropUrl, /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-hero\.jpg\?v=|\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/hero\.jpg\?v=/);
      } else {
        assert.match(folder.coverImageUrl, /\/shield-folder-card\.jpg\?provider=/);
        assert.match(folder.coverImageUrl, /[?&]v=shield15-safe-badges/);
        assert.match(folder.coverImageUrl, /[?&]title=/);
        assert.match(folder.heroBackdropUrl, /\/platform-backdrop\.jpg\?provider=/);
        const heroUrl = new URL(folder.heroBackdropUrl);
        assert(heroUrl.searchParams.get('type'), 'real-content backdrop type missing');
        assert.equal(heroUrl.searchParams.get('v'), 'shield15-safe-badges');
      }
    }
  }

  const frGenres = collections.find((c) => c.title === '🇫🇷 Genres · Films');
  assert(frGenres?.folders?.length > 0);
  assert(/\/shield-genre-card\.jpg\?genre=/.test(frGenres.folders[0].coverImageUrl)
    || /\/static\/assets\/generated-covers\/fr\/genres\/[a-z0-9-]+-shield\.jpg\?v=/.test(frGenres.folders[0].coverImageUrl));
  assert(/[?&]v=shield15-safe-badges/.test(frGenres.folders[0].coverImageUrl)
    || /[?&]v=generated-/.test(frGenres.folders[0].coverImageUrl));
});

test('Shield cinematic aliases resolve to native 1600x900 JPEG renderers in every region', async () => {
  const urls = [
    '/fr/shield-folder-card.jpg?provider=netflix&type=series&title=S%C3%A9ries&label=Netflix&v=shield15-safe-badges',
    '/global/shield-folder-card.jpg?provider=vod-global&type=movie&title=Films&label=VOD%20Mondiale&v=shield15-safe-badges',
    '/tr/shield-folder-card.jpg?provider=netflix&type=series&title=Diziler&label=Netflix&v=shield15-safe-badges',
    '/us/shield-folder-card.jpg?provider=netflix&type=movie&title=Films&label=Netflix&v=shield15-safe-badges',
  ];
  for (const url of urls) {
    const response = await call(url);
    assert.equal(response.statusCode, 200, url);
    assert.match(response.headers['content-type'], /image\/jpeg/, url);
    assert.equal(response.headers['x-nuvio-card-renderer'], 'shield-desktop-jpeg-v4', url);
    assert.equal(response.headers['x-nuvio-desktop-format'], '1600x900', url);
    assert.equal(response.body[0], 0xff, url);
    assert.equal(response.body[1], 0xd8, url);
    assert(response.body.length > 1000, url);
  }
});

test('desktop import uses dedicated cinematic raster covers with native folder titles', async () => {
  const response = await call('/nuvio-collections-desktop.json');
  assert.equal(response.statusCode, 200);
  assertCdnCache(response, 300);
  const collections = JSON.parse(response.text);
  assert.equal(collections.length, 50);

  const frNetflix = collections.find((c) => c.title === '🇫🇷 Netflix');
  const globalVod = collections.find((c) => c.title === '🌍 VOD Mondiale');
  const usNetflix = collections.find((c) => c.title === '🇺🇸 Netflix');
  assert(frNetflix && globalVod && usNetflix);

  for (const collection of [frNetflix, globalVod, usNetflix]) {
    for (const folder of collection.folders) {
      assert.equal(folder.hideTitle, false);
      assert.equal(folder.focusGifEnabled, false);
      assert.equal(folder.focusGifUrl, null);
      const coverUrl = new URL(folder.coverImageUrl);
      if (coverUrl.pathname.endsWith('/desktop-folder-card.jpg')) {
        assert(coverUrl.searchParams.get('provider'));
      } else if (coverUrl.pathname === '/fr/service-cover.jpg') {
        assert.equal(coverUrl.searchParams.get('key'), 'netflix');
        assert(['series','films'].includes(coverUrl.searchParams.get('category')));
        assert.equal(coverUrl.searchParams.get('v'), 'fr-services-iconic-b-20261026-v1');
      } else {
        assert.match(coverUrl.pathname, /^\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-desktop\.jpg$/);
        assert.match(coverUrl.searchParams.get('v') || '', /^generated-/);
      }
      assert.doesNotMatch(folder.coverImageUrl, /platform-category-card\.svg/);
    }
  }

  const frCover = new URL(frNetflix.folders[0].coverImageUrl);
  const globalCover = new URL(globalVod.folders[0].coverImageUrl);
  const usCover = new URL(usNetflix.folders[0].coverImageUrl);
  assert(['/fr/service-cover.jpg', '/fr/desktop-folder-card.jpg', '/static/assets/generated-covers/fr/netflix/series-desktop.jpg'].includes(frCover.pathname));
  assert(['/global/desktop-folder-card.jpg', '/static/assets/generated-covers/global/vod-global/movie-desktop.jpg'].includes(globalCover.pathname));
  assert(['/us/desktop-folder-card.jpg', '/static/assets/generated-covers/us/netflix/series-desktop.jpg'].includes(usCover.pathname));
  if (frCover.pathname === '/fr/desktop-folder-card.jpg') assert.equal(frCover.searchParams.get('provider'), 'netflix');
  if (globalCover.pathname === '/global/desktop-folder-card.jpg') assert.equal(globalCover.searchParams.get('provider'), 'vod-global');
  if (usCover.pathname === '/us/desktop-folder-card.jpg') assert.equal(usCover.searchParams.get('provider'), 'netflix');
});

test('desktop banner keeps the original landscape artwork as its cinematic source while Shield keeps SVG background', () => {
  const apis = [
    [handler._internals.frHandler._internals, 'https://coexist.example/fr', 'Europe/Paris'],
    [handler._internals.usHandler._internals, 'https://coexist.example/us', 'America/New_York'],
    [handler._internals.globalHandler._internals, 'https://coexist.example/global', 'Europe/Paris'],
    [handler._internals.trHandler._internals, 'https://coexist.example/tr', 'Europe/Istanbul'],
  ];
  for (const [api, origin, tz] of apis) {
    const meta = {
      id: 'tt1234567',
      type: 'movie',
      name: 'Desktop Clean Art',
      poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
      background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
      landscapePoster: 'https://image.tmdb.org/t/p/original/demo-landscape.jpg',
      released: '2026-08-26',
      _calendarProvider: 'Netflix',
      _calendarSource: 'tmdb-streaming'
    };
    const [decorated] = api.decorateCatalogMetas(
      origin,
      [meta],
      { type: 'movie', period: 'today', cardProvider: 'Netflix', name: 'Aujourd’hui' },
      tz
    );
    const bannerUrl = new URL(decorated.banner);
    assert.equal(bannerUrl.pathname.endsWith('/desktop-content-card.jpg'), true);
    assert.equal(bannerUrl.searchParams.get('src'), 'https://image.tmdb.org/t/p/w780/demo-landscape.jpg');
    assert.match(decorated.background, /calendar-card\.svg\?/);
    assert.match(decorated.landscapePoster, /calendar-card\.svg\?/);
  }
});


test('desktop JPEG collection routes exist in every region', async () => {
  const urls = [
    '/fr/platform-card.jpg?provider=netflix',
    '/global/platform-card.jpg?provider=vod-global',
    '/tr/platform-card.jpg?provider=netflix',
    '/us/platform-card.jpg?provider=netflix',
  ];
  for (const url of urls) {
    const response = await call(url);
    assert.equal(response.statusCode, 200, url);
    assert.match(response.headers['content-type'], /image\/jpeg/, url);
    assert(response.body.length > 1000, url);
  }
});

test('desktop import also replaces folder and collection backdrops with clean JPEGs', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-desktop.json')).text);
  const targets = [
    collections.find((c) => c.title === '🇫🇷 Netflix'),
    collections.find((c) => c.title === '🌍 VOD Mondiale'),
    collections.find((c) => c.title === '🇹🇷 Netflix'),
    collections.find((c) => c.title === '🇺🇸 Netflix'),
  ];
  for (const collection of targets) {
    assert(collection);
    assert(/\/platform-backdrop\.jpg\?provider=/.test(collection.backdropImageUrl)
      || /\/fr\/service-backdrop\.jpg\?key=/.test(collection.backdropImageUrl)
      || /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/hero\.jpg\?v=/.test(collection.backdropImageUrl));
    for (const folder of collection.folders) {
      assert(/\/platform-backdrop\.jpg\?provider=/.test(folder.heroBackdropUrl)
        || /\/fr\/service-backdrop\.jpg\?key=/.test(folder.heroBackdropUrl)
        || /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-hero\.jpg\?v=/.test(folder.heroBackdropUrl)
        || /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/hero\.jpg\?v=/.test(folder.heroBackdropUrl));
      assert.equal(folder.titleLogoUrl, null);
    }
  }
});


test('desktop cinematic import points platform and genre folders to dedicated 16:9 cards', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-desktop.json')).text);
  const frNetflix = collections.find((c) => c.title === '🇫🇷 Netflix');
  const globalVod = collections.find((c) => c.title === '🌍 VOD Mondiale');
  const trNetflix = collections.find((c) => c.title === '🇹🇷 Netflix');
  const usNetflix = collections.find((c) => c.title === '🇺🇸 Netflix');
  const frGenres = collections.find((c) => c.title === '🇫🇷 Genres · Films');

  for (const collection of [frNetflix, globalVod, trNetflix, usNetflix]) {
    assert(collection);
    for (const folder of collection.folders) {
      const generated = /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-desktop\.jpg\?v=/;
      const approved = /\/fr\/service-cover\.jpg\?key=netflix&category=(series|films)&v=fr-services-iconic-b-20261026-v1$/.test(folder.coverImageUrl);
      assert(approved || /\/desktop-folder-card\.jpg\?provider=/.test(folder.coverImageUrl) || generated.test(folder.coverImageUrl));
      if (!approved && !generated.test(folder.coverImageUrl)) assert.match(folder.coverImageUrl, /[?&]type=(movie|series)/);
      assert.equal(folder.hideTitle, false);
    }
  }

  assert(frGenres);
  assert(frGenres.folders.length > 0);
  const generatedGenre = /\/static\/assets\/generated-covers\/fr\/genres\/[a-z0-9-]+-desktop\.jpg\?v=/;
  assert(/\/desktop-genre-card\.jpg\?genre=/.test(frGenres.folders[0].coverImageUrl)
    || generatedGenre.test(frGenres.folders[0].coverImageUrl));
  if (!generatedGenre.test(frGenres.folders[0].coverImageUrl))
    assert.match(frGenres.folders[0].coverImageUrl, /[?&]type=movie/);
});

test('desktop catalog banner uses dedicated cinematic JPEG while Shield background stays original cinematic SVG', () => {
  const regional = [
    [handler._internals.frHandler._internals, 'https://coexist.example/fr', 'Europe/Paris', 'netflix'],
    [handler._internals.usHandler._internals, 'https://coexist.example/us', 'America/New_York', 'netflix'],
    [handler._internals.globalHandler._internals, 'https://coexist.example/global', 'Europe/Paris', 'vod-global'],
    [handler._internals.trHandler._internals, 'https://coexist.example/tr', 'Europe/Istanbul', 'netflix'],
  ];

  for (const [api, origin, tz, providerSlug] of regional) {
    const meta = {
      id: 'tt1234567',
      type: 'series',
      name: 'Desktop Cinematic',
      poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
      background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
      landscapePoster: 'https://image.tmdb.org/t/p/original/demo-landscape.jpg',
      released: '2026-08-26',
      _calendarProvider: 'Netflix',
      _calendarSource: 'tmdb-streaming'
    };
    const [decorated] = api.decorateCatalogMetas(
      origin,
      [meta],
      { type: 'series', period: 'today', cardProvider: 'Netflix', providerSlug, name: 'Aujourd’hui' },
      tz
    );
    assert.match(decorated.banner, /\/desktop-content-card\.jpg\?/);
    assert.match(decorated.banner, /[?&]provider=/);
    assert.match(decorated.background, /\/calendar-card\.svg\?/);
    assert.match(decorated.landscapePoster, /\/calendar-card\.svg\?/);
  }
});


test('desktop cinematic URLs carry visible title, subtitle and provider labels', async () => {
  const collections = JSON.parse((await call('/nuvio-collections-desktop.json')).text);
  const frNetflix = collections.find((c) => c.title === '🇫🇷 Netflix');
  const globalVod = collections.find((c) => c.title === '🌍 VOD Mondiale');
  assert(frNetflix && globalVod);

  const frFolder = frNetflix.folders.find((f) => f.title === 'Séries');
  const globalFolder = globalVod.folders.find((f) => f.title === 'Films');
  assert(frFolder && globalFolder);
  for (const folder of [frFolder, globalFolder]) {
    const url = new URL(folder.coverImageUrl);
    const generated = /\/static\/assets\/generated-covers\/(?:fr|global|tr|us)\/[a-z0-9-]+\/(?:series|movie)-desktop\.jpg$/;
    if (url.pathname === '/fr/service-cover.jpg') {
      assert.equal(url.searchParams.get('key'), 'netflix');
      assert.equal(url.searchParams.get('category'), 'series');
      assert.equal(url.searchParams.get('v'), 'fr-services-iconic-b-20261026-v1');
    } else if (generated.test(url.pathname)) {
      assert.match(url.searchParams.get('v') || '', /^generated-/);
    } else {
      assert.equal(url.pathname.endsWith('/desktop-folder-card.jpg'), true);
      assert(url.searchParams.get('title'));
      assert(url.searchParams.get('label'));
      assert(url.searchParams.get('type'));
    }
  }
});

test('desktop cinematic content banner carries text metadata for vector rendering', () => {
  const api = handler._internals.frHandler._internals;
  const meta = {
    id: 'tt1234567',
    type: 'series',
    name: 'Teen Titans Go!',
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-landscape.jpg',
    releaseInfo: 'S01E48 • Aujourd’hui',
    released: '2026-09-05',
    _calendarProvider: 'Netflix',
    _calendarSource: 'tmdb-streaming'
  };
  const [decorated] = api.decorateCatalogMetas(
    'https://coexist.example/fr',
    [meta],
    { type: 'series', period: 'today', cardProvider: 'Netflix', providerSlug: 'netflix', name: 'Aujourd’hui' },
    'Europe/Paris'
  );
  const url = new URL(decorated.banner);
  assert.equal(url.pathname, '/fr/desktop-content-card.jpg');
  assert.equal(url.searchParams.get('title'), 'Teen Titans Go!');
  assert.match(url.searchParams.get('label') || '', /Netflix/i);
  assert(url.searchParams.get('append'));
  assert.equal(url.searchParams.get('type'), 'series');
});


test('desktop text renderer keeps native title fallback and carries accented metadata safely', () => {
  const api = handler._internals.frHandler._internals;
  const meta = {
    id: 'ttaccented',
    type: 'movie',
    name: "Maternité éternelle",
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-landscape.jpg',
    releaseInfo: "Aujourd’hui • Arte",
    released: '2022-03-01',
    _calendarProvider: 'Arte',
    _calendarSource: 'tmdb-streaming'
  };
  const [decorated] = api.decorateCatalogMetas(
    'https://coexist.example/fr',
    [meta],
    { type: 'movie', period: 'archive-2022-03', cardProvider: 'Arte', providerSlug: 'arte', name: 'Mars 2022' },
    'Europe/Paris'
  );
  const url = new URL(decorated.banner);
  assert.equal(url.searchParams.get('title'), 'Maternité éternelle');
  assert.match(url.searchParams.get('append') || '', /MARS/i);
  assert.match(url.searchParams.get('append') || '', /ARTE/i);
  assert.equal(url.searchParams.get('type'), 'movie');
});


test('desktop final renderer produces a real JPEG with accented readable text', async () => {
  const oldFetch = global.fetch;
  // Generate a valid source image with the same Sharp version used by the renderer.
  const sharp = require('sharp');
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 40, g: 80, b: 120 }
    }
  }).png().toBuffer();
  global.fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('https://image.tmdb.org/')) {
      return new Response(png, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(png.length) }
      });
    }
    throw new Error(`unexpected fetch ${value}`);
  };

  try {
    const src = encodeURIComponent('https://image.tmdb.org/t/p/w780/demo.jpg');
    const response = await call(
      `/fr/desktop-content-card.jpg?src=${src}&type=series&title=${encodeURIComponent('Maternité éternelle')}&append=${encodeURIComponent('Aujourd’hui • S01E04')}&label=HBO%20Max&v=desktop5`
    );
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /image\/jpeg/);
    assert(response.body.length > 5000);
    assert.equal(response.body[0], 0xff);
    assert.equal(response.body[1], 0xd8);
  } finally {
    global.fetch = oldFetch;
  }
});


test('desktop12 Shield JPEG import uses adaptive cinematic routes with labels', async () => {
  const response = await call('/nuvio-collections-desktop.json');
  assert.equal(response.statusCode, 200);
  const collections = JSON.parse(response.text);
  const frNetflix = collections.find((c) => c.title === '🇫🇷 Netflix');
  assert(frNetflix);
  const folder = frNetflix.folders.find((f) => f.title === 'Séries');
  assert(folder);
  const url = new URL(folder.coverImageUrl);
  if (url.pathname === '/fr/desktop-folder-card.jpg') {
    assert.equal(url.searchParams.get('v'), 'desktop14-safe-badges');
    assert.equal(url.searchParams.get('title'), 'Séries');
    assert.match(url.searchParams.get('label') || '', /Netflix/);
  } else if (url.pathname === '/fr/service-cover.jpg') {
    assert.equal(url.searchParams.get('key'), 'netflix');
    assert.equal(url.searchParams.get('category'), 'series');
    assert.equal(url.searchParams.get('v'), 'fr-services-iconic-b-20261026-v1');
  } else {
    assert.equal(url.pathname, '/static/assets/generated-covers/fr/netflix/series-desktop.jpg');
    assert.match(url.searchParams.get('v') || '', /^generated-/);
  }
});

test('desktop11 content banner carries adaptive title and subtitle metadata', () => {
  const api = handler._internals.frHandler._internals;
  const meta = {
    id: 'ttadaptive',
    type: 'series',
    name: 'Though I Am an Inept Villainess',
    poster: 'https://image.tmdb.org/t/p/w500/demo.jpg',
    background: 'https://image.tmdb.org/t/p/original/demo-bg.jpg',
    landscapePoster: 'https://image.tmdb.org/t/p/original/demo-landscape.jpg',
    releaseInfo: 'S01E05',
    released: '2026-08-30',
    _calendarProvider: 'Disney+',
    _calendarSource: 'tmdb-streaming'
  };
  const [decorated] = api.decorateCatalogMetas(
    'https://coexist.example/fr',
    [meta],
    { type: 'series', period: 'today', cardProvider: 'Disney+', providerSlug: 'disney-plus', name: 'Aujourd’hui' },
    'Europe/Paris'
  );
  const url = new URL(decorated.banner);
  assert.equal(url.pathname, '/fr/desktop-content-card.jpg');
  assert.match(url.searchParams.get('v') || '', /desktop11$/);
  assert.equal(url.searchParams.get('title'), meta.name);
  assert(url.searchParams.get('append'));
  assert.match(url.searchParams.get('label') || '', /Disney/i);
});


test('standard and Desktop combined imports expose the same 19 Türkiye parents and source IDs', () => {
  const req = { headers: { host: 'example.test', 'x-forwarded-proto': 'https' } };
  const standard = handler._internals.combinedCollections(req);
  const desktop = handler._internals.combinedDesktopCollections(req);
  const trStandard = standard.filter((c) => c.title.startsWith('🇹🇷 '));
  const trDesktop = desktop.filter((c) => c.title.startsWith('🇹🇷 '));
  assert.equal(trStandard.length, 19);
  assert.equal(trDesktop.length, 19);
  assert.deepEqual(trStandard.map((c) => c.id), trDesktop.map((c) => c.id));
  for (let i = 0; i < trStandard.length; i += 1) {
    const a = trStandard[i].folders.flatMap((f) => f.sources.map((s) => `${s.type}:${s.catalogId}`));
    const b = trDesktop[i].folders.flatMap((f) => f.sources.map((s) => `${s.type}:${s.catalogId}`));
    assert.deepEqual(a, b, trStandard[i].title);
  }
});
