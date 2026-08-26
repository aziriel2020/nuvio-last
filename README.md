# Nuvio TOTAL CINEMATIC — FR + US + Anime + Genres + VOD — v1.2.0

Déploiement cible : `https://nuvio-last.vercel.app`

Ce pack conserve les IDs de Collections/addons existants et refait uniquement la couche visuelle + les ajouts déjà présents.

## Addons
- France : `/fr/manifest.json`
- Global Anime + VOD : `/global/manifest.json`
- USA : `/us/manifest.json`

## Collections
- 15 Collections France : 14 existantes + `🇫🇷 Genres TMDb`
- 2 Collections globales : `🌍 Anime Japon + Corée` + `🌍 VOD Mondiale`
- 11 Collections USA : 10 existantes + `🇺🇸 TMDb Genres`
- Total : 28 Collections.

## Nouvelle direction visuelle v1.2.0
- Toutes les plateformes FR / US / Global utilisent un visuel cinéma avec des personnages différents.
- Chaque plateforme possède un master `card` et un master `backdrop` dans `assets/platform-art/<market>/`.
- Les 27 genres visuels uniques sont dans `assets/genre-art/shared/` et alimentent les cartes + hero backgrounds FR/US.
- Les Collections Genres ont aussi un grand backdrop montage dédié.
- Les logos restent rendus par la couche Nuvio/TMDb afin de conserver des noms/wordmarks propres.

## Sécurité migration
Les IDs existants n'ont pas été renommés : réimporter le JSON combiné met à jour les mêmes Collections au lieu d'en créer une deuxième copie. Les nouvelles Collections Genres gardent leurs IDs dédiés.

## Import principal
Après déploiement, utiliser `imports/nuvio-collections-fr-global-us-all.json`.
