# Nuvio France Design Plugin V2 — sans APK

Version candidate 2.0.0 : images de fiches paysage 16:9 via Nuvio Custom Posters.

## Intégration

Le même modèle d'URL fonctionne pour toute fiche que Nuvio demande en format paysage et qui possède un identifiant TMDB/IMDb exploitable. Les collections et leurs dates ne sont pas modifiées.

Après publication et vérification de la V2, saisir dans Custom Posters :

```text
https://141-145-215-202.nip.io/design-plugin/poster.jpg?type={type}&id={id}&shape={shape}&v=fr-landscape-metadata-v2-20261102
```

Configuration : `https://141-145-215-202.nip.io/design-plugin/config.json`

## Présentation approuvée

- Format 16:9, fond TMDB et dégradé bleu lisible.
- Logo officiel du FILM/de la SÉRIE quand disponible, sinon titre en texte.
- Type (FILM ou SÉRIE), date, année, note TMDB, genres et saisons (uniquement séries).
- Le badge géographique « FRANCE » est supprimé. Le badge de plateforme reflète les offres vérifiées ; jamais de marque inventée.
- Les saisons sont mises à jour avec les nouvelles données (cache TMDB jusqu'à six heures et cache d'images distinct).

## Limites de la fonction native Custom Posters

Le modèle global natif transmet seulement `{type}`, `{id}` et `{shape}`. Il ne transmet **pas** l'identifiant de la collection, donc ne distingue pas une fiche Netflix d'une fiche Prime Video quand un titre est présent sur plusieurs plateformes. La V2 affiche une plateforme seulement si elle est identifiée de façon unique.

Pour obtenir **le badge exact de la collection** dans tous les cas, les addons doivent fournir la plateforme au service dans des URLs d'illustration spécifiques à chaque collection, ou Nuvio doit transmettre la collection dans son mécanisme Custom Posters. Ce second circuit est un ajout de données et d'URLs, sans modification de l'APK ni réorganisation des catalogues. La V2 ne prétend pas avoir résolu cette limite à elle seule.

Les emplacements portrait et carré retournent 404 pour conserver leur image native (une carte 16:9 serait rognée). Les IDs non résolus ou images non récupérables reviennent aussi au visuel d'origine.

La fonction Custom Posters ne contrôle pas la légende native sous la vignette : un doublon de titre sous l'image nécessite un contrôle côté application, inaccessible depuis le service d'images.

## Validation

Sur la branche candidate : `node --test test/design-plugin.test.cjs`, puis `npm test`. Vérifier ensuite le rendu, la rapidité, la date et les badges sur Nuvio TV / Shield ; **aucune validation de la production ou de la Shield n'est implicite**.
