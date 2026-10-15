// R.O.O.M. — clone android head shape + face layout (pure math, no rig / three-mesh dependency).
//
// Head-bone space: origin = the neck pivot (atlas joint), +Y up, the face looks toward -Z, +X is the
// character's right. The skull is a deformed ellipsoid around HC parametrised by azimuth th
// (0 = front, +PI/2 = right ear) and elevation ph (+PI/2 = crown). The porcelain face plate covers
// th in [th0, th1] x ph in [ph0, ph1] and carries a sculpted relief (nose, sockets, brow ridge,
// cheekbones, lips, chin); the ventriloquist jaw is the strip under the mouth line between the two
// marionette cuts at |th| < jawTh. Everything that sits on the face is placed through headPoint().
import * as THREE from 'three';

const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const g1 = (x) => Math.exp(-x * x);

export const HC = new THREE.Vector3(0, 0.088, -0.012);
export const HR = { x: 0.079, y: 0.105, z: 0.1 };
export const FACE = {
  th0: -1.08, th1: 1.08, ph0: -1.0, ph1: 0.68,
  mouth: -0.42, mouthW: 0.29, jawTh: 0.31,
  eyeTh: 0.39, eyePh: 0.13, seamPh: 0.035, browTh: 0.37, browPh: 0.305,
};
export const EYE = { r: 0.0125, d: 0.0068, rBig: 0.019, rButton: 0.0148, rOdd: 0.0145 };
export const PLATE_T = 0.0028;   // plate thickness above the skull

