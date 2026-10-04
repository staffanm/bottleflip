#!/bin/bash
# One-time setup of the deploy hook on the web server. Run it on the server, as a user with sudo.
# It needs deploy/update-site.sh in the same directory, and the webhook secret
# that the GitHub webhook of the repository uses:
#
#   scp deploy/update-site.sh deploy/setup-webhook.sh staffan@ludo.tomtebo.org:/tmp/
#   ssh -t staffan@ludo.tomtebo.org 'bash /tmp/setup-webhook.sh <secret>'
set -euo pipefail

SECRET=${1:?usage: setup-webhook.sh <secret>}
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$HOME/sites/update-bottleflip.sh

install -m 755 "$HERE/update-site.sh" "$SCRIPT"

# Add the hook, or replace it if it is there. It runs only for a signed push to the deploy branch.
HOOK=$(jq -n --arg cmd "$SCRIPT" --arg secret "$SECRET" '{
  id: "update-bottleflip",
  "execute-command": $cmd,
  "http-methods": ["POST"],
  "trigger-rule": {and: [
    {match: {type: "payload-hmac-sha256", secret: $secret, parameter: {source: "header", name: "X-Hub-Signature-256"}}},
    {match: {type: "value", value: "refs/heads/deploy", parameter: {source: "payload", name: "ref"}}}
  ]}}')
sudo cp /etc/webhook.conf /etc/webhook.conf.bak
jq --argjson hook "$HOOK" 'map(select(.id != "update-bottleflip")) + [$hook]' /etc/webhook.conf.bak | sudo tee /etc/webhook.conf >/dev/null
sudo systemctl restart webhook

echo "Done. A push to the main branch on GitHub now deploys the site."
