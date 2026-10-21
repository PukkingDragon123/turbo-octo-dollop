// R.O.O.M. — the player avatar: a cheap, mass-produced 1990s corporate android clone (same family as
// GLORIA at reception) in a R.O.O.M. work coverall. Yellowed ABS shell with mould seams, scuffs and
// screws, a porcelain face plate with a painted smile, glassy eyes whose LED pupils track you and blink
// a little too slowly, a ventriloquist jaw that clacks when it talks, a gyro-stabilised head, and the
// odd micro-twitch. Geometry is assembled from cached, pre-skinned parts (robot frame + coverall, head
// per eye layout, coverall colourway extras, backpack, hat, face gear, accessory) merged per material
// into a handful of SkinnedMeshes that share one skeleton (robotrig.js).
//
// The android is modelled at 1.70 m and the rig root is scaled by ROBOT_SCALE (0.86) so it fits the
// clone's gameplay dimensions (player.js STAND_HH 0.38 / RADIUS 0.3 capsule = 1.36 m, EYE_STAND 1.16).
// To make clones full-size raise ROBOT_SCALE to 1 together with player.js STAND_HH / EYE_STAND / the
// head-clearance ray, remoteplayer.js collider + flashlight heights, elevator_ride.js EYE and the
// 1.15 / 0.8 eye / chest heights in monsters.js, devicekinds.js and creatures/hound.js.
//
// API (unchanged): new Avatar(cosmetics, { firstPersonHidden }), .root, .update(dt, state),
// .setCosmetics(), .setVisibleFirstPerson(), .getHandAnchor(), .getHeadAnchor(), .getWatchAnchor(),
// .dispose(), .setName(), .empNo, .bones, .cosmetics, .badgeTex.
// state: speed, moveDir (Vector2), grounded, vy, crouch, sprint, pitch, talking, holding, holdTarget,
//   emote 'wave'|'dance'|'point'|'sit'|'sleep', expression 'neutral'|'happy'|'scared'|'hurt'|'sleepy'|
//   'dead'|'shocked'|'laugh', limp, dead; optional lookAt (Vector3, world: the LED pupils / head watch
//   it; by default they watch the camera when it is in front) and table (table-top height above the
//   floor in metres: while sitting the hands rest on it instead of the lap).
// 'sit' = sitting on a chair: hips over the root at a 0.45 m seat, thighs forward (-Z), feet ~0.36 m
// in front of the root.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth, damp, approach, Wobble } from './kit.js';
import { hashString } from '../../core/rng.js';
import { applyProbe } from '../../gfx/bakedlight.js';
import { engine } from '../../core/engine.js';
import { ROBOT_SCALE, RD, RY, BI, BONE_NAMES, makeBones, setBoneRest, restMatrices, RPartBuilder } from './robotrig.js';
import { buildRobotBase, buildRobotHead, badgeDigitsGeo } from './robotbody.js';
import { headKind } from './robothead.js';
import { buildSuitExtras, buildPackPart, buildHatPart, buildVisorPart, buildAccPart } from './robotcos.js';
import { robotMaterial, ROBOT_MAT_FLAGS } from './robotmat.js';
import { Hose } from './gear.js';
import { DM } from './dollmat.js';
import { resolveCos, DEFAULT_COSMETICS } from './dollcos.js';
import { makeMorph, shapeKey } from './robotmorph.js';

const PI = Math.PI, TAU = PI * 2;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();
const S01 = (x) => smooth(clamp(x, 0, 1));
const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------------------
// Part cache
// ---------------------------------------------------------------------------
const PARTS = new Map();
export function getPart(key, build) {
  if (!PARTS.has(key)) {
    const B = build();
    PARTS.set(key, B instanceof RPartBuilder ? B.finish() : B);
  }
  return PARTS.get(key);
}
export function partsFor(cos) {
  return [
    getPart('rbase', buildRobotBase),
    getPart('rhead:' + headKind(cos.faceEntry), () => buildRobotHead(cos.faceEntry)),
    getPart('rsuitx:' + cos.suit, () => buildSuitExtras(cos.suit)),
    getPart('rpack:' + cos.backpack, () => buildPackPart(cos.packEntry)),
    getPart('rhat:' + cos.hat, () => buildHatPart(cos.hatEntry)),
    getPart('rvisor:' + cos.visor, () => buildVisorPart(cos.visorEntry)),
    getPart('racc:' + cos.accessory, () => buildAccPart(cos.accEntry)),
  ];
}
export function cosKey(cos) { const sk = shapeKey(cos); return [cos.suit, headKind(cos.faceEntry), cos.backpack, cos.hat, cos.visor, cos.accessory].join('|') + (sk ? '|' + sk : ''); }

// merged per-material geometry for a cosmetics combination (shared, ref-counted)
const MERGED = new Map();
function acquireMerged(cos) {
  const key = cosKey(cos);
  let e = MERGED.get(key);
  if (!e) {
    const parts = partsFor(cos);
    const by = new Map();
    for (const p of parts) for (const [mat, g] of p.geos) { if (!by.has(mat)) by.set(mat, []); by.get(mat).push(g); }
    let geos = new Map();
    for (const [mat, list] of by) geos.set(mat, list.length === 1 ? list[0] : mergeGeometries(list, false));
    let over = {};
    const springs = {}, info = {};
    for (const p of parts) { Object.assign(over, p.over); Object.assign(springs, p.springs); Object.assign(info, p.info); }
    let owned = new Set(); for (const [mat, list] of by) if (list.length > 1) owned.add(geos.get(mat));
    // body plan (frame / skull / build / eyes): deform a copy of the merged rest geometry
    const mo = makeMorph(cos, over);
    if (mo) {
      const g2 = new Map();
      for (const [mat, g] of geos) g2.set(mat, mo.geo(g, mat));
      for (const g of owned) g.dispose();
      geos = g2; over = mo.over; owned = new Set(g2.values());
    }
    e = { key, geos, over, springs, info, owned, refs: 0, used: 0 };
    MERGED.set(key, e);
    sweepMerged();
  }
  e.refs++;
  e.used = ++_useTick;
  return e;
}
let _useTick = 0;
const MERGED_KEEP = 16;
function sweepMerged() {
  if (MERGED.size <= MERGED_KEEP) return;
  const idle = [...MERGED.values()].filter((e) => e.refs <= 0).sort((a, b) => a.used - b.used);
  for (const e of idle) {
    if (MERGED.size <= MERGED_KEEP) break;
    for (const g of e.owned) g.dispose();
    MERGED.delete(e.key);
  }
}
function releaseMerged(e) {
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) sweepMerged();
}

// ---------------------------------------------------------------------------
// Pose channels (Euler angles per bone), springs and IK
// ---------------------------------------------------------------------------
const CH = { pelvisPos: 0, pelvis: 3, spine: 6, chest: 9, neck: 12, head: 15, shL: 18, elL: 21, wrL: 24, shR: 27, elR: 30, wrR: 33, hipL: 36, knL: 39, anL: 42, hipR: 45, knR: 48, anR: 51, N: 54 };
const set3 = (p, i, x, y, z) => { p[i] = x; p[i + 1] = y; p[i + 2] = z; };
const mix3 = (p, i, x, y, z, w) => { p[i] += (x - p[i]) * w; p[i + 1] += (y - p[i + 1]) * w; p[i + 2] += (z - p[i + 2]) * w; };
const add3 = (p, i, x, y, z) => { p[i] += x; p[i + 1] += y; p[i + 2] += z; };
const SPRING_GROUPS = [
  [CH.pelvis, 3, 260, 0.6], [CH.spine, 3, 220, 0.55], [CH.chest, 3, 190, 0.5], [CH.neck, 3, 160, 0.55], [CH.head, 3, 150, 0.42],
  [CH.shL, 3, 85, 0.36], [CH.shR, 3, 85, 0.36], [CH.elL, 3, 75, 0.34], [CH.elR, 3, 75, 0.34],
  [CH.wrL, 3, 110, 0.4], [CH.wrR, 3, 110, 0.4],
];
const SK = new Float32Array(CH.N), SD = new Float32Array(CH.N);
for (const [i0, n, k, z] of SPRING_GROUPS) for (let i = i0; i < i0 + n; i++) { SK[i] = k; SD[i] = 2 * z * Math.sqrt(k); }

