# Affiches Films Monde et Séries Monde

Les catalogues utilisent `fast-artwork-v2` pour forcer le rechargement des anciens
visuels côté client. Les trois champs de vignettes Modern/Classic (`poster`,
`background`, `landscapePoster`) désignent désormais le même JPEG 960×540. Le
`banner` Desktop conserve son propre design, également en JPEG 960×540.
Les titres, dates, services et ratios sont conservés ; les détails gardent leurs
images originales. Les covers de genres approuvées restent en 1600×900.

Le cache photo partagé regroupe les téléchargements simultanés et réutilise les
photos entre rendus. Les budgets mémoire sont de 32 Mio pour les sources et 64 Mio
pour les cartes. Douze téléchargements et quatre rendus peuvent être actifs ; une
photo lente ne bloque pas les rendus dont les photos sont déjà chargées.
Les sources non valides ne sont pas conservées. Un poster peut remplacer un
backdrop indisponible. Un échec temporaire renvoie une carte titrée avec `no-store`,
respecté par le routeur et le cache disque, pour permettre une nouvelle tentative.

Les images révisées gardent leur cache disque lors d'un déploiement. Les réponses
JSON conservent leur isolation par version du code. Le cache disque est limité à
8192 entrées et son nettoyage est unique, au plus une fois toutes les dix minutes,
au lieu de reparcourir le dossier tous les 64 nouveaux fichiers.

Oracle installe les polices DejaVu et Noto pour les titres rasterisés, y compris les
titres asiatiques. `scripts/benchmark-artwork.cjs` teste les vraies cartes Films
Monde et Séries Monde avec huit requêtes simultanées, puis leur relecture en cache.
Le déploiement vérifie le format JPEG, le décodage et les dimensions de chaque carte.

Validation : tests photo/rendu en rafale, budgets mémoire, récupération après panne,
photo alternative, cache conservé après redémarrage sur une autre version du code,
et suite complète existante. Les mesures serveur ne reproduisent pas le décodeur
ou le réseau d'une Shield physique.

Après publication, fermer complètement Nuvio puis le relancer recharge les nouvelles
URL d'images. Les identifiants de collections et de catalogues restent identiques.
