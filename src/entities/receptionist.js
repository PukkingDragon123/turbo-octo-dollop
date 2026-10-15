// GLORIA, R.O.O.M. reception unit RX-07: a 1990s corporate android receptionist seated behind the HQ
// reception desk. Ivory plastic shell with seams and screws, a porcelain face plate with a calm painted
// smile and a hinged ventriloquist jaw, glowing LED eyes under articulated eyelid shutters, a molded
// auburn bob, a headset, a navy blazer with shoulder pads over the robot torso, a silk scarf and
// articulated fingers. She types, breathes, blinks, tracks the nearest clone, twitches now and then and
// turns to stare at you whenever nobody is looking.
//
// Talking to her ([E]) replaces the old dispatch lever: she greets you by name, explains the job the
// first time, offers "Dispatch now?" and, on a second [E], presses the gate button that opens the HQ
// elevator (host-authoritative through the lobby's elevator).
//
// Root origin: on the floor under her seat, facing +Z (towards the visitors). ~24 draw calls: geometry
// is merged per moving part and material; all fingers are two InstancedMeshes.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { profile } from '../core/profile.js';
import { Device } from '../game/devices.js';
import { GBin, T } from './elevator.js';
import { VLRig, vlPatch } from './vlights.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x) => Math.exp(-x * x);
const lerp = (a, b, t) => a + (b - a) * t;

// palette
const IVORY = 0xe8e0cc, IVORY_D = 0xcfc5ad, HAIR = 0x5b2618, NAVY = 0x1c2541, NAVY_L = 0x2c3866, BLACK = 0x161618;
const RUBBER = 0x242322, CHROME = 0xd8d8d8, GOLD = 0xd9b45a, SCARF = 0x7c1830, SCARF_G = 0xc89a3c;

// ------------------------------------------------------------------------------------------ head shape
// head-local: origin at the neck pivot, face towards +Z
const HC = V(0, 0.108, 0.004);
const HR = { x: 0.075, y: 0.108, z: 0.095 };
const FACE = { th0: -1.06, th1: 1.06, ph0: -0.98, ph1: 0.66, mouth: -0.43, jawTh: 0.6, eyeTh: 0.36, eyePh: 0.13 };
const EYE_R = 0.0135, EYE_D = 0.0082; // eye dome radius, depth of its centre under the plate
const _n = V(), _pp = V();
function headRaw(th, ph, out) {
  const cp = Math.cos(ph), sp = Math.sin(ph), ct = Math.cos(th);
  let x = HR.x * cp * Math.sin(th), y = HR.y * sp, z = HR.z * cp * ct;
  if (sp < 0) {
    const k = Math.pow(-sp, 1.5);
    x *= 1 - 0.36 * k;                       // jaw narrows to the chin
    if (ct > 0) z += 0.014 * k * ct * ct;     // chin forward
    else z *= 1 - 0.18 * k;                   // nape tucks in
  }
  if (ct < 0) z *= 1.07;                      // fuller back of the skull
  else z *= 0.96;                             // flatter face
  if (sp > 0.55) x *= 1 - 0.1 * (sp - 0.55);  // crown
  return out.set(x, y, z);
}
// point at offset `off` along the (numerical) surface normal
function headPoint(th, ph, off, out = V(), nrm = null) {
  const e = 0.002;
  const p = headRaw(th, ph, V());
  const a = headRaw(th + e, ph, V()).sub(p), b = headRaw(th, ph + e, V()).sub(p);
  const n = _n.crossVectors(a, b).normalize();
  if (n.dot(p) < 0) n.negate();
  if (Math.abs(Math.cos(ph)) < 1e-3) n.copy(p).normalize();
  if (nrm) nrm.copy(n);
  return out.copy(p).addScaledVector(n, off).add(HC);
}
// sculpted face relief (metres, along the normal)
function faceRelief(th, ph) {
  let d = 0;
  // nose: bridge -> tip, sharp underside
  const np = ph > -0.2 ? sstep(0.16, -0.2, ph) : sstep(-0.31, -0.2, ph);
  d += 0.0165 * np * gauss(th / (0.06 + 0.05 * sstep(0.1, -0.25, ph))) * (ph < 0.16 ? 1 : 0);
  d += 0.004 * gauss((ph + 0.27) / 0.03) * (gauss((th - 0.045) / 0.03) + gauss((th + 0.045) / 0.03)); // nostril wings
  for (const s of [-1, 1]) {
    d -= 0.0055 * gauss((th - s * FACE.eyeTh) / 0.2) * gauss((ph - FACE.eyePh) / 0.11);         // eye sockets
    d += 0.0035 * gauss((th - s * 0.33) / 0.18) * gauss((ph - 0.29) / 0.05);                    // brow ridge
    d += 0.005 * gauss((th - s * 0.5) / 0.15) * gauss((ph + 0.07) / 0.12);                      // cheekbones
  }
  d += 0.0042 * gauss((ph + 0.385) / 0.03) * gauss(th / 0.2);   // upper lip
  d += 0.0055 * gauss((ph + 0.475) / 0.035) * gauss(th / 0.18); // lower lip
  d -= 0.0022 * gauss((ph - FACE.mouth) / 0.012) * gauss(th / 0.26); // lip parting
  d += 0.006 * gauss((ph + 0.74) / 0.1) * gauss(th / 0.2);       // chin
  d -= 0.003 * gauss((ph + 0.57) / 0.05) * gauss(th / 0.12);     // mentolabial dip
  return d;
}

