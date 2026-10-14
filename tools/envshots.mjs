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
page.setDefaultTimeout(240000);
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
    let tris = 0, draws = 0, verts = 0, envDraws = 0, envTris = 0;
    const envMats = new Set();
    for (const rec of chunks) {
      rec.group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        const inst = o.isInstancedMesh ? o.count : 1;
        tris += n * inst; draws += 1; verts += g.attributes.position.count;
        if (o.parent === rec.group) { envDraws++; envTris += n * inst; envMats.add(o.material); }
      });
    }
    if (lv.shell) lv.shell.traverse?.((o) => { if (o.isMesh) envMats.add(o.material); });
    const texOf = (mats) => {
      const seen = new Set(); let t = 0;
      for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        const x = m?.[k]; if (!x || !x.image) continue;
        const img = x.source?.data || x.image; if (seen.has(img)) continue; seen.add(img);
        t += (img.width || 0) * (img.height || 0) * 4 * 1.333;
      }
      return t;
    };
    const texWorld = texOf(envMats);
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
      envDrawsPerChunk: chunks.length ? +(envDraws / chunks.length).toFixed(1) : 0, envTrisPerChunk: chunks.length ? Math.round(envTris / chunks.length) : 0, texMBWorld: +(texWorld / 1048576).toFixed(1),
      frameCalls: r.info.render.calls, frameTris: r.info.render.triangles, texMB: +(tex / 1048576).toFixed(1), gpuTextures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length };
  });
  console.log('[stats]', label, JSON.stringify(s));
  return s;
};
const loadYellow = async () => {
  await page.goto(base + '?auto=solo', { timeout: 240000 });
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
    const hit = ph.raycast(new g.local.pos.constructor(p[0], 0.6, p[1]), d, 40, undefined, null, (c) => c !== g.local.collider);
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
  // fast iteration: a few fixed views (env VIEWS="x,z,yaw,pitch;..." overrides)
  async quick() {
    await loadYellow();
    const sp = await ev(() => __game.local.pos.toArray());
    const views = process.env.VIEWS ? process.env.VIEWS.split(';').map((v) => v.split(',').map(Number)) : [[sp[0], sp[2], 0.4, 0.0], [sp[0], sp[2], 1.2, 0.55], [sp[0], sp[2], 2.2, 0.08]];
    for (let k = 0; k < views.length; k++) {
      const v = views[k];
      if (Number.isNaN(v[2])) {
        // auto yaw: teleport, let chunks stream in, then face the longest open direction
        await tp([v[0], 0, v[1]], 0, 0);
        await page.waitForTimeout(4000);
        v[2] = await bestYaw([v[0], v[1]]);
      }
      await tp([v[0], 0, v[1]], v[2], v[3]);
      await shot('q' + k, k === 0 ? 3000 : 3500);
    }
    await stats('quick');
  },
  // close-ups: walk up to walls / doorways / a troffer near spawn
  async close() {
    await loadYellow();
    const sp = await ev(() => __game.local.pos.toArray());
    const found = await ev((sp) => {
      const g = __game, ph = g.world.physics, V = g.local.pos.constructor; const out = [];
      for (let k = 0; k < 8; k++) {
        const yaw = k * Math.PI / 4; const d = new V(-Math.sin(yaw), 0, -Math.cos(yaw));
        const hit = ph.raycast(new V(sp[0], 1.0, sp[2]), d, 12, undefined, null, (c) => c !== g.local.collider);
        if (hit && hit.dist > 1.6) out.push({ yaw, dist: hit.dist, p: [sp[0] + d.x * (hit.dist - 1.3), sp[2] + d.z * (hit.dist - 1.3)] });
      }
      return out;
    }, sp);
    let k = 0;
    for (const f of (found || []).slice(0, +(process.env.N || 3))) {
      await tp([f.p[0], 0, f.p[1]], f.yaw, -0.28);
      await shot('c' + (k++), 3000);
    }
    // look straight up at the nearest fixture
    const L = await ev(() => { const lv = __game.world.level, p = __game.local.pos; const l = lv._nearestLight(p); return l ? [l.x, l.z] : null; });
    if (L) { await tp([L[0] + 0.9, 0, L[1] + 0.9], 0.8, 1.0); await shot('c_up', 3000); }
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
      const per = {};
      for (const rec of lv.chunks.values()) {
        if (rec.cx < 30) continue;
        rec.group.traverse((o) => { if (!o.isMesh || !o.geometry) return; const k = (o.material.name || '?').replace('_baked', ''); per[k] = (per[k] || 0) + o.geometry.attributes.position.count / 16; });
      }
      for (const k in per) per[k] = Math.round(per[k]);
      console.log('[env] per-material verts/chunk ' + JSON.stringify(per));
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
  // CPU profile of chunk building (CDP), top self-time functions
  async prof() {
    await loadYellow();
    await page.waitForTimeout(2000);
    await ev(() => { __engine.render = () => {}; });
    await page.waitForTimeout(500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    await ev(() => { const lv = __game.world.level; for (let k = 0; k < 16; k++) lv._buildChunk(40 + (k % 4), 40 + Math.floor(k / 4)); });
    const { profile: p } = await cdp.send('Profiler.stop');
    const byId = {}; for (const n of p.nodes) byId[n.id] = n;
    const cnt = {}; for (let i = 0; i < p.samples.length; i++) cnt[p.samples[i]] = (cnt[p.samples[i]] || 0) + (p.timeDeltas[i] || 0);
    const self = {};
    for (const id in cnt) { const n = byId[id]; const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`; self[k] = (self[k] || 0) + cnt[id]; }
    const tot = Object.values(self).reduce((a, b) => a + b, 0);
    console.log('[prof] total ms', (tot / 1000).toFixed(0));
    for (const [k, v] of Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP || 30))) console.log(`${(v / tot * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(1).padStart(7)}ms  ${k}`);
  },
  async one() {
    await loadYellow();
    const v = (process.env.VIEW || '12,12,0,0').split(',').map(Number);
    await tp([v[0], 0, v[1]], v[2], v[3]);
    await shot('one', 6000);
    await stats('one');
  },
  async lobby() {
    await page.goto(base + '?auto=solo', { timeout: 240000 });
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
