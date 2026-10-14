// R.O.O.M. — the player avatar: a chubby PEAK-style sack doll in the classic Backrooms hazmat
// suit. Geometry is assembled from cached, pre-skinned parts (suit base, face beads, kit, suit
// colourway extras, backpack, hat, face gear, accessory) merged per material into a handful of
// SkinnedMeshes that share one skeleton; the face threads live in a small dynamic mesh.
//
// API (unchanged from the previous avatar): new Avatar(cosmetics, { firstPersonHidden }), .root,
// .update(dt, state), .setCosmetics(), .setVisibleFirstPerson(), .getHandAnchor(), .dispose(),
// .setName(), .empNo, .bones, .cosmetics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth, damp, approach, Spring, Wobble } from './kit.js';
import { hashString } from '../../core/rng.js';
import { applyProbe } from '../../gfx/bakedlight.js';
import { DIM, Y, BI, BONE_NAMES, makeBones, setBoneRest, restMatrices, PartBuilder, torsoW, W } from './dollrig.js';
import { SACK, FACE } from './sack.js';
import { buildSuitBase } from './suit.js';
import { FaceRig, faceRests, beadGeo, buttonGeo, eyeRadius, mouthParams } from './face.js';
import { buildBadge, buildPatch, buildWatch, buildHoodStencil, badgeDigitsGeo, Hose } from './gear.js';
import { dollMaterial, MAT_FLAGS, DM } from './dollmat.js';
import { resolveCos, DEFAULT_COSMETICS } from './dollcos.js';
import { buildPackPart, buildHatPart, buildVisorPart, buildAccPart, buildSuitExtras } from './cosm.js';

const PI = Math.PI, TAU = PI * 2;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();

// ---------------------------------------------------------------------------
// Part cache
// ---------------------------------------------------------------------------
const PARTS = new Map();
export function getPart(key, build) {
  if (!PARTS.has(key)) {
    const B = build();
    PARTS.set(key, B instanceof PartBuilder ? B.finish() : B);
  }
  return PARTS.get(key);
}
function eyesPart(face) {
  return getPart('eyes:' + face.id, () => {
    const B = new PartBuilder();
    const rests = faceRests(face);
    for (const [k, r] of Object.entries(rests)) B.setRest(k, r.p, r.q);
    for (const [S, s] of [['L', -1], ['R', 1]]) {
      if (face.eyes === 'cyclops' && s > 0) continue;
      const r = eyeRadius(face, s);
      const button = face.eyes === 'button' || (face.eyes === 'mismatch' && s > 0);
      B.rigid('eye' + S, 'bead', button ? buttonGeo(r) : beadGeo(r, s));
    }
    return B;
  });
}
export function partsFor(cos) {
  return [
    getPart('base', buildSuitBase),
    eyesPart(cos.faceEntry),
    getPart('kit', () => { const B = new PartBuilder(); buildBadge(B); buildPatch(B); buildWatch(B); buildHoodStencil(B); return B; }),
    getPart('suitx:' + cos.suit, () => buildSuitExtras(cos.suit, cos.suitEntry)),
    getPart('pack:' + cos.backpack, () => buildPackPart(cos.packEntry, cos)),
    getPart('hat:' + cos.hat, () => buildHatPart(cos.hatEntry)),
    getPart('visor:' + cos.visor, () => buildVisorPart(cos.visorEntry)),
    getPart('acc:' + cos.accessory, () => buildAccPart(cos.accEntry)),
  ];
}
export function cosKey(cos) { return [cos.suit, cos.face, cos.backpack, cos.hat, cos.visor, cos.accessory].join('|'); }

