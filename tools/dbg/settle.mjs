// Dev: wake every prop, step the world a few simulated seconds (no rendering) and report props that
// fell through what they stood on, broke, or were flung. Then report visible gaps under resting props.
//   node tools/dbg/settle.mjs [lobby|yellow|poolrooms|grasslands] [baseUrl]
import { chromium } from 'playwright-core';
const level = process.argv[2] || 'lobby';
const base = process.argv[3] || 'http://localhost:5174/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { return 'ERR ' + e.message; } };
await page.goto(base + (level === 'lobby' ? '?auto=solo' : `?auto=solo&level=${level}`));
for (let i = 0; i < 600; i++) { if (await ev((lv) => !!(window.__game?.world && !window.__game.loading && window.__game.state === 'playing' && window.__game.world.type === lv), level) === true) break; await page.waitForTimeout(1000); }
await page.waitForTimeout(2000);
const res = await ev(() => {
  const g = __game, w = g.world, ph = w.physics;
  const breaks = [];
  const bp = w.breakProp.bind(w); w.breakProp = (p) => { breaks.push({ t: p.type, at: p.root.position.toArray().map((v) => +v.toFixed(2)), v: +(p.speed || 0).toFixed(2) }); return bp(p); };
  const step = (n) => { for (let i = 0; i < n; i++) { ph.step(1 / 60); w.props.update(1 / 60); w.time += 1 / 60; } };
  step(30); // let the query pipeline pick up every collider, sleepers stay asleep
  const before = new Map();
  for (const p of w.props.props.values()) if (p.body && !p.frozen) before.set(p.id, p.root.position.clone());
  for (const p of w.props.props.values()) if (p.body && !p.frozen) p.body.wakeUp();
  step(240); // 4 simulated seconds
  const moved = [];
  for (const p of w.props.props.values()) {
    const b0 = before.get(p.id); if (!b0 || p.dead) continue;
    const d = p.root.position.clone().sub(b0);
    if (d.y < -0.12 || Math.hypot(d.x, d.z) > 0.6) moved.push({ t: p.type, id: p.id, dy: +d.y.toFixed(2), dxz: +Math.hypot(d.x, d.z).toFixed(2), y: +p.root.position.y.toFixed(2), at: [p.root.position.x, p.root.position.z].map((v) => +v.toFixed(1)) });
  }
  // gaps under upright resting props
  const gaps = [];
  for (const p of w.props.props.values()) {
    if (!p.body || p.frozen || p.dead) continue;
    const q = p.root.quaternion; if (1 - 2 * (q.x * q.x + q.z * q.z) < 0.995) continue;
    const bottom = p.root.position.y - (p.model.halfHeight ?? 0.2);
    const hit = ph.raycast({ x: p.root.position.x, y: bottom + 0.3, z: p.root.position.z }, { x: 0, y: -1, z: 0 }, 3, undefined, p.body);
    if (!hit) { gaps.push({ t: p.type, gap: 'none' }); continue; }
    const gap = hit.dist - 0.3;
    if (gap > 0.02) gaps.push({ t: p.type, id: p.id, gap: +gap.toFixed(3), on: hit.ud?.kind === 'prop' ? hit.ud.prop.type : hit.ud?.surface || hit.ud?.kind, at: [p.root.position.x, p.root.position.z].map((v) => +v.toFixed(1)) });
  }
  const fell = [...w.props.props.values()].filter((p) => p.body && p.root.position.y < -1 && w.type !== 'poolrooms').map((p) => p.type);
  return { props: w.props.props.size, breaks, moved, gaps, fell };
});
console.log(JSON.stringify(res));
if (errs.length) console.log('errors', errs.slice(0, 5));
await browser.close();
