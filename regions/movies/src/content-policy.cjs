'use strict';

const REVISION = 'fiction-first-20261026-v1';
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’]/g,"'");
const FICTION_GENRES = new Set(['28','12','18','80','14','36','27','9648','10749','878','53','10752','37','10751']);
const SELF = /^(self\b|himself\b|herself\b|themselves\b|lui-meme\b|elle-meme\b|soi-meme\b|narrat|presenter\b|host\b)/;

function contentKind({genres=[],title='',originalTitle='',description='',keywords=[],cast,video=false}={}) {
  const ids=genres.map(String), topics=keywords.map(normalize);
  const text=normalize(`${title}\n${originalTitle}\n${description}`);
  // Explicit descriptions identify the recorded format, not a story merely
  // featuring a comedian, musician or television host.
  const recordedStandup = /\b(stand[- ]?up (special|comedy special|performance|spectacle)|special de stand[- ]?up|spectacle (de stand[- ]?up|d'humour|humoristique))\b/.test(text);
  const recordedStage = /\b(concert (filme|enregistre|film)|captation (du|de son|d'un|de la|theatrale)|filmed (concert|theat(?:er|re)|play)|live concert|comedy special|special humoristique)\b/.test(text);
  const television = /\b(talk[- ]show|emission (speciale|de television)|television special|tv special|ceremonie de remise)\b/.test(text)
    || /^(wwe|aew|ufc)\s+\d/.test(normalize(title));
  const roles=(cast || []).map(c=>normalize(c.character).trim()).filter(Boolean);
  const narrative = ids.some(id=>FICTION_GENRES.has(id));
  if(video) return 'video';
  if(ids.some(id=>['10763','10764','10767'].includes(id))) return 'television';
  if(topics.some(k=>['television special','tv special','awards ceremony','game show','reality tv'].includes(k))) return 'television';
  if(topics.some(k=>['talk show','variety show','television talk show'].includes(k)) && (!narrative || (roles.length && roles.every(role=>SELF.test(role))))) return 'television';
  if(recordedStandup) return 'standup';
  // Topic keywords alone cannot exclude a fiction about stand-up comedy.
  if(!narrative && !ids.includes('99') && ids.includes('35') && topics.some(k=>['stand-up comedy','stand up comedy','stand-up','standup','one-man show','one-woman show'].includes(k))) return 'standup';
  if(recordedStage) return 'performance';
  if(topics.some(k=>['concert film','live concert','filmed theater','filmed theatre','filmed play','ballet performance','opera performance','sports event','wrestling match'].includes(k))) return 'performance';
  if(television && !narrative) return 'television';
  if(ids.includes('99')) return 'documentary';
  if(narrative) return 'fiction';
  if(ids.includes('35') || ids.includes('10402') || ids.includes('10770')) {
    if(roles.some(role=>!SELF.test(role))) return 'fiction';
    if(roles.length) return 'performance';
    // A bare Comedy/Music label is not proof that a special is a movie.
    // Existing ambiguous entries wait for the bounded metadata refresh.
    return 'review';
  }
  return ids.length ? 'fiction' : 'review';
}
function sqlKind(alias='s') {
  return `COALESCE((SELECT json_extract(cf.payload,'$.movieContentKind') FROM sources cf
    WHERE cf.show_id=${alias}.id AND cf.source='tmdb'),
    nuvio_movie_content_kind(${alias}.genres,${alias}.title,${alias}.original_title,${alias}.description))`;
}
function clause(genre='all',alias='s') { return `${sqlKind(alias)}='${genre==='standup'?'standup':genre==='99'?'documentary':'fiction'}'`; }
function metadata() { return {revision:REVISION,mainLists:'fiction',documentaries:'documentary-category-only',
  standup:'standup-category-only',excludedFormats:['performance','television','video'],ambiguousFormats:'await-metadata'}; }
module.exports={REVISION,contentKind,sqlKind,clause,metadata};