// merged per-material geometry for a cosmetics combination (shared, ref-counted)
const MERGED = new Map();
function acquireMerged(cos) {
  const key = cosKey(cos);
  let e = MERGED.get(key);
  if (!e) {
    const parts = partsFor(cos);
    const by = new Map();
    for (const p of parts) for (const [mat, g] of p.geos) { if (!by.has(mat)) by.set(mat, []); by.get(mat).push(g); }
    const geos = new Map();
    for (const [mat, list] of by) geos.set(mat, list.length === 1 ? list[0] : mergeGeometries(list, false));
    const over = {}, springs = {}, info = {};
    for (const p of parts) { Object.assign(over, p.over); Object.assign(springs, p.springs); Object.assign(info, p.info); }
    // geometries owned by this entry (merged) vs shared part geometries
    const owned = new Set(); for (const [mat, list] of by) if (list.length > 1) owned.add(geos.get(mat));
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
// drop unreferenced combinations (least recently used first) beyond MERGED_KEEP
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
// Pose channels (Euler angles per bone), springs and IK (same layout as the original avatar)
// ---------------------------------------------------------------------------
const CH = { pelvisPos: 0, pelvis: 3, squash: 6, chest: 7, head: 10, shL: 13, elL: 16, wrL: 19, shR: 22, elR: 25, wrR: 28, hipL: 31, knL: 34, anL: 37, hipR: 40, knR: 43, anR: 46, fiL: 49, fiR: 50, N: 51 };
const set3 = (p, i, x, y, z) => { p[i] = x; p[i + 1] = y; p[i + 2] = z; };
const mix3 = (p, i, x, y, z, w) => { p[i] += (x - p[i]) * w; p[i + 1] += (y - p[i + 1]) * w; p[i + 2] += (z - p[i + 2]) * w; };
const add3 = (p, i, x, y, z) => { p[i] += x; p[i + 1] += y; p[i + 2] += z; };
const SPRING_GROUPS = [
  [CH.pelvis, 3, 240, 0.55], [CH.chest, 3, 170, 0.45], [CH.head, 3, 105, 0.34],
  [CH.shL, 3, 62, 0.3], [CH.shR, 3, 62, 0.3], [CH.elL, 3, 55, 0.28], [CH.elR, 3, 55, 0.28],
  [CH.wrL, 3, 80, 0.36], [CH.wrR, 3, 80, 0.36],
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

// ---------------------------------------------------------------------------
let _avatarCount = 0;
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.65, 0), 1.45);

export class Avatar {
  constructor(cosmetics = DEFAULT_COSMETICS, opts = { firstPersonHidden: false }) {
    this.root = new THREE.Group(); this.root.name = 'Avatar';
    this.rigRoot = new THREE.Group(); this.root.add(this.rigRoot);
    this.rig = makeBones({});
    this.bones = this.rig.b;
    this.rigRoot.add(this.bones.pelvis);
    this.name = '';
    this._seed = ++_avatarCount * 7919;
    this.empNo = String(1000 + (this._seed % 8999)).padStart(4, '0');
    this.anchors = { right: new THREE.Object3D(), left: new THREE.Object3D(), head: new THREE.Object3D(), watch: new THREE.Object3D() };
    for (const [k, o] of Object.entries(this.anchors)) o.name = 'anchor_' + k;
    // hand anchors: palm centre, -Z along the hand's pointing direction (+Y = thumb side)
    this.anchors.right.position.set(0, -0.05, 0); this.anchors.right.rotation.set(-PI / 2, 0, 0);
    this.anchors.left.position.set(0, -0.05, 0); this.anchors.left.rotation.set(-PI / 2, 0, 0);
    this.bones.wrR.add(this.anchors.right); this.bones.wrL.add(this.anchors.left);
    this.bones.head.add(this.anchors.head); this.bones.elL.add(this.anchors.watch);
    this.anchors.head.position.set(0, FACE.eyeY, -0.2);
    this.hose = new Hose(DM.rubber());
    this.rigRoot.add(this.hose.mesh);
    this.hoseStart = new THREE.Object3D(); this.hoseEnd = new THREE.Object3D();
    this.fpHidden = !!opts?.firstPersonHidden;
    this.pose = new Float32Array(CH.N);
    this.sx = new Float32Array(CH.N); this.sv = new Float32Array(CH.N); this.F = new Float32Array(CH.N); this._springInit = false;
    this.trk = { pelvis: new Tracker(), chest: new Tracker(), shL: new Tracker(), shR: new Tracker() };
    this.t = Math.random() * 10;
    this._first = true;
    this.st = {
      speed: 0, mx: 0, my: 1, crouch: 0, sprint: 0, hold: 0, holdT: 0, talk: 0, pitch: 0, air: 0, dead: 0, limp: 0,
      phase: 0, squash: new Spring(240, 8, 1), headSq: new Spring(200, 7, 1), jig: new Spring(150, 4.5, 0), land: 0,
      emote: { wave: 0, dance: 0, point: 0, sit: 0, sleep: 0 },
      face: { eyeL: 1, eyeR: 1, eyeS: 1, brow: 0, browRot: 0, browArch: 0, blush: 0, x: 0, tilt: 0, nod: 0, bl: 0, mode: 0, m: mouthParams('smile') },
      blinkT: 1 + Math.random() * 3, blink: 0, blinkDur: 0, tremble: 0,
      finger: new Spring(300, 18, 0), wasGrounded: true, lastVy: 0, spin: 0,
      yaw: 0, yawRate: 0, yawAcc: 0, yawHas: false, headScale: 1,
    };
    this._ik = [0, 0, 0];
    this._fp = { browY: [0, 0], browRot: [0, 0], browArch: 0, mouth: mouthParams('smile'), eyeOpen: [1, 1], eyeMode: 0, x: 0, blush: 0, t: 0 };
    this.setCosmetics(cosmetics);
    this.update(0, {});
    this._first = true;   // the caller's first update still snaps (portraits, decorative corpses)
  }

  setCosmetics(c) {
    const cos = resolveCos(c);
    this.cos = cos;
    this.cosmetics = { suit: cos.suit, skin: cos.skin, hat: cos.hat, visor: cos.visor, face: cos.face, backpack: cos.backpack, accessory: cos.accessory };
    this._disposeParts();
    const M = acquireMerged(cos);
    this._merged = M;
    // rest pose (aux bones depend on the cosmetics) + skeleton
    setBoneRest(this.rig, M.over);
    this._resetBones();
    const restM = restMatrices(M.over);
    const skeleton = new THREE.Skeleton(this.rig.bones, restM.map((m) => m.clone().invert()));
    this.skeleton = skeleton;
    this.meshes = [];
    for (const [key, geo] of M.geos) {
      let g = geo;
      if (key === 'decal') {
        // per-avatar decal geometry: shared decals + this avatar's badge digits
        this._digits = badgeDigitsGeo(this.empNo);
        g = mergeDecal(geo, this._digits);
        this._decalGeo = g;
      }
      const mesh = this._skinned(g, dollMaterial(key, cos), key);
      this.meshes.push(mesh);
    }
    if (!M.geos.has('decal')) this._decalGeo = null;
    // dynamic face (nose + stitches)
    this.faceRig = new FaceRig(cos.faceEntry, { headRest: new THREE.Vector3().setFromMatrixPosition(restM[BI.head]), noseMatrix: restM[BI.nose], seed: this._seed });
    this.faceMesh = this._skinned(this.faceRig.geometry, DM.felt(), 'face');
    this.faceMesh.castShadow = false;
    this.meshes.push(this.faceMesh);
    for (const m of this.meshes) this.rigRoot.add(m);
    // hose
    const info = M.info;
    this.hoseStart.removeFromParent(); this.hoseEnd.removeFromParent();
    const hs = info.hoseStart, he = info.maskHose || info.hoseEnd;
    this.hasHose = !!(hs && he);
    if (this.hasHose) {
      this.bones[hs.bone].add(this.hoseStart); this.hoseStart.position.copy(hs.pos); this.hoseStartDir = hs.dir;
      this.bones[he.bone].add(this.hoseEnd); this.hoseEnd.position.copy(he.pos); this.hoseEndDir = he.dir; this.hoseEndBone = this.bones[he.bone];
    }
    this.hose.has = false;
    this._updateHoseVis();
    // watch anchor
    if (info.watch) { this.anchors.watch.position.copy(info.watch.pos); this.anchors.watch.rotation.copy(info.watch.rot); }
    // secondary motion
    this.wobbles = [];
    for (const [bone, cfg] of Object.entries(M.springs)) if (this.bones[bone]) this.wobbles.push(new Wobble(this.bones[bone], cfg));
    this.spinBone = info.spin ? this.bones[info.spin] : null;
    this.haloBone = info.halo ? this.bones[info.halo] : null;
    this.flameBone = info.flames ? this.bones[info.flames] : null;
    this.faceEntry = cos.faceEntry;
    this._springInit = false;
    this._first = true;
    // keep probe lighting on rebuilt meshes once registered with a world
    if (this.root.userData.probe) applyProbe(this.root);
  }
  _skinned(geo, mat, key) {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.boundingSphere = BOUNDS.clone();
    const fl = MAT_FLAGS[key] || {};
    mesh.castShadow = fl.shadow !== false && !mat.transparent;
    mesh.receiveShadow = true;
    if (fl.order) mesh.renderOrder = fl.order;
    mesh.name = 'doll_' + key;
    return mesh;
  }
  _resetBones() {
    const R = this.rig;
    for (let i = 0; i < R.bones.length; i++) { const b = R.bones[i]; b.position.copy(R.restP[i]); b.quaternion.copy(R.restQ[i]); b.scale.set(1, 1, 1); }
  }
  _updateHoseVis() { this.hose.mesh.visible = this.hasHose && !(this.fpHidden && this.hoseEndBone === this.bones.head); }
  _disposeParts() {
    if (this.meshes) for (const m of this.meshes) m.removeFromParent();
    if (this.faceRig) this.faceRig.geometry.dispose();
    if (this._decalGeo) { this._decalGeo.dispose(); this._decalGeo = null; }
    if (this._digits) { this._digits.dispose(); this._digits = null; }
    if (this.skeleton) this.skeleton.dispose();
    releaseMerged(this._merged); this._merged = null;
    this.meshes = null; this.skeleton = null; this.faceRig = null;
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
    this._updateHoseVis();
    const s = this.fpHidden ? 0.0001 : 1;
    const b = this.bones.head;
    if (this.fpHidden) b.scale.setScalar(s);
    else { const hs = this.st.headScale || 1; b.scale.set(1 / Math.sqrt(hs), hs, 1 / Math.sqrt(hs)); }
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
    st.mx = damp(st.mx, mx, 10 * K, dt || 0.016); st.my = damp(st.my, my, 10 * K, dt || 0.016);
    const D = dt || (first ? 0.016 : 0);
    st.speed = damp(st.speed, clamp(s.speed || 0, 0, 8), 9 * K, D);
    st.crouch = damp(st.crouch, clamp(s.crouch || 0, 0, 1), 10 * K, D);
    st.sprint = damp(st.sprint, s.sprint && (s.speed || 0) > 0.5 ? 1 : 0, 5 * K, D);
    st.hold = damp(st.hold, clamp(s.holding || 0, 0, 1), 9 * K, D);
    st.holdT = damp(st.holdT, s.holdTarget ? 1 : 0, 9 * K, D);
    st.talk = damp(st.talk, clamp(s.talking || 0, 0, 1), 20 * K, D);
    st.pitch = damp(st.pitch, clamp(s.pitch || 0, -1.3, 1.3), 14 * K, D);
    st.air = damp(st.air, grounded ? 0 : 1, (grounded ? 16 : 7) * K, D);
    st.limp = damp(st.limp, s.limp ? 1 : 0, 4 * K, D);
    // the body falls over over time; the face goes dead at once (decorative corpses get one update)
    st.dead = approach(st.dead, dead ? 1 : 0, dt * (dead ? 1.8 : 1.2));
    st.deadFace = dead && (st.deadFace || first || st.dead > 0.3);
    for (const k in st.emote) st.emote[k] = first ? (!dead && s.emote === k ? 1 : 0) : approach(st.emote[k], !dead && s.emote === k ? 1 : 0, dt * 3.5);
    if (grounded && !st.wasGrounded && dt > 0) {
      const imp = clamp(-st.lastVy / 6, 0.2, 1.5);
      st.squash.v -= imp * 6.8;
      st.headSq.v -= imp * 3.4;
      st.land = Math.max(st.land, imp);
    }
    if (!grounded && st.wasGrounded && vy > 0.5) { st.squash.v += 2.8; st.headSq.v += 1.2; }
    st.wasGrounded = grounded; st.lastVy = vy;
    st.land = Math.max(0, st.land - dt * 3);

    this._faceTargets(dt, s, st, t, first);

    // ---- gait: short-legged waddle
    const walk = smooth(clamp(st.speed / 0.5, 0, 1)) * (1 - st.air);
    const strideLen = lerp(0.42, 0.86, st.sprint) * lerp(1, 0.75, st.crouch);
    let freq = clamp(st.speed / strideLen, 0, lerp(3.3, 3.9, st.sprint));
    if (st.emote.dance > 0.01) freq = lerp(freq, 1.05, st.emote.dance);
    let rate = 1;
    if (st.limp > 0.01) { const pp = st.phase % 1; rate = lerp(1, pp < 0.5 ? 1.7 : 0.72, st.limp); }
    st.phase = (st.phase + freq * rate * dt) % 1;
    const ph = st.phase * TAU;
    const breath = Math.sin(t * 2.1);
    const sp = st.sprint * walk;
    const idle = (1 - walk) * (1 - st.air);

    p.fill(0);
    const bob = walk * (0.024 + 0.024 * sp) * (0.5 - 0.5 * Math.cos(2 * ph));
    let py = DIM.pelvisY - st.crouch * 0.12 + bob - walk * 0.012 + breath * 0.003 * idle;
    py -= st.limp * walk * 0.035 * Math.max(0, Math.sin(ph));
    set3(p, CH.pelvisPos, walk * 0.012 * Math.sin(ph), py, 0);
    // waddle: big side-to-side roll + yaw twist
    const roll = walk * (0.16 * (1 - 0.45 * sp)) * Math.sin(ph) + st.limp * walk * 0.08 * Math.max(0, Math.sin(ph));
    set3(p, CH.pelvis, -(0.05 * walk + 0.26 * sp) - st.crouch * 0.2 + st.air * (vy > 0 ? -0.08 : 0.12), walk * 0.14 * Math.cos(ph), roll);
    let sq = 1 + breath * 0.016 * (0.4 + idle) - walk * 0.055 * (0.5 + 0.5 * Math.cos(2 * ph)) - st.crouch * 0.07;
    if (!grounded) sq += vy > 0 ? 0.2 * clamp(vy / 5, 0, 1) : 0.05;
    p[CH.squash] = sq;
    const wob = Math.sin(t * 0.83) * 0.5 + Math.sin(t * 1.37 + 2) * 0.5;
    // idle life: now and then glance around / shift weight (only when standing still)
    st.lookT = (st.lookT ?? 2) - dt;
    if (st.lookT <= 0) { st.lookT = 2.5 + Math.random() * 4; st.lookYaw = idle > 0.8 && !st.talk ? (Math.random() - 0.5) * 1.1 : 0; st.lookPitch = (Math.random() - 0.4) * 0.25; st.shift = (Math.random() - 0.5) * 2; }
    st.lookY = damp(st.lookY || 0, (st.lookYaw || 0) * idle, 3.5, dt); st.lookP = damp(st.lookP || 0, (st.lookPitch || 0) * idle, 3, dt);
    st.shiftX = damp(st.shiftX || 0, (st.shift || 0) * idle, 1.5, dt);
    set3(p, CH.chest, -0.06 * sp + st.pitch * 0.15 + st.crouch * 0.1, -p[CH.pelvis + 1] * 0.9, -roll * 0.5 + wob * 0.015 * idle);
    set3(p, CH.head,
      st.pitch * 0.65 + 0.08 * sp + st.crouch * 0.12 + walk * 0.05 * Math.cos(2 * ph) + st.face.nod + st.lookP,
      wob * 0.05 * idle + st.lookY,
      -roll * 0.65 + st.face.tilt + wob * 0.035 * idle - st.lookY * 0.25);
    p[CH.pelvis + 2] += st.shiftX * 0.045; p[CH.pelvisPos] += st.shiftX * 0.012; p[CH.chest + 2] -= st.shiftX * 0.06;
    const swing = walk * (0.55 + 0.6 * sp) * lerp(1, 0.5, st.crouch);
    const c = Math.cos(ph);
    const splay = 0.4 + st.air * (0.9 + 0.3 * Math.sin(t * 9)) + st.crouch * 0.1 + Math.abs(st.yawRate) * 0.04;
    set3(p, CH.shL, -swing * c + st.crouch * 0.3, 0, -splay - wob * 0.03 * idle);
    set3(p, CH.shR, swing * c + st.crouch * 0.3, 0, splay + wob * 0.03 * idle);
    set3(p, CH.elL, 0.18 + sp * 1.0 + Math.max(0, -c) * swing * 0.5 + st.air * 0.4, 0, -0.08);
    set3(p, CH.elR, 0.18 + sp * 1.0 + Math.max(0, c) * swing * 0.5 + st.air * 0.4, 0, 0.08);
    this._legs(p, st, walk, strideLen, grounded, vy, t);

    const E = st.emote;
    if (E.wave > 0.001) this._emoteWave(p, E.wave, t);
    if (E.dance > 0.001) this._emoteDance(p, E.dance, t);
    if (E.point > 0.001) this._emotePoint(p, E.point, t);
    const sitW = Math.max(E.sit, E.sleep);
    if (sitW > 0.001) this._emoteSit(p, sitW, E.sleep, t);
    if (st.dead > 0.001) this._poseDead(p, st.dead, t);

    // ---- holding / reaching (IK targets in chest space)
    const holdW = Math.max(st.hold, st.holdT) * (1 - st.dead) * (1 - sitW * 0.5);
    if (holdW > 0.001) {
      b.chest.updateWorldMatrix(true, false);
      const tR = _v1.set(0.11, -0.1, -0.3);
      if (s.holdTarget && st.holdT > 0.001) { _v2.copy(s.holdTarget); b.chest.worldToLocal(_v2); tR.lerp(_v2, st.holdT); }
      tR.y += Math.sin(ph * 2) * 0.012 * walk;
      this._armIK('R', tR, holdW, p);
      const tL = _v1.set(-0.11, -0.1, -0.3 + (s.holdTarget ? 0.08 : 0));
      tL.y += Math.sin(ph * 2 + 1) * 0.012 * walk;
      this._armIK('L', tL, st.hold * (1 - st.dead) * (1 - sitW * 0.5), p);
    }

    // ---- springs (+ acceleration forcing)
    const F = this.F; F.fill(0);
    const gA = 0.018, gV = 0.012, gE = 0.013, gH = 0.007, gC = 0.0028;
    const deadK = 1 - st.dead * 0.7;
    F[CH.shL] = SK[CH.shL] * gA * aL.z; F[CH.shR] = SK[CH.shR] * gA * aR.z;
    F[CH.shL + 2] = SK[CH.shL] * (-gA * aL.x + gV * aL.y); F[CH.shR + 2] = SK[CH.shR] * (-gA * aR.x - gV * aR.y);
    F[CH.elL] = SK[CH.elL] * gE * aL.z; F[CH.elR] = SK[CH.elR] * gE * aR.z;
    F[CH.head] = -SK[CH.head] * gH * aC.z; F[CH.head + 2] = SK[CH.head] * gH * aC.x; F[CH.head + 1] = -SK[CH.head] * 0.012 * st.yawAcc;
    F[CH.chest] = -SK[CH.chest] * gC * aC.z; F[CH.chest + 2] = SK[CH.chest] * gC * aC.x;
    const X = this.sx, Vv = this.sv;
    if (!this._springInit || first) { X.set(p); Vv.fill(0); this._springInit = true; }
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
    if (first) st.squash.x = p[CH.squash];
    st.squash.step(dt, p[CH.squash], -SK[CH.chest] * 0.0013 * tk.pelvis.a.y * (1 - st.dead));
    st.squash.x = clamp(st.squash.x, 0.55, 1.45);
    const hsq = clamp(st.headSq.step(dt, 1, -200 * 0.0018 * aC.y * (1 - st.dead)), 0.75, 1.25);
    const jig = clamp(st.jig.step(dt, 0, 150 * 0.003 * Math.hypot(aC.x, aC.z) * Math.sign(aC.z || 1)), -0.12, 0.12);

    // ---- apply to bones
    this._resetBones();
    b.pelvis.position.set(X[CH.pelvisPos], X[CH.pelvisPos + 1], X[CH.pelvisPos + 2]);
    b.pelvis.rotation.set(X[CH.pelvis], X[CH.pelvis + 1], X[CH.pelvis + 2]);
    const sxz = 1 / Math.sqrt(Math.max(0.5, st.squash.x));
    b.body.scale.set(sxz * (1 + jig * 0.5), st.squash.x, sxz * (1 - jig));
    b.chest.position.y = DIM.chestY * (0.35 + 0.65 * st.squash.x);
    b.chest.rotation.set(X[CH.chest], X[CH.chest + 1], X[CH.chest + 2]);
    b.head.rotation.set(X[CH.head], X[CH.head + 1], X[CH.head + 2]);
    st.headScale = hsq;
    const hxz = 1 / Math.sqrt(hsq);
    b.head.scale.set(hxz, hsq, hxz);
    b.head.position.y = DIM.headY + (st.squash.x - 1) * 0.05;
    for (const S of ['L', 'R']) {
      for (const n of ['hip', 'kn', 'an', 'sh', 'el', 'wr']) { const i = CH[n + S]; b[n + S].rotation.set(X[i], X[i + 1], X[i + 2]); }
    }
    // mitten fingers: curl to grip, straighten to point
    const fing = st.finger.step(dt, E.point > 0.5 ? 1 : 0);
    const grip = clamp(Math.max(st.hold, st.holdT) * (1 - E.point), 0, 1);
    // palms face the body (-X for the right hand): fingers curl about Z toward the palm
    b.fiR.rotation.z = -(0.3 + grip * 1.0 - fing * 0.35); b.thR.rotation.z = -grip * 0.35;
    b.fiL.rotation.z = 0.3 + st.hold * 1.0 - E.wave * 0.2; b.thL.rotation.z = st.hold * 0.35;

    this._faceApply(dt, st, t);
    if (this.fpHidden) b.head.scale.setScalar(0.0001);

    if (this.spinBone) { st.spin += dt * (4 + st.speed * 9 + st.air * 20); this.spinBone.rotation.y = st.spin; }
    if (this.haloBone) { this.haloBone.position.y += Math.sin(t * 2.2) * 0.012; this.haloBone.rotation.y = t * 0.6; }
    if (this.flameBone) { const f = (0.35 + st.air * 0.9 + st.sprint * 0.3) * (1 - st.dead) * (0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31)); this.flameBone.scale.set(1, Math.max(0.001, f), 1); }

    this.rigRoot.updateMatrixWorld(true);
    for (const w of this.wobbles) w.update(dt);

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

  _legs(p, st, walk, strideLen, grounded, vy, t) {
    const inv = _q2.setFromEuler(_e1.set(p[CH.pelvis], p[CH.pelvis + 1], p[CH.pelvis + 2], 'ZXY')).invert();
    const half = strideLen * 0.5;
    const dance = st.emote.dance;
    for (const [S, side, off] of [['L', -1, 0], ['R', 1, 0.5]]) {
      const pp = (st.phase + off) % 1;
      let f, lift;
      if (pp < 0.5) { f = lerp(0.5, -0.5, pp / 0.5); lift = 0; } else { const u = (pp - 0.5) / 0.5; f = lerp(-0.5, 0.5, smooth(u)); lift = Math.sin(u * PI); }
      const lim = S === 'L' ? 1 - st.limp * 0.5 : 1;
      const travel = f * half * walk * lim;
      const stepLift = Math.max(walk, dance) * lift * (0.06 + 0.04 * st.sprint) * (S === 'L' ? 1 - st.limp * 0.6 : 1);
      const fx = side * DIM.hipX * (1.08 + st.crouch * 0.25) + st.mx * travel;
      let fz = -st.my * travel, fy = DIM.ankleH + stepLift;
      if (st.air > 0.001) { fy += st.air * (0.075 + 0.025 * Math.sin(t * 9 + off * 6)); fz -= st.air * 0.03; }
      _v1.set(fx - p[CH.pelvisPos], fy - p[CH.pelvisPos + 1], fz - p[CH.pelvisPos + 2]).applyQuaternion(inv);
      _v1.x -= side * DIM.hipX;
      const r = ik2(_v1, DIM.thigh, DIM.shin, true, this._ik);
      set3(p, CH['hip' + S], r[0], 0, r[1]);
      set3(p, CH['kn' + S], r[2], 0, 0);
      const toe = lift * 0.35 * walk - (pp < 0.5 ? smooth(clamp((pp - 0.3) / 0.2, 0, 1)) * 0.25 * walk : 0);
      set3(p, CH['an' + S], -(r[0] + r[2]) - p[CH.pelvis] + toe + st.air * 0.3, 0, -r[1] - p[CH.pelvis + 2]);
    }
  }
  _armIK(S, target, w, p) {
    const s = S === 'L' ? -1 : 1;
    _v3.copy(target).sub(_v2.set(s * DIM.shX, 0, 0));
    const r = ik2(_v3, DIM.upper, DIM.fore + DIM.hand * 0.6, false, this._ik);
    mix3(p, CH['sh' + S], r[0], 0, r[1], w);
    mix3(p, CH['el' + S], r[2], 0, 0, w);
    mix3(p, CH['wr' + S], 0.1, 0, 0, w);
  }
  _emoteWave(p, w, t) {
    mix3(p, CH.shR, 0.15, 0, 2.6 + Math.sin(t * 2.5) * 0.08, w);
    mix3(p, CH.elR, 0.25, 0, 0.6 * Math.sin(t * 9), w);
    mix3(p, CH.wrR, 0, 0, 0.35 * Math.sin(t * 9 - 0.8), w);
    add3(p, CH.head, 0.06 * w, -0.12 * w, -0.2 * w);
    add3(p, CH.chest, 0, -0.08 * w, -0.06 * w + Math.sin(t * 4.5) * 0.03 * w);
    mix3(p, CH.shL, 0.05, 0, -0.5, w);
  }
  _emoteDance(p, w, t) {
    const beat = t * TAU * 1.05, bounce = Math.abs(Math.sin(beat));
    p[CH.pelvisPos + 1] += (bounce * 0.045 - 0.02) * w;
    add3(p, CH.pelvis, 0, Math.sin(beat * 0.5) * 0.4 * w, Math.sin(beat) * 0.16 * w);
    p[CH.squash] += (bounce - 0.5) * 0.1 * w;
    const up = Math.sin(beat * 0.5);
    mix3(p, CH.shL, 0.3, 0, -(1.4 + up * 1.2), w);
    mix3(p, CH.shR, 0.3, 0, 1.4 - up * 1.2, w);
    mix3(p, CH.elL, 0.2, 0, -0.6 - up * 0.3, w);
    mix3(p, CH.elR, 0.2, 0, 0.6 - up * 0.3, w);
    add3(p, CH.head, Math.sin(beat) * 0.12 * w, Math.sin(beat * 0.5) * 0.25 * w, Math.sin(beat * 0.5 + 1) * 0.22 * w);
    add3(p, CH.chest, 0, -Math.sin(beat * 0.5) * 0.18 * w, 0);
  }
  _emotePoint(p, w) {
    mix3(p, CH.shR, 1.45 + this.st.pitch * 0.7, 0, 0.12, w);
    mix3(p, CH.elR, 0.05, 0, 0, w);
    mix3(p, CH.wrR, 0, 0, 0, w);
    add3(p, CH.chest, 0, -0.18 * w, 0);
    add3(p, CH.head, 0, 0.1 * w, 0);
    mix3(p, CH.shL, -0.1, 0, -0.45, w);
  }
  _emoteSit(p, w, sleep, t) {
    const br = Math.sin(t * (sleep > 0.5 ? 1.2 : 2.2));
    mix3(p, CH.pelvisPos, 0, 0.12, 0.02, w);
    mix3(p, CH.pelvis, 0.12 + sleep * 0.05, 0, 0, w);
    p[CH.squash] = lerp(p[CH.squash], 0.96 + br * (sleep > 0.5 ? 0.035 : 0.015), w);
    for (const [S, s] of [['L', -1], ['R', 1]]) {
      mix3(p, CH['hip' + S], 1.5, 0, s * 0.25, w);
      mix3(p, CH['kn' + S], -0.12, 0, 0, w);
      mix3(p, CH['an' + S], -1.15 - 0.15 * sleep, 0, -s * 0.15, w);
      mix3(p, CH['sh' + S], 0.35 - sleep * 0.2, 0, s * 0.62, w);
      mix3(p, CH['el' + S], 0.25, 0, s * 0.1, w);
    }
    mix3(p, CH.chest, -0.05 - sleep * 0.22, 0, 0, w);
    if (sleep > 0.001) mix3(p, CH.head, -0.42 + br * 0.04, 0.1, 0.34, sleep);
  }
  _poseDead(p, w) {
    const k = 1 - Math.pow(1 - w, 3);
    mix3(p, CH.pelvisPos, 0.12, 0.28, 0.0, k);
    mix3(p, CH.pelvis, 0.1, 0.3, -1.52, k);
    p[CH.squash] = lerp(p[CH.squash], 1, k);
    mix3(p, CH.chest, 0.15, 0, 0.1, k);
    mix3(p, CH.head, 0.2, 0.3, -0.35, k);
    mix3(p, CH.shL, 0.4, 0, -1.9, k); mix3(p, CH.elL, 0.6, 0, -0.2, k);
    mix3(p, CH.shR, -0.3, 0, 0.35, k); mix3(p, CH.elR, 0.4, 0, 0.1, k);
    mix3(p, CH.hipL, 0.55, 0, -0.25, k); mix3(p, CH.knL, -0.7, 0, 0, k); mix3(p, CH.anL, 0.2, 0, 0, k);
    mix3(p, CH.hipR, -0.15, 0, 0.1, k); mix3(p, CH.knR, -0.25, 0, 0, k); mix3(p, CH.anR, 0.1, 0, 0, k);
  }

  // ---- expressions -----------------------------------------------------------------------
  _faceTargets(dt, s, st, t, first) {
    const f = this.faceEntry, T = st.face;
    const dead = st.dead > 0.3 || st.deadFace;
    let expr = dead ? 'dead' : (s.expression || 'neutral');
    if (!dead && st.emote.sleep > 0.5) expr = 'sleepy';
    let eL = f.eyeSY ?? 1, eR = f.eyeSY ?? 1, eS = 1, brow = f.brow ?? 0, browRot = 0.2 - (f.browRot ?? 0), arch = 0, blush = (f.blush ?? 0) * 0.6, x = 0, tremble = 0, tilt = 0, nod = 0, mode = 0;
    let mouth = f.mouth || 'smile';
    switch (expr) {
      case 'happy': mouth = f.mouth === 'cat' ? 'cat' : f.mouth === 'gap' ? 'gap' : 'grin'; eL = eR = 0.6; brow = 0.008; browRot = 0.1; arch = 0.8; blush = Math.max(blush, 0.6) * 1.3; tilt = Math.sin(t * 3.2) * 0.08; break;
      case 'scared': mouth = 'wobble'; eL = eR = 1.1; eS = 1.18; brow = 0.012; browRot = 0.5; arch = -0.3; tremble = 1; nod = -0.12; break;
      case 'hurt': mouth = 'grit'; eL = 0.2; eR = 0.8; brow = 0.002; browRot = 0.42; tremble = 0.35; tilt = 0.14; break;
      case 'sleepy': mouth = 'o'; eL = eR = 0.1; mode = 2; brow = -0.005; browRot = 0.05; nod = -0.12; tilt = 0.12; break;
      case 'dead': mouth = 'tongue'; x = 1; break;
      case 'shocked': mouth = 'O'; eL = eR = 1.1; eS = 1.3; brow = 0.02; browRot = 0.1; arch = 0.6; nod = 0.12; break;
    }
    if ((st.emote.dance > 0.5 || st.emote.wave > 0.5) && (expr === 'neutral' || expr === 'happy')) { mouth = f.mouth === 'cat' ? 'cat' : 'grin'; mode = 1; eL = eR = 0.2; }
    if (!dead && expr !== 'sleepy' && st.talk > 0.08) {
      const lv = st.talk * (0.75 + 0.25 * Math.sin(t * 17)); mouth = lv < 0.3 ? 'talk1' : lv < 0.6 ? 'talk2' : 'talk3';
      nod += Math.sin(t * 13) * 0.04 * st.talk; brow += Math.max(0, Math.sin(t * 7.3)) * 0.004 * st.talk;
    }
    st.blinkT -= dt;
    if (st.blinkT <= 0 && !dead) {
      st.blinkDur = expr === 'sleepy' ? 0.35 : 0.14;
      st.blink = st.blinkDur;
      st.blinkT = (expr === 'sleepy' ? 1.6 : 2.0) + Math.random() * 3.4;
      if (Math.random() < 0.18) st.blinkT = 0.25;
    }
    let bl = 0;
    if (st.blink > 0) { st.blink -= dt; const u = 1 - st.blink / st.blinkDur; bl = clamp(u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6, 0, 1); }
    const D = first ? 1 : dt, k = first ? 1e4 : 16;
    T.eyeL = damp(T.eyeL, eL, k, D); T.eyeR = damp(T.eyeR, eR, k, D); T.eyeS = damp(T.eyeS, eS, first ? 1e4 : 18, D);
    T.brow = damp(T.brow, brow, k, D); T.browRot = damp(T.browRot, browRot, k, D); T.browArch = damp(T.browArch, arch, k, D);
    T.blush = damp(T.blush, blush, first ? 1e4 : 6, D); T.x = damp(T.x, x, first ? 1e4 : 10, D);
    T.tilt = damp(T.tilt, tilt, first ? 1e4 : 6, D); T.nod = damp(T.nod, nod, first ? 1e4 : 8, D);
    T.bl = bl; T.mode = mode;
    // mouth shape morphs smoothly between named shapes
    const target = mouthParams(mouth, this._mt || (this._mt = {}));
    const km = first ? 1e4 : 22;
    for (const key in target) T.m[key] = (key === 'teeth' || key === 'tongue' || key === 'flatTop' || key === 'grit') ? target[key] : damp(T.m[key] || 0, target[key], km, D);
    st.tremble = damp(st.tremble, tremble, 6, D);
  }
  _faceApply(dt, st, t) {
    const b = this.bones, T = st.face;
    const tr = st.tremble * 0.006;
    if (tr) { b.head.rotation.x += (Math.random() - 0.5) * tr * 3; b.head.rotation.z += (Math.random() - 0.5) * tr * 3; }
    const dead = T.x > 0.5;
    const F = this._fp;
    for (const [S, i] of [['L', 0], ['R', 1]]) {
      const open = (i ? T.eyeR : T.eyeL) * (1 - 0.94 * T.bl);
      const closed = T.mode > 0 || open < 0.3 || dead;
      const es = T.eyeS;
      const bone = b['eye' + S];
      if (closed) bone.scale.setScalar(0.0001);
      else { const sy = Math.max(0.3, open); bone.scale.set(es * (1 + (1 - sy) * 0.12), es * sy, es); }
      F.eyeOpen[i] = open;
    }
    const jit = st.tremble * 0.0015 * Math.sin(t * 40);
    F.browY[0] = T.brow + jit; F.browY[1] = T.brow - jit;
    F.browRot[0] = T.browRot; F.browRot[1] = T.browRot;
    F.browArch = T.browArch; F.eyeMode = T.mode; F.x = dead ? 1 : 0; F.blush = T.blush; F.t = t;
    F.mouth = T.m;
    this.faceRig.update(F);
  }
}

// merge the shared decal geometry with an avatar's digit quads (skinned to the chest area)
function mergeDecal(shared, digits) {
  const d = digits.clone();
  const n = d.attributes.position.count;
  const col = new Float32Array(n * 3).fill(1);
  d.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const P = d.attributes.position, o = new W();
  for (let i = 0; i < n; i++) {
    torsoW(P.getX(i), P.getY(i), P.getZ(i), o);
    let tot = 0; for (let k = 0; k < o.n; k++) tot += o.w[k];
    for (let k = 0; k < o.n; k++) { si[i * 4 + k] = o.i[k]; sw[i * 4 + k] = o.w[k] / tot; }
  }
  d.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  d.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  if (!shared.index) return d;
  const g = mergeGeometries([shared, d], false);
  d.dispose();
  return g;
}
export { BONE_NAMES, Y };
