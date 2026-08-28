# Nuvio TOTAL CINEMATIC — FR + US + Anime + Genres + VOD — v1.3.1

Version corrective complète pour Nuvio Modern / Shield.

## Correctifs v1.3.1

- **Anime global** : manifest corrigé pour exposer les catalogues `series` + `movie`; résolution AniList → TMDb assouplie pour les titres localisés; films d’animation recherchés séparément en JP (`ja`) et KR (`ko`).
- **Périodes Global Anime + VOD Mondiale** : chaque source de Collection est validée contre un catalogue nommé du manifest. Ordre fixe : Aujourd’hui, Demain, Hier, Semaine passée, La semaine suivante, puis Décembre 2030 → Janvier 2015.
- **Genres** : deux blocs/Collections natifs par région, dans cet ordre : `Genres · Films`, puis `Genres · Séries`. Chaque genre conserve ses 197 périodes/mois.
- **Typographie** : textes des cartes et backdrops nettement agrandis.
- **Backdrops** : 1920×1080, comportement cover via `preserveAspectRatio="xMidYMid slice"`.
- **Cartes** : 1600×900 paysage.

## Structure

- France : 16 Collections
- Global : 2 Collections (`Anime Japon + Corée`, `VOD Mondiale`)
- USA : 12 Collections
- Total : **30 Collections**
- Total folders : **119**
- Sources par folder calendrier : **197**
  - 5 périodes dynamiques
  - 192 mois (Décembre 2030 → Janvier 2015)

## URLs après déploiement

- `/fr/manifest.json`
- `/global/manifest.json`
- `/us/manifest.json`
- `/nuvio-collections-fr-global-usa.json`

Après déploiement de cette version, actualiser/réinstaller le manifest Global dans Nuvio, puis réimporter le JSON TOTAL pour que la nouvelle structure Genres Films/Séries et les catalogues Global soient pris en compte.
