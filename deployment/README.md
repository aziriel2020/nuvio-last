# Import Nuvio World Artwork — production Oracle

Ce dossier est un point de dépôt temporaire pour le pack **validé du 25 octobre 2026**.

1. Ouvrir https://github.com/aziriel2020/nuvio-last/upload/main/deployment
2. Glisser le fichier `NUVIO_SHIELD_SERIES_FILMS_WORLD_FINAL_20261025.zip` (23,4 Mo environ) puis valider le commit sur `main`.
3. L'action **Import Nuvio World Artwork (Shield)** vérifie la somme SHA-256, décompresse, installe, puis exécute les tests et pousse le code + les 92 images vers `main`.
4. Le workflow existant **Deploy Oracle Production** déploie automatiquement ce nouveau commit sur l'Oracle VM. Il réalise son audit et revient à la version précédente en cas d'échec.

Pack attendu SHA-256: `5a5413b5ad22888efd0c200d897d99ba7e360246aef04e2276759d223ec09825`

Les fichiers du pack sont validés par un installateur qui modifie seulement les deux collections mondiales, leurs assets et les trois fichiers JavaScript concernés. Les filtres 2018, l'exception Western, et les autres collections sont préservés.

**Aucune mise en production du pack n'a lieu avant l'envoi de ce ZIP.** Ne considérer le déploiement terminé qu'après statut vert de l'import et de **Deploy Oracle Production**, puis vérification en HTTPS.
