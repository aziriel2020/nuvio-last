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

echo "Preparing Nuvio Oracle release $SHORT"
run_nuvio "if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi"
run_nuvio "npm test"
run_nuvio "npm run test:runtime"

# Generated collection covers are release assets consumed by the Oracle integration
# test itself. Reuse the previous set only as a warm cache; the revisioned generator
# invalidates and fully rebuilds it whenever the art-direction revision changes.
if [[ -n "$PREVIOUS" && -d "$PREVIOUS/assets/generated-covers" && ! -d "$TARGET/assets/generated-covers" ]]; then
  cp -a "$PREVIOUS/assets/generated-covers" "$TARGET/assets/generated-covers"
  chown -R nuvio:nuvio "$TARGET/assets/generated-covers"
fi

echo "Generating/validating Nuvio cinematic collection covers"
(
  cd "$TARGET"
  npm run generate:covers
)
chown -R nuvio:nuvio "$TARGET/assets/generated-covers"

# The Oracle integration test deliberately builds a local 127.0.0.1 fixture.
# Run it AFTER cover generation so the fixture validates the exact release artwork,
# but BEFORE the final public-origin build so localhost URLs can never be switched.
run_nuvio "npm run test:oracle"

if [[ -z "${PUBLIC_ORIGIN:-}" ]]; then
  if [[ -z "${PUBLIC_HOST:-}" ]]; then
    echo "PUBLIC_ORIGIN or PUBLIC_HOST must be configured in $ENV_FILE" >&2
    exit 1
  fi
  PUBLIC_ORIGIN="https://$PUBLIC_HOST"
fi

# This MUST be the last build before the atomic switch. It rewrites every static
# Nuvio JSON/manifests URL to the real Oracle public origin.
run_nuvio "PUBLIC_ORIGIN='$PUBLIC_ORIGIN' NUVIO_RUNTIME='oracle-vm' npm run build:runtime"

# Fail closed if the final static release contains any test/legacy hosting origin.
run_nuvio "PUBLIC_ORIGIN='$PUBLIC_ORIGIN' node - <<'NODE'
const fs = require('fs');
const path = require('path');
const dist = path.resolve('dist');
const forbidden = /(?:127\\.0\\.0\\.1:3317|pages\\.dev|workers\\.dev|vercel\\.app|sslip\\.io)/i;
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const jsonFiles = walk(dist).filter((file) => file.endsWith('.json'));
if (!jsonFiles.length) throw new Error('Final Oracle dist contains no JSON files');
for (const file of jsonFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (forbidden.test(text)) throw new Error('Forbidden origin in final build: ' + path.relative(dist, file));
}
const install = JSON.parse(fs.readFileSync(path.join(dist, 'install.json'), 'utf8'));
if (!String(install.combinedCollections || '').startsWith(process.env.PUBLIC_ORIGIN + '/')) {
  throw new Error('Final Oracle build origin mismatch: ' + install.combinedCollections);
}
console.log('Final Oracle build origin verified:', process.env.PUBLIC_ORIGIN);
NODE"

install -m 0644 "$TARGET/oracle/nuvio.service" /etc/systemd/system/nuvio.service
install -d -m 0755 /etc/nuvio
printf 'NUVIO_GIT_SHA=%s\n' "$SHA" > /etc/nuvio/release.env.new
chmod 0644 /etc/nuvio/release.env.new
mv -f /etc/nuvio/release.env.new /etc/nuvio/release.env
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
