# Films Monde — streaming, VOD et cinéma en France

Addon autonome : `com.nuvio.movies.france.world.v1`, version 1.0.1, base `/movies`.
Les films de tous pays de production sont admis sur la base d'offres ou de sorties
référencées pour la France. L'animation et les anime sont exclus, comme pour Séries
Monde. Les critères ne comportent aucun seuil de note, popularité ou langue.

## Collections natives

L'import ajoute quatre collections, chacune avec 20 dossiers de genres :

| Collection | Contenu |
| --- | --- |
| Films Monde · Toutes les sorties | Union dédoublonnée des trois vues suivantes |
| Films Monde · Streaming | Offres françaises abonnement, gratuit et publicité |
| Films Monde · VOD | Offres françaises achat/location et dates de sorties numériques FR |
| Films Monde · Cinéma | Dates de sorties salles françaises, limitées et nationales |

Un film présent sur plusieurs plateformes ou ayant plusieurs sorties dans une période
n'apparaît qu'une fois dans cette rangée. Sa date la plus récente dans la période est
retenue. Le même film peut logiquement figurer dans plusieurs périodes ou vues si ses
sorties cinéma, numériques et originale sont différentes.

## Dates et disponibilité

Les dates cinéma (TMDB types 2 et 3) et numériques (type 4) proviennent exclusivement
de `release_dates.FR`, ou d'une découverte explicitement régionale du même type avant
enrichissement. Les dates US/BE, premières de festival, DVD et diffusion TV ne sont
jamais transformées en sorties cinéma ou VOD françaises.

Une disponibilité française présente permet aussi de classer le film par sa première
date de sortie connue. **Cette date ne constitue pas une date d'arrivée sur Netflix,
Prime ou une autre plateforme.** Une sortie numérique référencée ne prouve pas qu'une
offre de lecture existe encore : les fiches sans offre FR actuelle l'indiquent. Les
dates sont fournies par TMDB, les offres par JustWatch via TMDB. La couverture reste
celle des services et sorties recensés par ces sources ; ce n'est pas une promesse
d'accès à une vidéo via les addons de lecture installés dans Nuvio.

Les périodes reproduisent celles de Séries Monde : Aujourd'hui, Demain, Hier, Semaine
passée, La semaine suivante, mois décroissants jusqu'à janvier 2018 (Western conserve les mois jusqu'à 2015, les années anciennes et
Date inconnue). Les archives s'arrêtent au jour local Europe/Brussels. Aucun mois/année
futur n'est affiché ; seuls Demain et La semaine suivante ouvrent une fenêtre future.
La route Toutes les dates est conservée pour recherche/pagination mais n'est pas une
rangée visible de l'import.

## Index et synchronisation

`/var/lib/nuvio-movies/index.sqlite` est un index SQLite persistant distinct des séries.
Il réutilise leur moteur éprouvé d'identité, transactions et reprises, avec des tables
spécifiques aux films pour les sorties et offres. Les identifiants IMDb sont préférés
pour les lecteurs ; le fallback est `tmdb:movie:<id>`.

Le worker `nuvio-movies-sync.service` commence par les sorties récentes, puis poursuit
quatre parcours complets : abonnement/gratuit, achat/location, cinéma et numérique.
`watch_region=FR` et les types d'offres couvrent tous les services sans liste fermée.
Le répertoire officiel des providers films FR est chargé et affiché publiquement.
Les dates régionales et offres exactes de chaque titre sont enrichies en arrière-plan.

La limite amont de 500 pages est traitée par subdivision des intervalles de dates.
Les extrémités restent ouvertes : les bornes artificielles 0001/9999, ignorées par
TMDB en production, ne sont jamais envoyées. Chaque requête de subdivision consomme
le budget du cycle ; les anciennes tâches invalides sont remplacées à la mise à jour.
Les films sans date disposent d'une sonde séparée. Les pages sont préchargées par trois,
mais validées et sauvegardées dans l'ordre. Une panne reprend la page non validée ; elle
ne vide pas les collections. Les retraits d'offres ne sont appliqués qu'après un parcours
complet réussi. Un dépassement irréductible est public dans `overflow` et le parcours
n'est pas annoncé complet. Une réponse totalement vide inattendue préserve le précédent
catalogue. Les parcours complets sont rafraîchis toutes les six heures, les sorties
récentes chaque heure ; les preuves d'offres expirent après 48 heures sans rafraîchissement.
CPU plafonné à 20 %, mémoire 512 Mio, verrou `flock`, redémarrage automatique.

## Installation

1. Installer `https://141-145-215-202.nip.io/movies/manifest.json`.
2. Importer `/movies/nuvio-collections.json` pour Shield ou
   `/movies/nuvio-collections-desktop.json` pour Desktop.
3. Fermer et relancer Nuvio pour charger les nouvelles collections.

Les collections Films Monde portent leurs propres IDs `movies-world-*`. Elles sont
ajoutées à côté des collections déjà installées. Une réimportation du même fichier les
met ensuite à jour en place. L'addon et les collections Séries Monde gardent leurs IDs.

État : `/movies/status.json`. Services : `/movies/providers.json`. Liens recommandés :
`/install.json` (`moviesManifest`, `moviesCollections`, `moviesDesktopCollections`).

## Design et validation

Les 20 covers WebP 1600×900 sont dans `assets/movie-covers/`, avec manifeste et SHA-256.
La nouvelle illustration principale reprend le cadre doré, les photos cinéma, le
panneau sombre et la typographie des covers Séries Monde approuvées. Les photos de
genres approuvées sont réutilisées dans ce même cadre avec les titres des films,
y compris Histoire, Téléfilms et Guerre. Les visuels de fiches utilisent les mêmes
renderers Shield Modern et Desktop que les séries ; les détails conservent l'art original.

Validation : `npm run test:movies`, `npm test`, `npm run test:runtime`,
`node scripts/test-movies-runtime.mjs`, `node scripts/verify-movie-covers.mjs`.

Sources officielles :
- https://developer.themoviedb.org/reference/discover-movie
- https://developer.themoviedb.org/reference/movie-release-dates
- https://developer.themoviedb.org/reference/watch-providers-movie-list

Les catalogues et imports Shield/Desktop s’arrêtent à janvier 2018 inclus, sauf Western qui conserve exactement son historique (mois jusqu’à 2015, années plus anciennes, Avant 1900, Date inconnue). Le seuil porte sur les dates de sortie du catalogue : une ressortie cinéma ou numérique récente reste visible. Les anciennes routes hors Western renvoient une liste vide avant 2018. La base et les liens de détail restent conservés. Réimporter les collections pour retirer les anciennes périodes de l’interface.
