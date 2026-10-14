// Grasslands test driver: loads ?auto=solo&level=grasslands on a private test server, clears the arrival
// cutscene, teleports around for screenshots and drives the mission end to end.
// usage: node tools/grassshots.mjs <scenario> [port=5188] [w=960] [h=540] [extra query]
import { chromium } from 'playwright-core';
import fs from 'fs';

const scenario = process.argv[2] || 'views';
const port = process.argv[3] || '5188';
const W = +(process.argv[4] || 960), H = +(process.argv[5] || 540);
const extra = process.argv[6] || '';
const base = `http://localhost:${port}/`;
const outDir = 'tools/shots/grass';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/favicon|404|atlas overflow|parallel_shader|GPU stall|ReadPixels/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { logs.push('[eval] ' + e.message); return null; } };
// rendering can be paused while the simulation runs (headless software GL renders a frame every few seconds)
const setRender = (on) => ev((on) => { if (!window.__realRender) window.__realRender = __engine.render; __engine.render = on ? window.__realRender : () => {}; }, on);
const frames = (n) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r(k) : requestAnimationFrame(f)); requestAnimationFrame(f); setTimeout(() => r(-1), 240000); }), n);
const shot = async (name, wait = 2500) => {
  // let streaming settle without drawing, then draw a few frames for the picture
  await setRender(false); await page.waitForTimeout(wait); await setRender(true); await frames(3);
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 }); console.log('shot', name);
};
const waitLoaded = async (type = 'grasslands') => {
  for (let i = 0; i < (type === '__any__' ? 5 : 400); i++) {
    const ok = await ev((t) => !!(window.__game && window.__game.world && (t === '__any__' || window.__game.world.type === t) && !window.__game.loading && window.__game.state === 'playing'), type);
    if (ok) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};
const clearCut = () => ev(() => { __game.cutscene = null; __engine.post.params.uFade.value = 0; __engine.post.params.uGlitch.value = 0; });
// place the camera: position (feet), yaw, pitch
const tp = (p, yaw, pitch = 0) => ev(([p, yaw, pitch]) => {
  const l = __game.local; const lvl = __game.world.level;
  const y = p[1] ?? lvl.groundAt(p[0], p[2]);
  l.teleport(new l.pos.constructor(p[0], y, p[2]), yaw); l.pitch = pitch;
}, [p, yaw, pitch]);
const hookInfo = () => ev(() => {
  if (window.__infoHooked) return;
  window.__infoHooked = true;
  const info = __engine.renderer.info; info.autoReset = false;
  const orig = __engine.render.bind(__engine);
  __engine.render = (dt) => { info.reset(); orig(dt); window.__lastInfo = { calls: info.render.calls, tris: info.render.triangles }; };
});
const stats = () => ev(() => {
  const r = { render: window.__lastInfo || {}, memory: __engine.renderer.info.memory };
  const lvl = __game.world.level;
  return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, pos: __game.local.pos.toArray().map((v) => +v.toFixed(2)), light: +__game.local.lightLevel.toFixed(2), chunks: lvl.chunks.size, tiles: lvl.terrain?.active.size, buildMs: +(lvl.buildMs || 0).toFixed(1), tileMs: +(lvl.terrain?.buildMs || 0).toFixed(1) };
});

// rough GPU texture memory of everything the scene references (incl. mips), grouped by material name
const texMem = () => ev(() => {
  const seen = new Set(); let bytes = 0; const by = {};
  const add = (t, owner) => {
    if (!t || seen.has(t)) return; seen.add(t);
    const img = t.image || {}; const w = img.width || t.width || 0, h = img.height || t.height || 0, d = img.depth || 1;
    if (!w || !h) return;
    const bpp = t.type === 1016 /* HalfFloat */ ? 8 : t.type === 1015 ? 16 : 4;
    const b = w * h * d * bpp * (t.generateMipmaps !== false && t.minFilter !== 1006 ? 1.33 : 1);
    bytes += b; by[owner] = (by[owner] || 0) + b;
  };
  __engine.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      const owner = (m.name || m.type || '?').replace(/[0-9_]+$/, '').slice(0, 28);
      for (const k in m) { const v = m[k]; if (v && v.isTexture) add(v, owner); }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v && v.isTexture) add(v, owner + ':' + k); }
    }
  });
  add(__engine.scene.environment, 'environment');
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => k + ' ' + (v / 1e6).toFixed(1));
  return { MB: +(bytes / 1e6).toFixed(1), n: seen.size, top };
});

