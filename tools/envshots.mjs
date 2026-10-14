// Environment art screenshots (Yellow Rooms + lobby) with a fixed seed, plus render budgets.
// usage: node tools/envshots.mjs <scenario> [url] [seed]
//   scenarios: yellow (spawn + zone tour), zones, lobby, stats, one (custom: X Z YAW PITCH via env VIEW)
import { chromium } from 'playwright-core';
const scenario = process.argv[2] || 'yellow';
const base = process.argv[3] || 'http://localhost:5186/';
const SEED = +(process.argv[4] || process.env.SEED || 4242);
const W = +(process.env.W || 1100), H = +(process.env.H || 620);
const prefix = process.env.PREFIX || 'env';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/^\[env\]/.test(t)) console.log(t);
  if (['error', 'warning'].includes(m.type()) && !/favicon|404|atlas overflow|parallel_shader|GPU stall/.test(t)) logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
const ev = async (fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { logs.push('[eval] ' + e.message); return null; } };
const shot = async (name, wait = 2500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `tools/shots/${prefix}_${name}.png`, timeout: 180000 }); console.log('shot', name); };
const waitLoaded = async () => {
  for (let i = 0; i < 300; i++) {
    const ok = await ev(() => !!(window.__game && window.__game.world && !window.__game.loading && window.__game.state === 'playing'));
    if (ok) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};
const clean = () => ev(() => {
  const g = __game;
  g.cutscene = null;
  __engine.post.params.uFade.value = 0;
  __engine.post.params.uGlitch.value = 0;
  if (__engine.post.vmPass) __engine.post.vmPass.enabled = false;
  const hud = document.querySelector('#hud'); if (hud) hud.style.visibility = 'hidden';
  for (const el of document.querySelectorAll('.toast, #toasts, #subtitle, #prompt')) el.style.visibility = 'hidden';
  g.local.survival.sanity = 100;
  if (g.local.survival.hunger !== undefined) g.local.survival.hunger = 100;
});
const tp = (p, yaw, pitch = 0) => ev(([p, yaw, pitch]) => { const l = __game.local; l.teleport(new l.pos.constructor(p[0], p[1] ?? 0, p[2]), yaw); l.pitch = pitch; }, [p, yaw, pitch]);
const stats = async (label) => {
  const s = await ev(() => {
    const r = __engine.renderer, lv = __game.world.level;
    const chunks = lv.chunks ? [...lv.chunks.values()] : [];
    let tris = 0, draws = 0, verts = 0;
    for (const rec of chunks) {
      rec.group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        const inst = o.isInstancedMesh ? o.count : 1;
        tris += n * inst; draws += 1; verts += g.attributes.position.count;
      });
    }
    // texture memory estimate (unique images)
    const seen = new Set(); let tex = 0;
    __engine.scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        const t = m[k]; if (!t || !t.image) continue;
        const img = t.source?.data || t.image; if (seen.has(img)) continue; seen.add(img);
        const w = img.width || 0, h = img.height || 0; tex += w * h * 4 * 1.333;
      }
    });
    return { buildMs: +(lv.buildMs || 0).toFixed(1), chunkBuilds: lv._buildTimes ? lv._buildTimes.slice(-12) : null, chunks: chunks.length,
      perChunkDraws: chunks.length ? +(draws / chunks.length).toFixed(1) : 0, perChunkTris: chunks.length ? Math.round(tris / chunks.length) : 0,
      frameCalls: r.info.render.calls, frameTris: r.info.render.triangles, texMB: +(tex / 1048576).toFixed(1), gpuTextures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length };
  });
  console.log('[stats]', label, JSON.stringify(s));
  return s;
};
const loadYellow = async () => {
  await page.goto(base + '?auto=solo');
  await waitLoaded();
  await page.waitForTimeout(1500);
  await ev((seed) => { const g = __game; g.run = g._newRun(); g.run.depth = 1; g.hostLoadWorld({ type: 'yellow', seed, depth: 1, fresh: true }); }, SEED);
  await page.waitForTimeout(1500);
  await waitLoaded();
  await page.waitForTimeout(2000);
  await clean();
};
// find representative cells of every zone (nearest to spawn) using the level's own layout queries
const findZones = () => ev(() => {
  const lv = __game.world.level; const CELL = 3; const out = {};
  for (let r = 0; r < 60; r++) {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const c = lv.cell((i + 4.5) * CELL, (j + 4.5) * CELL);
      if (!c || c.reserved) continue;
      const k = c.zone + (c.water ? '_water' : '');
      if (!out[k]) out[k] = [(c.i + 0.5) * CELL, (c.j + 0.5) * CELL];
    }
  }
  const specials = {};
  for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) {
    const c = lv.cell((cx * 8 + 4) * CELL, (cz * 8 + 4) * CELL);
    void c;
  }
  return { zones: out, specials };
});
// find the longest open view direction from a point
const bestYaw = (p) => ev((p) => {
  const g = __game, ph = g.world.physics; let best = 0, by = 0;
  for (let k = 0; k < 16; k++) {
    const yaw = k * Math.PI / 8; const d = new g.local.pos.constructor(-Math.sin(yaw), 0, -Math.cos(yaw));
    const hit = ph.raycast(new g.local.pos.constructor(p[0], 1.5, p[1]), d, 40, undefined, null, (c) => c !== g.local.collider);
    const dist = hit ? hit.dist : 40; if (dist > best) { best = dist; by = yaw; }
  }
  return by;
}, p);

