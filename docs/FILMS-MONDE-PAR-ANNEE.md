# Films Monde — dossiers par année (Shield, Collections Only, Oracle)

Ce JSON **optionnel** remplace le mode d'affichage de la collection Films Monde **sans changer l'addon ni ses données**.

- **Addon obligatoire, inchangé :** `https://141-145-215-202.nip.io/movies/collections-only/manifest.json`
- **Import à utiliser :** `https://141-145-215-202.nip.io/movies/nuvio-collections-year-by-year.json`
- **Version Desktop si nécessaire :** `https://141-145-215-202.nip.io/movies/nuvio-collections-year-by-year-desktop.json`

Dans chacun des quatre parents (**Toutes les sorties**, **Streaming**, **VOD**, **Cinéma**), les genres sont présents. Chaque genre a :
- un dossier principal (ex. **Action**) contenant uniquement les cinq périodes `Aujourd’hui`, `Demain`, `Hier`, `Semaine passée`, `La semaine suivante`, donc **5 requêtes de catalogues** lorsque ce dossier s'ouvre ;
- un dossier **Action · 2026**, puis **Action · 2025**, **Action · 2024**, ... **Action · 2018**. Chaque année contient ses 1–12 mois, dans l'ordre décroissant, sans calcul de nouvelles dates ;
- **Western** conserve également 2015, 2016, 2017 et toutes les archives annuelles jusqu'à 1900 et avant 1900, découpées en groupes de 12 entrées au maximum.

Les quatre IDs de collection `movies-world-*`, les sources `movies-fr-*`, leurs périodes, métadonnées, images, arrière-plans, dates de sortie vérifiées, exclusions et affiches de cinéma sont **inchangés**. Le nombre total de sources reste exactement identique au JSON complet historique. Le système continue à évoluer automatiquement au changement d'année jusqu'en 2030 (il ne peut pas ajouter de nouvelles cartes de dossiers sur un import déjà figé sans réimporter le JSON).

**Pourquoi c'est plus rapide :** la version complète plaçait jusqu'à 100+ catalogues mensuels dans chaque dossier de genre, et Shield tente de tous les charger en même temps. Le nouvel import limite chaque ouverture à cinq catalogues pour le dossier courant ou douze pour un dossier annuel. Il ne modifie pas le chargement des pochettes elles-mêmes : le préchauffage Oracle des JPEG existants continue à fonctionner.

**Installation** : dans Nuvio Shield, conserver l'addon **Collections Only** existant, supprimer/remplacer l'ancien import des **quatre collections Films Monde uniquement**, puis importer le nouvel URL. Ne pas conserver la version historique et la version par année simultanément. Aucun changement d'APK. L'ancien import `/movies/nuvio-collections.json` reste disponible en cas de retour arrière. Les USA, Türkiye, France et Global ne sont pas modifiés.

Il s'agit d'un changement **de navigation** visible dans Nuvio, et non d'une prétendue injection CSS dans une application Android native.
