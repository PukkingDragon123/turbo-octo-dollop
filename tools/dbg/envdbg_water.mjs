import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300)); });
await page.goto('http://localhost:5186/?auto=solo');
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__game && __game.world && !__game.loading && __game.state === 'playing')).catch(() => false)) break; await page.waitForTimeout(1000); }
await page.evaluate(() => { const g = __game; g.run = g._newRun(); g.hostLoadWorld({ type: 'yellow', seed: 4242, depth: 1, fresh: true }); });
await page.waitForTimeout(2000);
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__game && __game.world && !__game.loading && __game.world.type === 'yellow')).catch(() => false)) break; await page.waitForTimeout(1000); }
await page.evaluate(() => { const l = __game.local; l.teleport(new l.pos.constructor(31.5, 0, 22.5), 0); });
await page.waitForTimeout(6000);
console.log(await page.evaluate(() => {
  const lv = __game.world.level; const out = [];
  for (const rec of lv.chunks.values()) {
    if (!rec.waterMesh) continue;
    const g = rec.waterMesh.geometry; const w = g.attributes.aLightW.array, c = g.attributes.aLightCells.array;
    let s = 0; for (let i = 0; i < w.length; i++) s += w[i];
    out.push({ chunk: [rec.cx, rec.cz], verts: g.attributes.position.count, wsum: +s.toFixed(2), cells: Array.from(c.slice(0, 8)), w: Array.from(w.slice(0, 8)).map((v) => +v.toFixed(3)), vis: rec.waterMesh.visible, refl: lv.reflection.enabled });
  }
  return JSON.stringify(out);
}));
await browser.close();
