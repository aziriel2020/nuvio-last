#!/usr/bin/env node
// Read-only production diagnostics for Films Monde. No secrets, writes, or API keys.
const BASE = new URL(process.env.PUBLIC_ORIGIN || 'https://141-145-215-202.nip.io').origin;
const findings = [];
async function inspect(path, fields = null) {
  const begun = performance.now();
  const item = { path };
  try {
    const response = await fetch(BASE + path, { signal: AbortSignal.timeout(30000), headers: {accept:'application/json', 'cache-control':'no-cache'} });
    item.code = response.status;
    item.ms = Math.round(performance.now() - begun);
    item.contentType = response.headers.get('content-type');
    item.origin = response.headers.get('x-nuvio-origin');
    item.cache = response.headers.get('x-nuvio-disk-cache');
    if (fields === 'image') {
      item.contentLength = response.headers.get('content-length');
      await response.body?.cancel();
    } else if (item.contentType?.includes('json')) {
      const raw = await response.text();
      item.bytes = raw.length;
      try {
        const data = JSON.parse(raw);
        if (fields === 'status') {
          const {ok,eligible,streaming,vodAvailable,cinemaReleases,awaitingClassification,lastSync,scans,jobs} = data;
          Object.assign(item,{ok,eligible,streaming,vodAvailable,cinemaReleases,awaitingClassification,lastSync,scans,jobs});
        } else if (fields === 'manifest') {
          item.id = data.id; item.version = data.version;
          item.catalogCount = data.catalogs?.length ?? null;
          item.namedPeriods = (data.catalogs||[]).slice(0,6).map(c=>c.name);
        } else if (fields === 'collections') {
          item.collectionsCount = data.length;
          item.folders = data.map(c=>({id:c.id,folders:c.folders?.length,
            sources:(c.folders||[]).reduce((n,f)=>n+(f.sources||[]).length,0)}));
        } else if (fields === 'catalog') {
          item.count=data.metas?.length??null; item.error=data.error;
          item.examples=(data.metas||[]).slice(0,3).map(m=>({id:m.id,name:m.name,released:m.released,
            poster: m.poster?.slice(0,250), background:m.background?.slice(0,250)}));
          item.postersDirect=(data.metas||[]).filter(m=>/https:\/\/(?:image\.tmdb\.org|artworks\.thetvdb\.com)/.test(m.poster||'')).length;
          item.postersOracle=(data.metas||[]).filter(m=>/\/fr\/calendar-card|\/images\/original/.test(m.poster||'')).length;
        } else if (fields === 'meta') {
          item.metaId=data.meta?.id;item.error=data.error;
        }
      } catch (e) {item.jsonError=e.message;item.sample=raw.slice(0,200);}
    } else {item.sample=(await response.text()).slice(0,250);}
  } catch(e) {item.failure=e.message;item.ms=Math.round(performance.now()-begun);}
  findings.push(item);
  console.log(JSON.stringify(item));
  return item;
}
await inspect('/_oracle/health');
await inspect('/movies/status.json','status');
await inspect('/movies/manifest.json','manifest');
await inspect('/movies/native-bridge/manifest.json','manifest');
await inspect('/movies/nuvio-collections.json','collections');
await inspect('/movies/artwork/genre/all.webp','image');
for(const suffix of ['all-all-all','all-all-2026-10','streaming-all-2026-10','cinema-all-2026-10','vod-all-2026-10']){
  const route='/catalog/movie/movies-fr-'+suffix+'.json';
  await inspect('/movies'+route,'catalog');
  await inspect('/movies/native-bridge'+route,'catalog');
}
const status=findings.find(x=>x.path==='/movies/status.json');
const listed=findings.filter(x=>x.path.startsWith('/movies/native-bridge/catalog/'));
const failing=findings.filter(x=>x.failure || (x.code>=400));
console.log('FILMS_MONDE_DIAG_SUMMARY='+JSON.stringify({statusOk:status?.ok, eligible:status?.eligible,
  firstPageCounts:listed.map(x=>({path:x.path,count:x.count,direct:x.postersDirect,oracle:x.postersOracle})),
  failing:failing.map(x=>({path:x.path,code:x.code,failure:x.failure}))}));
