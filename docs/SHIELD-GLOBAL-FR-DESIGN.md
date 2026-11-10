# NVIDIA Shield — Design France natif pour TOUTES les collections

Le thème graphique est celui **déjà créé par l'utilisateur pour France** :
dégradé bleu-nuit #03152F → #062B5C → #0369A1, filet cyan #38BDF8,
badge fournisseur cerclé en haut à droite, badge FILM / SÉRIE coloré,
titre blanc très gras, date et nom du fournisseur en pied de carte.

Pas de nouveau thème, et aucune fusion de poster/image faite par Oracle.

## Application

* Source : dernière branche `dev` NuvioMedia/NuvioTV vérifiée le 1er novembre
  2026, SHA `2d4748cc0ed8743443cd6be4681cb7ac6772fac3`.
* Construit dans une APK de test **séparée** de l'application officielle,
  suffixe `.franceoverlay`, sous le nom de l'artifact
  `nuvio-shield-global-france-overlay-all-collections-apk`.
* Option persistante dans **Paramètres → Mise en page → Design France —
  toutes les collections**. Désactivée par défaut ; réversible.
* Même composant Compose `FranceCalendarCardOverlay` dans les trois chemins
  de cartes : grille, classique et lignes du Home Moderne.
* Les couvertures des dossiers/collections elles-mêmes restent intactes.
  Tous les **films et séries à l'intérieur** de toutes les collections et
  tous les addons sont concernés, pas uniquement `/fr` et `/movies`.
* Une image déjà directe à TMDB reste sur le CDN TMDB. Une URL générée
  par l'ancienne surcouche Oracle avec `src`/`fallback` est **déballée dans
  l'APK** à partir d'hôtes d'image strictement autorisés, sans appel réseau
  intermédiaire. Source `w780` en mode paysage, `w500` en portrait.
  Quand aucune source originale sûre n'est accessible, la carte existante
  reste utilisée.
* Aucun changement des dates, indexations, sources ou téléchargements de
  collection. Les badges ne spéculent pas sur un fournisseur absent :
  l'étiquette de région est alors utilisée.
* Aucun compte utilisateur, mot de passe, signature officielle ou APK de
  production NuvioTV n'est utilisé ou remplacé.

## Limites

La fidélité graphique est **déduite du code France original**, pas d'une
capture HDMI de la Shield. Le design est redessiné à la volée et adapté à
la résolution des cartes ; les pixels ne seront pas rigoureusement identiques
à un SVG source 1600x900 redimensionné. Le test sur Shield (lisibilité,
GPU/CPU, focus, scroll) et le build CI doivent réussir avant de proposer
l'installation. Pour une couverture France ancienne qui ne fournit aucun
`src`/`fallback` direct, la surcouche d'origine peut encore être affichée
en dessous : cela ne justifie pas de modifier l'addon officiel.

## Build

`python3 builder/france-overlay/apply.py NuvioTV`

`./gradlew :app:assembleFullDebug --no-daemon`

Workflow : `.github/workflows/build-shield-france-overlay.yml`
