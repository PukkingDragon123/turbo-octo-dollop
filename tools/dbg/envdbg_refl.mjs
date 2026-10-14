import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('ERR', m.text().slice(0, 600)); });
await page.goto('http://localhost:5186/?auto=solo');
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__game && __game.world && !__game.loading && __game.state === 'playing')).catch(() => false)) break; await page.waitForTimeout(1000); }
await page.evaluate(() => { const g = __game; g.run = g._newRun(); g.hostLoadWorld({ type: 'yellow', seed: 4242, depth: 1, fresh: true }); });
await page.waitForTimeout(2000);
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__game && __game.world && !__game.loading && __game.world.type === 'yellow')).catch(() => false)) break; await page.waitForTimeout(1000); }
await page.evaluate(() => { const l = __game.local; l.teleport(new l.pos.constructor(31.5, 0, 22.5), 0); l.pitch = -0.3; });
await page.waitForTimeout(8000);
console.log(await page.evaluate(() => {
  const lv = __game.world.level, r = __engine.renderer, rt = lv.reflection.rt;
  const w = rt.width, h = rt.height;
  const buf = new Uint16Array(w * h * 4);
  r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const f16 = (u) => { const s = u >> 15, e = (u >> 10) & 31, m = u & 1023; if (e === 31) return m ? NaN : (s ? -Infinity : Infinity); return (s ? -1 : 1) * (e ? Math.pow(2, e - 15) * (1 + m / 1024) : Math.pow(2, -14) * m / 1024); };
  let nan = 0, sum = 0, n = 0, max = 0;
  for (let i = 0; i < w * h; i += 7) { const v = f16(buf[i * 4]); if (!Number.isFinite(v)) nan++; else { sum += v; n++; max = Math.max(max, v); } }
  return JSON.stringify({ w, h, nan, mean: +(sum / n).toFixed(4), max: +max.toFixed(3), needed: lv.reflection.needed });
}));
await browser.close();