// raw skull point (relative to HC) for azimuth th / elevation ph
export function headRaw(th, ph, out) {
  const cp = Math.cos(ph), sp = Math.sin(ph), ct = Math.cos(th), st = Math.sin(th);
  let x = HR.x * cp * st, y = HR.y * sp, z = -HR.z * cp * ct;
  if (sp < 0) {
    const k = Math.pow(-sp, 1.5);
    x *= 1 - 0.3 * k;                          // jaw narrows toward the chin
    if (ct > 0) z -= 0.013 * k * ct * ct;      // chin forward
    else z *= 1 - 0.2 * k;                     // the nape tucks in
  }
  if (ct < 0) z *= 1.06; else z *= 0.97;       // fuller back of the skull, flatter face
  if (sp > 0.55) x *= 1 - 0.08 * (sp - 0.55);  // crown
  // flat temples: a cheap two-part mould, slightly boxy at the sides
  x *= 1 + 0.035 * g1((ph - 0.25) / 0.35) * Math.pow(Math.abs(st), 3);
  return out.set(x, y, z);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
// point at offset `off` along the (numerical) outward normal; head-bone space
export function headPoint(th, ph, off = 0, out = new THREE.Vector3(), nrm = null) {
  const e = 0.002;
  headRaw(th, ph, _c);
  headRaw(th + e, ph, _a).sub(_c); headRaw(th, ph + e, _b).sub(_c);
  const n = _n.crossVectors(_a, _b).normalize();
  if (n.dot(_c) < 0) n.negate();
  if (Math.abs(Math.cos(ph)) < 1e-3) n.copy(_c).normalize();
  if (nrm) nrm.copy(n);
  return out.copy(_c).addScaledVector(n, off).add(HC);
}

// sculpted face relief (metres along the normal). kind: 'normal' | 'cyclops' (one central socket)
export function faceRelief(th, ph, kind = 'normal') {
  let d = 0;
  const cyc = kind === 'cyclops';
  // nose: bridge -> tip with a sharp underside (the cyclops has no bridge, only a stub nose)
  const np = ph > -0.2 ? sstep(cyc ? 0.02 : 0.17, -0.2, ph) : sstep(-0.31, -0.2, ph);
  d += 0.0168 * np * g1(th / (0.055 + 0.05 * sstep(0.1, -0.25, ph))) * (ph < 0.17 ? 1 : 0);
  d += 0.0042 * g1((ph + 0.27) / 0.03) * (g1((th - 0.05) / 0.032) + g1((th + 0.05) / 0.032));   // nostril wings
  if (cyc) {
    d -= 0.009 * g1(th / 0.26) * g1((ph - FACE.eyePh - 0.03) / 0.15);
    d += 0.005 * g1(th / 0.3) * g1((ph - 0.36) / 0.06);
  } else {
    for (const s of [-1, 1]) {
      d -= 0.006 * g1((th - s * FACE.eyeTh) / 0.19) * g1((ph - FACE.eyePh) / 0.11);            // eye sockets
      d += 0.0045 * g1((th - s * 0.33) / 0.2) * g1((ph - 0.3) / 0.055);                          // brow ridge
    }
  }
  for (const s of [-1, 1]) d += 0.0048 * g1((th - s * 0.53) / 0.15) * g1((ph + 0.06) / 0.12);   // cheekbones
  d += 0.0034 * g1((ph + 0.38) / 0.03) * g1(th / 0.2);       // upper lip
  d += 0.0042 * g1((ph + 0.47) / 0.035) * g1(th / 0.18);     // lower lip
  d -= 0.0022 * g1((ph - FACE.mouth) / 0.012) * g1(th / 0.26); // lip parting
  d += 0.0068 * g1((ph + 0.77) / 0.1) * g1(th / 0.22);       // chin
  d -= 0.0028 * g1((ph + 0.57) / 0.05) * g1(th / 0.12);      // mentolabial dip
  return d;
}
// plate surface offset over the skull: thickness + relief + the seam across the face (the upper
// mould half sits 0.6 mm proud of the lower one, with a groove between them)
export function plateOff(th, ph, kind = 'normal') {
  return PLATE_T + faceRelief(th, ph, kind) + 0.0006 * sstep(FACE.seamPh - 0.004, FACE.seamPh + 0.004, ph) - 0.001 * g1((ph - FACE.seamPh) / 0.005);
}
export const isJaw = (th, ph) => ph < FACE.mouth && Math.abs(th) < FACE.jawTh;
export const inPlate = (th, ph, m = 0) => th > FACE.th0 + m && th < FACE.th1 - m && ph > FACE.ph0 + m && ph < FACE.ph1 - m;

// eye layout per face variant: [{ side: 'L'|'R', th, ph, r }]
export function eyeLayout(kind = 'normal') {
  if (kind === 'cyclops') return [{ side: 'L', th: 0, ph: FACE.eyePh + 0.03, r: EYE.rBig }];
  return [-1, 1].map((s) => ({
    side: s < 0 ? 'L' : 'R', th: s * FACE.eyeTh, ph: FACE.eyePh,
    r: kind === 'button' ? EYE.rButton : kind === 'mismatch' && s > 0 ? EYE.rOdd : EYE.r,
  }));
}
// eyeball centre (head space) + outward plate normal there
export function eyeCentre(e, kind, out = new THREE.Vector3(), nrm = new THREE.Vector3()) {
  const depth = e.r * (EYE.d / EYE.r);
  return headPoint(e.th, e.ph, plateOff(e.th, e.ph, kind) - depth, out, nrm);
}
// face-relative rest positions for the face bones (head space)
export function faceBoneRests(kind = 'normal') {
  const out = {};
  const eyes = eyeLayout(kind);
  for (const e of eyes) {
    const c = eyeCentre(e, kind);
    out['eye' + e.side] = c.toArray();
  }
  if (eyes.length === 1) out.eyeR = out.eyeL.slice();
  for (const S of ['L', 'R']) out['lid' + S] = out['eye' + S];
  const s = (S) => (S === 'L' ? -1 : 1);
  for (const S of ['L', 'R']) {
    const th = kind === 'cyclops' ? s(S) * 0.12 : s(S) * FACE.browTh, ph = kind === 'cyclops' ? 0.4 : FACE.browPh;
    out['brow' + S] = headPoint(th, ph, plateOff(th, ph, kind) + 0.0008).toArray();
  }
  out.jaw = [0, HC.y - 0.03, HC.z + 0.03];
  return out;
}
export const EAR = { th: PI / 2, ph: 0.02 };
