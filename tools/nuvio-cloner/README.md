# Nuvio Profile Mirror — isolated Oracle module

**Repository:** aziriel2020/nuvio-last
**Branch:** feature/nuvio-account-mirror-oracle
**Directory:** tools/nuvio-cloner/
**Intended URL:** https://141-145-215-202.nip.io/cloner/

## Functions
- Source account and source profile selection.
- Same account to different profile; different accounts and profiles; multiple destinations.
- Addons, plugins, collections, library and watched items (pagination, no silent 500-record cut).
- TV and Mobile synchronized settings, plus poster-only option.
- Destination profile name and avatar (ID, URL, color) are never overwritten; source profile background is copied. Previously overwritten names/photos need to be restored manually once.
- Poster settings TV: custom_poster_url_pattern and custom_poster_enabled_screens.
- Never calls the watch progress read or write RPCs: Continue Watching excluded.
- Missing/unauthorized profile IDs fail instead of using the first profile.

## Limits
- The Nuvio RPCs for some lists may merge, not fully replace target-only rows. Verify with
  test profiles before saying the mirror is exact.
- No copies of local device files, login sessions or provider credentials.
- TV and Mobile blobs can differ or be absent; missing cloud blobs cannot be cloned.
- Destination writes can replace collections. Confirmation is required in the UI.

## Isolation and security
This module contains no imports from the Oracle catalog application.
Systemd runs as a separate unprivileged user on 127.0.0.1:3001; public HTTP routing is
limited to /cloner and /cloner/* with catalog requests still going to 127.0.0.1:3000.
No separate admin password is needed. The app authenticates using each Nuvio account's credentials
for its API calls. No Nuvio passwords are saved in Git or files, and payloads are limited to 128KB.

Required root-controlled file /etc/nuvio-cloner/cloner.env, mode 0640:
    NUVIO_SUPABASE_ANON_KEY=<public Nuvio anon key>

Local check: node --test tools/nuvio-cloner/test.mjs
Staged installer: sudo bash tools/nuvio-cloner/install-oracle.sh

## Operational warning
The existing Oracle updater overwrites /etc/caddy/Caddyfile based on the MAIN
oracle/Caddyfile.template. A route added only on a feature branch is therefore
not persistent. To go live, review a minimal Caddy template change on main separately.
Do not change catalogs, manifests, addons, or deployment assets to host this page.