function ik2(rel, a, b, knee, out) {
  const d0 = rel.length();
  const d = clamp(d0, Math.abs(a - b) + 0.01, a + b - 0.0005);
  const t = d0 > 1e-6 ? _v4.copy(rel).divideScalar(d0) : _v4.set(0, -1, 0);
  const pitch = Math.asin(clamp(-t.z, -1, 1));
  const roll = Math.atan2(t.x, -t.y);
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const gamma = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  if (knee) { out[0] = pitch + alpha; out[2] = -(PI - gamma); } else { out[0] = pitch - alpha; out[2] = PI - gamma; }
  out[1] = Math.abs(t.y) < 0.15 && Math.abs(t.x) < 0.15 ? roll * Math.abs(t.y) / 0.15 : roll;
  return out;
}
class Tracker {
  constructor() { this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.a = new THREE.Vector3(); this.has = 0; }
  update(wp, dt) {
    if (dt <= 1e-4) return;
    if (this.has === 0 || wp.distanceToSquared(this.p) > 1) { this.p.copy(wp); this.v.set(0, 0, 0); this.a.set(0, 0, 0); this.has = 1; return; }
    _v4.subVectors(wp, this.p).divideScalar(dt);
    if (this.has === 1) { this.v.copy(_v4); this.p.copy(wp); this.has = 2; return; }
    _v3.subVectors(_v4, this.v).divideScalar(dt).clampLength(0, 40);
    this.a.lerp(_v3, 1 - Math.exp(-28 * dt));
    this.v.copy(_v4); this.p.copy(wp);
  }
}

// robot dance: snap between key poses on the beat [shL, elL, shR, elR (x, z), head yaw, chest yaw]
const DANCE = [
  [0.2, 2.9, 0.2, 1.6, -0.15, 0.25],
  [-0.2, 1.6, -0.2, 2.9, 0.15, -0.25],
  [1.5, -0.3, 1.5, 0.3, 0.0, 0.0],
  [0.1, 1.2, 1.5, -2.2, -0.35, 0.2],
];
// expression targets: lidU, lidD, brow, browRot, jaw, pupil
const EXPR = {
  neutral: [0.8, 0.06, 0, 0, 0, 1],
  happy: [0.74, 0.5, 0.004, -0.06, 0.1, 1.08],
  scared: [1.16, 0.0, 0.008, 0.32, 0.1, 0.52],
  hurt: [0.5, 0.3, 0.004, 0.34, 0.0, 0.85],
  sleepy: [0.3, 0.16, -0.002, 0.04, 0.05, 0.55],
  dead: [0.5, 0.1, 0.0, 0.0, 0.5, 0],
  shocked: [1.22, 0.0, 0.011, 0.06, 0.82, 0.38],
  laugh: [0.62, 0.58, 0.006, -0.1, 0.0, 1.0],
};
const LID_U = 0.88, LID_D = 0.52, JAW_MAX = 0.42;
const LEGS = [{ S: 'L', side: -1, off: 0, hip: CH.hipL, kn: CH.knL, an: CH.anL }, { S: 'R', side: 1, off: 0.5, hip: CH.hipR, kn: CH.knR, an: CH.anR }];
const LIMB_CH = [['hipL', CH.hipL], ['knL', CH.knL], ['anL', CH.anL], ['shL', CH.shL], ['elL', CH.elL], ['wrL', CH.wrL], ['hipR', CH.hipR], ['knR', CH.knR], ['anR', CH.anR], ['shR', CH.shR], ['elR', CH.elR], ['wrR', CH.wrR]];
const SIDES = ['L', 'R'];
const ARM = { L: { s: -1, sh: CH.shL, el: CH.elL, wr: CH.wrL }, R: { s: 1, sh: CH.shR, el: CH.elR, wr: CH.wrR } };

// ---------------------------------------------------------------------------
let _avatarCount = 0;
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.25);

export class Avatar {
  constructor(cosmetics = DEFAULT_COSMETICS, opts = { firstPersonHidden: false }) {
    this.root = new THREE.Group(); this.root.name = 'Avatar';
    this.rigRoot = new THREE.Group(); this.root.add(this.rigRoot);
    this.rigRoot.scale.setScalar(ROBOT_SCALE);
    this.rig = makeBones({});
    this.bones = this.rig.b;
    this.rigRoot.add(this.bones.pelvis);
    this.name = '';
    this._seed = ++_avatarCount * 7919;
    this.empNo = String(1000 + (this._seed % 8999)).padStart(4, '0');
    this.anchors = { right: new THREE.Object3D(), left: new THREE.Object3D(), head: new THREE.Object3D(), watch: new THREE.Object3D() };
    for (const [k, o] of Object.entries(this.anchors)) { o.name = 'anchor_' + k; o.scale.setScalar(1 / ROBOT_SCALE); }
    // hand anchors: palm centre, -Z along the hand's pointing direction (+Y = thumb side)
    this.anchors.right.position.set(0, -0.05, 0); this.anchors.right.rotation.set(-PI / 2, 0, 0);
    this.anchors.left.position.set(0, -0.05, 0); this.anchors.left.rotation.set(-PI / 2, 0, 0);
    this.bones.wrR.add(this.anchors.right); this.bones.wrL.add(this.anchors.left);
    this.bones.head.add(this.anchors.head); this.bones.elL.add(this.anchors.watch);
    this.anchors.head.position.set(0, 0.1, -0.13);
    this.hose = new Hose(DM.hose(), 40, 7, 0.0075);
    this.rigRoot.add(this.hose.mesh);
    this.hoseStart = new THREE.Object3D(); this.hoseEnd = new THREE.Object3D();
    this.fpHidden = !!opts?.firstPersonHidden;
    this.pose = new Float32Array(CH.N);
    this.sx = new Float32Array(CH.N); this.sv = new Float32Array(CH.N); this.F = new Float32Array(CH.N); this._springInit = false;
    this.trk = { pelvis: new Tracker(), chest: new Tracker(), shL: new Tracker(), shR: new Tracker() };
    this.t = Math.random() * 10;
    this._first = true;
    const r0 = hash1(this._seed);
    this.st = {
      speed: 0, mx: 0, my: 1, crouch: 0, sprint: 0, hold: 0, holdT: 0, talk: 0, pitch: 0, air: 0, dead: 0, limp: 0,
      phase: 0, land: 0, landV: 0, emote: { wave: 0, dance: 0, point: 0, sit: 0, sleep: 0 }, laugh: 0,
      wasGrounded: true, lastVy: 0, spin: 0, yaw: 0, yawRate: 0, yawAcc: 0, yawHas: false,
      // face servos
      lidU: [0.8, 0.8], lidD: [0.06, 0.06], brow: [0, 0], browRot: [0, 0], jaw: 0, jawV: 0, pupil: [1, 1], led: 1,
      blinkT: 1.5 + r0 * 3, blink: -1, blinkLag: 0, tremble: 0, tilt: 0, nod: 0,
      eyeYaw: 0, eyePitch: 0, lookYaw: 0, lookPitch: 0, watchW: 0, gazeT: 2, gazeX: 0, gazeY: 0,
      twitchT: 3 + r0 * 5, twitch: 0, twitchK: 0, twitchSide: 0, hurtFlick: 0,
      idleT: 2, idleYaw: 0, idlePitch: 0, shift: 0, shiftX: 0, fing: 0, grip: 0, ix: 0,
      laughT: 0, laughBurst: 0, laughPulse: 0,
    };
    this._ik = [0, 0, 0];
    this._exprT = [0, 0, 0, 0, 0, 0];
    const bb = this.bones;
    this._limbs = LIMB_CH.map(([n, i]) => [bb[n], i]);
    this._hands = ['L', 'R'].map((S) => ({ R: S === 'R', sg: S === 'R' ? -1 : 1, fi: bb['fi' + S], fj: bb['fj' + S], ix: bb['ix' + S], th: bb['th' + S] }));
    this._eyes = ['L', 'R'].map((S, i) => ({ i, sg: S === 'L' ? -1 : 1, eye: bb['eye' + S], led: bb['led' + S], lidU: bb['lidU' + S], lidD: bb['lidD' + S], brow: bb['brow' + S] }));
    this.setCosmetics(cosmetics);
    this.update(0, {});
    this._first = true;   // the caller's first update still snaps (portraits, decorative corpses)
  }

