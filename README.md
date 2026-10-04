# Bottle Flip Simulator

A water-bottle flip simulator with fluid physics, a ten-level ladder, and shareable challenge links.
Live at https://bottleflip.tomtebo.org/. It installs as a PWA (Add to Home Screen).

The physics is deterministic: a fixed time step, no randomness, and its own sine and cosine.
The same settings give the same flip in every browser, so a share link replays the same throw.

## Development

    npm install
    npm run dev       # dev server
    npm run build     # build to dist/
    npm run preview   # serve dist/

## Files

- `index.html`: page markup
- `src/sim.js`: physics, scoring and levels (no DOM)
- `src/main.js`: UI, rendering, share links
- `src/style.css`: styles
- `scripts/icon.svg`: source of the app icon and favicon
- `scripts/render-icons.mjs`: `npm run icons` renders the icon to the PNG files in `public/` (needs a Playwright Chromium)
- `public/manifest.webmanifest`: PWA manifest

## Deploy

A push to `main` deploys the site. The GitHub Action (`.github/workflows/deploy.yml`) builds it and pushes `dist/` to the `deploy` branch.
The push to `deploy` fires the repository webhook. The hook `update-bottleflip` on ludo.tomtebo.org then runs `deploy/update-site.sh`,
which copies the branch to `/home/staffan/sites/bottleflip.tomtebo.org`. The update log is `/var/log/webhook-updates.log`.

`npm run deploy` builds locally and copies `dist/` with rsync, without GitHub.

One-time server setup: `deploy/setup-server.sh` (nginx site and TLS certificate) and `deploy/setup-webhook.sh` (the hook).
