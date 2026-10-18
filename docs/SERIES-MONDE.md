# Séries en streaming — marché français

L'addon est limité aux **séries disponibles sur les services du marché français**, toutes origines et langues de production confondues. Les anime et toute animation sont exclus.

## Services et disponibilités

Le répertoire complet `/watch/providers/tv?watch_region=FR` est chargé automatiquement : aucune liste fermée de plateformes n'est imposée. La découverte utilise tous ces identifiants, `watch_region=FR`, `without_genres=16` et les modes `flatrate|free|ads|rent|buy` (abonnement, gratuit/replay, publicité, achat et location).

Une fiche n'est visible que si elle possède une preuve FR récente : résultat d'une découverte explicitement filtrée sur ces services et ce marché, ou offres FR de sa fiche. Les offres détaillées sont récupérées ensuite pour afficher les plateformes sur chaque fiche. Une vérification explicite négative prime sur une découverte potentiellement décalée. Une fiche française proposée uniquement aux USA reste exclue ; une série américaine, japonaise avec acteurs ou coréenne disponible en France reste incluse.

Les disponibilités sont attribuées à **JustWatch via TMDB**, conformément aux conditions de la source. Les données portent sur une série ; elles ne certifient pas la disponibilité de chaque saison/épisode, ni l'existence d'une source vidéo dans les addons de lecture installés. La couverture dépend des offres recensées par la source et n'est pas présentée comme une garantie absolue sur les plateformes non référencées.

## Collections et dates

Deux collections natives, chacune avec 25 dossiers de genres et thèmes :

- **🇫🇷 Séries en streaming · Tous services** : date de première diffusion de la série.
- **🇫🇷 Streaming · Nouvelles saisons** : date de lancement des saisons normales numéro 2 et supérieur.

Les périodes restent celles des autres catalogues : toutes dates en ordre décroissant, Aujourd’hui, Demain, Hier, Semaine passée, La semaine suivante, mois décroissants jusqu'à 2015, puis années anciennes et Date inconnue. Les dates concernent la diffusion originale de la série/saison, sans inventer une date d'arrivée sur une plateforme française. La présence au catalogue nécessite toujours une disponibilité actuelle FR, y compris pour une série ancienne.

Pagination de 100 fiches sans plafond total, sans seuil de notes/popularité. Le genre 16, les mots-clés d'animation et les classifications complémentaires déjà connues servent à exclure l'animation. Les thèmes complémentaires dépendent des métadonnées ; les fiches sans médium déterminable restent en attente de classification.

## Synchronisation

Le worker conserve `/var/lib/nuvio-series/index.sqlite` et le même service installé. Le parcours mondial des identifiants et de TVmaze est arrêté, sa file de jobs supprimée. Les métadonnées déjà acquises restent utilisables pour l'identité et le dédoublonnage, mais ne peuvent pas contourner le filtre FR.

Le nouveau worker parcourt les résultats FR avec reprise de page, fusionne les doublons entre services, enrichit les offres par titre et rafraîchit le marché toutes les six heures. Si une recherche dépasse 500 pages, les identifiants de plateformes sont divisés en groupes. Un dépassement restant pour un service unique est déclaré explicitement dans `overflow` et le scan n'est jamais marqué complet. Les retraits ne sont appliqués qu'après un scan complet et réussi. Une preuve de disponibilité expire après 48 heures sans rafraîchissement.

Les points de reprise, erreurs et compteurs FR sont publics dans `/series/status.json`. Le répertoire effectivement chargé est consultable dans `/series/providers.json`. Le nombre de dossiers/catalogues de périodes n'est pas un nombre de séries.

## Mise à jour dans Nuvio

Les identifiants existants sont conservés pour mettre à jour les collections en place. Les anciens IDs contenant `world` sont uniquement des identifiants de compatibilité ; leurs résultats sont désormais filtrés sur le marché FR.

- Addon : `/series/manifest.json` (version 1.1.1, Nuvio Séries Streaming France).
- Shield : `/series/nuvio-collections.json`.
- Desktop : `/series/nuvio-collections-desktop.json`.

Actualiser l'addon et réimporter le JSON adapté au client pour actualiser les titres et visuels. Les quatre addons historiques et leurs collections ne sont pas modifiés.

Depuis la version 1.1.1, le manifest nomme aussi les anciens identifiants `series-world-*` : les collections des deux versions retrouvent les libellés de périodes (« Aujourd’hui », « Octobre 2026 », etc.) après actualisation du manifest dans Nuvio. Le texte générique « Séries - Série » est le fallback du client quand sa copie installée du manifest ne contient pas l'identifiant de la source.

Les fiches des rangées utilisent exactement les renderers des calendriers France : poster portrait custom, `background`/`landscapePoster` 1600×900 pour Shield Modern, `banner` custom pour Desktop et logo transparent contre le doublon de titre. Cela s'applique à toutes les périodes, y compris toutes dates, archives annuelles et dates inconnues. Les fiches détail conservent leurs illustrations originales. Les images portent les URLs révisées des renderers existants ; les catalogues séries sont servis sans cache HTTP.

La cover conserve l'art cinématique choisi et porte maintenant « SÉRIES STREAMING — MARCHÉ FRANÇAIS · TOUTES LES PLATEFORMES ». Son master est `assets/collection-art/series-france-v2.jpg` ; les routes révisées produisent du 1600×900 et du 1920×1080.

## Validation

`npm run test:series`, `npm test`, `npm run test:runtime`, `node scripts/test-series-runtime.mjs`.

Les tests contrôlent notamment : FR obligatoire pour les catalogues et les fiches, refus d'une offre uniquement US/BE, indépendance du pays de production, nouvelles plateformes hors liste historique, tous les modes d'offres, expiration/retrait, panne sans effacement, reprise et partition de pagination, exclusion de l'animation et images Shield/Desktop.

Références : [TMDB Discover TV](https://developer.themoviedb.org/reference/discover-tv), [TV Watch Providers](https://developer.themoviedb.org/reference/tv-series-watch-providers). Les crédits et conditions TMDB, JustWatch et des données complémentaires TVmaze restent applicables.
