// CPU profile via CDP: prints top self-time functions
import { chromium } from 'playwright-core';
const [url, waitMs = '30000', profMs = '10000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(url);
await page.waitForTimeout(+waitMs);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
await cdp.send('Profiler.start');
await page.waitForTimeout(+profMs);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = {};
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  dt[id] = (dt[id] || 0) + (profile.timeDeltas[i] || 0);
}
let total = 0;
for (const [id, t] of Object.entries(dt)) {
  const n = byId.get(+id);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + t);
  total += t;
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, t] of top) console.log((t / 1000).toFixed(0).padStart(7) + 'ms ' + (100 * t / total).toFixed(1).padStart(5) + '%  ' + k);
await browser.close();
