'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar');
const api=require('../api/index');

const fixedNow=new Date('2026-08-24T12:28:00Z');
const fixedSep=new Date('2026-09-01T12:28:00Z');
const tz='Europe/Paris';
const expectedParents=['Netflix','Prime Video','Disney+','HBO Max','Apple TV+','CANAL+','Paramount+','france.tv','TF1+','M6+','ARTE','Crunchyroll + AniList','ADN','VOD France'];

function collection(title, now=fixedNow, origin='https://fr-archives.example'){
  return api._internals.buildNuvioCollectionsImport(now,tz,origin).find(c=>c.title===title);
}
function folder(parent,title){return parent.folders.find(f=>f.title===title)}

test('France defaults are locked to Paris / FR / fr-FR',()=>{
  assert.equal(calendar.DEFAULT_TIMEZONE,'Europe/Paris');
  assert.equal(calendar.DEFAULT_COUNTRY,'FR');
  assert.equal(calendar.DEFAULT_LANGUAGE,'fr-FR');
});

test('France archive month windows roll automatically',()=>{
  assert.equal(calendar.dateWindow('archive-2026-08',fixedNow,tz).end,'2026-08-24');
  assert.equal(calendar.dateWindow('archive-2026-09',fixedNow,tz).empty,true);
  assert.equal(calendar.dateWindow('archive-2026-09',fixedSep,tz).empty,false);
});

test('France provider parents include French services and no US-only Hulu/Peacock',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  assert.deepEqual(payload.map(c=>c.title),expectedParents);
  assert(!payload.some(c=>['Hulu','Peacock'].includes(c.title)));
  assert(payload.some(c=>c.title==='CANAL+'));
  assert(payload.some(c=>c.title==='france.tv'));
  assert(payload.some(c=>c.title==='TF1+'));
  assert(payload.some(c=>c.title==='M6+'));
  assert(payload.some(c=>c.title==='ARTE'));
  assert(payload.some(c=>c.title==='ADN'));
});

test('all normal France platforms have Series and Films; VOD France is Films only',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  for(const parent of payload.filter(c=>c.title!=='VOD France')) assert.deepEqual(parent.folders.map(f=>f.title),['Séries','Films']);
  assert.deepEqual(collection('VOD France').folders.map(f=>f.title),['Films']);
});

test('Crunchyroll + AniList keeps anime Series and anime Films',()=>{
  const crunchy=collection('Crunchyroll + AniList');
  assert.deepEqual(crunchy.folders.map(f=>f.title),['Séries','Films']);
  const series=api._internals.resolveArchiveCatalog('archives-fr-v1-series-crunchyroll-2026-08','series',fixedNow,tz);
  const films=api._internals.resolveArchiveCatalog('archives-fr-v1-movie-crunchyroll-2026-08','movie',fixedNow,tz);
  assert.equal(series.source,'crunchyroll-anime-combined');
  assert.equal(films.source,'tmdb-streaming');
});

test('France free/replay platforms accept free and ads monetization modes',()=>{
  assert.deepEqual(api._internals.providerMonetizationTypes('france-tv'),['flatrate','free','ads']);
  assert.deepEqual(api._internals.providerMonetizationTypes('tf1-plus'),['flatrate','free','ads']);
  assert.deepEqual(api._internals.providerMonetizationTypes('m6-plus'),['flatrate','free','ads']);
  assert.deepEqual(api._internals.providerMonetizationTypes('arte'),['flatrate','free','ads']);
  const provider={slug:'france-tv',ids:[42]};
  const details={'watch/providers':{results:{FR:{free:[{provider_id:42}]}}}};
  assert.equal(api._internals.hasProviderAccess(details,provider),true);
});

test('France paid platforms stay flatrate-scoped',()=>{
  for(const slug of ['netflix','prime-video','disney-plus','hbo-max','apple-tv-plus','canal-plus','paramount-plus','crunchyroll','adn']){
    assert.deepEqual(api._internals.providerMonetizationTypes(slug),['flatrate']);
  }
});

