// Dev: shader programs compiled after the loading screen drops (each one is an in-game hitch on real GPUs).
//   node tools/dbg/latecompile.mjs [lobby|yellow|poolrooms|grasslands]
import { chromium } from 'playwright-core';
const level = process.argv[2] || 'yellow';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { return 'ERR ' + e.message; } };
await page.goto('http://localhost:5174/' + (level === 'lobby' ? '?auto=solo' : `?auto=solo&level=${level}`));
// sample the program count the moment the loading screen drops, then while playing
let atLoad = null;
const t0 = Date.now();
for (let i = 0; i < 3000; i++) {
  const s = await ev((lv) => ({ ok: !!(window.__game?.world && !window.__game.loading && window.__game.state === 'playing' && window.__game.world.type === lv), n: window.__engine?.renderer.info.programs?.length || 0 }), level);
  if (s.ok) { atLoad = s.n; break; }
  await page.waitForTimeout(200);
}
const out = [['load', atLoad, ((Date.now() - t0) / 1000) | 0]];
for (let k = 0; k < 6; k++) {
  await page.waitForTimeout(5000);
  out.push([`+${(k + 1) * 5}s`, await ev(() => __engine.renderer.info.programs.length), await ev(() => __game.world.props.props.size)]);
}
console.log(level, JSON.stringify(out));
await browser.close();
