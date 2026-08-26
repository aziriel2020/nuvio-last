# Nuvio Calendar Archives France v1.0.0 — NVIDIA Shield / Modern

Projet séparé de l’édition USA/monde. Cette édition est verrouillée sur **la France** : marché TMDb `FR`, langue `fr-FR`, fuseau `Europe/Paris`, VOD achat/location France et plateformes pertinentes pour le marché français.

## Arborescence

```text
Netflix
├── Séries
└── Films

Prime Video
├── Séries
└── Films

Disney+
├── Séries
└── Films

HBO Max
├── Séries
└── Films

Apple TV+
├── Séries
└── Films

CANAL+
├── Séries
└── Films

Paramount+
├── Séries
└── Films

france.tv
├── Séries
└── Films

TF1+
├── Séries
└── Films

M6+
├── Séries
└── Films

ARTE
├── Séries
└── Films

Crunchyroll + AniList
├── Séries
└── Films

ADN
├── Séries
└── Films

VOD France
└── Films
```

## Dans chaque dossier Séries / Films

Les lignes sont identiques à l’autre projet :

1. `Aujourd’hui`
2. `Demain`
3. `Hier`
4. `Semaine passée`
5. `La semaine suivante`
6. mois + année en ordre décroissant

Exemple en août 2026 :

```text
Aujourd’hui
Demain
Hier
Semaine passée
La semaine suivante
Août 2026
Juillet 2026
Juin 2026
...
Janvier 2026
Décembre 2025
...
Janvier 2025
```

Les mois futurs sont pré-câblés mais vides. En septembre, `Septembre 2026` commence à retourner ses contenus automatiquement. **Aucune réimportation mensuelle.**

## France réellement forcée

Cette édition ne dépend pas de l’IP de la Shield :

- fuseau : `Europe/Paris`
- marché Watch Providers : `FR`
- langue TMDb : `fr-FR`
- cinéma / digital : région France
- VOD : boutiques achat/location disponibles en France

Cela évite qu’un déploiement Vercel situé ailleurs ou qu’un VPN fasse basculer les dates et catalogues vers les USA.

## Plateformes gratuites françaises

`france.tv`, `TF1+`, `M6+` et `ARTE` ne sont pas limitées au seul mode `flatrate`. L’édition France accepte aussi les disponibilités TMDb `free` et `ads`, ce qui est nécessaire pour les services gratuits/replay.

## Crunchyroll + AniList / ADN

- `Crunchyroll + AniList → Séries` fusionne les sorties Crunchyroll et les airings AniList convertibles vers TMDb/Nuvio.
- `Crunchyroll + AniList → Films` garde les films d’anime disponibles via Crunchyroll.
- `ADN` est présent comme plateforme anime française séparée, avec Séries et Films.

## Modern Shield

Les parents sont des Collections natives Nuvio et les cartes `Séries` / `Films` sont :

- `LANDSCAPE` 16:9 ;
- `hideTitle: true` pour éviter le doublon de titre ;
- logo plateforme haute définition dans la carte ;
- wordmark horizontal large pour le hero ;
- backdrop 1920×1080 ;
- URLs visuelles révisées avec `v=fr100` pour éviter le cache d’une autre édition.

## Projet totalement séparé

Cette édition utilise :

```text
Addon ID: com.nuvio.calendar.archives.fr.coexist
Catalog IDs: archives-fr-v1-...
Collection IDs: calendar-archives-fr-...
```

Elle peut donc cohabiter avec l’autre projet sans remplacer ses Collections.

## Anti-crash Shield

Une panne TMDb/TVmaze/AniList ne doit jamais faire tomber un dossier Nuvio : une erreur upstream est convertie en catalogue vide valide HTTP 200 (`{"metas":[]}`), puis le dossier reste navigable.

## Installation

Après le déploiement :

1. ajoute l’addon avec `https://TON-DEPLOIEMENT/manifest.json` ;
2. importe **une fois** `https://TON-DEPLOIEMENT/nuvio-collections.json` ;
3. les changements jour/semaine/mois se font ensuite automatiquement.

Pour les vraies covers/logos sur Shield, importe bien le JSON **depuis l’URL déployée**, pas uniquement le fichier statique du ZIP, car les URLs d’images sont calculées à partir du domaine du déploiement.

## Configuration TMDb

Configure l’un des deux :

```text
TMDB_READ_TOKEN=...
```

ou :

```text
TMDB_API_KEY=...
```

Puis :

```bash
npm test
npm start
```

## Validation v1.0.0

La suite de tests vérifie notamment : France forcée, plateformes françaises, modes `free/ads`, CANAL+, HBO Max, Paramount+, france.tv/TF1+/M6+/ARTE, ADN, Crunchyroll + AniList, VOD France, coexistence avec l’autre addon, rollover août → septembre, zéro appel upstream pour les mois futurs, anti-crash et visuels Modern.
