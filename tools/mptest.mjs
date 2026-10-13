// Two-browser multiplayer smoke test using a local PeerJS server (npx peerjs --port 9000)
import { chromium } from 'playwright-core';
const base = 'http://localhost:5174/?peerhost=127.0.0.1&peerport=9000&q=low';
const launch = () => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const b1 = await launch(), b2 = await launch();
const host = await b1.newPage({ viewport: { width: 800, height: 450 } });
const cli = await b2.newPage({ viewport: { width: 800, height: 450 } });
const logs = { host: [], cli: [] };
for (const [n, p] of [['host', host], ['cli', cli]]) {
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|404|atlas|parallel/.test(m.text())) logs[n].push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => logs[n].push('[pageerror] ' + e.message));
}
const ready = async (p) => { for (let i = 0; i < 200; i++) { if (await p.evaluate(() => !!(window.__game && window.__game.world && !window.__game.loading))) return; await p.waitForTimeout(1000); } };
await host.goto(base); await cli.goto(base);
await ready(host); await ready(cli);
const code = await host.evaluate(async () => { const c = await __game.startHost(); __game.ui.hideMenus(); return c; });
console.log('code', code);
await ready(host);
await cli.evaluate(async (c) => { await __game.join(c); }, code);
await cli.waitForTimeout(8000);
await ready(cli);
await cli.waitForTimeout(8000);
const st = async (p) => p.evaluate(() => ({ mode: __net.mode, id: __net.selfId.slice(-6), roster: [...__game.roster.values()].map((r) => r.name), remotes: [...__game.remotes.values()].map((r) => [r.name, r.pos.toArray().map((v) => +v.toFixed(1)), r.inWorld]), world: __game.world?.type, props: __game.world?.props.props.size, pos: __game.local.pos.toArray().map((v) => +v.toFixed(1)) }));
console.log('host', JSON.stringify(await st(host)));
console.log('cli ', JSON.stringify(await st(cli)));
// proximity voice: both sides should have a call with a live remote stream (fake mic = test tone)
const vs = (p) => p.evaluate(() => { const v = __game.voice; return { mic: !!v.stream, calls: [...v.calls.values()].map((c) => ({ stream: !!c.spatial, open: c.call.open })), level: +v.level.toFixed(2), remoteLevel: Math.max(0, ...[...__game.remotes.values()].map((r) => +(r.voiceLevel || 0).toFixed(2))) }; });
console.log('voice host', JSON.stringify(await vs(host)), 'cli', JSON.stringify(await vs(cli)));
// client grabs & throws a prop near it, host checks it moved
const r = await cli.evaluate(() => {
  const g = __game; let best = null, bd = 1e9;
  for (const p of g.world.props.props.values()) { const d = p.root.position.distanceTo(g.local.pos); if (d < bd && p.mass < 20) { bd = d; best = p; } }
  if (!best) return null;
  __net.toHost('grab', { id: best.id, lp: [0, 0, 0], tp: [best.root.position.x, best.root.position.y + 1.5, best.root.position.z] });
  return { id: best.id, type: best.type, y: best.root.position.y };
});
console.log('grab', JSON.stringify(r));
await cli.waitForTimeout(3000);
if (r) {
  console.log('host sees', await host.evaluate((id) => __game.world.props.get(id)?.root.position.y, r.id), 'client sees', await cli.evaluate((id) => __game.world.props.get(id)?.root.position.y, r.id));
}
// host dispatches into the Backrooms; both should load
await host.evaluate(() => __game.hostDispatch([]));
await host.waitForTimeout(20000);
await ready(host); await ready(cli);
await cli.waitForTimeout(10000);
console.log('host', JSON.stringify(await st(host)));
console.log('cli ', JSON.stringify(await st(cli)));
await host.screenshot({ path: 'tools/shots/mp_host.png', timeout: 120000 });
await cli.screenshot({ path: 'tools/shots/mp_cli.png', timeout: 120000 });
console.log('HOST LOGS', logs.host.slice(0, 15).join('\n'));
console.log('CLI LOGS', logs.cli.slice(0, 15).join('\n'));
await b1.close(); await b2.close();
