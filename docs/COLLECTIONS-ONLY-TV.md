# Nuvio TV — collections uniquement (Home + Découverte propres)

## Objectif

Afficher les films/séries **dans les collections et leurs dossiers**, sans
exposer leurs milliers de catalogues calendaires comme des lignes distinctes
sur Home ou dans le sélecteur de Découverte / Search.

Les manifestes standards (pour Desktop / Mobile) restent inchangés.

## Manifestes alternatifs Android TV / Shield

Installer les manifestes ci-dessous à la place des manifestes standards
du même addon (ne pas conserver les deux variantes avec le même addon ID) :

| Addon | Nouveau manifeste TV |
|---|---|
| France | `/fr/collections-only/manifest.json` |
| USA | `/us/collections-only/manifest.json` |
| Türkiye | `/tr/collections-only/manifest.json` |
| Global / Anime / VOD | `/global/collections-only/manifest.json` |
| Films Monde | `/movies/collections-only/manifest.json` |
| Séries France V2 | `/series-v2/collections-only/manifest.json` |

Utiliser le même hôte Oracle public que pour les manifestes standards.

### Ce qui change

- Le manifeste TV conserve des **descripteurs compacts** pour chaque
  catalogue (mêmes identifiants, types et noms de périodes), indispensables
  pour afficher **Aujourd’hui, Hier, Octobre 2026**, etc. dans les dossiers
  de Collections. L’ancienne variante `catalogs: []` masquait les menus
  mais produisait des titres génériques comme « Films – Films ».
- Les catalogues sont explicitement exclus de Home, Recherche et Découverte
  selon les règles actuelles du client Nuvio TV : `showInHome: false`,
  recherche requise et genre requis, sans lancer de recherches inutiles.
  Les endpoints réels continuent d’accepter les appels sans ces paramètres.
- L'addon conserve **le même ID**, les ressources `catalog` et `meta`,
  ainsi que les URLs et identifiants des catalogues sous-jacents.
- Toutes les requêtes `/catalog/...`, `/meta/...` et les visuels reçues sous
  `/collections-only/` sont déléguées au même moteur régional que le manifeste
  original.
- Le JSON des collections, les dossiers et périodes dynamiques, les mois
  jusqu'à 2030 et les données de première sortie ne sont **pas modifiés**.
- Les recherches standards de films et séries continuent de dépendre des autres
  addons de recherche actifs de l'utilisateur. Les catalogues calendaires
  internes ne deviennent pas des catalogues de recherche.

### Installation / contrôle

1. Sur **Nuvio Android TV**, supprimer les anciens addons Nuvio Calendar concernés,
   puis installer les mêmes addons avec les URLs alternatives ci-dessus.
2. Conserver les mêmes collections que précédemment. **Actualiser les addons** pour
   recharger leur manifeste : il n’est pas nécessaire de réinstaller les
   URL alternatives ni de réimporter les collections. Vérifier un dossier
   France, un dossier Global, un dossier Türkiye, un dossier USA et, le cas
   échéant, Films Monde et Séries France V2.
3. Vérifier que les **noms des périodes** (Aujourd’hui, mois et année) et les
   posters chargent dans les dossiers ; contrôler ensuite
   l'absence de catalogues calendaires individuels sur Home et dans Découverte.
4. Si une version de Nuvio TV interprète différemment les extras requis,
   revenir aux URLs standards `/REGION/manifest.json`. Les tests de code
   n’équivalent pas à une vérification réelle sur Shield.

### Compatibilité

Ce profil est **destiné uniquement à Android TV / Shield**. Le code source
actuel de Nuvio TV (`FolderDetailViewModel.buildAddonTabLabels` et
`SearchViewModel`) explique pourquoi il faut **déclarer** les catalogues
avec leur nom tout en les excluant des autres écrans. Les catalogues ne
sont pas supprimés, seulement masqués dans les sélecteurs globaux.

Ne pas le substituer automatiquement au manifeste de Nuvio Mobile : la
compatibilité des catalogues non déclarés y est différente. Voir la demande
NuvioMobile #1455.

Ce profil n'est pas activé à distance sur les appareils : l'utilisateur doit
installer l'URL alternative dans Nuvio pour le sélectionner.
