'use strict';

const REVISION = 'collection-hero-titles-20261026-v1';
const clean = value => String(value || '').replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u200D]/gu,'').replace(/\s+/g,' ').trim().slice(0,120);
const escape = value => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let font;
const cache = new Map();

function withHeroTitles(collections, origin) {
  if (!origin) return collections;
  return collections.map(collection=>({ ...collection, folders:(collection.folders || []).map(folder=>{
    // Nuvio TV hides BOTH the tile caption and the native hero title when
    // hideTitle=true. A transparent wordmark supplies only the missing hero.
    if (!folder.hideTitle || String(folder.titleLogoUrl || '').trim()) return folder;
    const title=clean(folder.title),label=clean(collection.title);
    if (!title) return folder;
    const url=new URL('/collection-title.svg',origin);
    url.search=new URLSearchParams({title,label:label===title?'':label,v:REVISION});
    return {...folder,titleLogoUrl:url.href};
  })}));
}

function titleSvg(titleValue,labelValue='') {
  const title=clean(titleValue),label=clean(labelValue);
  if (!title) return null;
  const key=JSON.stringify([title,label]);
  if (cache.has(key)) return cache.get(key);
  if (!font) font=require('opentype.js').loadSync(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'));
  const path=(text,y,size,color)=>{
    const actual=Math.min(size,size*940/Math.max(1,font.getAdvanceWidth(text,size)));
    return `<path d="${font.getPath(text,24,y,actual).toPathData(2)}" fill="${color}"/>`;
  };
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="240" viewBox="0 0 1000 240" role="img"><title>${escape(title)}</title>${label?path(label,42,26,'#c6ccd6'):''}${path(title,label?144:128,88,'#ffffff')}<path d="M26 180H366" stroke="#6dc9f1" stroke-width="5" stroke-linecap="round"/></svg>`;
  if (cache.size>=128) cache.delete(cache.keys().next().value);
  cache.set(key,svg);return svg;
}

module.exports={REVISION,withHeroTitles,titleSvg};
