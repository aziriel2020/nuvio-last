#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

PUBLIC_HOST="${PUBLIC_HOST:?PUBLIC_HOST is required}"
REPO_URL="${NUVIO_REPO_URL:-https://github.com/aziriel2020/nuvio-last.git}"
BRANCH="${NUVIO_BRANCH:-main}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git jq ufw sudo debian-keyring debian-archive-keyring apt-transport-https gnupg

if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

id -u nuvio >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/nuvio --shell /bin/bash nuvio

mkdir -p /opt/nuvio/source /opt/nuvio/releases /etc/nuvio /var/cache/nuvio /var/log/caddy
chown -R nuvio:nuvio /opt/nuvio /var/cache/nuvio
chown -R caddy:caddy /var/log/caddy

if [[ ! -d /opt/nuvio/source/.git ]]; then
  rm -rf /opt/nuvio/source
  sudo -u nuvio -H git clone --filter=blob:none "$REPO_URL" /opt/nuvio/source
fi

# Git 2.35+ may reject repositories reached through sudo even when the target
# working tree is owned by the service account. Trust only this exact repo path.
sudo -u nuvio -H git config --global --add safe.directory /opt/nuvio/source
sudo -u nuvio -H git -C /opt/nuvio/source fetch --prune origin "$BRANCH"
SHA="$(sudo -u nuvio -H git -C /opt/nuvio/source rev-parse "origin/$BRANCH")"
if [[ ! -d "/opt/nuvio/releases/$SHA" ]]; then
  sudo -u nuvio -H git -C /opt/nuvio/source worktree add --detach "/opt/nuvio/releases/$SHA" "$SHA"
fi
ln -sfn "/opt/nuvio/releases/$SHA" /opt/nuvio/current

install -m 0644 /opt/nuvio/current/oracle/nuvio.service /etc/systemd/system/nuvio.service
install -m 0644 /opt/nuvio/current/oracle/nuvio-update.service /etc/systemd/system/nuvio-update.service
install -m 0644 /opt/nuvio/current/oracle/nuvio-update.timer /etc/systemd/system/nuvio-update.timer
chmod +x /opt/nuvio/current/oracle/update.sh

sed "s/__PUBLIC_HOST__/$PUBLIC_HOST/g" /opt/nuvio/current/oracle/Caddyfile.template > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# OCI Ubuntu images can ship a base iptables policy in front of UFW.
# Explicitly allow the public service ports at the top of INPUT as well.
for port in 22 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done

cat >/usr/local/sbin/nuvio-ensure-firewall.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
for port in 22 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
EOF
chmod 0755 /usr/local/sbin/nuvio-ensure-firewall.sh

cat >/etc/systemd/system/nuvio-firewall.service <<'EOF'
[Unit]
Description=Ensure Nuvio public firewall rules
After=network-online.target
Wants=network-online.target
Before=caddy.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/nuvio-ensure-firewall.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now nuvio-firewall.service
systemctl enable caddy
systemctl restart caddy

if [[ ! -f /etc/nuvio/nuvio.env ]]; then
  cat >/etc/nuvio/nuvio.env <<EOF
PUBLIC_HOST=$PUBLIC_HOST
PUBLIC_ORIGIN=https://$PUBLIC_HOST
NUVIO_TIMEZONE=Europe/Brussels
NUVIO_REPO_URL=$REPO_URL
NUVIO_BRANCH=$BRANCH
EOF
  chmod 600 /etc/nuvio/nuvio.env
fi

/opt/nuvio/current/oracle/update.sh
systemctl enable --now nuvio-update.timer

echo "Oracle Nuvio bootstrap complete: https://$PUBLIC_HOST"
