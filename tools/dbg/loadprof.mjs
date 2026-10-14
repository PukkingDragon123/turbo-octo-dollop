// Dev: CPU profile of a level load (navigation -> playing), self time grouped by file and by function.
//   node tools/dbg/loadprof.mjs [lobby|yellow|poolrooms|grasslands] [baseUrl]
import { chromium } from 'playwright-core';
const level = process.argv[2] || 'lobby';
const base = process.argv[3] || 'http://localhost:5174/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
await cdp.send('Profiler.start');
const t0 = Date.now();
await page.goto(base + (level === 'lobby' ? '?auto=solo' : `?auto=solo&level=${level}`));
const marks = [];
let lastLoading = null;
for (let i = 0; i < 1200; i++) {
  const st = await page.evaluate((lv) => ({ ok: !!(window.__game?.world && !window.__game.loading && window.__game.state === 'playing' && window.__game.world.type === lv), loading: !!window.__game?.loading, w: window.__game?.world?.type || null }), level).catch(() => ({ ok: false }));
  const key = `${st.w}:${st.loading}`;
  if (key !== lastLoading) { marks.push([((Date.now() - t0) / 1000).toFixed(1), key]); lastLoading = key; }
  if (st.ok) break;
  await page.waitForTimeout(500);
}
const wall = (Date.now() - t0) / 1000;
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
const byFn = new Map(), byFile = new Map();
let total = 0, idle = 0;
for (const [id, t] of dt) {
  const cf = byId.get(id).callFrame;
  const file = (cf.url.split('/').pop().split('?')[0]) || `(${cf.functionName || 'native'})`;
  if (cf.functionName === '(idle)' || cf.functionName === '(program)') { idle += t; }
  const fk = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
  byFn.set(fk, (byFn.get(fk) || 0) + t);
  byFile.set(file, (byFile.get(file) || 0) + t);
  total += t;
}
const fmt = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${(t / 1e6).toFixed(1).padStart(7)}s ${(100 * t / total).toFixed(1).padStart(5)}%  ${k}`).join('\n');
console.log(`level ${level} wall ${wall.toFixed(0)}s profiled ${(total / 1e6).toFixed(0)}s idle/program ${(idle / 1e6).toFixed(0)}s`);
console.log('marks', JSON.stringify(marks));
console.log('--- by file\n' + fmt(byFile, 22));
console.log('--- by function\n' + fmt(byFn, 30));
await browser.close();
