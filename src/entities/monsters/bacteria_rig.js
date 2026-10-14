// The Bacteria — skeleton definition shared by the sculptor (bacteria_sculpt.js, also run in a
// worker) and the procedural animator (bacteria_body.js).
//
// Bone frame convention (identical in the bind pose and in the solver, so sculpted anatomy stays on
// the right side of every limb): local +Y runs along the bone, local -Z is the bone's "front":
//   pelvis/spine/neck/head/jaw : -Z = the creature's face/chest side
//   clavicle                   : -Z = chest forward
//   upper arm / forearm        : -Z = the elbow point (convex side of the elbow bend)
//   hand / fingers / thumb     : -Z = palm (fingers curl toward -Z)
//   thigh / shin               : -Z = kneecap side
//   foot / toe                 : -Z = top of the foot (dorsal), +Z = sole
// The bind pose is a relaxed A-pose (arms hanging out from the body, palms facing the thighs,
// elbows pointing back, digitigrade feet) so linear-blend skinning deforms least around it.
import * as THREE from 'three';

const V3 = THREE.Vector3;

export const D = {
  pelvis: 0.10, spine: 0.18, neck: 0.11, head: 0.24, jaw: 0.105,
  clav: 0.19, uarm: 0.84, farm: 0.84, hand: 0.10, f1: 0.145, f2: 0.135, thumb: 0.085,
  thigh: 0.66, shin: 0.64, foot: 0.205, toe: 0.10,
  hipX: 0.13, hipY: -0.02,
  tenA: 0.12, tenB: 0.115,
};
// finger bases across the knuckle line (hand-local x); the thumb sits on the -s side
export const FINGER_X = [-0.031, -0.0105, 0.0105, 0.031];
export const FOOT_PITCH = 0.78; // planted heel lift: walks on the balls of very long feet
export const PELVIS_Y = 1.36;
export const JAW_AT = [0, 0.072, 0.004]; // jaw hinge, head-local
export const TENDRILS = [
  // head-local attach point (back of the skull), bind tilt (x = back, z = out)
  { at: [-0.024, 0.205, 0.07], rx: 1.95, rz: 0.3 },
  { at: [0.028, 0.2, 0.072], rx: 2.05, rz: -0.36 },
  { at: [-0.045, 0.15, 0.074], rx: 2.35, rz: 0.6 },
  { at: [0.047, 0.155, 0.07], rx: 2.25, rz: -0.66 },
];

const _bx = new V3(), _by = new V3(), _bz = new V3(), _bm = new THREE.Matrix4();
// Quaternion whose local +Y = y and local -Z faces `front` (projected perpendicular to y).
export function quatYFront(y, front, out) {
  _by.copy(y);
  if (_by.lengthSq() < 1e-12) _by.set(0, 1, 0);
  _by.normalize();
  _bz.copy(front).addScaledVector(_by, -front.dot(_by));
  if (_bz.lengthSq() < 1e-8) {
    _bz.set(0, 0, -1).addScaledVector(_by, _by.z);
    if (_bz.lengthSq() < 1e-8) _bz.set(1, 0, 0).addScaledVector(_by, -_by.x);
  }
  _bz.normalize().negate();
  _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_bm);
}

const n3 = (x, y, z) => new V3(x, y, z).normalize();

/**
 * Builds the bone list and the bind pose.
 * Returns { def: [{name, parent, len}], id: {name: index}, sides: [...], tenIds: [[a, b]...],
 *           bind: Matrix4[] (bone -> bind space), names: string[] }
 */
