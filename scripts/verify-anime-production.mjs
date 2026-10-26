import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const { manifest } = createRequire(import.meta.url)('../regions/global/api/service-art.cjs');
const origin = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const result = { origin, revision: manifest.revision, imports: 0, folders: 0, exactAssets: 0, catalogues: 0, thumbnails: 0 };
async function request(path, status = 200) {
  const r = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  assert.equal(r.status, status, String(path));
  assert.equal(r.headers.get('x-nuvio-origin'), 'oracle-vm', String(path));
  return r;
}
try {
  assert.equal(manifest.approved, true);
  const health = await (await request('/_oracle/health')).json();
  assert(health.ok); result.gitSha = health.gitSha;
  if (process.env.ARTWORK_EXPECTED_SHA) assert.equal(health.gitSha, process.env.ARTWORK_EXPECTED_SHA);
  const backdrop = new URL('/global/service-backdrop.jpg', origin);
  backdrop.search = new URLSearchParams({key:'anime-asia',v:manifest.revision});
  const assets = new Map([[backdrop.href, manifest.images['anime-asia'].backdrop]]);
  const sourceLists = new Map();
  for (const route of ['/nuvio-collections-shield.json','/nuvio-collections-desktop.json','/global/nuvio-collections.json']) {
    const all = await (await request(route)).json();
    const anime = all.find(c => c.id === 'calendar-archives-global-anime');
    assert(anime, route + ' anime collection'); assert.equal(anime.folders.length, 2);
    assert.equal(anime.backdropImageUrl, backdrop.href);
    for (const category of ['series','films']) {
      const folder = anime.folders.find(f => f.id === 'archives-anime-asia-' + category);
      assert(folder, category); assert.equal(folder.sources.length, 197);
      assert.equal(folder.tileShape, 'LANDSCAPE'); assert.equal(folder.heroBackdropUrl, backdrop.href);
      assert(folder.sources.every(s => s.addonId === 'com.nuvio.calendar.archives.global.coexist'));
      const sources = folder.sources.map(s => s.type + ':' + s.catalogId);
      if (sourceLists.has(category)) assert.deepEqual(sources, sourceLists.get(category));
      else sourceLists.set(category, sources);
      const cover = new URL('/global/service-cover.jpg', origin);
      cover.search = new URLSearchParams({key:'anime-asia',category,v:manifest.revision});
      assert.equal(folder.coverImageUrl, cover.href);
      assets.set(cover.href, manifest.images['anime-asia'][category]); result.folders++;
    }
    result.imports++;
  }
  for (const [url,expected] of assets) {
    const r = await request(url); assert.match(r.headers.get('content-type'), /^image\/jpeg/);
    const bytes = Buffer.from(await r.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, expected.sha256); assert.equal(bytes.length, expected.bytes);
    assert.equal(r.headers.get('x-nuvio-service-source-sha256'), hash);
    assert.equal(r.headers.get('x-nuvio-service-style'), manifest.revision);
    const info = await sharp(bytes).metadata(); assert.equal(info.width, expected.width); assert.equal(info.height, expected.height);
    result.exactAssets++;
  }
  for (const path of ['/global/service-cover.jpg?key=unknown&category=series',
    '/global/service-cover.jpg?key=anime-asia&category=unknown','/global/service-backdrop.jpg?key=unknown']) await request(path,404);
  if (process.env.ANIME_VERIFY_CATALOGS === '1') {
    const month = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date());
    const probes = [['series','today'],['series','lastweek'],['movie',month]];
    const sampled = new Set(); let seriesItems = 0;
    for (const [type,period] of probes) {
      const data = await (await request(`/global/catalog/${type}/archives-global-v1-${type}-anime-asia-${period}.json`)).json();
      assert(Array.isArray(data.metas)); result.catalogues++;
      if (type === 'series') seriesItems += data.metas.length;
      for (const meta of data.metas) {
        assert.equal(meta.posterShape, 'landscape', meta.name);
        assert.match(meta.logo, /\/global\/calendar-transparent-logo\.svg\?v=/, meta.name + ' no duplicate native title');
        for (const field of ['background','landscapePoster','banner']) assert.equal(meta[field], meta.poster, meta.name + ' ' + field);
        const url = new URL(meta.poster); assert.equal(url.origin, origin); assert.equal(url.pathname,'/global/desktop-content-card.jpg');
        assert.equal(url.searchParams.get('provider'),'anime-asia');
        if (!String(meta.id).startsWith('anilist:')) assert.equal(new URL(url.searchParams.get('src')).hostname,'image.tmdb.org',meta.name+' TMDb artwork');
      }
      for (const meta of data.metas.slice(0,2)) {
        if (sampled.has(meta.poster)) continue; sampled.add(meta.poster);
        const r = await request(meta.poster);
        assert.equal(r.headers.get('x-nuvio-anime-design'),'calendar-16x9-v1');
        assert.equal(r.headers.get('x-nuvio-artwork-photo'),'ready',meta.name+' real artwork');
        const bytes = Buffer.from(await r.arrayBuffer()); const info = await sharp(bytes).metadata();
        assert.equal(info.format,'jpeg'); assert.equal(info.width,1600); assert.equal(info.height,900);
        result.thumbnails++;
      }
    }
    assert(seriesItems > 0,'Current/recent anime catalogue has content'); assert(result.thumbnails > 0);
  }
  console.log(JSON.stringify({...result,ok:true},null,2));
} catch (error) {
  console.error(JSON.stringify({...result,ok:false,error:error.message},null,2)); process.exitCode = 1;
}
