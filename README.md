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

`npm run deploy` builds and copies `dist/` with rsync to `/home/staffan/sites/bottleflip.tomtebo.org` on ludo.tomtebo.org.
The nginx site and the TLS certificate are a one-time setup. See `deploy/setup-server.sh`.
