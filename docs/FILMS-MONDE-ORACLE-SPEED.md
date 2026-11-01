# Films Monde — posters rapides, Oracle uniquement, zéro modification Shield

## Réponse à « pourquoi ne pas utiliser du CSS par-dessus l'affiche TMDB ? »

Nuvio Shield est une application Android native (Jetpack Compose, Coil). Un addon Stremio fournit des URLs et du JSON, **pas du HTML/CSS/JavaScript exécutable dans la carte native**. Un SVG avec une image externe est également peu fiable dans les moteurs de décodage Android; le client peut refuser l'image liée. Mettre des calques directement sur la photo native nécessiterait un rendu pris en charge par l'application, donc une modification de Nuvio, ce que nous ne faisons pas.

## Architecture Oracle actuelle

- URL publique **unique** : `https://141-145-215-202.nip.io` (Caddy -> Oracle Node -> SQLite).
- Déploiement Oracle vérifie que **aucune URL Vercel, Pages ou Workers** ne figure dans le JSON produit.
- Oracle reçoit les appels Films Monde, sert les catalogues et compose les JPEG 896×504 avec la surcouche validée.
- Les images originales proviennent toujours des fournisseurs (TMDB / TVDB); elles doivent être transférées au moins une fois. Pas de CDN Vercel dans le circuit.

## Nouvelle optimisation : rendu anticipé

`scripts/warm-films-monde-artwork.mjs`, exécuté uniquement sur le localhost Oracle par
`nuvio-movies-warm.timer`, **prépare en arrière-plan** jusqu'à 96 affiches par exécution.
Cadence : 30 minutes, avec rotation de genres. Le worker lit uniquement les
**catalogues existants** et demande à Oracle les **mêmes URL d'images** approuvées
que la Shield utilise; Caddy / Oracle se chargent du cache disque. Le job a
un budget de 165 secondes, deux requêtes d'affiches simultanées, CPUQuota 15 %
et MemoryMax 192 M. Les sources manquantes sont réessayées à la prochaine période;
elles ne bloquent jamais le déploiement.

Les films déjà préchauffés n'ont plus besoin d'un téléchargement TMDB et d'une
composition Sharp/SVG au moment d'ouvrir Nuvio.

**Préservé** : affiches, titres/dates, absence de logos de films, styles de genres,
`movies/nuvio-collections.json` historique complet (depuis 2018),
`/movies/collections-only/manifest.json`, IDs, vues All/Streaming/VOD/Cinéma,
pagination 24, filtre films / documentaires / stand-up / animation, épisode Apocalypse Z,
calendrier local, séries, FR, Global, USA et Türkiye.

**Limites** : la vitesse réelle des milliers de lignes historiques dépend aussi
du client Shield, de la latence TV -> Oracle et du débit local. Le JSON
complet demande beaucoup de catalogues dès l'ouverture d'un genre; un cache chaud
et des affiches anticipées n'empêchent pas le client de lancer ces requêtes.
Les affiches non préchauffées sont toujours composées à la première demande.
`systemctl list-timers nuvio-movies-warm.timer`,
`journalctl -u nuvio-movies-warm.service -n 30 --no-pager`,
`node scripts/benchmark-artwork.cjs` permettent de contrôler les temps réels.

**Aucun APK à installer**, aucune nouvelle URL de catalogue/manifest, aucune
réimportation nécessaire et aucune mutation des services Vercel distants
(si un ancien projet Vercel existe dans un autre compte, sa suppression se fait
depuis ce compte; il ne sert pas cette production).