  setCosmetics(c) {
    const cos = resolveCos(c);
    this.cos = cos;
    this.cosmetics = { suit: cos.suit, skin: cos.skin, hat: cos.hat, visor: cos.visor, face: cos.face, backpack: cos.backpack, accessory: cos.accessory, frame: cos.frame, skull: cos.skull, build: cos.build, eyes: cos.eyes };
    this._disposeParts();
    const M = acquireMerged(cos);
    this._merged = M;
    setBoneRest(this.rig, M.over);
    this._resetBones();
    const restM = restMatrices(M.over);
    this._eyeRest = { L: new THREE.Vector3().fromArray(M.over.eyeL?.p || [0, 0, 0]), R: new THREE.Vector3().fromArray(M.over.eyeR?.p || [0, 0, 0]) };
    this.skeleton = new THREE.Skeleton(this.rig.bones, restM.map((m) => m.clone().invert()));
    this.meshes = [];
    for (const [key, geo] of M.geos) {
      let g = geo;
      if (key === 'decal') {
        this._digits = badgeDigitsGeo(this.empNo);
        g = mergeGeometries([geo, this._digits], false);
        this._decalGeo = g;
      }
      this.meshes.push(this._skinned(g, robotMaterial(key, cos), key));
    }
    if (!M.geos.has('decal')) this._decalGeo = null;
    for (const m of this.meshes) this.rigRoot.add(m);
    // pack cable
    const info = M.info;
    this.hoseStart.removeFromParent(); this.hoseEnd.removeFromParent();
    const hs = info.hoseStart, he = info.hoseEnd;
    this.hasHose = !!(hs && he);
    if (this.hasHose) {
      this.bones[hs.bone].add(this.hoseStart); this.hoseStart.position.copy(hs.pos); this.hoseStartDir = hs.dir;
      this.bones[he.bone].add(this.hoseEnd); this.hoseEnd.position.copy(he.pos); this.hoseEndDir = he.dir; this.hoseEndBone = this.bones[he.bone];
    }
    this.hose.has = false;
    this._updateHoseVis();
    if (info.watch) { this.anchors.watch.position.copy(info.watch.pos); this.anchors.watch.rotation.copy(info.watch.rot); }
    this.wobbles = [];
    for (const [bone, cfg] of Object.entries(M.springs)) if (this.bones[bone]) this.wobbles.push(new Wobble(this.bones[bone], cfg));
    this.spinBone = info.spin ? this.bones[info.spin] : null;
    this.haloBone = info.halo ? this.bones[info.halo] : null;
    this.flameBone = info.flames ? this.bones[info.flames] : null;
    this.faceEntry = cos.faceEntry;
    this.cyclops = headKind(cos.faceEntry) === 'cyclops';
    this._springInit = false;
    this._first = true;
    if (this.root.userData.probe) applyProbe(this.root);
  }
  _skinned(geo, mat, key) {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.boundingSphere = BOUNDS.clone();
    const fl = ROBOT_MAT_FLAGS[key] || {};
    mesh.castShadow = fl.shadow !== false && !mat.transparent;
    mesh.receiveShadow = true;
    if (fl.order) mesh.renderOrder = fl.order;
    mesh.name = 'robot_' + key;
    return mesh;
  }
  _resetBones() {
    const R = this.rig;
    for (let i = 0; i < R.bones.length; i++) { const b = R.bones[i]; b.position.copy(R.restP[i]); b.quaternion.copy(R.restQ[i]); b.scale.set(1, 1, 1); }
  }
  _updateHoseVis() { this.hose.mesh.visible = this.hasHose; }
  _disposeParts() {
    if (this.meshes) for (const m of this.meshes) m.removeFromParent();
    if (this._decalGeo) { this._decalGeo.dispose(); this._decalGeo = null; }
    if (this._digits) { this._digits.dispose(); this._digits = null; }
    if (this.skeleton) this.skeleton.dispose();
    releaseMerged(this._merged); this._merged = null;
    this.meshes = null; this.skeleton = null;
  }
  setName(str) {
    this.name = String(str ?? '');
    const num = String(1000 + (hashString(this.name || String(this._seed)) % 8999)).padStart(4, '0');
    if (num !== this.empNo) {
      this.empNo = num;
      if (this._decalGeo && this._digits) {
        const d = badgeDigitsGeo(num), uvA = this._decalGeo.attributes.uv, n = d.attributes.uv.count, off = uvA.count - n;
        for (let i = 0; i < n; i++) uvA.setXY(off + i, d.attributes.uv.getX(i), d.attributes.uv.getY(i));
        uvA.needsUpdate = true; d.dispose();
      }
    }
  }
  get badgeTex() { return DM.decal().map; }
  setVisibleFirstPerson(hidden) {
    this.fpHidden = !!hidden;
    this.bones.head.scale.setScalar(this.fpHidden ? 0.0001 : 1);
  }
  getHandAnchor(side = 'right') { return side === 'left' ? this.anchors.left : this.anchors.right; }
  getHeadAnchor() { return this.anchors.head; }
  getWatchAnchor() { return this.anchors.watch; }
  dispose() {
    this._disposeParts();
    this.hose.mesh.geometry.dispose();
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------------------
  update(dt, s = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    const st = this.st, b = this.bones, p = this.pose;
    const first = this._first; this._first = false;
    this.t += dt;
    const t = this.t;
    this.root.updateWorldMatrix(true, false);

    // ---- motion of the previous pose (secondary motion)
    const tk = this.trk;
    tk.pelvis.update(b.pelvis.getWorldPosition(_v1), dt);
    tk.chest.update(b.chest.getWorldPosition(_v1), dt);
    tk.shL.update(b.shL.getWorldPosition(_v1), dt);
    tk.shR.update(b.shR.getWorldPosition(_v1), dt);
    const cq = b.chest.getWorldQuaternion(_q2).invert();
    const aC = this._aC || (this._aC = new THREE.Vector3()), aL = this._aL || (this._aL = new THREE.Vector3()), aR = this._aR || (this._aR = new THREE.Vector3());
    aC.copy(tk.chest.a).applyQuaternion(cq); aL.copy(tk.shL.a).applyQuaternion(cq); aR.copy(tk.shR.a).applyQuaternion(cq);
    {
      this.root.getWorldQuaternion(_q1);
      _v2.set(0, 0, -1).applyQuaternion(_q1);
      const yaw = Math.atan2(-_v2.x, -_v2.z);
      if (st.yawHas && dt > 1e-4) {
        let d = yaw - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        const rate = clamp(d / dt, -20, 20);
        st.yawAcc = damp(st.yawAcc, clamp((rate - st.yawRate) / dt, -200, 200), 20, dt);
        st.yawRate = rate;
      }
      st.yaw = yaw; st.yawHas = true;
    }

    // ---- inputs (snap on the first update: portraits / decorative corpses get their pose at once)
    const dead = !!s.dead;
    const grounded = s.grounded !== false;
    const vy = s.vy || 0;
    const md = s.moveDir;
    const K = first ? 1e4 : 1;
    let mx = st.mx, my = st.my;
    if (md && (Math.abs(md.x) + Math.abs(md.y)) > 0.01) { const l = Math.hypot(md.x, md.y); mx = md.x / l; my = md.y / l; }
    const D = dt || (first ? 0.016 : 0);
    st.mx = damp(st.mx, mx, 10 * K, D); st.my = damp(st.my, my, 10 * K, D);
    st.speed = damp(st.speed, clamp(s.speed || 0, 0, 8), 9 * K, D);
    st.crouch = damp(st.crouch, clamp(s.crouch || 0, 0, 1), 10 * K, D);
    st.sprint = damp(st.sprint, s.sprint && (s.speed || 0) > 0.5 ? 1 : 0, 5 * K, D);
    st.hold = damp(st.hold, clamp(s.holding || 0, 0, 1), 9 * K, D);
    st.holdT = damp(st.holdT, s.holdTarget ? 1 : 0, 9 * K, D);
    st.talk = damp(st.talk, clamp(s.talking || 0, 0, 1), 20 * K, D);
    st.pitch = damp(st.pitch, clamp(s.pitch || 0, -1.3, 1.3), 14 * K, D);
    st.air = damp(st.air, grounded ? 0 : 1, (grounded ? 16 : 7) * K, D);
    st.limp = damp(st.limp, s.limp ? 1 : 0, 4 * K, D);
    st.dead = first ? (dead ? 1 : 0) : approach(st.dead, dead ? 1 : 0, dt * (dead ? 1.8 : 1.2));
    st.deadFace = dead && (st.deadFace || first || st.dead > 0.3);
    for (const k in st.emote) st.emote[k] = first ? (!dead && s.emote === k ? 1 : 0) : approach(st.emote[k], !dead && s.emote === k ? 1 : 0, dt * 3.5);
    const laughing = !dead && s.expression === 'laugh';
    st.laugh = first ? (laughing ? 1 : 0) : approach(st.laugh, laughing ? 1 : 0, dt * 3);
    if (grounded && !st.wasGrounded && dt > 0) { const imp = clamp(-st.lastVy / 6, 0.2, 1.5); st.landV -= imp * 2.2; }
    st.wasGrounded = grounded; st.lastVy = vy;
    // landing compression (knees give, then servo back)
    st.landV += (-160 * st.land - 14 * st.landV) * dt; st.land = clamp(st.land + st.landV * dt, -0.35, 0.05);

    this._faceTargets(dt, s, st, t, first);

    // ---- gait: brisk, slightly too even human walk; a stiff-armed run when sprinting
    const walk = smooth(clamp(st.speed / 0.5, 0, 1)) * (1 - st.air);
    const strideW = lerp(1.45, 2.3, st.sprint) * lerp(1, 0.72, st.crouch);
    let freq = clamp(st.speed / strideW, 0, lerp(2.15, 2.7, st.sprint));
    if (st.emote.dance > 0.01) freq = lerp(freq, 1.05, st.emote.dance);
    let rate = 1;
    if (st.limp > 0.01) { const pp = st.phase % 1; rate = lerp(1, pp < 0.5 ? 1.7 : 0.72, st.limp); }
    st.phase = (st.phase + freq * rate * dt) % 1;
    const ph = st.phase * TAU;
    const sp = st.sprint * walk;
    const idle = (1 - walk) * (1 - st.air);
    const half = Math.min(freq > 0.3 ? st.speed * 0.5 / freq / ROBOT_SCALE : 0, lerp(0.68, 0.95, st.sprint) * lerp(1, 0.75, st.crouch));
    const E = st.emote, sitW = Math.max(E.sit, E.sleep);

    p.fill(0);
    const bob = walk * (0.018 + 0.04 * sp) * (0.5 - 0.5 * Math.cos(2 * ph));
    let py = RD.hipY - st.crouch * 0.4 + bob - walk * (0.015 + 0.03 * sp) + st.land * 0.6;
    py -= st.limp * walk * 0.035 * Math.max(0, Math.sin(ph));
    set3(p, CH.pelvisPos, walk * 0.01 * Math.sin(ph), py, st.crouch * 0.06);
    const twist = -walk * (0.13 + 0.05 * sp) * Math.cos(ph), roll = walk * 0.045 * Math.sin(ph) + st.limp * walk * 0.08 * Math.max(0, Math.sin(ph));
    set3(p, CH.pelvis, -(0.03 * walk + 0.16 * sp) - st.crouch * 0.3 + st.land * 0.3 + st.air * (vy > 0 ? -0.06 : 0.1), twist, roll);
    // idle life: glance around / shift weight now and then, perfectly still in between
    st.idleT -= dt;
    if (st.idleT <= 0) { st.idleT = 3 + Math.random() * 5; st.idleYaw = idle > 0.8 && !st.talk ? (Math.random() - 0.5) * 0.9 : 0; st.idlePitch = (Math.random() - 0.45) * 0.22; st.shift = (Math.random() - 0.5) * 2; }
    st.shiftX = approach(st.shiftX, st.shift * idle, dt * 0.6);
    set3(p, CH.spine, -0.02 * walk - 0.06 * sp - st.crouch * 0.15 + st.land * 0.3, -twist * 0.45, -roll * 0.5);
    set3(p, CH.chest, -0.02 * sp - st.crouch * 0.1, -twist * 0.5, -roll * 0.3);
    p[CH.pelvis + 2] += st.shiftX * 0.035; p[CH.pelvisPos] += st.shiftX * 0.018; p[CH.spine + 2] -= st.shiftX * 0.04;
    // arms: stiff swing opposite the legs, elbows locked at a fixed bend
    const swing = walk * (0.38 + 0.5 * sp) * lerp(1, 0.4, st.crouch);
    const c = Math.cos(ph);
    const splay = 0.1 + st.air * (0.6 + 0.25 * Math.sin(t * 7)) + st.crouch * 0.12 + Math.abs(st.yawRate) * 0.03;
    set3(p, CH.shL, -swing * c + st.crouch * 0.35, 0, -splay);
    set3(p, CH.shR, swing * c + st.crouch * 0.35, 0, splay);
    set3(p, CH.elL, 0.16 + sp * 1.25 + st.air * 0.35 + st.crouch * 0.4, 0, 0);
    set3(p, CH.elR, 0.16 + sp * 1.25 + st.air * 0.35 + st.crouch * 0.4, 0, 0);
    if (E.wave > 0.001) this._emoteWave(p, E.wave, t);
    if (E.dance > 0.001) this._emoteDance(p, E.dance, t);
    if (E.point > 0.001) this._emotePoint(p, E.point);
    if (E.sit > 0.001) this._emoteSit(p, E.sit, t, s);
    if (E.sleep > 0.001) this._emoteSleep(p, E.sleep, t);
    if (st.laugh > 0.001) this._laughBody(p, st.laugh, st);
    // legs last: IK from wherever the emotes put the pelvis
    this._legs(p, st, walk, half, vy, t, sitW, s);
    if (st.dead > 0.001) this._poseDead(p, st.dead);

    // ---- head: gyro-stabilised (cancels the body's sway) + pitch + where it looks
    {
      const parY = p[CH.pelvis + 1] + p[CH.spine + 1] + p[CH.chest + 1], parZ = p[CH.pelvis + 2] + p[CH.spine + 2] + p[CH.chest + 2];
      const parX = p[CH.pelvis] + p[CH.spine] + p[CH.chest];
      const stab = (1 - st.dead) * (1 - E.dance * 0.6) * (1 - E.sleep);
      const lookPitch = st.pitch * 0.62 + st.nod + st.idlePitch * idle * 0.6 + st.lookPitch;
      set3(p, CH.neck, (lookPitch - parX * stab) * 0.35, (-st.lookYaw + st.idleYaw * idle * 0.7 - parY * stab) * 0.35, -parZ * stab * 0.3);
      set3(p, CH.head, (lookPitch - parX * stab) * 0.65, (-st.lookYaw + st.idleYaw * idle * 0.7 - parY * stab) * 0.65, st.tilt - parZ * stab * 0.7);
      if (E.wave > 0.001) add3(p, CH.head, 0.04 * E.wave, -0.1 * E.wave, -0.18 * E.wave);
      if (E.point > 0.001) add3(p, CH.head, 0, 0.08 * E.point, 0);
      if (E.sleep > 0.001) mix3(p, CH.head, -0.5, 0.12, 0.32, E.sleep);
      if (st.laugh > 0.001) add3(p, CH.head, (0.34 + st.laughPulse * 0.12) * st.laugh, 0, 0.07 * Math.sin(t * 2.3) * st.laugh);
      if (st.dead > 0.001) { const k = 1 - Math.pow(1 - st.dead, 3); mix3(p, CH.head, 0.25, 0.4, -0.3, k); mix3(p, CH.neck, 0.1, 0.1, -0.1, k); }
    }

    // ---- holding / reaching (IK targets in chest space)
    const holdW = Math.max(st.hold, st.holdT) * (1 - st.dead) * (1 - sitW * 0.5);
    if (holdW > 0.001) {
      b.chest.updateWorldMatrix(true, false);
      const tR = _v1.set(0.13, 0.04, -0.36);
      if (s.holdTarget && st.holdT > 0.001) { _v2.copy(s.holdTarget); b.chest.worldToLocal(_v2); tR.lerp(_v2, st.holdT); }
      tR.y += Math.sin(ph * 2) * 0.012 * walk;
      this._armIK('R', tR, holdW, p);
      const tL = _v1.set(-0.13, 0.04, -0.36 + (s.holdTarget ? 0.08 : 0));
      tL.y += Math.sin(ph * 2 + 1) * 0.012 * walk;
      this._armIK('L', tL, st.hold * (1 - st.dead) * (1 - sitW * 0.5), p);
    }

    // ---- springs (+ acceleration forcing) — stiffer than flesh, a little overshoot
    const F = this.F; F.fill(0);
    const gA = 0.012, gV = 0.008, gE = 0.009, gH = 0.004, gC = 0.002;
    const deadK = 1 - st.dead * 0.7;
    F[CH.shL] = SK[CH.shL] * gA * aL.z; F[CH.shR] = SK[CH.shR] * gA * aR.z;
    F[CH.shL + 2] = SK[CH.shL] * (-gA * aL.x + gV * aL.y); F[CH.shR + 2] = SK[CH.shR] * (-gA * aR.x - gV * aR.y);
    F[CH.elL] = SK[CH.elL] * gE * aL.z; F[CH.elR] = SK[CH.elR] * gE * aR.z;
    F[CH.head] = -SK[CH.head] * gH * aC.z; F[CH.head + 2] = SK[CH.head] * gH * aC.x; F[CH.head + 1] = -SK[CH.head] * 0.006 * st.yawAcc;
    F[CH.chest] = -SK[CH.chest] * gC * aC.z; F[CH.chest + 2] = SK[CH.chest] * gC * aC.x;
    const X = this.sx, Vv = this.sv;
    if (!this._springInit || first) { X.set(p); Vv.fill(0); this._springInit = true; }
    // micro-twitch: a sharp jolt straight into the head / shoulder springs
    if (st.twitchK === 1 && st.twitch > 0.9) { Vv[CH.head + 1] += (st.twitchSide - 0.5) * 7; Vv[CH.head] += 3; Vv[CH.neck + 2] += (st.twitchSide - 0.5) * 3; st.twitch = 0.89; }
    if (st.twitchK === 5 && st.twitch > 0.9) { Vv[CH.shL + 2] -= 3; Vv[CH.shR + 2] += 3; st.twitch = 0.89; }
    const nSub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / nSub;
    if (dt > 0) for (let k = 0; k < nSub; k++) {
      for (let i = 0; i < CH.N; i++) {
        if (SK[i] === 0) continue;
        const kk = SK[i] * deadK + (1 - deadK) * 300;
        Vv[i] += (kk * (p[i] - X[i]) - SD[i] * Vv[i] + F[i] * deadK) * h;
        X[i] += Vv[i] * h;
      }
    }
    for (let i = 0; i < CH.N; i++) if (SK[i] === 0) X[i] = p[i];

    // ---- apply to bones
    this._resetBones();
    b.pelvis.position.set(X[CH.pelvisPos], X[CH.pelvisPos + 1], X[CH.pelvisPos + 2]);
    b.pelvis.rotation.set(X[CH.pelvis], X[CH.pelvis + 1], X[CH.pelvis + 2]);
    b.spine.rotation.set(X[CH.spine], X[CH.spine + 1], X[CH.spine + 2]);
    b.chest.rotation.set(X[CH.chest], X[CH.chest + 1], X[CH.chest + 2]);
    b.neck.rotation.set(X[CH.neck], X[CH.neck + 1], X[CH.neck + 2]);
    b.head.rotation.set(X[CH.head], X[CH.head + 1], X[CH.head + 2]);
    for (let k = 0, L = this._limbs; k < L.length; k++) { const i = L[k][1]; L[k][0].rotation.set(X[i], X[i + 1], X[i + 2]); }
    // shoulders jerk up with each laugh pulse
    if (st.laugh > 0.001) {
      const k = st.laughPulse * st.laugh, up = k * 0.022;
      b.shL.position.y += up; b.shR.position.y += up * 0.85;
      b.chest.rotation.x -= k * 0.05; b.head.rotation.x += k * 0.07;   // unsprung: a hard, stuttering jerk
    }
    // hands: relaxed curl, grip around held things, point with the index finger
    const point = E.point;
    st.grip = damp(st.grip, clamp(Math.max(st.hold, st.holdT) * (1 - point), 0, 1), 12, D);
    st.ix = damp(st.ix, point > 0.5 ? 1 : 0, 14, D);
    const relax = 0.28 + st.dead * 0.2 + (st.twitchK === 6 ? st.twitch * 0.6 : 0);
    for (let hk = 0; hk < 2; hk++) {
      const H = this._hands[hk];
      const sg = H.sg, g = H.R ? st.grip : st.hold;
      const cu = relax + g * 0.95 + (H.R ? point * 0.9 : 0);
      H.fi.rotation.z = sg * cu; H.fj.rotation.z = sg * cu * 0.9;
      H.ix.rotation.z = sg * (H.R ? lerp(relax + g * 0.85, -0.05, st.ix) : relax + g * 0.85);
      H.th.rotation.z = sg * (g * 0.4);
      H.th.rotation.x = -g * 0.35;
    }

    this._faceApply(dt, st, t);
    if (this.fpHidden) b.head.scale.setScalar(0.0001);
    // optional external pose pass (menu puppeteering: hanging on a hook, falling) — bones are final after it
    if (s.poseFn) s.poseFn(b, dt, this);

    if (this.spinBone) { st.spin += dt * (4 + st.speed * 9 + st.air * 20); this.spinBone.rotation.y = st.spin; }
    if (this.haloBone) { this.haloBone.position.y += Math.sin(t * 2.2) * 0.012; this.haloBone.rotation.y = t * 0.6; }
    if (this.flameBone) { const f = (0.35 + st.air * 0.9 + st.sprint * 0.3) * (1 - st.dead) * (0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31)); this.flameBone.scale.set(1, Math.max(0.001, f), 1); }

    this.rigRoot.updateMatrixWorld(true);
    for (let k = 0; k < this.wobbles.length; k++) this.wobbles[k].update(dt);

    if (this.hose.mesh.visible) {
      this.hoseStart.parent.updateMatrixWorld(true);
      this.hoseEnd.parent.updateMatrixWorld(true);
      const p0 = this.hoseStart.getWorldPosition(_v1), p3 = this.hoseEnd.getWorldPosition(_v2);
      const t0 = _v3.copy(this.hoseStartDir).transformDirection(this.hoseStart.parent.matrixWorld);
      const t3 = _v4.copy(this.hoseEndDir).transformDirection(this.hoseEnd.parent.matrixWorld);
      this.rigRoot.worldToLocal(p0); this.rigRoot.worldToLocal(p3);
      _m1.copy(this.rigRoot.matrixWorld).invert();
      t0.transformDirection(_m1); t3.transformDirection(_m1);
      this.hose.update(dt, p0, t0, p3, t3);
    }
  }

