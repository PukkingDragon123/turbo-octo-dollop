// Still Lifes — reusable anatomy + costume builders. Sculpt-side helpers add SDF primitives (sack
// heads, hoods, mitten gloves, boots, tears, scars); part-side helpers trace the sculpt's surface and
// attach hard details exactly onto it (bead eyes, thread stitches, duct tape, badges, tanks, hoses).
import * as THREE from 'three';
import { MAT } from './sdf.js';
import { traceSurface, projectSurface } from './mesher.js';
import * as G from './geo.js';
import { PAL, lin, RNG, clamp, lerp, PI, TAU, noise3 } from './core.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const THREAD_PBR = [0.42, 0.85, 0, 0];   // steel staples / wire stitches (robot repairs)
export const BEAD_PBR = [0.08, 0.0, 1.0, 0];

// ---------------------------------------------------------------------------
export class Frame {
  constructor(o = [0, 0, 0], q = null) { this.o = V3(o); this.q = q ? q.clone() : new THREE.Quaternion(); }
  static e(o, e = [0, 0, 0], order = 'XYZ') { return new Frame(o, new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], order))); }
  p(x, y, z) { const v = new THREE.Vector3(x, y, z).applyQuaternion(this.q).add(this.o); return [v.x, v.y, v.z]; }
  v(x, y, z) { return new THREE.Vector3(x, y, z).applyQuaternion(this.q).add(this.o); }
  d(x, y, z) { const v = new THREE.Vector3(x, y, z).applyQuaternion(this.q); return [v.x, v.y, v.z]; }
  r(e = [0, 0, 0], order = 'XYZ') { return this.q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], order))); }
  child(o, e = [0, 0, 0], order = 'XYZ') { return new Frame(this.p(...o), this.r(e, order)); }
  toLocal(p) { const v = V3(p).sub(this.o).applyQuaternion(this.q.clone().invert()); return [v.x, v.y, v.z]; }
}

// trace from a point outside along dir onto the sculpt surface
export function hit(S, from, dir, maxD = 0.6) {
  const h = traceSurface(S, from, dir, maxD);
  return h;
}
export function onSurf(S, p) { return projectSurface(S, p, 8); }
const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export { add3, sub3, len3, norm3, cross3, dot3 };

// ---------------------------------------------------------------------------
// HEAD SHELL (local: origin = bottom centre, +Y up, -Z = face). Was a sack; the clones are robots now:
// an ivory plastic skull with a separate PORCELAIN FACE PLATE that never sits quite right: rotated and
// slid off true (o.misalign / o.slide, seeded per head), a black gap all round it, often a crack across.
// o.plate === false: bare skull. Returns dims for face placement (+ plate frame).
export function sackHead(S, F, o = {}) {
  const w = o.w ?? 0.2, h = o.h ?? 0.5, d = o.d ?? 0.18;
  S.push({ mat: MAT.SKIN, col: o.col ?? PAL.burlap, bone: o.bone, k: 0.05, dirt: o.dirt ?? 0.25, thin: o.thin ?? 0, noise: o.noise ?? [0.0015, 22] });
  S.ell(F.p(0, h * 0.5, 0), [w, h * 0.5, d], F.q);
  const ck = o.cheek ?? 1;
  S.sphere(F.p(-w * 0.44, h * 0.31, -d * 0.4), w * 0.5 * ck, { k: 0.09 });
  S.sphere(F.p(w * 0.44, h * 0.31, -d * 0.4), w * 0.5 * (o.cheekR ?? ck), { k: 0.09 });
  S.ell(F.p(0, h * 0.79, d * 0.05), [w * 0.86, h * 0.23, d * 0.92], F.q, { k: 0.07 });
  if (o.neck !== false) S.cone(F.p(0, h * 0.16, d * 0.08), F.p(0, -(o.neckLen ?? 0.1), d * 0.12), w * 0.52, o.neckR ?? w * 0.36, { k: 0.06, bone: o.neckBone ?? o.bone });
  S.pop();
  let PF = null;
  if (o.plate !== false) {
    const pr = new RNG(Math.floor(Math.abs(F.o.x * 7919 + F.o.y * 3301 + F.o.z * 1013)) + 17);
    const mis = o.misalign ?? pr.range(0.06, 0.26) * pr.sign();
    const slide = o.slide ?? pr.range(-0.014, 0.014);
    PF = F.child([slide, -Math.abs(mis) * 0.05 * h, 0], [0, 0, mis]);
    const pc = [0, h * 0.37, -d * 0.62];
    S.push({ mat: MAT.SKIN, col: o.plateCol ?? PAL.porcelain, bone: o.bone, k: 0.006, dirt: 0.08, thin: 0, wet: 0.15, noise: [0.0006, 30] });
    S.ell(PF.p(...pc), [w * 0.84, h * 0.34, d * 0.5], PF.q);
    S.pop();
    S.prepare();
    // the gap round the plate: a dark seam
    const rim = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * TAU;
      rim.push(projectSurface(S, PF.p(Math.cos(a) * w * 0.83, h * 0.37 + Math.sin(a) * h * 0.33, -d * 0.98), 8).p);
    }
    S.groove(rim, 0.0042, 0.006, { rim: 0.0012, col: 0x0c0806, colOnly: true, dirt: 0.8, wet: 0.3 });
    // a crack across the plate (most heads)
    if (o.crack ?? pr.chance(0.75)) {
      const pts = [];
      let x = pr.range(-0.8, 0.8) * w * 0.8, y = h * (pr.chance(0.5) ? 0.68 : 0.08);
      const dy = y > h * 0.4 ? -1 : 1;
      for (let i = 0; i < 7; i++) {
        pts.push(projectSurface(S, PF.p(x, y, -d * 1.05), 8).p);
        x += pr.range(-0.03, 0.03); y += dy * h * pr.range(0.035, 0.07);
      }
      S.groove(pts, 0.0028, 0.005, { rim: 0.0008, wobble: 0.6, col: 0x0a0806, colOnly: true, dirt: 0.9 });
    }
  }
  return { w, h, d, F, PF };
}

