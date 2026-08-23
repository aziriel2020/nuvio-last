# Nuvio USA Releases v4.0.1

Add-on NuvioTV/Stremio compatible conçu comme un **calendrier temporel** : nouvelles sorties streaming USA, diffusions TV américaines converties dans le fuseau du spectateur et calendrier anime.

## Règle temporelle centrale

La v4 sépare volontairement les **dates civiles** des **timestamps** :

- **Streaming** (`Netflix`, `Prime Video`, `Disney+`, `Max`, `Apple TV+`, `Hulu`, `Paramount+`, `Peacock`, `Crunchyroll`) : une date officielle reste la même date. Une date `2026-08-24` n'est jamais transformée artificiellement en `00:00` puis décalée de jour.
- **TV broadcast USA** : TVmaze `airstamp` représente un vrai instant. Il est converti vers `x-vercel-ip-timezone`. Une diffusion `23 août 21:00 ET` peut donc devenir `24 août 03:00` à Bruxelles.
- **Anime** : AniList `airingAt` est converti vers le fuseau du spectateur, mais reste explicitement une **diffusion originale**. Il n'est jamais présenté comme l'heure de publication Crunchyroll/Netflix sans source dédiée.

Le marché commercial reste toujours **US**. Le pays du spectateur ne modifie jamais `watch_region=US`.

## Catalogues

### Plateformes US

Deux lignes maximum par plateforme :

- Netflix • Films / Séries
- Prime Video • Films / Séries
- Disney+ • Films / Séries
- Max • Films / Séries
- Apple TV+ • Films / Séries
- Hulu • Films / Séries
- Paramount+ • Films / Séries
- Peacock • Films / Séries
- Crunchyroll • Films / Séries

Les lignes streaming couvrent `today → J+6` et excluent les contenus passés.

### TV USA

- TV USA • Aujourd’hui
- TV USA • À venir

Seuls les vrais réseaux broadcast US (`show.network`) sont utilisés ici. Les web channels TVmaze sont volontairement exclus de cette ligne pour ne pas mélanger streaming et broadcast.

### Anime

- Anime • Aujourd’hui
- Anime • À venir

Le calendrier AniList est converti vers l'heure locale du spectateur. Un mapping TMDb strict (titre exact normalisé + année exacte) est requis avant publication dans Nuvio afin de conserver des IDs compatibles. En cas de doute : exclusion plutôt que faux match.

## Films : qualité > quantité

Un film doit :

1. être en `flatrate` sur le provider US demandé ;
2. avoir une vraie date TMDb `Digital` (release type 4) aux USA ;
3. avoir cette date entre aujourd'hui et J+6.

Un film de 2024 encore présent sur Netflix en 2026 est exclu.

## Séries streaming

La v4 utilise en priorité le **Web/Streaming Schedule TVmaze** pour lier un épisode à son vrai web channel (Netflix, Prime Video, Disney+, etc.), puis revalide la série contre le provider `flatrate` US de TMDb. Cela évite de prendre un simple `next_episode_to_air` broadcast d'une série qui serait seulement présente en anciennes saisons sur une plateforme.

Pour un web channel global, `airdate` reste une **date civile officielle** et aucune heure n'est inventée. Pour un web channel local US, une heure TVmaze peut être utilisée comme `STREAMING_INSTANT`, mais la date officielle de sortie reste la date civile annoncée.

## Timezone

Le fuseau est lu à chaque requête depuis :

```text
x-vercel-ip-timezone
```

Fallback : `UTC`.

Aucune IP n'est stockée ou exposée.

La fenêtre est recalculée à chaque requête :

```text
today = date locale du spectateur
week = today → today + 6 jours
```

Les clés de cache incluent le fuseau et la date locale, donc le passage à minuit invalide naturellement l'ancienne journée.

## Sources

- **TMDb** : métadonnées, release dates, IDs et providers US/JustWatch.
- **TVmaze** : horaires broadcast TV USA via `airstamp` et dates/horaires des web channels via le Web/Streaming Schedule.
- **AniList** : calendrier d'airing anime via `airingAt`.

Les sources externes sont isolées : une panne AniList n'affecte pas les catalogues Netflix ; une panne TVmaze n'affecte pas les films streaming.

## Installation Vercel

Variable sensible recommandée :

```text
TMDB_READ_TOKEN=...
```

`TMDB_API_KEY` reste supportée en fallback.

Puis installe :

```text
https://TON-PROJET.vercel.app/manifest.json
```

## Health

```text
/health
```

Retour type :

```json
{
  "ok": true,
  "version": "4.0.1",
  "market": "US",
  "timezone": "Europe/Brussels",
  "today": "2026-08-23",
  "currentTime": "13:17",
  "tmdb": "ok",
  "tvmaze": "ok",
  "anilist": "ok",
  "providers": {
    "Netflix": true,
    "Prime Video": true
  }
}
```

Aucun secret ni IP n'est renvoyé.

## Debug facultatif

Avec :

```text
DEBUG=true
```

Routes :

```text
/debug/time
/debug/provider/netflix
/debug/provider/netflix?period=today
/debug/airing/tvmaze-123456
/debug/airing/anilist-123456
```

Les diagnostics d'airing exposent seulement les timestamps et conversions sûres, jamais les tokens.

## Performance / résilience

- caches courts pour schedules/catalogues ;
- cache long pour mapping anime → TMDb ;
- concurrence limitée ;
- `Promise.allSettled` ;
- timeout séparé TMDb/sources ;
- retry contrôlé `429` / `5xx` ;
- un item défectueux ne fait pas tomber toute la ligne.

## Tests

```bash
npm test
```

La suite couvre notamment :

- contenu passé ;
- vieux film encore disponible ;
- date streaming sans heure ;
- épisode TV ET/PT converti à Bruxelles ;
- changement DST USA/Europe ;
- épisode déjà diffusé aujourd'hui ;
- TVmaze `airstamp` prioritaire ;
- web channels exclus du broadcast ;
- AniList `airingAt` ;
- mapping anime strict ;
- cache par date/fuseau ;
- providers US ;
- 401 et 429 sans fuite de secrets.

## Attribution

Données/images : TMDb. Disponibilités streaming : JustWatch via TMDb. Horaires TV et web schedules : TVmaze. Airing anime : AniList. Cet add-on ne fournit aucun flux vidéo. This product uses the TMDB API but is not endorsed or certified by TMDB.
