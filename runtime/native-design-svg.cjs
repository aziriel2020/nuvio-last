'use strict';
// SVG vector overlay: native TMDB image bytes embedded as data URLs.
// The server does not recode images or generate JPEGs. AndroidSVG does rendering.
const ALLOWED=/^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\/[a-zA-Z0-9_/-]{1,210}\.(?:jpg|jpeg|png|webp)$/i;
const TYPES=new Set(['image/jpeg','image/png','image/webp']);
function escapeXml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function clip(s,n=55){const x=String(s??'').replace(/\s+/g,' ').trim();return x.length>n?x.slice(0,n-1).trimEnd()+'…':x;}
function validImage(s){return typeof s==='string'&&ALLOWED.test(s);}
function imageData(bytes,mime){if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>3750000||!TYPES.has(mime))throw Error('Invalid image');return 'data:'+mime+';base64,'+bytes.toString('base64');}
async function remoteImage(url,fetcher=globalThis.fetch){
  if(!validImage(url))throw Error('Invalid TMDB image URL');
  const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(3500),headers:{Accept:'image/jpeg,image/png,image/webp'}});
  if(!r.ok)throw Error('Image source unavailable');
  const mime=String(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!TYPES.has(mime)||Number(r.headers.get('content-length')||0)>3750000)throw Error('Invalid image MIME/size');
  return imageData(Buffer.from(await r.arrayBuffer()),mime);
}
function renderSvg(meta,art,bgData,logoData=null,{large=false,filmDetails=false}={}){
  const isMovie=meta.type==='movie';
  // Film-only detail typography, independent of the approved V4 series and logo.
  const boostFilmDetails=large&&filmDetails&&isMovie;
  const services=Array.isArray(art.platforms)?art.platforms:[];
  const provider=services.length===1?clip(services[0],24).toUpperCase():null;
  const platformWidth=provider?Math.min(450,Math.max(210,provider.length*27+70)):0;
  const platformX=1540-platformWidth;
  const typeX=provider?platformX-209:1347;
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(art.firstRelease||''))?art.firstRelease:null;
  const formattedDate=date?date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4):'';
  const score=Number(art.tmdbScore);
  const rating=Number.isFinite(score)&&score>0?'★ TMDB '+score.toFixed(1)+'/10':null;
  const seasonCount=Number(art.seasonCount);
  const seasons=!isMovie&&Number.isInteger(seasonCount)&&seasonCount>0?seasonCount+(seasonCount===1?' SAISON':' SAISONS'):null;
  const properties=[date?.slice(0,4),rating,seasons].filter(Boolean).join('  •  ');
  const genres=(Array.isArray(art.genres)?art.genres:[]).slice(0,3).map(x=>clip(x,24)).join('  •  ');
  const title=clip(meta.name,37);
  const titleSize=large?(title.length>29?84:title.length>20?105:136):(title.length>29?75:title.length>20?93:120);
  // The global URL has no catalog-month placeholder. Show only the actual
  // latest confirmed episode, never claim it belongs to the browsed month.
  const episode=!isMovie&&art.latestEpisode&&
    Number.isInteger(art.latestEpisode.season)&&art.latestEpisode.season>0&&
    Number.isInteger(art.latestEpisode.episode)&&art.latestEpisode.episode>0&&
    /^\d{4}-\d{2}-\d{2}$/.test(String(art.latestEpisode.date||''))
    ?art.latestEpisode:null;
  const episodeDate=episode?episode.date.slice(8,10)+'/'+episode.date.slice(5,7)+'/'+episode.date.slice(0,4):null;
  const episodeLabel=episode?'DERNIER ÉPISODE  •  S'+String(episode.season).padStart(2,'0')+' E'+String(episode.episode).padStart(2,'0'):null;
  const badge=provider?'<rect x="'+platformX+'" y="42" width="'+platformWidth+'" height="'+(large?122:108)+'" rx="23" fill="#03112a" stroke="#38bdf8" stroke-width="5"/><text x="'+(platformX+platformWidth/2)+'" y="'+(large?123:115)+'" font-family="sans-serif" font-weight="bold" font-size="'+(large?57:51)+'" fill="#fff" text-anchor="middle">'+escapeXml(provider)+'</text>':'';
  const logo=logoData?'<image x="72" y="'+(large?336:383)+'" width="'+(large?900:750)+'" height="'+(large?282:238)+'" preserveAspectRatio="xMinYMid meet" href="'+escapeXml(logoData)+'"/>':'<text x="74" y="'+(large?613:619)+'" font-size="'+titleSize+'" font-family="sans-serif" font-weight="bold" fill="#fff">'+escapeXml(title)+'</text>';
  const propertyText=properties?'<text x="78" y="'+(large?715:721)+'" font-family="sans-serif" font-size="'+(boostFilmDetails?80:(large?69:60))+'" fill="#fff" font-weight="bold">'+escapeXml(properties)+'</text>':'';
  const secondaryText=episodeLabel
    ?'<text x="78" y="'+(large?799:801)+'" font-size="'+(large?77:67)+'" font-family="sans-serif" font-weight="bold" fill="#fff">'+escapeXml(episodeLabel)+'</text>'
    :genres?'<text x="78" y="'+(large?798:800)+'" font-family="sans-serif" font-size="'+(boostFilmDetails?75:(large?64:54))+'" font-weight="bold" fill="#e7f1ff">'+escapeXml(clip(genres,boostFilmDetails?35:(large?42:55)))+'</text>':'';
  const bottomLabel=episodeDate?'DIFFUSION : '+episodeDate:
    formattedDate?(isMovie?'SORTIE : ':'1RE DIFFUSION : ')+formattedDate:'';
  const bottomText=bottomLabel?'<text x="78" y="'+(large?873:868)+'" font-size="'+(boostFilmDetails?77:(large?65:56))+'" font-family="sans-serif" font-weight="bold" fill="#8edfff">'+escapeXml(bottomLabel)+'</text>':'';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">'+
    '<defs><linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#071525" stop-opacity=".13"/><stop offset="43%" stop-color="#071525" stop-opacity=".19"/><stop offset="100%" stop-color="#041a3e" stop-opacity=".99"/></linearGradient></defs>'+
    '<image x="0" y="0" width="1600" height="900" preserveAspectRatio="xMidYMid slice" href="'+escapeXml(bgData)+'"/>'+
    '<rect width="1600" height="900" fill="url(#blue)"/>'+badge+
    '<rect x="'+typeX+'" y="42" width="193" height="'+(large?122:108)+'" rx="23" fill="#0788c5"/><text x="'+(typeX+96.5)+'" y="'+(large?123:115)+'" font-size="'+(large?62:55)+'" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">'+(isMovie?'FILM':'SÉRIE')+'</text>'+
    logo+propertyText+secondaryText+bottomText+
    '<rect width="1600" height="900" fill="none" stroke="#d6f0ff" stroke-opacity=".16" stroke-width="5"/></svg>';
}
function renderSvgLegacy(meta,art,bgData,logoData=null){
  const isMovie=meta.type==='movie';
  const services=Array.isArray(art.platforms)?art.platforms:[];
  const provider=services.length===1?clip(services[0],24).toUpperCase():null;
  const platformWidth=provider?Math.min(450,Math.max(190,provider.length*25+65)):0;
  const platformX=1540-platformWidth;
  const typeX=provider?platformX-200:1360;
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(art.firstRelease||''))?art.firstRelease:null;
  const formattedDate=date?date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4):'';
  const score=Number(art.tmdbScore);
  const rating=Number.isFinite(score)&&score>0?'★ TMDB '+score.toFixed(1)+'/10':null;
  const seasonCount=Number(art.seasonCount);
  const seasons=!isMovie&&Number.isInteger(seasonCount)&&seasonCount>0?seasonCount+(seasonCount===1?' SAISON':' SAISONS'):null;
  const properties=[date?.slice(0,4),rating,seasons].filter(Boolean).join('   •   ');
  const genres=(Array.isArray(art.genres)?art.genres:[]).slice(0,3).map(x=>clip(x,24)).join('  •  ');
  const title=clip(meta.name,37);
  const titleSize=title.length>25?65:89;
  const badge=provider?'<rect x="'+platformX+'" y="42" width="'+platformWidth+'" height="94" rx="23" fill="#03112a" stroke="#38bdf8" stroke-width="5"/><text x="'+(platformX+platformWidth/2)+'" y="105" font-family="sans-serif" font-weight="bold" font-size="43" fill="#fff" text-anchor="middle">'+escapeXml(provider)+'</text>':'';
  const logo=logoData?'<image x="76" y="413" width="620" height="208" preserveAspectRatio="xMinYMid meet" href="'+escapeXml(logoData)+'"/>':'<text x="76" y="616" font-size="'+titleSize+'" font-family="sans-serif" font-weight="bold" fill="#fff">'+escapeXml(title)+'</text>';
  const propertyText=properties?'<text x="80" y="719" font-family="sans-serif" font-size="44" fill="#fff" font-weight="bold">'+escapeXml(properties)+'</text>':'';
  const genreText=genres?'<text x="80" y="791" font-family="sans-serif" font-size="39" fill="#e7f1ff">'+escapeXml(clip(genres,68))+'</text>':'';
  const releaseText=formattedDate?'<text x="80" y="852" font-size="44" font-family="sans-serif" font-weight="bold" fill="#62ceff">SORTIE : '+escapeXml(formattedDate)+'</text>':'';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">'+
    '<defs><linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#071525" stop-opacity=".20"/><stop offset="49%" stop-color="#071525" stop-opacity=".20"/><stop offset="100%" stop-color="#041a3e" stop-opacity=".98"/></linearGradient></defs>'+
    '<image x="0" y="0" width="1600" height="900" preserveAspectRatio="xMidYMid slice" href="'+escapeXml(bgData)+'"/>'+
    '<rect width="1600" height="900" fill="url(#blue)"/>'+badge+
    '<rect x="'+typeX+'" y="42" width="178" height="94" rx="23" fill="#0788c5"/><text x="'+(typeX+89)+'" y="104" font-size="45" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">'+(isMovie?'FILM':'SÉRIE')+'</text>'+
    logo+propertyText+genreText+releaseText+
    '<rect width="1600" height="900" fill="none" stroke="#d6f0ff" stroke-opacity=".16" stroke-width="5"/></svg>';
}
function createSvgService({fetcher=globalThis.fetch,now=Date.now}={}){
  const cache=new Map();
  // One Films Monde scroll can display 24 different cards. A 32-entry SVG LRU
  // thrashes as soon as the next page is opened, triggering fresh TMDB downloads.
  const MAX_ENTRIES=128;
  const MAX_BYTES=96*1024*1024; // strict Oracle RAM bound (no disk JPEG cache)
  let cachedBytes=0;
  function remove(key){
    const entry=cache.get(key);
    if(!entry)return;
    cachedBytes-=entry.bytes||0;
    cache.delete(key);
  }
  async function make(meta,art,{legacy=false,large=false,filmDetails=false}={}){
    const key=JSON.stringify([meta.id,meta.type,meta.name,art,legacy,large,filmDetails]);
    const hit=cache.get(key);
    if(hit&&hit.until>now()){
      cache.delete(key);
      cache.set(key,hit); // LRU on successful hits
      return hit.promise;
    }
    if(hit)remove(key);
    const promise=(async()=>{
      // Fetch background and optional transparent wordmark concurrently. Before
      // this, a slow TMDB logo delayed the entire artwork by up to 3.5 seconds.
      const [bg,logo]=await Promise.all([
        remoteImage(art.backdrop,fetcher),
        validImage(art.logo)?remoteImage(art.logo,fetcher).catch(()=>null):Promise.resolve(null)
      ]);
      return legacy?renderSvgLegacy(meta,art,bg,logo):renderSvg(meta,art,bg,logo,{large,filmDetails});
    })();
    const entry={promise,until:now()+15*60*1000,bytes:0};
    cache.set(key,entry);
    promise.then(svg=>{
      if(cache.get(key)!==entry)return;
      entry.bytes=Buffer.byteLength(svg,'utf8');
      cachedBytes+=entry.bytes;
      while(cache.size>MAX_ENTRIES||cachedBytes>MAX_BYTES){
        remove(cache.keys().next().value);
      }
    }).catch(()=>{
      if(cache.get(key)===entry)remove(key);
    });
    while(cache.size>MAX_ENTRIES)remove(cache.keys().next().value);
    return promise;
  }
  return {make,cache};
}
module.exports={escapeXml,validImage,imageData,remoteImage,renderSvg,renderSvgLegacy,createSvgService};
