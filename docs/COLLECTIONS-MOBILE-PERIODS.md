# Nuvio Mobile — Collections par périodes (opt-in)

## Diagnostic
La variante Shield `/REGION/collections-only/manifest.json` renvoie `catalogs: []`.
Nuvio Mobile a besoin de la déclaration des sources pour afficher les catalogues
dans une collection. Si les extensions se synchronisent depuis la Shield, les
dossiers deviennent vides. Ce cas ne se résout PAS par une réimportation.

Pour récupérer les sources Mobile, utiliser le profil d'addon
`/REGION/mobile-desktop-collections/manifest.json` ou l'URL standard
`/REGION/manifest.json`, **pas** `/collections-only/manifest.json`.
Une synchronisation d'addons entre appareils peut écraser cette sélection :
prévoir un profil Nuvio indépendant pour tester.

## Variante d'import pour périodes lisibles
Les imports suivants sont optionnels et ne modifient **aucun** import standard :

| Collections | URL relative Oracle |
|---|---|
| France, Global, Türkiye, USA | `/nuvio-collections-mobile.json` |
| Films Monde | `/nuvio-collections-movies-mobile.json` |
| Séries France V2 | `/nuvio-collections-series-v2-mobile.json` |
| Séries legacy | `/nuvio-collections-series-mobile.json` |

Hôte : `https://141-145-215-202.nip.io`.

Ces imports conservent les ID des collections, dossiers, addons et catalogues,
le classement des sources et la durée des archives. Ils imposent seulement
`viewMode: "TABBED_GRID"` et `showAllTab: false`, avec le titre de la
catégorie visible. Les noms de catalogues s'affichent donc comme onglets :
Aujourd'hui, Hier, prochaines semaines, octobre 2026, etc.
Les mois futurs restent régis par la logique actuelle (jusqu'à 2030).

Cette présentation **réduit le nombre d'affiches affichées simultanément dans
l'écran des dossiers Mobile**, comparé aux lignes de période en mode
`FOLLOW_LAYOUT`. Mais elle **ne supprime pas les requêtes réseau par période
au chargement initial** : le code actuel du client
`FolderDetailRepository.initialize()` lance `loadTabPage` pour toutes les
sources. Pour supprimer la charge serveur correspondante, une modification
de l'application (chargement à la demande de l'onglet sélectionné) et une
compilation/installation du client sont nécessaires. Il serait trompeur de
présenter ces imports seuls comme une optimisation du débit du serveur.

## Test sûr
1. Exporter et sauvegarder ses collections.
2. Vérifier que le manifeste Mobile/Desktop correct est installé (pas Shield).
3. Tester ces nouveaux imports sur un profil Mobile séparé, en commençant par
   France, puis Films Monde et Séries France V2.
4. Vérifier les dossiers, les onglets de périodes, une période actuelle,
   un mois ancien et les affiches. Les collections et dossiers existants
   sont identifiés par leurs ID inchangés.
5. Si régression, revenir à l'URL d'import standard et au manifeste d'origine.

Ne pas importer les versions Mobile optimisées sur la Shield ou Desktop sans
valider le choix d'affichage. Aucun fichier de calendrier ni de dates n'est
changé par cette fonctionnalité.