// side seams of the sack (groove + running stitches), traced on the head surface
export function headSeams(S, parts, H, o = {}) {
  const { w, h, d, F } = H;
  for (const s of o.sides ?? [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const y = lerp(h * 0.12, h * 0.94, i / 14);
      const from = F.p(s * (w + 0.12), y, d * 0.08), dir = F.d(-s, 0, 0);
      const r = hit(S, from, dir, 0.3);
      if (r) pts.push(r);
    }
    if (pts.length < 3) continue;
    S.groove(pts.map((q) => q.p), 0.0045, 0.0035, { rim: 0.0016, wobble: 0.3 });
    runningStitch(parts, pts, { bone: o.bone, ws: S, size: 0.009, gap: 0.016 });
  }
}

// HOOD around a head frame (body sculpt): a tight shell following the sack, face opening carved
// out, rolled elastic hem with gathers, drape flowing into the collar.
export function hood(S, H, o = {}) {
  const { w, h, d, F } = H;
  const t = o.thick ?? 0.022;
  const cy = h * (o.openY ?? 0.45), ow = w * (o.openW ?? 0.86), oh = h * (o.openH ?? 0.41);
  S.push({ mat: MAT.SUIT, col: o.col ?? PAL.suit, bone: o.bone, k: 0.035, dirt: 0.35 });
  S.ell(F.p(0, h * 0.5, d * 0.1), [w + t, h * 0.5 + t, d + t * 1.1], F.q, { noise: [0.003, 10] });
  S.ell(F.p(0, h * 0.78, d * 0.12), [w * 0.88 + t, h * 0.24 + t, d * 0.93 + t], F.q, { k: 0.06 });
  if (o.drape !== false) S.cone(F.p(0, h * 0.22, d * 0.22), F.p(0, -0.05, d * 0.3), w + t * 0.7, w * 0.92 + t, { k: 0.06, bone2: o.drapeBone ?? o.bone, t0: 0.15, t1: 0.95 });
  // face opening
  S.ell(F.p(0, cy, -d * 1.02), [ow, oh, d * 0.72], F.q, { sub: true, k: 0.01, mat: null });
  S.pop();
  // rolled elastic hem around the opening + gathered wrinkles
  const ring = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * TAU;
    const lx = Math.cos(a) * ow * 0.995, ly = cy + Math.sin(a) * oh * 0.995;
    const ex = lx / (w + t), ey = (ly - h * 0.5) / (h * 0.5 + t);
    const zz = d * 0.1 - (d + t * 1.1) * Math.sqrt(Math.max(0.03, 1 - ex * ex - ey * ey));
    ring.push(F.p(lx, ly, zz + 0.006));
  }
  S.chain(ring, ring.map(() => o.hem ?? 0.011), { mat: MAT.SUIT, col: o.col ?? PAL.suit, bone: o.bone, k: 0.008, dirt: 0.5 });
  S.foldRadial(F.p(0, cy, -d * 0.7), F.d(0, 0, -1), Math.min(ow, oh) * 1.0, Math.max(ow, oh) * 1.45, o.gathers ?? 17, 0.0045, { depth: 0.1, warp: 0.35 });
  // loose fabric: slack folds over the crown and sides, bunching at the back of the neck
  const rng = new RNG(o.seed ?? 19);
  for (let i = 0; i < (o.wrinkles ?? 7); i++) {
    const a = rng.range(-2.2, 2.2), y = rng.range(0.3, 0.95) * h;
    const p = F.p(Math.sin(a) * (w + t), y, Math.cos(a) * (d + t) * 0.9 + d * 0.1);
    S.fold(p, rng.range(0.07, 0.12), F.d(rng.range(-1, 1), rng.range(-0.3, 0.3), rng.range(-1, 1)), rng.range(70, 110), rng.range(0.004, 0.007), { warp: 0.8, phase: rng.next() * 6 });
  }
  S.fold(F.p(0, h * 0.12, d * 0.9), 0.12, F.d(0, 1, 0.3), 90, 0.006, { warp: 0.9 });
  return { cy, ow, oh, ring };
}

// ---------------------------------------------------------------------------
// FACE features. eyes: [{x,y,r}], noses: [{x,y,r,col}], mouth: {x,y,w,kind}, brows.
// Coordinates in head-local units (metres). Features are traced from the front (-Z).
export function face(S, parts, H, o = {}) {
  const { w, h, d, F } = H;
  const out = { eyes: [], noses: [], mouth: null };
  const front = (x, y, depth = d * 2.2) => hit(S, F.p(x, y, -depth), F.d(0, 0, 1), depth * 1.8);
  for (const e of o.eyes || []) {
    const r = front(e.x, e.y);
    if (!r) continue;
    bead(S, parts, r.p, r.n, e.r, { bone: o.bone, socket: e.socket ?? 1, ws: S, col: e.col, lens: true });
    if (o.grime !== false) S.paint({ sphere: [r.p, e.r * 2.3, { noise: [e.r * 0.5, 0.8 / e.r] }] }, { col: 0x2c2014, w: 0.35, soft: e.r * 0.8, dirt: 0.8 });
    out.eyes.push({ ...r, r: e.r });
  }
  for (const n of o.noses || []) {
    const r = front(n.x, n.y);
    if (!r) continue;
    // robot "nose": a small black sensor dome (felt only where a caller insists on o.felt)
    const felt = !!n.felt;
    const nr = felt ? n.r : n.r * 0.55;
    const c = add3(r.p, r.n, nr * (n.out ?? (felt ? 0.55 : 0.2)));
    S.sphere(c, nr, { mat: felt ? MAT.FLUFF : MAT.RUBBER, col: felt ? (n.col ?? PAL.nose) : (n.col ?? 0x141416), bone: n.bone ?? o.bone, k: n.k ?? 0.008, noise: felt ? [n.r * 0.06, 9 / n.r * 0.05] : null, dirt: n.dirt ?? 0.1, wet: felt ? 0 : 0.6, ms: 3 });
    if (n.drip) S.cone(c, add3(c, F.d(0, -1, -0.2), n.drip), nr * 0.6, nr * 0.25, { mat: MAT.INNER, col: 0x1a0c08, bone: n.bone ?? o.bone, k: 0.02, wet: 0.9, ms: 3 });
    out.noses.push({ ...r, c, r: n.r });
  }
  if (o.brows !== false) {
    for (const e of o.eyes?.slice(0, 2) || []) {
      const s = e.x < 0 ? -1 : 1;
      const pts = [];
      for (let i = 0; i <= 4; i++) {
        const u = i / 4;
        const r = front(e.x + s * (u - 0.5) * (e.browW ?? 0.05) + s * 0.004, e.y + (e.browY ?? 0.07) + Math.sin(u * PI) * 0.008 + (e.browTilt ?? 0) * (u - 0.5) * s);
        if (r) pts.push(add3(r.p, r.n, 0.0025));
      }
      // painted-on brows (a factory decal, smeared)
      if (pts.length > 2) for (let i = 0; i < pts.length - 1; i++) S.paint({ cone: [pts[i], pts[i + 1], 0.0045, 0.0045] }, { col: 0x1a1612, w: 0.85, soft: 0.002, dirt: 0.2 });
    }
  }
  if (o.mouth) {
    const m = o.mouth;
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const r = front(m.x + (u - 0.5) * m.w, m.y + Math.sin(u * PI) * (m.curve ?? -0.006));
      if (r) pts.push(r);
    }
    if (m.kind === 'stitch' && pts.length > 2) {
      parts.add(G.tube(pts.map((q) => add3(q.p, q.n, 0.002)), 0.0035, 5), { color: PAL.thread, pbr: THREAD_PBR, uv: 'thread', ws: S, bone: o.bone });
      crossStitch(parts, pts, { ws: S, bone: o.bone, size: m.stitch ?? 0.011, step: 2 });
    }
    out.mouth = pts;
  }
  return out;
}

