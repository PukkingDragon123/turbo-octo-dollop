// Still Lifes — reusable anatomy + costume builders. Sculpt-side helpers add SDF primitives (sack
// heads, hoods, mitten gloves, boots, tears, scars); part-side helpers trace the sculpt's surface and
// attach hard details exactly onto it (bead eyes, thread stitches, duct tape, badges, tanks, hoses).
import * as THREE from 'three';
import { MAT } from './sdf.js';
import { traceSurface, projectSurface } from './mesher.js';
import * as G from './geo.js';
import { PAL, lin, RNG, clamp, lerp, PI, TAU, noise3 } from './core.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const THREAD_PBR = [0.85, 0, 0, 0.6];
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
// SACK HEAD (local: origin = bottom centre, +Y up, -Z = face). Returns dims for face placement.
export function sackHead(S, F, o = {}) {
  const w = o.w ?? 0.2, h = o.h ?? 0.5, d = o.d ?? 0.18;
  S.push({ mat: MAT.SKIN, col: o.col ?? PAL.burlap, bone: o.bone, k: 0.05, dirt: o.dirt ?? 0.25, thin: o.thin ?? 0, noise: o.noise ?? [0.003, 22] });
  S.ell(F.p(0, h * 0.5, 0), [w, h * 0.5, d], F.q);
  const ck = o.cheek ?? 1;
  S.sphere(F.p(-w * 0.44, h * 0.31, -d * 0.4), w * 0.5 * ck, { k: 0.09 });
  S.sphere(F.p(w * 0.44, h * 0.31, -d * 0.4), w * 0.5 * (o.cheekR ?? ck), { k: 0.09 });
  S.ell(F.p(0, h * 0.79, d * 0.05), [w * 0.86, h * 0.23, d * 0.92], F.q, { k: 0.07 });
  if (o.neck !== false) S.cone(F.p(0, h * 0.16, d * 0.08), F.p(0, -(o.neckLen ?? 0.1), d * 0.12), w * 0.52, o.neckR ?? w * 0.36, { k: 0.06, bone: o.neckBone ?? o.bone });
  S.pop();
  return { w, h, d, F };
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

// HOOD around a head frame (body sculpt). Shell + face opening carve + rolled hem + gathers.
export function hood(S, H, o = {}) {
  const { w, h, d, F } = H;
  const t = o.thick ?? 0.034;
  const cy = h * (o.openY ?? 0.47), ow = w * (o.openW ?? 0.8), oh = h * (o.openH ?? 0.4);
  S.push({ mat: MAT.SUIT, col: o.col ?? PAL.suit, bone: o.bone, k: 0.04, dirt: 0.35 });
  S.ell(F.p(0, h * 0.53, d * 0.18), [w + t, h * 0.5 + t * 1.2, d + t * 1.5], F.q, { noise: [0.004, 9] });
  if (o.drape !== false) S.cone(F.p(0, h * 0.25, d * 0.3), F.p(0, -0.06, d * 0.45), w + t * 0.6, w * 0.9 + t, { k: 0.07 });
  // face opening
  S.ell(F.p(0, cy, -d * 1.05), [ow, oh, d * 0.85], F.q, { sub: true, k: 0.012, mat: null });
  S.pop();
  // rolled elastic hem around the opening + gathered wrinkles
  const ring = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU;
    const lx = Math.cos(a) * ow * 1.01, ly = cy + Math.sin(a) * oh * 1.01;
    // hood front surface depth at (lx, ly)
    const ex = lx / (w + t), ey = (ly - h * 0.53) / (h * 0.5 + t * 1.2);
    const zz = d * 0.18 - (d + t * 1.5) * Math.sqrt(Math.max(0.02, 1 - ex * ex - ey * ey));
    ring.push(F.p(lx, ly, zz + 0.012));
  }
  S.chain(ring, ring.map(() => o.hem ?? 0.013), { mat: MAT.SUIT, col: o.col ?? PAL.suit, bone: o.bone, k: 0.012, dirt: 0.45 });
  S.foldRadial(F.p(0, cy, -d * 0.6), F.d(0, 0, -1), Math.min(ow, oh) * 1.02, Math.max(ow, oh) * 1.6, o.gathers ?? 15, 0.0055, { depth: 0.12, warp: 0.35 });
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
    bead(S, parts, r.p, r.n, e.r, { bone: o.bone, socket: e.socket ?? 1, ws: S, col: e.col });
    out.eyes.push({ ...r, r: e.r });
  }
  for (const n of o.noses || []) {
    const r = front(n.x, n.y);
    if (!r) continue;
    const c = add3(r.p, r.n, n.r * (n.out ?? 0.55));
    S.sphere(c, n.r, { mat: MAT.FLUFF, col: n.col ?? PAL.nose, bone: n.bone ?? o.bone, k: n.k ?? 0.012, noise: [n.r * 0.06, 9 / n.r * 0.05], dirt: n.dirt ?? 0.2, ms: 3 });
    if (n.drip) S.cone(c, add3(c, F.d(0, -1, -0.2), n.drip), n.r * 0.6, n.r * 0.25, { mat: MAT.FLUFF, col: n.col ?? PAL.nose, bone: n.bone ?? o.bone, k: 0.02, ms: 3 });
    // sewn ring at the base
    const ring = [];
    const tA = norm3(cross3(r.n, F.d(0, 1, 0))), tB = cross3(r.n, tA);
    for (let i = 0; i <= 18; i++) { const a = (i / 18) * TAU; ring.push(add3(add3(r.p, tA, Math.cos(a) * n.r * 0.86), tB, Math.sin(a) * n.r * 0.86)); }
    const proj = ring.map((q) => onSurf(S, add3(q, r.n, 0.01)).p);
    out.noses.push({ ...r, c, r: n.r, ring: proj });
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
      if (pts.length > 2) parts.add(G.tube(pts, 0.0042, 5, {}), { color: PAL.thread, pbr: THREAD_PBR, uv: 'thread', ws: S, bone: o.bone });
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
  parts.add(G.sphere(r, 14, 10).translate(c[0], c[1], c[2]), { color: o.col ?? PAL.eye, pbr: BEAD_PBR, bone: o.bone, ws: o.ws });
  if (o.socket) S.bulge(p, [r * 1.7, r * 1.7, r * 1.7], -0.0035 * o.socket, null, { sharp: 2 });
  const ring = G.torus(r * 1.0, 0.0018, 4, 16);
  parts.add(G.placeAt(ring, add3(p, n, 0.0005), n), { color: PAL.thread, pbr: THREAD_PBR, bone: o.bone, ws: o.ws });
}

