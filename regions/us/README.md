# Nuvio Calendar Archives v1.5.3 — NVIDIA Shield / Modern

Cette version garde l’architecture native Nuvio validée et ajoute les périodes automatiques, la fusion Crunchyroll + animes et une refonte complète des visuels.

## Arborescence finale

```text
Netflix
├── Séries
│   ├── Aujourd’hui
│   ├── Demain
│   ├── Hier
│   ├── Semaine passée
│   ├── La semaine suivante
│   ├── Août 2026
│   ├── Juillet 2026
│   ├── ...
│   └── Janvier 2025
└── Films
    └── mêmes périodes + mêmes mois

Prime Video
├── Séries
└── Films

Disney+
├── Séries
└── Films

Max
├── Séries
└── Films

Apple TV+
├── Séries
└── Films

Paramount+
├── Séries
└── Films

Peacock
├── Séries
└── Films

Hulu
├── Séries
└── Films

Crunchyroll + AniList
├── Séries
│   └── Crunchyroll streaming + animes AniList combinés dans les mêmes lignes
└── Films
    └── films d’anime Crunchyroll/streaming dans les mêmes périodes + mois

VOD
└── Films
```

## Les 5 périodes automatiques

Les cinq premières lignes sont identiques dans tous les dossiers Séries / Films :

1. `Aujourd’hui`
2. `Demain`
3. `Hier`
4. `Semaine passée`
5. `La semaine suivante`

Elles utilisent des IDs de catalogue stables. Leur fenêtre de dates est recalculée côté serveur à partir du fuseau du spectateur.

Exemple le 24 août 2026 à Bruxelles :

- Aujourd’hui : 24 août 2026
- Demain : 25 août 2026
- Hier : 23 août 2026
- Semaine passée : 17 → 23 août 2026
- La semaine suivante : 31 août → 6 septembre 2026

Le lendemain, les mêmes lignes restent en place mais leur contenu se décale automatiquement. **Aucune réimportation quotidienne ou hebdomadaire.**

## Mois automatiques sur deux années visibles

Après les cinq périodes viennent les mois en ordre décroissant.

En août 2026 : `Août 2026`, `Juillet 2026`, ... `Janvier 2026`, puis `Décembre 2025` ... `Janvier 2025`.

Les mois futurs sont déjà pré-câblés. En août, Septembre 2026 est vide et Nuvio Modern le masque. Dès septembre, il commence à retourner ses contenus et apparaît automatiquement avant Août 2026. **Aucune réimportation mensuelle.**

Une année future est également pré-câblée pour le roulement annuel.

## Crunchyroll + AniList + films d’anime

La branche Anime séparée n’existe plus dans cette architecture.

Toutes les lignes `Crunchyroll + AniList → Séries` fusionnent :

- les sorties/séries Crunchyroll détectées côté streaming ;
- les airings anime AniList convertis vers les métadonnées Nuvio/TMDb.

Le parent **Crunchyroll + AniList** contient maintenant aussi un dossier **Films** pour les films d’anime / films streaming liés à Crunchyroll.

## Covers Modern HD

Les cartes `Séries` et `Films` restent en `LANDSCAPE` 16:9.

La v1.5.3 change le rendu :

- logo de plateforme beaucoup plus grand et centré ;
- logo TMDb Watch Provider chargé en résolution `original` au lieu de `w300` ;
- fond 1920×1080 entièrement vectoriel pour éviter la pixellisation ;
- overlay `SÉRIES` / `FILMS` conservé ;
- indication `PÉRIODES + MOIS` ;
- carte Crunchyroll Séries marquée `CRUNCHYROLL + ANIMES` et carte Films marquée `FILMS D’ANIME + STREAMING`.

Routes visuelles :

```text
/platform-category-card.svg?provider=netflix&category=series
/platform-category-card.svg?provider=netflix&category=films
/platform-backdrop.svg?provider=netflix&type=series
/platform-backdrop.svg?provider=netflix&type=movie
/platform-logo?provider=netflix&type=series
```

Pour obtenir les covers hébergées sur la Shield, importe le JSON depuis le déploiement :

```text
https://TON-DEPLOIEMENT/nuvio-collections.json
```

## Mise à jour depuis v1.4.0

Après déploiement de v1.5.3 :

1. mets à jour l’addon avec le nouveau `manifest.json` ;
2. réimporte **une seule fois** `/nuvio-collections.json` pour ajouter les cinq périodes, le parent **Crunchyroll + AniList** et le dossier **Films** ;
3. ensuite les changements de jour, semaine et mois se font automatiquement sans réimport.

Les IDs parents existants sont conservés pour remplacer proprement les Collections déjà importées.

## Configuration TMDb

Le contenu streaming et les logos utilisent TMDb. Configure soit :

```text
TMDB_READ_TOKEN=...
```

ou :

```text
TMDB_API_KEY=...
```

Puis, si nécessaire :

```bash
npm run configure
```

## Correctifs v1.5.3

- **Paramount+ renforcé** : prise en charge des variantes TMDb/JustWatch (`Paramount Plus`, Amazon Channel, Apple TV Channel, Premium, Basic with Ads) et fallback d’IDs connus.
- **Anti-crash Shield** : si une source distante tombe en erreur, le catalogue renvoie un JSON valide `{ "metas": [] }` en HTTP 200 au lieu de faire tomber le dossier Nuvio.
- **Cartes Modern refaites** : logo plateforme beaucoup plus grand, nom plateforme très lisible, `SÉRIES` / `FILMS` énorme, moins de petits textes.
- **Pas de doublon de titre** : les dossiers utilisent `hideTitle: true`, le libellé est intégré directement dans la carte 16:9.
- **Hero logo refait** : `/platform-logo` renvoie maintenant un vrai wordmark horizontal SVG, au lieu d’un gros carré d’icône TMDb dans le hero.
- **Backdrops simplifiés** : fond premium plus propre et lisible à distance sur Shield.
- **Anime** : parent **Crunchyroll + AniList**, avec dossiers **Séries** et **Films**.

## Tests

```bash
npm test
```

La suite vérifie notamment les cinq périodes, le changement automatique de date, l’ordre des sources, le passage août → septembre sans changement du JSON Collections, les mois futurs sans appel réseau, VOD Films, Crunchyroll + AniList, les films d’anime, et les covers Modern HD.