// glossy black bead sewn into a dimple; thread ring
export function bead(S, parts, p, n, r, o = {}) {
  const c = add3(p, n, r * 0.3);
  parts.add(G.sphere(r, 12, 8).translate(c[0], c[1], c[2]), { color: o.col ?? PAL.eye, pbr: BEAD_PBR, bone: o.bone, ws: o.ws });
  if (o.socket) S.bulge(p, [r * 1.7, r * 1.7, r * 1.7], -0.0035 * o.socket, null, { sharp: 2 });
  // camera-lens eyes: a chrome bezel; plain beads keep a stitched ring
  const ring = o.lens ? G.torus(r * 1.08, r * 0.2, 5, 16) : G.torus(r * 1.0, 0.0018, 3, 12);
  parts.add(G.placeAt(ring, add3(p, n, o.lens ? r * 0.12 : 0.0005), n), { color: o.lens ? 0xb8b6ae : PAL.thread, pbr: o.lens ? [0.18, 1, 0.3, 0] : THREAD_PBR, bone: o.bone, ws: o.ws });
  if (o.lens) parts.add(G.placeAt(G.disc(r * 0.32, 10), add3(c, n, r * 0.97), n), { color: 0xd8f0ff, pbr: [0.05, 0, 1, 0], bone: o.bone, ws: o.ws });
}

// robot limb segment a->b: the plastic shell is split into too many segments; each split is a dark gap
// ring with a grey ball joint showing through. n = joints between a and b, r = limb radius there.
export function servoJoints(S, a, b, r, n = 2, o = {}) {
  const dir = norm3(sub3(b, a));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
  for (let i = 1; i <= n; i++) {
    const t = (i / (n + 1)) + (o.jitter ?? 0) * (((i * 7919) % 13) / 13 - 0.5);
    const c = add3(a, sub3(b, a), t);
    S.torus(c, r * 1.02, r * 0.3, q, { sub: true, k: 0.004, mat: null, bone: o.bone });
    S.sphere(c, r * 0.82, { mat: MAT.RUBBER, col: o.col ?? 0x3c3b3a, k: 0.003, bone: o.bone, dirt: 0.3, thin: 0, wet: 0.2 });
  }
}

// bundle of loose coloured wires spilling out of a hole at p (normal n): droop under gravity, bare copper tips
export function wires(parts, p, n, o = {}) {
  const rng = new RNG(o.seed ?? 3);
  const N = norm3(n);
  const cols = [PAL.wireR, PAL.wireB, PAL.wireY, PAL.wireG, 0x1c1c1c];
  for (let i = 0, k = o.n ?? 4; i < k; i++) {
    const L = (o.len ?? 0.1) * rng.range(0.5, 1.2);
    let q = add3(add3(p, [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)], (o.spread ?? 0.012)), N, -0.01);
    const pts = [q];
    let dir = norm3(add3(N, [rng.range(-0.5, 0.5), rng.range(-0.3, 0.6), rng.range(-0.5, 0.5)]));
    for (let s2 = 1; s2 <= 5; s2++) {
      dir = norm3(add3(dir, [rng.range(-0.25, 0.25), -0.35 * (o.droop ?? 1), rng.range(-0.25, 0.25)]));
      q = add3(q, dir, L / 5);
      pts.push(q);
    }
    const r = (o.r ?? 0.0022) * rng.range(0.8, 1.2);
    parts.add(G.tube(pts, r, 5), { color: cols[(i + (o.seed ?? 0)) % cols.length], pbr: [0.45, 0, 0.6, 0], bone: o.bone, ws: o.ws });
    const e = pts[pts.length - 1], e2 = add3(e, dir, 0.008);
    parts.add(G.tube([e, e2], r * 0.55, 4), { color: PAL.copper, pbr: [0.3, 1, 0, 0], bone: o.bone, ws: o.ws });
  }
}

// ---------------------------------------------------------------------------
// stitches: pts = [{p, n}] along a seam/scar (surface samples)
export function runningStitch(parts, pts, o = {}) {
  const size = o.size ?? 0.009, gap = o.gap ?? 0.015;
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + len3(sub3(pts[i].p, pts[i - 1].p)));
  const total = L[L.length - 1];
  let i = 1;
  for (let s = gap * 0.5; s < total; s += gap) {
    while (i < pts.length - 1 && L[i] < s) i++;
    const a = pts[i - 1], b = pts[i];
    const u = clamp((s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]), 0, 1);
    const t = norm3(sub3(b.p, a.p));
    const c = add3(a.p, sub3(b.p, a.p), u), n = norm3(add3(a.n, sub3(b.n, a.n), u));
    const side = norm3(cross3(n, t));
    const p0 = add3(add3(c, side, -size * 0.5), n, 0.0012), p1 = add3(add3(c, side, size * 0.5), n, 0.0012), pm = add3(c, n, 0.0028);
    parts.add(G.tube([p0, pm, p1], o.r ?? 0.0021, 3), { color: o.color ?? PAL.thread, pbr: THREAD_PBR, uv: 'thread', ws: o.ws, bone: o.bone });
  }
}
export function crossStitch(parts, pts, o = {}) {
  const size = o.size ?? 0.012, step = o.step ?? 1;
  for (let i = 1; i < pts.length - 1; i += step) {
    const c = pts[i].p, n = pts[i].n;
    const t = norm3(sub3(pts[i + 1].p, pts[i - 1].p));
    const side = norm3(cross3(n, t));
    for (const s of [-1, 1]) {
      const p0 = add3(add3(add3(c, side, -size * 0.6), t, -size * 0.35 * s), n, 0.0015);
      const p1 = add3(add3(add3(c, side, size * 0.6), t, size * 0.35 * s), n, 0.0015);
      const pm = add3(add3(add3(c, n, 0.003), t, 0), side, 0);
      parts.add(G.tube([p0, pm, p1], o.r ?? 0.0024, 3), { color: o.color ?? PAL.thread, pbr: THREAD_PBR, uv: 'thread', ws: o.ws, bone: o.bone });
    }
  }
}

