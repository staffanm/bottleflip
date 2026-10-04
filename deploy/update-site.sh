#!/bin/bash
# Run by the `update-bottleflip` hook in /etc/webhook.conf when GitHub pushes to the `deploy` branch.
# Copies the `deploy` branch (the build output from .github/workflows/deploy.yml) to the web root.
# Installed as ~/sites/update-bottleflip.sh by deploy/setup-webhook.sh.
set -euo pipefail

REPO=https://github.com/staffanm/bottleflip.git
CLONE=$HOME/.cache/bottleflip-deploy
ROOT=$HOME/sites/bottleflip.tomtebo.org

mkdir -p "$CLONE"
cd "$CLONE"

# Two runs can overlap
exec 9>"$CLONE.lock"
flock 9

git init -q
git fetch -q --depth 1 "$REPO" deploy
git reset -q --hard FETCH_HEAD

rsync -r --delete --exclude /.git/ ./ "$ROOT/"
echo "$(date): Updated bottleflip.tomtebo.org to $(git log -1 --format=%s)" >> /var/log/webhook-updates.log
