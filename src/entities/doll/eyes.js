// R.O.O.M. — clone eyes: hand-painted irises for every pair of glass eyes (the 'eyes' cosmetic), the
// wet glossy iris overlay the avatar wears on its eyeballs, and standalone eyeballs (the jars in the
// customizer). Ids are the cosmetics ids (dollcos.js COSMETICS.eyes).
//
//   EYE_STYLE[id]            { style, c0 (inner), c1 (outer), ring, fleck, L/R overrides }
//   irisTexture(id, side)    256² painted iris (alpha = the iris disc with a soft limbal edge)
//   irisCap(r, mat)          the overlay mesh for an eye bone (eye looks toward -Z)
//   buildEyeball(id, side, r) sclera + iris + pupil glint (customizer jars, the fishing animation)
import * as THREE from 'three';
import { RNG } from '../../core/rng.js';
import { ptex, css, shade, mixHex, P } from './handpaint.js';

const PI = Math.PI, TAU = PI * 2;
export const EYE_STYLE = {
  glass: { style: 'radial', c0: 0x8a98a0, c1: 0x3c4c58, ring: 0x1c2228 },
  hazel: { style: 'radial', c0: 0xb98a3a, c1: 0x4e6a3a, ring: 0x2a2416, fleck: 0xd8a848 },
  green: { style: 'radial', c0: 0x7ab07a, c1: 0x2a5a3a, ring: 0x142a1a },
  doll: { style: 'radial', c0: 0x8ac0f0, c1: 0x2a5aa8, ring: 0x0e2240, fleck: 0xd8f0ff },
  beady: { style: 'void', c0: 0x2a2420, c1: 0x141210, ring: 0x080706 },
  red: { style: 'radial', c0: 0xe85a3a, c1: 0x7a1410, ring: 0x2a0806, fleck: 0xffa070 },
  void: { style: 'void', c0: 0x0a0a0c, c1: 0x050506, ring: 0x000000 },
  gold: { style: 'radial', c0: 0xf8d070, c1: 0xa87018, ring: 0x4a3008, fleck: 0xfff0b0 },
  cat: { style: 'slit', c0: 0xf0c040, c1: 0x8a9a28, ring: 0x2a2a08 },
  spiral: { style: 'spiral', c0: 0xf1e6cc, c1: 0x6e3f6e, ring: 0x241426 },
  marble: { style: 'marble', c0: 0xf1e6cc, c1: 0x3f8c8a, ring: 0x123030, fleck: 0xc4572a },
  odd: { style: 'radial', c0: 0x8ac0f0, c1: 0x2a5aa8, ring: 0x0e2240, R: { c0: 0xd09a48, c1: 0x6a3a14, ring: 0x2a1406 } },
  shutter: { style: 'shutter', c0: 0xd8d0c0, c1: 0x6a6660, ring: 0x2a2826 },
  milk: { style: 'milk', c0: 0xe8eef0, c1: 0xa8b8c0, ring: 0x6a7a84 },
};
export const eyeStyle = (id, side = 'L') => {
  const e = EYE_STYLE[id] || EYE_STYLE.glass;
  return side === 'R' && e.R ? { ...e, ...e.R } : e;
};