// scar: groove with puckered lips + cross stitches + dark tint
export function scar(S, parts, pts, o = {}) {
  const P = pts.map((q) => q.p);
  S.groove(P, o.width ?? 0.006, o.depth ?? 0.005, { rim: o.rim ?? 0.0025, wobble: 0.35, col: o.col ?? 0x5a3524, colOnly: true, dirt: 0.6, wet: o.wet ?? 0.2 });
  crossStitch(parts, pts, { ws: o.ws ?? S, bone: o.bone, size: o.size ?? 0.013, step: o.step ?? 1, color: o.thread ?? PAL.thread });
}
// sample a straight-ish path on the surface from a to b (points near the surface)
export function surfPath(S, a, b, n = 8, bend = null) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let q = add3(a, sub3(b, a), u);
    if (bend) q = add3(q, bend, Math.sin(u * PI));
    out.push(onSurf(S, q));
  }
  return out;
}

// ---------------------------------------------------------------------------
// RUBBER GLOVE (hand sculpt). F: origin at wrist, -Y toward fingertips; side -1 left / +1 right.
// Palm faces the body (-side*X), thumb forward (-Z). o.fingers: [{len, r, curl, splay, bones}]
export function glove(S, F, side, o = {}) {
  const col = o.col ?? PAL.rubber;
  const bone = o.bone;
  const sc = o.scale ?? 1;
  S.push({ mat: MAT.RUBBER, col, bone, k: 0.016, dirt: 0.2, noise: [0.0012, 34] });
  // gauntlet cuff (flares into the sleeve) + rolled lip
  const cr = (o.cuffR ?? 0.05) * sc;
  if (o.cuffDir) {
    // cuff follows the forearm (model-space direction from the wrist toward the elbow)
    const cd = norm3(o.cuffDir), w0 = F.p(0, -0.01 * sc, 0);
    const top = add3(w0, cd, 0.09 * sc);
    S.cone(top, w0, cr, 0.042 * sc, { bone: o.cuffBone ?? bone, bone2: bone, t0: 0.45, t1: 0.95, k: 0.02 });
    S.torus(add3(w0, cd, 0.08 * sc), cr + 0.002, 0.0065 * sc, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...cd)), { k: 0.006, bone: o.cuffBone ?? bone });
  } else {
    S.cone(F.p(0, 0.08 * sc, 0), F.p(0, -0.012 * sc, 0), cr, 0.042 * sc, { bone: o.cuffBone ?? bone, bone2: bone, t0: 0.45, t1: 0.95, k: 0.02 });
    S.torus(F.p(0, 0.072 * sc, 0), cr + 0.002, 0.0065 * sc, F.q, { k: 0.006, bone: o.cuffBone ?? bone });
  }
  // palm: flat, wide
  S.ell(F.p(0, -0.055 * sc, 0), [0.026 * sc, 0.05 * sc, 0.045 * sc], F.q, { k: 0.025 });
  S.ell(F.p(side * 0.006 * sc, -0.085 * sc, 0.002), [0.022 * sc, 0.03 * sc, 0.047 * sc], F.q, { k: 0.02 });
  const fingers = o.fingers || [{ len: 0.05 }, { len: 0.056 }, { len: 0.052 }, { len: 0.044 }];
  const out = [];
  const nf = fingers.length;
  fingers.forEach((f, i) => {
    const z = lerp(-0.036, 0.036, nf > 1 ? i / (nf - 1) : 0.5) * sc;
    const r = (f.r ?? 0.0118) * sc;
    const segs = f.segs ?? 3, L = f.len * sc, curl = f.curl ?? 0.3, splay = (f.splay ?? (i - (nf - 1) / 2) * 0.012) * sc;
    const pts = [F.p(-side * 0.002 * sc, -0.098 * sc, z)];
    let ang = 0, px = -side * 0.002 * sc, py = -0.098 * sc, pz = z;
    for (let s2 = 0; s2 < segs; s2++) {
      ang += curl / segs * (s2 + 1) * 0.8;
      px += -side * Math.sin(ang) * (L / segs); py += -Math.cos(ang) * (L / segs); pz += splay;
      pts.push(F.p(px, py, pz));
    }
    const radii = pts.map((_, k) => r * (1.05 - k * 0.06));
    S.chain(pts, radii, { bones: f.bones || [bone], k: 0.006 });
    // knuckle bulges + fingertip
    for (let k = 1; k < pts.length - 1; k++) S.sphere(pts[k], radii[k] * 1.12, { bone: (f.bones || [bone])[Math.min(k, (f.bones || [bone]).length - 1)], k: 0.006 });
    out.push(pts);
    for (let k = 1; k < pts.length - 1; k++) S.fold(pts[k], r * 1.5, sub3(pts[k + 1], pts[k - 1]), 300, 0.001, { warp: 0.2 });
  });
  const th = o.thumb ?? { len: 0.045 };
  const tp = [F.p(-side * 0.014 * sc, -0.042 * sc, -0.036 * sc), F.p(-side * 0.026 * sc, -0.062 * sc, -0.058 * sc), F.p(-side * 0.026 * sc, (-0.062 - th.len * 0.65) * sc, -0.07 * sc)];
  S.chain(tp, [0.016 * sc, 0.013 * sc, 0.012 * sc], { bones: th.bones || [bone], k: 0.012 });
  // wrist creases
  S.fold(F.p(0, -0.005 * sc, 0), 0.05 * sc, F.d(0, 1, 0), 220, 0.0016, { warp: 0.5 });
  S.pop();
  return { fingers: out, thumb: tp };
}

