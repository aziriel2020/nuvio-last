#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
expected=97faafd150e93756e1ac20a6dd0a292903fa7aa0f1d379c856c37d2a50e9f44a
exec 9>/run/lock/listener-bridge-install.lock
flock -n 9
auth=/home/ubuntu/.ssh/authorized_keys
archive=$(mktemp /tmp/listener-source.XXXXXX)
cleanup() {
  rm -f -- "$archive" "$0"
  t=$(mktemp /home/ubuntu/.ssh/.listener-auth.XXXXXX)
  awk '$NF != "listener-bridge-20261126"' "$auth" > "$t"
  chown ubuntu:ubuntu "$t"; chmod 600 "$t"; mv -f "$t" "$auth"
}
trap cleanup EXIT
(ulimit -f 16384; timeout 120 cat > "$archive")
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status
root=/opt/listen-recorder-ultimate
host=listener.141-145-215-202.nip.io
origin=https://$host
[[ ! -e "$root" ]] || { echo 'Existing Listener installation; no overwrite.' >&2; exit 1; }
if (exec 3<>/dev/tcp/127.0.0.1/18185) 2>/dev/null; then echo 'Listener port is occupied.' >&2; exit 1; fi
stage=$(mktemp -d /opt/.listener-stage.XXXXXX)
tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions
printf '%s\n' "$expected" > "$stage/.listener-archive-sha"
cat > "$stage/.env" <<CONFIG
RECORDER_PASSWORD=$(openssl rand -hex 32)
LR_PORT=18185
LR_CPUS=1.0
LR_MEMORY=2g
MAX_SESSIONS=1
MAX_TRACK_SECONDS=3600
ALLOWED_ORIGINS=
PUBLIC_ORIGIN=$origin
CONFIG
chmod 600 "$stage/.env"
mv -T "$stage" "$root"
cd "$root"
export DEBIAN_FRONTEND=noninteractive
nice -n 10 bash INSTALL_ORACLE.sh
curl -fsS --max-time 10 http://127.0.0.1:18185/healthz
password=$(sed -n 's/^RECORDER_PASSWORD=//p' .env)
printf 'user = "recorder:%s"\n' "$password" | curl -fsS --config - --max-time 10 http://127.0.0.1:18185/api/status >/dev/null
printf 'LISTENER_CREDENTIAL_ENCRYPTED=%s\n' "$(printf '%s' "$password" | openssl pkeyutl -encrypt -pubin -inkey <(cat <<'CREDENTIAL_PUB'
-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA1/waefiaFzmnbvhlDQfR
bK9jfSjS+rHaqhes3z+4eizVy7hVD7LZlrCuOXm7IUcnLbvD+V/plft8EON3Uwxl
uf6rcPYbVhTsGvGDtQyhb5uqQ5VR3Aa6i7TOYrFqLrVJnIYtpseObbbfnX8dd/5b
f9G0x3a+5Uhea3MDVdwFoWzHwhemUah4Wn3K+8p2CqzX1bhFRtqcTS2/2PubcrBM
LdYxAylzwd2Pms3F/bPj3LbmDJ+RHioNfJI2zz4eeyzjTE0FWXj5FzxQeq8CXvjA
F72hqaYQMgW0nrfweP3n+tRRK4n7Eg2Tt2jhkc0Hw08RigD3AW0twHE9qsxmLIiP
2DfcHp8HNGZKzHS51PDTTVLz8LQzNN6XD18O4ZtTR4wAvJUsISnQ0aWB++ol5jg3
0cmuOAzqjL4IJcsZrsvHEFKNtEz7WyGj6AfcYui6XEUx7eglzS15+zSKr6Hyr6MU
TPuOtzcoNPH8dqhkuJWf+cxtZTAIKOhjeVEkV1mpeY4DAgMBAAE=
-----END PUBLIC KEY-----
CREDENTIAL_PUB
) -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 | base64 -w0)"
unset password
site=/etc/caddy/listener-ultimate.Caddyfile
hook=/usr/local/sbin/listener-ensure-caddy
[[ ! -e "$site" && ! -e "$hook" ]]
cat > "$site" <<CADDY
$host {
  header Strict-Transport-Security "max-age=31536000"
  reverse_proxy 127.0.0.1:18185 {
    flush_interval -1
  }
}
CADDY
chmod 644 "$site"
cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
set -Eeuo pipefail
exec 8>/run/lock/listener-caddy.lock
flock 8
config=/etc/caddy/Caddyfile
include='import /etc/caddy/listener-ultimate.Caddyfile'
[[ -f "$config" && -f /etc/caddy/listener-ultimate.Caddyfile ]]
grep -Fxq "$include" "$config" && exit 0
old=$(mktemp /etc/caddy/.listener-old.XXXXXX)
new=$(mktemp /etc/caddy/.listener-new.XXXXXX)
trap 'rm -f "$old" "$new"' EXIT
cp -p "$config" "$old"
cp -p "$config" "$new"
printf '\n%s\n' "$include" >> "$new"
caddy validate --adapter caddyfile --config "$new"
cmp -s "$old" "$config" || { echo 'Concurrent Caddy change; retry later.' >&2; exit 1; }
mv -f "$new" "$config"
if ! systemctl reload caddy; then
  cp -p "$old" "$config"
  systemctl reload caddy || true
  exit 1
fi
HOOK
chmod 755 "$hook"
"$hook"
curl -fsS --max-time 15 https://141-145-215-202.nip.io/_oracle/health >/dev/null
cat > /etc/systemd/system/listener-caddy-ensure.service <<'UNIT'
[Unit]
Description=Restore isolated Listener Caddy import
After=caddy.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/listener-ensure-caddy
UNIT
cat > /etc/systemd/system/listener-caddy-ensure.path <<'UNIT'
[Unit]
Description=Watch Caddy configuration for Listener import
[Path]
PathChanged=/etc/caddy/Caddyfile
Unit=listener-caddy-ensure.service
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now listener-caddy-ensure.path
for i in $(seq 1 30); do
  if curl -fsS --max-time 10 "$origin/healthz"; then
    printf '\nVerified HTTPS: %s\n' "$origin"
    exit 0
  fi
  sleep 5
done
echo 'Local Listener is ready; public TLS has not passed verification.' >&2
exit 1
