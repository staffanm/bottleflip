// Render scripts/icon.svg to the PNG icons and the favicon in public/.
// Needs a Chromium that Playwright has installed (npx playwright install chromium).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const pub = new URL('../public/', import.meta.url);

// The favicon has no background, so the bottle stands alone in the browser tab.
writeFileSync(new URL('favicon.svg', pub), svg.replace(/<rect class="bg"[^>]*\/>/, ''));

const sizes = {
  'icon-192.png': [192, svg],
  'icon-512.png': [512, svg],
  'apple-touch-icon.png': [180, svg],
  'favicon-32.png': [32, readFileSync(new URL('favicon.svg', pub), 'utf8')],
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, [size, src]] of Object.entries(sizes)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  writeFileSync(new URL(name, pub), await page.screenshot({ omitBackground: true }));
}
await browser.close();