// RUBBER BOOT (foot sculpt). F: origin at ankle (≈0.1 above the floor), -Z forward.
export function boot(S, F, o = {}) {
  const col = o.col ?? PAL.rubber, bone = o.bone;
  const s = o.scale ?? 1;
  S.push({ mat: MAT.RUBBER, col, bone, k: 0.03, dirt: 0.45, noise: [0.002, 25] });
  const shTop = o.shaftDir ? add3(F.p(0, 0, 0), norm3(o.shaftDir), o.shaft ?? 0.13) : F.p(0, (o.shaft ?? 0.13), 0);
  S.cone(shTop, F.p(0, 0, 0), 0.072 * s, 0.066 * s, { bone: o.shinBone ?? bone, bone2: bone, t0: 0.5, t1: 1 });
  S.ell(F.p(0, -0.03 * s, -0.04 * s), [0.068 * s, 0.056 * s, 0.11 * s], F.q, { k: 0.04 });
  S.sphere(F.p(0, -0.04 * s, -0.12 * s), 0.058 * s, { k: 0.05 });
  S.sphere(F.p(0, -0.045 * s, 0.035 * s), 0.058 * s, { k: 0.04 });
  S.box(F.p(0, -0.082 * s, -0.04 * s), [0.074 * s, 0.016 * s, 0.15 * s], F.q, 0.014 * s, { k: 0.012, col: o.sole ?? 0x2b2926 });
  // tread ridges along the sole edge
  for (let i = -2; i <= 2; i++) S.groove([F.p(-0.08 * s, -0.082 * s, -0.04 * s + i * 0.05 * s), F.p(0.08 * s, -0.082 * s, -0.04 * s + i * 0.05 * s)], 0.006, 0.003, { rim: 0 });
  // creases over the instep
  S.fold(F.p(0, 0.0, -0.06 * s), 0.07, F.d(0, 0.3, 1), 90, 0.0025, { warp: 0.6 });
  S.pop();
}

// ---------------------------------------------------------------------------
// DUCT TAPE wrapped around a limb: centre + axis; traced onto sculpt S. o: {wraps, width, reach, peel}
export function tape(parts, S, center, axis, o = {}) {
  const ax = norm3(axis);
  let u = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  u = norm3(sub3(u, [ax[0] * dot3(u, ax), ax[1] * dot3(u, ax), ax[2] * dot3(u, ax)]));
  const v = cross3(ax, u);
  const width = o.width ?? 0.032, R = o.reach ?? 0.1, rng = new RNG(o.seed ?? 3);
  const wraps = o.wraps ?? 2;
  const out = [];
  for (let wI = 0; wI < wraps; wI++) {
    const N = 30, tilt = rng.range(-0.25, 0.25) * width, off = (wI - (wraps - 1) / 2) * width * 0.55 + (o.offset ?? 0), ph = rng.next() * TAU;
    const turn = wI === wraps - 1 ? rng.range(0.92, 1.12) : 1.06;
    const pts = [], nrm = [], wid = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * turn * TAU + ph;
      const dir = add3([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], v, Math.sin(a));
      const c = add3(center, ax, off + Math.sin(a - ph) * tilt);
      const r = hit(S, add3(c, dir, R), [-dir[0], -dir[1], -dir[2]], R * 1.5);
      let p, n;
      if (r) { p = r.p; n = r.n; } else { p = add3(c, dir, R * 0.45); n = dir; }
      pts.push(add3(p, n, 0.0018 + wI * 0.0012)); nrm.push(n);
      wid.push(width * (0.92 + rng.next() * 0.12));
    }
    if (wI === wraps - 1 && o.peel !== 0) {
      const k = 4;
      for (let i = N - k; i <= N; i++) { const f = (i - (N - k)) / k; pts[i] = add3(add3(pts[i], nrm[i], f * f * (o.peel ?? 0.012)), [0, -1, 0], f * f * 0.006); }
    }
    parts.add(G.ribbon(pts, nrm, width, { uScale: 1 / 0.7, widths: wid }), { color: o.color ?? PAL.tape, pbr: [0.42, 0.25, 0.25, 0], uv: 'tape', ws: S, bone: o.bone });
    out.push(pts);
  }
  return out;
}

// strip of tape laid flat over a surface path (patches, taped seams): pts [{p,n}]
export function tapeStrip(parts, S, pts, o = {}) {
  const P = pts.map((q) => add3(q.p, q.n, o.lift ?? 0.0025)), N = pts.map((q) => q.n);
  const strap = (o.color ?? PAL.tape) === 0x1e1d1c;
  const g = G.ribbon(P, N, o.width ?? 0.036, { uScale: 1 / 0.7, thick: strap ? 0.003 : 0 });
  parts.add(g, strap ? { color: 0x3a3631, pbr: [0.85, 0, 0, 0.3], uv: 'tape', ws: S, bone: o.bone } : { color: o.color ?? PAL.tape, pbr: [0.42, 0.25, 0.25, 0], uv: 'tape', ws: S, bone: o.bone });
}

// ID BADGE clipped onto the suit
export function badge(parts, p, n, up, idx = 0, o = {}) {
  const m = G.matFrom(add3(p, n, 0.004), n, up, o.spin ?? 0);
  const card = G.slab(0.056, 0.088, 0.0026, 0.005);
  card.applyMatrix4(m);
  parts.add(card, { uv: 'badge' + idx, pbr: [0.32, 0, 0.85, 0], bone: o.bone, ws: o.ws });
  const clip = G.slab(0.016, 0.03, 0.004, 0.003);
  clip.translate(0, 0.05, 0.002).applyMatrix4(m);
  parts.add(clip, { color: 0x9b9890, pbr: [0.35, 0.9, 0.2, 0], bone: o.bone, ws: o.ws });
}

