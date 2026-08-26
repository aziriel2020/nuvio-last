# Nuvio Calendar Archives — France + USA Coexist v1.0.1

Cette version garde les deux marchés dans **un seul déploiement Vercel**, avec **deux addons Nuvio séparés**, mais donne maintenant la priorité au marché France et corrige les affiches vides dans les cartes Modern Shield.

## Ordre Modern Shield : France d'abord

Le JSON combiné sort maintenant les Collections dans cet ordre :

```text
🇫🇷 Netflix
🇫🇷 Prime Video
🇫🇷 Disney+
🇫🇷 HBO Max
🇫🇷 Apple TV+
🇫🇷 CANAL+
🇫🇷 Paramount+
🇫🇷 france.tv
🇫🇷 TF1+
🇫🇷 M6+
🇫🇷 ARTE
🇫🇷 Crunchyroll + AniList
🇫🇷 ADN
🇫🇷 VOD France

puis

🇺🇸 Netflix
🇺🇸 Prime Video
...
🇺🇸 VOD
```

Pour que ce soit fiable même si Nuvio avait déjà mémorisé l'ancien ordre :

- Collections France : `pinToTop: true`
- Collections USA : `pinToTop: false`

L'import conserve les IDs existants, donc il met à jour les Collections déjà présentes sans créer une deuxième copie.

## Correction des affiches Modern Shield

Le bug venait du mode coexistence sous `/fr` et `/us` : les URLs générées pour les cartes de contenu utilisaient une route absolue `/calendar-card.svg`, ce qui supprimait le préfixe régional.

Exemple du bug :

```text
https://TON-DOMAINE/calendar-card.svg
```

Alors que la bonne URL est :

```text
https://TON-DOMAINE/fr/calendar-card.svg
https://TON-DOMAINE/us/calendar-card.svg
```

La même correction est appliquée au logo transparent Modern :

```text
/fr/calendar-transparent-logo.svg
/us/calendar-transparent-logo.svg
```

Résultat : les `poster`, `background` et `landscapePoster` des catalogues Modern restent dans le bon namespace et les affiches 16:9 peuvent être chargées par la Shield.

## URLs du déploiement

- France : `https://TON-DOMAINE/fr/manifest.json`
- USA : `https://TON-DOMAINE/us/manifest.json`
- Collections combinées : `https://TON-DOMAINE/nuvio-collections-usa-fr.json`
- Diagnostic : `https://TON-DOMAINE/coexistence-check.json`

## Installation / mise à jour

Après déploiement de cette v1.0.1 :

1. installe / mets à jour `https://TON-DOMAINE/fr/manifest.json` ;
2. installe / mets à jour `https://TON-DOMAINE/us/manifest.json` ;
3. **réimporte une fois** `https://TON-DOMAINE/nuvio-collections-usa-fr.json`.

Cette réimportation est nécessaire pour appliquer la priorité France (`pinToTop`) aux Collections déjà stockées dans Nuvio.

Tu peux ensuite supprimer les anciens addons séparés qui ne se terminent pas par `/fr` ou `/us` si tu les as encore installés.

## Vérification

`/coexistence-check.json` doit retourner :

```json
{"safe":true}
```

Les tests vérifient en plus :

- 24 Collections uniques ;
- les 14 Collections France avant les 10 USA ;
- France `pinToTop=true`, USA `pinToTop=false` dans l'import combiné ;
- aucune collision d'addon / Collection / dossier / catalogue ;
- les URLs des covers de plateformes restent sous `/fr/...` ou `/us/...` ;
- les URLs des affiches de contenu Modern restent sous `/fr/calendar-card.svg` ou `/us/calendar-card.svg` ;
- les routes `calendar-card.svg` sont réellement atteignables via le wrapper et savent embarquer l'image source.

## Tests

```bash
npm test
```

La commande lance l'engine USA, l'engine France puis les tests spécifiques de coexistence.
