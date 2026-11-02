#!/usr/bin/env bash
set -Eeuo pipefail
# Independent service: NEVER edits /opt/nuvio or its manifests/catalogs.
[[ "$(id -u)" == 0 ]] || { echo "Root required" >&2; exit 1; }
BRANCH=feature/nuvio-account-mirror-oracle
BASE=/opt/nuvio-cloner
ENV=/etc/nuvio-cloner/cloner.env
REPO=https://github.com/aziriel2020/nuvio-last.git
id -u nuvio-cloner >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin nuvio-cloner
# This addon only needs the public Nuvio client key, not an admin login.
# Retrieve the same anon key used by the open-source Nuvio Account Manager.
install -d -m 0750 -o root -g nuvio-cloner /etc/nuvio-cloner
if [[ ! -s "$ENV" ]]; then
  key_line="$(curl -fsSL --retry 2 --max-time 20 https://raw.githubusercontent.com/techuhak/Nuvio-Account-Manager/main/lib/nuvio.ts | grep -m1 '^const SUPABASE_KEY = ' || true)"
  key="$(printf '%s' "$key_line" | cut -d "'" -f 2)"
  if [[ "$key" != eyJ* || "$key" != *.*.* ]]; then
    echo "Nuvio public API key could not be resolved; aborting" >&2
    exit 1
  fi
  printf 'NUVIO_SUPABASE_ANON_KEY=%s\n' "$key" > "$ENV"
  unset key key_line
fi
chown root:nuvio-cloner "$ENV"
chmod 0640 "$ENV"
if [[ ! -d "$BASE/source/.git" ]]; then
 git clone --filter=blob:none --single-branch --branch "$BRANCH" "$REPO" "$BASE/source"
else
 git -C "$BASE/source" fetch origin "$BRANCH"
 git -C "$BASE/source" checkout -B "$BRANCH" FETCH_HEAD
fi
chown -R root:root "$BASE/source";chmod -R go-w "$BASE/source"
node --check "$BASE/source/tools/nuvio-cloner/server-nuvio-login.mjs"
node --test "$BASE/source/tools/nuvio-cloner/test.mjs"
install -m 0644 "$BASE/source/tools/nuvio-cloner/nuvio-cloner.service" /etc/systemd/system/nuvio-cloner.service
if ! grep -q 'handle @nuvio_cloner' /etc/caddy/Caddyfile; then
 python3 - <<'PY'
from pathlib import Path
p=Path('/etc/caddy/Caddyfile')
s=p.read_text()
old='  reverse_proxy 127.0.0.1:3000'
assert s.count(old)==1, 'Unexpected Caddy configuration; refusing to patch'
new='  @nuvio_cloner path /cloner /cloner/*\n  handle @nuvio_cloner {\n    reverse_proxy 127.0.0.1:3001\n  }\n  handle {\n    reverse_proxy 127.0.0.1:3000\n  }'
p.with_name('Caddyfile.cloner.new').write_text(s.replace(old,new))
PY
 caddy validate --config /etc/caddy/Caddyfile.cloner.new
 cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-cloner
 mv /etc/caddy/Caddyfile.cloner.new /etc/caddy/Caddyfile
fi
systemctl daemon-reload
systemctl enable --now nuvio-cloner.service
systemctl is-active --quiet nuvio-cloner.service
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3001/cloner/health || true)
[[ "$status" == "200" ]] || { echo "Cloner local health check failed: expected 200, got $status" >&2;exit 1; }
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
systemctl is-active --quiet nuvio.service
systemctl is-active --quiet caddy.service
echo "Nuvio cloner installed; catalog runtime intact."
