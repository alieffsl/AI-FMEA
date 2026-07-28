#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${FMEA_APP_DIR:-/home/ubuntu/fmea}"

cd "$APP_DIR"

git pull --ff-only
git lfs pull
npm ci
npm --prefix server ci
npm run build:production

# Nginx needs to traverse /home/ubuntu and read the latest frontend build.
sudo setfacl -m "u:www-data:x" /home/ubuntu
sudo setfacl -R -m "u:www-data:rX" "$APP_DIR/dist"
sudo setfacl -R -d -m "u:www-data:rX" "$APP_DIR/dist"

sudo systemctl restart fmea

api_ready=false
for _ in {1..20}; do
  if curl --fail --silent \
    http://127.0.0.1:3001/api/checklist/stats > /dev/null; then
    api_ready=true
    break
  fi
  sleep 1
done

if [[ "$api_ready" != "true" ]]; then
  echo "FMEA API did not become ready after restart." >&2
  sudo journalctl -u fmea -n 50 --no-pager
  exit 1
fi

sudo nginx -t
sudo systemctl reload nginx

echo "FMEA deployment updated successfully."
