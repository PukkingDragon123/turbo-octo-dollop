// Small hardware shared by many models: screws, bolts, rivets, glides, casters, pulls, hinges.
import * as THREE from 'three';
import { latheGeo, boxGeo, cylGeo, sphereGeo, tubeGeo, roundPath, qUp, toV, V, TAU, HP, PI } from './core.js';

const _q = new THREE.Quaternion();

// screw / bolt heads. pos: point on the surface, n: outward normal. kind: phillips|slot|pan|hex|rivet|flat
export function screw(b, slot, pos, n, r = 0.0035, kind = 'phillips', o = {}) {
  const P = toV(pos);
  const q = qUp(n, o.roll ?? b.rng.next() * PI);
  const h = r * (kind === 'flat' ? 0.25 : 0.55);
  if (kind === 'hex') {
    const washer = cylGeo(r * 1.45, r * 0.18, { seg: 12 });
    washer.translate(0, r * 0.09, 0);
    b.put(slot, washer, P.x, P.y, P.z, { quat: q });
    const hex = cylGeo(r, r * 0.62, { seg: 6, bevel: r * 0.08 });
    hex.translate(0, r * 0.18 + r * 0.31, 0);
    b.put(slot, hex, P.x, P.y, P.z, { quat: q });
    if (o.thread) {
      const th = cylGeo(r * 0.55, o.thread, { seg: 8 });
      th.translate(0, r * 0.8 + o.thread / 2, 0);
      b.put(slot, th, P.x, P.y, P.z, { quat: q });
    }
    return;
  }
  const prof = kind === 'flat'
    ? [[0, 0], [r, 0, 1], [r, h * 0.6], [r * 0.9, h], [0, h]]
    : [[0, 0], [r, 0, 1], [r * 0.97, h * 0.35], [r * 0.78, h * 0.82], [r * 0.42, h], [0, h]];
  b.put(slot, latheGeo(prof, o.seg ?? 8, { uv: 'cyl' }), P.x, P.y, P.z, { quat: q });
  if (kind === 'phillips' || kind === 'slot' || kind === 'flat') {
    const dark = o.dark ?? '#1d1c1a';
    const c1 = boxGeo(r * 1.25, h * 0.32, r * 0.24, { r: 0, wear: 0 });
    c1.translate(0, h * 0.9, 0);
    b.put(dark, c1, P.x, P.y, P.z, { quat: q });
    if (kind !== 'slot') {
      const c2 = boxGeo(r * 0.24, h * 0.32, r * 1.25, { r: 0, wear: 0 });
      c2.translate(0, h * 0.9, 0);
      b.put(dark, c2, P.x, P.y, P.z, { quat: q });
    }
  }
}

// nylon / felt furniture glide (dome) under a foot at (x, y, z), axis -Y
export function glide(b, slot, x, y, z, r = 0.011, h = 0.006, o = {}) {
  const g = latheGeo([[0, 0], [r * 0.7, 0.0004], [r * 0.95, h * 0.35], [r, h * 0.75], [r * 0.96, h, 1], [0, h]], o.seg ?? 12, { uv: 'cyl' });
  b.put(slot, g, x, y, z, o.rot ? { rot: o.rot } : {});
}

// twin-wheel office caster. (x, z) on the floor, top of stem at stemTop, yaw = wheel direction
export function caster(b, x, z, yaw, stemTop, o = {}) {
  const R = o.r ?? 0.024, W = o.w ?? 0.014, gap = 0.012;
  const hub = R;                         // wheel axle height
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const rot = [0, yaw, 0];
  // stem + housing hood
  b.cyl(o.stem ?? 'chrome', 0.0055, Math.max(0.005, stemTop - hub - 0.018), x, (stemTop + hub + 0.018) / 2, z, { seg: 8 });
  const hood = boxGeo(0.03, 0.022, 0.05, { r: 0.0095, seg: 1, wear: 0 });
  b.put(o.body ?? '#1e1e20:g', hood, x, hub + 0.012, z, { rot });
  // wheels (axis along local x, after yaw)
  for (const s of [-1, 1]) {
    const ox = ca * s * (gap / 2 + W / 2), oz = -sa * s * (gap / 2 + W / 2);
    const wheel = latheGeo([[0, -W / 2], [R - 0.004, -W / 2, 2], [R, -W / 2 + 0.004, 2], [R, W / 2 - 0.004, 2], [R - 0.004, W / 2, 2], [0, W / 2]], o.seg ?? 14);
    b.put(o.wheel ?? '#1b1b1d:g', wheel, x + ox, hub, z + oz, { rot: [0, yaw, HP, 'YXZ'] });
    const cap = cylGeo(R * 0.42, 0.0015, { seg: 8 });
    b.put('#8a8c8e', cap, x + ox * 1.48, hub, z + oz * 1.48, { rot: [0, yaw, HP, 'YXZ'] });
  }
}

// bar pull with two posts; along local X, sticking out +Z. (x,y,z) = mount surface centre
export function barPull(b, slot, x, y, z, w = 0.12, o = {}) {
  const d = o.d ?? 0.028, r = o.r ?? 0.0055, rot = o.rot || null;
  const pts = [[-w / 2, 0, 0], [-w / 2, 0, d], [w / 2, 0, d], [w / 2, 0, 0]];
  const g = tubeGeo(roundPath(pts, o.bend ?? 0.012, 4), r, { radial: 8, caps: true });
  b.put(slot, g, x, y, z, rot ? { rot } : {});
  for (const s of [-1, 1]) {
    const ros = cylGeo(r * 1.9, 0.003, { seg: 10 });
    ros.translate(s * w / 2, 0, 0.0015);
    b.put(slot, ros, x, y, z, { rot: rot ? [rot[0] + HP, rot[1], rot[2]] : [HP, 0, 0] });
  }
}

// filing-cabinet style pull: curved scoop handle + label holder frame above it (faces +Z)
export function cabinetPull(b, slot, x, y, z, o = {}) {
  const w = o.w ?? 0.13;
  // scoop handle: a curved strip
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, a = -0.9 + t * 1.8; pts.push([Math.sin(a) * w * 0.5, -0.008 - (1 - Math.cos(a)) * 0.006, 0.006 + Math.cos(a) * 0.012]); }
  const strip = tubeGeo(pts, [0.009, 0.0022], { radial: 8, caps: 'round' });
  b.put(slot, strip, x, y, z);
  b.box(slot, w * 0.95, 0.018, 0.005, x, y - 0.002, z + 0.0025, { r: 0.002 });
  // label holder
  const ly = y + (o.labelDy ?? 0.04);
  b.box(slot, w * 0.62, 0.032, 0.0025, x, ly, z + 0.0013, { r: 0.0012 });
}

// barrel hinge between two leaves; axis Y at (x, y, z)
export function hinge(b, slot, x, y, z, h = 0.06, r = 0.0045, o = {}) {
  b.cyl(slot, r, h, x, y, z, { seg: 8, bevel: r * 0.4 });
  if (o.leaves !== false) for (const s of [-1, 1]) b.box(slot, 0.016, h * 0.94, 0.0016, x + s * 0.008 * (o.flat ? 1 : 0), y, z + (o.flat ? 0 : s * 0.008), { r: 0.0006, rot: o.flat ? null : [0, HP, 0] });
}

// Phillips screws in a regular pattern on a face (normal n), e.g. hinge plates
export function screwRow(b, slot, pts, n, r = 0.003, kind = 'phillips') {
  for (const p of pts) screw(b, slot, p, n, r, kind);
}

export { V };
