// Screenshot the environment material preview: node tools/envpreview.mjs "<query>" out.png [w] [h]
//   e.g. node tools/envpreview.mjs "mats=wallpaper,carpet&size=2&cols=2" tools/shots/envmat.png 1400 900
import { chromium } from 'playwright-core';
const [query = '', out = 'tools/shots/envmat.png', w = '1500', h = '900'] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:5186/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/^\[env\]/.test(t)) console.log(t); else if (['error', 'warning'].includes(m.type()) && !/favicon|404|GPU stall/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + 'src/world/env/preview.html?' + query);
for (let i = 0; i < 600; i++) { if (await page.evaluate(() => !!window.__galleryDone).catch(() => false)) break; await page.waitForTimeout(500); }
console.log('ready after', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(300);
await page.screenshot({ path: out, timeout: 180000 });
console.log('saved', out);
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
