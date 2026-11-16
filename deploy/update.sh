#!/usr/bin/env bash
# Later updates: upload the new version next to the old one and run as root from its folder.
set -euo pipefail
APP=/opt/vazifeh
rsync -a --delete --exclude node_modules --exclude android --exclude .data --exclude build-output ./ "$APP/"
cd "$APP" && npm ci --omit=dev --no-audit --no-fund
systemctl restart vazifeh
echo "Updated to $(node -p 'require("./package.json").version')"