  _legs(p, st, walk, half, vy, t, sitW, s) {
    const inv = _q2.setFromEuler(_e1.set(p[CH.pelvis], p[CH.pelvis + 1], p[CH.pelvis + 2], 'ZXY')).invert();
    const dance = st.emote.dance, sit = st.emote.sit, sleep = st.emote.sleep;
    for (const L of LEGS) {
      const S = L.S, side = L.side, off = L.off;
      const pp = (st.phase + off) % 1;
      let f, lift;
      // stance 0..0.55, swing 0.55..1
      if (pp < 0.55) { f = lerp(0.5, -0.5, pp / 0.55); lift = 0; } else { const u = (pp - 0.55) / 0.45; f = lerp(-0.5, 0.5, smooth(u)); lift = Math.sin(u * PI); }
      const lim = S === 'L' ? 1 - st.limp * 0.5 : 1;
      const travel = f * half * walk * lim;
      const stepLift = Math.max(walk, dance) * lift * (0.075 + 0.11 * st.sprint) * (S === 'L' ? 1 - st.limp * 0.6 : 1);
      let fx = side * RD.hipX * (1.0 + st.crouch * 0.4) + st.mx * travel;
      let fz = -st.my * travel, fy = RD.ankleH + stepLift;
      if (st.air > 0.001) { fy += st.air * (0.1 + 0.04 * Math.sin(t * 9 + off * 6)) + side * 0.0; fz -= st.air * (side * 0.04 + 0.03); }
      // chair sit: feet planted in front of the seat; floor sit (sleep): legs out in front
      if (sitW > 0.001) {
        const a = sit / Math.max(1e-4, sit + sleep);
        fx = lerp(fx, side * (RD.hipX * 1.25 + 0.05 * (1 - a)), sitW);
        fy = lerp(fy, RD.ankleH, sitW);
        fz = lerp(fz, lerp(-0.66, -0.42, a), sitW);
      }
      _v1.set(fx - p[CH.pelvisPos], fy - p[CH.pelvisPos + 1], fz - p[CH.pelvisPos + 2]).applyQuaternion(inv);
      _v1.x -= side * RD.hipX;
      const r = ik2(_v1, RD.thigh, RD.shin, true, this._ik);
      set3(p, L.hip, r[0], 0, r[1]);
      set3(p, L.kn, r[2], 0, 0);
      const toe = lift * 0.4 * walk - (pp < 0.55 ? smooth(clamp((pp - 0.35) / 0.2, 0, 1)) * 0.22 * walk : 0);
      set3(p, L.an, -(r[0] + r[2]) - p[CH.pelvis] + toe + st.air * 0.35 - sleep * 0.4, 0, -r[1] - p[CH.pelvis + 2]);
      void S;
    }
    void s; void vy;
  }
  _armIK(S, target, w, p) {
    const A = ARM[S];
    _v3.copy(target).sub(_v2.set(A.s * RD.shX, RD.shY, 0));
    const r = ik2(_v3, RD.upper, RD.fore + RD.palm * 0.8, false, this._ik);
    mix3(p, A.sh, r[0], 0, r[1], w);
    mix3(p, A.el, r[2], 0, 0, w);
    mix3(p, A.wr, 0.1, 0, 0, w);
  }
  _emoteWave(p, w, t) {
    // metronome-regular wave with a servo hitch at each end of the swing
    const ph = Math.sin(t * 7.4), q = Math.sign(ph) * Math.pow(Math.abs(ph), 0.55);
    mix3(p, CH.shR, 0.1, 0, 2.55, w);
    mix3(p, CH.elR, 0.15, 0, 0.55 * q, w);
    mix3(p, CH.wrR, 0, 0, 0.25 * q, w);
    add3(p, CH.chest, 0, -0.06 * w, -0.05 * w);
    mix3(p, CH.shL, 0.04, 0, -0.12, w);
  }
  _emoteDance(p, w, t) {
    const beat = t * 2.1, k = Math.floor(beat), f = beat - k;
    const A = DANCE[((k % 4) + 4) % 4], Bp = DANCE[(((k - 1) % 4) + 4) % 4];
    const sn = S01(f / 0.14);          // snap to the new pose, then hold dead still
    const lp = (i) => lerp(Bp[i], A[i], sn);
    p[CH.pelvisPos + 1] += (Math.abs(Math.sin(beat * PI)) * 0.03 - 0.025) * w;
    mix3(p, CH.shL, lp(0) * (lp(0) > 1 ? 1 : 0.6), 0, -lp(1) * 0.85, w);
    mix3(p, CH.elL, 1.4, 0, -0.1, w);
    mix3(p, CH.shR, lp(2) * (lp(2) > 1 ? 1 : 0.6), 0, lp(3) * 0.85, w);
    mix3(p, CH.elR, 1.4, 0, 0.1, w);
    mix3(p, CH.wrL, 0, 0, -0.3, w); mix3(p, CH.wrR, 0, 0, 0.3, w);
    add3(p, CH.chest, 0, lp(5) * w, 0);
    add3(p, CH.head, 0, lp(4) * w, 0);
    p[CH.pelvis + 2] += Math.sin(beat * PI) * 0.06 * w;
  }
  _emotePoint(p, w) {
    mix3(p, CH.shR, 1.45 + this.st.pitch * 0.7, 0, 0.1, w);
    mix3(p, CH.elR, 0.04, 0, 0, w);
    mix3(p, CH.wrR, 0, 0, 0, w);
    add3(p, CH.chest, 0, -0.16 * w, 0);
    mix3(p, CH.shL, -0.05, 0, -0.12, w);
  }
  _emoteSit(p, w, t, s) {
    // on a chair: hips at seat height over the root, back straight (too straight), hands on the lap or the table
    const seat = 0.45 / ROBOT_SCALE + 0.09;
    mix3(p, CH.pelvisPos, 0, seat, 0, w);
    mix3(p, CH.pelvis, 0.02, 0, 0, w);
    mix3(p, CH.spine, 0, 0, 0, w);
    mix3(p, CH.chest, -0.02, p[CH.chest + 1], 0, w);
    const table = s.table != null ? +s.table : null;
    for (const S of SIDES) {
      const A = ARM[S];
      if (table != null) {
        // hands resting on the table top in front of the chest (table = top height above the floor, m)
        _v1.set(A.s * 0.165, table / ROBOT_SCALE + 0.03 - (seat + RD.spineY + RD.chestY), -0.5);
        this._armIK(S, _v1, w, p);
        p[A.el + 1] += (A.s * 1.45 - p[A.el + 1]) * w;   // forearms pronated: palms flat on the table
        mix3(p, A.wr, 0.0, 0, 0, w);
      } else {
        mix3(p, A.sh, 0.22, 0, A.s * 0.08, w);
        mix3(p, A.el, 0.78, A.s * 1.2, A.s * 0.05, w);
        mix3(p, A.wr, -0.15, 0, 0, w);
      }
    }
    void t;
  }
  _emoteSleep(p, w, t) {
    // powered down on the floor: slumped, legs out, arms dropped
    const br = Math.sin(t * 0.9);
    mix3(p, CH.pelvisPos, 0, 0.15, 0.1, w);
    mix3(p, CH.pelvis, 0.12, 0, 0, w);
    mix3(p, CH.spine, -0.32, 0, 0.06, w);
    mix3(p, CH.chest, -0.2 + br * 0.004, 0, 0.05, w);
    for (const S of SIDES) {
      const A = ARM[S];
      mix3(p, A.sh, 0.35, 0, A.s * 0.12, w);
      mix3(p, A.el, 0.35, 0, 0, w);
    }
  }
  _laughBody(p, w, st) {
    // jerky shoulders and chest on every "ha", head thrown back (see the head block)
    const k = st.laughPulse * w;
    add3(p, CH.chest, 0.06 * w - 0.08 * k, 0, 0);
    add3(p, CH.spine, 0.04 * w, 0, 0);
    add3(p, CH.shL, 0.05 * k, 0, -0.1 * k); add3(p, CH.shR, 0.05 * k, 0, 0.1 * k);
    add3(p, CH.elL, 0.12 * k, 0, 0); add3(p, CH.elR, 0.12 * k, 0, 0);
  }
  _poseDead(p, w) {
    const k = 1 - Math.pow(1 - w, 3);
    mix3(p, CH.pelvisPos, 0.15, 0.13, 0.0, k);
    mix3(p, CH.pelvis, 0.1, 0.3, -1.52, k);
    mix3(p, CH.spine, 0.12, 0, 0.08, k);
    mix3(p, CH.chest, 0.15, 0, 0.1, k);
    mix3(p, CH.shL, 1.15, 0, -0.25, k); mix3(p, CH.elL, 0.55, 0, -0.1, k); mix3(p, CH.wrL, 0.3, 0, 0, k);
    mix3(p, CH.shR, 0.7, 0, 0.55, k); mix3(p, CH.elR, 0.4, 0, 0.1, k);
    mix3(p, CH.hipL, 0.6, 0, -0.2, k); mix3(p, CH.knL, -0.9, 0, 0, k); mix3(p, CH.anL, 0.3, 0, 0, k);
    mix3(p, CH.hipR, -0.15, 0, 0.08, k); mix3(p, CH.knR, -0.3, 0, 0, k); mix3(p, CH.anR, 0.15, 0, 0, k);
  }

