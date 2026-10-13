// Scripted gameplay smoke test: drives the game through its API and takes screenshots.
// usage: node tools/playtest.mjs <scenario> [url]
import { chromium } from 'playwright-core';
const scenario = process.argv[2] || 'yellow';
const base = process.argv[3] || 'http://localhost:5174/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|404|atlas overflow|parallel_shader/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { logs.push('[eval] ' + e.message); return null; } };
const shot = async (name, wait = 2500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `tools/shots/pt_${name}.png`, timeout: 120000 }); console.log('shot', name); };
const waitLoaded = async () => {
  for (let i = 0; i < 200; i++) {
    const ok = await ev(() => !!(window.__game && window.__game.world && !window.__game.loading && window.__game.state === 'playing'));
    if (ok) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};
const scenarios = {
  async yellow() {
    await page.goto(base + '?auto=solo&level=yellow');
    await waitLoaded();
    await page.waitForTimeout(4000);
    await waitLoaded();
    console.log('state', await ev(() => ({ type: __game.world.type, pos: __game.local.pos.toArray() })));
    // open the starter box
    console.log('box', await ev(() => {
      const g = __game; const box = [...g.world.props.props.values()].find((p) => p.type === 'starter_box');
      if (!box) return 'no box';
      box.custom.hostAction('open');
      return box.id;
    }));
    await page.waitForTimeout(3000);
    // pick up everything nearby
    console.log('pickup', await ev(() => {
      const g = __game; const got = [];
      for (const p of g.world.props.props.values()) {
        if (p.def.pocket && p.root.position.distanceTo(g.local.pos) < 6 && got.length < 5) { __net.toHost('pickup', { id: p.id }); got.push(p.type); }
      }
      return got;
    }));
    await page.waitForTimeout(1500);
    console.log('inv', await ev(() => __game.local.inv.slots.map((s) => s && s.type)));
    await ev(() => { const l = __game.local; l.inv.select(l.inv.find('flashlight')); l.toggleFlashlight(); l.yaw = 2.4; });
    await shot('flashlight');
    await ev(() => { const l = __game.local; l.watchOpen = true; __game.watch.tabIdx = 0; });
    await shot('watch_status', 3000);
    await ev(() => { __game.watch.tabIdx = 3; });
    await shot('watch_map', 2500);
    await ev(() => { __game.local.watchOpen = false; });
    // radio terminal
    console.log('radio', await ev(() => {
      const g = __game; const r = g.world.level.mission.radio();
      if (!r) return 'no radio';
      g.local.teleport(r.root.position.clone().add({ x: 0, y: 0, z: 1.4 }), 0);
      r.custom.interact(g.local);
      return r.root.position.toArray();
    }));
    await shot('radio', 4000);
    await ev(() => __game.terminal.close());
    // monster
    console.log('mon', await ev(() => {
      const g = __game; const mm = g.world.monsters;
      const p = g.local.pos.clone(); p.x += 5;
      const BAC = mm.constructor;
      // spawn via the private class through spawning helper
      mm.spawnT = 0;
      mm._forceSpawn = true;
      return true;
    }));
    await page.waitForTimeout(2000);
  },
  async mission() {
    await page.goto(base + '?auto=solo&level=yellow');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
    // generators: look at one
    console.log('gens', await ev(() => __game.world.level.mission.generators.map((g) => [g.kind, g.root.position.toArray().map((v) => Math.round(v))])));
    await ev(() => { const g = __game; const gen = g.world.level.mission.generators[0]; const p = gen.root.position.clone(); p.z += 3.2; g.local.teleport(p, 0); g.local.pitch = -0.15; });
    await shot('gen0', 6000);
    await ev(() => { const g = __game; const gen = g.world.level.mission.generators[1]; const p = gen.root.position.clone(); p.z += 3.2; g.local.teleport(p, 0); g.local.pitch = -0.15; });
    await shot('gen1', 6000);
    await ev(() => { const g = __game; const gen = g.world.level.mission.generators[2]; const p = gen.root.position.clone(); p.z += 3.2; g.local.teleport(p, 0); g.local.pitch = -0.15; });
    await shot('gen2', 6000);
    // force-run + link all, credits, order a crate
    console.log('force', await ev(() => {
      const g = __game; const m = g.world.level.mission;
      for (const gen of m.generators) { gen.startRunning(); gen.setState({ linked: 1, link: 1 }); }
      g.addCredits(800, 'test');
      const r = m.radio(); g.local.teleport(r.root.position.clone().add(new r.root.position.constructor(0, 0, 2)), 0);
      m.orderCrate('basic');
      return { links: m.linksCount(), credits: g.run.credits };
    }));
    await page.waitForTimeout(16000);
    console.log('crate', await ev(() => [...__game.world.props.props.values()].filter((p) => p.type === 'supply_crate').map((p) => p.root.position.toArray().map((v) => +v.toFixed(2)))));
    await shot('crate', 1000);
    // extraction
    console.log('extract', await ev(() => { const m = __game.world.level.mission; m.requestExtraction(); return m.state.exit; }));
    await page.waitForTimeout(2000);
    await ev(() => { const g = __game; const e = g.world.level.mission.state.exit; g.local.teleport(new g.local.pos.constructor(e.x + Math.sin(e.rot) * 3.5, 0, e.z + Math.cos(e.rot) * 3.5), e.rot); g.local.pitch = 0; });
    await shot('exitdoor', 5000);
    // monsters
    console.log('spawn', await ev(() => {
      const g = __game; const mm = g.world.monsters; const p = g.local.pos.clone();
      const fwd = new p.constructor(-Math.sin(g.local.yaw), 0, -Math.cos(g.local.yaw));
      const a = mm.debugSpawn('bacteria', p.clone().addScaledVector(fwd, 5));
      a.setState('listen'); a.listenT = 30;
      const s = mm.debugSpawn('still', p.clone().addScaledVector(fwd, 3).add(new p.constructor(1.5, 0, 0)), 'watcher');
      return [a.id, s.id];
    }));
    await shot('monsters', 6000);
    // walk into the exit room and let the door close
    await ev(() => { const g = __game; const e = g.world.level.mission.state.exit; g.local.teleport(new g.local.pos.constructor(e.x, 0, e.z), e.rot); e.endsAt = g.day.time + 3; });
    await page.waitForTimeout(15000);
    await waitLoaded();
    console.log('after', await ev(() => ({ type: __game.world.type, depth: __game.run.depth, dead: __game.local.dead, credits: __game.run.credits })));
    await shot('next', 4000);
  },
  async ui() {
    await page.goto(base + '?auto=solo&level=yellow');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
    await ev(() => { const g = __game; const box = [...g.world.props.props.values()].find((p) => p.type === 'starter_box'); box?.custom.hostAction('open'); });
    await page.waitForTimeout(2500);
    await ev(() => { const g = __game; for (const p of g.world.props.props.values()) if (p.def.pocket && p.root.position.distanceTo(g.local.pos) < 6) __net.toHost('pickup', { id: p.id }); });
    await page.waitForTimeout(1500);
    for (const [i, n] of [[0, 'status'], [3, 'map'], [5, 'tasks'], [1, 'camera']]) {
      await ev((i) => { const l = __game.local; l.watchOpen = true; l.watchRaised = 1; __game.watch.tabIdx = i; __engine.post.params.uFade.value = 0; }, i);
      await shot('w_' + n, 3500);
    }
    await ev(() => { __game.local.watchOpen = false; });
    await ev(() => { const g = __game; const r = g.world.level.mission.radio(); g.local.teleport(r.root.position.clone().add(new r.root.position.constructor(0, 0, 1.3)), 0); });
    await page.waitForTimeout(1500);
    await ev(() => { const g = __game; const r = g.world.level.mission.radio(); r.custom.interact(g.local); });
    await shot('radio_term', 5000);
  },
  async lobby() {
    await page.goto(base + '?auto=solo');
    await waitLoaded();
    await page.waitForTimeout(3000);
    const views = [
      ['reception', [0, 0, 12.5], Math.PI, 0.05],
      ['office', [0, 0, 3], 0, 0.0],
      ['break', [17, 0, 2], -Math.PI / 2 - 0.3, 0.0],
      ['breakdarts', [18, 0, 1], Math.PI, 0.1],
      ['lab', [-12, 0, -9], 0.3, 0.1],
      ['dispatch', [13, 0, -10], 0, 0.05],
      ['lockers', [-17, 0, 1], Math.PI / 2, 0.0],
    ];
    for (const [name, p, yaw, pitch] of views) {
      await ev(([p, yaw, pitch]) => { const l = __game.local; l.teleport(new l.pos.constructor(p[0], p[1], p[2]), yaw); l.pitch = pitch; }, [p, yaw, pitch]);
      await shot('lobby_' + name, 3500);
    }
  },
};
await scenarios[scenario]();
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
