// R.O.O.M. — the PEAK sack face: two small glossy black glass beads set wide apart, a big
// fuzzy red felt clown nose, short stitched brows and a tiny stitched mouth.
//
// Beads are static geometry on the eye bones (they squash to blink). The nose and every thread
// live in one dynamic "face" geometry (felt material, skinned to the head / nose bones) that
// is re-stitched whenever the expression changes: brows raise / tilt / arch, the mouth bends,
// wobbles, opens into a felt-lined hole with teeth or a tongue, eyes become happy or sleepy
// arcs, X stitches when dead, blush patches grow.
import * as THREE from 'three';
import { clamp, lerp } from './kit.js';
import { RNG, valueNoise2 } from '../../core/rng.js';
import { FACE, facePt, frameQ, SACK } from './sack.js';
import { BI, Y } from './dollrig.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const THREAD = 0x241510, NOSE_RED = 0xc42c2a, BEAD = 0x070708, BLUSH = 0xe07a7a, MOUTH_IN = 0x2a0c0e, TONGUE = 0xd8707a, TOOTH = 0xf2ede0;

// ---------------------------------------------------------------------------
// Bone rests for the face (head space): bead centres and nose centre with surface frames
// ---------------------------------------------------------------------------
export function faceRests(face = {}) {
  const out = {};
  const cyc = face.eyes === 'cyclops';
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const x = cyc ? 0 : s * FACE.eyeX, y = cyc ? FACE.eyeY + 0.012 : FACE.eyeY;
    const n = V(), p = facePt(x, y, 0, V(), n);
    const r = eyeRadius(face, s);
    p.addScaledVector(n, r * 0.38);
    out['eye' + S] = { p: p.toArray(), q: frameQ(n) };
  }
  const n = V(), p = facePt(0, FACE.noseY, 0, V(), n);
  p.addScaledVector(n, FACE.noseR * 0.42);
  out.nose = { p: p.toArray(), q: frameQ(n) };
  return out;
}
export function eyeRadius(face, s) {
  if (face.eyes === 'cyclops') return 0.031;
  if (face.eyes === 'button' || (face.eyes === 'mismatch' && s > 0)) return 0.026;
  return FACE.eyeR;
}

