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

- Le manifeste TV publie `catalogs: []`, sans catalogues internes dans les
  menus Home et Découverte.
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
2. Conserver/importer les mêmes collections que précédemment. Vérifier un dossier
   France, un dossier Global, un dossier Türkiye, un dossier USA et, le cas
   échéant, Films Monde et Séries France V2.
3. Vérifier que les posters chargent dans les dossiers ; contrôler ensuite
   l'absence de catalogues calendaires individuels sur Home et dans Découverte.
4. Si la version Nuvio TV ne résout pas les catalogues absents du manifeste,
   revenir aux URLs standards `/REGION/manifest.json`.

### Compatibilité

Ce profil est **destiné uniquement à Android TV / Shield**, qui sait résoudre
les catalogues d'une collection via `addonId` / `type` / `catalogId` sans
que chaque catalogue soit déclaré dans le manifeste.

Ne pas le substituer automatiquement au manifeste de Nuvio Mobile : la
compatibilité des catalogues non déclarés y est différente. Voir la demande
NuvioMobile #1455.

Ce profil n'est pas activé à distance sur les appareils : l'utilisateur doit
installer l'URL alternative dans Nuvio pour le sélectionner.
