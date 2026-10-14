// "The Bacteria" — procedural body + procedural animation for R.O.O.M.'s main monster.
//
// A 2.8 m (upright), starved, pitch-black humanoid: taut wet skin over countable ribs, a ridge of
// vertebrae, rope-like tendons, knife-edge shins, digitigrade feet, impossibly long arms ending in
// spindly hooked fingers, and a small smooth eyeless head on a corded neck with a hinged jaw. The
// body is sculpted once as a signed-distance field (bacteria_sculpt.js, built in a worker at start-up
// and cached; all instances share the geometry) and rendered as ONE skinned mesh with a wet, oily,
// wrinkled physical material (bacteria_material.js) + one instanced mesh of goo drips.
//
// Animation is fully procedural, solved in world space every frame on 52 bones:
//   * body follows the AI root with lag; feet/hands plant in world space and step with snappy arcs
//     (biped shamble <-> quadrupedal spider gallop on the long arms)
//   * two-bone IK with over-extension (limbs stretch past their rest length), forearm twist spread
//   * twitchy head (snap-holds, tremor, impossible roll), jaw that clicks, gapes and snaps shut
//   * contortions: torso wrenching round on its hips, back-bends, elbows / knees bending backwards
//   * stop-motion "freeze frames" that hold the whole pose and then snap to catch up
//   * breathing rib cage, slow finger crawling, goo drips that hang, fall and splat
//
// Usage:
//   const b = new BacteriaBody(seed); scene.add(b.root);
//   every frame: b.root.position.set(x, floorY, z); b.root.rotation.y = yaw; b.update(dt, s);
//   s = { velocity, state, lookTarget, attackT, ceilingY, intensity, frozen?, groundAt? }
// Conventions: meters, Y up, faces -Z, root origin on the floor under the body.
import * as THREE from 'three';
import { RNG } from '../../core/rng.js';
import { rig, quatYFront, D, FINGER_X, FOOT_PITCH, TENDRILS, JAW_AT } from './bacteria_rig.js';
import { buildTemplateData } from './bacteria_sculpt.js';
import { makeBodyMaterial, makeShadowMaterial, dripMaterial } from './bacteria_material.js';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const Q = THREE.Quaternion;
const UP = new V3(0, 1, 0);
const AX = new V3(1, 0, 0);
const AY = new V3(0, 1, 0);
const AZ = new V3(0, 0, 1);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dk = (rate, dt) => 1 - Math.exp(-rate * dt);
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}
function hashN(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
// smooth 1D value noise in -1..1
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hashN(i) * (1 - u) + hashN(i + 1) * u) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Shared sculpted template (built once: background worker at start-up, synchronous fallback)
// ---------------------------------------------------------------------------
let _tpl = null;
let _prewarm = null;
let _workerBusy = false;
const _waiting = new Set(); // bodies created before the template existed (placeholder geometry)
const stats = (typeof window !== 'undefined' ? (window.__bacStats = window.__bacStats || {}) : {});
const IN_GAME = typeof window !== 'undefined' && typeof location !== 'undefined' && !/gallery/.test(location.pathname);

function geometryFrom(d) {
  const g = new THREE.BufferGeometry();
  const nV = d.pos.length / 3;
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(d.si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(d.sw, 4));
  g.setAttribute('aTis', new THREE.BufferAttribute(d.tis, 4, true));
  g.setIndex(new THREE.BufferAttribute(nV < 65535 ? Uint16Array.from(d.idx) : d.idx, 1));
  g.boundingSphere = new THREE.Sphere(new V3(0, 1.2, 0), 3.2);
  g.boundingBox = new THREE.Box3(new V3(-3, -0.5, -3), new V3(3, 3.2, 3));
  g.userData.shared = true; // owned by the cache, never disposed with a level
  g.name = 'BacteriaBody';
  return g;
}

function installTemplate(d, how) {
  if (_tpl) return _tpl;
  _tpl = { geometry: geometryFrom(d), stats: d.stats, how };
  Object.assign(stats, { tris: d.stats.tris, verts: d.stats.verts, buildMs: d.stats.ms, how });
  for (const b of _waiting) b._attachTemplate(_tpl);
  _waiting.clear();
  return _tpl;
}

// Tiny stand-in with the template's exact attribute layout: a body created before the sculpt is
// ready (e.g. the loading-screen shader warm-up) compiles the very same program and swaps in the
// real geometry when the background build lands.
let _placeholder = null;
function placeholderGeometry() {
  if (_placeholder) return _placeholder;
  _placeholder = geometryFrom({
    pos: new Float32Array([0, 1.2, 0, 0.001, 1.2, 0, 0, 1.201, 0]),
    nor: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    si: new Uint16Array(12), sw: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    tis: new Uint8Array(12).fill(255), idx: new Uint32Array([0, 1, 2]),
  });
  return _placeholder;
}

/** The shared sculpted geometry (builds synchronously if the background build has not finished). */
export function bacteriaTemplate() {
  if (!_tpl) installTemplate(buildTemplateData(), 'sync');
  return _tpl;
}

/** Start building the template off the main thread. Resolves when it is ready (never rejects). */
export function prewarmBacteria() {
  if (_prewarm) return _prewarm;
  _prewarm = new Promise((resolve) => {
    if (_tpl || typeof Worker === 'undefined') { resolve(); return; }
    let w = null;
    try { w = new Worker(new URL('./bacteria_worker.js', import.meta.url), { type: 'module' }); } catch (e) { w = null; }
    if (!w) { resolve(); return; }
    _workerBusy = true;
    const done = (ok) => {
      _workerBusy = false;
      w.terminate();
      // bodies still waiting on a failed worker get a synchronous build at the next idle moment
      if (!ok && _waiting.size) setTimeout(() => bacteriaTemplate(), 0);
      resolve();
    };
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'template' && m.d) { installTemplate(m.d, 'worker'); done(true); return; }
      if (m.type === 'error') console.warn('[bacteria] worker build failed', m.error);
      done(false);
    };
    w.onerror = (e) => { console.warn('[bacteria] worker error', e.message); done(false); };
    w.postMessage({ type: 'build' });
  });
  return _prewarm;
}

if (IN_GAME) setTimeout(() => prewarmBacteria(), 3500);

// ---------------------------------------------------------------------------
// Drips: instanced goo drops that hang from the body, stretch, fall and splat.
// ---------------------------------------------------------------------------
let _dripGeo = null;
function dripGeometry() {
  if (_dripGeo) return _dripGeo;
  // teardrop: round bottom, pinched neck at the top (unit height ~1.6, origin at the round centre)
  const pts = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 bottom -> 1 top
    const a = t * Math.PI;
    let r = Math.sin(a), y = -Math.cos(a);
    if (t > 0.5) { const k = (t - 0.5) * 2; r *= 1 - 0.75 * k; y += k * k * 0.9; }
    pts.push(new THREE.Vector2(Math.max(r, 1e-4), y));
  }
  _dripGeo = new THREE.LatheGeometry(pts, 9);
  _dripGeo.userData.shared = true;
  return _dripGeo;
}

