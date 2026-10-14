// Headless gallery screenshot: node tools/gallery.mjs "<query>" out.png [w] [h]
//   e.g. node tools/gallery.mjs "set=furniture&from=0&n=12" tools/shots/gal_furn0.png 1400 900
import { chromium } from 'playwright-core';
const [query = 'set=furniture', out = 'tools/shots/gallery.png', w = '1400', h = '900'] = process.argv.slice(2);
const base = process.env.GALLERY_BASE || 'http://localhost:5174/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|404|parallel_shader|GPU stall/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + 'gallery.html?' + query);
for (let i = 0; i < 300; i++) { if (await page.evaluate(() => !!window.__galleryDone).catch(() => false)) break; await page.waitForTimeout(500); }
await page.waitForTimeout(+(process.env.GALLERY_WAIT || 300));
await page.screenshot({ path: out, timeout: 180000 });
console.log('saved', out);
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
