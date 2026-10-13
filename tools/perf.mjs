// Headless perf probe: loads a URL, waits, then samples frame times & game stats.
import { chromium } from 'playwright-core';
const [url, waitMs = '30000', sampleMs = '8000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(+waitMs);
const r = await page.evaluate(async (ms) => {
  const times = [];
  let last = performance.now();
  const longTasks = [];
  await new Promise((res) => {
    const t0 = performance.now();
    function f(now) { times.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else res(); }
    requestAnimationFrame(f);
  });
  const g = window.__game, e = window.__engine;
  times.sort((a, b) => a - b);
  return {
    frames: times.length, median: times[times.length >> 1]?.toFixed(1), p90: times[Math.floor(times.length * 0.9)]?.toFixed(1),
    calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles, geos: e.renderer.info.memory.geometries, tex: e.renderer.info.memory.textures,
    chunks: g.world?.level?.chunks?.size, buildMs: g.world?.level?.buildMs?.toFixed(1), props: g.world?.props.props.size,
    pos: g.local.pos.toArray().map((v) => +v.toFixed(2)), grounded: g.local.grounded, mons: g.world?.monsters?.views?.size,
  };
}, +sampleMs);
console.log(JSON.stringify(r));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