// dented scuba-style AIR tank (rigid to bone). F: centre of tank, local +Y along the tank
export function airTank(parts, F, o = {}) {
  const r = o.r ?? 0.075, L = o.len ?? 0.4, rng = new RNG(o.seed ?? 5);
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * PI / 2; prof.push([Math.sin(a) * r, -L / 2 + r - Math.cos(a) * r]); }
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * PI / 2; prof.push([Math.cos(a) * r, L / 2 - r + Math.sin(a) * r * 0.9]); }
  prof.push([0.016, L / 2 + r * 0.05]);
  const body = G.lathe(prof, 22);
  // dents
  const P = body.attributes.position;
  const dents = (o.dents ?? 3);
  const dc = Array.from({ length: dents }, () => ({ a: rng.next() * TAU, y: rng.range(-L * 0.3, L * 0.3), s: rng.range(0.03, 0.06), d: rng.range(0.006, 0.016) }));
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const a = Math.atan2(z, x), rr = Math.hypot(x, z);
    let k = 0;
    for (const dd of dc) { const da = Math.atan2(Math.sin(a - dd.a), Math.cos(a - dd.a)) * r, dy = y - dd.y; const q = Math.exp(-(da * da + dy * dy) / (dd.s * dd.s)); k += q * dd.d; }
    if (rr > 1e-4) { const f = Math.max(0, rr - k) / rr; P.setX(i, x * f); P.setZ(i, z * f); }
  }
  body.computeVertexNormals();
  const M = new THREE.Matrix4().compose(F.o, F.q, new THREE.Vector3(1, 1, 1));
  parts.add(body.applyMatrix4(M), { uv: 'metal', color: o.color ?? 0x7d8a86, pbr: [0.42, 0.65, 0.35, 0], bone: o.bone });
  // hazard band + label wraps
  const band = G.cyl(r * 1.012, r * 1.012, 0.05, 22, true);
  remapCylUV(band);
  parts.add(band.translate(0, L * 0.18, 0).applyMatrix4(M), { uv: 'hazard', pbr: [0.5, 0.1, 0.4, 0], bone: o.bone });
  const lab = G.cyl(r * 1.01, r * 1.01, 0.1, 22, true);
  remapCylUV(lab, 0.45);
  parts.add(lab.translate(0, -L * 0.08, 0).applyMatrix4(M), { uv: 'label', pbr: [0.6, 0, 0.2, 0], bone: o.bone });
  // valve + regulator
  const valve = G.cyl(0.018, 0.022, 0.05, 10).translate(0, L / 2 + r * 0.05 + 0.02, 0);
  parts.add(valve.applyMatrix4(M), { color: 0x8a8578, pbr: [0.3, 1, 0.2, 0], uv: 'metal', bone: o.bone });
  const knob = G.cyl(0.026, 0.026, 0.012, 12).translate(0, L / 2 + r * 0.05 + 0.05, 0);
  parts.add(knob.applyMatrix4(M), { color: 0x1d1c1b, pbr: [0.5, 0, 0.2, 0], bone: o.bone });
  const reg = G.slab(0.04, 0.035, 0.03, 0.006).rotateY(PI / 2).translate(0.03, L / 2 + r * 0.05 + 0.025, 0);
  parts.add(reg.applyMatrix4(M), { color: 0x2a2928, pbr: [0.45, 0.4, 0.3, 0], uv: 'metal', bone: o.bone });
  return { top: F.p(0.045, L / 2 + r * 0.05 + 0.025, 0), M };
}
function remapCylUV(g, cover = 1) {
  // CylinderGeometry already runs u 0..1 around (left-to-right seen from outside): just squeeze it
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) / cover);
}

// corrugated breathing hose through points (ribs as geometry)
export function hose(parts, pts, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V3));
  const L = curve.getLength();
  const n = Math.max(8, Math.floor(L / (o.rib ?? 0.011)) * 2);
  const P = curve.getSpacedPoints(n);
  const r = o.r ?? 0.0125;
  const radii = P.map((_, i) => r * (i % 2 ? 0.82 : 1.0));
  if (o.frayEnd) radii[radii.length - 1] = r * 0.6;
  const g = G.tube(P, radii, 8, { capStart: true, capEnd: !o.open });
  parts.add(g, { color: o.color ?? 0x2c2c2e, pbr: [0.5, 0.0, 0.3, 0], bone: o.bone, ws: o.ws });
  if (o.frayEnd) {
    // torn end: wires poking out
    const end = P[P.length - 1], prev = P[P.length - 3];
    const t = end.clone().sub(prev).normalize();
    const rng = new RNG(o.seed ?? 9);
    for (let i = 0; i < 4; i++) {
      const off = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(r * 0.5);
      const a = end.clone().add(off), b = a.clone().addScaledVector(t, rng.range(0.012, 0.03)).add(new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(0.01));
      parts.add(G.tube([a, b], 0.0012, 3), { color: i % 2 ? 0xb87333 : 0x9a9a9a, pbr: [0.35, 0.9, 0, 0], bone: o.bone, ws: o.ws });
    }
  }
  return P;
}

// zipper along a surface path pts [{p,n}]
export function zipper(parts, S, pts, o = {}) {
  // split into ~0.12 m segments so the atlas strip repeats
  let seg = [pts[0]], acc = 0;
  const flush = () => {
    if (seg.length < 2) return;
    const P = seg.map((q) => add3(q.p, q.n, 0.0022)), N = seg.map((q) => q.n);
    const g = G.ribbon(P, N, o.width ?? 0.016, { uScale: 1 / 0.12 });
    // swap uv: along = v in atlas region
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const a = uv.getX(i), b = uv.getY(i); uv.setXY(i, b, Math.min(1, a)); }
    parts.add(g, { uv: 'zip', color: 0xffffff, pbr: [0.5, 0.3, 0.3, 0], ws: S, bone: o.bone });
  };
  for (let i = 1; i < pts.length; i++) {
    acc += len3(sub3(pts[i].p, pts[i - 1].p));
    seg.push(pts[i]);
    if (acc > 0.12) { flush(); seg = [pts[i]]; acc = 0; }
  }
  flush();
  // pull tab at the top
  const top = pts[pts.length - 1];
  const tab = G.slab(0.014, 0.03, 0.003, 0.004).translate(0, -0.012, 0);
  tab.applyMatrix4(G.matFrom(add3(top.p, top.n, 0.006), top.n, [0, 1, 0], o.tabSpin ?? 0.3));
  parts.add(tab, { color: 0x9e9a92, pbr: [0.3, 1, 0.2, 0], uv: 'metal', ws: S, bone: o.bone });
}

