# Nuvio Mobile / Desktop — profil expérimental « Collections sans Home »

## But

Eviter l'explosion des lignes Home et des requêtes d'affiches générées par les
catalogues calendaires utilisés dans les dossiers de Collections, sur les
clients **Nuvio Mobile** et **Nuvio Desktop**, sans changer leurs ID ni leurs
routes d'accès. Cette adaptation est **expérimentale** : ne pas remplacer
automatiquement les addons installés sur les appareils.

## Compatibilité identifiée dans les sources clients

Vérifiée dans les sources publiques NuvioMedia/NuvioMobile (branche
`cmp-rewrite`) et NuvioMedia/NuvioDesktop (branche `Dev`) :

- `features/home/HomeCatalogDefinitions.kt` crée des lignes Home uniquement
  pour les catalogues dont **aucun** `extra` n'a `isRequired: true`.
  L'indication `showInHome: false` n'est pas consultée dans ce filtre.
- `features/collection/CollectionCatalogResolver.kt` exige la présence
  de `type` + `catalogId` dans le manifeste, ce qui exclut `catalogs: []`.
- `features/collection/CollectionRepository.kt` autorise les catalogues
  avec `genre` obligatoire dans l'éditeur des Collections ; les autres
  extras obligatoires y rendent les catalogues indisponibles.

Le manifeste de ce profil préserve donc **tous les catalogues d'origine**,
mais déclare `genre` obligatoire, sans changer les ID ni les routes.
Les endpoints Nuvio Calendar eux-mêmes acceptent toujours les requêtes
sans ce paramètre, comme les dossiers existants les émettent.
Le profil retire aussi le support annoncé de `search` dans les catalogues
internes (notamment Films Monde / Séries), pour éviter leur sollicitation
comme fournisseurs de recherche globale.

## Six URL alternatives

A installer **uniquement pour des essais** sur un profil non partagé avec
la Shield, en remplaçant le manifeste original du même addon :

| Addon | Chemin |
|---|---|
| France | `/fr/mobile-desktop-collections/manifest.json` |
| USA | `/us/mobile-desktop-collections/manifest.json` |
| Türkiye | `/tr/mobile-desktop-collections/manifest.json` |
| Global | `/global/mobile-desktop-collections/manifest.json` |
| Films Monde | `/movies/mobile-desktop-collections/manifest.json` |
| Séries France V2 | `/series-v2/mobile-desktop-collections/manifest.json` |

Le domaine public reste `https://141-145-215-202.nip.io`.

## Points de contrôle avant activation normale

1. Sauvegarder l'export des Collections.
2. Tester avec un profil Nuvio indépendant : les installations d'addons
   peuvent se synchroniser entre Mobile, Desktop et la Shield.
3. Installer seulement le manifeste France alternatif, sans garder
   simultanément la version normale avec le même addon ID.
4. Vérifier l'absence de lignes France dans Home et l'absence de chargement
   massif d'affiches au démarrage, puis naviguer dans les dossiers et ouvrir
   plusieurs périodes et mois.
5. Vérifier l'éditeur de Collections : l'app peut présenter la sélection de
   genre comme obligatoire alors qu'une source déjà importée sans genre
   continue d'être valide côté serveur.
6. Vérifier le sélecteur Découverte/Recherche : il n'existe **aucun**
   mécanisme connu dans ces clients pour masquer entièrement les catalogues
   déclarés du sélecteur Découverte tout en les conservant dans leur
   manifeste. Le profil supprime le support search annoncé pour les
   catalogues internes, mais cela ne garantit pas leur absence dans le
   sélecteur Découverte.
7. Après validation, répéter sur les autres régions. En cas de régression,
   réinstaller l'URL canonique `/REGION/manifest.json`.

## Périmètre inchangé

Pas de modification des Collections ni de leur JSON ; aucun changement de
date, de période dynamique, de réédition, de filtre JustWatch/TMDb,
de catalogue ID, d'addon ID, de métadonnées ni des calendriers jusqu'en 2030.

Les manifestes standards et le profil Shield `collections-only` restent
inchangés. Tests de non-régression :
`node --test test/mobile-desktop-collections.test.js`.

## Limite technique restante

La suppression *complète* de catalogues déclarés de l'interface Découverte
requiert une évolution côté application Nuvio Mobile/Desktop (séparer
`enabled`, `showInHome` et `showInDiscover`, et accepter les IDs
non déclarés dans les Collections). Ne pas revendiquer ce point comme
corrigé côté addon uniquement.
