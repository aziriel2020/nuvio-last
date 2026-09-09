#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${NUVIO_REPO_URL:-https://github.com/aziriel2020/nuvio-last.git}"
BRANCH="${NUVIO_BRANCH:-main}"
BASE="/opt/nuvio"
SOURCE="$BASE/source"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
ENV_FILE="/etc/nuvio/nuvio.env"
PREVIOUS="$(readlink -f "$CURRENT" 2>/dev/null || true)"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$RELEASES"

# update.sh runs as root while the source checkout belongs to the nuvio account.
# Trust only this exact repository path so Git 2.35+ does not reject it.
git config --global --add safe.directory "$SOURCE"

if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --filter=blob:none "$REPO_URL" "$SOURCE"
fi

git -C "$SOURCE" fetch --prune origin "$BRANCH"
SHA="$(git -C "$SOURCE" rev-parse "origin/$BRANCH")"
SHORT="${SHA:0:12}"
TARGET="$RELEASES/$SHA"

if [[ -L "$CURRENT" ]] && [[ "$(readlink -f "$CURRENT")" == "$TARGET" ]] && systemctl is-active --quiet nuvio; then
  echo "Nuvio already running $SHORT"
  exit 0
fi

if [[ ! -d "$TARGET" ]]; then
  git -C "$SOURCE" worktree add --detach "$TARGET" "$SHA"
fi

chown -R nuvio:nuvio "$TARGET"

run_nuvio() {
  sudo -u nuvio -H bash -lc "cd '$TARGET' && $*"
}

echo "Preparing Nuvio release $SHORT"
run_nuvio "if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi"
run_nuvio "npm test"
run_nuvio "npm run test:cloudflare"

if [[ -z "${PUBLIC_ORIGIN:-}" ]]; then
  if [[ -z "${PUBLIC_HOST:-}" ]]; then
    echo "PUBLIC_ORIGIN or PUBLIC_HOST must be configured in $ENV_FILE" >&2
    exit 1
  fi
  PUBLIC_ORIGIN="https://$PUBLIC_HOST"
fi

run_nuvio "PUBLIC_ORIGIN='$PUBLIC_ORIGIN' NUVIO_RUNTIME='oracle-vm' npm run build:cloudflare"

install -m 0644 "$TARGET/oracle/nuvio.service" /etc/systemd/system/nuvio.service
install -m 0644 "$TARGET/oracle/nuvio-update.service" /etc/systemd/system/nuvio-update.service
install -m 0644 "$TARGET/oracle/nuvio-update.timer" /etc/systemd/system/nuvio-update.timer
chmod +x "$TARGET/oracle/update.sh"

if [[ -n "${PUBLIC_HOST:-}" ]]; then
  sed "s/__PUBLIC_HOST__/$PUBLIC_HOST/g" "$TARGET/oracle/Caddyfile.template" > /etc/caddy/Caddyfile.new
  caddy validate --config /etc/caddy/Caddyfile.new
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
fi

ln -sfn "$TARGET" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$CURRENT"
chown -h nuvio:nuvio "$CURRENT"

systemctl daemon-reload
systemctl restart nuvio
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for _ in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/_oracle/health >/tmp/nuvio-health.json; then
    echo "Release $SHORT healthy"
    break
  fi
  sleep 1
done

if ! curl -fsS --max-time 5 http://127.0.0.1:3000/_oracle/health >/dev/null; then
  echo "New Nuvio release failed local health check" >&2
  journalctl -u nuvio -n 80 --no-pager >&2 || true
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" && "$PREVIOUS" != "$TARGET" ]]; then
    echo "Rolling back to $(basename "$PREVIOUS")" >&2
    ln -sfn "$PREVIOUS" "$BASE/current.rollback"
    mv -Tf "$BASE/current.rollback" "$CURRENT"
    systemctl restart nuvio
    systemctl reload caddy 2>/dev/null || true
  fi
  exit 1
fi

mapfile -t OLD_RELEASES < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +4 | cut -d' ' -f2-)
for old in "${OLD_RELEASES[@]:-}"; do
  [[ -z "$old" || "$old" == "$TARGET" ]] && continue
  git -C "$SOURCE" worktree remove --force "$old" 2>/dev/null || rm -rf "$old"
done
git -C "$SOURCE" worktree prune

echo "Nuvio Oracle deployment complete: $SHORT"