// TEAR in the suit: burlap shows through, stuffing bulges, frayed threads; returns rim samples
export function tear(S, parts, cloth, p, n, size, o = {}) {
  const rng = new RNG(o.seed ?? 11);
  const N = norm3(n);
  let t1 = norm3(cross3(N, Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const t2 = cross3(N, t1);
  const ang = o.angle ?? rng.range(0, PI);
  const ta = add3([t1[0] * Math.cos(ang), t1[1] * Math.cos(ang), t1[2] * Math.cos(ang)], t2, Math.sin(ang));
  const tb = cross3(N, ta);
  const sx = size, sy = size * (o.aspect ?? 0.55);
  // burlap underneath (paint) + slight depression
  S.paint({ ell: [p, [sx, sy, Math.max(sx, sy) * 1.5], new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(ta), V3(tb), V3(N))), { noise: [size * 0.25, 9 / size * 0.08] }] }, { mat: MAT.SKIN, col: o.skinCol ?? PAL.burlapDark, soft: 0.004, dirt: 0.5, thin: o.thin ?? 0.15, wet: o.wet ?? 0 });
  S.bulge(p, [sx * 1.1, sy * 1.1, size], -(o.depth ?? 0.008), new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(ta), V3(tb), V3(N))));
  // stuffing bulging out
  const nStuff = o.stuff ?? 2;
  for (let i = 0; i < nStuff; i++) {
    const c = add3(add3(add3(p, ta, rng.range(-0.4, 0.4) * sx), tb, rng.range(-0.3, 0.3) * sy), N, -size * 0.15 + rng.range(0, size * 0.25));
    S.sphere(c, size * rng.range(0.32, 0.5), { mat: MAT.FLUFF, col: rng.next() < 0.5 ? PAL.stuffing : PAL.stuffingOld, k: 0.012, noise: [size * 0.12, 3 / size * 0.1], ms: 2.5, dirt: 0.3, bone: o.bone, ws: 0.6 });
  }
  // frayed threads + curled flap of suit fabric
  const rim = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    rim.push(onSurf(S, add3(add3(p, ta, Math.cos(a) * sx * 1.05), tb, Math.sin(a) * sy * 1.05)));
  }
  for (let i = 0; i < (o.threads ?? 5); i++) {
    const q = rim[rng.int(0, rim.length - 1)];
    const dn = rng.range(0.012, 0.04);
    const a = add3(q.p, q.n, 0.001), b = add3(add3(a, q.n, dn * 0.3), [0, -1, 0], dn * 0.6), c = add3(b, [rng.range(-1, 1) * 0.008, -dn * 0.5, rng.range(-1, 1) * 0.008]);
    parts.add(G.tube([a, b, c], 0.0011, 3), { color: o.threadCol ?? 0xa8902c, pbr: THREAD_PBR, ws: S, bone: o.bone });
  }
  if (cloth && o.flap !== false) {
    // a flap hinged at the lower rim, curling outward/down
    const base = rim[Math.floor(rim.length * 0.75)];
    flap(cloth, S, base.p, base.n, ta, size * 1.1, size * (o.flapLen ?? 1.1), { color: o.flapCol ?? PAL.suit, seed: rng.int(1, 999), bone: o.bone });
  }
  // robot innards: wiring spills out between the stuffing
  if (o.wires !== false) wires(parts, add3(p, N, -size * 0.1), N, { n: o.wires ?? rng.int(2, 4), len: size * 1.6, seed: rng.int(0, 99), bone: o.bone, ws: S });
  return rim;
}

// curled fabric flap: hinge at p (surface), width along t, hangs/curls away from n
export function flap(cloth, S, p, n, t, width, len, o = {}) {
  const rng = new RNG(o.seed ?? 4);
  const cols = 6, rows = 6;
  const pos = [], idx = [];
  const T = norm3(t), Nn = norm3(n);
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      const ragged = j === rows ? rng.range(-0.25, 0.15) * len / rows : 0;
      const curl = v * v * (o.curl ?? 0.9);
      const down = (v * len + ragged) * Math.cos(curl);
      const outw = (v * len) * Math.sin(curl) * 0.6 + 0.003 + v * 0.012;
      const w = width * (1 - v * 0.35) * u + (j === rows ? rng.range(-0.004, 0.004) : 0);
      const q = add3(add3(add3(p, T, w), [0, -1, 0], down), Nn, outw);
      pos.push(q[0], q[1], q[2]);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  cloth.add(g, { color: o.color ?? PAL.suit, mat: MAT.SUIT, dirt: 0.5, ao: 0.8, ws: S, bone: o.bone });
}

// hanging cloth strip from a surface point (rags of the torn suit), optional dangle bone
export function rag(cloth, S, p, n, width, len, o = {}) {
  const rng = new RNG(o.seed ?? 8);
  const rows = Math.max(4, Math.round(len / 0.04)), cols = 3;
  const pos = [], idx = [];
  const side = norm3(cross3([0, 1, 0], n));
  let cur = add3(p, n, 0.004), dir = norm3(add3([0, -1, 0], n, o.out ?? 0.15));
  const ptsC = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const w = width * (1 - v * (o.taper ?? 0.5)) * (1 + (rng.next() - 0.5) * 0.2);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      const twist = Math.sin(v * PI * (o.twist ?? 1.2)) * 0.6;
      const sd = add3(side, n, twist);
      const q = add3(cur, norm3(sd), u * w);
      pos.push(q[0], q[1], q[2]);
    }
    ptsC.push(cur);
    cur = add3(cur, dir, len / rows);
    dir = norm3(add3(dir, [rng.range(-0.1, 0.1), -0.25, rng.range(-0.1, 0.1)]));
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  cloth.add(g, { color: o.color ?? PAL.suit, mat: o.mat ?? MAT.SUIT, dirt: o.dirt ?? 0.55, ao: 0.8, thin: o.thin ?? 0, ws: S, bone: o.bone, blend: o.blend });
  return ptsC;
}

// surface samples on a ring around `axis` through `center` (traced inward from `reach`)
export function ringAround(S, center, axis, n = 16, reach = 0.12, wobble = 0) {
  const ax = norm3(axis);
  let u = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  u = norm3(sub3(u, [ax[0] * dot3(u, ax), ax[1] * dot3(u, ax), ax[2] * dot3(u, ax)]));
  const v = cross3(ax, u);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const dir = add3([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], v, Math.sin(a));
    const c = add3(center, ax, Math.sin(a * 2) * wobble);
    const r = hit(S, add3(c, dir, reach), [-dir[0], -dir[1], -dir[2]], reach * 1.5);
    out.push(r || onSurf(S, add3(c, dir, reach * 0.4)));
  }
  return out;
}

