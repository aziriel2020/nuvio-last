# Nuvio Séries Monde

Nouvel addon indépendant `com.nuvio.series.world.liveaction`, deux collections natives :

- **🌍 Toutes les séries · Par genres** : date de première diffusion de la série.
- **🌍 Retours & nouvelles saisons** : date de lancement d'une saison normale numéro 2 ou supérieur. Une seule fiche par série et période, à la dernière date correspondante.

Chaque collection a 25 dossiers : toutes les séries, les 15 genres TV hors Animation, genre non renseigné, puis Thriller, Horreur, Romance, Historique, Médical, Judiciaire, Espionnage et Mini-séries. Les thèmes complémentaires sont dérivés des genres TVmaze et des mots-clés exacts TMDB. Ils ne prétendent pas classifier chaque série sans métadonnées suffisantes.

## Navigation et dates

Chaque dossier expose « Toutes les dates · Récent → Ancien », les cinq périodes natives existantes (Aujourd’hui, Demain, Hier, Semaine passée, La semaine suivante), les mois décroissants jusqu'à janvier 2015, les années 2014 → 1900, Avant 1900 et Date inconnue. Les futurs mois sont pré-câblés jusqu'à au moins 2030, comme les calendriers existants. Les dates civiles utilisent Europe/Brussels ; les dates de diffusion sans heure restent des dates civiles de la source, sans inventer d'heure locale.

La vue générale exclut les dates futures et place les dates absentes à la fin. Les périodes futures explicites et les mois futurs montrent les annonces connues. Pagination de 100 fiches, sans plafond total de résultats ni filtre de popularité, note, pays, langue ou plateforme. Les archives anciennes sont annuelles pour éviter de multiplier les sources mensuelles sur Shield. Tous les résultats éligibles restent accessibles dans leur année.

## Exclusion de l'animation

Le genre TMDB 16, le type Animation de TVmaze et des mots-clés explicites d'animation excluent une fiche. Une exclusion provenant d'une source prime sur les genres non animés de l'autre source. Les séries japonaises avec acteurs, y compris adaptations de mangas, restent incluses. « Based on manga » n'est pas un signal d'animation.

Les fiches dont le médium est indéterminé restent en attente de classification. Les séries identifiées comme non animées mais sans date ou sans genre restent accessibles. Une correction motivée peut être appliquée via `SeriesStore.override(source, id, classification, reason)` ; elle est conservée lors des synchronisations suivantes.

Le filtrage dépend de la qualité des métadonnées : une fiche mal renseignée peut nécessiter une correction. L'addon n'affirme jamais couvrir toutes les productions ayant existé ni garantir une vidéo lisible.

## Index persistant et synchronisation

SQLite WAL : `/var/lib/nuvio-series/index.sqlite`, hors des releases et du cache HTTP élagué. Node **22.13+** requis (`node:sqlite`). Aucun nouvel abonnement ni service cloud requis.

Le worker `nuvio-series-sync.service` :

1. importe chaque jour la liste complète des identifiants TV TMDB, en streaming ;
2. remplit une file persistante de récupération des fiches et saisons ;
3. parcourt tout l'index des séries TVmaze, avec reprise au dernier numéro de page ;
4. suit les changements des deux sources et rafraîchit les séries ;
5. conserve ses points de reprise et applique un délai progressif après erreur.

L'import initial est **progressif** : il peut durer des heures ou plusieurs jours suivant la taille des bases et la disponibilité des API. Les collections peuvent être utilisées pendant ce remplissage. Le nombre de catalogues de périodes n'est pas le nombre de séries indexées. `/series/status.json` expose les compteurs réels, exclusions, fiches en attente, jobs à traiter et dernier cycle. Une panne de source ne vide pas les fiches déjà indexées. Les identifiants externes IMDb/TVDB servent à fusionner les doublons ; les homonymes ne sont pas fusionnés par titre.

Le worker est limité à 768 Mo et 25 % de CPU, tourne sans privilèges, et utilise un verrou de fichier pour empêcher deux exécutions simultanées. Les appels sont cadencés, les erreurs 429/5xx sont réessayées et les jobs persistent après redémarrage. Le token TMDB existant reste dans `/etc/nuvio/nuvio.env`.

## Routes à installer après déploiement

Sous le domaine de production existant :

- addon : `/series/manifest.json` ;
- import Shield : `/series/nuvio-collections.json` ou `/nuvio-collections-series.json` ;
- import Desktop : `/series/nuvio-collections-desktop.json` ou `/nuvio-collections-series-desktop.json` ;
- état réel de l'index : `/series/status.json`.

Installer l'addon puis importer les deux nouvelles collections une fois. Les quatre addons historiques et leurs imports combinés gardent leurs IDs, leur ordre et leur contenu. Les nouvelles URLs figurent aussi dans `/install.json`.

L'addon fournit catalogues et fiches/épisodes ; les sources vidéo continuent de dépendre des addons de lecture installés. Les séries sans IMDb utilisent les identifiants `tmdb:tv:ID` ou `tvmaze:ID`, dont la prise en charge dépend des addons de lecture.

## Cover à approuver

La proposition « SÉRIES MONDE — TOUS LES GENRES · TOUTES LES ÉPOQUES » a été générée et présentée dans la conversation. Elle n'est pas copiée dans le dépôt et n'est pas utilisée sans approbation de l'utilisateur. Les routes réutilisent provisoirement les visuels existants pour que le backend soit testable. Après approbation, ajouter l'asset choisi dans le dépôt, produire les variantes 1600×900 / 1920×1080, puis définir `NUVIO_SERIES_COVER_URL` ou sa valeur par défaut versionnée avant la mise en production.

## Validation

```bash
npm run test:series
npm test
npm run test:runtime
node scripts/test-series-runtime.mjs
```

L'intégration lance le véritable serveur Oracle sur une base de test temporaire. Elle contrôle les manifests, les imports Shield/Desktop, plusieurs pages de résultats, une correction d'animation visible sans redémarrage, le refus des fiches animées et le rendu JPEG des dossiers. Aucun credential de production n'est requis pour ces fixtures.

Sources de référence : [TMDB Daily ID Exports](https://developer.themoviedb.org/docs/daily-id-exports), [TMDB TV Discovery](https://developer.themoviedb.org/reference/discover-tv), [TVmaze API](https://www.tvmaze.com/api). TVmaze est crédité dans les fiches qui l'utilisent ; ses données sont sous CC BY-SA. Les conditions et crédits TMDB restent applicables.
