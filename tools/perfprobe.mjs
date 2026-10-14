// Render-cost probe: loads a level and reports renderer.info (draw calls, triangles, textures,
// geometries, programs), JS heap and load time at a few views.
//   node tools/perfprobe.mjs [level=yellow|lobby|poolrooms|grasslands] [baseUrl]
import { chromium } from 'playwright-core';
const level = process.argv[2] || 'yellow';
const base = process.argv[3] || 'http://localhost:5174/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const t0 = Date.now();
await page.goto(base + (level === 'lobby' ? '?auto=solo' : `?auto=solo&level=${level}`));
for (let i = 0; i < 400; i++) {
  const ok = await page.evaluate((lv) => !!(window.__game && __game.world && !__game.loading && __game.state === 'playing' && __game.world.type === lv), level).catch(() => false);
  if (ok) break;
  await page.waitForTimeout(500);
}
const loadS = (Date.now() - t0) / 1000;
await page.evaluate(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
await page.waitForTimeout(4000);
const sample = () => page.evaluate(() => {
  const r = __engine.renderer;
  r.info.autoReset = false; r.info.reset();
  __engine.render(0.016);
  const i = r.info;
  const out = { calls: i.render.calls, tris: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, props: __game.world.props.props.size };
  r.info.autoReset = true;
  return out;
});
const views = [];
for (const yaw of [0, 1.57, 3.14, 4.71]) {
  await page.evaluate((y) => { __game.local.yaw = y; __game.local.pitch = 0; }, yaw);
  await page.waitForTimeout(1500);
  views.push({ yaw, ...(await sample()) });
}
console.log(JSON.stringify({ level, loadS, views, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