const scenarios = {
  async mission() {
    await page.goto(base + '?auto=solo&level=grasslands' + extra);
    console.log('loaded', await waitLoaded());
    await page.waitForTimeout(2000);
    await clearCut();
    await hookInfo();
    // wait for the landing
    if (process.env.FAST) await ev(() => { const l = __game.local; const lvl = __game.world.level; const p = l.pos.clone(); p.y = lvl.groundAt(p.x, p.z) + 3; l.teleport(p, l.yaw); });
    for (let i = 0; i < 420; i++) {
      const g = await ev(() => __game.local.grounded && __game.local.pos.y < 5); if (g) break;
      if (i % 30 === 0) console.log('falling', await ev(() => +__game.local.pos.y.toFixed(1)));
      await page.waitForTimeout(1000);
    }
    console.log('landed', await ev(() => ({ pos: __game.local.pos.toArray().map((v) => +v.toFixed(2)), hp: Math.round(__game.local.survival.health), fracture: __game.local.survival.fracture })));
    console.log('props', await ev(() => [...__game.world.props.props.values()].map((p) => p.type + '@' + p.root.position.toArray().map((v) => v.toFixed(1)).join(',')).slice(0, 12)));
    const gens = await ev(() => __game.world.level.mission.generators.map((g) => ({ id: g.id, p: g.root.position.toArray().map((v) => +v.toFixed(1)) })));
    console.log('gens', JSON.stringify(gens));
    for (let i = 0; i < gens.length; i++) {
      await ev((i) => { const g = __game; const gen = g.world.level.mission.generators[i]; const p = gen.root.position.clone(); p.z += 3.4; g.local.teleport(p, 0); g.local.pitch = -0.12; }, i);
      await shot('m_gen' + i, 5000);
    }
    // support items reachable? find fuel can & fuse and path to them from the spawn
    console.log('support', await ev(() => {
      const g = __game, lvl = g.world.level; const out = {};
      for (const p of g.world.props.props.values()) if (p.type === 'fuel_can' || p.type === 'fuse') out[p.type] = p.root.position.toArray().map((v) => +v.toFixed(1));
      for (const [k, v] of Object.entries(out)) { const path = lvl.nav.findPath(12, 12, v[0], v[2], 6000); out[k + '_path'] = path ? path.length : null; const last = path?.[path.length - 1]; out[k + '_reach'] = last ? Math.hypot(last[0] - v[0], last[1] - v[2]).toFixed(1) : null; }
      for (const gen of lvl.mission.generators) { const p = gen.root.position; const path = lvl.nav.findPath(12, 12, p.x, p.z + 2.5, 6000); const last = path?.[path.length - 1]; out[gen.id] = last ? Math.hypot(last[0] - p.x, last[1] - (p.z + 2.5)).toFixed(1) : 'none'; }
      return out;
    }));
    // force-run + link all, credits, order a crate
    console.log('force', await ev(() => {
      const g = __game; const m = g.world.level.mission;
      for (const gen of m.generators) { gen.startRunning(); gen.setState({ linked: 1, link: 1 }); }
      g.addCredits(800, 'test');
      const r = m.radio(); g.local.teleport(r.root.position.clone().add(new r.root.position.constructor(0, 0, 2.5)), 0);
      m.orderCrate('basic');
      for (const c of m.pendingCrates) c.t = Math.min(c.t, 0.3);
      return { links: m.linksCount(), credits: g.run.credits, pending: m.pendingCrates.length };
    }));
    await setRender(false);
    await page.waitForTimeout(4000);
    for (let i = 0; i < 150; i++) { const c = await ev(() => [...__game.world.props.props.values()].filter((p) => p.type === 'supply_crate').map((p) => p.root.position.y)); if (c && c.length && c[0] < 45) break; if (i % 30 === 0) console.log('crate y', c); await page.waitForTimeout(1000); }
    await ev(() => { const g = __game; const c = [...g.world.props.props.values()].find((p) => p.type === 'supply_crate'); if (c) { const p = c.root.position; g.local.teleport(new p.constructor(p.x + 6, null ?? g.world.level.groundAt(p.x + 6, p.z + 6), p.z + 6), Math.atan2(6, 6)); g.local.pitch = 0.25; } });
    await shot('m_crate_fall', 1500);
    await ev(() => { const g = __game; const c = [...g.world.props.props.values()].find((p) => p.type === 'supply_crate'); if (c) { const p = c.root.position; const gy = g.world.level.groundAt(p.x, p.z); if (p.y > gy + 4) g.world.props.teleport(c, new p.constructor(p.x, gy + 4, p.z), c.root.quaternion, new p.constructor(0, -2, 0)); } });
    await setRender(false);
    for (let i = 0; i < 150; i++) { const st = await ev(() => { const c = [...__game.world.props.props.values()].find((p) => p.type === 'supply_crate'); return c ? c.state.chute : -1; }); if (st === 2 || st === -1) break; await page.waitForTimeout(1000); }
    console.log('crate', await ev(() => [...__game.world.props.props.values()].filter((p) => p.type === 'supply_crate').map((p) => ({ p: p.root.position.toArray().map((v) => +v.toFixed(2)), g: +__game.world.level.groundAt(p.root.position.x, p.root.position.z).toFixed(2), chute: p.state.chute }))));
    await shot('m_crate', 2000);
    // extraction
    console.log('extract', await ev(() => { const m = __game.world.level.mission; m.requestExtraction(); return m.state.exit; }));
    await page.waitForTimeout(2500);
    console.log('exitdev', await ev(() => { const d = __game.world.level.mission.exitDevice; return d ? { y: +d.root.position.y.toFixed(2), fixed: !!d._grassFixed } : null; }));
    await ev(() => { const g = __game; const e = g.world.level.mission.state.exit; const x = e.x + Math.sin(e.rot) * 4.5, z = e.z + Math.cos(e.rot) * 4.5; g.local.teleport(new g.local.pos.constructor(x, g.world.level.groundAt(x, z), z), e.rot); g.local.pitch = 0; });
    await shot('m_exitdoor', 4000);
    // monsters
    console.log('spawn', await ev(() => {
      const g = __game; const mm = g.world.monsters; const p = g.local.pos.clone();
      const fwd = new p.constructor(-Math.sin(g.local.yaw), 0, -Math.cos(g.local.yaw));
      const a = mm.debugSpawn('bacteria', p.clone().addScaledVector(fwd, 6));
      a.setState('listen'); a.listenT = 30;
      const s = mm.debugSpawn('still', p.clone().addScaledVector(fwd, 3.5).add(new p.constructor(1.5, 0, 0)), 'watcher');
      return [a.id, s.id];
    }));
    await page.waitForTimeout(3000);
    console.log('monsters', await ev(() => [...__game.world.monsters.agents.values()].map((a) => ({ t: a.type, p: a.pos.toArray().map((v) => +v.toFixed(2)), g: +__game.world.level.groundAt(a.pos.x, a.pos.z).toFixed(2) }))));
    await shot('m_monsters', 3000);
    // path a bacteria across the valley: does it get stuck?
    console.log('chase', await ev(async () => {
      const g = __game; const mm = g.world.monsters; const lvl = g.world.level;
      const a = [...mm.agents.values()].find((x) => x.type === 'bacteria');
      const target = g.local.pos.clone().add(new g.local.pos.constructor(18, 0, 14));
      a.setState('investigate'); a.goal = target.clone();
      const start = a.pos.clone();
      const rr = __engine.render; __engine.render = () => {};
      await new Promise((r) => setTimeout(r, 20000));
      __engine.render = rr;
      return { from: start.toArray().map((v) => +v.toFixed(1)), to: a.pos.toArray().map((v) => +v.toFixed(1)), goal: target.toArray().map((v) => +v.toFixed(1)), stuck: +a.stuckT.toFixed(2), state: a.state };
    }));
    // walk into the exit room and let the door close
    const depth0 = await ev(() => __game.run.depth);
    await ev(() => { const g = __game; const e = g.world.level.mission.state.exit; for (const a of g.world.monsters.agents.values()) a.dispose(); g.world.monsters.agents.clear(); g.local.teleport(new g.local.pos.constructor(e.x, g.world.level.mission.exitDevice.root.position.y + 0.05, e.z), e.rot); e.endsAt = g.day.time + 0.6; });
    await setRender(false);
    for (let i = 0; i < 300; i++) { const d = await ev(() => __game.run.depth); if (d > depth0) { console.log('evacuated', { depth0, depth: d, loading: await ev(() => !!__game.loading) }); break; } await page.waitForTimeout(2000); }
    for (let i = 0; i < 600; i++) { const t = await ev(() => __game.world?.type !== 'grasslands' && !__game.loading); if (t) break; await page.waitForTimeout(2000); }
    await setRender(true);
    console.log('after', await ev(() => ({ type: __game.world.type, depth: __game.run.depth, dead: __game.local.dead, credits: __game.run.credits })));
    await shot('m_next', 3000);
  },
  async diag() {
    await page.goto(base + '?auto=solo&level=grasslands' + extra);
    console.log('loaded', await waitLoaded());
    await clearCut();
    await hookInfo();
    const sh = await ev(() => { const s = __game.world.level.gw.structures.find((x) => x.kind === 'gen_mech'); return [s.cx, s.cz, s.z0, s.z1, s.x0, s.x1]; });
    console.log('shed', sh);
    await tp([sh[0], 0.02, (sh[2] + sh[3]) / 2 + 0.4], 0, -0.45);
    await shot('d_shed_in', 3000);
    console.log('diag', JSON.stringify(await ev(() => {
      const lvl = __game.world.level; const out = { list: lvl._interiorList?.map((b) => [b.cx, b.cz, b.hx, b.hz, b.y0, b.y1, b.open, b.strength]) };
      const mats = new Set(); lvl.structures.group.traverse((o) => { if (o.isMesh) mats.add(o.material); });
      out.mats = [...mats].slice(0, 30).map((m) => {
        const pr = __engine.renderer.properties.get(m);
        const prog = pr.currentProgram;
        const u = prog ? Object.keys(prog.getUniforms().map) : null;
        return { name: m.name, key: m.customProgramCacheKey?.().slice(-30), compiled: !!prog, hasInt: u ? u.some((k) => k.startsWith('uInt')) : null, n: pr.uniforms?.uIntN?.value };
      });
      return out;
    })));
    // the same view with the occlusion switched off
    await ev(() => { const lvl = __game.world.level; let m = null; lvl.structures.group.traverse((o) => { if (o.isMesh && !m && __engine.renderer.properties.get(o.material).uniforms?.uIntN) m = o.material; }); window.__intU = m && __engine.renderer.properties.get(m).uniforms; window.__intN = window.__intU?.uIntN.value; if (window.__intU) window.__intU.uIntN.value = 0; lvl._interiorList = []; });
    await shot('d_shed_off', 1500);
    await ev(() => { const lvl = __game.world.level; lvl._interiorList = [...lvl.structures.interiors]; });
    await tp([sh[0], 0.02, sh[3] + 2.2], 0, -0.25);
    await shot('d_shed_door', 3000);
  },
  async views() {
    await page.goto(base + '?auto=solo&level=grasslands' + extra);
    console.log('loaded', await waitLoaded());
    await page.waitForTimeout(3000);
    await clearCut();
    await hookInfo();
    console.log('land', await ev(() => ({ pos: __game.local.pos.toArray(), grounded: __game.local.grounded, hp: __game.local.survival.health })));
    const info = await ev(() => { const g = __game.world.level.gw; return { hero: g.hero, spawn: g.spawn, mission: g.mission, structures: g.structures.map((s) => [s.kind, s.cx, s.cz]) }; });
    console.log(JSON.stringify(info));
    const h = info.hero, s = info.spawn;
    const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
    await tp([s.x, null, s.z], yawTo(s.x, s.z, h.lipX, h.lipZ), 0.05);
    await shot('v_spawn_hero', 4000);
    console.log(JSON.stringify(await stats()));
    await tp([s.x, null, s.z], yawTo(s.x, s.z, h.lipX, h.lipZ) + Math.PI, 0.0);
    await shot('v_spawn_back', 3000);
    console.log(JSON.stringify(await stats()));
    console.log(JSON.stringify(await ev(() => __game.world.level.debugDraw())));
    // the riverbank, looking at the waterfall
    const bank = await ev(() => {
      const lvl = __game.world.level, gw = lvl.gw, h = gw.hero, s = gw.spawn;
      const dx = h.footX - s.x, dz = h.footZ - s.z, L = Math.hypot(dx, dz);
      let last = [s.x, s.z];
      for (let t = 0; t < L; t += 0.5) { const x = s.x + dx / L * t, z = s.z + dz / L * t; if (gw.waterDepth(x, z) > 0.02) break; last = [x, z]; }
      return { x: last[0] - dx / L * 2.5, z: last[1] - dz / L * 2.5, fx: h.footX, fz: h.footZ, top: gw.height(h.topX, h.topZ) };
    });
    await tp([bank.x, null, bank.z], yawTo(bank.x, bank.z, bank.fx, bank.fz), 0.12);
    await shot('v_river', 3500);
    console.log(JSON.stringify(await stats()));
    // a meadow view across the river toward the far bank
    await tp([s.x - 6, null, s.z + 4], yawTo(s.x, s.z, h.lipX, h.lipZ) + 0.6, -0.02);
    await shot('v_meadow', 3000);
    console.log(JSON.stringify(await stats()));
    console.log(JSON.stringify(await ev(() => __game.world.level.debugDraw())));
    console.log('texmem', JSON.stringify(await texMem()));
    // inside the generator sheds (interior light)
    const sheds = await ev(() => __game.world.level.gw.structures.filter((s) => ['gen_diesel', 'gen_mech'].includes(s.kind)).map((s) => [s.kind, s.cx, s.cz, s.z1]));
    for (const sh of sheds || []) {
      await tp([sh[1], 0.02, sh[3] + 2.2], 0, -0.25);
      await shot('v_shed_' + sh[0], 3000);
    }
    // the wrong things in the valley: the nearest anomaly of each kind
    const anoms = await ev(() => {
      const gw = __game.world.level.gw; const out = {};
      for (let r = 0; r <= 4; r++) for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
        const a = gw.chunkCells(cx, cz, 0).anomaly;
        if (a && !out[a.kind]) out[a.kind] = [a.x, a.z, a.rot];
      }
      return out;
    });
    console.log('anomalies', JSON.stringify(anoms));
    for (const k of ['door', 'poles', 'phone', 'chair', 'powerline', 'clone']) {
      const a = anoms?.[k]; if (!a) continue;
      const ang = a[2] + 0.6, fx = a[0] + Math.sin(ang) * 5.5, fz = a[1] + Math.cos(ang) * 5.5;
      await tp([fx, null, fz], yawTo(fx, fz, a[0], a[1]), -0.05);
      await shot('v_anom_' + k, 3000);
    }
    // later days: golden hour (day 3), dusk (day 5), the sick last day
    for (const [t, name] of [[2.6, 'v_day3'], [4.6, 'v_day5'], [6.5, 'v_day7']]) {
      await ev((t) => { __game.world.level.debugT = t; }, t);
      await tp([s.x - 6, null, s.z + 4], yawTo(s.x, s.z, h.lipX, h.lipZ) + 0.6, 0.02);
      await shot(name, 6000);
    }
    await ev(() => { __game.world.level.debugT = null; });
  },
};

try {
  await (scenarios[scenario] || scenarios.views)();
} catch (e) { logs.push('[script] ' + e.message); }
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
