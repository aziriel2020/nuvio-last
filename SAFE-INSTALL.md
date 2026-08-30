# Installation sûre — v1.3.1

1. Déployer le contenu de ce dossier/ZIP sur le même projet Vercel.
2. Vérifier `/fr/manifest.json`, `/global/manifest.json`, `/us/manifest.json`.
3. **Actualiser ou réinstaller le manifest Global** dans Nuvio : le manifest expose désormais correctement les types `movie` et `series`.
4. Réimporter `imports/nuvio-collections-fr-global-us-all.json`.
5. Les IDs existants sont conservés. Les nouvelles Collections `Genres · Séries` ont des IDs distincts et s’ajoutent sans collision.

Ne supprime pas les Collections existantes avant l’import : les IDs identiques servent à les mettre à jour.

## Türkiye v1.4.0
- Addon: `https://nuvio-last.vercel.app/tr/manifest.json`
- Import Türkiye: `https://nuvio-last.vercel.app/nuvio-collections-tr.json`
- IDs `calendar-archives-tr-*` et addon `com.nuvio.calendar.archives.tr.coexist` sont isolés de FR/Global/US.
- Marché forcé TR, langue tr-TR, fuseau Europe/Istanbul.