// ---------------------------------------------------------------------------
// stitches: pts = [{p, n}] along a seam/scar (surface samples)
export function runningStitch(parts, pts, o = {}) {
  const size = o.size ?? 0.009, gap = o.gap ?? 0.015;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = len3(sub3(b.p, a.p));
    const t = norm3(sub3(b.p, a.p));
    for (let s = acc; s < seg; s += gap) {
      const u = s / seg;
      const c = add3(a.p, sub3(b.p, a.p), u), n = norm3(add3(a.n, sub3(b.n, a.n), u));
      const side = norm3(cross3(n, t));
      const p0 = add3(add3(c, side, -size * 0.5), n, 0.0012), p1 = add3(add3(c, side, size * 0.5), n, 0.0012), pm = add3(add3(c, n, 0.0028), t, 0.0);
      parts.add(G.tube([p0, pm, p1], 0.0021, 4), { color: o.color ?? PAL.thread, pbr: THREAD_PBR, uv: 'thread', ws: o.ws, bone: o.bone });
    }
    acc = Math.max(0, acc - seg + Math.ceil((seg - acc) / gap) * gap - seg + seg) % gap;
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
      parts.add(G.tube([p0, pm, p1], o.r ?? 0.0024, 4), { color: o.color ?? PAL.thread, pbr: THREAD_PBR, uv: 'thread', ws: o.ws, bone: o.bone });
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
// MITTEN GLOVE (hand sculpt). F: origin at wrist, -Y toward fingertips; side -1 left / +1 right.
// o.fingers: [{len, r, curl}] (index..pinky), o.thumb, bones: hand + optional finger chains
export function glove(S, F, side, o = {}) {
  const col = o.col ?? PAL.rubber;
  const bone = o.bone;
  S.push({ mat: MAT.RUBBER, col, bone, k: 0.02, dirt: 0.2, noise: [0.0015, 30] });
  // cuff into the sleeve (forearm bone)
  S.cone(F.p(0, 0.075, 0), F.p(0, -0.01, 0), o.cuffR ?? 0.052, 0.046, { bone: o.cuffBone ?? bone, bone2: bone, t0: 0.4, t1: 0.95, k: 0.02 });
  S.torus(F.p(0, 0.05, 0), (o.cuffR ?? 0.052) + 0.002, 0.007, F.q, { k: 0.008, bone: o.cuffBone ?? bone });
  // palm
  S.ell(F.p(0, -0.05, 0), [0.03, 0.055, 0.048], F.q, { k: 0.03 });
  S.ell(F.p(-side * 0.008, -0.09, 0.0), [0.026, 0.03, 0.05], F.q, { k: 0.025 });
  // fingers: chains (index at front -Z, pinky at back +Z)
  const fingers = o.fingers || [{ len: 0.05 }, { len: 0.055 }, { len: 0.05 }, { len: 0.042 }];
  const out = [];
  fingers.forEach((f, i) => {
    const z = lerp(-0.033, 0.033, fingers.length > 1 ? i / (fingers.length - 1) : 0.5);
    const r = f.r ?? 0.0155;
    const segs = f.segs ?? 3, L = f.len;
    const curl = f.curl ?? 0.25;
    const pts = [F.p(-side * 0.004, -0.095, z)];
    let ang = 0, px = -side * 0.004, py = -0.095;
    for (let s = 0; s < segs; s++) {
      ang += curl / segs * (s + 1);
      px += -side * Math.sin(ang) * (L / segs); py += -Math.cos(ang) * (L / segs);
      pts.push(F.p(px, py, z + (f.splay ?? 0) * (s + 1) / segs));
    }
    const radii = pts.map((_, k) => r * (1 - k * 0.07) * (k === pts.length - 1 ? 0.96 : 1));
    const bones = f.bones || [bone];
    S.chain(pts, radii, { bones, k: 0.012 });
    out.push(pts);
    if (f.knuckles !== false) for (let s = 1; s < pts.length - 1; s++) S.fold(pts[s], r * 1.6, sub3(pts[s + 1], pts[s - 1]), 260, 0.0012, { warp: 0.2 });
  });
  // thumb
  const th = o.thumb ?? { len: 0.045 };
  const tp = [F.p(-side * 0.012, -0.045, -0.035), F.p(-side * 0.02, -0.07, -0.058), F.p(-side * 0.018, -0.07 - th.len * 0.6, -0.068)];
  S.chain(tp, [0.019, 0.016, 0.0145], { bones: th.bones || [bone], k: 0.016 });
  S.pop();
  return { fingers: out, thumb: tp };
}

// RUBBER BOOT (foot sculpt). F: origin at ankle (≈0.1 above the floor), -Z forward.
export function boot(S, F, o = {}) {
  const col = o.col ?? PAL.rubber, bone = o.bone;
  const s = o.scale ?? 1;
  S.push({ mat: MAT.RUBBER, col, bone, k: 0.03, dirt: 0.45, noise: [0.002, 25] });
  S.cone(F.p(0, (o.shaft ?? 0.13), 0), F.p(0, 0, 0), 0.072 * s, 0.066 * s, { bone: o.shinBone ?? bone, bone2: bone, t0: 0.5, t1: 1 });
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
// DUCT TAPE wrapped around a limb: centre + axis; traced onto sculpt S. o: {turns, width, lift, loose}
export function tape(parts, S, center, axis, o = {}) {
  const ax = norm3(axis);
  let u = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  u = norm3(sub3(u, [ax[0] * dot3(u, ax), ax[1] * dot3(u, ax), ax[2] * dot3(u, ax)]));
  const v = cross3(ax, u);
  const turns = o.turns ?? 1.6, width = o.width ?? 0.038, N = Math.ceil(28 * turns), R = o.reach ?? 0.12;
  const rng = new RNG(o.seed ?? 3);
  const pts = [], nrm = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * turns * TAU + (o.phase ?? 0);
    const dir = add3([u[0] * Math.cos(a), u[1] * Math.cos(a), u[2] * Math.cos(a)], v, Math.sin(a));
    const along = (i / N - 0.5) * width * 0.75 * turns + (o.offset ?? 0);
    const c = add3(center, ax, along);
    const r = hit(S, add3(c, dir, R), [-dir[0], -dir[1], -dir[2]], R * 1.6);
    let p, n;
    if (r) { p = r.p; n = r.n; } else { p = add3(c, dir, R * 0.5); n = dir; }
    const lift = (o.lift ?? 0.0025) + i * 0.00004 + rng.next() * 0.0006;
    pts.push(add3(p, n, lift)); nrm.push(n);
  }
  // loose peeling end
  if (o.loose !== false) {
    const k = Math.max(3, Math.floor(N * 0.12));
    for (let i = N - k; i <= N; i++) { const f = (i - (N - k)) / k; pts[i] = add3(pts[i], nrm[i], f * f * (o.peel ?? 0.025)); pts[i] = add3(pts[i], [0, -1, 0], f * f * 0.012); }
  }
  const g = G.ribbon(pts, nrm, width, { uScale: 1 / 0.7 });
  parts.add(g, { color: o.color ?? PAL.tape, pbr: [0.42, 0.25, 0.25, 0], uv: 'tape', ws: S, bone: o.bone });
  return pts;
}

// strip of tape laid flat over a surface path (patches, taped seams): pts [{p,n}]
export function tapeStrip(parts, S, pts, o = {}) {
  const P = pts.map((q) => add3(q.p, q.n, o.lift ?? 0.0025)), N = pts.map((q) => q.n);
  const g = G.ribbon(P, N, o.width ?? 0.036, { uScale: 1 / 0.7 });
  parts.add(g, { color: o.color ?? PAL.tape, pbr: [0.42, 0.25, 0.25, 0], uv: 'tape', ws: S, bone: o.bone });
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
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); uv.setX(i, ((a / TAU + 1) % 1) / cover); }
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
