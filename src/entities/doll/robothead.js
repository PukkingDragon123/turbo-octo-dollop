// R.O.O.M. — clone android head: ivory ABS skull with a mould parting line over the crown, a glazed
// porcelain face plate (painted face, see robotface.js) held on by four screws, a ventriloquist jaw
// that drops on a hinge, glassy eyes with LED pupils behind slow porcelain lids, moving plastic
// brows, speaker-grille ears, a barcode on the nape; and the neck: rubber bellows over a chrome
// core with two piston tendons and a loom of coloured cables at the back.
//
// Geometry is authored in head-bone space (robotshape.js) and bound through an RPartBuilder.
import * as THREE from 'three';
import { valueNoise2 } from '../../core/rng.js';
import { HC, HR, FACE, EYE, PLATE_T, headPoint, plateOff, isJaw, inPlate, eyeLayout, eyeCentre, faceBoneRests, EAR, sstep } from './robotshape.js';
import { RD, RY, NECK_Z, HEAD_Z, neckW, BI } from './robotrig.js';
import { faceU, faceV, PLAIN_UV } from './robotface.js';
import { tubeR, curvePts, ensureOutward, gridNormals } from './geom.js';
import { atlasUV } from './dolltex.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const g1 = (x) => Math.exp(-x * x);
export const lin = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
export const cat = (...arrs) => arrs.reduce((o, a) => (o.length ? o.concat(a.slice(1)) : a.slice()), []);
const constW = (bone) => (x, y, z, o) => o.reset().add(bone, 1);

