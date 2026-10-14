// Dev: list the shader programs a level compiles, grouped by material type + custom cache key family.
//   node tools/dbg/programs.mjs [lobby|yellow|poolrooms|grasslands]
import { chromium } from 'playwright-core';
const level = process.argv[2] || 'yellow';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
await page.goto('http://localhost:5174/' + (level === 'lobby' ? '?auto=solo' : `?auto=solo&level=${level}`));
for (let i = 0; i < 1200; i++) { if (await page.evaluate((lv) => !!(window.__game?.world && !window.__game.loading && window.__game.state === 'playing' && window.__game.world.type === lv), level).catch(() => false)) break; await page.waitForTimeout(1000); }
await page.waitForTimeout(3000);
const res = await page.evaluate(() => {
  const progs = __engine.renderer.info.programs || [];
  const fam = new Map();
  for (const p of progs) {
    const key = p.cacheKey || '';
    // custom keys are appended by onBeforeCompile users; take the material name + first custom token
    const parts = key.split(',');
    const name = p.name || parts[0];
    const custom = parts.filter((x) => /[a-z]_|probe|baked|dv|tri|debris|haze|pool|grass|doll|still|bac/i.test(x)).slice(0, 2).join('|').slice(0, 60);
    const k = `${name} ${custom}`;
    fam.set(k, (fam.get(k) || 0) + 1);
  }
  return { total: progs.length, families: [...fam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40) };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
