#!/usr/bin/env bash
# First install on a fresh Ubuntu 24.04 VPS. Run as root from the folder holding the uploaded app:
#   bash deploy/install.sh tasks.example.ir
set -euo pipefail
DOMAIN="${1:?usage: install.sh <subdomain>}"
APP=/opt/vazifeh
DATA=/var/lib/vazifeh

apt-get update
apt-get install -y nginx certbot curl ca-certificates rsync
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

id vazifeh >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin vazifeh
mkdir -p "$APP" "$DATA/downloads"
rsync -a --delete --exclude node_modules --exclude android --exclude .data --exclude build-output ./ "$APP/"
cd "$APP" && npm ci --omit=dev --no-audit --no-fund
chown -R vazifeh:vazifeh "$DATA"

cp deploy/vazifeh.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now vazifeh

sed "s/tasks.example.ir/$DOMAIN/g" deploy/nginx-vazifeh.conf > /etc/nginx/sites-available/vazifeh
# Certificate first (nginx needs it for the 443 block): temporary HTTP-only start.
sed -n '1,7p' /etc/nginx/sites-available/vazifeh > /etc/nginx/sites-enabled/vazifeh
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
ln -sf /etc/nginx/sites-available/vazifeh /etc/nginx/sites-enabled/vazifeh
nginx -t && systemctl reload nginx
echo "Done: https://$DOMAIN  (first sign-in: admin / admin, then change the password)"
