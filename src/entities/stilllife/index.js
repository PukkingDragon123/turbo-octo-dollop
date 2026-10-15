// Still Lifes — entry point. Each variant's sculpted, decimated, skinned template is built once
// (in a background worker at startup when possible, synchronously as a fallback) and cached;
// buildStillLife() then only instantiates a skeleton + animator sharing the cached geometry.
import * as THREE from 'three';
import { instantiate, BoneSpec } from './rig.js';
import { installTextureData } from './textures.js';
import { atlasTextures } from './atlas.js';
import * as watcher from './watcher.js';
import * as tall from './tall.js';
import * as twin from './twin.js';
import * as crawler from './crawler.js';
import * as mass from './mass.js';
import * as hound from './hound.js';
import * as partygoer from './partygoer.js';
import * as BL from '../../gfx/bakedlight.js';

export const STILL_LIFE_VARIANTS = ['watcher', 'crawler', 'twin', 'mass', 'tall'];
// other creatures built with the same sculpt / skin / animate pipeline (game/creatures/*)
export const CREATURE_VARIANTS = ['hound', 'partygoer'];
const BUILDERS = { watcher, tall, twin, crawler, mass, hound, partygoer };
const templates = new Map();
export const buildStats = {};
if (typeof window !== 'undefined') window.__slStats = buildStats;

function record(key, tpl, how) {
  let n = 0;
  for (const g of [tpl.body, tpl.parts, tpl.cloth]) if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  buildStats[key] = { ms: Math.round(tpl.buildMs), tris: Math.round(n), how, drawCalls: [tpl.body, tpl.parts, tpl.cloth].filter(Boolean).length };
}

export function getTemplate(variant) {
  const key = BUILDERS[variant] ? variant : 'watcher';
  let tpl = templates.get(key);
  if (!tpl) {
    const t0 = performance.now();
    tpl = BUILDERS[key].template();
    tpl.buildMs = performance.now() - t0;
    templates.set(key, tpl);
    record(key, tpl, 'sync');
  }
  return { key, tpl };
}

// collider dimensions per variant (known before the template exists)
const DIMS = { watcher: [1.58, 0.32], tall: [2.38, 0.35], twin: [1.36, 0.36], crawler: [0.62, 0.34], mass: [1.45, 0.55], hound: [0.78, 0.34], partygoer: [1.72, 0.3] };
const waiters = new Map();
let workerBusy = false;

// Broken-robot motion layered over every animator: poses advance in stop-motion steps (10-14 fps,
// jittered) with the odd stutter-hold, servos twitch violently, and humanoid heads sometimes snap
// round 180 degrees while nobody watches (and creak back later). Fewer animator updates = cheaper too.
const TWITCH_RE = /^(head|neck|shoulder|elbow|wrist|jaw|knee|u[FMR]|l[FMR]|chest|spine)/;
const _tq = new THREE.Quaternion(), _te = new THREE.Euler();
function brokenMotion(key, inst, anim, seed) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const twitchable = inst.bones.filter((b) => TWITCH_RE.test(b.name));
  const heads = key === 'hound' ? [] : inst.bones.filter((b) => /^head[A-Z0-9]?$/.test(b.name));
  const st = { acc: 0, step: 1 / 12, hold: 0, tw: null, twT: 0, twAx: [0, 0, 0], twNext: 1 + rnd() * 3, flip: 0, flipT: 0, flipBone: heads[0] || null, flipNext: 8 + rnd() * 14, first: true };
  return (dt, state) => {
    dt = Math.min(dt || 0, 0.1);
    const frozen = !!state.frozen;
    // timers run in real time
    st.twNext -= frozen ? 0 : dt;
    if (st.twNext <= 0 && twitchable.length) {
      st.twNext = 0.6 + rnd() * (state.alert > 0.6 ? 1.5 : 3.5);
      st.tw = twitchable[Math.floor(rnd() * twitchable.length)];
      st.twT = 0.08 + rnd() * 0.22;
      const a = 0.25 + rnd() * 0.5;
      st.twAx = [(rnd() - 0.5) * 2 * a, (rnd() - 0.5) * 2 * a, (rnd() - 0.5) * 2 * a];
    }
    if (st.flipBone) {
      st.flipNext -= frozen ? 0 : dt;
      if (st.flipNext <= 0 && !frozen) {
        st.flipNext = 10 + rnd() * 18;
        st.flipT = st.flip > 0.5 ? 0 : 2.5 + rnd() * 5;   // snap round, hold, creak back
      }
      if (st.flipT > 0) st.flipT -= frozen ? 0 : dt;
    }
    // stop-motion stepping (always step on the first call so the pose exists)
    st.acc += dt;
    if (st.hold > 0) { st.hold -= dt; if (!st.first) return; }
    if (!st.first && st.acc < st.step) return;
    st.first = false;
    anim.update(st.acc, state || {});
    st.acc = 0;
    st.step = 1 / (10 + rnd() * 4);
    if (!frozen && rnd() < 0.015) st.hold = 0.25 + rnd() * 0.5;   // stutter: the film catches
    if (st.tw && st.twT > 0) {
      st.twT -= st.step;
      st.tw.quaternion.multiply(_tq.setFromEuler(_te.set(st.twAx[0], st.twAx[1], st.twAx[2])));
    }
    if (st.flipBone) {
      const want = st.flipT > 0 ? 1 : 0;
      // snaps round in one or two frames; returns slowly in ratcheting steps
      st.flip = want > st.flip ? Math.min(1, st.flip + 0.6) : Math.max(0, st.flip - 0.12 * (rnd() < 0.5 ? 1 : 0));
      if (st.flip > 0.001) st.flipBone.quaternion.premultiply(_tq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, st.flip * Math.PI));
    }
  };
}