// parametric grid from sample arrays (u along columns, v along rows); keep(uMid, vMid) culls cells
export function sgrid(us, vs, fn, keep = null) {
  const pos = [], uv = [], idx = [];
  const nu = us.length, nv = vs.length, p = V();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    fn(us[i], vs[j], p, i, j);
    pos.push(p.x, p.y, p.z);
    uv.push(i / (nu - 1), j / (nv - 1));
  }
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    if (keep && !keep((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2)) continue;
    const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// make the winding face away from c (outward)
export function outward(g, c) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, I = g.index.array;
  let s = 0;
  for (let i = 0; i < p.count; i += 3) s += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  if (s < 0) {
    for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}
// per-vertex colour from fn(x, y, z) -> scalar or [r, g, b]
export function vcol(g, fn) {
  const P = g.attributes.position, n = P.count, a = new Float32Array(n * 3);
  const f = typeof fn === 'function' ? fn : () => fn;
  for (let i = 0; i < n; i++) {
    const k = f(P.getX(i), P.getY(i), P.getZ(i), i);
    if (typeof k === 'number') { a[i * 3] = k; a[i * 3 + 1] = k; a[i * 3 + 2] = k; } else { a[i * 3] = k[0]; a[i * 3 + 1] = k[1]; a[i * 3 + 2] = k[2]; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const setUV = (g, u, v) => {
  let a = g.attributes.uv;
  if (!a) { a = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2); g.setAttribute('uv', a); }
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
};
// remap a geometry's 0..1 UVs into an atlas region
export function region(g, r) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) { const [u, v] = atlasUV(r, Math.min(1, Math.max(0, a.getX(i))), Math.min(1, Math.max(0, a.getY(i)))); a.setXY(i, u, v); }
  return g;
}
// align a geometry authored along +Y / facing +Z to a surface frame (normal n, up hint)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
export function frameAt(p, n, up = V(0, 1, 0)) {
  const z = n.clone().normalize(), x = V().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = V().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}
// small slotted screw head lying on a surface
export function screwGeo(p, n, r = 0.0028) {
  const g = new THREE.CylinderGeometry(r, r * 1.05, r * 0.7, 10).rotateX(PI / 2).translate(0, 0, r * 0.2);
  const slot = new THREE.BoxGeometry(r * 1.7, r * 0.32, r * 0.5).translate(0, 0, r * 0.55);
  vcol(g, 1); vcol(slot, 0.25);
  const m = frameAt(p, n);
  g.applyMatrix4(m); slot.applyMatrix4(m);
  return [g, slot];
}

// ---------------------------------------------------------------------------
// Head (skull, plate, jaw, eyes, lids, brows, ears, prints)
// ---------------------------------------------------------------------------
export function headKind(face = {}) {
  return face.eyes === 'cyclops' ? 'cyclops' : face.eyes === 'button' ? 'button' : face.eyes === 'mismatch' ? 'mismatch' : 'normal';
}

export function buildHead(B, face = {}) {
  const kind = headKind(face);
  // face bone rests for this eye layout
  const rests = faceBoneRests(kind === 'cyclops' ? 'cyclops' : 'normal');
  for (const S of ['L', 'R']) {
    B.setRest('eye' + S, rests['eye' + S]); B.setRest('lidU' + S, rests['lid' + S]); B.setRest('lidD' + S, rests['lid' + S]); B.setRest('brow' + S, rests['brow' + S]);
  }
  if (kind !== 'cyclops') for (const e of eyeLayout(kind)) {
    const c = eyeCentre(e, kind).toArray();
    B.setRest('eye' + e.side, c); B.setRest('lidU' + e.side, c); B.setRest('lidD' + e.side, c);
  }
  B.setRest('jaw', rests.jaw);
  const rk = kind === 'cyclops' ? 'cyclops' : 'normal';
  const plate = (th, ph) => plateOff(th, ph, rk);

  // ---- skull (ABS), with the plate window cut out, parting-line groove over the crown
  {
    const ths = lin(-PI, PI, 60), phs = lin(-PI / 2 + 0.05, PI / 2 - 0.002, 30);
    const g = sgrid(ths, phs, (th, ph, p) => headPoint(th, ph, 0.0003 * g1((Math.abs(th) - PI / 2) / 0.03), p), (th, ph) => !inPlate(th, ph, 0.05));
    outward(g, HC);
    vcol(g, (x, y, z) => {
      const ly = y - HC.y;
      let k = 0.8 + 0.2 * sstep(-0.11, 0.08, ly);                         // darker toward the jaw / nape
      k *= 1 - 0.45 * g1((z - HC.z) / 0.0016) * sstep(-0.02, 0.0, ly + 0.03); // parting line over the crown
      k *= 0.95 + (valueNoise2(x * 60 + 3, y * 60 + z * 40, 5) - 0.5) * 0.08;
      return k;
    });
    B.rigid('head', 'shell', g);
  }
  // ---- face plate + jaw (porcelain); uv = painted face
  const ths = cat(lin(FACE.th0, -FACE.jawTh, 12), lin(-FACE.jawTh, FACE.jawTh, 30), lin(FACE.jawTh, FACE.th1, 12));
  const phs = cat(lin(FACE.ph0, FACE.mouth, 16), lin(FACE.mouth, FACE.seamPh, 24), lin(FACE.seamPh, FACE.ph1, 18));
  const mkPlate = (keep) => {
    const g = sgrid(ths, phs, (th, ph, p) => headPoint(th, ph, plate(th, ph), p), keep);
    const uv = g.attributes.uv;
    let k = 0;
    for (let j = 0; j < phs.length; j++) for (let i = 0; i < ths.length; i++, k++) uv.setXY(k, faceU(ths[i]), faceV(phs[j]));
    outward(g, HC);
    vcol(g, 1);
    return g;
  };
  B.rigid('head', 'face', mkPlate((th, ph) => !isJaw(th, ph)), 0xffffff, { uv: false });
  B.boneSkinned('head', 'face', mkPlate((th, ph) => isJaw(th, ph)), constW('jaw'), 0xffffff, { uv: false });
  // plate edge wall (the plate is a separate part sitting proud of the skull: dark gap + thickness)
  {
    const per = [];
    for (const th of lin(FACE.th0, FACE.th1, 48)) per.push([th, FACE.ph0]);
    for (const ph of lin(FACE.ph0, FACE.ph1, 36).slice(1)) per.push([FACE.th1, ph]);
    for (const th of lin(FACE.th1, FACE.th0, 48).slice(1)) per.push([th, FACE.ph1]);
    for (const ph of lin(FACE.ph1, FACE.ph0, 36).slice(1)) per.push([FACE.th0, ph]);
    const pos = [], idx = [], col = [], p = V();
    per.forEach(([th, ph], i) => {
      headPoint(th, ph, plate(th, ph), p); pos.push(p.x, p.y, p.z); col.push(0.62, 0.6, 0.57);
      headPoint(th, ph, -0.002, p); pos.push(p.x, p.y, p.z); col.push(0.12, 0.11, 0.1);
      if (i < per.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); outward(g, HC);
    // the jaw piece is bound to the jaw bone: split the wall at the chin
    const P = g.attributes.position, jawIdx = [], headIdx = [];
    const I = g.index.array;
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t] >> 1;
      const [th, ph] = per[Math.min(per.length - 1, i0)];
      (isJaw(th, ph + 0.01) && ph < FACE.mouth ? jawIdx : headIdx).push(I[t], I[t + 1], I[t + 2]);
    }
    void P;
    const gh = g.clone(); gh.setIndex(headIdx);
    const gj = g.clone(); gj.setIndex(jawIdx);
    B.rigid('head', 'shell', gh);
    if (jawIdx.length) B.boneSkinned('head', 'shell', gj, constW('jaw'));
  }
  // jaw cut walls: the plate's thickness shows when the jaw drops (inner edge of the jaw piece and
  // the underside of the upper lip)
  {
    const wall = (pts, bone) => {
      const pos = [], idx = [], p = V(), n = V();
      pts.forEach(([th, ph], i) => {
        headPoint(th, ph, plate(th, ph), p, n); pos.push(p.x, p.y, p.z);
        headPoint(th, ph, plate(th, ph) - 0.009, p); pos.push(p.x, p.y, p.z);
        if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      g.computeVertexNormals();
      vcol(g, (x, y, z, i) => (i % 2 ? 0.55 : 0.92));
      setUV(g, PLAIN_UV[0], PLAIN_UV[1]);
      // double-sided by duplicating with flipped winding
      const g2 = g.clone(); const I2 = g2.index.array.slice(); for (let k = 0; k < I2.length; k += 3) { const t = I2[k + 1]; I2[k + 1] = I2[k + 2]; I2[k + 2] = t; } g2.setIndex(Array.from(I2)); g2.computeVertexNormals();
      for (const gg of [g, g2]) {
        if (bone === 'head') B.rigid('head', 'face', gg, 0xffffff, { uv: false });
        else B.boneSkinned('head', 'face', gg, constW('jaw'), 0xffffff, { uv: false });
      }
    };
    const jt = FACE.jawTh - 0.002, m = FACE.mouth;
    const jawEdge = cat(lin(FACE.ph0 + 0.002, m - 0.002, 10).map((ph) => [-jt, ph]), lin(-jt, jt, 22).map((th) => [th, m - 0.002]), lin(m - 0.002, FACE.ph0 + 0.002, 10).map((ph) => [jt, ph]));
    wall(jawEdge, 'jaw');
    wall(lin(-jt - 0.004, jt + 0.004, 22).map((th) => [th, m + 0.002]), 'head');
  }
  // mouth interior (dark rubber; the floor follows the jaw) + teeth
  {
    const mp = headPoint(0, FACE.mouth, 0, V());
    const cav = new THREE.SphereGeometry(1, 18, 12).scale(0.026, 0.021, 0.02).translate(0, mp.y - 0.004, mp.z + 0.027);
    vcol(cav, (x, y, z) => [0.16, 0.05, 0.06]);
    const mouthRestY = new THREE.Vector3(0, mp.y, mp.z).applyMatrix4(B.M[BI.head]).y;
    B.boneSkinned('head', 'rubber', cav, (x, y, z, o) => { const k = sstep(mouthRestY + 0.004, mouthRestY - 0.008, y); return o.reset().add('jaw', k).add('head', 1 - k); });
    const teeth = (ph, h, down, bone) => {
      const pts = lin(-0.24, 0.24, 10).map((th) => headPoint(th, ph, plate(th, ph) - 0.0075, V()));
      const list = [];
      pts.forEach((p, i) => {
        if (i === pts.length - 1) return;
        const q = pts[i + 1], c = p.clone().add(q).multiplyScalar(0.5), w = p.distanceTo(q) * 0.92;
        const b = new THREE.BoxGeometry(w, h, 0.0045).translate(0, down ? -h / 2 : h / 2, 0);
        b.rotateY(Math.atan2(-(q.z - p.z), q.x - p.x)).translate(c.x, c.y, c.z);
        list.push(b);
      });
      for (const b of list) { b.deleteAttribute('uv'); vcol(b, 0.95); if (bone === 'head') B.rigid('head', 'shell', b); else B.boneSkinned('head', 'shell', b, constW('jaw')); }
    };
    teeth(FACE.mouth + 0.012, 0.0065, true, 'head');
    teeth(FACE.mouth - 0.014, 0.0055, false, 'jaw');
  }
  // ---- eyes: glass eyeball (sclera), dark iris dome, LED pupil on its own bone
  for (const e of eyeLayout(kind)) {
    const S = e.side, r = e.r, eye = 'eye' + S, led = 'led' + S;
    if (kind === 'button') {
      const b = new THREE.SphereGeometry(r, 26, 14).scale(1, 1, 0.55);
      vcol(b, (x, y, z) => { const k = 0.05 + 0.6 * sstep(0.6, 0.95, (-z / (r * 0.55)) * 0.2 + (y / r) * 0.5 + 0.4) * 0.3; return [k, k, k * 1.05]; });
      B.rigid(eye, 'bead', b);
      const rim = new THREE.TorusGeometry(r * 0.98, r * 0.12, 8, 30).translate(0, 0, -r * 0.3);
      B.rigid(eye, 'plastic', rim, 0x2a2420);
      for (const [hx, hy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const d = new THREE.CircleGeometry(r * 0.17, 14).rotateY(PI).translate(hx * r * 0.32, hy * r * 0.32, -r * 0.56);
        B.rigid(led, 'decal', region(d, 'led'), 0xffffff, { uv: false });
      }
      continue;
    }
    const ball = new THREE.SphereGeometry(r, 22, 14);
    vcol(ball, (x, y, z) => {
      const f = -z / r; // 1 at the front
      const vein = (valueNoise2(Math.atan2(y, x) * 9 + (S === 'L' ? 3 : 7), f * 6, 3) > 0.74 ? 1 : 0) * sstep(0.2, 0.6, 1 - f) * 0.25;
      return [0.86 - 0.05 * (1 - f) + vein * 0.1, 0.83 - 0.08 * (1 - f) - vein * 0.25, 0.76 - 0.08 * (1 - f) - vein * 0.25];
    });
    B.rigid(eye, 'bead', ball);
    // iris: a slightly proud dome (cornea) in dark blue-grey glass
    const ia = 0.48;
    const iris = sgrid(lin(0, TAU, 28), lin(0, ia, 6), (a, t, p) => {
      const R = r + 0.0006 * Math.cos((t / ia) * PI / 2);
      p.set(Math.sin(t) * Math.cos(a) * R, Math.sin(t) * Math.sin(a) * R, -Math.cos(t) * R);
    });
    outward(iris, V());
    const ic = kind === 'mismatch' && S === 'R' ? [0.24, 0.06, 0.05] : [0.12, 0.16, 0.2];
    vcol(iris, (x, y, z) => { const t = Math.hypot(x, y) / (r * Math.sin(ia)); const k = 0.5 + 0.7 * t; return [ic[0] * k, ic[1] * k, ic[2] * k]; });
    B.rigid(eye, 'bead', iris);
    // LED pupil (emissive decal disc) riding just in front of the cornea
    const pr = r * 0.22;
    const disc = new THREE.CircleGeometry(pr, 18).rotateY(PI).translate(0, 0, -(r + 0.0009));
    B.rigid(led, 'decal', region(disc, kind === 'mismatch' && S === 'R' ? 'ledr' : 'led'), 0xffffff, { uv: false });
    if (kind === 'mismatch' && S === 'R') {
      // replacement eye: chrome socket ring + three screws
      const c = eyeCentre(e, kind), n = V(); headPoint(e.th, e.ph, 0, V(), n);
      const ring = new THREE.TorusGeometry(r * 1.22, 0.0016, 6, 30);
      ring.applyMatrix4(frameAt(c.clone().addScaledVector(n, r * 0.62), n));
      B.rigid('head', 'metal', vcol(ring, 0.85));
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3 + 0.4, th = e.th + Math.cos(a) * 0.2, ph = e.ph + Math.sin(a) * 0.16;
        const nn = V(), p = headPoint(th, ph, plate(th, ph) + 0.0004, V(), nn);
        for (const s of screwGeo(p, nn, 0.0019)) B.rigid('head', 'metal', s, 0xb8b4ac);
      }
    }
  }
  // ---- eyelids: thin porcelain shells round each eyeball on their own bones (closing = rotate)
  for (const e of eyeLayout(kind)) {
    const S = e.side, rl = e.r + 0.0011;
    const lid = (a0, a1, edgeAt) => {
      const g = sgrid(lin(-1.95, 1.95, 22), lin(a0, a1, 7), (b, a, p) => p.set(Math.sin(a) * Math.sin(b) * rl, Math.cos(a) * rl, -Math.sin(a) * Math.cos(b) * rl));
      outward(g, V());
      vcol(g, (x, y, z) => { const a = Math.acos(Math.max(-1, Math.min(1, y / rl))); return 1 - 0.35 * sstep(0.12, 0.0, Math.abs(a - edgeAt)); });
      setUV(g, PLAIN_UV[0], PLAIN_UV[1]);
      return g;
    };
    const up = lid(0.02, 1.02, 1.02), dn = lid(2.2, PI - 0.02, 2.2);
    B.rigid('lidU' + S, 'face', up, 0xffffff, { uv: false });
    B.rigid('lidD' + S, 'face', dn, 0xffffff, { uv: false });
    // lid rims (the cut edge of the shutter)
    const rim = (a, bone) => {
      const pts = lin(-1.95, 1.95, 20).map((b) => V(Math.sin(a) * Math.sin(b) * rl, Math.cos(a) * rl, -Math.sin(a) * Math.cos(b) * rl));
      const g = tubeR(pts, 0.00075, 5);
      vcol(g, 0.7); setUV(g, PLAIN_UV[0], PLAIN_UV[1]);
      B.rigid(bone, 'face', g, 0xffffff, { uv: false });
    };
    rim(1.02, 'lidU' + S); rim(2.2, 'lidD' + S);
  }
  // ---- brows: puppet-like moulded plastic bars (painted dark brown) on their own bones
  for (const S of (kind === 'cyclops' ? ['L', 'R'] : ['L', 'R'])) {
    const s = S === 'L' ? -1 : 1;
    const bth = kind === 'cyclops' ? s * 0.12 : s * FACE.browTh, bph = kind === 'cyclops' ? 0.4 : FACE.browPh;
    const o = new THREE.Vector3().fromArray(B.over['brow' + S].p);
    const pts = lin(-1, 1, 10).map((t) => {
      const th = bth + t * 0.13 * (kind === 'cyclops' ? 0.8 : 1), ph = bph + 0.022 * (1 - t * t) - 0.012 * t * s * (kind === 'cyclops' ? 1 : -1) * 0.5;
      return headPoint(th, ph, plate(th, ph) + 0.0016, V()).sub(o);
    });
    // slim moulded ridge under the painted hair-stroke brow (robotface.js)
    const g = tubeR(pts, (t) => 0.0015 * (0.5 + 0.5 * Math.sin(PI * Math.min(1, t * 1.1 + 0.05))), 7);
    g.scale(1, 0.9, 0.5);
    B.rigid('brow' + S, 'shell', vcol(g, [0.2, 0.135, 0.1]));
  }
  // ---- plate screws (corners) + temple screws
  for (const [th, ph] of [[-0.98, 0.56], [0.98, 0.56], [-0.92, -0.72], [0.92, -0.72]]) {
    const n = V(), p = headPoint(th, ph, plate(th, ph) + 0.0002, V(), n);
    for (const s of screwGeo(p, n, 0.0027)) B.rigid('head', 'metal', s, 0xb4b0a6);
  }
  // ---- ears: speaker grille in a chrome bezel with a rubber gasket
  for (const s of [-1, 1]) {
    const n = V(), p = headPoint(s * EAR.th, EAR.ph, 0, V(), n);
    const m = frameAt(p, n);
    const gasket = new THREE.TorusGeometry(0.0175, 0.0035, 8, 28).applyMatrix4(m);
    B.rigid('head', 'rubber', vcol(gasket, 0.2));
    const bez = new THREE.TorusGeometry(0.0158, 0.0016, 6, 28).translate(0, 0, 0.002).applyMatrix4(m);
    B.rigid('head', 'metal', vcol(bez, 0.8));
    const grille = new THREE.CircleGeometry(0.0152, 24).translate(0, 0, 0.0012).applyMatrix4(m);
    B.rigid('head', 'decal', region(grille, 'grille'), 0xffffff, { uv: false });
    // a status LED behind the ear (amber), and a tiny screw pair above it
    const lp = headPoint(s * 1.86, 0.22, 0.0004, V(), n.set(0, 0, 0));
    const lamp = new THREE.CircleGeometry(0.0028, 12).applyMatrix4(frameAt(lp, n));
    B.rigid('head', 'decal', region(lamp, 'amber'), 0xffffff, { uv: false });
  }
  // ---- nape prints: barcode + serial on the back of the skull, a vent slot grille
  {
    const deco = (thC, phC, wTh, hPh, reg) => {
      const g = sgrid(lin(thC - wTh / 2, thC + wTh / 2, 8), lin(phC - hPh / 2, phC + hPh / 2, 3), (th, ph, p) => headPoint(th, ph, 0.0006, p));
      outward(g, HC);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const [u, v] = atlasUV(reg, uv.getX(i), uv.getY(i)); uv.setXY(i, u, v); }
      B.rigid('head', 'decal', g, 0xffffff, { uv: false });
    };
    deco(PI, -0.32, 0.62, 0.17, 'barcode');
    deco(PI, -0.08, 0.86, 0.14, 'serial');
    for (let k = 0; k < 5; k++) {
      const ph = 0.38 + k * 0.07, n = V(), p = headPoint(PI, ph, 0.0002, V(), n);
      const slot = new THREE.CapsuleGeometry(0.0022, 0.03, 3, 6).rotateZ(PI / 2).applyMatrix4(frameAt(p, n));
      B.rigid('head', 'rubber', vcol(slot, 0.08));
    }
  }
}

// ---------------------------------------------------------------------------
// Neck: rubber bellows, chrome core, piston tendons, cable loom
// ---------------------------------------------------------------------------
export function buildNeck(B) {
  const y0 = RY.neck - 0.03, y1 = RY.head + 0.035, cz = NECK_Z + 0.002;
  const N = 14, prof = [];
  for (let i = 0; i <= N; i++) { const t = i / N; prof.push(new THREE.Vector2((i % 2 ? 0.043 : 0.0385) * (1 - 0.14 * t), y0 + (y1 - y0) * t)); }
  const bel = new THREE.LatheGeometry(prof, 26).translate(0, 0, cz);
  vcol(bel, (x, y, z, i) => 0.17 + 0.05 * ((Math.round((y - y0) / ((y1 - y0) / N))) % 2));
  B.skinned('rubber', bel, neckW, 0xffffff, { uvScale: 2 });
  // chrome core visible at the very top under the skull
  B.rigid('neck', 'metal', vcol(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 14).translate(0, 0.035, 0), 0.6));
  // piston tendons at the front: dark housing on the collar bone, chrome rod into the skull
  const head = V(0, RY.head, NECK_Z + HEAD_Z);
  for (const s of [-1, 1]) {
    const a = V(s * 0.03, RY.neck - 0.006, cz - 0.038), b = head.clone().add(V(s * 0.032, 0.012, -0.062));
    const d = b.clone().sub(a), L = d.length(), q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
    const housing = new THREE.CylinderGeometry(0.0062, 0.0062, L * 0.55, 10).translate(0, L * 0.275, 0).applyQuaternion(q).translate(a.x, a.y, a.z);
    const rod = new THREE.CylinderGeometry(0.0036, 0.0036, L * 0.6, 8).translate(0, L * 0.7, 0).applyQuaternion(q).translate(a.x, a.y, a.z);
    B.skinned('metal', vcol(housing, 0.32), (x, y, z, o) => o.reset().add('chest', 1));
    B.skinned('metal', vcol(rod, 0.95), (x, y, z, o) => o.reset().add('head', 1));
  }
  // cable loom at the back: red / yellow / black, bulging out between collar and skull
  const cols = [[0.55, 0.08, 0.06], [0.75, 0.6, 0.12], [0.08, 0.08, 0.09], [0.2, 0.32, 0.55]];
  cols.forEach((c, i) => {
    const x = (i - 1.5) * 0.009;
    const pts = curvePts([V(x, RY.neck - 0.035, 0.075), V(x * 1.4, RY.neck + 0.012, 0.07 + 0.004 * i), V(x * 1.6, RY.neck + 0.05, 0.064), V(x, RY.head + 0.04, 0.066)], 14);
    const g = tubeR(pts, 0.0032, 6);
    vcol(g, c);
    B.skinned('rubber', g, neckW, 0xffffff, { uv: false });
  });
}
export { constW };