test('French provider aliases resolve robustly',()=>{
  const defs=new Map(api._internals.PROVIDERS.map(p=>[p.slug,p]));
  const directory=[
    {id:101,name:'CANAL+',normalized:'canal',logoPath:'/canal.png'},
    {id:102,name:'HBO Max',normalized:'hbo max',logoPath:'/hbo.png'},
    {id:103,name:'Paramount Plus Amazon Channel',normalized:'paramount plus amazon channel',logoPath:'/paramount.png'},
    {id:104,name:'France TV',normalized:'france tv',logoPath:'/francetv.png'},
    {id:105,name:'TF1+',normalized:'tf1',logoPath:'/tf1.png'},
    {id:106,name:'Animation Digital Network',normalized:'animation digital network',logoPath:'/adn.png'}
  ];
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('canal-plus'),directory).ids,[101]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('hbo-max'),directory).ids,[102]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('paramount-plus'),directory).ids,[103]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('france-tv'),directory).ids,[104]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('tf1-plus'),directory).ids,[105]);
  assert.deepEqual(api._internals.resolveProviderFromDirectory(defs.get('adn'),directory).ids,[106]);
});

test('manifest uses unique France addon id and remains Collection-only on Home',()=>{
  const manifest=api._internals.buildManifest('https://fr-archives.example',fixedNow,tz);
  const providerCategoryCount=api._internals.ARCHIVE_SERIES_PROVIDERS.length+api._internals.ARCHIVE_FILM_PROVIDERS.length;
  assert.equal(manifest.id,'com.nuvio.calendar.archives.fr');
  assert.equal(manifest.version,'1.0.0');
  assert.equal(manifest.name,'Nuvio Calendar Archives France');
  assert.equal(manifest.catalogs.length,providerCategoryCount*(5+36));
  assert(manifest.catalogs.every(c=>c.showInHome===false));
});

test('France Collections use unique IDs/addon ID so they do not overwrite the other project',()=>{
  const payload=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  assert(payload.every(c=>c.id.startsWith('calendar-archives-fr-')));
  for(const parent of payload){
    assert.equal(parent.pinToTop,true);
    assert.equal(parent.viewMode,'FOLLOW_LAYOUT');
    for(const f of parent.folders){
      assert.equal(f.tileShape,'LANDSCAPE');
      assert.equal(f.hideTitle,true);
      assert(f.sources.every(s=>s.addonId==='com.nuvio.calendar.archives.fr'));
    }
  }
});

test('periods then month+years are descending and import is stable across September rollover',()=>{
  const august=api._internals.buildNuvioCollectionsImport(fixedNow,tz,'https://fr-archives.example');
  const september=api._internals.buildNuvioCollectionsImport(fixedSep,tz,'https://fr-archives.example');
  assert.deepEqual(september,august);
  const sources=folder(august[0],'Séries').sources.map(s=>s.catalogId);
  assert.deepEqual(sources.slice(0,5),[
    'archives-fr-v1-series-netflix-today','archives-fr-v1-series-netflix-tomorrow','archives-fr-v1-series-netflix-yesterday','archives-fr-v1-series-netflix-lastweek','archives-fr-v1-series-netflix-nextweek'
  ]);
  assert(sources.indexOf('archives-fr-v1-series-netflix-2026-09')<sources.indexOf('archives-fr-v1-series-netflix-2026-08'));
});

test('French VOD is Films-only and uses FR archive IDs',()=>{
  const vod=api._internals.resolveArchiveCatalog('archives-fr-v1-movie-vod-fr-2026-08','movie',fixedNow,tz);
  assert(vod);
  assert.equal(vod.source,'tmdb-vod');
  assert.equal(api._internals.resolveArchiveCatalog('archives-fr-v1-series-vod-fr-2026-08','series',fixedNow,tz),null);
});

test('France Modern covers and hero wordmarks keep large platform branding',()=>{
  const fake='data:image/png;base64,AAECAwQ=';
  const card=api._internals.platformCategoryCardSvg('canal-plus','series',fake);
  const hero=api._internals.platformWordmarkSvg('canal-plus',fake,'series');
  const backdrop=api._internals.platformBackdropSvg('hbo-max','movie',fake);
  assert.match(card,/CANAL\+/);
  assert.match(card,/SÉRIES/);
  assert.match(card,/data:image\/png;base64,AAECAwQ=/);
  assert.match(hero,/CANAL\+/);
  assert.match(hero,/width="1400" height="300"/);
  assert.match(backdrop,/HBO Max/);
  assert.match(backdrop,/FILMS/);
});
