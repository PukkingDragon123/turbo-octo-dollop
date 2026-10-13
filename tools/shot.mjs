// Headless screenshot helper.
// usage: node tools/shot.mjs <url> <out.png> [waitMs=6000] [w=1280] [h=720] [evalJS]
import { chromium } from 'playwright-core';
const [url, out, waitMs = '6000', w = '1280', h = '720', evalJs] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+waitMs);
if (evalJs) {
  try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[evalerror] ' + e.message); }
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
console.log(logs.slice(-60).join('\n'));
await browser.close();
