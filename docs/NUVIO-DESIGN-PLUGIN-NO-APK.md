# Nuvio France Design Plugin — sans APK

Ce module est une passerelle de visuels compatible avec la fonction **Custom Posters**
déjà intégrée à Nuvio TV. Il n'installe ni APK, ni CSS Android, et ne change
aucune URL de collection ou de manifeste existant.

## Installation sur Nuvio officiel

1. Conserver les addons et collections déjà importés (dont Films Monde).
2. Ouvrir **Custom Posters** dans les réglages de Nuvio.
3. Coller **une seule fois** le modèle d'URL :

```text
https://141-145-215-202.nip.io/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}
```

4. Activer les écrans concernés dans les réglages Custom Posters (Collections,
   Home, Recherche, Bibliothèque, Détails, etc.).

L'URL de configuration est :
`https://141-145-215-202.nip.io/design-plugin/config.json`

### Ce que fait le plugin

- Le client Nuvio transmet ses IDs au service au moyen des placeholders
  `{id}`, `{type}` et `{shape}` (déjà pris en charge).
- Le service résout les IDs dans les index films/séries existants, choisit
  l'affiche ou le fond TMDB et applique la composition graphique **France**
  actuelle via le moteur de rendu déjà déployé.
- Les images finales sont mises en cache côté Oracle (URL stable, déduplication
  des requêtes) et dans le cache images Android existant.
- Si un titre n'est pas dans nos index, la requête retourne 404, ce qui laisse
  Nuvio utiliser son affichage original via son intercepteur de repli.
- Aucun catalogue supplémentaire et aucune nouvelle importation ne sont nécessaires.

### Limite technique non négociable

Les plugins JavaScript de Nuvio n'exposent pas de point d'extension permettant
d'injecter un calque Compose/CSS au-dessus de **toutes** les images fournies
par TMDB/TVDB. Sans toucher à l'APK, le système natif Custom Posters n'accepte
qu'une URL d'image personnalisée : la composition visuelle doit donc encore
être réalisée côté service pour les titres concernés. Une image complètement
native, sans traitement serveur, perdrait ce design particulier.

### Fiabilité

Les URLs originales de Films Monde et l'import unifié sont inchangés. Le service
ne demande aucune clé API aux utilisateurs et ne prend jamais une URL d'image
arbitraire comme entrée (seulement un ID de film/série). Le rendu reste un
complément opt-in, entièrement désactivable en vidant Custom Posters.