// joints of a glove() built with the same frame/options: finger bases, first knuckles, thumb base
export function gloveJoints(F, side, fingers, sc = 1) {
  const nf = fingers.length;
  const bases = [], mids = [];
  fingers.forEach((f, i) => {
    const z = lerp(-0.036, 0.036, nf > 1 ? i / (nf - 1) : 0.5) * sc;
    const segs = f.segs ?? 3, L = f.len * sc, curl = f.curl ?? 0.3, splay = (f.splay ?? (i - (nf - 1) / 2) * 0.012) * sc;
    bases.push(F.p(-side * 0.002 * sc, -0.098 * sc, z));
    const ang = (curl / segs) * 0.8;
    mids.push(F.p(-side * 0.002 * sc - side * Math.sin(ang) * (L / segs), -0.098 * sc - Math.cos(ang) * (L / segs), z + splay));
  });
  return { bases, mids, thumb: F.p(-side * 0.014 * sc, -0.042 * sc, -0.036 * sc) };
}
// centre of a glove's cuff (for tape), matching glove() with o.cuffDir
export function cuffCenter(F, cuffDir, sc = 1, along = 0.05) { return add3(F.p(0, -0.01 * sc, 0), norm3(cuffDir), along * sc); }

// baggy sleeve / trouser bunching: ring-shaped wrinkles along a limb segment a->b (radius r)
export function limbFolds(S, a, b, r, o = {}) {
  const rng = new RNG(o.seed ?? Math.floor((a[0] * 131 + a[1] * 71 + b[2] * 37) * 1000) + 7);
  const n = o.n ?? Math.max(2, Math.round(len3(sub3(b, a)) / 0.07));
  const d = norm3(sub3(b, a));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + rng.range(-0.3, 0.3)) / n;
    const c = add3(a, sub3(b, a), t);
    const ax = norm3(add3(d, [rng.range(-0.35, 0.35), rng.range(-0.35, 0.35), rng.range(-0.35, 0.35)]));
    S.fold(c, r * rng.range(1.3, 1.8), ax, rng.range(75, 110) * (o.freq ?? 1), rng.range(0.004, 0.007) * (o.amp ?? 1), { warp: rng.range(0.5, 1.0), phase: rng.next() * 6 });
  }
}
// tension / slump folds scattered over a torso region (ellipsoid c, radii)
export function torsoFolds(S, c, radii, count, o = {}) {
  const rng = new RNG(o.seed ?? 77);
  for (let i = 0; i < count; i++) {
    const u = rng.next() * TAU, v = rng.range(-0.8, 0.8);
    const p = [c[0] + Math.cos(u) * radii[0] * Math.sqrt(1 - v * v), c[1] + v * radii[1], c[2] + Math.sin(u) * radii[2] * Math.sqrt(1 - v * v)];
    const ax = o.axis ? norm3(add3(o.axis, [rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5)])) : norm3([rng.range(-1, 1), rng.range(0.3, 1.2), rng.range(-1, 1)]);
    S.fold(p, rng.range(0.1, 0.17), ax, rng.range(55, 90), rng.range(0.004, 0.007) * (o.amp ?? 1), { warp: rng.range(0.5, 1.0), phase: rng.next() * 6 });
  }
}
// streaks running down the surface from p (rust/grime/drool); colour + wetness via paint
export function drip(S, p, o = {}) {
  const rng = new RNG(o.seed ?? 5);
  const n = o.n ?? 3, L = o.len ?? 0.15, w = o.w ?? 0.012;
  for (let i = 0; i < n; i++) {
    const s = add3(p, [rng.range(-1, 1) * w * 1.5, 0, rng.range(-1, 1) * w * 1.5]);
    const l = L * rng.range(0.5, 1.1);
    const e = add3(s, [rng.range(-0.15, 0.15) * l, -l, rng.range(-0.15, 0.15) * l]);
    S.paint({ cone: [s, e, w * rng.range(0.8, 1.3), w * 0.35, { noise: [w * 0.4, 0.6 / w] }] }, { col: o.col ?? 0x3b2116, w: o.strength ?? 0.8, soft: w * 0.6, wet: o.wet ?? 0.6, dirt: 0.8 });
  }
}

// smeared rust-brown handprint (mitten palm + fingers) painted onto the surface at p (normal n)
export function handprint(S, p, n, up = [0, 1, 0], o = {}) {
  const N = norm3(n);
  let t = norm3(cross3(up, N));
  if (!isFinite(t[0])) t = [1, 0, 0];
  const u = cross3(N, t);
  const sc = o.size ?? 1, rng = new RNG(o.seed ?? 9);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...t), new THREE.Vector3(...u), new THREE.Vector3(...N)));
  const col = o.col ?? 0x3a1a0e, wet = o.wet ?? 0.3;
  const at = (x, y) => add3(add3(p, t, x * sc), u, y * sc);
  S.paint({ ell: [at(0, 0), [0.04 * sc, 0.048 * sc, 0.03], q, { noise: [0.008 * sc, 60] }] }, { col, w: 0.85, soft: 0.006, wet, dirt: 0.9 });
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.018;
    const a = at(x, 0.04), b = at(x * 1.25, 0.04 + 0.05 + (i === 1 || i === 2 ? 0.01 : 0));
    S.paint({ cone: [a, b, 0.009 * sc, 0.008 * sc, { noise: [0.003, 120] }] }, { col, w: 0.8, soft: 0.004, wet, dirt: 0.9 });
  }
  S.paint({ cone: [at(-0.035, 0.0), at(-0.065, 0.03), 0.01 * sc, 0.008 * sc] }, { col, w: 0.75, soft: 0.004, wet, dirt: 0.9 });
  // smear dragged downward
  if (o.smear !== false) S.paint({ cone: [at(0, -0.02), at(rng.range(-0.02, 0.02), -0.09 - rng.next() * 0.06), 0.03 * sc, 0.012 * sc, { noise: [0.006, 50] }] }, { col, w: 0.5, soft: 0.01, wet: wet * 0.5, dirt: 0.8 });
}
