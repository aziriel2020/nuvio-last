# Nuvio TOTAL CINEMATIC — FR + US + Anime + Genres + VOD — v1.3.0

Déploiement cible : `https://nuvio-last.vercel.app`

Ce pack conserve les IDs de Collections/addons existants, garde tous les visuels v1.3.0 et corrige la structure **Genres TMDb** pour qu'elle suive exactement les mêmes périodes que tout le reste du projet.

## Addons
- France : `/fr/manifest.json`
- Global Anime + VOD : `/global/manifest.json`
- USA : `/us/manifest.json`

## Collections
- 15 Collections France : 14 existantes + `🇫🇷 Genres TMDb`
- 2 Collections globales : `🌍 Anime Japon + Corée` + `🌍 VOD Mondiale`
- 11 Collections USA : 10 existantes + `🇺🇸 TMDb Genres`
- Total : 28 Collections.

## Règle de périodes — appliquée partout
Chaque dossier de plateforme, Anime/VOD et désormais **chaque dossier de genre** commence par :
1. Aujourd’hui
2. Demain
3. Hier
4. Semaine passée
5. La semaine suivante

Puis viennent les mois + années pré-câblés, dans le même ordre décroissant. Avec la base 2026 du projet : **5 périodes + 192 mois (2015→2030) = 197 sources par dossier**.

Pour compatibilité, l'ancien ID d'un genre (ex. `genres-fr-movie-28`) est conservé et devient la ligne **Aujourd’hui**. Les autres périodes/mois ont des IDs complémentaires stables.

## Visuels
- Toutes les plateformes FR / US / Global utilisent un visuel cinéma avec des personnages variés.
- Chaque plateforme possède un master `card` et un master `backdrop` dans `assets/platform-art/<market>/`.
- Les 27 genres visuels uniques sont dans `assets/genre-art/shared/` et alimentent cartes + hero backgrounds FR/US.
- Les Collections Genres ont un grand backdrop montage dédié.
- Les logos restent rendus par la couche Nuvio/TMDb pour conserver des noms/wordmarks propres.

## Sécurité migration
Les IDs de Collections existantes n'ont pas été renommés. Réimporter le JSON combiné met à jour les mêmes Collections. Aucun nettoyage automatique n'est effectué.

## Import principal
Après déploiement, utiliser `imports/nuvio-collections-fr-global-us-all.json` ou directement l'URL déployée `/nuvio-collections-fr-global-usa.json`.
