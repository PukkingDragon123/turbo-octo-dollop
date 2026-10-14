// Dev: shader programs created after the loading screen drops, split by where they were created: inside a
// frame render (an in-game hitch on real GPUs) or inside a background compileAsync. Teleports around so new
// chunks stream in.   node tools/dbg/latecompile.mjs [lobby|yellow|poolrooms|grasslands]
import { chromium } from 'playwright-core';
const level = process.argv[2] || 'yellow';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { return 'ERR ' + e.message; } };
await page.goto('http://localhost:5174/' + (level === 'lobby' ? '?auto=solo' : `?auto=solo&level=${level}`));
for (let i = 0; i < 3000; i++) { if (await ev((lv) => !!(window.__game?.world && !window.__game.loading && window.__game.state === 'playing' && window.__game.world.type === lv), level) === true) break; await page.waitForTimeout(200); }
const atLoad = await ev(() => {
  const r = __engine.renderer; const known = new Set(r.info.programs.map((p) => p.id)); window.__late = { render: [], compile: 0 };
  const scan = (into) => { for (const p of r.info.programs) if (!known.has(p.id)) { known.add(p.id); if (into) into.push(p.name || '?'); else window.__late.compile++; } };
  const rr = r.render.bind(r); r.render = (s, c) => { rr(s, c); scan(window.__late.render); };
  const rc = r.compile.bind(r); r.compile = (s, c, t) => { const m = rc(s, c, t); scan(null); return m; };
  return r.info.programs.length;
});
const out = [];
for (const [dx, dz] of [[0, 0], [24, 0], [24, 24], [-24, 30], [-30, -20]]) {
  await ev(([dx, dz]) => { const l = __game.local; if (dx || dz) l.teleport(l.pos.clone().add({ x: dx, y: 0, z: dz }), 0); }, [dx, dz]);
  await page.waitForTimeout(9000);
  out.push(await ev(() => ({ props: __game.world.props.props.size, inRender: window.__late.render.length, inCompile: window.__late.compile })));
}
console.log(level, 'programs at load', atLoad, JSON.stringify(out), 'render-time:', JSON.stringify(await ev(() => window.__late.render)));
await browser.close();