class Drips {
  constructor(count, rng) {
    this.rng = rng;
    this.n = count;
    this.material = dripMaterial();
    this.mesh = new THREE.InstancedMesh(dripGeometry(), this.material, count);
    this.mesh.name = 'BacteriaDrips';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false; // instance matrices are in world space
    this.mesh.matrixWorld.identity();
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.d = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      this.d.push({ st: 0, bone: 0, lp: new V3(), p: new V3(), v: new V3(), r: 0, t: 0, dur: 0, gy: 0 });
      this.mesh.setMatrixAt(i, zero);
    }
    this._m = new THREE.Matrix4();
    this._q = new Q();
    this._s = new V3();
    this.acc = 0;
  }

  spawn(bone, local, r) {
    for (const d of this.d) {
      if (d.st !== 0) continue;
      d.st = 1; d.bone = bone; d.lp.copy(local); d.r = r; d.t = 0;
      d.dur = this.rng.range(0.4, 1.3);
      d.v.set(0, 0, 0);
      return d;
    }
    return null;
  }

  update(dt, body, spawnRate, visible) {
    const rng = this.rng;
    this.mesh.visible = visible;
    if (!visible) return;
    this.acc += dt * spawnRate;
    while (this.acc > 1) {
      this.acc -= 1;
      const sp = body._dripPts[rng.int(0, body._dripPts.length - 1)];
      this.spawn(sp.bone, sp.p, rng.range(0.0045, 0.0095) * sp.size);
    }
    const bones = body.bones;
    const m = this._m, q = this._q.identity(), s = this._s;
    for (let i = 0; i < this.n; i++) {
      const d = this.d[i];
      if (d.st === 0) continue;
      d.t += dt;
      if (d.st === 1) {
        // hanging, swelling and stretching on the body
        d.p.copy(d.lp).applyMatrix4(bones[d.bone].matrixWorld);
        const g = clamp(d.t / d.dur, 0, 1);
        s.set(d.r * (0.45 + 0.55 * g), d.r * (0.6 + 1.9 * g * g), d.r * (0.45 + 0.55 * g));
        d.p.y -= s.y * 0.9;
        if (d.t >= d.dur) {
          d.st = 2; d.t = 0;
          d.v.set(rng.range(-0.04, 0.04), -0.25, rng.range(-0.04, 0.04));
          d.gy = body._groundY(d.p.x, d.p.z);
        }
      } else if (d.st === 2) {
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        const st = 1 + Math.min(2.2, -d.v.y * 0.3);
        s.set(d.r / Math.sqrt(st), d.r * st, d.r / Math.sqrt(st));
        if (d.p.y <= d.gy + 0.002) {
          d.st = 3; d.t = 0; d.p.y = d.gy + 0.0015;
          d.dur = rng.range(2.0, 4.5);
          d.r *= rng.range(2.6, 3.8);
        } else if (d.t > 3) d.st = 0;
      } else if (d.st === 3) {
        // splat: flat glossy blot that shrinks away
        const k = 1 - clamp(d.t / d.dur, 0, 1);
        const sp = Math.min(1, d.t * 14);
        s.set(d.r * (0.4 + 0.6 * sp) * (0.3 + 0.7 * k), 0.0011 + 0.0028 * k, d.r * (0.4 + 0.6 * sp) * (0.3 + 0.7 * k));
        if (d.t >= d.dur) d.st = 0;
      }
      if (d.st === 0) s.set(0, 0, 0);
      m.compose(d.p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.dispose?.(); } // geometry + material are shared
}

// ---------------------------------------------------------------------------
// State presets (smoothed into this.p). The AI's states map onto these.
// ---------------------------------------------------------------------------
const PKEYS = ['quad', 'crouch', 'hunch', 'lean', 'armFwd', 'headFwd', 'listen', 'und', 'stun', 'despawn', 'stalk', 'scan', 'attack', 'jaw', 'breath'];
const STATES = {
  idle: { quad: 0, crouch: 0.08, hunch: 1.15, lean: 0.12, armFwd: 0.0, headFwd: 0.45, listen: 0.2, und: 0.6, jaw: 0.04, breath: 0.6 },
  wander: { quad: 0, crouch: 0.1, hunch: 1.25, lean: 0.2, armFwd: 0.05, headFwd: 0.55, und: 0.4, scan: 0.4, jaw: 0.05, breath: 0.7 },
  investigate: { quad: 0, crouch: 0.2, hunch: 1.3, lean: 0.3, armFwd: 0.25, headFwd: 0.75, listen: 0.45, und: 0.6, scan: 1, jaw: 0.1, breath: 0.8 },
  listen: { quad: 0, crouch: 0.15, hunch: 1.0, lean: 0.12, armFwd: 0.1, headFwd: 0.6, listen: 1, und: 0.25, jaw: 0.14, breath: 0.35 },
  stalk: { quad: 0, crouch: 0.4, hunch: 1.55, lean: 0.45, armFwd: 0.55, headFwd: 1.0, listen: 0.25, und: 1.0, stalk: 1, jaw: 0.12, breath: 0.5 },
  chase: { quad: 1, crouch: 0.12, hunch: 0.35, lean: 0.3, armFwd: 0.0, headFwd: 0.7, und: 0.5, jaw: 0.45, breath: 1.6 },
  attack: { quad: 0, crouch: 0.18, hunch: 0.62, lean: 0.25, armFwd: 0.2, headFwd: 0.8, und: 0.2, attack: 1, jaw: 0.2, breath: 1.4 },
  retreat: { quad: 0.55, crouch: 0.3, hunch: 1.25, lean: 0.25, armFwd: 0.2, headFwd: 0.7, und: 0.7, scan: 0.5, jaw: 0.25, breath: 1.2 },
  flee: { quad: 1, crouch: 0.25, hunch: 0.6, lean: 0.4, armFwd: 0.0, headFwd: 0.5, und: 0.8, scan: 0.8, jaw: 0.6, breath: 1.8, stun: 0.15 },
  smash: { quad: 0, crouch: 0.22, hunch: 0.62, lean: 0.3, armFwd: 0.3, headFwd: 0.85, und: 0.3, attack: 1, jaw: 0.3, breath: 1.5 },
  stunned: { quad: 0, crouch: 0.55, hunch: 1.5, lean: 0.35, armFwd: 0, headFwd: 0.2, und: 0.3, stun: 1, jaw: 0.5, breath: 1.2 },
  hurt: { quad: -1, crouch: 0.3, hunch: 1.3, lean: 0.25, armFwd: 0.1, headFwd: 0.4, und: 0.3, jaw: 0.7, breath: 1.2 },
  despawn: { quad: 0, crouch: 0.6, hunch: 1.6, lean: 0.4, armFwd: 0, headFwd: 0.2, und: 0.1, despawn: 1, jaw: 0.6, breath: 0.2 },
};
const ALIAS = { roam: 'wander', patrol: 'wander', walk: 'wander' };
const RATES = { quad: 4.5, attack: 9, stun: 3, despawn: 1.4, listen: 5, stalk: 3, jaw: 7 };
const TWITCH_BONUS = { stalk: 0.9, listen: 0.5, investigate: 0.4, stunned: 3, hurt: 4, chase: 0.6, idle: 0.3, flee: 1.5, retreat: 0.6 };
const FREEZE_RATE = { idle: 0.12, wander: 0.15, investigate: 0.3, listen: 0.35, stalk: 0.9, chase: 0.35, attack: 0, smash: 0, stunned: 0.6, hurt: 0, despawn: 0.25, retreat: 0.3, flee: 0.25 };
// contortion likelihood per second (x intensity)
const CONTORT_RATE = { idle: 0.05, wander: 0.04, investigate: 0.09, listen: 0.16, stalk: 0.2, chase: 0.04, retreat: 0.08, flee: 0.12, stunned: 0.5 };

// temporaries
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _f = new V3(), _g = new V3(), _h = new V3();
const _qa = new Q(), _qb = new Q(), _qc = new Q(), _qd = new Q(), _qe = new Q();
const _rpI = new V3(), _rest = new V3();
const _scl = new V3();

const rotX = (q, a) => q.multiply(_qc.setFromAxisAngle(AX, a));
const rotY = (q, a) => q.multiply(_qc.setFromAxisAngle(AY, a));
const rotZ = (q, a) => q.multiply(_qc.setFromAxisAngle(AZ, a));

// Two-bone IK. Writes mid joint and end point; returns the stretch factor used (>= 1).
const _ikDir = new V3(), _ikBend = new V3();
function ik2(a, target, l1, l2, pole, maxStretch, outMid, outEnd, outBend) {
  _ikDir.subVectors(target, a);
  let d = _ikDir.length();
  if (d < 1e-5) { _ikDir.set(0, -1, 0); d = 1e-5; } else _ikDir.multiplyScalar(1 / d);
  const L = l1 + l2;
  const s = d > L * 0.995 ? Math.min(d / (L * 0.995), maxStretch) : 1;
  const L1 = l1 * s, L2 = l2 * s;
  d = clamp(d, Math.max(Math.abs(L1 - L2) + 0.02, 0.12 * L), (L1 + L2) * 0.9995);
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const A = Math.acos(clamp(cosA, -1, 1));
  _ikBend.copy(pole).addScaledVector(_ikDir, -pole.dot(_ikDir));
  if (_ikBend.lengthSq() < 1e-8) _ikBend.set(0, 0, -1).addScaledVector(_ikDir, _ikDir.z);
  if (_ikBend.lengthSq() < 1e-8) _ikBend.set(1, 0, 0).addScaledVector(_ikDir, -_ikDir.x);
  _ikBend.normalize();
  outMid.copy(a).addScaledVector(_ikDir, Math.cos(A) * L1).addScaledVector(_ikBend, Math.sin(A) * L1);
  outEnd.copy(a).addScaledVector(_ikDir, d);
  if (outBend) outBend.copy(_ikBend);
  return s;
}
// signed angle from u to v around axis n (all roughly perpendicular to n)
const _sa = new V3();
function signedAngle(u, v, n) {
  _sa.crossVectors(u, v);
  return Math.atan2(_sa.dot(n), u.dot(v));
}

// ---------------------------------------------------------------------------
// BacteriaBody
// ---------------------------------------------------------------------------
export class BacteriaBody {
  constructor(seed = 1) {
    this.seed = Number.isFinite(seed) ? seed : 1;
    this.rng = new RNG((this.seed * 2654435761) >>> 0 || 1);
    this.root = new THREE.Group();
    this.root.name = 'BacteriaBody';
    this.onStep = null;
    /** Stop-motion choppiness multiplier (0 disables choppy pose stepping). */
    this.choppiness = 1;

    const R = (this.R = rig());
    this.def = R.def;
    this.id = R.id;
    this.sides = R.sides;
    this.tenIds = R.tenIds;
    this.bind = R.bind;
    // parent-relative bind rotations / offsets for bones that ride on their parent's frame
    this._relQ = R.quat.map((q, i) => {
      const p = R.def[i].parent;
      return p < 0 ? q.clone() : R.quat[p].clone().invert().multiply(q);
    });
    this._relP = R.pos.map((v, i) => {
      const p = R.def[i].parent;
      return p < 0 ? v.clone() : v.clone().sub(R.pos[p]).applyQuaternion(R.quat[p].clone().invert());
    });
    // where the bind palm faces, expressed in the forearm frame (for twist distribution)
    this._palmInFarm = R.sides.map((o) => new V3(0, 0, -1).applyQuaternion(this._relQ[o.hand]));

    this.uniforms = {
      uDissolve: { value: 0 },
      uMeltC: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uWet: { value: 1 },
    };
    this.material = makeBodyMaterial(this.uniforms);
    // shared sculpt: in-game it is built by a worker; never stall a frame waiting for it
    let tpl = _tpl;
    if (!tpl && IN_GAME) prewarmBacteria();
    if (!tpl && !_workerBusy) tpl = bacteriaTemplate();
    this.geometry = tpl ? tpl.geometry : placeholderGeometry();

    this.bones = [];
    const inv = [];
    for (let i = 0; i < this.def.length; i++) {
      const b = new THREE.Bone();
      b.name = this.def[i].name;
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      b.matrixWorld.copy(this.bind[i]);
      this.bones.push(b);
      inv.push(this.bind[i].clone().invert());
    }
    this.skeleton = new THREE.Skeleton(this.bones, inv);
    const mesh = (this.mesh = new THREE.SkinnedMesh(this.geometry, this.material));
    mesh.name = 'BacteriaMesh';
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new V3(0, 1.2, 0), 3.2);
    mesh.boundingBox = new THREE.Box3(new V3(-3, -0.5, -3), new V3(3, 3.2, 3));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = makeShadowMaterial(this.uniforms, THREE.MeshDepthMaterial, { depthPacking: THREE.RGBADepthPacking });
    mesh.customDistanceMaterial = makeShadowMaterial(this.uniforms, THREE.MeshDistanceMaterial, {});
    mesh.userData.stats = tpl ? tpl.stats : null;
    this.root.add(mesh);
    if (!tpl) _waiting.add(this);

    this.drips = new Drips(36, new RNG((this.seed * 31337 + 5) >>> 0 || 1));
    this.root.add(this.drips.mesh);
    this._defineDripPoints();

    // per-individual habits
    const r = this.rng;
    this.vary = {
      hunch: r.range(-0.1, 0.18), headRoll: r.range(-0.35, 0.35), armOut: r.range(-0.05, 0.08),
      lean: r.range(-0.06, 0.1), twitch: r.range(0.8, 1.3), gait: r.range(0.9, 1.12), breath: r.range(0.8, 1.25),
    };

    this._initState();
    this._dissolve = 0;
  }

  _defineDripPoints() {
    const pts = (this._dripPts = []);
    const add = (bone, x, y, z, size = 1, w = 1) => { for (let i = 0; i < w; i++) pts.push({ bone, p: new V3(x, y, z), size }); };
    const id = this.id;
    add(id.jaw, 0, -0.055, -0.088, 1.2, 4);
    add(id.head, 0, 0.03, -0.07, 0.9, 2);
    for (const [, b] of this.tenIds) add(b, 0, D.tenB * 0.9, 0, 0.8, 1);
    for (const o of this.sides) {
      for (const [, fb] of o.fing) add(fb, 0, D.f2 * 0.92, -0.004, 0.75, 2);
      add(o.farm, 0, D.farm * 0.98, 0.0, 1, 1);
      add(o.farm, 0, 0.02, -0.024, 1, 1);
      add(o.shin, 0, 0.04, -0.03, 0.9, 1);
      add(o.uarm, 0, D.uarm * 0.55, 0.02, 0.9, 1);
    }
    add(id.pelvis, 0, -0.06, -0.05, 1.2, 2);
    add(id.sp1, 0, 0.1, -0.06, 0.9, 1);
  }

  // ---------------------------------------------------------------- state
  _initState() {
    this.time = 0;
    this.p = {};
    for (const k of PKEYS) this.p[k] = STATES.idle[k] ?? 0;
    this.state = 'idle';
    this.intensity = 0.5;
    this.bodyPos = new V3();
    this.bodyYaw = 0;
    this.vel = new V3();
    this.speed = 0;
    this.walkAmt = 0;
    this.galAmt = 0;
    this.phase = 0;
    this.floorY = 0;
    this.ceilY = Infinity;
    this.hunchExtra = 0;
    this.crouchExtra = 0;
    this.freezeT = 0;
    this.frozenAcc = 0;
    this.poseAcc = 0;
    this.poseIv = 0;
    this.attackT = 0;
    this._prevAttackT = 0;
    this._atk = { w: 0, wind: 0, strike: 0 };
    this._smash = { t: 1, last: 0 };
    this._prevRoot = new V3();
    this._prevYaw = 0;
    this._rootPos = new V3();
    this._rootYaw = 0;
    this._init = false;
    this._groundFn = null;
    this.frozen = false;
    this._stillT = 0;
    this.headPos = new V3(0, 2.4, 0);
    this.headTop = new V3();
    this.shoulder = [new V3(), new V3()];
    this.lookTarget = null;
    this._look = new V3();
    this.head = { yaw: 0, pitch: 0, roll: 0, ty: 0, tp: 0, tr: 0, snapT: 0, snapRate: 30, rollT: 0, tremT: 0, trem: new V3() };
    this.jaw = { open: 0, click: 0, clickT: 1, snap: 0 };
    this.breathPh = this.rng.range(0, TAU);
    this.cont = { type: 0, t: 0, dur: 0, amt: 0, tgt: 0, side: 1, a: 0, b: 0 };
    this.tw = {
      head: new V3(), spine: new V3(), pelvis: new V3(),
      sh: [new V3(), new V3()], hand: [new V3(), new V3()], reach: [0, 0],
      fing: [[0, 0, 0, 0], [0, 0, 0, 0]], jaw: 0,
    };
    // limbs: 0 legL, 1 legR, 2 armL, 3 armR
    this.limbs = [];
    for (let i = 0; i < 4; i++) {
      this.limbs.push({
        arm: i >= 2, side: i % 2 === 0 ? -1 : 1, k: i % 2,
        plant: new V3(), cur: new V3(), from: new V3(), to: new V3(),
        yaw: 0, fromYaw: 0, swinging: false, t: 0, dur: 0.2, lift: 0.1, lastF: 0, pitch: FOOT_PITCH,
      });
    }
    this.arms = [0, 1].map(() => ({ pos: new V3(), vel: new V3() }));
    this._F = new V3(); this._R = new V3(); this._qYaw = new Q();
    this._pelvisPos = new V3(); this._qPelvis = new Q(); this._qChest = new Q(); this._qHead = new Q();
    this.bPos = Array.from({ length: this.def.length }, () => new V3());
    this.bQ = Array.from({ length: this.def.length }, () => new Q());
    this.bS = new Float32Array(this.def.length).fill(1);
    this.bSX = new Float32Array(this.def.length).fill(1);
    this._snapTo(new V3(), 0);
    this._solveAll();
    this._writeBones();
  }

  _groundY(x, z) {
    if (this._groundFn) {
      const y = this._groundFn(x, z);
      if (Number.isFinite(y)) return y;
    }
    return this.floorY;
  }

  _snapTo(pos, yaw) {
    this.bodyPos.copy(pos);
    this.floorY = pos.y;
    this.bodyYaw = yaw;
    this._prevRoot.copy(pos);
    this._prevYaw = yaw;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.hunchExtra = 0;
    this.crouchExtra = 0;
    this.freezeT = 0;
    this.frozenAcc = 0;
    for (const l of this.limbs) {
      this._restPoint(l, l.plant, 0);
      l.cur.copy(l.plant);
      l.yaw = yaw;
      l.swinging = false;
      l.pitch = FOOT_PITCH;
    }
    this._F.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    for (let k = 0; k < 2; k++) {
      this.arms[k].pos.copy(pos).addScaledVector(this._F, 0.1);
      this.arms[k].pos.x += Math.cos(yaw) * (k ? 0.3 : -0.3);
      this.arms[k].pos.z -= Math.sin(yaw) * (k ? 0.3 : -0.3);
      this.arms[k].pos.y += 0.6;
      this.arms[k].vel.set(0, 0, 0);
      this.shoulder[k].copy(this.arms[k].pos).y += 1.5;
    }
    this.head.yaw = this.head.ty = 0;
    this.head.pitch = this.head.tp = 0;
    this.headPos.copy(pos).y += 2.4;
    this.cont.type = 0; this.cont.amt = 0;
    this._init = true;
  }

  // Rest (neutral) ground point for a limb in world space, plus velocity lead.
  _restPoint(l, out, lead) {
    const yaw = this.bodyYaw, q = this.p.quad;
    const F = _g.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    let x, z;
    if (!l.arm) {
      x = l.side * (0.14 + 0.06 * q + this.p.crouch * 0.07 + this.p.stun * 0.06);
      z = lerp(0.06, 0.46, q) + l.side * 0.07 * (1 - q) * (1 - this.walkAmt); // staggered idle stance
    } else {
      x = l.side * 0.42;
      z = -0.98;
    }
    out.set(this.bodyPos.x + Math.cos(yaw) * x - F.x * z, 0, this.bodyPos.z - Math.sin(yaw) * x - F.z * z);
    if (lead) { out.x += this.vel.x * lead; out.z += this.vel.z * lead; }
    out.y = this._groundY(out.x, out.z);
    return out;
  }

  // ---------------------------------------------------------------- public API
  /**
   * Advance animation. s = { velocity, state, lookTarget, attackT, ceilingY, groundAt, intensity, frozen }.
   */
  update(dt, s = {}) {
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const root = this.root;
    root.updateWorldMatrix(true, false);
    const e = root.matrixWorld.elements;
    const rp = this._rootPos.set(e[12], e[13], e[14]);
    const ry = Math.atan2(e[8], e[10]);
    this._rootYaw = ry;
    this._groundFn = typeof s.groundAt === 'function' ? s.groundAt : null;
    this.ceilY = Number.isFinite(s.ceilingY) ? s.ceilingY : Infinity;
    this.intensity = clamp(Number.isFinite(s.intensity) ? s.intensity : 0.5, 0, 1);
    const at = clamp(Number.isFinite(s.attackT) ? s.attackT : 0, 0, 1);
    if (s.lookTarget && Number.isFinite(s.lookTarget.x)) { this._look.copy(s.lookTarget); this.lookTarget = this._look; } else this.lookTarget = null;
    this._vin = s.velocity && Number.isFinite(s.velocity.x) && Number.isFinite(s.velocity.z) ? s.velocity : null;
    let state = ALIAS[s.state] || s.state;
    if (!STATES[state]) state = 'idle';

    // smash: the AI only bumps attackT at each blow; strike on every blow, then wind up and hold
    if (state === 'smash') {
      const S = this._smash;
      if (this.state !== 'smash') { S.t = 0; S.last = at; }
      if (at > S.last + 0.05) S.t = 0.36; // a blow just landed
      S.last = at;
      if (S.t < 0.3) S.t = Math.min(0.3, S.t + dt / 0.75);
      else if (S.t >= 0.36) { S.t += dt / 0.75; if (S.t >= 1) S.t = 0; }
      this.attackT = S.t;
    } else {
      this._smash.last = 0;
      this.attackT = at;
    }

    if (!this._init || !Number.isFinite(rp.x + rp.y + rp.z) || rp.distanceToSquared(this.bodyPos) > 9) {
      if (Number.isFinite(rp.x + rp.y + rp.z)) this._snapTo(rp, ry);
    }
    if (state !== this.state) this._onStateChange(this.state, state);
    this.state = state;

    // statue: stalking while watched (AI 'frozen' flag, or standing dead still while stalking)
    const vmag = this._vin ? Math.hypot(this._vin.x, this._vin.z) : 0;
    this._stillT = state === 'stalk' && vmag < 0.08 ? this._stillT + dt : 0;
    this.frozen = !!s.frozen || this._stillT > 0.6;

    let simDt;
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      this.frozenAcc += dt;
      if (this.freezeT > 0) {
        this._updateDrips(dt);
        return;
      }
      simDt = this.frozenAcc;
      this.frozenAcc = 0;
    } else simDt = dt;
    simDt = Math.min(simDt, 0.5);
    this._maybeFreeze(dt);

    const n = Math.max(1, Math.ceil(simDt / (1 / 45)));
    const h = simDt / n;
    const pr = this._prevRoot, py = this._prevYaw;
    const dyaw = angDiff(py, ry);
    for (let i = 1; i <= n; i++) {
      const a = i / n;
      _rpI.lerpVectors(pr, rp, a);
      this._step(h, _rpI, py + dyaw * a);
    }
    this._prevRoot.copy(rp);
    this._prevYaw = ry;
    this._prevAttackT = this.attackT;

    this._solveAll();
    if (!this._finitePose()) {
      // never let a bad frame explode the rig: reset around the root
      this._snapTo(rp, ry);
      this._solveAll();
    }
    this._writeBones();
    this._updateDrips(dt);
  }

  _attachTemplate(tpl) {
    this.geometry = tpl.geometry;
    this.mesh.geometry = tpl.geometry;
    this.mesh.userData.stats = tpl.stats;
  }

  getHeadWorldPosition(target = new V3()) {
    return target.copy(this.headPos);
  }

  setDissolve(t) {
    t = clamp(Number.isFinite(t) ? t : 0, 0, 1);
    this._dissolve = t;
    this.uniforms.uDissolve.value = t;
    this.mesh.visible = t < 0.999;
  }

  dispose() {
    _waiting.delete(this);
    this.root.removeFromParent();
    // geometry + skin textures are shared by every Bacteria (cached); materials are per instance
    this.material.dispose();
    if (this.mesh.material !== this.material) this.mesh.material?.dispose?.(); // probe-lit clone
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.customDistanceMaterial?.dispose();
    this.skeleton.dispose();
    this.drips.dispose();
    this.onStep = null;
  }

  // ---------------------------------------------------------------- internals
  _onStateChange(prev, next) {
    this.freezeT = 0;
    if (this.frozenAcc > 0) this.frozenAcc = Math.min(this.frozenAcc, 0.05);
    const tw = this.tw, r = this.rng;
    if (next === 'hurt' || next === 'stunned') {
      tw.head.x += r.range(0.6, 1.0); tw.head.z += r.range(-1, 1) * 0.8; tw.head.y += r.range(-0.5, 0.5);
      tw.spine.x -= r.range(0.4, 0.7); tw.spine.z += r.range(-0.4, 0.4);
      tw.jaw += 0.6;
      for (let k = 0; k < 2; k++) {
        tw.hand[k].set(r.range(-0.3, 0.3), r.range(0.1, 0.4), r.range(-0.3, 0.3));
        tw.sh[k].y += 0.08;
        for (let f = 0; f < 4; f++) tw.fing[k][f] -= r.range(0.4, 0.9);
      }
      this.cont.type = 0;
    } else if (next === 'attack' || next === 'smash') {
      this.head.snapT = 0;
      this.cont.type = 0;
    } else if (next === 'chase' && prev !== 'chase') {
      // violent jolt as it drops to all fours, jaw snapping open
      tw.head.x += 0.5; tw.spine.x += 0.3; tw.jaw += 0.5;
      this.cont.type = 0;
    } else if (next === 'flee') {
      tw.head.y += r.range(-1.2, 1.2); tw.spine.z += r.range(-0.5, 0.5); tw.jaw += 0.7;
    } else if (next === 'listen') {
      // freeze mid-motion, then the head cocks
      this.freezeT = Math.max(this.freezeT, r.range(0.15, 0.4));
    }
  }

  _maybeFreeze(dt) {
    const st = this.state, I = this.intensity;
    if (st === 'attack' || st === 'smash') {
      if (this._prevAttackT < 0.36 && this.attackT >= 0.36) this.freezeT = this.rng.range(0.08, 0.16);
      return;
    }
    const rate = (FREEZE_RATE[st] ?? 0.2) * (0.4 + 1.2 * I);
    if (this.rng.next() < rate * dt) {
      let d = this.rng.range(0.06, 0.28);
      if (st === 'chase' || st === 'flee') d = Math.min(this.rng.range(0.04, 0.1), 0.35 / Math.max(this.speed, 1));
      this.freezeT = d;
    }
  }

  _step(h, rp, ry) {
    if (h <= 0) return;
    const p = this.p, st = STATES[this.state], I = this.intensity;
    // ---- state params
    const clear = this.ceilY - rp.y;
    const lowCeil = Number.isFinite(clear) ? sstep(2.2, 1.7, clear) : 0;
    for (const k of PKEYS) {
      let tgt = st[k] ?? 0;
      if (k === 'quad') {
        if (tgt < 0) tgt = p.quad;
        if (this.state === 'attack' || this.state === 'smash') tgt = 0;
        tgt = Math.max(tgt, this.state === 'attack' || this.state === 'smash' || this.state === 'despawn' ? 0 : lowCeil);
      }
      const rate = k === 'quad' && (this.state === 'attack' || this.state === 'smash') ? 10 : (RATES[k] ?? 4);
      p[k] += (tgt - p[k]) * dk(rate, h);
    }
    // ---- body frame follows the AI root with a bit of lag
    const vin = this._vin;
    const vx = vin ? vin.x : 0, vz = vin ? vin.z : 0;
    const kv = dk(10, h);
    this.vel.x += (vx - this.vel.x) * kv;
    this.vel.z += (vz - this.vel.z) * kv;
    this.vel.y = 0;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const kb = dk(18, h);
    this.bodyPos.x += (rp.x - this.bodyPos.x) * kb;
    this.bodyPos.z += (rp.z - this.bodyPos.z) * kb;
    this.bodyPos.y += (rp.y - this.bodyPos.y) * dk(12, h);
    const lx = this.bodyPos.x - rp.x, lz = this.bodyPos.z - rp.z, ll = Math.hypot(lx, lz);
    if (ll > 0.3) { this.bodyPos.x = rp.x + (lx / ll) * 0.3; this.bodyPos.z = rp.z + (lz / ll) * 0.3; }
    this.floorY = this.bodyPos.y;
    this.bodyYaw += angDiff(this.bodyYaw, ry) * dk(this.state === 'chase' || this.state === 'flee' ? 12 : 9, h);
    this.walkAmt = sstep(0.06, 0.8, this.speed) * (1 - p.quad);
    this.galAmt = sstep(0.3, 3.0, this.speed) * p.quad;
    // attack shape
    const a = this.attackT, A = this._atk;
    A.w = p.attack;
    A.wind = sstep(0.0, 0.3, a) * (1 - sstep(0.36, 0.44, a));
    A.strike = sstep(0.36, 0.44, a) * (1 - sstep(0.72, 1.0, a));
    // ceiling relax
    if (this.headTop.y < this.ceilY - 0.16) {
      this.hunchExtra = Math.max(0, this.hunchExtra - 0.35 * h);
      this.crouchExtra = Math.max(0, this.crouchExtra - 0.1 * h);
    }
    // breathing (rib cage) never stops, even in a freeze-frame
    const bRate = (0.22 + 0.5 * p.breath) * this.vary.breath;
    this.breathPh = (this.breathPh + bRate * TAU * h) % 4096;
    // ---- pose sims (optionally choppy / stop-motion stepped)
    this.poseAcc += h;
    if (this.poseAcc >= this.poseIv) {
      const H = Math.min(this.poseAcc, 0.12);
      this.poseAcc = 0;
      const chopState = this.state === 'stalk' || this.state === 'attack' || this.state === 'smash' || this.state === 'stunned' ? 1 : this.state === 'chase' || this.state === 'flee' ? 0.5 : 0.25;
      const chop = this.choppiness * chopState * clamp((I - 0.4) / 0.6, 0, 1);
      this.poseIv = chop > 0.02 ? this.rng.range(0.025, 0.085) * chop : 0;
      if (!this.frozen) {
        this._stepLimbs(H);
        this._stepArms(H);
      } else this._stepStatue(H);
      this._stepHead(H);
      this._stepJaw(H);
      this._stepTwitch(H);
      this._stepContort(H);
    }
  }

  _stepStatue(H) {
    // planted and rigid: limbs hold, only tiny tremors and the odd finger curl get through
    for (const l of this.limbs) { l.cur.copy(l.plant); l.swinging = false; }
    for (let k = 0; k < 2; k++) this.arms[k].vel.multiplyScalar(Math.exp(-12 * H));
  }

  _stepLimbs(H) {
    const p = this.p, sp = this.speed, q = p.quad;
    const stride = lerp(1.0 + 0.45 * sp, 1.6 + 0.17 * sp, q) * this.vary.gait;
    const swingFrac = lerp(0.4, 0.42, q);
    const freq = sp > 0.08 ? sp / stride : 0;
    const armsActive = q > 0.35;
    let need = false;
    for (const l of this.limbs) {
      if (l.arm && !armsActive) continue;
      if (l.swinging) { need = true; break; }
      this._restPoint(l, _a, 0);
      const dx = l.plant.x - _a.x, dz = l.plant.z - _a.z;
      if (dx * dx + dz * dz > 0.13 * 0.13 || Math.abs(angDiff(l.yaw, this.bodyYaw)) > 0.7) { need = true; break; }
    }
    let adv = freq;
    if (need && adv < 1.5) adv = 1.5;
    this.phase = (this.phase + adv * H) % 4096;
    const offs = q > 0.5 ? [0, 0.1, 0.5, 0.62] : [0, 0.5, 0.25, 0.75];
    const stanceT = freq > 0.05 ? Math.min((1 - swingFrac) / freq, 0.9) : 0;
    const maxLead = stride * 0.5;
    for (let i = 0; i < 4; i++) {
      const l = this.limbs[i];
      if (l.arm && !armsActive) {
        l.swinging = false;
        this._restPoint(l, l.plant, 0);
        l.cur.copy(l.plant);
        l.yaw = this.bodyYaw;
        l.lastF = (this.phase + offs[i]) % 1;
        continue;
      }
      const f = (((this.phase + offs[i]) % 1) + 1) % 1;
      const wrapped = f < l.lastF;
      l.lastF = f;
      if (l.swinging) {
        l.t += H / l.dur;
        const rem = Math.max(0, 1 - l.t) * l.dur;
        let lead = rem + stanceT * 0.5;
        if (lead * sp > maxLead) lead = maxLead / Math.max(sp, 1e-3);
        this._restPoint(l, _a, lead);
        l.to.lerp(_a, dk(30, H));
        l.to.y = _a.y;
        const t = Math.min(1, l.t);
        const e = 1 - Math.pow(1 - t, 2.6);
        l.cur.lerpVectors(l.from, l.to, e);
        l.cur.y += l.lift * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.8);
        l.yaw = l.fromYaw + angDiff(l.fromYaw, this.bodyYaw) * e;
        l.pitch = FOOT_PITCH + 0.55 * Math.sin(Math.PI * t);
        if (l.t >= 1) {
          l.swinging = false;
          l.plant.copy(l.to);
          l.cur.copy(l.plant);
          l.pitch = FOOT_PITCH;
          this._emitStep(l);
        }
      } else {
        l.cur.copy(l.plant);
        let lead = (freq > 0.05 ? Math.min(swingFrac / freq, 0.34) : 0.24) + stanceT * 0.5;
        if (lead * sp > maxLead) lead = maxLead / Math.max(sp, 1e-3);
        this._restPoint(l, _a, lead);
        const dd = Math.hypot(l.plant.x - _a.x, l.plant.z - _a.z);
        this._restPoint(l, _rest, 0);
        const dr = Math.hypot(l.plant.x - _rest.x, l.plant.z - _rest.z);
        const maxD = l.arm ? 1.15 : 1.0;
        const turn = Math.abs(angDiff(l.yaw, this.bodyYaw));
        if ((wrapped && (dd > 0.06 || turn > 0.25)) || dr > maxD) {
          l.swinging = true;
          l.t = 0;
          l.from.copy(l.plant);
          l.to.copy(_a);
          l.fromYaw = l.yaw;
          l.dur = dr > maxD ? 0.12 : freq > 0.05 ? clamp(swingFrac / freq, 0.08, 0.34) : 0.24;
          if (p.stalk > 0.5 && !l.arm) l.dur = Math.max(l.dur, 0.3);
          l.lift = l.arm ? 0.2 + 0.03 * sp : lerp(0.08 + 0.035 * sp, 0.14, q) + p.stalk * 0.16;
        }
      }
    }
  }

  _emitStep(l) {
    if (!this.onStep) return;
    const sp = this.speed;
    let loud = l.arm ? 0.35 + 0.07 * sp : 0.22 + 0.08 * sp;
    loud *= 1 - 0.45 * this.p.stalk;
    try { this.onStep(l.plant.clone(), clamp(loud, 0.05, 1)); } catch (err) { console.error(err); }
  }

  _stepArms(H) {
    const p = this.p, yaw = this.bodyYaw;
    const F = _b.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const R = _c.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const armLen = D.uarm + D.farm;
    const ph = this.phase * TAU;
    const k = lerp(70, 30, p.stun), c = lerp(7, 2.5, p.stun);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const ar = this.arms[i];
      const sh = this.shoulder[i];
      const swing = this.walkAmt * 0.26 * Math.sin(ph + (s > 0 ? 0 : Math.PI));
      const reach = lerp(0.95, 0.6, p.armFwd);
      _d.copy(sh)
        .addScaledVector(UP, -armLen * reach)
        .addScaledVector(F, 0.1 + p.armFwd * 0.7 + swing)
        .addScaledVector(R, s * (0.12 + 0.06 * p.stun + 0.05 * p.stalk + this.vary.armOut));
      // creepy slow clawing sway while stalking/idle
      _d.addScaledVector(F, (0.06 + 0.1 * p.stalk) * noise1(this.time * 0.6 + i * 17));
      _d.y += 0.05 * noise1(this.time * 0.5 + i * 5);
      const fy = this.floorY + 0.12;
      if (_d.y < fy) _d.y = fy;
      // semi-implicit spring
      ar.vel.addScaledVector(_e.subVectors(_d, ar.pos), k * H).multiplyScalar(Math.max(0, 1 - c * H));
      ar.pos.addScaledVector(ar.vel, H);
      if (ar.pos.distanceTo(_d) > 0.6) ar.pos.sub(_d).setLength(0.6).add(_d);
      if (!Number.isFinite(ar.pos.x + ar.pos.y + ar.pos.z)) { ar.pos.copy(_d); ar.vel.set(0, 0, 0); }
    }
  }

  _stepHead(H) {
    const hd = this.head, p = this.p, r = this.rng, I = this.intensity, t = this.time;
    let yawD, pitchD;
    if (this.lookTarget) {
      _a.subVectors(this.lookTarget, this.headPos);
      const yw = Math.atan2(-_a.x, -_a.z);
      yawD = angDiff(this.bodyYaw, yw);
      pitchD = Math.atan2(_a.y, Math.hypot(_a.x, _a.z));
    } else {
      yawD = 0.5 * noise1(t * 0.17 + 5) * (0.4 + p.scan);
      pitchD = -0.12 + 0.14 * noise1(t * 0.21 + 2);
    }
    yawD += p.scan * 0.9 * noise1(t * 0.35 + 11);
    pitchD = lerp(pitchD, -0.85, p.stun * 0.7);
    pitchD = lerp(pitchD, -1.0, p.despawn);
    // a watched statue keeps its face locked on you, impossibly far round
    yawD = clamp(yawD, this.frozen ? -2.9 : -2.5, this.frozen ? 2.9 : 2.5);
    pitchD = clamp(pitchD, -1.2, 0.95);
    const fast = this.state === 'chase' || this.state === 'attack' || this.state === 'smash' || this.state === 'flee';
    hd.snapT -= H;
    if (hd.snapT <= 0) {
      const j = (0.04 + 0.22 * I + 0.25 * p.stun) * (this.frozen ? 0.25 : 1);
      hd.ty = yawD + r.range(-j, j);
      hd.tp = pitchD + r.range(-j, j) * 0.7;
      hd.snapT = fast ? r.range(0.04, 0.16) : r.range(0.1, 0.85) * (1 - 0.5 * I) * (1 + p.listen);
      hd.snapRate = fast ? r.range(25, 45) : r.range(16, 48);
    }
    hd.rollT -= H;
    if (hd.rollT <= 0) {
      const pe = 0.1 + 0.5 * p.listen + 0.3 * I * (1 - 0.5 * p.quad);
      hd.tr = r.next() < pe ? (r.next() < 0.5 ? -1 : 1) * r.range(0.75, 1.75) : r.range(-0.3, 0.3) + this.vary.headRoll;
      hd.rollT = r.range(0.3, 1.6);
      if (I > 0.6 && r.next() < 0.14 * I) {
        hd.tr = (r.next() < 0.5 ? -1 : 1) * r.range(2.5, 3.0); // glitchy upside-down flick
        hd.rollT = r.range(0.07, 0.16);
      }
    }
    let tr = hd.tr;
    tr = lerp(tr, 0.9 * noise1(t * 0.45 + 3), p.stun);
    const k = dk(hd.snapRate, H);
    hd.yaw += angDiff(hd.yaw, hd.ty) * k;
    hd.pitch += (hd.tp - hd.pitch) * k;
    hd.roll += (tr - hd.roll) * dk(hd.snapRate * 0.6, H);
    hd.tremT -= H;
    if (hd.tremT <= 0) {
      const a = 0.01 + 0.05 * I * I + 0.06 * p.stun;
      hd.trem.set(r.range(-a, a), r.range(-a, a), r.range(-a, a) * 1.5);
      hd.tremT = r.range(0.03, 0.08);
    }
  }

  _stepJaw(H) {
    const J = this.jaw, p = this.p, r = this.rng, A = this._atk;
    // listening / stalking: dry clicking bursts; chasing: gaping and fluttering
    J.clickT -= H;
    if (J.clickT <= 0) {
      const busy = p.listen * 0.8 + p.stalk * 0.6 + (this.state === 'investigate' ? 0.4 : 0);
      J.clickT = r.next() < 0.3 + busy * 0.5 ? r.range(0.05, 0.12) : r.range(0.6, 3.0);
      J.click = r.next() < 0.25 + busy * 0.6 ? r.range(0.12, 0.3) : 0;
    }
    J.click *= Math.exp(-14 * H);
    let tgt = p.jaw + J.click + this.tw.jaw;
    tgt += 0.18 * this.galAmt * (0.5 + 0.5 * Math.sin(this.phase * TAU * 2));
    tgt += 0.04 * Math.max(0, Math.sin(this.breathPh)) * (1 - p.quad);
    // attack: gape during the wind-up, snap shut on the strike
    tgt = lerp(tgt, 0.95, A.w * A.wind);
    tgt = lerp(tgt, 0.05, A.w * A.strike * 0.85);
    tgt = clamp(tgt, 0, 1.05);
    J.open += (tgt - J.open) * dk(tgt < J.open ? 30 : 16, H);
  }

  _stepTwitch(H) {
    const tw = this.tw, r = this.rng, I = this.intensity, p = this.p;
    const dec = Math.exp(-11 * H);
    tw.head.multiplyScalar(dec); tw.spine.multiplyScalar(dec); tw.pelvis.multiplyScalar(dec);
    tw.jaw *= Math.exp(-6 * H);
    for (let k = 0; k < 2; k++) {
      tw.sh[k].multiplyScalar(dec);
      tw.hand[k].multiplyScalar(dec);
      tw.reach[k] *= Math.exp(-4 * H);
      for (let f = 0; f < 4; f++) tw.fing[k][f] *= dec;
    }
    const bonus = TWITCH_BONUS[this.state] ?? 0;
    let rate = (0.2 + 2.4 * I * I + bonus) * this.vary.twitch;
    if (this.frozen) rate *= 0.35;
    if (r.next() < rate * H) {
      const m = (0.5 + I) * (this.frozen ? 0.5 : 1);
      const roll = r.next();
      if (roll < 0.34) {
        tw.head.x += r.range(-0.45, 0.45) * m; tw.head.y += r.range(-0.5, 0.5) * m; tw.head.z += r.range(-0.7, 0.7) * m;
      } else if (roll < 0.48) {
        const k = r.int(0, 1);
        tw.sh[k].y += r.range(0.03, 0.08) * m; tw.sh[k].z += r.range(-0.06, 0.06) * m;
      } else if (roll < 0.6) {
        tw.spine.x += r.range(-0.3, 0.3) * m; tw.spine.y += r.range(-0.3, 0.3) * m; tw.spine.z += r.range(-0.25, 0.25) * m;
      } else if (roll < 0.72) {
        const k = r.int(0, 1);
        tw.hand[k].set(r.range(-0.2, 0.2), r.range(-0.1, 0.25), r.range(-0.2, 0.2)).multiplyScalar(m);
      } else if (roll < 0.86) {
        const k = r.int(0, 1);
        for (let f = 0; f < 4; f++) tw.fing[k][f] += r.range(-0.7, 0.7) * m;
      } else if (roll < 0.92) {
        tw.jaw += r.range(0.2, 0.55) * m;
      } else if (this.lookTarget && (p.stalk > 0.5 || this.state === 'investigate') && I > 0.4) {
        tw.reach[r.int(0, 1)] = 1; // sudden over-extended reach toward the target
      } else {
        tw.pelvis.x += r.range(-0.12, 0.12) * m; tw.pelvis.z += r.range(-0.1, 0.1) * m;
      }
    }
  }

  // Contortions: brief, impossible poses snapped into and out of (stop-motion style).
  //   1 torso wrenches round on the hips   2 back-bend, head hanging upside down
  //   3 one elbow bends backwards           4 one knee bends backwards   5 head screws round 180
  _stepContort(H) {
    const C = this.cont, r = this.rng, I = this.intensity;
    if (C.type) {
      C.t += H;
      const inT = 0.07, outT = 0.12;
      C.tgt = C.t < C.dur ? 1 : 0;
      C.amt += (C.tgt - C.amt) * dk(C.tgt > C.amt ? 1 / inT * 3 : 1 / outT * 3, H);
      if (C.t > C.dur && C.amt < 0.02) { C.type = 0; C.amt = 0; }
      return;
    }
    if (this.state === 'attack' || this.state === 'smash' || this.state === 'despawn' || this._dissolve > 0.3) return;
    const rate = (CONTORT_RATE[this.state] ?? 0.04) * (0.3 + 1.4 * I) * (this.frozen ? 2.2 : 1);
    if (r.next() >= rate * H) return;
    const moving = this.speed > 0.6;
    const pick = r.next();
    let type;
    if (this.frozen) type = pick < 0.6 ? 5 : pick < 0.8 ? 3 : 1;
    else if (moving) type = pick < 0.45 ? 3 : pick < 0.75 ? 1 : 5;
    else type = pick < 0.24 ? 1 : pick < 0.46 ? 2 : pick < 0.66 ? 3 : pick < 0.82 ? 4 : 5;
    C.type = type;
    C.t = 0;
    C.amt = 0;
    C.side = r.next() < 0.5 ? -1 : 1;
    C.a = r.range(0.7, 1.0);
    C.dur = type === 2 ? r.range(0.7, 1.8) : type === 5 ? r.range(0.5, 1.6) : r.range(0.25, 1.1);
    if (this.frozen) C.dur *= 1.6;
  }

  _solveAll() {
    for (let pass = 0; pass < 3; pass++) {
      this._solve();
      if (!Number.isFinite(this.ceilY)) break;
      const over = this.headTop.y - (this.ceilY - 0.06);
      if (over <= 0.002) break;
      this.hunchExtra = Math.min(this.hunchExtra + over * 1.4, 1.6);
      this.crouchExtra = Math.min(this.crouchExtra + over * 0.3, 0.45);
    }
  }

  _setBone(i, pos, q, s = 1, sx = 1) {
    this.bPos[i].copy(pos);
    this.bQ[i].copy(q);
    this.bS[i] = s;
    this.bSX[i] = sx;
  }

  // Solve the full world-space pose from the current simulation state.
  _solve() {
    const p = this.p, t = this.time, id = this.id, tw = this.tw;
    const yaw = this.bodyYaw;
    const F = this._F.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const R = this._R.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const qYaw = this._qYaw.setFromAxisAngle(AY, yaw);
    const BP = this.bodyPos;
    const quad = p.quad, walk = this.walkAmt, gal = this.galAmt;
    const ph = this.phase * TAU;
    const A = this._atk, aw = A.w;
    const C = this.cont, ca = C.type ? C.amt : 0;
    const breath = Math.sin(this.breathPh);
    const V = this.vary;

    // ---------------- pelvis
    let ext = lerp(0.94 - p.crouch * 0.33, 0.68 - p.crouch * 0.1, quad);
    ext -= p.stun * 0.1 + p.despawn * 0.45 + this.crouchExtra;
    ext += aw * (-0.12 * A.wind + 0.03 * A.strike);
    if (C.type === 2) ext -= 0.06 * ca;
    ext = clamp(ext, 0.22, 0.985);
    const ankleH = D.foot * Math.sin(FOOT_PITCH);
    let hipH = ankleH + (D.thigh + D.shin) * ext;
    hipH += walk * 0.025 * Math.cos(2 * ph) + gal * 0.07 * Math.sin(ph + 0.6) + 0.008 * Math.sin(t * 1.4);
    const sway = walk * 0.04 * Math.sin(ph) + 0.03 * noise1(t * 0.35 + 3) * (1 - quad) + p.stun * 0.09 * noise1(t * 0.6);
    const back = lerp(0.03, 0.4, quad) - aw * A.strike * 0.55 + aw * A.wind * 0.16 - p.lean * 0.05;
    const pelvisPos = this._pelvisPos.copy(BP).addScaledVector(R, sway).addScaledVector(F, -back);
    pelvisPos.y = BP.y + hipH - D.hipY;
    const pitch = lerp(0.1 + (p.lean + V.lean) * 0.55, 1.36, quad) + gal * 0.14 * Math.sin(ph) + aw * (-0.38 * A.wind + 0.32 * A.strike)
      + p.stun * 0.25 + p.despawn * 0.7 + tw.pelvis.x;
    const roll = walk * 0.06 * Math.sin(ph) + p.stun * 0.14 * noise1(t * 0.5 + 9) + tw.pelvis.z;
    const twist = walk * 0.13 * Math.sin(ph) + gal * 0.08 * Math.sin(ph);
    const qP = this._qPelvis.copy(qYaw);
    rotY(qP, twist); rotX(qP, -pitch); rotZ(qP, roll);
    this._setBone(id.pelvis, pelvisPos, qP);

    // ---------------- spine
    const W5 = [0.06, 0.12, 0.2, 0.28, 0.34];
    let bendTot = lerp(p.hunch + V.hunch, -0.32, quad) + this.hunchExtra * (1 - 0.5 * quad)
      + aw * (-0.6 * A.wind + 0.38 * A.strike) + p.stun * 0.3 + p.despawn * 0.6;
    if (C.type === 2) bendTot = lerp(bendTot, -1.55 * C.a, ca); // back-bend
    const contTwist = C.type === 1 ? C.side * C.a * 1.7 * ca : 0; // torso wrench
    const pos = _a.copy(pelvisPos).addScaledVector(_b.set(0, D.pelvis, 0).applyQuaternion(qP), 1);
    const q = _qa.copy(qP);
    const bAmp = 0.022 + 0.02 * p.breath;
    for (let i = 0; i < 5; i++) {
      const bend = bendTot * W5[i] + gal * 0.11 * Math.sin(ph - i * 0.8) + p.und * 0.05 * Math.sin(t * 1.7 - i * 1.1)
        + tw.spine.x * 0.22 + 0.012 * Math.sin(t * 1.3 + i) + (i >= 2 ? -0.012 * breath : 0);
      const lat = walk * 0.05 * Math.sin(ph + i * 0.5) + p.und * 0.07 * Math.sin(t * 1.25 - i * 1.15 + 1) + gal * 0.03 * Math.sin(ph - i)
        + tw.spine.z * 0.2;
      const twi = -twist * 0.35 + tw.spine.y * 0.2 + contTwist * (i < 4 ? 0.22 : 0.12);
      rotX(q, -bend); rotZ(q, lat); rotY(q, twi);
      // rib cage swells with each breath
      const sx = i >= 2 ? 1 + bAmp * (0.5 + 0.5 * breath) * (i === 4 ? 0.6 : 1) : 1;
      this._setBone(id['sp' + i], pos, q, 1, sx);
      pos.addScaledVector(_b.set(0, D.spine, 0).applyQuaternion(q), 1);
    }
    const qChest = this._qChest.copy(q);
    const sp4 = id.sp4;
    const chestTop = _f.copy(pos);

    // ---------------- head aim + neck
    const hd = this.head;
    let hy = hd.yaw + hd.trem.y + tw.head.y;
    let hpch = hd.pitch + hd.trem.x + tw.head.x + aw * (0.55 * A.wind - 0.3 * A.strike) - 0.75 * quad;
    let hr = hd.roll + hd.trem.z + tw.head.z;
    if (C.type === 5) hy += C.side * Math.PI * 0.95 * ca;
    if (C.type === 2) { hpch += 2.0 * ca; hr += C.side * 0.6 * ca; }
    const qH = this._qHead.copy(qYaw);
    rotY(qH, hy); rotX(qH, hpch); rotZ(qH, hr);
    const fwdNeck = p.headFwd * (1 - 0.4 * quad) + 0.5 * quad + aw * A.strike * 0.4;
    _qb.copy(qChest).slerp(qH, 0.33);
    rotX(_qb, -fwdNeck * 0.55);
    this._setBone(id.neck0, chestTop, _qb);
    const n1 = _c.copy(chestTop).addScaledVector(_d.set(0, D.neck, 0).applyQuaternion(_qb), 1);
    _qb.copy(qChest).slerp(qH, 0.7);
    rotX(_qb, -fwdNeck * 0.25);
    // neck lengthens a little when it lunges or strains
    const nStr = 1 + 0.18 * aw * A.strike + 0.1 * ca * (C.type === 2 || C.type === 5 ? 1 : 0);
    this._setBone(id.neck1, n1, _qb, nStr);
    const headBase = n1.addScaledVector(_d.set(0, D.neck * nStr, 0).applyQuaternion(_qb), 1);
    this._setBone(id.head, headBase, qH);
    this.headPos.copy(_d.set(0, 0.12, -0.02).applyQuaternion(qH)).add(headBase);
    this.headTop.copy(_d.set(0, 0.25, 0.06).applyQuaternion(qH)).add(headBase);
    // jaw
    {
      const ji = id.jaw;
      _qb.copy(qH).multiply(this._relQ[ji]);
      rotX(_qb, -this.jaw.open * 0.85);
      rotY(_qb, 0.06 * noise1(t * 3.1) * this.jaw.open);
      this._setBone(ji, _e.copy(this._relP[ji]).applyQuaternion(qH).add(headBase), _qb);
    }
    // tendrils
    const spread = aw * (A.wind * 0.9 + A.strike * 0.5) + 0.25 * this.intensity * Math.max(0, noise1(t * 0.8));
    for (let n = 0; n < this.tenIds.length; n++) {
      const [ia, ib] = this.tenIds[n];
      _qb.copy(qH).multiply(this._relQ[ia]);
      rotX(_qb, 0.35 * noise1(t * 1.3 + n * 7) + 0.12 * this.intensity * noise1(t * 9 + n) - spread * 0.3 - 0.4 * quad);
      rotZ(_qb, 0.3 * noise1(t * 1.1 + n * 13) + spread * (TENDRILS[n].rz > 0 ? 0.7 : -0.7));
      const ta = _d.copy(this._relP[ia]).applyQuaternion(qH).add(headBase);
      this._setBone(ia, ta, _qb);
      const tb = ta.addScaledVector(_e.set(0, D.tenA, 0).applyQuaternion(_qb), 1);
      rotX(_qb, 0.5 * noise1(t * 1.7 + n * 3) + 0.25);
      rotZ(_qb, 0.4 * noise1(t * 1.5 + n * 5));
      this._setBone(ib, tb, _qb);
    }

    // ---------------- arms
    const plantBlend = sstep(0.35, 0.85, quad);
    const ceilHand = this.ceilY - 0.12;
    for (let k = 0; k < 2; k++) {
      const o = this.sides[k], s = o.s, L = this.limbs[2 + k];
      // clavicle from the upper spine to the shoulder joint
      const clavStart = _a.set(s * 0.03, 0.15, 0).applyQuaternion(qChest).add(this.bPos[sp4]);
      const shrug = 0.04 * quad + aw * 0.08 * A.wind + tw.sh[k].y + p.stalk * 0.03 + 0.008 * breath;
      const shoulder = _b.set(s * 0.2, 0.13 + shrug, 0.02 - 0.05 * quad - 0.04 * p.stalk + tw.sh[k].z)
        .applyQuaternion(qChest).add(this.bPos[sp4]);
      this.shoulder[k].copy(shoulder);
      _c.subVectors(shoulder, clavStart);
      const clen = _c.length();
      quatYFront(_c, _d.set(0, 0, -1).applyQuaternion(qChest), _qb);
      this._setBone(o.clav, clavStart, _qb, clen / D.clav);
      // hand target
      const ht = _c.lerpVectors(this.arms[k].pos, _d.copy(L.cur).addScaledVector(UP, 0.07), plantBlend);
      ht.add(tw.hand[k]);
      if (aw > 0.001) {
        // wind-up: arms flung up and wide; strike: both whip forward at the target
        _e.copy(shoulder).addScaledVector(UP, 0.6).addScaledVector(R, s * 0.62).addScaledVector(F, -0.25);
        ht.lerp(_e, aw * A.wind);
        if (this.lookTarget) {
          _e.subVectors(this.lookTarget, shoulder);
          const dl = _e.length();
          if (dl > 2.2) _e.multiplyScalar(2.2 / dl);
          _e.add(shoulder).addScaledVector(R, s * 0.14);
        } else {
          _e.copy(shoulder).addScaledVector(F, 1.8).addScaledVector(UP, -0.35).addScaledVector(R, s * 0.1);
        }
        ht.lerp(_e, aw * A.strike);
      }
      if (tw.reach[k] > 0.01 && this.lookTarget) {
        _e.subVectors(this.lookTarget, shoulder).clampLength(0, 2.0).add(shoulder);
        ht.lerp(_e, sstep(0, 0.5, tw.reach[k]));
      }
      if (ht.y > ceilHand) ht.y = ceilHand;
      const minY = this.floorY + 0.05;
      if (ht.y < minY) ht.y = minY;
      // elbow pole: backward (biped), up+out spider elbows (quad), out (attack); contortion: reversed
      const pole = _e.copy(F).multiplyScalar(-1 + 0.7 * quad).addScaledVector(R, s * (0.55 + 0.6 * quad)).addScaledVector(UP, 0.85 * quad);
      pole.addScaledVector(R, s * aw).addScaledVector(UP, -0.4 * aw);
      if (C.type === 3 && C.side === s && ca > 0.5) pole.negate().addScaledVector(UP, -0.3); // elbow pops backwards
      const maxSt = 1.1 + 0.25 * aw * A.strike + 0.22 * tw.reach[k];
      const elbow = _d, wrist = _g;
      const st = ik2(shoulder, ht, D.uarm, D.farm, pole, maxSt, elbow, wrist, _f);
      const bend = _f;
      quatYFront(_h.subVectors(elbow, shoulder), bend, _qb);
      this._setBone(o.uarm, shoulder, _qb, st);
      // forearm frame before twist
      const fAxis = _a.subVectors(wrist, elbow).normalize();
      quatYFront(fAxis, bend, _qd);
      // desired hand orientation (splays flat on the floor when planted or hanging low)
      const fb = Math.max(plantBlend, sstep(this.floorY + 0.42, this.floorY + 0.1, wrist.y) * (1 - aw));
      const hY = _b.copy(fAxis).addScaledVector(F, 0.15 * (1 - fb));
      _e.copy(F).multiplyScalar(0.85).addScaledVector(R, s * 0.35).addScaledVector(UP, -0.3).normalize();
      hY.normalize().lerp(_e, fb).normalize();
      const palm = _c.copy(R).multiplyScalar(-s).addScaledVector(F, 0.3).lerp(_e.set(0, -1, 0), fb);
      palm.addScaledVector(F, aw * A.strike * 1.5).normalize();
      // twist: compare the palm the forearm "carries" with the desired palm, around the forearm axis
      const carried = _e.copy(this._palmInFarm[k]).applyQuaternion(_qd);
      carried.addScaledVector(fAxis, -carried.dot(fAxis));
      const want = _h.copy(palm).addScaledVector(fAxis, -palm.dot(fAxis));
      let tw2 = 0;
      if (carried.lengthSq() > 1e-6 && want.lengthSq() > 1e-6) tw2 = signedAngle(carried.normalize(), want.normalize(), fAxis);
      tw2 = clamp(tw2, -1.9, 1.9);
      // half the twist goes into the forearm, the rest stays in the wrist (clamped)
      _qe.setFromAxisAngle(fAxis, tw2 * 0.5);
      _qd.premultiply(_qe);
      this._setBone(o.farm, elbow, _qd, st);
      // hand: re-aim the palm within the reachable twist range
      const along = palm.dot(fAxis);
      const palmC = _c.copy(carried).applyAxisAngle(fAxis, tw2).multiplyScalar(Math.sqrt(Math.max(0, 1 - along * along))).addScaledVector(fAxis, along);
      quatYFront(hY, palmC, _qb);
      this._setBone(o.hand, wrist, _qb);
      // fingers
      const qHand = _qd.copy(_qb);
      let c0 = 0.38, c1 = 0.5, spr = 1;
      c0 = lerp(c0, 0.6, p.stalk); c1 = lerp(c1, 0.75, p.stalk); spr = lerp(spr, 1.3, p.stalk);
      c0 = lerp(c0, 0.7, p.stun); c1 = lerp(c1, 0.85, p.stun);
      c0 = lerp(c0, 0.12, fb); c1 = lerp(c1, 0.3, fb); spr = lerp(spr, 1.4, fb);
      c0 = lerp(c0, -0.3, aw * A.wind); c1 = lerp(c1, -0.12, aw * A.wind); spr = lerp(spr, 2.0, aw * A.wind);
      c0 = lerp(c0, 0.55, aw * A.strike); c1 = lerp(c1, 0.95, aw * A.strike);
      const I = this.intensity;
      for (let f = 0; f < 4; f++) {
        const [fa, fbn] = o.fing[f];
        // slow, independent crawling of each finger
        const nz = (0.12 + 0.15 * I) * noise1(t * (1.5 + I * 2) + f * 7 + k * 13) + 0.1 * Math.sin(t * 2.2 + f * 1.3 + k);
        const cc0 = c0 + nz + tw.fing[k][f], cc1 = c1 + nz * 1.3 + tw.fing[k][f] * 0.6;
        const base = _e.set(FINGER_X[f], D.hand, 0).applyQuaternion(qHand).add(wrist);
        const qf = _qa.copy(qHand);
        rotZ(qf, -FINGER_X[f] * 9 * spr);
        rotX(qf, -cc0);
        this._setBone(fa, base, qf);
        base.addScaledVector(_h.set(0, D.f1, 0).applyQuaternion(qf), 1);
        rotX(qf, -cc1);
        this._setBone(fbn, base, qf);
      }
      // thumb rides on the hand, curling in with the fingers
      {
        const ti = o.thumb;
        _qa.copy(qHand).multiply(this._relQ[ti]);
        rotX(_qa, -(c0 * 0.5 + 0.1 * noise1(t * 1.7 + k * 3)));
        this._setBone(ti, _e.copy(this._relP[ti]).applyQuaternion(qHand).add(wrist), _qa);
      }
    }

    // ---------------- legs
    for (let k = 0; k < 2; k++) {
      const o = this.sides[k], s = o.s, L = this.limbs[k];
      const hip = _a.set(s * D.hipX, D.hipY, 0).applyQuaternion(qP).add(pelvisPos);
      const fy = L.yaw;
      const fdir = _b.set(-Math.sin(fy), 0, -Math.cos(fy));
      const pc = L.pitch;
      const ankleT = _c.copy(L.cur).addScaledVector(fdir, -D.foot * Math.cos(pc)).addScaledVector(UP, D.foot * Math.sin(pc));
      const pole = _d.copy(F).addScaledVector(R, s * (0.25 + 0.75 * quad)).addScaledVector(UP, 0.15 * quad + 0.1 * p.despawn);
      if (C.type === 4 && C.side === s && ca > 0.5) pole.copy(F).negate().addScaledVector(R, s * 0.3); // knee snaps backwards
      const knee = _e, ankle = _g;
      const st = ik2(hip, ankleT, D.thigh, D.shin, pole, 1.07, knee, ankle, _f);
      quatYFront(_d.subVectors(knee, hip), _f, _qb);
      this._setBone(o.thigh, hip, _qb, st);
      quatYFront(_d.subVectors(ankle, knee), _f, _qb);
      this._setBone(o.shin, knee, _qb, st);
      // foot from ankle to ball (shifted if the IK could not reach)
      const ball = _d.copy(L.cur).add(_c.subVectors(ankle, ankleT));
      quatYFront(_c.subVectors(ball, ankle), UP, _qb);
      this._setBone(o.foot, ankle, _qb);
      const tp = L.swinging ? 0.5 + 0.4 * Math.sin(Math.PI * Math.min(1, L.t)) : 0.06;
      _c.copy(fdir).multiplyScalar(Math.cos(tp)).addScaledVector(UP, -Math.sin(tp));
      quatYFront(_c, UP, _qb);
      this._setBone(o.toe, ball, _qb);
    }
    {
      const dx = BP.x - this._rootPos.x, dz = BP.z - this._rootPos.z, ry = this._rootYaw, c = Math.cos(ry), sn = Math.sin(ry);
      this.uniforms.uMeltC.value.set(dx * c - dz * sn, dx * sn + dz * c);
    }
  }

  _finitePose() {
    for (let i = 0; i < this.bPos.length; i++) {
      const v = this.bPos[i], q = this.bQ[i];
      if (!Number.isFinite(v.x + v.y + v.z + q.x + q.y + q.z + q.w + this.bS[i] + this.bSX[i])) return false;
    }
    return true;
  }

  _writeBones() {
    for (let i = 0; i < this.bones.length; i++) {
      _scl.set(this.bSX[i], this.bS[i], this.bSX[i]);
      this.bones[i].matrixWorld.compose(this.bPos[i], this.bQ[i], _scl);
    }
  }

  _updateDrips(dt) {
    const rate = (2.0 + this.speed * 0.4 + this.p.attack * 5 + this.p.stun * 2 + this.jaw.open * 1.5) * (1 - this._dissolve);
    this.drips.update(dt, this, rate, this._dissolve < 0.4);
  }
}

export default BacteriaBody;
