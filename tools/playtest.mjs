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
  // Full run through every dimension: Yellow -> Poolrooms -> Grasslands -> (hotel not ready) Yellow.
  // Game time is driven with fixed steps (no rendering in between), so headless frame rates don't matter.
  async chain() {
    const sim = async (seconds, pred = null) => {
      for (let t = 0; t < seconds; t += 1) {
        const done = await ev((p) => {
          for (let i = 0; i < 20; i++) __game.update(0.05);
          return p ? !!new Function(`return (${p})`)() : false;
        }, pred);
        if (done) return true;
        await page.waitForTimeout(120);
      }
      return false;
    };
    const waitLevel = async (type) => {
      const t0 = Date.now();
      for (let i = 0; i < 600; i++) {
        const ok = await ev((ty) => !!(__game.world && __game.world.type === ty && !__game.loading && __game.state === 'playing'), type);
        if (ok) return (Date.now() - t0) / 1000;
        await page.waitForTimeout(1000);
      }
      return -1;
    };
    // CHAIN_START=poolrooms|grasslands starts the run in a later dimension
    const order = ['yellow', 'poolrooms', 'grasslands', 'yellow'];
    const start = process.env.CHAIN_START || 'yellow';
    await page.goto(base + '?auto=solo&level=' + start);
    for (const type of order.slice(order.indexOf(start))) {
      const secs = await waitLevel(type);
      await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
      await sim(4);
      console.log('arrived', type, JSON.stringify(await ev(() => ({ depth: __game.run.depth, hp: __game.local.survival.hp, dead: __game.local.dead, props: __game.world.props.props.size, gens: __game.world.level.mission.generators.length }))), 'load', secs, 's');
      await shot(`chain_${type}_${await ev(() => __game.run.depth)}`, 2500);
      if (await ev(() => __game.run.depth) >= 4) break;
      // generators + uplinks, then a supply crate
      console.log('force', JSON.stringify(await ev(() => {
        const g = __game; const m = g.world.level.mission;
        for (const gen of m.generators) { gen.startRunning(); gen.setState({ linked: 1, link: 1 }); }
        g.addCredits(800, 'test');
        const r = m.radio(); g.local.teleport(r.root.position.clone().add(new r.root.position.constructor(0, 0.2, 2)), 0);
        m.orderCrate('basic');
        return { links: m.linksCount(), pending: m.pendingCrates?.length };
      })));
      await sim(20, "[...__game.world.props.props.values()].some((p) => p.type === 'supply_crate' && p.body && p.body.isSleeping())");
      console.log('crate', JSON.stringify(await ev(() => [...__game.world.props.props.values()].filter((p) => p.type === 'supply_crate').map((p) => ({ y: +p.root.position.y.toFixed(2), floor: +(__game.world.level.floorY?.(p.root.position.x, p.root.position.z) ?? 0).toFixed(2) })))));
      // extraction: walk into the exit room and let the door close
      console.log('extract', JSON.stringify(await ev(() => { const m = __game.world.level.mission; m.requestExtraction(); return m.state.exit; })));
      await sim(2);
      await ev(() => {
        const g = __game; const e = g.world.level.mission.state.exit;
        const y = g.world.level.floorY?.(e.x, e.z) ?? 0;
        g.local.teleport(new g.local.pos.constructor(e.x, y + 0.05, e.z), e.rot);
        e.endsAt = g.day.time + 2;
      });
      await sim(4);
      await shot(`chain_exit_${type}`, 500);
      await sim(12, '__game.loading || __game.world?.type !== ' + JSON.stringify(type) + ' || __game.run.depth > ' + (await ev(() => __game.run.depth)));
    }
    console.log('final', JSON.stringify(await ev(() => ({ type: __game.world.type, depth: __game.run.depth, dead: __game.local.dead, credits: __game.run.credits }))));
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
  async input() {
    await page.goto(base + '?auto=solo');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await page.mouse.click(550, 310);
    await page.waitForTimeout(500);
    console.log('menu?', await ev(() => ({ menuOpen: __game.ui.menuOpen, locked: __input.locked, active: document.activeElement?.tagName })));
    await ev(() => __game.ui.hideMenus());
    const p0 = await ev(() => __game.local.pos.toArray());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    console.log('keys', await ev(() => ({ keys: [...__input.keys], vel: __game.local.vel.toArray().map((v) => +v.toFixed(2)), menu: __game.ui.menuOpen, term: !!__game.local.terminal })));
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    const p1 = await ev(() => __game.local.pos.toArray());
    console.log('walk', p0.map((v) => v.toFixed(2)), '->', p1.map((v) => v.toFixed(2)));
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    console.log('jump y', await ev(() => [__game.local.pos.y.toFixed(2), __game.local.grounded]));
    await page.waitForTimeout(1500);
    // face the nearest light prop and grab it with the mouse
    const target = await ev(() => {
      const g = __game, l = g.local; let best = null, bd = 1e9;
      for (const p of g.world.props.props.values()) { const d = p.root.position.distanceTo(l.pos); if (d < bd && d > 1 && p.mass < 15) { bd = d; best = p; } }
      if (!best) return null;
      const dx = best.root.position.x - l.pos.x, dz = best.root.position.z - l.pos.z;
      l.yaw = Math.atan2(-dx, -dz);
      const dy = best.root.position.y - (l.pos.y + 1.16);
      l.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // walk up to it
      const d = Math.hypot(dx, dz);
      if (d > 2) l.teleport(new l.pos.constructor(best.root.position.x + dx / d * -1.6, l.pos.y, best.root.position.z + dz / d * -1.6), l.yaw);
      return { id: best.id, type: best.type, d: bd.toFixed(2) };
    });
    console.log('target', JSON.stringify(target));
    await page.waitForTimeout(500);
    await ev((id) => { const g = __game, l = g.local, p = g.world.props.get(id); const dx = p.root.position.x - l.pos.x, dz = p.root.position.z - l.pos.z; l.yaw = Math.atan2(-dx, -dz); l.pitch = Math.atan2(p.root.position.y - (l.pos.y + 1.16), Math.hypot(dx, dz)); }, target.id);
    await page.waitForTimeout(400);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    console.log('grabbing', await ev(() => ({ grab: __game.local.grab?.id, focus: __game.local.focus?.prompt })));
    await shot('grab', 300);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(100);
    await page.mouse.up({ button: 'right' });
    await page.mouse.up();
    await page.waitForTimeout(2000);
    console.log('after throw', await ev((id) => { const p = __game.world.props.get(id); return p ? p.root.position.toArray().map((v) => +v.toFixed(2)) : 'gone'; }, target.id), 'thrown', await ev(() => __game.local.stats.thrown));
    await page.keyboard.press('Tab');
    await page.waitForTimeout(2500);
    await shot('tabwatch', 300);
  },
  async lobby2() {
    await page.goto(base + '?auto=solo');
    await waitLoaded();
    await page.waitForTimeout(3000);
    const tp = (p, yaw, pitch = 0) => ev(([p, yaw, pitch]) => { const l = __game.local; l.teleport(new l.pos.constructor(p[0], p[1], p[2]), yaw); l.pitch = pitch; }, [p, yaw, pitch]);
    // reception + receptionist
    await tp([0, 0, 13.2], 0, -0.05);
    await shot('l2_reception', 4000);
    // locker customizer
    await tp([-20.4, 0, 0.5], Math.PI / 2, 0);
    await page.waitForTimeout(800);
    console.log('locker', await ev(() => { const d = __game.world.devices.get('lockers'); d.interact(__game.local, 'use', null); return !!__game.ui.customizing; }));
    await shot('l2_custom', 5000);
    await ev(() => { __game.local.setCosmetics({ suit: 'hawaiian', hat: 'bucket', accessory: 'fannypack' }); __game.ui._renderCustom(); });
    await shot('l2_custom2', 4000);
    await ev(() => __game.ui.closeCustomizer());
    // mirror
    await tp([-17, 0, -3.6], 0, 0);
    await ev(() => { __game.local.thirdPerson = false; });
    await shot('l2_mirror', 4000);
    // vending terminal
    await tp([15.2, 0, -4.1], 0, -0.1);
    await page.waitForTimeout(800);
    await ev(() => { const d = __game.world.devices.get('vend_snack'); d.interact(__game.local); });
    await shot('l2_vending', 4000);
    await ev(() => __game.terminal.close());
    // dispatch
    await tp([13, 0, -13], 0, 0.1);
    await ev(() => __game.world.devices.get('dispatch_lever').hostAction('pull'));
    await shot('l2_dispatch', 6000);
    await page.waitForTimeout(25000);
    await waitLoaded();
    console.log('after dispatch', await ev(() => ({ type: __game.world.type, depth: __game.run.depth })));
  },
  async bacteria() {
    await page.goto(base + '?auto=solo&level=yellow');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
    // find a long straight view: try a few yaws and pick the one with the farthest wall
    const info = await ev(() => {
      const g = __game, l = g.local, ph = g.world.physics;
      let best = 0, by = 0;
      for (let k = 0; k < 16; k++) {
        const yaw = k * Math.PI / 8;
        const d = new l.pos.constructor(-Math.sin(yaw), 0, -Math.cos(yaw));
        const hit = ph.raycast(l.pos.clone().setY(1.2), d, 40, undefined, null, (c) => c !== l.collider);
        const dist = hit ? hit.dist : 40;
        if (dist > best) { best = dist; by = yaw; }
      }
      l.yaw = by; l.pitch = 0.02;
      const mm = g.world.monsters;
      const fwd = new l.pos.constructor(-Math.sin(by), 0, -Math.cos(by));
      const a = mm.debugSpawn('bacteria', l.pos.clone().addScaledVector(fwd, Math.min(best - 1, 9)));
      a.setState('listen'); a.listenT = 60;
      return { best, yaw: by };
    });
    console.log('view', JSON.stringify(info));
    await shot('bac_idle', 6000);
    await ev(() => { const g = __game; const a = [...g.world.monsters.agents.values()][0]; a.target = g.world.monsters.alivePlayers()[0]; a.lastKnown = g.local.pos.clone(); a.setState('chase'); });
    await shot('bac_chase', 2500);
    await ev(() => { __game.local.flashOn = true; const i = __game.local.inv; });
    await shot('bac_chase2', 2500);
  },
  async stilllife() {
    // Still Lifes in real level lighting: each variant spawned in a row in front of the player.
    // env SL=watcher,tall (subset)  SLD=3 (distance)  FLASH=1 (flashlight on)
    await page.goto(base + '?auto=solo&level=yellow');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
    const vars = (process.env.SL || 'watcher,crawler,twin,mass,tall').split(',');
    const info = await ev(([vars, dist, flash]) => {
      const g = __game, l = g.local, ph = g.world.physics;
      let best = 0, by = 0;
      for (let k = 0; k < 16; k++) {
        const yaw = k * Math.PI / 8;
        const d = new l.pos.constructor(-Math.sin(yaw), 0, -Math.cos(yaw));
        const hit = ph.raycast(l.pos.clone().setY(1.2), d, 40, undefined, null, (c) => c !== l.collider);
        const dist2 = hit ? hit.dist : 40;
        if (dist2 > best) { best = dist2; by = yaw; }
      }
      l.yaw = by; l.pitch = -0.08;
      const mm = g.world.monsters;
      const fwd = new l.pos.constructor(-Math.sin(by), 0, -Math.cos(by));
      const side = new l.pos.constructor(Math.cos(by), 0, -Math.sin(by));
      const out = [];
      vars.forEach((v, i) => {
        const p = l.pos.clone().addScaledVector(fwd, Math.min(best - 1.2, dist + (v === 'tall' ? 1 : 0))).addScaledVector(side, (i - (vars.length - 1) / 2) * 1.25);
        const a = mm.debugSpawn('still', p, v);
        a.update = function (dt) { this.look = l.pos.clone().setY(1.0); this.yaw = Math.atan2(-(l.pos.x - this.pos.x), -(l.pos.z - this.pos.z)); this.frozen = false; this.integrate(dt); };
        out.push(a.id);
      });
      if (flash) { l.flashOn = true; }
      return { best, yaw: by, ids: out };
    }, [vars, +(process.env.SLD || 3), !!process.env.FLASH]);
    console.log('view', JSON.stringify(info));
    await shot('sl_' + (process.env.SLN || 'row'), 7000);
    console.log('stats', await ev(() => JSON.stringify(window.__slStats || null)));
  },
  async days() {
    await page.goto(base + '?auto=solo&level=yellow&daylen=60');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; __game.local.yaw = 0.4; });
    for (const d of [3, 5, 7]) {
      await ev((d) => { __game.day.time = (d - 1) * 60 - 0.5; }, d);
      await page.waitForTimeout(6000);
      console.log('day', await ev(() => ({ day: __game.day.day, inst: +__game.day.instability().toFixed(2), col: +__game.day.collapse().toFixed(2), dead: [...__game.world.field.lights.values()].filter((l) => l.mode === 'dead').length, flick: [...__game.world.field.lights.values()].filter((l) => l.mode === 'flicker').length })));
      await shot('day' + d, 500);
    }
    await ev(() => { __game.day.time = 7 * 60 - 1; });
    await page.waitForTimeout(20000);
    console.log('collapse', await ev(() => ({ dead: __game.local.dead, type: __game.world?.type, ro: document.querySelector('#runover')?.classList.contains('show') })));
    await shot('collapse', 500);
  },
  async loop() {
    // full failure loop: reality collapses -> run over -> back in the lobby with a controllable, living clone
    await page.goto(base + '?auto=solo&level=yellow&daylen=30');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __game.day.time = 7 * 30 - 1; });
    await page.waitForTimeout(8000);
    console.log('collapsed', await ev(() => ({ dead: __game.local.dead, ro: document.querySelector('#runover')?.classList.contains('show'), menu: __game.ui.menuOpen })));
    for (let i = 0; i < 60; i++) {
      if (await ev(() => __game.world?.type === 'lobby' && !__game.loading)) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(4000);
    console.log('lobby', await ev(() => ({ type: __game.world.type, dead: __game.local.dead, ro: document.querySelector('#runover')?.classList.contains('show'), menu: __game.ui.menuOpen, hp: Math.round(__game.local.survival.health), depth: __game.run.depth })));
    const p0 = await ev(() => __game.local.pos.toArray());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2000);
    await page.keyboard.up('KeyW');
    const p1 = await ev(() => __game.local.pos.toArray());
    console.log('moved', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2));
    await shot('loop_lobby', 500);
  },
  async gens() {
    // drive each generator through its repair steps via the same host actions/input paths players use
    await page.goto(base + '?auto=solo&level=yellow');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
    const genAt = (kind) => ev((kind) => { const g = __game, gen = g.world.level.mission.generators.find((x) => x.kind === kind); const f = new g.local.pos.constructor(0, 0, 1).applyQuaternion(gen.root.quaternion); g.local.teleport(gen.root.position.clone().addScaledVector(f, 1.8), Math.atan2(f.x, f.z)); return gen.root.position.toArray().map(Math.round); }, kind);
    const state = (kind) => ev((kind) => { const gen = __game.world.level.mission.generators.find((x) => x.kind === kind); return JSON.parse(JSON.stringify(gen.state)); }, kind);
    // ---- DIESEL: carry the fuel can to the filler cap, then pull the cord in the green
    console.log('diesel at', await genAt('diesel'));
    await page.waitForTimeout(6000);
    const can = await ev(() => { const g = __game; const gen = g.world.level.mission.generators.find((x) => x.kind === 'diesel'); const cans = [...g.world.props.props.values()].filter((p) => p.type === 'fuel_can'); if (!cans.length) return null; const cap = gen.anchorWorld('fuelCap'); const c = cans.sort((a, b) => a.root.position.distanceTo(cap) - b.root.position.distanceTo(cap))[0]; const d0 = c.root.position.distanceTo(cap); g.world.props.teleport(c, cap.clone().add(new cap.constructor(0, 0.35, 0.25))); return { id: c.id, d0: +d0.toFixed(1) }; });
    console.log('fuel can', JSON.stringify(can));
    for (let i = 0; i < 40 && can; i++) {
      await ev((id) => { const g = __game; const gen = g.world.level.mission.generators.find((x) => x.kind === 'diesel'); const cap = gen.anchorWorld('fuelCap'); __net.toHost('grab', { id, lp: [0, 0, 0], tp: cap.add(new cap.constructor(0, 0.3, 0.15)).toArray() }); }, can.id);
      await page.waitForTimeout(400);
      if ((await state('diesel')).fuel >= 1) break;
    }
    await ev((id) => __net.toHost('grab', { release: true, id }), can?.id);
    console.log('diesel fuel', (await state('diesel')).fuel);
    for (let i = 0; i < 30 && !(await state('diesel')).running; i++) await ev(() => __game.world.level.mission.generators.find((x) => x.kind === 'diesel').hostAction('pull', { q: 0.53 }));
    console.log('diesel', JSON.stringify(await state('diesel')));
    // ---- ELECTRIC: panel door, four wires to their colour sockets, fuse from the fuse office, breaker
    console.log('electric at', await genAt('electric'));
    await page.waitForTimeout(6000);
    await ev(() => { const gen = __game.world.level.mission.generators.find((x) => x.kind === 'electric'); gen.interact(__game.local); });
    await page.waitForTimeout(500);
    console.log('wrong wire hp', await ev(() => { const gen = __game.world.level.mission.generators.find((x) => x.kind === 'electric'); const s = gen.state.order.findIndex((w) => w !== 0); gen.send('wire', { w: 0, s }); return Math.round(__game.local.survival.health); }));
    await ev(() => { const gen = __game.world.level.mission.generators.find((x) => x.kind === 'electric'); for (let w = 0; w < 4; w++) gen.send('wire', { w, s: gen.state.order.indexOf(w) }); });
    await page.waitForTimeout(800);
    const fuse = await ev(() => { const g = __game; const f = [...g.world.props.props.values()].find((p) => p.type === 'fuse'); if (!f) return null; const d = f.root.position.distanceTo(g.local.pos); __net.toHost('pickup', { id: f.id }); return { id: f.id, d: +d.toFixed(1) }; });
    await page.waitForTimeout(1500);
    console.log('fuse', JSON.stringify(fuse), 'inv', JSON.stringify(await ev(() => __game.local.inv.slots.map((s) => s && s.type))));
    await ev(() => { const l = __game.local; const i = l.inv.find('fuse'); if (i >= 0) l.inv.select(i); const gen = __game.world.level.mission.generators.find((x) => x.kind === 'electric'); gen.interact(l); });
    await page.waitForTimeout(800);
    await ev(() => { const gen = __game.world.level.mission.generators.find((x) => x.kind === 'electric'); gen.interact(__game.local); });
    await page.waitForTimeout(800);
    console.log('electric', JSON.stringify(await state('electric')));
    // ---- MECH: weld the three cracks (welder ticks routed through the mission), tighten bolts, crank
    console.log('mech at', await genAt('mech'));
    await page.waitForTimeout(6000);
    await ev(() => { const g = __game, gen = g.world.level.mission.generators.find((x) => x.kind === 'mech'); const n = (gen.model.anchors.cracks || []).length; for (let i = 0; i < n; i++) { const p = gen.anchorWorld('cracks', i); for (let k = 0; k < 20; k++) __net.toHost('weldTick', { id: null, p: p.toArray(), n: [0, 0, 1] }); } });
    await page.waitForTimeout(800);
    await ev(() => { const gen = __game.world.level.mission.generators.find((x) => x.kind === 'mech'); for (let i = 0; i < 4; i++) for (let k = 0; k < 5; k++) gen.send('bolt', { i }); });
    await page.waitForTimeout(800);
    await ev(() => { const gen = __game.world.level.mission.generators.find((x) => x.kind === 'mech'); for (let k = 0; k < 60; k++) gen.send('crank'); });
    await page.waitForTimeout(1500);
    console.log('mech', JSON.stringify(await state('mech')));
    // ---- uplinks: carry the radio next to each running generator
    for (const kind of ['diesel', 'electric', 'mech']) {
      await ev((kind) => { const g = __game, m = g.world.level.mission, gen = m.generators.find((x) => x.kind === kind), r = m.radio(); const f = new g.local.pos.constructor(0, 0, 1).applyQuaternion(gen.root.quaternion); g.world.props.teleport(r, gen.root.position.clone().addScaledVector(f, 1.6).setY(0.4)); g.local.teleport(gen.root.position.clone().addScaledVector(f, 2.6), Math.atan2(f.x, f.z)); }, kind);
      for (let i = 0; i < 40 && !(await state(kind)).linked; i++) await page.waitForTimeout(1000);
      console.log('link', kind, (await state(kind)).linked);
    }
    console.log('links', await ev(() => __game.world.level.mission.linksCount()), 'credits', await ev(() => __game.run.credits));
    await shot('gens_done', 1000);
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
