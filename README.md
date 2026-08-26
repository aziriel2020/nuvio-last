# Nuvio Calendar Archives — USA + France Coexist v1.0.0

Ce projet règle le conflit entre les éditions USA et France en les faisant tourner **dans un seul déploiement Vercel**, mais comme **deux addons Nuvio réellement séparés**.

## Pourquoi cette version coexiste proprement

Le déploiement expose :

- `https://TON-DOMAINE/us/manifest.json` → addon USA
  - ID : `com.nuvio.calendar.archives.us.coexist`
- `https://TON-DOMAINE/fr/manifest.json` → addon France
  - ID : `com.nuvio.calendar.archives.fr.coexist`
- `https://TON-DOMAINE/nuvio-collections-usa-fr.json` → import unique contenant les deux jeux de Collections
- `https://TON-DOMAINE/coexistence-check.json` → diagnostic automatique des collisions

Les catalogues restent séparés :

- USA : `archives-v3-*`
- France : `archives-fr-v1-*`

Les Collection IDs existants sont conservés afin que l'import combiné **remplace les anciennes Collections au lieu d'en créer des doublons**.

Les sources de ces Collections pointent désormais vers les nouveaux IDs addons `*.coexist`, ce qui empêche Nuvio de choisir par erreur une ancienne installation ayant le même ID d'addon.

## Affichage Modern Shield

Pour éviter de confondre les deux marchés, les parents sont maintenant explicites :

```text
🇺🇸 Netflix
🇺🇸 Prime Video
🇺🇸 Disney+
...
🇺🇸 Crunchyroll + AniList
🇺🇸 VOD

🇫🇷 Netflix
🇫🇷 Prime Video
🇫🇷 Disney+
🇫🇷 HBO Max
🇫🇷 CANAL+
🇫🇷 france.tv
🇫🇷 TF1+
🇫🇷 M6+
🇫🇷 ARTE
🇫🇷 Crunchyroll + AniList
🇫🇷 ADN
🇫🇷 VOD France
```

Chaque parent conserve :

```text
Plateforme
├── Séries
│   ├── Aujourd’hui
│   ├── Demain
│   ├── Hier
│   ├── Semaine passée
│   ├── La semaine suivante
│   ├── mois + années en décroissant
│   └── contenus
└── Films
    └── mêmes périodes + mois
```

Les visuels restent 16:9 Modern avec logos/wordmarks et utilisent des URLs distinctes `/us/...` et `/fr/...`, avec un numéro de révision visuelle différent dans chaque marché pour éviter les collisions de cache.

## Installation / migration

Déploie **ce dossier racine** comme un seul projet Vercel et configure ta clé TMDb (`TMDB_READ_TOKEN` ou `TMDB_API_KEY`).

Ensuite, dans Nuvio :

1. installe `https://TON-DOMAINE/us/manifest.json` ;
2. installe `https://TON-DOMAINE/fr/manifest.json` ;
3. importe **une seule fois** `https://TON-DOMAINE/nuvio-collections-usa-fr.json`.

L'import combiné remplace les anciennes Collections USA/France grâce à leurs IDs existants. Les nouvelles Collections référencent uniquement les nouveaux addons `*.coexist`.

Une fois que tout s'affiche correctement, tu peux supprimer les **anciens addons USA et France** de Nuvio pour alléger la liste. Ne supprime pas les nouvelles entrées dont les URLs se terminent par `/us` et `/fr`.

## Vérification

Ouvre :

```text
https://TON-DOMAINE/coexistence-check.json
```

La valeur attendue est :

```json
{"safe": true}
```

Le diagnostic vérifie notamment :

- IDs addons différents ;
- aucun Collection ID en collision ;
- aucune clé de dossier en collision ;
- aucune clé de catalogue en collision ;
- 10 parents USA + 14 parents France ;
- URLs d'images enfermées dans leur namespace `/us` ou `/fr`.

## Tests

```bash
npm test
```

La commande lance les tests complets de l'engine USA, de l'engine France et de la couche de coexistence.