  // ---- face servos ----------------------------------------------------------------------
  _faceTargets(dt, s, st, t, first) {
    const f = this.faceEntry || {};
    const dead = st.dead > 0.3 || st.deadFace;
    let expr = dead ? 'dead' : (s.expression || 'neutral');
    if (!dead && st.emote.sleep > 0.5) expr = 'sleepy';
    if (!EXPR[expr]) expr = 'neutral';
    const T = this._exprT, X = EXPR[expr];
    for (let i = 0; i < 6; i++) T[i] = X[i];
    // the face cosmetic biases the resting lids / brows
    if (f.eyeSY != null && (expr === 'neutral' || expr === 'happy')) T[0] = Math.min(T[0], 0.35 + f.eyeSY * 0.6);
    if (f.brow) T[2] += f.brow * 0.5;
    if (f.browRot) T[3] += f.browRot * 0.6;
    if ((st.emote.dance > 0.5 || st.emote.wave > 0.5) && expr === 'neutral') { T[1] = 0.45; T[4] = 0.12; }
    let jawT = T[4] * JAW_MAX, tremble = expr === 'scared' ? 1 : expr === 'hurt' ? 0.35 : 0;
    // talking: the jaw clacks open and shut like a ventriloquist dummy's
    if (!dead && expr !== 'sleepy' && st.talk > 0.08) {
      const syl = clamp(Math.sin(t * 12.5 + 1.7 * Math.sin(t * 3.3)) * 1.4 + 0.2, 0, 1);
      jawT = Math.max(jawT, st.talk * (0.18 + 0.82 * syl) * JAW_MAX * 0.85);
      T[2] += Math.max(0, Math.sin(t * 5.3)) * 0.002 * st.talk;
    }
    // laughing: stuttering "ha-ha-ha" bursts with glitchy pauses
    st.laughPulse = 0;
    if (st.laugh > 0.01 && !dead) {
      st.laughT -= dt;
      if (st.laughT <= 0) { st.laughBurst = st.laughBurst > 0 ? 0 : 1; st.laughT = st.laughBurst ? 0.9 + Math.random() * 1.1 : 0.18 + Math.random() * 0.45; }
      const hz = 7.2, ph = (t * hz) % 1;
      const pulse = st.laughBurst ? (ph < 0.45 ? 1 : 0) : 0;
      // occasionally a "ha" double-hits (servo stutter)
      const stutter = st.laughBurst && hash1(Math.floor(t * hz) + this._seed) > 0.82 ? (ph > 0.6 && ph < 0.8 ? 1 : 0) : 0;
      st.laughPulse = Math.max(pulse, stutter * 0.7);
      jawT = Math.max(jawT, st.laugh * (0.25 + 0.75 * st.laughPulse) * JAW_MAX * (st.laughBurst ? 1 : 0.35));
    }
    // blink: slow close, hold, slower open; the second eye lags a frame or two
    st.blinkT -= dt;
    if (st.blinkT <= 0 && !dead) {
      st.blink = 0; st.blinkLag = Math.random() < 0.35 ? 0.05 + Math.random() * 0.05 : 0.012;
      st.blinkT = (expr === 'sleepy' ? 1.6 : 2.6) + Math.random() * 4;
      if (Math.random() < 0.12) st.blinkT = 0.6;   // double blink
    }
    let blL = 0, blR = 0;
    if (st.blink >= 0) {
      st.blink += dt;
      const bl = (u) => (u < 0 ? 0 : u < 0.17 ? S01(u / 0.17) : u < 0.27 ? 1 : u < 0.68 ? 1 - S01((u - 0.27) / 0.41) : 0);
      blL = bl(st.blink); blR = bl(st.blink - st.blinkLag);
      if (st.blink > 0.8) st.blink = -1;
    }
    // micro-twitch: a jolt of the head, one lid, a brow, the jaw, an LED or the fingers
    st.twitchT -= dt;
    if (st.twitchT <= 0 && !dead) { st.twitchT = 3.5 + Math.random() * 7; st.twitch = 1; st.twitchK = 1 + Math.floor(Math.random() * 6); st.twitchSide = Math.random(); }
    st.twitch = Math.max(0, st.twitch - dt * 5);
    const tw = st.twitch > 0 ? st.twitch : 0;
    const twL = st.twitchSide < 0.5;
    // eye target: LED pupils follow whoever is looking (the camera), or the given point, else drift
    let wantYaw = 0, wantPitch = 0, track = 0;
    if (!first && !dead && !this.fpHidden && expr !== 'sleepy') {
      const tgt = s.lookAt || this._viewerPos();
      if (tgt) {
        const hb = this.bones.head;
        hb.updateWorldMatrix(true, false);
        _m1.copy(hb.matrixWorld).invert();
        _v3.copy(tgt).applyMatrix4(_m1);
        const ex = _v3.x, ey = _v3.y - 0.1, ez = _v3.z + 0.1;
        const d = Math.hypot(ex, ey, ez);
        const yaw = Math.atan2(ex, -ez), pitch = Math.atan2(ey, Math.hypot(ex, ez));
        if ((s.lookAt || d < 7 / ROBOT_SCALE) && ez < 0 && Math.abs(yaw) < 1.35) { wantYaw = yaw; wantPitch = pitch; track = 1; }
      }
    }
    st.gazeT -= dt;
    if (st.gazeT <= 0) { st.gazeT = 1.5 + Math.random() * 3; st.gazeX = (Math.random() - 0.5) * 0.5; st.gazeY = (Math.random() - 0.5) * 0.2; }
    if (!track) { wantYaw = st.gazeX; wantPitch = st.gazeY; }
    // eyes: servo at a constant, slightly-too-slow rate; the head follows a viewer while idle
    const eyeYaw = clamp(wantYaw - st.lookYaw, -0.42, 0.42), eyePitch = clamp(wantPitch - st.lookPitch * 0.8, -0.3, 0.3);
    const er = first ? 100 : 1.6;
    st.eyeYaw = approach(st.eyeYaw, eyeYaw, er * dt); st.eyePitch = approach(st.eyePitch, eyePitch, er * dt);
    const idleK = clamp(1 - st.speed / 0.6, 0, 1) * (1 - st.emote.dance) * (1 - st.emote.sit * 0.3);
    st.watchW = approach(st.watchW, track * idleK, dt * 0.6);
    st.lookYaw = approach(st.lookYaw, clamp(wantYaw, -0.55, 0.55) * 0.6 * st.watchW, dt * 0.45);
    st.lookPitch = approach(st.lookPitch, clamp(wantPitch, -0.3, 0.3) * 0.5 * st.watchW, dt * 0.3);
    // lids / brows / jaw / pupils
    const k = first ? 1e4 : 9, Dt = first ? 1 : dt;
    const hurtL = expr === 'hurt' ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      const isL = i === 0;
      let u = T[0], dn = T[1];
      if (hurtL && isL) { u = 0.25; dn = 0.45; }
      if (expr === 'dead') u = isL ? 0.38 : 0.62;
      if (st.twitchK === 2 && (isL === twL)) u -= tw * 0.6;
      const bl = isL ? blL : blR;
      u = lerp(u, -0.02, bl); dn = lerp(dn, 0.25, bl);
      st.lidU[i] = damp(st.lidU[i], u, bl > 0 ? 40 : k, Dt);
      st.lidD[i] = damp(st.lidD[i], dn, bl > 0 ? 40 : k, Dt);
      let br = T[2], brr = T[3];
      if (st.twitchK === 3 && isL === twL) br += tw * 0.006;
      st.brow[i] = damp(st.brow[i], br, k, Dt);
      st.browRot[i] = damp(st.browRot[i], brr, k, Dt);
      let pu = T[5];
      if (expr === 'scared') pu *= 0.85 + 0.3 * Math.sin(t * 23 + i);
      if (expr === 'hurt' && isL) pu *= hash1(Math.floor(t * 9)) > 0.3 ? 1 : 0;
      if (st.twitchK === 4 && tw > 0.3 && Math.sin(tw * 40) > 0) pu = 0;
      if (f.eyes === 'mismatch' && !isL) pu *= 0.75 + 0.35 * (hash1(Math.floor(t * 4)) > 0.85 ? 0 : 1);
      st.pupil[i] = first ? pu : approach(st.pupil[i], pu, dt * (pu === 0 ? 30 : 4));
    }
    if (st.twitchK === 3 && tw > 0) jawT += tw * 0.1;
    st.jaw = first ? jawT : approach(st.jaw, jawT, dt * (jawT > st.jaw ? 6.5 : 4.5));
    st.tremble = damp(st.tremble, tremble, 6, dt);
    let tilt = 0, nod = 0;
    if (expr === 'happy') tilt = Math.sin(t * 2.6) * 0.07;
    else if (expr === 'hurt') tilt = 0.12;
    else if (expr === 'sleepy') { nod = -0.15 + Math.sin(t * 0.7) * 0.05; tilt = 0.1; }
    else if (expr === 'shocked') nod = 0.1;
    else if (expr === 'scared') nod = -0.08;
    if (!dead && st.talk > 0.08) nod += Math.sin(t * 6.5) * 0.025 * st.talk;
    st.tilt = damp(st.tilt, tilt, first ? 1e4 : 5, Dt);
    st.nod = damp(st.nod, nod, first ? 1e4 : 5, Dt);
  }
  _viewerPos() {
    const cam = engine.view?.camera || engine.camera;
    if (!cam) return null;
    if (!this._camPos) this._camPos = new THREE.Vector3();
    return cam.getWorldPosition(this._camPos);
  }
  _faceApply(dt, st, t) {
    const b = this.bones;
    const tr = st.tremble * 0.006;
    if (tr) { b.head.rotation.x += (Math.random() - 0.5) * tr * 3; b.head.rotation.z += (Math.random() - 0.5) * tr * 3; }
    // servo micro-jitter while scared / hurt (eyes hunt around their target)
    const jit = st.tremble * 0.03;
    for (let ek = 0; ek < 2; ek++) {
      const Y = this._eyes[ek];
      const i = Y.i;
      Y.eye.rotation.y = -st.eyeYaw + (jit ? (Math.random() - 0.5) * jit : 0);
      Y.eye.rotation.x = st.eyePitch + (jit ? (Math.random() - 0.5) * jit : 0);
      Y.lidU.rotation.x = -(1 - st.lidU[i]) * LID_U + st.eyePitch * 0.25;
      Y.lidD.rotation.x = st.lidD[i] * LID_D + st.eyePitch * 0.15;
      Y.brow.position.y += st.brow[i];
      Y.brow.rotation.z = -Y.sg * st.browRot[i];
      const pu = Math.max(0.0001, st.pupil[i]);
      Y.led.scale.set(pu, pu, 1);
    }
    if (this.cyclops) { b.ledR.scale.setScalar(0.0001); }
    b.jaw.rotation.x = -st.jaw;
    void dt; void t;
  }
}
export { BONE_NAMES, RY as Y, BI };
