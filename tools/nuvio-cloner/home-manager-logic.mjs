import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = value => typeof value === 'string';
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export function parseHome(rows) {
  const raw = rows?.[0]?.settings_json ?? null;
  const home = str(raw) ? JSON.parse(raw) : raw;
  if (home === null) return null;
  assert(object(home), 'Configuration accueil invalide');
  assert(Array.isArray(home.items), 'Liste des catalogues accueil absente');
  return home;
}

export function parseCollections(rows) {
  const raw = rows?.[0]?.collections_json ?? null;
  const data = str(raw) ? JSON.parse(raw) : raw;
  if (data === null) return [];
  assert(Array.isArray(data), 'Collections Nuvio invalides');
  return data;
}

const rowId = entry => entry.is_collection
  ? 'collection:' + entry.collection_id
  : 'catalog:' + JSON.stringify([entry.addon_id,entry.type,entry.catalog_id]);

export function validateCollections(data) {
  assert(Array.isArray(data) && data.length <= 300, 'Collections : liste invalide ou trop longue');
  const ids = new Set();
  for(const c of data) {
    assert(object(c) && str(c.id) && c.id.length>0 && c.id.length<160, 'Identifiant de collection invalide');
    assert(str(c.title) && c.title.trim().length>0 && c.title.length<=200, 'Titre de collection invalide');
    assert(!ids.has(c.id), 'Identifiants de collections en doublon');
    ids.add(c.id);
    assert(Array.isArray(c.folders) && c.folders.length<=150, 'Dossiers de collection invalides');
    for(const f of c.folders) {
      assert(object(f) && str(f.id) && f.id.length>0, 'Identifiant de dossier manquant');
      assert(str(f.title) && f.title.trim().length>0 && f.title.length<=200, 'Titre de dossier invalide');
      assert(Array.isArray(f.sources) || Array.isArray(f.catalogSources), 'Sources du dossier absentes');
      const sources = f.sources ?? f.catalogSources;
      assert(sources.length<=150 && sources.every(object), 'Sources du dossier invalides');
    }
  }
  return data;
}

export function validateHome(data, original, collections) {
  assert(original && object(original) && Array.isArray(original.items),
    'Aucun accueil synchronisé : édition refusée pour protéger la configuration locale');
  assert(object(data) && Array.isArray(data.items), 'Accueil : format invalide');
  assert(data.items.length>0 && data.items.length<=3000, 'Accueil : aucune rangée ou trop de rangées');
  assert(typeof data.hide_unreleased_content === 'boolean', 'Option de sortie invalide');
  const validCatalogs = new Set(original.items.filter(x=>!x.is_collection).map(rowId));
  const validCollections = new Set(collections.map(c=>c.id));
  const seen = new Set();
  const rows = data.items.map((x,i)=>{
    assert(object(x) && typeof x.is_collection==='boolean', 'Rangée invalide');
    assert(typeof x.enabled==='boolean' && str(x.custom_title) && x.custom_title.length<=160, 'Options de rangée invalides');
    if(x.is_collection){
      assert(str(x.collection_id) && validCollections.has(x.collection_id), 'Collection inconnue sur l’accueil');
    } else {
      assert(str(x.addon_id) && str(x.type) && str(x.catalog_id), 'Identifiant de catalogue invalide');
      assert(validCatalogs.has(rowId(x)), 'Impossible d’ajouter un catalogue non déclaré par un addon');
    }
    const id=rowId(x);
    assert(!seen.has(id), 'Rangée en doublon : '+id);seen.add(id);
    return {...x,order:i};
  });
  // A catalog removed from the visual list would be treated as non-existent after sync.
  // The UI hides items by enabled=false rather than silently dropping them.
  for(const item of original.items.filter(x=>!x.is_collection))
    assert(seen.has(rowId(item)), 'Masque les catalogues au lieu de les supprimer');
  return {...original,items:rows,hide_unreleased_content:data.hide_unreleased_content};
}

export function collectionHomeEntry(id,order) {
  return {addon_id:'',type:'',catalog_id:'',enabled:true,order,
    custom_title:'',is_collection:true,collection_id:id};
}
