// Poolrooms visual + gameplay test driver (headless SwiftShader).
// usage: node tools/poolshots.mjs <scenario> [port=5187] [level=poolrooms]
//   scenarios: tour | mission | perf | stats | water | days | custom:<js file with an async (api) => {} default export>
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const scenario = process.argv[2] || 'tour';
const port = process.argv[3] || '5187';
const level = process.argv[4] || 'poolrooms';
const base = `http://localhost:${port}/`;
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'log' && t.startsWith('[pool]')) console.log(t);
  if (['error', 'warning'].includes(m.type()) && !/favicon|404|atlas overflow|parallel_shader|GPU stall|ReadPixels/.test(t)) logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`));
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { logs.push('[eval] ' + e.message.split('\n')[0]); return null; } };
fs.mkdirSync('tools/shots', { recursive: true });
const shot = async (name, wait = 2500) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `tools/shots/pool_${name}.png`, timeout: 180000 });
  console.log('shot', name);
};
const waitLoaded = async (maxS = 400) => {
  for (let i = 0; i < maxS; i++) {
    const ok = await ev(() => !!(window.__game && window.__game.world && !window.__game.loading && window.__game.state === 'playing' && window.__game.world.type !== 'lobby'));
    if (ok) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};
const clearCut = () => ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
// teleport + look: pos [x,y,z], yaw, pitch
const tp = (p, yaw = 0, pitch = 0) => ev(([p, yaw, pitch]) => {
  const g = __game; const V = g.local.pos.constructor;
  g.local.teleport(new V(p[0], p[1], p[2]), yaw); g.local.pitch = pitch;
}, [p, yaw, pitch]);
const stats = () => ev(() => {
  const g = __game, e = __engine, L = g.world.level;
  return {
    type: g.world.type, depth: g.run.depth, chunks: L.chunks?.size, buildMs: L.buildMs?.toFixed?.(1),
    calls: e.renderer.info.render.calls, tris: e.renderer.info.render.triangles, geos: e.renderer.info.memory.geometries, tex: e.renderer.info.memory.textures,
    props: g.world.props.props.size, pos: g.local.pos.toArray().map((v) => +v.toFixed(2)), grounded: g.local.grounded, water: g.local.waterDepth,
  };
});
const api = { page, ev, shot, waitLoaded, clearCut, tp, stats, logs, base, level };

async function boot(extra = '') {
  await page.goto(base + `?auto=solo&level=${level}${extra}`);
  const ok = await waitLoaded();
  console.log('loaded', ok);
  await page.waitForTimeout(3000);
  await clearCut();
}

const scenarios = {
  async tour() {
    await boot();
    console.log(JSON.stringify(await stats()));
    const pts = await ev(() => __game.world.level.debugViewpoints?.() || []);
    console.log('viewpoints', JSON.stringify(pts));
    let k = 0;
    for (const v of pts.slice(0, +(process.env.N || 8))) {
      await tp(v.p, v.yaw, v.pitch || 0);
      await shot(`tour_${k++}_${v.name}`, +(process.env.WAIT || 5000));
    }
    console.log(JSON.stringify(await stats()));
  },
  async spawn() {
    await boot();
    await shot('spawn', 4000);
    console.log(JSON.stringify(await stats()));
  },
  async perf() {
    await boot();
    await page.waitForTimeout(8000);
    const r = await ev(async () => {
      const times = []; let last = performance.now();
      await new Promise((res) => { const t0 = performance.now(); function f(now) { times.push(now - last); last = now; if (now - t0 < 6000) requestAnimationFrame(f); else res(); } requestAnimationFrame(f); });
      times.sort((a, b) => a - b);
      return { frames: times.length, median: times[times.length >> 1]?.toFixed(1), p90: times[Math.floor(times.length * 0.9)]?.toFixed(1) };
    });
    console.log(JSON.stringify(r), JSON.stringify(await stats()));
    const per = await ev(() => __game.world.level.debugChunkStats?.());
    console.log('chunks', JSON.stringify(per));
  },
  async mission() {
    await boot();
    console.log('gens', JSON.stringify(await ev(() => __game.world.level.mission.generators.map((g) => [g.kind, g.root.position.toArray().map((v) => Math.round(v))]))));
    for (let i = 0; i < 3; i++) {
      await ev((i) => { const g = __game; const gen = g.world.level.mission.generators[i]; const p = gen.root.position.clone(); p.z += 3.2; g.local.teleport(p, 0); g.local.pitch = -0.15; }, i);
      await shot(`gen${i}`, 6000);
    }
    // support items
    console.log('items', JSON.stringify(await ev(() => [...__game.world.props.props.values()].filter((p) => ['fuel_can', 'fuse', 'welder', 'radio', 'starter_box', 'clone_pad'].includes(p.type)).map((p) => [p.type, p.root.position.toArray().map((v) => +v.toFixed(2))]))));
    console.log('force', JSON.stringify(await ev(() => {
      const g = __game; const m = g.world.level.mission;
      for (const gen of m.generators) { gen.startRunning(); gen.setState({ linked: 1, link: 1 }); }
      g.addCredits(800, 'test');
      const r = m.radio(); g.local.teleport(r.root.position.clone().add(new r.root.position.constructor(0, 0, 2)), 0);
      m.orderCrate('basic');
      return { links: m.linksCount(), credits: g.run.credits, pending: m.pendingCrates.map((c) => c.pos.toArray()) };
    })));
    await page.waitForTimeout(17000);
    console.log('crate', JSON.stringify(await ev(() => [...__game.world.props.props.values()].filter((p) => p.type === 'supply_crate').map((p) => p.root.position.toArray().map((v) => +v.toFixed(2))))));
    await shot('crate', 1000);
    console.log('extract', JSON.stringify(await ev(() => { const m = __game.world.level.mission; m.requestExtraction(); return m.state.exit; })));
    await page.waitForTimeout(2000);
    await ev(() => { const g = __game; const e = g.world.level.mission.state.exit; if (!e) return; g.local.teleport(new g.local.pos.constructor(e.x + Math.sin(e.rot) * 3.5, 0, e.z + Math.cos(e.rot) * 3.5), e.rot); g.local.pitch = 0; });
    await shot('exitdoor', 5000);
    console.log('spawn mons', JSON.stringify(await ev(() => {
      const g = __game; const mm = g.world.monsters; const p = g.local.pos.clone();
      const fwd = new p.constructor(-Math.sin(g.local.yaw), 0, -Math.cos(g.local.yaw));
      const a = mm.debugSpawn('bacteria', p.clone().addScaledVector(fwd, 5));
      a.setState('listen'); a.listenT = 30;
      const s = mm.debugSpawn('still', p.clone().addScaledVector(fwd, 3).add(new p.constructor(1.5, 0, 0)), 'watcher');
      return [a.id, s.id];
    })));
    await shot('monsters', 6000);
    await ev(() => { const g = __game; const e = g.world.level.mission.state.exit; if (!e) return; g.local.teleport(new g.local.pos.constructor(e.x, 0, e.z), e.rot); e.endsAt = g.day.time + 3; });
    await page.waitForTimeout(15000);
    await waitLoaded();
    console.log('after', JSON.stringify(await ev(() => ({ type: __game.world.type, depth: __game.run.depth, dead: __game.local.dead, credits: __game.run.credits }))));
    await shot('next', 5000);
  },
};

try {
  if (scenario.startsWith('custom:')) {
    const mod = await import(new URL(scenario.slice(7), `file://${process.cwd()}/`).href);
    await mod.default(api, boot);
  } else await scenarios[scenario]();
} catch (e) {
  console.log('[script error]', e.message);
}
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