// parametric grid from sample arrays (u along cols, v along rows) -> indexed geometry with uv
function sgrid(us, vs, fn, keep = null) {
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
const lin = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
const cat = (...arrs) => arrs.reduce((o, a) => (o.length ? o.concat(a.slice(1)) : a.slice()), []);
// make the winding face away from `c` (outward)
function outward(g, c) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  let s = 0;
  for (let i = 0; i < p.count; i += 7) s += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  if (s < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

// ------------------------------------------------------------------------------------------ textures
let TX = null;
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, srgb = true) { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; }
const FU = (th) => ((th - FACE.th0) / (FACE.th1 - FACE.th0)) * 512;
const FV = (ph) => (1 - (ph - FACE.ph0) / (FACE.ph1 - FACE.ph0)) * 512;
function faceTexture() {
  const c = canvas(512, 512), x = c.getContext('2d');
  // porcelain base, warm towards the cheeks, cooler at the temples
  const g = x.createRadialGradient(256, 250, 30, 256, 250, 330);
  g.addColorStop(0, '#f6f0e6'); g.addColorStop(0.7, '#efe6d8'); g.addColorStop(1, '#ddd2c0');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  const blob = (th, ph, rx, ry, col, a) => {
    const cx = FU(th), cy = FV(ph);
    const r = x.createRadialGradient(cx, cy, 0, cx, cy, rx);
    r.addColorStop(0, col.replace('A', a)); r.addColorStop(1, col.replace('A', 0));
    x.save(); x.translate(cx, cy); x.scale(1, ry / rx); x.translate(-cx, -cy);
    x.fillStyle = r; x.beginPath(); x.arc(cx, cy, rx, 0, TAU); x.fill(); x.restore();
  };
  for (const s of [-1, 1]) {
    blob(s * 0.52, -0.16, 70, 46, 'rgba(214,120,120,A)', 0.22);   // blush
    blob(s * FACE.eyeTh, FACE.eyePh + 0.04, 70, 44, 'rgba(120,90,120,A)', 0.24); // eyeshadow
    // eyeliner almond around the eye dome
    x.save();
    x.translate(FU(s * FACE.eyeTh), FV(FACE.eyePh));
    x.strokeStyle = 'rgba(30,18,16,0.85)'; x.lineWidth = 3.2;
    x.beginPath(); x.ellipse(0, 0, 46, 29, 0, PI * 1.04, PI * 1.96); x.stroke();
    x.lineWidth = 1.6; x.strokeStyle = 'rgba(40,24,20,0.55)';
    x.beginPath(); x.ellipse(0, 2, 44, 26, 0, PI * 0.1, PI * 0.9); x.stroke();
    // lashes at the outer corner
    x.strokeStyle = 'rgba(25,14,12,0.9)'; x.lineWidth = 1.6;
    for (let k = 0; k < 4; k++) { const a = PI * (1.62 + k * 0.09) * (s > 0 ? 1 : 1); const ex = Math.cos(a) * 46, ey = Math.sin(a) * 29; x.beginPath(); x.moveTo(s > 0 ? Math.abs(ex) : -Math.abs(ex), ey); x.lineTo((s > 0 ? Math.abs(ex) : -Math.abs(ex)) + s * 5, ey - 6); x.stroke(); }
    x.restore();
    // brows: thin, arched, slightly too high
    x.strokeStyle = 'rgba(58,30,20,0.9)'; x.lineWidth = 4; x.lineCap = 'round';
    x.beginPath();
    x.moveTo(FU(s * 0.17), FV(0.27)); x.quadraticCurveTo(FU(s * 0.33), FV(0.37), FU(s * 0.53), FV(0.29));
    x.stroke();
  }
  // lips: closed, calm smile; the parting line sits exactly on the jaw split
  const my = FV(FACE.mouth);
  const lip = (top) => {
    x.beginPath();
    x.moveTo(FU(-0.28), my - 2);
    if (top) {
      x.bezierCurveTo(FU(-0.15), FV(-0.4), FU(-0.07), FV(-0.36), FU(0), FV(-0.385));
      x.bezierCurveTo(FU(0.07), FV(-0.36), FU(0.15), FV(-0.4), FU(0.28), my - 2);
      x.quadraticCurveTo(FU(0), my + 3, FU(-0.28), my - 2);
    } else {
      x.quadraticCurveTo(FU(0), my + 3, FU(0.28), my - 2);
      x.bezierCurveTo(FU(0.16), FV(-0.5), FU(-0.16), FV(-0.5), FU(-0.28), my - 2);
    }
    x.closePath();
    const lg = x.createLinearGradient(0, FV(-0.36), 0, FV(-0.52));
    lg.addColorStop(0, '#a34a58'); lg.addColorStop(0.5, '#b65a66'); lg.addColorStop(1, '#8e3a48');
    x.fillStyle = lg; x.fill();
  };
  lip(true); lip(false);
  x.strokeStyle = 'rgba(70,20,30,0.9)'; x.lineWidth = 2.2;
  x.beginPath(); x.moveTo(FU(-0.29), my - 4); x.quadraticCurveTo(FU(0), my + 4, FU(0.29), my - 4); x.stroke();
  blob(0.02, -0.455, 18, 6, 'rgba(255,240,240,A)', 0.35); // lower lip gloss
  // nostrils + philtrum shading
  for (const s of [-1, 1]) blob(s * 0.035, -0.275, 7, 4, 'rgba(70,40,36,A)', 0.55);
  blob(0, -0.33, 10, 18, 'rgba(160,120,110,A)', 0.12);
  // beauty mark, a factory serial on the jaw line, panel seams
  x.fillStyle = 'rgba(50,28,24,0.85)'; x.beginPath(); x.arc(FU(0.2), FV(-0.33), 2.4, 0, TAU); x.fill();
  x.fillStyle = 'rgba(80,70,60,0.45)'; x.font = 'bold 11px "IBM Plex Mono", monospace'; x.textAlign = 'center';
  x.save(); x.translate(FU(-0.82), FV(-0.42)); x.rotate(-1.2); x.fillText('RX-07', 0, 0); x.restore();
  x.strokeStyle = 'rgba(60,50,40,0.35)'; x.lineWidth = 1.5;
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * 0.72), FV(0.4)); x.quadraticCurveTo(FU(s * 0.78), FV(0.0), FU(s * 0.66), FV(-0.4)); x.stroke(); }
  // ventriloquist jaw cut: from the mouth corners straight down to the chin edge
  x.strokeStyle = 'rgba(52,36,30,0.75)'; x.lineWidth = 2.4;
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(FU(s * FACE.jawTh), FV(FACE.mouth)); x.lineTo(FU(s * FACE.jawTh), FV(FACE.ph0)); x.stroke(); }
  x.beginPath(); x.moveTo(FU(-FACE.jawTh), FV(FACE.mouth)); x.lineTo(FU(-0.27), FV(FACE.mouth) - 2); x.moveTo(FU(0.27), FV(FACE.mouth) - 2); x.lineTo(FU(FACE.jawTh), FV(FACE.mouth)); x.stroke();
  // plate edge: dark gap fading in (the seam to the skull)
  const e = x.createLinearGradient(0, 0, 512, 0);
  e.addColorStop(0, 'rgba(40,30,24,0.9)'); e.addColorStop(0.035, 'rgba(40,30,24,0)'); e.addColorStop(0.965, 'rgba(40,30,24,0)'); e.addColorStop(1, 'rgba(40,30,24,0.9)');
  x.fillStyle = e; x.fillRect(0, 0, 512, 512);
  const ev = x.createLinearGradient(0, 0, 0, 512);
  ev.addColorStop(0, 'rgba(40,30,24,0.8)'); ev.addColorStop(0.03, 'rgba(40,30,24,0)'); ev.addColorStop(0.97, 'rgba(40,30,24,0)'); ev.addColorStop(1, 'rgba(40,30,24,0.9)');
  x.fillStyle = ev; x.fillRect(0, 0, 512, 512);
  // plain porcelain patch (eyelid uvs) in the top-left corner
  x.fillStyle = '#efe7da'; x.fillRect(0, 0, 24, 24);
  return ctex(c);
}
function badgeTexture() {
  const c = canvas(256, 96), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 96); g.addColorStop(0, '#f0d890'); g.addColorStop(1, '#b08a3e');
  x.fillStyle = g; x.fillRect(0, 0, 256, 96);
  x.fillStyle = '#1c2541'; x.fillRect(5, 5, 246, 86);
  x.fillStyle = '#f0d890'; x.font = 'bold 40px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('GLORIA', 128, 38);
  x.font = 'bold 15px "IBM Plex Mono", monospace'; x.fillText('RECEPTION · RX-07', 128, 72);
  return ctex(c);
}
// fine twill for the blazer (normal map, tiles ~8 cm)
function twillNormal() {
  const s = 128, h = canvas(s, s), x = h.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, s, s);
  for (let i = -s; i < s * 2; i += 6) { x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s, s); x.stroke(); }
  for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},0.06)`; x.fillRect(Math.random() * s, Math.random() * s, 2, 1); }
  const src = x.getImageData(0, 0, s, s).data, out = canvas(s, s), o = out.getContext('2d'), img = o.createImageData(s, s);
  const H = (i, j) => src[(((j + s) % s) * s + ((i + s) % s)) * 4] / 255;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const dx = (H(i + 1, j) - H(i - 1, j)) * 1.6, dy = (H(i, j + 1) - H(i, j - 1)) * 1.6, l = Math.hypot(dx, dy, 1), k = (j * s + i) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  o.putImageData(img, 0, 0);
  const t = ctex(out, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function textures() {
  if (!TX) TX = { face: faceTexture(), badge: badgeTexture(), twill: twillNormal() };
  return TX;
}

function materials(rig) {
  const tx = textures();
  const M = {
    shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, envMapIntensity: 1.1 }),
    face: new THREE.MeshStandardMaterial({ map: tx.face, roughness: 0.2, metalness: 0, envMapIntensity: 1.25 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, normalMap: tx.twill, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 1, envMapIntensity: 1.3 }),
    badge: new THREE.MeshStandardMaterial({ map: tx.badge, roughness: 0.35, metalness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  for (const k of ['shell', 'face', 'cloth', 'metal', 'badge']) { vlPatch(M[k], rig); M[k].name = 'rx07_' + k; }
  M.glow.name = 'rx07_glow';
  M.glow.color.setScalar(2.4);
  return M;
}

// ------------------------------------------------------------------------------------------ lofts
// superellipse ring stack along y; sections: [{ y, hw, hd, zc, p }] -> grid (theta from +z, towards +x)
function sectionAt(secs, y) {
  let i = 0;
  while (i < secs.length - 2 && y > secs[i + 1].y) i++;
  const a = secs[i], b = secs[i + 1];
  const t = sstep(a.y, b.y, y), u = clamp((y - a.y) / (b.y - a.y), 0, 1);
  const k = lerp(u, t, 0.6);
  return { hw: lerp(a.hw, b.hw, k), hd: lerp(a.hd, b.hd, k), zc: lerp(a.zc ?? 0, b.zc ?? 0, k), p: lerp(a.p ?? 2.6, b.p ?? 2.6, k) };
}
function sePoint(s, th, out) {
  const st = Math.sin(th), ct = Math.cos(th), e = 2 / s.p;
  return out.set(s.hw * Math.sign(st) * Math.pow(Math.abs(st), e), 0, s.zc + s.hd * Math.sign(ct) * Math.pow(Math.abs(ct), e));
}
const BODY = [
  { y: 0.58, hw: 0.118, hd: 0.084, zc: -0.012 }, { y: 0.68, hw: 0.114, hd: 0.08, zc: -0.008 }, { y: 0.78, hw: 0.13, hd: 0.092, zc: 0 },
  { y: 0.87, hw: 0.142, hd: 0.104, zc: 0.006 }, { y: 0.95, hw: 0.148, hd: 0.094, zc: 0.002 }, { y: 1.02, hw: 0.156, hd: 0.084, zc: -0.004 },
  { y: 1.07, hw: 0.148, hd: 0.074, zc: -0.008 }, { y: 1.1, hw: 0.1, hd: 0.06, zc: -0.008 }, { y: 1.125, hw: 0.05, hd: 0.046, zc: -0.006 },
];
const COAT = [
  { y: 0.56, hw: 0.142, hd: 0.104, zc: -0.008 }, { y: 0.66, hw: 0.13, hd: 0.096, zc: -0.006 }, { y: 0.78, hw: 0.145, hd: 0.106, zc: 0.002 },
  { y: 0.87, hw: 0.157, hd: 0.118, zc: 0.008 }, { y: 0.95, hw: 0.164, hd: 0.108, zc: 0.004 }, { y: 1.02, hw: 0.19, hd: 0.098, zc: -0.002 },
  { y: 1.07, hw: 0.186, hd: 0.088, zc: -0.006 }, { y: 1.1, hw: 0.13, hd: 0.07, zc: -0.008 }, { y: 1.13, hw: 0.068, hd: 0.058, zc: -0.012 },
];
const bust = (y, th) => 0.012 * gauss((y - 0.875) / 0.05) * Math.pow(Math.max(0, Math.cos(th)), 2);
const VOPEN = (y) => (y < 0.88 ? 0 : 0.66 * Math.pow(clamp((y - 0.88) / 0.25, 0, 1), 0.8));

// ------------------------------------------------------------------------------------------ model
export function buildReceptionistModel(rig) {
  const M = materials(rig);
  const root = new THREE.Group();
  root.name = 'Receptionist_RX07';
  const P = { root, M };

  // ---------------- lower body (static): pencil skirt lap, plastic knees + shins, chrome ankles, pumps
  {
    const cloth = new GBin(), shell = new GBin(), metal = new GBin();
    const lap = sgrid(lin(0, TAU, 40), lin(-0.11, 0.4, 16), (th, z, p) => {
      const t = clamp((z + 0.11) / 0.51, 0, 1);
      const hw = lerp(0.15, 0.125, t) * (z < -0.05 ? Math.sqrt(1 - Math.pow((z + 0.05) / 0.06, 2) * 0.5) : 1), hh = lerp(0.08, 0.058, t);
      const yc = lerp(0.575, 0.535, t);
      const st = Math.sin(th), ct = Math.cos(th);
      p.set(hw * Math.sign(ct) * Math.pow(Math.abs(ct), 0.75), yc + hh * Math.sign(st) * Math.pow(Math.abs(st), 0.8) * (st < 0 ? 0.8 : 1), z);
      if (st > 0) p.y += 0.008 * gauss((p.x - 0.06) / 0.04) + 0.008 * gauss((p.x + 0.06) / 0.04); // thighs under the cloth
    });
    outward(lap, V(0, 0.56, 0.15));
    cloth.add(lap, NAVY);
    cloth.add(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, PI / 2), NAVY, T(0, 0.575, -0.11, -PI / 2, 0, 0, 0.15, 0.06, 0.08));
    for (const s of [-1, 1]) {
      const kx = s * 0.062;
      shell.sphere(0.047, IVORY, T(kx, 0.53, 0.41), { seg: 20, rings: 12 });
      metal.add(new THREE.TorusGeometry(0.045, 0.004, 6, 24), RUBBER, T(kx, 0.53, 0.41, 0, PI / 2, 0));
      // shin: tapered shell with a seam groove, plastic calf
      shell.cyl(0.041, 0.03, 0.39, IVORY, T(kx, 0.31, 0.43, 0.06, 0, 0), { seg: 20 });
      shell.cyl(0.0335, 0.0335, 0.012, 0x6a6458, T(kx, 0.33, 0.432, 0.06, 0, 0), { seg: 20 });
      metal.sphere(0.024, CHROME, T(kx, 0.105, 0.445));
      // pumps: pointed toe, low block heel, ivory stocking top
      shell.add(new THREE.SphereGeometry(1, 20, 12), BLACK, T(kx, 0.045, 0.52, -0.08, 0, 0, 0.038, 0.036, 0.1));
      shell.box(0.03, 0.06, 0.03, BLACK, T(kx, 0.03, 0.44), { r: 0.006 });
      shell.box(0.07, 0.008, 0.2, BLACK, T(kx, 0.004, 0.51), { r: 0.003 });
    }
    // the GATE console on her work surface (she presses it to open the elevator)
    const glow = new GBin();
    shell.box(0.13, 0.05, 0.1, 0x2a2a2c, T(-0.32, 0.776, 0.26, -0.12, 0.25, 0), { r: 0.008 });
    metal.cyl(0.024, 0.026, 0.012, CHROME, T(-0.32, 0.806, 0.255, -0.12, 0.25, 0), { seg: 18 });
    glow.add(new THREE.SphereGeometry(0.02, 16, 8, 0, TAU, 0, PI / 2), 0x30ff70, T(-0.32, 0.81, 0.255, -0.12, 0.25, 0, 1, 0.55, 1));
    glow.sphere(0.0045, 0xffa020, T(-0.28, 0.802, 0.3));
    P.consoleGlow = glow.mesh(M.glow, root);
    cloth.mesh(M.cloth, root, { shadow: true });
    shell.mesh(M.shell, root, { shadow: true });
    metal.mesh(M.metal, root);
  }

  // ---------------- torso (breathes): plastic body, blazer with V opening + lapels + shoulder pads, scarf
  const torso = new THREE.Group();
  torso.position.set(0, 0.6, 0);
  root.add(torso);
  P.torso = torso;
  const TY = 0.6; // torso pivot height (geometry below is authored in root space, shifted by -TY)
  {
    const cloth = new GBin(), shell = new GBin(), metal = new GBin();
    const body = sgrid(lin(0, TAU, 48), lin(0.58, 1.125, 30), (th, y, p) => {
      const s = sectionAt(BODY, y);
      sePoint(s, th, p);
      p.z += bust(y, th) * 0.8;
      p.y = y - TY;
    });
    outward(body, V(0, 0.85 - TY, 0));
    // chest seam + panel shading: slightly darker below the sternum seam
    shell.add(body, IVORY, null, { shade: (x, y, z) => 0.92 + 0.08 * sstep(0.2, 0.45, y) - 0.25 * gauss(x / 0.003) * (z > 0 ? 1 : 0) });
    // sternum seam strip + screws in the V
    shell.box(0.004, 0.2, 0.003, 0x4a443a, T(0, 0.98 - TY, 0.101, -0.25, 0, 0));
    for (const s of [-1, 1]) metal.cyl(0.0045, 0.0045, 0.003, CHROME, T(s * 0.03, 1.03 - TY, 0.086, PI / 2 - 0.4, 0, 0), { seg: 10 });
    // blazer: front opening above y 0.8 (theta range shrinks by the V half-angle)
    const NU = 56, ys = lin(0.56, 1.13, 34);
    const coat = sgrid(lin(0, 1, NU), ys, (u, y, p) => {
      const d = VOPEN(y), th = d + u * (TAU - 2 * d);
      const s = sectionAt(COAT, y);
      sePoint(s, th, p);
      p.z += bust(y, th);
      // hem flare + lapel roll near the opening
      if (y < 0.6) { p.x *= 1 + (0.6 - y) * 0.8; p.z += (0.6 - y) * 0.4 * Math.max(0, Math.cos(th)); }
      p.y = y - TY;
    });
    outward(coat, V(0, 0.85 - TY, 0));
    cloth.add(coat, NAVY, null, { shade: (x, y) => 0.8 + 0.2 * sstep(-0.05, 0.3, y) });
    // lapels: notched strips folded back along each V edge
    for (const side of [1, -1]) {
      const pts = [], N = 22;
      const lapel = sgrid(lin(0, 1, 3), lin(0.86, 1.11, N), (w, y, p) => {
        const d = VOPEN(y), s = sectionAt(COAT, y);
        const width = 0.014 + 0.056 * Math.sin(clamp((y - 0.86) / 0.2, 0, 1) * PI * 0.88) * (y > 1.0 && y < 1.025 ? 0.4 : 1) * (y > 1.065 ? 0.55 : 1);
        const r = Math.max(0.05, Math.hypot(s.hw, s.hd) * 0.8);
        const th0 = side > 0 ? d : TAU - d, th = th0 + side * (w * width) / r;
        sePoint(s, th, p);
        p.z += bust(y, th) + 0.004 + 0.003 * (1 - w);
        p.x *= 1.02;
        p.y = y - TY;
      });
      void pts;
      outward(lapel, V(0, 0.9 - TY, -0.05));
      cloth.add(lapel, NAVY_L);
    }
    // collar band behind the neck
    const collar = sgrid(lin(PI * 0.55, PI * 1.45, 20), lin(0, 1, 3), (th, v, p) => {
      p.set(Math.sin(th) * (0.068 + 0.004 * v), 1.1 + v * 0.05 - TY, -0.012 + Math.cos(th) * (0.062 + 0.01 * v));
    });
    outward(collar, V(0, 1.1 - TY, -0.01));
    cloth.add(collar, NAVY_L);
    // buttons
    for (const y of [0.7, 0.765]) metal.cyl(0.0085, 0.0085, 0.006, GOLD, T(0, y - TY, sectionAt(COAT, y).zc + sectionAt(COAT, y).hd + bust(y, 0) + 0.003, PI / 2, 0, 0), { seg: 16 });
    // scarf: neck band, knot, two fanned tails (burgundy silk with gold diagonal stripes)
    const silk = (x, y, z) => (Math.floor((x * 0.7 + y) / 0.012) % 4 === 0 ? 1.0 : 0.62);
    const stripe = (g) => { const p = g.attributes.position.array, col = g.attributes.color.array, a = new THREE.Color(SCARF), b = new THREE.Color(SCARF_G); for (let i = 0; i < p.length / 3; i++) { const k = silk(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) > 0.9 ? b : a; col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b; } };
    stripe(shell.add(new THREE.TorusGeometry(0.056, 0.014, 10, 28), SCARF, T(0, 1.108 - TY, -0.008, PI / 2 - 0.12, 0, 0, 1, 0.92, 1)));
    stripe(shell.add(new THREE.SphereGeometry(1, 16, 12), SCARF, T(0.006, 1.088 - TY, 0.06, 0.3, 0.2, 0.4, 0.03, 0.026, 0.022)));
    for (const [tx, ty, rot] of [[0.034, 0.985, -0.35], [-0.022, 0.995, 0.28]]) {
      const tail = sgrid(lin(-1, 1, 4), lin(0, 1, 10), (u, v, p) => {
        const w = 0.012 + 0.02 * v;
        const cx = lerp(0.006, tx, v), cy = lerp(1.075, ty, v);
        const z = sectionAt(BODY, cy).hd + sectionAt(BODY, cy).zc + bust(cy, 0) + 0.012 + 0.006 * Math.sin(v * PI) - Math.abs(u) * 0.004;
        p.set(cx + u * w * Math.cos(rot), cy - TY + u * w * Math.sin(rot) * 0.4, z);
      });
      outward(tail, V(0, 0.98 - TY, -0.05));
      stripe(shell.add(tail, SCARF));
    }
    // R.O.O.M. lapel pin (right lapel = her right = -x)
    metal.cyl(0.009, 0.009, 0.004, GOLD, T(-0.085, 0.985 - TY, 0.112, PI / 2 - 0.3, 0, 0.25), { seg: 16 });
    // shoulder joints (hidden under the pads) + arm sockets
    for (const s of [-1, 1]) metal.sphere(0.03, 0x8a8a8a, T(s * 0.17, 1.045 - TY, -0.01));
    P.torsoMeshes = [cloth.mesh(M.cloth, torso, { shadow: true }), shell.mesh(M.shell, torso, { shadow: true }), metal.mesh(M.metal, torso)];
    // name badge on her left chest
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.025), M.badge);
    badge.position.set(0.078, 0.93 - TY, 0.123);
    badge.rotation.set(-0.12, 0.42, 0.03);
    torso.add(badge);
  }

  // ---------------- neck (servo): rubber gaiter, chrome core, piston tendons
  const neck = new THREE.Group();
  neck.position.set(0, 1.112 - TY, -0.006);
  torso.add(neck);
  P.neck = neck;
  {
    const shell = new GBin(), metal = new GBin();
    const prof = [];
    for (let i = 0; i <= 12; i++) prof.push(new THREE.Vector2(i % 2 ? 0.031 : 0.027, i * 0.0062));
    shell.add(new THREE.LatheGeometry(prof, 22), RUBBER);
    metal.cyl(0.02, 0.02, 0.08, 0x9a9a9a, T(0, 0.04, 0), { seg: 14 });
    for (const s of [-1, 1]) {
      metal.cyl(0.0042, 0.0042, 0.05, CHROME, T(s * 0.021, 0.03, 0.026, -0.12, 0, s * 0.08), { seg: 8 });
      metal.cyl(0.0062, 0.0062, 0.03, 0x555555, T(s * 0.019, 0.006, 0.024, -0.12, 0, s * 0.08), { seg: 8 });
    }
    shell.mesh(M.shell, neck);
    metal.mesh(M.metal, neck);
  }

  // ---------------- head
  const head = new THREE.Group();
  head.position.set(0, 0.064, 0.002);
  head.scale.setScalar(1.07);
  neck.add(head);
  P.head = head;
  {
    const shell = new GBin(), metal = new GBin(), glow = new GBin();
    // skull (ivory), seam groove down the back
    const skull = sgrid(lin(-PI, PI, 56), lin(-PI / 2 + 0.05, PI / 2 - 0.02, 32), (th, ph, p) => headPoint(th, ph, 0, p));
    outward(skull, HC);
    shell.add(skull, IVORY, null, { shade: (x, y, z) => (z < -0.05 && Math.abs(x) < 0.0025 ? 0.4 : 1) * (0.86 + 0.14 * sstep(0.0, 0.16, y)) });
    // temple screws + audio port rings (mostly under the hair)
    for (const s of [-1, 1]) {
      const n = V(), p = headPoint(s * 1.12, 0.32, 0.0006, V(), n);
      metal.add(new THREE.CylinderGeometry(0.0038, 0.0038, 0.002, 12).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n)).translate(p.x, p.y, p.z), CHROME);
    }
    // molded bob: offset shell over the skull, fringe with a side part, flipped ends, sculpted grooves
    const phMin = (th) => {
      const a = Math.abs(th);
      const front = 0.47 - 0.13 * sstep(0.05, -0.5, th) + 0.05 * gauss((th - 0.18) / 0.08);
      return lerp(front, -0.62, sstep(0.78, 1.28, a)) + 0.03 * Math.cos(th * 9) * sstep(1.3, 2.0, a);
    };
    const hairOff = (th, ph, v) => {
      const base = 0.011 + 0.006 * sstep(0.2, 1.3, ph) + 0.004 * (Math.cos(th) < 0 ? 1 : 0);
      const flip = 0.014 * Math.pow(1 - v, 3) * sstep(0.7, 1.2, Math.abs(th));
      const groove = 0.0016 * Math.sin(th * 34 + ph * 5 + Math.sin(ph * 6) * 1.5);
      return base + flip + groove;
    };
    const NV = 26;
    const hair = sgrid(lin(-PI, PI, 112), lin(-0.08, 1, NV + 1), (th, v, p) => {
      const pm = phMin(th);
      if (v < 0) { headPoint(th, pm + 0.02, 0.003, p); return; } // tuck row: closes the rim against the skull
      const ph = lerp(pm, PI / 2 - 0.001, Math.pow(v, 0.85));
      headPoint(th, ph, hairOff(th, ph, v), p);
    });
    outward(hair, HC);
    shell.add(hair, HAIR, null, { shade: (x, y, z) => { const th = Math.atan2(x, z - HC.z); return 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(th * 34 + (y - HC.y) * 50)); } });
    // headset: band over the crown, ear cup on her left, boom mic to the mouth corner
    const band = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, th = lerp(-PI / 2 - 0.05, PI / 2 + 0.05, t), ph = lerp(0.15, PI / 2 - 0.06, Math.sin(t * PI)); const pp = headPoint(th, ph, hairOff(th, ph, 0.8) + 0.004, V()); band.push(pp); }
    // band follows a vertical arc through the crown (azimuth ±90 deg, x = side)
    const bandPts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, a = lerp(-1.32, 1.32, t); const pp = headPoint(a > 0 ? PI / 2 : -PI / 2, PI / 2 - Math.abs(a) * 1.05, 0.023, V()); pp.z -= 0.006; bandPts.push(pp); }
    void band;
    shell.tube(bandPts, 0.0042, BLACK, { radial: 8 });
    const ear = headPoint(PI / 2, -0.02, 0.021, V());
    shell.cyl(0.027, 0.029, 0.016, BLACK, T(ear.x + 0.004, ear.y, ear.z, 0, 0, PI / 2), { seg: 22 });
    shell.cyl(0.02, 0.02, 0.006, 0x2c2c30, T(ear.x + 0.014, ear.y, ear.z, 0, 0, PI / 2), { seg: 18 });
    const mouthC = headPoint(0.3, -0.43, 0.024, V());
    shell.tube([V(ear.x + 0.006, ear.y - 0.008, ear.z + 0.012), V(ear.x + 0.002, ear.y - 0.03, ear.z + 0.05), V(0.06, mouthC.y - 0.008, mouthC.z - 0.012), mouthC], 0.0028, BLACK, { radial: 6 });
    shell.sphere(0.0072, 0x1c1c1c, T(mouthC.x, mouthC.y, mouthC.z));
    glow.sphere(0.0032, 0xff3020, T(ear.x + 0.016, ear.y + 0.014, ear.z + 0.01));
    // eye domes: dark glass under the lids; the LED irises are a separate (saccading) mesh
    const eyes = [];
    for (const s of [-1, 1]) {
      const n = V(), surf = 0.0034 + faceRelief(s * FACE.eyeTh, FACE.eyePh);
      const c = headPoint(s * FACE.eyeTh, FACE.eyePh, surf - EYE_D, V(), n);
      eyes.push({ c, n });
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
      shell.add(new THREE.SphereGeometry(EYE_R, 22, 10, 0, TAU, 0, PI * 0.5).applyQuaternion(q).translate(c.x, c.y, c.z), 0x0b0d11);
      const rc = c.clone().addScaledVector(n, EYE_D * 0.92);
      metal.add(new THREE.TorusGeometry(Math.sqrt(EYE_R * EYE_R - EYE_D * EYE_D * 0.85), 0.0011, 6, 28).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n)).translate(rc.x, rc.y, rc.z), 0x6a5a50);
    }
    P.eyes = eyes;
    P.headShell = shell.mesh(M.shell, head, { shadow: true });
    metal.mesh(M.metal, head);
    P.headGlow = glow.mesh(M.glow, head);
    // LED irises (ring + pupil) riding on the dome fronts
    const iris = new GBin();
    const ci = new THREE.Color(0xbdf2ff), co = new THREE.Color(0x1f7fa6);
    for (const e of eyes) {
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), e.n);
      const front = e.c.clone().addScaledVector(e.n, EYE_R - 0.0004);
      // LED iris: bright inner rim fading out, a dark aperture pupil, a faint halo
      const g = iris.add(new THREE.RingGeometry(0.0019, 0.0066, 28, 3).applyQuaternion(q).translate(front.x, front.y, front.z), 0xffffff);
      const pa = g.attributes.position.array, ca = g.attributes.color.array;
      for (let i = 0; i < pa.length / 3; i++) {
        const d = Math.hypot(pa[i * 3] - front.x, pa[i * 3 + 1] - front.y, pa[i * 3 + 2] - front.z);
        const k = clamp((d - 0.0019) / 0.0047, 0, 1), c = ci.clone().lerp(co, Math.pow(k, 0.8));
        ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b;
      }
      iris.add(new THREE.CircleGeometry(0.0019, 16).applyQuaternion(q).translate(front.x + e.n.x * 0.0002, front.y + e.n.y * 0.0002, front.z + e.n.z * 0.0002), 0x020406);
      iris.add(new THREE.RingGeometry(0.0068, 0.0084, 28).applyQuaternion(q).translate(front.x - e.n.x * 0.0006, front.y - e.n.y * 0.0006, front.z - e.n.z * 0.0006), 0x0c2a38);
      // tiny specular catchlight on the glass
      iris.add(new THREE.CircleGeometry(0.0011, 10).applyQuaternion(q).translate(front.x + 0.0022 + e.n.x * 0.0006, front.y + 0.0026 + e.n.y * 0.0006, front.z + e.n.z * 0.0006), 0xffffff);
    }
    P.irisMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    P.irisMat.color.setScalar(1.6);
    P.iris = iris.mesh(P.irisMat, head);
    // face plate (upper) + hinged jaw, porcelain with the painted face
    const ths = cat(lin(FACE.th0, -FACE.jawTh, 14), lin(-FACE.jawTh, FACE.jawTh, 52), lin(FACE.jawTh, FACE.th1, 14));
    const phs = cat(lin(FACE.ph0, FACE.mouth, 26), lin(FACE.mouth, FACE.ph1, 52));
    const plateOff = (th, ph) => {
      const edge = Math.min(th - FACE.th0, FACE.th1 - th, (ph - FACE.ph0) * 1.4, FACE.ph1 - ph);
      return 0.0012 + 0.0022 * sstep(0, 0.12, edge) + faceRelief(th, ph);
    };
    const isJaw = (th, ph) => ph < FACE.mouth && Math.abs(th) < FACE.jawTh;
    const mk = (keep) => {
      const g = sgrid(ths, phs, (th, ph, p) => headPoint(th, ph, plateOff(th, ph), p), keep);
      const uv = g.attributes.uv, pa = g.attributes.position;
      // uv = parametric (th, ph) over the face rectangle
      let k = 0;
      for (let j = 0; j < phs.length; j++) for (let i = 0; i < ths.length; i++, k++) uv.setXY(k, (ths[i] - FACE.th0) / (FACE.th1 - FACE.th0), (phs[j] - FACE.ph0) / (FACE.ph1 - FACE.ph0));
      void pa;
      return outward(g, HC);
    };
    const upper = mk((th, ph) => !isJaw(th, ph));
    P.face = new THREE.Mesh(upper, M.face);
    P.face.castShadow = true; P.face.receiveShadow = true;
    head.add(P.face);
    // jaw pivots at the ear line
    const jaw = new THREE.Group();
    const piv = V(0, HC.y - 0.035, HC.z - 0.03);
    jaw.position.copy(piv);
    head.add(jaw);
    const jg = mk((th, ph) => isJaw(th, ph));
    jg.translate(-piv.x, -piv.y, -piv.z);
    P.jawMesh = new THREE.Mesh(jg, M.face);
    P.jawMesh.castShadow = true;
    jaw.add(P.jawMesh);
    // dark mouth cavity behind the jaw gap
    const cav = new GBin();
    cav.add(new THREE.SphereGeometry(1, 14, 8), 0x1a0c0c, T(0, -0.43 * HR.y + HC.y - piv.y - 0.004, HR.z * 0.86 + HC.z - piv.z - 0.012, 0, 0, 0, 0.032, 0.012, 0.012));
    cav.mesh(M.shell, jaw);
    P.jaw = jaw;
    // eyelid shutters (porcelain): upper-front quarter shells rotating about the eye line
    const lids = new THREE.Group();
    lids.position.set(0, eyes[0].c.y, (eyes[0].c.z + eyes[1].c.z) / 2);
    head.add(lids);
    const lb = new GBin();
    for (const e of eyes) {
      const ry = Math.sign(e.c.x) * FACE.eyeTh * 0.9;
      const g = new THREE.SphereGeometry(EYE_R + 0.0016, 20, 8, 0, PI, 0, PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02, 0.98);
      g.rotateY(ry).translate(e.c.x, 0, e.c.z - lids.position.z);
      lb.add(g, 0xffffff);
      // lash line on the lid edge
      const lash = new THREE.TorusGeometry(EYE_R + 0.0017, 0.001, 4, 20, PI);
      lash.rotateX(PI / 2).rotateY(ry).translate(e.c.x, 0, e.c.z - lids.position.z);
      const luv = lash.attributes.uv; for (let i = 0; i < luv.count; i++) luv.setXY(i, 0.02, 0.98);
      lb.add(lash, 0x2a1810);
    }
    P.lidMesh = lb.mesh(M.face, lids);
    // lash colour lives in vertex colours, the face texture's plain patch for the rest
    P.lidMesh.material = M.face.clone();
    P.lidMesh.material.vertexColors = true;
    vlPatch(P.lidMesh.material, rig);
    P.lids = lids;
  }

  // ---------------- arms: shoulder -> elbow -> wrist groups (IK), sleeves, plastic hands
  const L1 = 0.265, L2 = 0.235;
  P.L1 = L1; P.L2 = L2;
  const arm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.172, 1.04 - TY, -0.012);
    torso.add(sh);
    const ub = new GBin();
    ub.sphere(0.05, NAVY, T(0, 0.004, 0, 0, 0, 0, 1.05, 0.95, 1.1), { seg: 18, rings: 10 });
    ub.cyl(0.046, 0.039, L1, NAVY, T(0, -L1 / 2, 0), { seg: 18 });
    ub.mesh(M.cloth, sh, { shadow: true });
    const el = new THREE.Group();
    el.position.y = -L1;
    sh.add(el);
    const fb = new GBin();
    fb.sphere(0.04, NAVY, T(0, 0, 0), { seg: 16, rings: 8 });
    fb.cyl(0.039, 0.033, L2 - 0.045, NAVY, T(0, -(L2 - 0.045) / 2, 0), { seg: 18 });
    fb.cyl(0.035, 0.035, 0.018, NAVY_L, T(0, -(L2 - 0.05), 0), { seg: 18 });
    fb.mesh(M.cloth, el, { shadow: true });
    const wr = new THREE.Group();
    wr.position.y = -L2;
    el.add(wr);
    // hand frame: fingers along +z, palm facing -y
    const hb = new GBin(), mb = new GBin();
    mb.add(new THREE.TorusGeometry(0.022, 0.004, 6, 20), CHROME, T(0, 0, -0.02));
    hb.cyl(0.02, 0.022, 0.035, IVORY_D, T(0, 0, -0.035, PI / 2, 0, 0), { seg: 14 });
    hb.box(0.074, 0.026, 0.078, IVORY, T(0, 0, 0.012), { r: 0.012, seg: 3 });
    hb.box(0.06, 0.006, 0.05, IVORY_D, T(0, 0.012, 0.012), { r: 0.003 });
    for (let i = 0; i < 4; i++) mb.sphere(0.0035, CHROME, T(side * (-0.027 + i * 0.018), 0.013, 0.03));
    P[side < 0 ? 'handR' : 'handL'] = hb.mesh(M.shell, wr, { shadow: true });
    mb.mesh(M.metal, wr);
    return { sh, el, wr, side };
  };
  P.armR = arm(-1); // her right (-x)
  P.armL = arm(1);

  // ---------------- fingers: 2 x (4 x 3 + 2) phalanges + knuckle pins, instanced
  const seg = new THREE.CylinderGeometry(0.86, 1, 1, 10, 1);
  seg.rotateX(PI / 2); seg.translate(0, 0, 0.5);
  { const n = seg.attributes.position.count; seg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
  const segCol = new THREE.Color(IVORY);
  const fingers = new THREE.InstancedMesh(seg, M.shell, 28);
  const pin = new THREE.SphereGeometry(1, 10, 8);
  { const n = pin.attributes.position.count; pin.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
  const pins = new THREE.InstancedMesh(pin, M.metal, 28);
  for (let i = 0; i < 28; i++) { fingers.setColorAt(i, segCol); pins.setColorAt(i, new THREE.Color(0x9a9a9a)); }
  for (const m of [fingers, pins]) { m.frustumCulled = false; m.castShadow = true; root.add(m); }
  P.fingers = fingers; P.pins = pins;
  return P;
}

// ------------------------------------------------------------------------------------------ animation rig
const DOWN = V(0, -1, 0);
const _a = V(), _b = V(), _c = V(), _d = V(), _w = V(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
// two-bone IK in torso space (shoulder group parent = torso)
function solveArm(a, L1, L2, target, pole, handQ) {
  const S = _a.copy(a.sh.position);
  const Tt = _b.copy(target).sub(S);
  let d = Tt.length();
  d = clamp(d, Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.003);
  const u = Tt.normalize();
  const ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), a1 = Math.acos(clamp(ca, -1, 1));
  const w = _c.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
  const E = _d.copy(u).multiplyScalar(Math.cos(a1) * L1).addScaledVector(w, Math.sin(a1) * L1);
  const W = _w.copy(u).multiplyScalar(d);
  a.sh.quaternion.setFromUnitVectors(DOWN, E.clone().normalize());
  const fore = W.sub(E).normalize().applyQuaternion(_q1.copy(a.sh.quaternion).invert());
  a.el.quaternion.setFromUnitVectors(DOWN, fore);
  _q2.copy(a.sh.quaternion).multiply(a.el.quaternion).invert();
  a.wr.quaternion.copy(_q2).multiply(handQ);
}

const KNUCKLES = [-0.027, -0.009, 0.009, 0.027];
const PHAL = [[0.03, 0.021, 0.017], [0.034, 0.023, 0.018], [0.032, 0.022, 0.017], [0.026, 0.018, 0.015]];
const FR = [0.0078, 0.0082, 0.0078, 0.007];

export class ReceptionistAnimator {
  constructor(P) {
    this.P = P;
    this.t = Math.random() * 10;
    this.yaw = 0; this.pitch = 0.25; this.roll = 0;     // head (relative to torso)
    this.eye = V();                                     // iris offset
    this.blink = 0; this.blinkT = 2;
    this.jaw = 0;
    this.twitch = null; this.twitchT = 9 + Math.random() * 10;
    this.typing = 1; this.typeT = 0; this.burst = 3;
    this.taps = [0, 0, 0, 0, 0, 0, 0, 0];
    this.reach = 0;                                     // 0..1 right hand to the gate button
    this.pressT = -1;
    this.lean = 0;
    this.handR = V(0.0, 0.8, 0.27); this.handL = V(0.2, 0.8, 0.27);
    this.handQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0));
    this.glowK = 1;
  }

  // st: { look: world point|null, snap: bool, talking: 0..1, attend: 0..1, stare: bool, dt }
  update(dt, st) {
    const P = this.P;
    this.t += dt;
    const t = this.t;
    // --- breathing-like shell motion + posture
    const br = Math.sin(t * 1.55);
    P.torso.scale.set(1 + br * 0.004, 1 + br * 0.006, 1 + br * 0.006);
    P.torso.rotation.x = 0.07 + br * 0.006 + this.lean * 0.05;
    // --- head target (torso-relative yaw/pitch)
    let wy = Math.sin(t * 0.37) * 0.06 - 0.12, wp = 0.42; // default: reading her monitor (down-right)
    if (st.look && (st.attend > 0.01 || st.stare)) {
      P.root.updateWorldMatrix(true, false);
      P.neck.updateWorldMatrix(true, false);
      const l = P.neck.worldToLocal(_a.copy(st.look));
      l.y -= 0.11;
      wy = Math.atan2(l.x, l.z);
      wp = -Math.atan2(l.y, Math.hypot(l.x, l.z));
      wy = clamp(wy, -1.4, 1.4); wp = clamp(wp, -0.5, 0.55);
      if (!st.stare) { wy = lerp(-0.12, wy, st.attend); wp = lerp(0.42, wp, st.attend); }
    }
    if (st.snap) { this.yaw = wy; this.pitch = wp; } else {
      // servo: constant angular speed, stops dead (slightly unnatural)
      const sp = (st.talking > 0 ? 2.2 : 1.4) * dt;
      this.yaw += clamp(wy - this.yaw, -sp, sp);
      this.pitch += clamp(wp - this.pitch, -sp * 0.7, sp * 0.7);
    }
    this.roll = clamp(-this.yaw * 0.1, -0.15, 0.15) + (st.stare ? 0.12 : 0);
    // twitch: short jerk + eye flicker
    this.twitchT -= dt;
    if (this.twitchT <= 0 && !this.twitch) { this.twitch = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 }; this.twitchT = 12 + Math.random() * 18; st.onTwitch?.(); }
    let ty = 0, tr = 0, tp = 0;
    if (this.twitch) {
      const k = this.twitch.t;
      const pulse = k < 0.07 ? k / 0.07 : k < 0.2 ? 1 : Math.max(0, 1 - (k - 0.2) / 0.15);
      ty = this.twitch.dir * 0.22 * pulse; tr = this.twitch.dir * 0.25 * pulse; tp = -0.08 * pulse;
      this.twitch.t += dt;
      if (this.twitch.t > 0.4) this.twitch = null;
    }
    P.neck.rotation.set(this.pitch * 0.35, this.yaw * 0.35, 0);
    P.head.rotation.set(this.pitch * 0.65 + tp, this.yaw * 0.65 + ty, this.roll + tr, 'YXZ');
    // --- eyes: blink shutters, saccades towards the look target
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.16; this.blinkT = Math.random() < 0.18 ? 0.22 : 2.4 + Math.random() * 3.8; }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin((1 - this.blink / 0.16) * PI) : 0;
    const lidOpen = st.stare ? -0.75 : -0.36;
    P.lids.rotation.x = lerp(lidOpen, 0.85, bl);
    const ex = clamp((st.look && st.attend > 0.3 ? 0 : Math.sin(t * 0.7) * 0.4) + (this.twitch ? 0.6 : 0), -1, 1);
    this.eye.lerp(_b.set(ex * 0.0024, (st.stare ? 0.0006 : -0.0012), 0), 1 - Math.exp(-dt * 12));
    P.iris.position.copy(this.eye);
    const flick = this.twitch && Math.floor(this.twitch.t * 40) % 2 === 0;
    P.irisMat.color.setRGB(flick ? 3.0 : 1.5 * this.glowK, flick ? 0.35 : 1.6 * this.glowK, flick ? 0.3 : 1.7 * this.glowK);
    // --- jaw (ventriloquist): flaps with speech
    const jt = st.talking > 0 ? clamp(0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 6.3 + 1), 0, 1) * 0.16 : st.stare ? 0.05 : 0;
    this.jaw += (jt - this.jaw) * (1 - Math.exp(-dt * 30));
    P.jaw.rotation.x = this.jaw;
    // --- arms: typing on the keyboard, reaching for the gate button
    this.typeT -= dt;
    if (this.typeT <= 0) { this.typing = this.typing > 0.5 ? 0 : 1; this.typeT = this.typing ? 2 + Math.random() * 4 : 0.8 + Math.random() * 2.2; }
    const typing = st.talking > 0 || st.stare ? 0 : this.typing;
    const kbY = 0.792;
    const tR = _c.set(0.0 + Math.sin(t * 2.1) * 0.012 * typing, kbY + 0.008 * Math.abs(Math.sin(t * 9.3)) * typing, 0.27);
    const tL = _d.set(0.2 + Math.sin(t * 1.7 + 1) * 0.01 * typing, kbY + 0.008 * Math.abs(Math.sin(t * 8.1 + 2)) * typing, 0.27);
    if (!typing) { tR.y += 0.012; tL.y += 0.012; tR.z -= 0.02; tL.z -= 0.02; }
    // gate button press (right hand)
    if (this.pressT >= 0) {
      this.pressT += dt;
      const k = this.pressT;
      const reach = k < 0.45 ? sstep(0, 0.45, k) : k < 1.1 ? 1 : 1 - sstep(1.1, 1.6, k);
      const btn = _w.set(-0.32, 0.835 - (k > 0.45 && k < 0.75 ? 0.022 : 0), 0.26);
      tR.lerp(btn, reach);
      if (k > 1.6) this.pressT = -1;
    }
    this.handR.lerp(tR, 1 - Math.exp(-dt * 14));
    this.handL.lerp(tL, 1 - Math.exp(-dt * 14));
    // targets are in root space; the shoulders live in the (pivoted, breathing) torso
    P.torso.updateMatrix();
    _m1.copy(P.torso.matrix).invert();
    const hr = _a.copy(this.handR).applyMatrix4(_m1), hl = _b.copy(this.handL).applyMatrix4(_m1);
    const qT = _q2.copy(P.torso.quaternion).invert().multiply(this.handQ);
    solveArm(P.armR, P.L1, P.L2, hr.clone(), V(-0.8, -0.2, -0.6).normalize(), qT.clone());
    solveArm(P.armL, P.L1, P.L2, hl.clone(), V(0.8, -0.2, -0.6).normalize(), qT.clone());
    // --- fingers
    for (let i = 0; i < 8; i++) this.taps[i] = Math.max(0, this.taps[i] - dt * 9);
    if (typing && Math.random() < dt * 11) { const f = Math.floor(Math.random() * 8); this.taps[f] = 1; st.onKey?.(); }
    this._fingers(typing);
  }

  _fingers(typing) {
    const P = this.P;
    P.root.updateMatrixWorld(true);
    _m3.copy(P.root.matrixWorld).invert();
    let si = 0;
    const put = (mesh, idx, m, sx, sy, sz) => { _m2.makeScale(sx, sy, sz); mesh.setMatrixAt(idx, _m2.premultiply(m)); };
    const pressing = this.pressT > 0.3 && this.pressT < 1.0;
    for (const [hi, arm] of [[0, P.armR], [1, P.armL]]) {
      const side = arm.side;
      const Mh = new THREE.Matrix4().multiplyMatrices(_m3, arm.wr.matrixWorld);
      for (let f = 0; f < 5; f++) {
        const M = Mh.clone();
        let curl, splay, lens, r;
        if (f < 4) {
          const tap = this.taps[hi * 4 + f] * typing;
          const point = pressing && hi === 0 && f === 1;
          curl = point ? [0.1, 0.05, 0.05] : typing ? [0.5 + tap * 0.35, 0.55 - tap * 0.15, 0.35] : [0.3, 0.35, 0.25];
          splay = (f - 1.5) * 0.06 * side;
          lens = PHAL[f]; r = FR[f];
          M.multiply(_m2.makeTranslation(side * KNUCKLES[f], -0.002, 0.044));
        } else {
          curl = [0.35, 0.3, 0];
          splay = -side * 0.75;
          lens = [0.03, 0.024]; r = 0.0085;
          M.multiply(_m2.makeTranslation(-side * 0.034, -0.008, 0.004));
          M.multiply(_m2.makeRotationZ(side * 0.5));
        }
        M.multiply(_m2.makeRotationY(splay));
        for (let k = 0; k < lens.length; k++) {
          M.multiply(_m2.makeRotationX(curl[k]));
          put(P.pins, si, M, r * 1.12, r * 1.12, r * 1.12);
          put(P.fingers, si, M, r, r, lens[k]);
          si++;
          M.multiply(_m2.makeTranslation(0, 0, lens[k]));
          r *= 0.9;
        }
      }
    }
    P.fingers.count = si; P.pins.count = si;
    P.fingers.instanceMatrix.needsUpdate = true;
    P.pins.instanceMatrix.needsUpdate = true;
  }

  press() { this.pressT = 0; }
}

// ------------------------------------------------------------------------------------------ customer display
// pole-mounted VFD on the counter facing the visitors: shows what she says and the elevator countdown
class VFD {
  constructor(rig) {
    this.c = canvas(512, 128);
    this.x = this.c.getContext('2d');
    this.tex = ctex(this.c);
    this.group = new THREE.Group();
    const b = new GBin(), m = new GBin();
    m.cyl(0.012, 0.012, 0.08, CHROME, T(0, 0.04, 0), { seg: 12 });
    m.cyl(0.05, 0.055, 0.012, 0x333333, T(0, 0.006, 0), { seg: 20 });
    b.box(0.3, 0.085, 0.05, 0x1c1c1e, T(0, 0.13, 0, -0.18, 0, 0), { r: 0.008 });
    b.box(0.31, 0.012, 0.055, 0x2a2a2c, T(0, 0.088, 0.008, -0.18, 0, 0), { r: 0.004 });
    const mats = { shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }), metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 1 }) };
    vlPatch(mats.shell, rig); vlPatch(mats.metal, rig);
    this.mats = mats;
    b.mesh(mats.shell, this.group, { shadow: true });
    m.mesh(mats.metal, this.group);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.0675), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: true }));
    scr.material.color.setScalar(1.6);
    scr.position.set(0, 0.134, 0.025);
    scr.rotation.x = -0.18;
    this.group.add(scr);
    this.screen = scr;
    this.lines = ['', ''];
    this.scroll = 0;
    this.draw(['WELCOME TO R.O.O.M.', 'PLEASE SEE RECEPTION'], 0);
  }
  draw(lines, t) {
    const x = this.x, w = 512, h = 128;
    x.fillStyle = '#031210'; x.fillRect(0, 0, w, h);
    // dot-matrix cell grid
    x.fillStyle = 'rgba(40,255,200,0.05)';
    for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) x.fillRect(12 + i * 24.4, 10 + j * 58, 21, 50);
    x.font = 'bold 44px "VT323", monospace'; x.textBaseline = 'top';
    x.fillStyle = '#5affd6'; x.shadowColor = '#3affc8'; x.shadowBlur = 10;
    lines.forEach((s, j) => {
      s = String(s || '');
      if (s.length > 20) { const k = Math.floor(t * 6) % (s.length + 6); s = (s + '      ' + s).slice(k, k + 20); }
      for (let i = 0; i < Math.min(20, s.length); i++) x.fillText(s[i], 14 + i * 24.4, 12 + j * 58);
    });
    x.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }
  dispose() { this.tex.dispose(); this.screen.material.dispose(); this.mats.shell.dispose(); this.mats.metal.dispose(); }
}

// ------------------------------------------------------------------------------------------ device
const LINES = {
  intro1: 'Good morning, {N}. Welcome to R.O.O.M. I am Gloria, your receptionist.',
  intro2: 'The company needs furniture. Your first assignment: build your camp.',
  again: 'Welcome back, {N}.',
  offer: 'Dispatch now?',
  confirm: 'Very good, {N}. Opening the gate. Please step into the car.',
  hurry: 'The elevator leaves in {S} seconds, {N}. Please step inside.',
  missed: 'Nobody boarded. I have recalled the car. Talk to me when you are ready.',
  transit: 'The car is in transit. Please wait.',
  cancel: 'Of course. Take your time, {N}.',
};
const VFDTXT = {
  intro1: ['GOOD MORNING', '{N}'], intro2: ['YOUR ASSIGNMENT:', 'BUILD YOUR CAMP'], again: ['WELCOME BACK', '{N}'],
  offer: ['DISPATCH NOW?', '[{K}] YES'], confirm: ['GATE OPENING', 'STEP INTO THE CAR'], hurry: ['ELEVATOR DEPARTS', 'IN {S} SECONDS'],
  missed: ['CAR RECALLED', 'PLEASE SEE RECEPTION'], transit: ['CAR IN TRANSIT', 'PLEASE WAIT'], cancel: ['OF COURSE', 'TAKE YOUR TIME'],
};
const introduced = new Set(); // per page session: who already heard the orientation

export class ReceptionistBot extends Device {
  // opts: { lobby, lights: [{pos, color, intensity}], ambient: Color }
  constructor(world, id, opts = {}) {
    super(world, id, opts);
    this.lobby = opts.lobby;
    this.range = 2.9;
    this.state = { say: null };
    this.rig = new VLRig();
    (opts.lights || []).slice(0, 3).forEach((l, i) => this.rig.set(i, l.pos, l.color, l.intensity, 9));
    const a = opts.ambient || new THREE.Color(0.06, 0.055, 0.05);
    this.rig.ambient(a.r, a.g, a.b);
    this.P = buildReceptionistModel(this.rig);
    this.root.add(this.P.root);
    this.anim = new ReceptionistAnimator(this.P);
    this.vfd = new VFD(this.rig);
    this.vfd.group.position.set(0.93, 1.075, 0.83);
    this.vfd.group.rotation.y = -0.62;
    this.root.add(this.vfd.group);
    this.root.traverse((o) => { if (o.isMesh) o.userData.noProbe = true; });
    this.queue = [];          // pending lines for the local speaker
    this.say = null;          // { id, n, s, t, dur }
    this.offerT = 0;          // local: dispatch offer open
    this.cool = 0;
    this.watchedT = 0; this.unwatchedT = 0; this.obsT = 0; this._obs = true;
    this.stare = false; this.stareHold = 0;
    this.attend = 0;
    this.keyT = 0;
    this.vfdT = 0;
  }

  build() {
    this.root.updateMatrixWorld(true);
    const ud = { kind: 'device', device: this };
    // torso + head (prompt target), and the display pole
    const boxes = [[0, 1.05, 0.02, 0.2, 0.28, 0.16], [0.93, 1.19, 0.83, 0.14, 0.05, 0.05]];
    for (const [x, y, z, hx, hy, hz] of boxes) {
      const c = this.root.localToWorld(V(x, y, z));
      this.colliders.push(this.world.physics.addStaticBox(c.x, c.y, c.z, hx, hy, hz, ud, this.root.rotation.y));
    }
  }

  get elevator() { return this.lobby?.elevator; }

  prompt() {
    const k = input.keyName('interact');
    const ph = this.elevator?.state.ph;
    if (ph === 'depart') return null;
    if (this.offerT > 0 && ph !== 'board') return `[${k}] Yes, dispatch me`;
    return `[${k}] Talk to the receptionist`;
  }

  interact(player) {
    if (this.cool > 0) return;
    this.cool = 0.6;
    const name = String(player?.name || this.world.game?.local?.name || 'EMPLOYEE').slice(0, 24);
    const ph = this.elevator?.state.ph;
    if (ph === 'board') { this._local(['hurry'], name); return; }
    if (ph === 'depart') { this._local(['transit'], name); return; }
    if (this.offerT > 0) {
      this.offerT = 0;
      this.queue.length = 0;
      this.send('dispatch', { n: name });
      return;
    }
    const first = !introduced.has(name);
    introduced.add(name);
    this._local(first ? ['intro1', 'intro2', 'offer'] : ['again', 'offer'], name);
    this.offerT = first ? 22 : 14;
  }

  // queue lines for the local player; each is broadcast so others see/hear her talk
  _local(ids, name) {
    this.queue = ids.map((id) => ({ id, n: name }));
    this._next();
  }
  _next() {
    const q = this.queue.shift();
    if (!q) return;
    this.send('say', { id: q.id, n: q.n, s: this.elevator?.secondsLeft?.() ?? 0 });
    this._speak(q.id, q.n, this.elevator?.secondsLeft?.() ?? 0, true);
  }

  hostAction(a, d, from) {
    if (a === 'say' && d && LINES[d.id]) {
      this.setState({ say: { id: d.id, n: String(d.n || '').slice(0, 24), s: d.s | 0, from, k: (this.state.say?.k || 0) + 1 } });
    } else if (a === 'dispatch') {
      const name = String(d?.n || 'EMPLOYEE').slice(0, 24);
      const ok = this.elevator?.hostBoard(name, from);
      const id = ok ? 'confirm' : 'transit';
      this.setState({ say: { id, n: name, s: 0, from: null, k: (this.state.say?.k || 0) + 1, press: ok ? 1 : 0 } });
    }
  }

  onState(s, fullSync) {
    if (!s.say || fullSync) return;
    if (s.say.from === net.selfId) return; // the speaker already played it locally
    this._speak(s.say.id, s.say.n, s.say.s, s.say.from == null && s.say.id !== 'missed' ? this._isMine(s.say.n) : false);
    if (s.say.press) this.anim.press();
  }
  _isMine(n) { return n && n === String(this.world.game?.local?.name || '').slice(0, 24); }

  // host: announce through her (e.g. nobody boarded)
  hostSay(id, n = '') { this.setState({ say: { id, n, s: 0, from: null, k: (this.state.say?.k || 0) + 1 } }); }

  _speak(id, n, secs, mine) {
    const N = (n || 'EMPLOYEE');
    const fill = (s) => s.replace('{N}', N).replace('{S}', String(secs)).replace('{K}', input.keyName('interact'));
    const text = fill(LINES[id] || '');
    const dur = 1.2 + text.length * 0.052;
    this.say = { id, text, vfd: (VFDTXT[id] || ['', '']).map((s) => fill(s).toUpperCase()), t: 0, dur };
    const head = this.P.head.getWorldPosition(V());
    audio.play('healthity_talk', { pos: head, volume: 0.55, length: Math.min(3.4, dur), pitch: 0.7 });
    if (mine) {
      this.world.game?.ui?.feed?.(text, 'hq', 'RECEPTION');
      this._tts(text);
    }
  }

  _tts(text) {
    if (profile.settings.healthityVoice === false) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/R\.O\.O\.M\./g, 'Room'));
      u.pitch = 0.9; u.rate = 0.98;
      u.volume = Math.max(0, Math.min(1, (profile.settings.master ?? 1) * (profile.settings.sfx ?? 1)));
      const vs = synth.getVoices?.() || [];
      const v = vs.find((x) => /en[-_](US|GB)/i.test(x.lang) && /female|samantha|victoria|karen|zira|susan|google uk english female/i.test(x.name)) || vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      synth.speak(u);
    } catch (e) { /* voice optional */ }
  }

  // nearest living clone's eyes within her attention radius
  _nearest(out) {
    const g = this.world.game;
    if (!g) return null;
    let best = null, bd = 9;
    const me = this.root.position;
    const consider = (p) => { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < bd) { bd = d; best = p; } };
    if (g.local && !g.local.dead && g.local.world) consider(g.local.pos);
    for (const r of g.remotes?.values?.() || []) if (r.inWorld && !r.dead) consider(r.pos);
    if (!best) return null;
    this.nearD = bd;
    return out.set(best.x, best.y + 1.12, best.z);
  }

  _observed() {
    const g = this.world.game;
    if (!g) return true;
    const p = this.P.head.getWorldPosition(_c);
    const list = [];
    if (g.local && !g.local.dead && g.local.world) list.push(g.local);
    for (const r of g.remotes?.values?.() || []) if (r.inWorld && !r.dead) list.push(r);
    if (!list.length) return true;
    for (const pl of list) {
      let dx = p.x - pl.pos.x, dy = p.y - (pl.pos.y + 1.16), dz = p.z - pl.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 30 || d < 1e-3) continue;
      dx /= d; dy /= d; dz /= d;
      const cp = Math.cos(pl.pitch || 0);
      if (-Math.sin(pl.yaw) * cp * dx + Math.sin(pl.pitch || 0) * dy - Math.cos(pl.yaw) * cp * dz > 0.42) return true;
    }
    return false;
  }

  secondsLeft() { return this.elevator?.secondsLeft?.() ?? 0; }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.cool = Math.max(0, this.cool - dt);
    this.offerT = Math.max(0, this.offerT - dt);
    const g = this.world.game;
    const near = g?.local?.pos ? g.local.pos.distanceTo(this.root.position) : 0;
    if (near > 28) return; // far away: freeze (saves the IK + instancing work)
    // speech
    if (this.say) {
      this.say.t += dt;
      if (this.say.t > this.say.dur) { this.say = null; this._next(); }
    }
    // observation -> stare when nobody looks, glitch back when caught
    this.obsT -= dt;
    if (this.obsT <= 0) { this.obsT = 0.25; this._obs = this._observed(); }
    if (this._obs) { this.watchedT += dt; this.unwatchedT = 0; } else { this.unwatchedT += dt; this.watchedT = 0; }
    const look = this._nearest(_d);
    let snap = false;
    if (!this._obs && this.unwatchedT > 1.6 && look && !this.say) { if (!this.stare) snap = true; this.stare = true; this.stareHold = 0.7; }
    if (this.stare && this._obs) {
      this.stareHold -= dt;
      if (this.stareHold <= 0) { this.stare = false; this.anim.twitch = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 }; this._servo(0.6); }
    }
    // attention: talking, or a clone at the counter
    const wantAttend = this.say ? 1 : look && this.nearD < 3.4 ? 0.85 : 0;
    this.attend += (wantAttend - this.attend) * (1 - Math.exp(-dt * 2.5));
    this.anim.glowK = this.stare ? 1.35 : 1;
    this.anim.update(dt, {
      look, snap, stare: this.stare, attend: this.attend, talking: this.say ? 1 : 0,
      onTwitch: () => this._servo(0.45),
      onKey: () => { if (near < 7 && (this.keyT -= 1) <= 0) { this.keyT = 2; audio.play('ui_type', { pos: this.P.head.getWorldPosition(_c).setY(0.8), volume: 0.12 }); } },
    });
    // customer display
    this.vfdT += dt;
    if (this.vfdT > 0.12) {
      this.vfdT = 0;
      const el = this.elevator;
      let lines;
      if (this.say) lines = this.say.vfd;
      else if (el?.state.ph === 'board') lines = ['ELEVATOR DEPARTS', `IN ${el.secondsLeft()} SECONDS`];
      else if (el?.state.ph === 'depart') lines = ['CAR IN TRANSIT', 'PLEASE WAIT'];
      else if (this.offerT > 0) lines = ['DISPATCH NOW?', `[${input.keyName('interact')}] YES`];
      else lines = Math.floor(this.anim.t / 6) % 3 === 2 ? ['WE SEE YOU', ''] : ['WELCOME TO R.O.O.M.', 'PLEASE SEE RECEPTION'];
      this.vfd.draw(lines, this.anim.t);
    }
  }

  _servo(v) { audio.play('_tick_small', { pos: this.P.head.getWorldPosition(_c), volume: v }); audio.play('android_servo', { pos: _c, volume: v * 0.8 }); }

  dispose() {
    super.dispose();
    this.vfd.dispose();
    this.P.root.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
    for (const m of Object.values(this.P.M)) m.dispose?.();
    this.P.lidMesh.material.dispose();
    this.P.irisMat.dispose();
  }
}
