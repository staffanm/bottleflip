#!/bin/bash
# One-time setup of bottleflip.tomtebo.org on the web server. Run it on the server, as a user with sudo.
# It needs deploy/bottleflip.tomtebo.org.nginx in the same directory.
#
#   scp deploy/bottleflip.tomtebo.org.nginx deploy/setup-server.sh staffan@ludo.tomtebo.org:/tmp/
#   ssh -t staffan@ludo.tomtebo.org 'bash /tmp/setup-server.sh'
#
# Then, from the repository: npm run deploy
set -euo pipefail

SITE=bottleflip.tomtebo.org
HERE=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$HOME/sites/$SITE"
sudo cp "$HERE/$SITE.nginx" "/etc/nginx/sites-available/$SITE"
sudo ln -sf "/etc/nginx/sites-available/$SITE" "/etc/nginx/sites-enabled/$SITE"
sudo nginx -t
sudo systemctl reload nginx

# certbot edits the nginx site and adds the HTTPS redirect
sudo certbot --nginx --redirect -d "$SITE"

echo "Done. Now run 'npm run deploy' in the repository."