// glass bead in the eye bone's space (+Z out of the face), with a baked catch-light
export function beadGeo(r, s = 1) {
  const g = new THREE.SphereGeometry(r, 22, 14);
  g.scale(1, 1, 0.84);
  const P = g.attributes.position, n = P.count, col = new Float32Array(n * 3);
  const hl = V(0.42 * s, 0.55, 0.72).normalize(), hl2 = V(-0.35 * s, -0.4, 0.84).normalize(), q = V();
  for (let i = 0; i < n; i++) {
    q.fromBufferAttribute(P, i).normalize();
    const a = q.dot(hl), b = q.dot(hl2);
    let c = 0.028 + 0.95 * smoothstep(0.93, 0.965, a) + 0.18 * smoothstep(0.97, 0.99, b);
    c += 0.035 * smoothstep(0.2, -0.4, q.z);  // bead hole / thread shadow at the back
    col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c * 1.04;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// 4-hole sewing button (button eyes)
export function buttonGeo(r) {
  const prof = [[0, 0.003], [r * 0.6, 0.0045], [r * 0.82, 0.004], [r * 0.95, 0.0055], [r, 0.003], [r * 0.98, -0.002], [0, -0.002]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28).rotateX(PI / 2);
  const P = g.attributes.position, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i);
    let c = 0.12;
    for (const [hx, hy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) if (Math.hypot(x - hx * r * 0.3, y - hy * r * 0.3) < r * 0.15) c = 0.02;
    col[i * 3] = c * 1.2; col[i * 3 + 1] = c * 0.9; col[i * 3 + 2] = c * 0.75;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// fuzzy felt nose (nose bone space, +Z out of the face)
export function noseGeo(r = FACE.noseR, seed = 11) {
  const g = new THREE.SphereGeometry(r, 28, 20);
  const P = g.attributes.position, q = V();
  for (let i = 0; i < P.count; i++) {
    q.fromBufferAttribute(P, i);
    const u = Math.atan2(q.x, q.y), v = q.z / r;
    let k = 1 + (valueNoise2(u * 3 + seed, v * 4 + seed, seed) - 0.5) * 0.07 + (valueNoise2(u * 11, v * 13, seed + 3) - 0.5) * 0.025 + (valueNoise2(u * 40, v * 45, seed + 7) - 0.5) * 0.012;
    // gathered where it is sewn to the face (back side): radial pleats + tuck
    const back = smoothstep(-0.2, -0.75, v);
    k *= 1 - back * (0.12 + 0.04 * Math.cos(u * 9));
    q.multiplyScalar(k);
    q.z *= 0.9;
    P.setXYZ(i, q.x, q.y * 0.98, q.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Expression parameters
// ---------------------------------------------------------------------------
export const MOUTH_SHAPES = {
  smile: { cl: 0.0035, cr: 0.0035 },
  grin: { w: 1.3, cl: 0.009, cr: 0.009, open: 0.5, teeth: 1, flatTop: 1 },
  flat: {},
  frown: { cl: -0.0065, cr: -0.0065 },
  o: { w: 0.42, open: 0.55, round: 1 },
  O: { w: 0.62, open: 1, round: 1 },
  wobble: { wav: 0.0032, cl: -0.002, cr: -0.002 },
  grit: { w: 1.15, open: 0.42, teeth: 1, grit: 1, cl: -0.004, cr: -0.004, flatTop: 1 },
  cat: { cat: 1, cl: 0.003, cr: 0.003, w: 1.1 },
  tongue: { cl: -0.002, cr: 0.004, tongue: 1, wav: 0.0014 },
  talk1: { w: 0.62, open: 0.38, round: 0.6 },
  talk2: { w: 0.82, open: 0.66, round: 0.4 },
  talk3: { w: 0.78, open: 1, round: 0.7 },
  shy: { w: 0.62, wav: 0.0022, cl: 0.003, cr: 0.003 },
  grumpy: { cl: -0.007, cr: -0.002, mid: 0.0015 },
  gap: { w: 1.15, cl: 0.008, cr: 0.008, open: 0.42, teeth: 2, flatTop: 1 },
};
const MKEYS = ['w', 'cl', 'cr', 'mid', 'open', 'round', 'wav', 'cat', 'teeth', 'tongue', 'grit', 'flatTop'];
export function mouthParams(name, out = {}) {
  const m = MOUTH_SHAPES[name] || MOUTH_SHAPES.smile;
  for (const k of MKEYS) out[k] = m[k] ?? (k === 'w' ? 1 : 0);
  return out;
}

// ---------------------------------------------------------------------------
// Dynamic face geometry
// ---------------------------------------------------------------------------
const TUBE_SEG = 6, TUBE_RING = 8;
const STITCH_V = TUBE_SEG * TUBE_RING;
const SLOTS = { browL: 2, browR: 2, mouthSt: 3, arcL: 3, arcR: 3, xL: 2, xR: 2 };
const LOOP_N = 28;                     // mouth outline points
const FILL_U = 14, FILL_V = 4;         // mouth interior grid
const TONG_U = 8, TONG_V = 3;
const BLUSH_SEG = 14;

export class FaceRig {
  constructor(face = {}, { headRest = V(0, Y.head, 0), noseMatrix = null, dead = false, seed = 5 } = {}) {
    this.face = face; this.dead = dead; this.seed = seed;
    this.headRest = headRest.clone();
    const nose = noseGeo();
    if (noseMatrix) nose.applyMatrix4(noseMatrix);
    // static extras (head space): freckles, whiskers, scar
    this.extra = [];
    if (face.freckles) { const r = new RNG(7); for (let i = 0; i < 14; i++) { const s = i % 2 ? 1 : -1; this.extra.push({ k: 'dot', x: s * (0.07 + r.next() * 0.085), y: 0.14 + r.next() * 0.07, r: 0.0034 + r.next() * 0.0016 }); } }
    if (face.whiskers) for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) this.extra.push({ k: 'line', a: [s * 0.06, 0.17 + i * 0.012], b: [s * 0.15, 0.165 + i * 0.03] });
    if (face.scar) { for (let i = 0; i < 6; i++) { const x = -0.06 - i * 0.016, y = 0.33 - i * 0.022; this.extra.push({ k: 'line', a: [x - 0.008, y - 0.007], b: [x + 0.008, y + 0.007] }); } this.extra.push({ k: 'scar' }); }
    // capacity
    const nStitch = Object.values(SLOTS).reduce((a, b) => a + b, 0) + this.extra.filter((e) => e.k === 'line').length + (face.scar ? 10 : 0);
    const nDots = this.extra.filter((e) => e.k === 'dot').length;
    this.nNose = nose.attributes.position.count;
    const nv = this.nNose + nStitch * STITCH_V + LOOP_N * 4 + (FILL_U + 1) * (FILL_V + 1) + (TONG_U + 1) * (TONG_V + 1) + 2 * (BLUSH_SEG + 1) * 3 + 2 * 4 + nDots * 9;
    this.capV = nv;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3); this.nor = new Float32Array(nv * 3); this.col = new Float32Array(nv * 3); this.uv = new Float32Array(nv * 2);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const idx = [];
    // nose
    this.pos.set(nose.attributes.position.array, 0); this.nor.set(nose.attributes.normal.array, 0);
    const ucs = nose.attributes.uv.array; for (let i = 0; i < this.nNose; i++) { this.uv[i * 2] = ucs[i * 2] * 0.35; this.uv[i * 2 + 1] = ucs[i * 2 + 1] * 0.18; }
    const nc = new THREE.Color(face.noseColor ?? NOSE_RED);
    for (let i = 0; i < this.nNose; i++) { this.col[i * 3] = nc.r; this.col[i * 3 + 1] = nc.g; this.col[i * 3 + 2] = nc.b; si[i * 4] = BI.nose; sw[i * 4] = 1; }
    for (const k of nose.index.array) idx.push(k);
    for (let i = this.nNose; i < nv; i++) { si[i * 4] = BI.head; sw[i * 4] = 1; }
    // dynamic layout
    this.slots = {};
    let v0 = this.nNose;
    const addTubeIdx = (start) => {
      for (let j = 0; j < TUBE_RING - 1; j++) for (let i = 0; i < TUBE_SEG; i++) {
        const a = start + j * TUBE_SEG + i, b = start + j * TUBE_SEG + ((i + 1) % TUBE_SEG), c = a + TUBE_SEG, d = b + TUBE_SEG;
        idx.push(a, d, b, a, c, d);
      }
    };
    for (const [name, n] of Object.entries(SLOTS)) { this.slots[name] = []; for (let k = 0; k < n; k++) { this.slots[name].push(v0); addTubeIdx(v0); v0 += STITCH_V; } }
    this.slots.extra = []; for (let k = 0; k < nStitch - Object.values(SLOTS).reduce((a, b) => a + b, 0); k++) { this.slots.extra.push(v0); addTubeIdx(v0); v0 += STITCH_V; }
    // mouth outline loop (closed tube, 4 segs)
    this.loop0 = v0;
    for (let j = 0; j < LOOP_N; j++) for (let i = 0; i < 4; i++) {
      const a = v0 + j * 4 + i, b = v0 + j * 4 + ((i + 1) % 4), c = v0 + ((j + 1) % LOOP_N) * 4 + i, d = v0 + ((j + 1) % LOOP_N) * 4 + ((i + 1) % 4);
      idx.push(a, d, b, a, c, d);
    }
    v0 += LOOP_N * 4;
    const gridIdx = (start, nu, nvv, flip = false) => { for (let j = 0; j < nvv; j++) for (let i = 0; i < nu; i++) { const a = start + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; if (flip) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c); } };
    this.fill0 = v0; gridIdx(v0, FILL_U, FILL_V, true); v0 += (FILL_U + 1) * (FILL_V + 1);
    this.tong0 = v0; gridIdx(v0, TONG_U, TONG_V, true); v0 += (TONG_U + 1) * (TONG_V + 1);
    this.blush0 = v0;
    for (let s = 0; s < 2; s++) { gridIdx(v0, BLUSH_SEG, 2); v0 += (BLUSH_SEG + 1) * 3; }
    this.teeth0 = v0;
    for (let k = 0; k < 2; k++) { idx.push(v0, v0 + 3, v0 + 1, v0, v0 + 2, v0 + 3); v0 += 4; }
    this.dots0 = v0;
    for (let k = 0; k < nDots; k++) { for (let i = 0; i < 8; i++) idx.push(v0, v0 + 1 + ((i + 1) % 8), v0 + 1 + i); v0 += 9; }
    this.nUsed = v0;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    this.geometry = g;
    this.key = '';
    this._p = V(); this._n = V(); this._a = V(); this._b = V(); this._m = V(); this._t = V(); this._s = V(); this._o = V(); this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this._ctl = [V(), V(), V()];
    // static extras once
    this._writeExtras();
  }

  // ---- low-level writers (head-space input -> rest space output) -----------------------
  _put(i, p, n, c) {
    const h = this.headRest;
    this.pos[i * 3] = p.x + h.x; this.pos[i * 3 + 1] = p.y + h.y; this.pos[i * 3 + 2] = p.z + h.z;
    this.nor[i * 3] = n.x; this.nor[i * 3 + 1] = n.y; this.nor[i * 3 + 2] = n.z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }
  _hide(start, n) {
    const h = this.headRest, px = h.x, py = h.y + SACK.cy, pz = h.z;
    for (let i = start; i < start + n; i++) { this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz; }
  }
  // one running stitch from face (ax, ay) to (bx, by): thread riding on the fabric that dives
  // into it at both ends (puckering the surface slightly)
  _stitch(start, ax, ay, bx, by, r, col, lift = 1) {
    if (start == null) return;
    const len = Math.hypot(bx - ax, by - ay), c = this._c.set(col);
    const P = this._p, N = this._n, T = this._t, Sd = this._s, nn = this._o, Pn = this._a, Pp = this._b;
    const pt = (t, out, nOut) => {
      const e = smoothstep(0, 0.22, t) * smoothstep(1, 0.78, t);
      const h = r * (0.82 * e - 0.5 * (1 - e)) + lift * len * 0.05 * Math.sin(PI * t);
      return facePt(lerp(ax, bx, t), lerp(ay, by, t), h, out, nOut);
    };
    let k = start;
    for (let j = 0; j < TUBE_RING; j++) {
      const t = j / (TUBE_RING - 1);
      pt(t, P, N);
      pt(Math.min(1, t + 0.05), Pn); pt(Math.max(0, t - 0.05), Pp);
      T.subVectors(Pn, Pp).normalize();
      Sd.crossVectors(T, N).normalize();
      nn.crossVectors(Sd, T).normalize();
      const e = smoothstep(0, 0.2, t) * smoothstep(1, 0.8, t);
      const rr = r * (0.55 + 0.45 * e);
      for (let i = 0; i < TUBE_SEG; i++) {
        const a = (i / TUBE_SEG) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const dx = Sd.x * ca + nn.x * sa, dy = Sd.y * ca + nn.y * sa, dz = Sd.z * ca + nn.z * sa;
        this.pos[k * 3] = P.x + dx * rr + this.headRest.x; this.pos[k * 3 + 1] = P.y + dy * rr + this.headRest.y; this.pos[k * 3 + 2] = P.z + dz * rr + this.headRest.z;
        this.nor[k * 3] = dx; this.nor[k * 3 + 1] = dy; this.nor[k * 3 + 2] = dz;
        this.col[k * 3] = c.r; this.col[k * 3 + 1] = c.g; this.col[k * 3 + 2] = c.b;
        k++;
      }
    }
  }
  // a stitched polyline: n stitches along fn(t) -> [x, y] with gaps between them
  _run(slots, fn, r, col, gap = 0.28, lift = 1) {
    const n = slots.length;
    for (let s = 0; s < n; s++) {
      const t0 = s / n + gap / n * 0.5, t1 = (s + 1) / n - gap / n * 0.5;
      const [ax, ay] = fn(t0), [bx, by] = fn(t1);
      this._stitch(slots[s], ax, ay, bx, by, r, col, lift);
    }
  }
  _writeExtras() {
    let li = 0, di = 0;
    const lines = this.slots.extra;
    for (const e of this.extra) {
      if (e.k === 'line') this._stitch(lines[li++], e.a[0], e.a[1], e.b[0], e.b[1], 0.0022, THREAD, 0.6);
      else if (e.k === 'scar') { const pts = []; for (let i = 0; i <= 10; i++) pts.push([-0.05 - i * 0.0105, 0.345 - i * 0.0145]); for (let i = 0; i < 10; i++) this._stitch(lines[li++], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.0028, 0x6a3a2a, 0.3); }
      else if (e.k === 'dot') {
        const base = this.dots0 + di * 9; di++;
        const n = this._n, c = this._c.set(0x7a4a2c);
        const p = facePt(e.x, e.y, 0.0007, this._p, n);
        this._put(base, p, n, c);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; const q = facePt(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r * 0.85, 0.0003, this._a); this._put(base + 1 + i, q, n, c); }
      }
    }
    for (let k = li; k < lines.length; k++) this._hide(lines[k], STITCH_V);
  }

  // ---- expression update ----------------------------------------------------------------
  // F: { browY:[l,r], browRot:[l,r], browArch, mouth:{...MKEYS}, eyeOpen:[l,r], eyeMode, x, blush, t }
  update(F) {
    const q = (v) => Math.round(v * 2000);
    const m = F.mouth;
    const key = [q(F.browY[0]), q(F.browY[1]), q(F.browRot[0] * 0.05), q(F.browRot[1] * 0.05), q(F.browArch * 0.1), q(F.eyeOpen[0] * 0.01), q(F.eyeOpen[1] * 0.01), F.eyeMode, F.x > 0.5 ? 1 : 0, q(F.blush * 0.01),
      ...MKEYS.map((k) => q((m[k] || 0) * (k === 'cl' || k === 'cr' || k === 'mid' || k === 'wav' ? 1 : 0.01))), m.wav || m.grit ? Math.round(F.t * 12) : 0].join(',');
    if (key === this.key) return false;
    this.key = key;
    const fc = this.face, cyc = fc.eyes === 'cyclops';
    // brows
    for (const [S, s] of [['L', -1], ['R', 1]]) {
      const slots = this.slots['brow' + S];
      if (cyc && s > 0) { for (const k of slots) this._hide(k, STITCH_V); continue; }
      const i = s < 0 ? 0 : 1;
      const bx = cyc ? 0 : s * FACE.browX, by = FACE.browY + F.browY[i] + (cyc ? 0.01 : 0), w = cyc ? FACE.browW * 1.4 : FACE.browW;
      const rot = F.browRot[i], arch = F.browArch;
      this._run(slots, (t) => {
        const u = (t - 0.5) * w;                                      // along the brow (inner -> outer for each side)
        const xx = bx + u * Math.cos(rot) * (cyc ? 1 : -s);
        const yy = by + u * Math.sin(rot) * (cyc ? 1 : 1) + arch * 0.008 * (1 - 4 * (t - 0.5) * (t - 0.5));
        return [xx, yy];
      }, 0.0046, THREAD, 0.06, 0.55);
    }
    // eyes: arcs (happy / closed) and X
    const closedL = F.eyeMode > 0 || F.eyeOpen[0] < 0.3, closedR = F.eyeMode > 0 || F.eyeOpen[1] < 0.3;
    for (const [S, s, closed] of [['L', -1, closedL], ['R', 1, closedR]]) {
      const arc = this.slots['arc' + S], xs = this.slots['x' + S];
      const ex = cyc ? 0 : s * FACE.eyeX, ey = FACE.eyeY + (cyc ? 0.012 : 0), er = cyc ? 0.03 : FACE.eyeR * 1.15;
      if (F.x > 0.5) {
        this._stitch(xs[0], ex - er, ey - er, ex + er, ey + er, 0.0042, THREAD, 0.6);
        this._stitch(xs[1], ex - er, ey + er, ex + er, ey - er, 0.0042, THREAD, 0.6);
        for (const k of arc) this._hide(k, STITCH_V);
      } else {
        for (const k of xs) this._hide(k, STITCH_V);
        if (closed && !(cyc && s > 0)) {
          const up = F.eyeMode === 1 ? 1 : -1;  // happy arcs bow upward
          this._run(arc, (t) => { const u = (t - 0.5) * 2; return [ex + u * er * 1.05, ey + up * (1 - u * u) * er * 0.55 - up * er * 0.1]; }, 0.0034, THREAD, 0.12, 0.6);
        } else for (const k of arc) this._hide(k, STITCH_V);
      }
    }
    // mouth
    this._mouth(F);
    // blush
    for (let s = 0; s < 2; s++) {
      const base = this.blush0 + s * (BLUSH_SEG + 1) * 3, sg = s ? 1 : -1, amt = clamp(F.blush, 0, 2);
      if (amt < 0.05) { this._hide(base, (BLUSH_SEG + 1) * 3); continue; }
      const c = this._c.set(BLUSH), n = this._n;
      const cx = sg * FACE.blushX, cy = FACE.blushY, rx = 0.024 * Math.sqrt(amt), ry = 0.015 * Math.sqrt(amt);
      for (let j = 0; j < 3; j++) for (let i = 0; i <= BLUSH_SEG; i++) {
        const a = (i / BLUSH_SEG) * TAU, rr = j / 2;
        const p = facePt(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, 0.0012 - rr * 0.0006, this._p, n);
        const k = 0.75 + 0.25 * (1 - rr);
        this._put(base + j * (BLUSH_SEG + 1) + i, p, n, this._c2.setRGB(c.r * k, c.g * k, c.b * k));
      }
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.color.needsUpdate = true;
    return true;
  }

  _mouth(F) {
    const m = F.mouth, t = F.t || 0;
    const hw = FACE.mouthW * 0.5 * (m.w || 1), y0 = FACE.mouthY;
    const wob = (x) => (m.wav ? Math.sin((x / hw) * PI * 2 + t * 9) * m.wav : 0);
    // centre line of the mouth: corners lift by cl / cr, middle by mid, cat 'w'
    const line = (u) => {   // u in -1..1 (left .. right of the character = +x .. ? we use x = u * hw)
      const x = u * hw, corner = u < 0 ? m.cl : m.cr;
      return y0 + corner * u * u + (m.mid || 0) * (1 - u * u) + (m.cat ? 0.0055 * m.cat * (1 - Math.abs(Math.cos(u * PI))) - 0.002 * m.cat : 0) + wob(x);
    };
    const open = clamp(m.open || 0, 0, 1.2);
    const st = this.slots.mouthSt;
    if (open < 0.06) {
      // running stitch line
      this._run(st, (tt) => { const u = tt * 2 - 1; return [u * hw, line(u)]; }, 0.0033, THREAD, 0.1, 0.55);
      this._hide(this.loop0, LOOP_N * 4); this._hide(this.fill0, (FILL_U + 1) * (FILL_V + 1)); this._hide(this.tong0, (TONG_U + 1) * (TONG_V + 1)); this._hide(this.teeth0, 8);
      if (m.tongue) this._tongue(0, line(0.4), hw * 0.42, 0.016, true);
      return;
    }
    for (const k of st) this._hide(k, STITCH_V);
    // open mouth: upper lip follows the line (flat for grins), lower lip drops by depth(u)
    const depth = 0.019 * open;
    const rnd = m.round || 0;
    const upper = (u) => (m.flatTop ? y0 + (u < 0 ? m.cl : m.cr) * 0.9 + wob(u * hw) * 0.5 : line(u) + depth * 0.45 * rnd * Math.sqrt(Math.max(0, 1 - u * u)));
    const lower = (u) => line(u) - depth * Math.pow(Math.max(0, 1 - u * u), lerp(0.75, 0.5, rnd)) * (m.flatTop ? 1.15 : 1);
    // outline loop (thread)
    const c = this._c.set(THREAD), n = this._n;
    for (let j = 0; j < LOOP_N; j++) {
      const h = LOOP_N / 2, top = j < h, u = top ? -1 + (j / h) * 2 : 1 - ((j - h) / h) * 2;
      const y = top ? upper(u) : lower(u);
      const p = facePt(u * hw * 1.02, y, 0.0012, this._p, n);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU, r = 0.0021;
        const off = this._o.set(0, 0, 0).addScaledVector(n, Math.sin(a) * r);
        const radial = this._a.set(u * hw, y - y0, 0).normalize();
        off.addScaledVector(radial, Math.cos(a) * r);
        this._put(this.loop0 + j * 4 + i, this._b.copy(p).add(off), this._t.copy(off).normalize(), c);
      }
    }
    // interior fill (dark felt, slightly sunk)
    const ci = this._c.set(MOUTH_IN);
    for (let j = 0; j <= FILL_V; j++) for (let i = 0; i <= FILL_U; i++) {
      const u = -1 + (i / FILL_U) * 2, v = j / FILL_V;
      const y = lerp(lower(u), upper(u), v);
      const p = facePt(u * hw, y, -0.0012 * Math.sin(PI * v) * (1 - u * u) + 0.0004, this._p, n);
      const k = 0.65 + 0.35 * Math.abs(v - 0.5) * 2;
      this._put(this.fill0 + j * (FILL_U + 1) + i, p, n, this._c2.setRGB(ci.r * k, ci.g * k, ci.b * k));
    }
    // teeth (one block or two front teeth)
    if (m.teeth) {
      const ct = this._c.set(TOOTH);
      const blocks = m.teeth === 2 ? [[-0.42, -0.04], [0.04, 0.42]] : [[-0.62, 0.62]];
      for (let b = 0; b < 2; b++) {
        const base = this.teeth0 + b * 4;
        if (!blocks[b]) { this._hide(base, 4); continue; }
        const [u0, u1] = blocks[b], yt = Math.min(upper(u0), upper(u1)) - 0.0004, yb = yt - Math.min(depth * 0.45, 0.0075) * (m.grit ? 1.6 : 1);
        const quad = [[u0, yb], [u1, yb], [u0, yt], [u1, yt]];
        quad.forEach(([u, y], q) => { const p = facePt(u * hw, y, 0.0009, this._p, n); this._put(base + q, p, n, ct); });
      }
    } else this._hide(this.teeth0, 8);
    if (m.tongue || open > 0.55) this._tongue(0.08 * hw, lower(0) + depth * 0.32, hw * 0.48, depth * 0.38, false);
    else this._hide(this.tong0, (TONG_U + 1) * (TONG_V + 1));
  }
  _tongue(cx, cy, w, h, out) {
    const c = this._c.set(TONGUE), n = this._n;
    for (let j = 0; j <= TONG_V; j++) for (let i = 0; i <= TONG_U; i++) {
      const u = -1 + (i / TONG_U) * 2, v = j / TONG_V;
      const y = out ? cy - (1 - v) * h * 1.4 : cy - h * (1 - v) * Math.sqrt(Math.max(0, 1 - u * u));
      const x = cx + u * w * (out ? (1 - 0.35 * (1 - v)) * Math.sqrt(Math.max(0.15, 1 - Math.pow(1 - v, 6))) : 1);
      const p = facePt(x, y, (out ? 0.0028 * Math.sin(PI * (i / TONG_U)) + 0.0012 : 0.0008), this._p, n);
      const k = 0.85 + 0.15 * Math.sin(PI * (i / TONG_U));
      this._put(this.tong0 + j * (TONG_U + 1) + i, p, n, this._c2.setRGB(c.r * k, c.g * k, c.b * k));
    }
  }
}

// standalone stitch tube on the face (head-bone space) - for props / clones (static geometry)
export function stitchGeo(ax, ay, bx, by, r = 0.003, lift = 0.6, segs = 6, rings = 8) {
  const pos = [], nor = [], idx = [];
  const len = Math.hypot(bx - ax, by - ay);
  const P = V(), N = V(), Pn = V(), Pp = V(), T = V(), Sd = V(), nn = V();
  const pt = (t, out, nOut) => {
    const e = smoothstep(0, 0.22, t) * smoothstep(1, 0.78, t);
    const h = r * (0.82 * e - 0.5 * (1 - e)) + lift * len * 0.05 * Math.sin(PI * t);
    return facePt(lerp(ax, bx, t), lerp(ay, by, t), h, out, nOut);
  };
  for (let j = 0; j < rings; j++) {
    const t = j / (rings - 1);
    pt(t, P, N); pt(Math.min(1, t + 0.05), Pn); pt(Math.max(0, t - 0.05), Pp);
    T.subVectors(Pn, Pp).normalize(); Sd.crossVectors(T, N).normalize(); nn.crossVectors(Sd, T).normalize();
    const e = smoothstep(0, 0.2, t) * smoothstep(1, 0.8, t), rr = r * (0.55 + 0.45 * e);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const dx = Sd.x * ca + nn.x * sa, dy = Sd.y * ca + nn.y * sa, dz = Sd.z * ca + nn.z * sa;
      pos.push(P.x + dx * rr, P.y + dy * rr, P.z + dz * rr); nor.push(dx, dy, dz);
    }
  }
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = j * segs + ((i + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}