// ---------------------------------------------------------------------------
export function irisTexture(id, side = 'L') {
  const e = eyeStyle(id, side);
  return ptex('iris_' + id + '_' + (side === 'R' && EYE_STYLE[id]?.R ? 'R' : 'L'), 256, 256, (g, w, h, r) => {
    const cx = w / 2, cy = h / 2, R = w * 0.47;
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    if (e.style === 'radial' || e.style === 'milk' || e.style === 'void') {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, css(shade(e.c0, 0.1))); gr.addColorStop(0.35, css(e.c0)); gr.addColorStop(0.8, css(e.c1)); gr.addColorStop(1, css(shade(e.c1, -0.3)));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      if (e.style !== 'void') {
        // fibres: hundreds of fine radial strokes, light and dark
        g.lineCap = 'round';
        for (let i = 0; i < 420; i++) {
          const a = r.next() * TAU, r0 = R * (0.16 + r.next() * 0.12), r1 = R * (0.55 + r.next() * 0.42);
          const light = r.next() < 0.5;
          g.strokeStyle = css(light ? shade(mixHex(e.c0, e.c1, r.next()), 0.25) : shade(e.c1, -0.35), 0.06 + r.next() * 0.16);
          g.lineWidth = 0.6 + r.next() * 1.6;
          const wob = (r.next() - 0.5) * 0.12;
          g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.quadraticCurveTo(cx + Math.cos(a + wob) * (r0 + r1) / 2, cy + Math.sin(a + wob) * (r0 + r1) / 2, cx + Math.cos(a + wob * 0.5) * r1, cy + Math.sin(a + wob * 0.5) * r1);
          g.stroke();
        }
        // collarette: a wavy lighter ring at ~40 %
        g.strokeStyle = css(shade(e.c0, 0.3), 0.35); g.lineWidth = 3;
        g.beginPath();
        for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU, rr = R * (0.4 + 0.03 * Math.sin(a * 9 + 1) + 0.015 * Math.sin(a * 23)); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.stroke();
        // crypts: soft dark pockets
        for (let i = 0; i < 14; i++) {
          const a = r.next() * TAU, rr = R * (0.45 + r.next() * 0.35), s = R * (0.03 + r.next() * 0.05);
          g.fillStyle = css(shade(e.c1, -0.45), 0.25); g.beginPath(); g.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, s * 1.6, s * 0.7, a, 0, TAU); g.fill();
        }
        if (e.fleck) for (let i = 0; i < 22; i++) {
          const a = r.next() * TAU, rr = R * (0.25 + r.next() * 0.3);
          g.fillStyle = css(e.fleck, 0.25 + r.next() * 0.3); g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1 + r.next() * 2.5, 0, TAU); g.fill();
        }
        if (e.style === 'milk') { const m = g.createRadialGradient(cx - R * 0.1, cy - R * 0.1, 0, cx, cy, R); m.addColorStop(0, css(0xf4f6f6, 0.75)); m.addColorStop(0.7, css(0xe0e8ea, 0.4)); m.addColorStop(1, css(0xe0e8ea, 0)); g.fillStyle = m; g.fillRect(0, 0, w, h); }
      }
    } else if (e.style === 'slit') {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, css(shade(e.c0, 0.2))); gr.addColorStop(0.55, css(e.c0)); gr.addColorStop(1, css(e.c1));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) {
        const a = r.next() * TAU, r0 = R * 0.1, r1 = R * (0.6 + r.next() * 0.4);
        g.strokeStyle = css(r.next() < 0.5 ? shade(e.c0, 0.3) : shade(e.c1, -0.3), 0.08 + r.next() * 0.12); g.lineWidth = 0.6 + r.next();
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
      }
      g.fillStyle = css(0x0a0806); g.beginPath(); g.ellipse(cx, cy, R * 0.12, R * 0.78, 0, 0, TAU); g.fill();
    } else if (e.style === 'spiral') {
      g.fillStyle = css(e.c0); g.fillRect(0, 0, w, h);
      g.strokeStyle = css(e.c1); g.lineWidth = R * 0.11; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i <= 220; i++) { const t = i / 220, a = t * TAU * 3.2, rr = R * (0.08 + 0.9 * t); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      g.stroke();
      P.strokes(g, w, h, e.c1, r, { n: 20, alpha: 0.1, wid: 0.04 });
    } else if (e.style === 'marble') {
      const gr = g.createRadialGradient(cx - R * 0.2, cy - R * 0.2, 0, cx, cy, R);
      gr.addColorStop(0, css(0xf8f2e4)); gr.addColorStop(1, css(shade(e.c1, 0.2)));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (const [col, wd] of [[e.c1, 0.14], [e.fleck, 0.07], [shade(e.c1, -0.3), 0.04]]) {
        g.strokeStyle = css(col, 0.85); g.lineWidth = R * wd; g.lineCap = 'round';
        g.beginPath();
        const ph = r.next() * TAU;
        for (let i = 0; i <= 60; i++) { const t = i / 60, a = ph + t * PI * 1.6; g.lineTo(cx + Math.cos(a) * R * (0.95 - t * 0.6) + Math.sin(t * 9) * 6, cy + Math.sin(a) * R * (0.95 - t * 0.6)); }
        g.stroke();
      }
    } else if (e.style === 'shutter') {
      g.fillStyle = css(e.c1); g.fillRect(0, 0, w, h);
      // camera aperture blades
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        g.fillStyle = css(shade(e.c0, (i % 2 ? -0.1 : 0.05)), 1);
        g.strokeStyle = css(0x1a1816, 0.8); g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18);
        g.lineTo(cx + Math.cos(a + 0.3) * R * 1.05, cy + Math.sin(a + 0.3) * R * 1.05);
        g.lineTo(cx + Math.cos(a + 1.2) * R * 1.05, cy + Math.sin(a + 1.2) * R * 1.05);
        g.closePath(); g.fill(); g.stroke();
      }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.2; g.fillStyle = css(0x3a3632); g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86, 3, 0, TAU); g.fill(); }
    }
    // pupil (the LED glows on top of it) + limbal ring
    if (e.style !== 'slit') {
      const pr = e.style === 'void' ? R * 0.22 : e.style === 'shutter' ? R * 0.17 : R * 0.2;
      const pg = g.createRadialGradient(cx, cy, pr * 0.6, cx, cy, pr * 1.15);
      pg.addColorStop(0, css(0x060505)); pg.addColorStop(1, css(0x060505, 0));
      g.fillStyle = pg; g.beginPath(); g.arc(cx, cy, pr * 1.2, 0, TAU); g.fill();
    }
    const lr = g.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
    lr.addColorStop(0, css(e.ring, 0)); lr.addColorStop(0.75, css(e.ring, 0.65)); lr.addColorStop(1, css(e.ring, 0.95));
    g.fillStyle = lr; g.fillRect(0, 0, w, h);
    g.restore();
    // soft alpha edge outside the disc: fade the limbus into the white
    g.globalCompositeOperation = 'destination-in';
    const al = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
    al.addColorStop(0, 'rgba(0,0,0,1)'); al.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = al; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    void r;
  });
}