export function buildRig() {
  const def = [], id = {};
  const pos = [], quat = [];
  const add = (name, parent, p, q, len) => {
    id[name] = def.length;
    def.push({ name, parent: parent == null ? -1 : id[parent], len });
    pos.push(p.clone());
    quat.push(q.clone());
    return id[name];
  };
  const Q = new THREE.Quaternion();
  const qOf = (y, front) => quatYFront(y, front, new THREE.Quaternion());
  const ident = new THREE.Quaternion();
  const end = (i, l) => pos[i].clone().add(new V3(0, l, 0).applyQuaternion(quat[i]));
  const local = (i, x, y, z) => new V3(x, y, z).applyQuaternion(quat[i]).add(pos[i]);

  // ---- axial skeleton (straight, upright)
  add('pelvis', null, new V3(0, PELVIS_Y, 0), ident, D.pelvis);
  for (let i = 0; i < 5; i++) add('sp' + i, i ? 'sp' + (i - 1) : 'pelvis', new V3(0, PELVIS_Y + D.pelvis + D.spine * i, 0), ident, D.spine);
  const neckY = PELVIS_Y + D.pelvis + D.spine * 5;
  add('neck0', 'sp4', new V3(0, neckY, 0), ident, D.neck);
  add('neck1', 'neck0', new V3(0, neckY + D.neck, 0), ident, D.neck);
  add('head', 'neck1', new V3(0, neckY + D.neck * 2, 0), ident, D.head);
  add('jaw', 'head', local(id.head, ...JAW_AT), ident, D.jaw);
  const tenIds = [];
  TENDRILS.forEach((t, n) => {
    const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, 0, t.rz));
    const a = add('tenA' + n, 'head', local(id.head, ...t.at), qa, D.tenA);
    const qb = qa.clone().multiply(Q.setFromEuler(new THREE.Euler(0.3, 0, 0)));
    const b = add('tenB' + n, 'tenA' + n, end(a, D.tenA), qb, D.tenB);
    tenIds.push([a, b]);
  });

  // ---- limbs
  const sides = [];
  for (const s of [-1, 1]) {
    const S = s < 0 ? 'L' : 'R';
    const o = { s, S };
    // clavicle: sternum -> acromion, chest-forward front
    const cs = local(id.sp4, s * 0.03, 0.15, 0);
    const cdir = n3(s * 0.17, -0.02, 0.02);
    o.clav = add('clav' + S, 'sp4', cs, qOf(cdir, new V3(0, 0, -1)), D.clav);
    const sh = end(o.clav, D.clav);
    // arm hangs down/out, elbow points back-out, forearm angles forward-in a little
    const du = n3(s * 0.43, -1, -0.1);
    const elbow = sh.clone().addScaledVector(du, D.uarm);
    const df = n3(s * 0.3, -1, -0.32);
    const wrist = elbow.clone().addScaledVector(df, D.farm);
    // bend = convex side of the elbow (component of the elbow off the shoulder-wrist line)
    const sw = wrist.clone().sub(sh).normalize();
    const bend = elbow.clone().sub(sh);
    bend.addScaledVector(sw, -bend.dot(sw)).normalize();
    o.uarm = add('uarm' + S, 'clav' + S, sh, qOf(du, bend), D.uarm);
    o.farm = add('farm' + S, 'uarm' + S, elbow, qOf(df, bend), D.farm);
    // hand continues the forearm; palm faces the thigh (inward) and a little forward
    const dh = n3(s * 0.22, -1, -0.26);
    o.hand = add('hand' + S, 'farm' + S, wrist, qOf(dh, n3(-s, 0, -0.35)), D.hand);
    // fingers: relaxed splay + slight curl
    o.fing = [];
    for (let k = 0; k < 4; k++) {
      const base = local(o.hand, FINGER_X[k], D.hand, 0);
      const qa = quat[o.hand].clone().multiply(Q.setFromEuler(new THREE.Euler(0, 0, -FINGER_X[k] * 6))).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0, 0)));
      const fa = add(`f${k}a${S}`, 'hand' + S, base, qa, D.f1);
      const qb = qa.clone().multiply(Q.setFromEuler(new THREE.Euler(-0.26, 0, 0)));
      const fb = add(`f${k}b${S}`, `f${k}a${S}`, end(fa, D.f1), qb, D.f2);
      o.fing.push([fa, fb]);
    }
    // thumb: from the heel of the palm, angled out toward the palm side
    {
      const base = local(o.hand, -s * 0.024, 0.022, -0.006);
      const qt = quat[o.hand].clone().multiply(Q.setFromEuler(new THREE.Euler(-0.35, 0, s * 0.62)));
      o.thumb = add('thumb' + S, 'hand' + S, base, qt, D.thumb);
    }
    // leg: thigh slightly out, knee forward, shin angling back (digitigrade), long foot, toes
    const hip = local(id.pelvis, s * D.hipX, D.hipY, 0);
    const dt = n3(s * 0.06, -1, -0.07);
    const knee = hip.clone().addScaledVector(dt, D.thigh);
    const ds = n3(s * 0.02, -1, 0.17);
    const ankle = knee.clone().addScaledVector(ds, D.shin);
    o.thigh = add('thigh' + S, 'pelvis', hip, qOf(dt, new V3(0, 0, -1)), D.thigh);
    o.shin = add('shin' + S, 'thigh' + S, knee, qOf(ds, new V3(0, 0, -1)), D.shin);
    const dfo = n3(s * 0.04, -Math.sin(FOOT_PITCH), -Math.cos(FOOT_PITCH));
    o.foot = add('foot' + S, 'shin' + S, ankle, qOf(dfo, new V3(0, 1, 0)), D.foot);
    const ball = ankle.clone().addScaledVector(dfo, D.foot);
    o.toe = add('toe' + S, 'foot' + S, ball, qOf(n3(s * 0.05, -0.12, -1), new V3(0, 1, 0)), D.toe);
    sides.push(o);
  }

  const bind = pos.map((p, i) => new THREE.Matrix4().compose(p, quat[i], new V3(1, 1, 1)));
  return { def, id, sides, tenIds, bind, names: def.map((d) => d.name), pos, quat };
}

let _rig = null;
export function rig() { return _rig || (_rig = buildRig()); }

// Bone-local frame helper for sculpting: p(x, y, z) -> bind-space point (array), d(...) -> direction
export function frameOf(r, bone) {
  const i = typeof bone === 'number' ? bone : r.id[bone];
  const M = r.bind[i];
  const q = r.quat[i];
  const v = new V3();
  return {
    i,
    name: r.names[i],
    p: (x, y, z) => { v.set(x, y, z).applyMatrix4(M); return [v.x, v.y, v.z]; },
    d: (x, y, z) => { v.set(x, y, z).applyQuaternion(q); return [v.x, v.y, v.z]; },
    q,
  };
}
