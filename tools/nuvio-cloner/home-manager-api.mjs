import {
  fingerprint, parseHome, parseCollections, validateCollections, validateHome
} from './home-manager-logic.mjs';

const SHARE_PLATFORM='home_catalog_shared';

export function createHomeManagerApi({login,checkedProfile,rpc,appError}) {
  async function pull(token,profileId) {
    const [homeRows,collectionRows]=await Promise.all([
      rpc(token,'sync_pull_home_catalog_settings',{p_profile_id:profileId,p_platform:SHARE_PLATFORM}),
      rpc(token,'sync_pull_collections',{p_profile_id:profileId})
    ]);
    return {home:parseHome(homeRows),collections:parseCollections(collectionRows)};
  }
  async function authenticated(account,profileId) {
    const token=await login(account);
    await checkedProfile(token,profileId);
    return token;
  }
  return {
    async load({account,profileId}) {
      const token=await authenticated(account,profileId);
      const data=await pull(token,profileId);
      return {...data,hashes:{
        home:fingerprint(data.home),
        collections:fingerprint(data.collections)
      }};
    },
    async save({account,profileId,expected,changes,home,collections}) {
      const token=await authenticated(account,profileId);
      if(!expected || !changes || typeof changes!=='object')
        throw appError('Recharge la configuration avant d’enregistrer',400);
      const saveHome=changes.home===true,saveCollections=changes.collections===true;
      if(!saveHome&&!saveCollections) throw appError('Aucune modification sélectionnée',400);
      const old=await pull(token,profileId);
      if(saveHome && (!expected.home || expected.home!==fingerprint(old.home)))
        throw appError('L’accueil a changé sur un autre appareil : recharge avant de sauvegarder',409);
      if(saveCollections && (!expected.collections || expected.collections!==fingerprint(old.collections)))
        throw appError('Les collections ont changé sur un autre appareil : recharge avant de sauvegarder',409);

      let newCollections=old.collections;
      if(saveCollections){
        try{newCollections=validateCollections(collections);}
        catch(e){throw appError(e.message,400);}
        if(old.collections.length>0 && newCollections.length===0)
          throw appError('La suppression de toutes les collections n’est pas appliquée par Nuvio : opération refusée',409);
      }
      let newHome=old.home;
      if(saveHome){
        try{newHome=validateHome(home,old.home,newCollections);}
        catch(e){throw appError(e.message,400);}
      }
      if(saveCollections){
        const removed=new Set(old.collections.filter(c=>!newCollections.some(n=>n.id===c.id)).map(c=>c.id));
        const currentHome=saveHome?newHome:old.home;
        if(currentHome?.items?.some(i=>i.is_collection && removed.has(i.collection_id)))
          throw appError('Une collection supprimée figure encore sur l’accueil : retire sa rangée avant la sauvegarde',409);
      }
      // Scoped writes ONLY. Never touch profiles, auth, watch progress or Oracle catalogs.
      // Collections are written first so newly referenced home collection rows resolve.
      const saved=[];
      if(saveCollections){
        await rpc(token,'sync_push_collections',{p_profile_id:profileId,p_collections_json:newCollections});
        saved.push('collections');
      }
      if(saveHome){
        try{
          await rpc(token,'sync_push_home_catalog_settings',{
            p_profile_id:profileId,p_platform:SHARE_PLATFORM,p_settings_json:newHome
          });
        }catch(e){
          if(saved.length) throw appError('Collections enregistrées, mais accueil non enregistré. Recharge la page pour vérifier : '+e.message,502);
          throw e;
        }
        saved.push('home');
      }
      const verified=await pull(token,profileId);
      return {saved,home:verified.home,collections:verified.collections,hashes:{
        home:fingerprint(verified.home),collections:fingerprint(verified.collections)
      }};
    }
  };
}
