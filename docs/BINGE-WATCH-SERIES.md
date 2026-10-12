# Binge Watch · Séries — France

## Placement et fonctionnement

Septième dossier de la collection **🇫🇷 Tendances & Cinéma**. La structure Nuvio existante
`Collection → Folder → Sources` est respectée. Les six dossiers éditoriaux historiques,
leurs IDs et leurs illustrations ne changent pas.

**Dossier :** `editorial-binge-watch-series`  
**Titre :** `🍿 Binge Watch · Séries`  
**Accroche visuelle :** « Tous les épisodes dispo ».

| Catalogue | ID | Fenêtre |
| --- | --- | --- |
| Cette semaine | `editorial-binge-watch-series-thisweek` | lundi → aujourd'hui, Europe/Paris |
| Semaine passée | `editorial-binge-watch-series-lastweek` | lundi → dimanche précédents |
| Ce mois-ci | `editorial-binge-watch-series-thismonth` | 1er du mois → aujourd'hui |
| Le mois dernier | `editorial-binge-watch-series-lastmonth` | mois civil précédent |
| Cette année | `editorial-binge-watch-series-thisyear` | 1er janvier → aujourd'hui |

Les nouveaux IDs sont exposés dans `/fr/manifest.json` et réutilisés dans les imports
`/nuvio-collections-shield.json`, `/nuvio-collections-desktop.json` et combinés.

## Conditions d'éligibilité

Le backend interroge les découvertes TMDb « première diffusion » et « diffusion » pour
la période, puis la fiche série, les providers FR, la fiche de la saison et ses épisodes.

**Inclusion stricte :**
- série en streaming recensée pour la France (`watch/providers`, `FR`, flatrate/free/ads) ;
- saison normale (pas les épisodes spéciaux), avec 2 à 50 épisodes ;
- nombre d'épisodes détaillés égal au `episode_count` de la saison ;
- épisodes numérotés 1…N sans trou, doublon, date absente ou date future ;
- **toutes** les dates de diffusion des épisodes égales entre elles, dans la période ;
- date de première diffusion de la saison cohérente avec les épisodes.

**Exclusion :** sorties hebdomadaires, mini-séries incomplètes, données manquantes,
offre FR absente, programmation partielle, ambiguïté de date. Les mini-séries
sont admises si la même vérification réussit.

**Limite réelle :** TMDb décrit une **date de diffusion**, pas une garantie de
disponibilité instantanée de chaque vidéo. La présence d'un provider FR ne garantit pas
non plus que la saison complète est accessible maintenant. Cette première version est
donc un **signal documentaire conservateur**, et non une vérification par API de
chaque plateforme. Les descriptifs indiquent explicitement de vérifier dans Nuvio.
Un mode « certifié intégralement disponible » requerrait des données de disponibilité
fiables et datées fournies par les plateformes elles-mêmes.

La recherche des candidats est bornée en pages et résultats pour préserver les
ressources Oracle Always Free. Les périodes très longues peuvent donc être
**non exhaustives**. Cache des catalogues : 15 minutes.

## Art Shield/Desktop

- `/fr/binge-watch-cover.jpg?v=premium-cinema-v2` — **1600 × 900 JPEG** ;
- `/fr/binge-watch-backdrop.jpg?v=premium-cinema-v2` — **1920 × 1080 JPEG**.

Les rendus JPEG proviennent des deux images cinématiques WebP approuvées,
stockées dans `assets/collection-art/editorial-approved/`.
La cover est une composition 1600×900 avec le titre Binge Watch et le badge.
Le fond héro 1920×1080 est indépendant et sans texte afin de conserver le titre natif Nuvio.
Les deux rendus sont mémorisés, identifiés par SHA-256 et utilisent la révision `premium-cinema-v2`
qui invalide les anciennes URLs sur Shield et Desktop.

## Vérification

```bash
npm test
npm run test:oracle
```

Les tests `regions/fr/test/binge-watch.test.js` couvrent les périodes civiles,
les conditions d'éligibilité et les dimensions/types de l'illustration.
Les tests France/coexistence verrouillent les IDs, les cinq sources et leur ordre.

La fusion vers `main` déclencherait ensuite les workflows et le mécanisme de
déploiement existants ; aucune modification des fichiers OCI/secrets n'est nécessaire.
