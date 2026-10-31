# Nuvio Mobile & Desktop — Collections privées (opt-in)

## But

Garder les catalogues calendaires accessibles **dans les Collections et leurs dossiers**,
mais les retirer des **lignes Home**, des **sélecteurs Découverte**, et des
**catalogues de recherche** de Nuvio Mobile/Desktop. La recherche normale de films/séries
reste assurée par les autres addons de recherche installés.

Cette option vise à éviter le chargement des milliers d'affiches de lignes
calendaires depuis l'accueil ; elle ne supprime pas le chargement des affiches
lorsqu'un utilisateur ouvre volontairement une Collection ou un dossier.

## Compatibilité confirmée dans les sources (à valider sur chaque appareil)

Les clients Kotlin de **NuvioMobile (branche `cmp-rewrite`)** et de
**NuvioDesktop (branche `Dev`)** déclarent une entrée Home seulement si
`catalog.extra.none { it.isRequired }`. Leur code de Découverte ignore les catalogues
dotés d'un extra **requis et inconnu**, et leur code de recherche ignore ceux
dotés d'un extra requis autre que `search`. En revanche, leurs fonctions
`findCollectionCatalog` retrouvent les catalogues par `addonId/type/catalogId`
dans le manifeste installé.

Pour cette raison, le profil `collections-private` conserve **tous** les
catalogues dans `manifest.json`, contrairement au profil TV `collections-only`
qui déclare `catalogs: []`. Chaque catalogue du profil privé reçoit un extra
technique :
```json
{ "name": "nuvio_collection_only", "isRequired": true }
```

Le paramètre ne s'utilise pas dans la requête d'une Collection : il sert
uniquement de filtre de découverte. Les endpoints `catalog`, `meta` et les
images restent accessibles via le même moteur Oracle. **Aucune date, période,
ID, import JSON ou règle du calendrier jusqu'en 2030 n'est modifié.**

Cela reste un **contournement opt-in** dépendant du comportement de ces versions
clientes ; ce n'est pas une fonctionnalité officiellement garantie par Nuvio.
Une mise à jour future des apps pourrait changer ce comportement.

## Manifestes Mobile & Desktop — serveur Oracle

| Addon | Adresse |
| --- | --- |
| France | `https://141-145-215-202.nip.io/fr/collections-private/manifest.json` |
| USA | `https://141-145-215-202.nip.io/us/collections-private/manifest.json` |
| Türkiye | `https://141-145-215-202.nip.io/tr/collections-private/manifest.json` |
| Global | `https://141-145-215-202.nip.io/global/collections-private/manifest.json` |
| Films Monde | `https://141-145-215-202.nip.io/movies/collections-private/manifest.json` |
| Séries France V2 | `https://141-145-215-202.nip.io/series-v2/collections-private/manifest.json` |

**Ne pas utiliser ce profil avant validation et déploiement du code.**

## Installation, une région à la fois

1. Sauvegarder l'import JSON des Collections et noter les URLs standard
   installées. Ne supprimer **aucune Collection**.
2. Sur Mobile ou Desktop, remplacer l'addon France seulement par sa version
   `collections-private` (même addon ID ; ne pas laisser les deux versions).
3. Vérifier trois choses : les dossiers Collections ouvrent leurs catalogues
   et affiches ; aucune ligne calendaire individuelle sur Home ; aucun
   catalogue calendaire dans les sélecteurs Découverte.
4. Vérifier aussi un mois historique, une période dynamique et des affiches
   de Films Monde. Si l'un échoue, remettre aussitôt l'URL standard
   `https://141-145-215-202.nip.io/fr/manifest.json`.
5. Seulement après ce contrôle, remplacer les autres régions.

**Attention aux profils synchronisés** : les addons Nuvio peuvent être
synchronisés entre TV, Mobile et Desktop. Remplacer l'URL d'un addon dans
un profil commun peut également modifier l'autre appareil. Avant de changer
les addons, vérifier que le profil de test n'affecte pas la Shield.
Le profil TV `collections-only` demeure distinct.

## Limites de performance

- Ce profil empêche les chargements Home/Découverte lancés pour les
  **catalogues de cet addon** dans les clients compatibles.
- Le manifeste doit encore contenir les descripteurs de tous les catalogues
  pour que Mobile/Desktop les résolvent ; sa taille n'est pas éliminée.
- Les affiches chargées depuis les Collections continuent d'être demandées.
  Il faut mesurer la charge serveur et vérifier la mise en cache sur appareil
  pour confirmer le bénéfice réel.

## Vérifications automatisées

`node --test test/collections-private.test.js` vérifie les six variantes,
l'identité des IDs de catalogues, les extras et les règles Home/Search/Discover
publiées dans les sources des clients, les assets et l'absence de modification
du profil Android TV. Ces tests ne remplacent **pas** un test sur Mobile/Desktop.