function liveInstance(key, tpl, seed, into = null) {
  const inst = instantiate(tpl, into);
  const anim = BUILDERS[key].animator(inst, tpl, (seed | 0) || 1);
  inst.root.name = 'StillLife_' + key;
  inst.root.userData.stillLife = key;
  const step = brokenMotion(key, inst, anim, (seed | 0) || 1);
  const update = (dt, state) => step(dt, state || {});
  update(0, {});
  return { root: inst.root, update, height: tpl.height, radius: tpl.radius };
}

export function buildStillLife(variant = 'watcher', seed = 1) {
  const key = BUILDERS[variant] ? variant : 'watcher';
  if (!templates.has(key) && workerBusy) {
    // the background worker is still sculpting this one: hand out the (empty) root now and fill
    // it in place when the template arrives, instead of blocking the frame for a synchronous build
    const root = new THREE.Group();
    root.name = 'StillLife_' + key + '_pending';
    let live = null;
    const out = { root, update: (dt, s) => { if (live) live.update(dt, s); }, height: DIMS[key][0], radius: DIMS[key][1] };
    if (!waiters.has(key)) waiters.set(key, []);
    waiters.get(key).push(() => {
      if (live) return;
      live = liveInstance(key, getTemplate(key).tpl, seed, root);
      if (root.userData.probe) BL.applyProbe?.(root); // registered with the level before the meshes existed
    });
    return out;
  }
  return liveInstance(key, getTemplate(key).tpl, seed);
}
function flushWaiters(key) {
  const list = waiters.get(key);
  if (!list) return;
  waiters.delete(key);
  for (const fn of list) { try { fn(); } catch (e) { console.error('stilllife late build', key, e); } }
}

// ---------------------------------------------------------------------------
// background prewarm
function geoFrom(d) {
  if (!d) return null;
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(d.attrs)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1));
  return g;
}
function templateFrom(d) {
  const spec = new BoneSpec();
  d.spec.names.forEach((n, i) => { spec.names.push(n); spec.parent.push(d.spec.parent[i]); spec.pos.push(d.spec.pos[i]); spec.map.set(n, i); });
  return {
    spec, body: geoFrom(d.body), parts: geoFrom(d.parts), cloth: geoFrom(d.cloth),
    bounds: new THREE.Sphere(new THREE.Vector3(d.bounds[0], d.bounds[1], d.bounds[2]), d.bounds[3]),
    height: d.height, radius: d.radius, meta: d.meta, stats: d.stats, buildMs: d.ms,
  };
}

let prewarmPromise = null;
// Build every template off the main thread (falls back to idle-time builds without workers).
export function prewarmStillLifes() {
  if (prewarmPromise) return prewarmPromise;
  if (typeof window === 'undefined') return (prewarmPromise = Promise.resolve());
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 30));
  prewarmPromise = new Promise((resolve) => {
    // most likely spawns first (day 1-2 spawns watchers, talls and twins)
    const todo = ['watcher', 'tall', 'twin', 'hound', 'partygoer', 'crawler', 'mass'].filter((v) => !templates.has(v));
    const finish = () => {
      workerBusy = false;
      for (const k of [...waiters.keys()]) flushWaiters(k); // anything the worker could not deliver
      idle(() => { try { atlasTextures(); } catch (e) { /* no canvas */ } resolve(); });
    };
    let worker = null;
    try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (e) { worker = null; }
    if (!worker) {
      const step = () => { const v = todo.shift(); if (!v) { finish(); return; } getTemplate(v); idle(step, { timeout: 2000 }); };
      idle(step, { timeout: 2000 });
      return;
    }
    workerBusy = true;
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'template') {
        if (!templates.has(d.variant)) { const tpl = templateFrom(d); templates.set(d.variant, tpl); record(d.variant, tpl, 'worker'); }
        flushWaiters(d.variant);
      } else if (d.type === 'texture') installTextureData(d);
      else if (d.type === 'error') console.warn('stilllife worker failed for', d.variant, d.error);
      else if (d.type === 'done') { worker.terminate(); finish(); }
    };
    worker.onerror = (e) => { console.warn('stilllife worker error', e.message); worker.terminate(); finish(); };
    worker.postMessage({ type: 'build', variants: todo, textures: true });
  });
  return prewarmPromise;
}

// In the game, start building in the background shortly after load (the dev gallery builds on demand).
if (typeof window !== 'undefined' && typeof location !== 'undefined' && !/gallery/.test(location.pathname)) {
  setTimeout(() => prewarmStillLifes(), 2500);
}
