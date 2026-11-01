'use strict';

// Optional collection pack, 100% addon/server-side. No Shield APK change,
// no native bridge, no new artwork generator or incompatible collection IDs.
// Each folder asks for at most four live catalogs instead of 100+ monthly rows.
const { withHeroTitles } = require('./collection-titles.cjs');
const { PULSE_PERIODS } = require('./pulse-periods.cjs');
const MAX_FOLDER_SOURCES = 4;
const DYNAMIC = /-(?:today|yesterday|lastweek|nextweek)$/;

function sourcesForRolling(base, type, makeCatalogId) {
  const installed = base?.sources?.find(s => s.provider === 'addon' && s.addonId)?.addonId;
  if (!installed) throw Error('Pulse requires an existing installed Nuvio addon source');
  return PULSE_PERIODS.map(period => ({
    provider: 'addon', addonId: installed, type,
    catalogId: makeCatalogId(period.key)
  }));
}

function slimFolder(template, id, title, sources) {
  if (!template || !Array.isArray(sources) || sources.length === 0 ||
      sources.length > MAX_FOLDER_SOURCES) throw Error('Pulse folder missing or oversized: ' + id);
  const keys = sources.map(s => [s.addonId,s.type,s.catalogId].join(':'));
  if (new Set(keys).size !== keys.length || sources.some(s =>
      !s.addonId || !['movie','series'].includes(s.type) || !s.catalogId)) {
    throw Error('Pulse folder has invalid or duplicate catalog source: ' + id);
  }
  return {
    ...template, id, title,
    // These original, approved cover/backdrop files are reused as-is.
    // Only the native header wordmark is regenerated for this new folder title.
    titleLogoUrl: null, hideTitle: true, focusGifEnabled: false,
    heroVideoUrl: null, sources,
    catalogSources: sources.map(({addonId,type,catalogId,genre}) =>
      ({addonId,type,catalogId,...(genre ? {genre} : {})}))
  };
}
function group(template,id,title,folders) {
  if(!template || !folders.length) throw Error('Pulse collection missing parent: ' + id);
  return {
    ...template,id,title,folders,viewMode:'FOLLOW_LAYOUT',showAllTab:false,
    pinToTop:true,focusGlowEnabled:true
  };
}
function originalFolder(parent,id) {
  const found=parent?.folders?.find(folder=>folder.id===id);
  if(!found) throw Error('Pulse source folder missing: '+id);
  return found;
}
function fromGlobal(folder) {
  // Global anime/VOD already has stable rolling descriptors. These are
  // preserved, including the dedicated Tokyo timezone for Japanese anime.
  const selected=folder.sources.filter(s=>DYNAMIC.test(s.catalogId)).slice(0,4);
  return selected;
}

function buildNuvioPulseCollections({origin,frEditorial,movies,series,global}) {
  if (!/^https?:\/\//.test(origin || '')) throw Error('Public origin required for Nuvio Pulse');
  const editorialIds=['editorial-movies-new','editorial-series-new',
    'editorial-series-returning','editorial-binge-watch-series'];
  const france=group(frEditorial,'nuvio-pulse-france','✨ NUVIO PULSE · France',
    editorialIds.map(id=>{
      const folder=originalFolder(frEditorial,id);
      return slimFolder(folder,'pulse-'+id,folder.title,folder.sources.slice(0,4));
    }));

  const movieViews=[
    ['all','🎞️ Toutes les sorties'],['streaming','📺 Streaming'],
    ['vod','💿 VOD'],['cinema','🎟️ Cinéma']
  ];
  const movieFolders=movieViews.map(([view,title])=>{
    const parent=movies.find(c=>c.id==='movies-world-'+view);
    const source=originalFolder(parent,'movies-world-'+view+'-all');
    return slimFolder(source,'pulse-movies-'+view,title,
      sourcesForRolling(source,'movie',period=>'movies-fr-'+view+'-all-'+period));
  });
  const movieParent=group(movies.find(c=>c.id==='movies-world-all'),
    'nuvio-pulse-movies','🎬 NUVIO PULSE · Films Monde',movieFolders);

  const seriesModes=[['premieres','🆕 Nouvelles séries & épisodes'],
    ['seasons','🔁 Nouvelles saisons']];
  const seriesFolders=seriesModes.map(([mode,title])=>{
    const parent=series.find(c=>c.id==='series-world-'+mode);
    const source=originalFolder(parent,'series-world-'+mode+'-all');
    return slimFolder(source,'pulse-series-'+mode,title,
      sourcesForRolling(source,'series',period=>'series-fr-'+mode+'-all-'+period));
  });
  const seriesParent=group(series.find(c=>c.id==='series-world-premieres'),
    'nuvio-pulse-series-v2','📺 NUVIO PULSE · Séries France V2',seriesFolders);

  const anime=global.find(c=>c.id==='calendar-archives-global-anime');
  const vod=global.find(c=>c.id==='calendar-archives-global-vod');
  const globalFolders=[...anime?.folders||[],...vod?.folders||[]].map(folder=>
    slimFolder(folder,'pulse-'+folder.id,folder.title,fromGlobal(folder)));
  const globalParent=group(anime,'nuvio-pulse-global',
    '🌍 NUVIO PULSE · Anime & VOD Monde',globalFolders);

  return withHeroTitles([france,movieParent,seriesParent,globalParent],origin);
}

module.exports={buildNuvioPulseCollections,MAX_FOLDER_SOURCES};