const scenarios = {
  async yellow() {
    await loadYellow();
    const sp = await ev(() => __game.local.pos.toArray());
    console.log('spawn', sp);
    for (const [n, yaw, pitch] of [['spawn_a', 0.4, 0.0], ['spawn_b', 2.2, 0.08], ['spawn_up', 1.2, 0.55], ['spawn_c', 4.0, -0.05]]) {
      await tp([sp[0], 0, sp[2]], yaw, pitch);
      await shot(n, 4000);
    }
    await stats('spawn');
    await scenarios.zones(true);
  },
  async zones(loaded) {
    if (!loaded) await loadYellow();
    const z = await findZones();
    console.log('zones', JSON.stringify(z.zones));
    const only = process.env.ZONES ? process.env.ZONES.split(',') : null;
    for (const [k, p] of Object.entries(z.zones)) {
      if (only && !only.includes(k)) continue;
      await tp([p[0], 0, p[1]], 0, 0);
      await page.waitForTimeout(5000);
      const yaw = await bestYaw(p);
      await tp([p[0], 0, p[1]], yaw, k.includes('water') ? -0.25 : -0.02);
      await shot('zone_' + k, 5000);
    }
    await stats('zones');
  },
  async stats() {
    await loadYellow();
    await page.waitForTimeout(3000);
    await stats('spawn');
    const sp = await ev(() => __game.local.pos.toArray());
    // walk a few chunks to force streaming builds
    for (let k = 1; k <= 4; k++) {
      await tp([sp[0] + k * 24, 0, sp[2] + 6], 1.57, 0);
      await page.waitForTimeout(5000);
      await stats('walk' + k);
    }
  },
  // chunk build cost with rendering paused (SwiftShader would otherwise steal the CPU)
  async perf() {
    await loadYellow();
    await page.waitForTimeout(2000);
    const r = await ev(async () => {
      const lv = __game.world.level;
      __engine.render = () => {};
      await new Promise((res) => setTimeout(res, 500));
      const times = [];
      let mod = null;
      try { mod = await import('/src/world/levels/yellow/chunkbuilder.js'); } catch (e) { /* ignore */ }
      const st0 = mod?.buildStats ? { ...mod.buildStats } : null;
      for (let k = 0; k < 16; k++) {
        const cx = 30 + (k % 4), cz = 30 + Math.floor(k / 4);
        const t0 = performance.now();
        lv._buildChunk(cx, cz);
        times.push(+(performance.now() - t0).toFixed(1));
      }
      let tris = 0, draws = 0, verts = 0, n = 0;
      for (const rec of lv.chunks.values()) {
        if (rec.cx < 30) continue; n++;
        rec.group.traverse((o) => { if (!o.isMesh || !o.geometry) return; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); verts += g.attributes.position.count; draws++; });
      }
      const st = mod?.buildStats ? Object.fromEntries(Object.entries(mod.buildStats).map(([k, v]) => [k, +((v - (st0[k] || 0)) / 16).toFixed(2)])) : null;
      return { times, avg: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1), perChunk: { draws: +(draws / n).toFixed(1), tris: Math.round(tris / n), verts: Math.round(verts / n) }, phases: st };
    });
    console.log('[perf]', JSON.stringify(r));
  },
  async one() {
    await loadYellow();
    const v = (process.env.VIEW || '12,12,0,0').split(',').map(Number);
    await tp([v[0], 0, v[1]], v[2], v[3]);
    await shot('one', 6000);
    await stats('one');
  },
  async lobby() {
    await page.goto(base + '?auto=solo');
    await waitLoaded();
    await page.waitForTimeout(3000);
    await clean();
    const views = [
      ['reception', [0, 0, 12.5], Math.PI, 0.05],
      ['reception2', [-4, 0, 8], -2.4, 0.0],
      ['office', [0, 0, 3], 0, 0.0],
      ['break', [17, 0, 2], -Math.PI / 2 - 0.3, 0.0],
      ['lab', [-12, 0, -9], 0.3, 0.1],
      ['dispatch', [13, 0, -10], 0, 0.05],
      ['lockers', [-17, 0, 1], Math.PI / 2, 0.0],
    ];
    const only = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
    for (const [name, p, yaw, pitch] of views) {
      if (only && !only.includes(name)) continue;
      await tp(p, yaw, pitch);
      await shot('lobby_' + name, 3500);
    }
    await stats('lobby');
  },
};
await scenarios[scenario]();
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