// sclera: warm off-white with faint veins toward the back and a darker rim
export function scleraTexture() {
  return ptex('eye_sclera', 256, 128, (g, w, h, r) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, css(0xf4eee2)); gr.addColorStop(0.55, css(0xece2d0)); gr.addColorStop(1, css(0xc8b6a0));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      let x = r.next() * w, y = h * (0.55 + r.next() * 0.45);
      g.strokeStyle = css(0xc0584a, 0.12 + r.next() * 0.25); g.lineWidth = 0.5 + r.next() * 1.2;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r.next() - 0.5) * 14; y -= r.next() * 10; g.lineTo(x, y); }
      g.stroke();
    }
    P.blotches(g, w, h, 0xd8a890, r, { n: 4, r: 0.2, alpha: 0.12 });
  });
}

// spherical cap facing -Z with planar UVs over the iris disc
const CAP = new Map();
export function irisCapGeo(r, ia = 0.52) {
  const key = r.toFixed(5) + '_' + ia;
  if (CAP.has(key)) return CAP.get(key);
  const g = new THREE.SphereGeometry(1, 36, 10, 0, TAU, 0, ia);
  const p = g.attributes.position, uv = g.attributes.uv, rim = Math.sin(ia);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.acos(Math.max(-1, Math.min(1, y))) / ia;
    const R = r + 0.0006 + 0.00016 * Math.cos(t * PI / 2);   // a hair proud of the iris dome, under the LED disc
    // pole +Y -> -Z
    p.setXYZ(i, x * R, -z * R, -y * R);
    uv.setXY(i, 0.5 + (x / rim) * 0.5, 0.5 - (z / rim) * 0.5);
  }
  g.computeVertexNormals();
  CAP.set(key, g);
  return g;
}
const IRIS_MAT = new Map();
export function irisMaterial(id, side = 'L') {
  const key = id + side;
  if (IRIS_MAT.has(key)) return IRIS_MAT.get(key);
  const m = new THREE.MeshPhysicalMaterial({
    name: 'iris_' + key, map: irisTexture(id, side), transparent: true, depthWrite: false,
    roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, ior: 1.4, envMapIntensity: 1.6,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  IRIS_MAT.set(key, m);
  return m;
}
export function irisCap(id, side, r) {
  const m = new THREE.Mesh(irisCapGeo(r), irisMaterial(id, side));
  m.name = 'iris_' + side; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2;
  return m;
}

// a loose glass eye: sclera ball + painted iris + a pupil disc (eye looks toward -Z)
let SCLERA_MAT = null;
export function buildEyeball(id, side = 'L', r = 0.0125) {
  const g = new THREE.Group(); g.name = 'eyeball_' + id;
  SCLERA_MAT ||= new THREE.MeshPhysicalMaterial({ name: 'eye_sclera', map: scleraTexture(), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1.4 });
  const ball = new THREE.SphereGeometry(r, 28, 18);
  ball.rotateX(-PI / 2);   // the sclera texture's top (v = 0) faces the front (-Z)
  const s = new THREE.Mesh(ball, SCLERA_MAT); s.castShadow = true;
  g.add(s);
  g.add(irisCap(id, side, r));
  return g;
}
void RNG;
