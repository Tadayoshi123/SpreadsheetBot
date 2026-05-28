#!/usr/bin/env bash
# Run on the GCP VM after clone in ~/spreadsheet-bot (any Linux user).
set -euo pipefail

APP_DIR="${HOME}/spreadsheet-bot"
USER_NAME="$(whoami)"
cd "$APP_DIR"

if [[ ! -f package.json ]]; then
  echo "Erreur : lance ce script depuis ~/spreadsheet-bot (package.json introuvable)."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Crée d'abord .env (cp .env.example .env && nano .env)"
  exit 1
fi

echo "==> Node.js 20"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Build"
npm ci
npm run build

echo "==> systemd (${USER_NAME})"
sed -e "s|REPLACE_USER|${USER_NAME}|g" -e "s|REPLACE_HOME|${HOME}|g" \
  deploy/gcp/spreadsheet-bot.service | sudo tee /etc/systemd/system/spreadsheet-bot.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable spreadsheet-bot
sudo systemctl restart spreadsheet-bot

echo "==> Status"
sleep 2
sudo systemctl status spreadsheet-bot --no-pager
