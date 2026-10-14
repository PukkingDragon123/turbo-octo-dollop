import { chromium } from 'playwright-core';
import fs from 'fs';
// Collider-vs-visual audit for every furniture / item / device model (dev only).
// usage: tools/serve-test.sh 5190 && node tools/dbg/colaudit.mjs out.json   (AUDIT_BASE overrides the server)
const BASE = process.env.AUDIT_BASE || 'http://localhost:5190/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(BASE + 'gallery.html?set=none');
await page.waitForTimeout(3000);
const res = await page.evaluate(async () => { const m = await import('/tools/dbg/colaudit_page.js'); return m.audit(); });
fs.writeFileSync(process.argv[2] || 'colaudit.json', JSON.stringify(res, null, 0));
const flags = res.filter((x) => x.vis && (Math.abs(x.dyMin) > Math.max(0.012, 0.06 * x.vis[1]) || [x.rx, x.ry, x.rz].some((r) => r < 0.7 || r > 1.3)));
for (const x of flags) console.log(x.kind, x.key, 'vis', x.vis.join('/'), 'col', x.col.join('/'), 'dyMin', x.dyMin);
console.log('types', res.length, 'errors', logs.slice(0, 10));
await browser.close();
