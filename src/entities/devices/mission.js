// Mission hardware shells (DKit): the CX-9 asset compactor (crusher) and the COMPANY STORE / FIELD OPS
// kiosks. Static, merged per material (a handful of draw calls each) and cached as templates by
// models_devices.buildDevice(); the game objects (src/game/crusher.js, src/game/terminals.js) add their
// own animated / emissive / screen parts on top, in the same local frames as before.
//   crusher_frame   plinth + teleport bed print, riveted chamber walls with bolted wear liners, I-beam
//                   columns, box-girder crosshead, hydraulic cylinders with tie rods, Tesla coils, hoses,
//                   hydraulic power unit, beacon guard, pressure gauge (parts.needle), escape-gauge cabinet,
//                   control pedestal + CRT housing + e-stop collar
//   crusher_ram     the platen (serrated hardened face, guide shoes, clevis flanges, chrome rods)
//   crusher_gate    the drop shutter (bars + riveted red cross straps), hangs down from its origin
//   kiosk_shop      cabinet, service door, louvres, credits bezel, backdrop frame, marquee, emitter
//                   housings and the sloped control console (frame: con, see terminals.js)
//   kiosk_quest     cabinet, desk, keyboard, termlink monitor housing, marquee, projector base, printer
//   kiosk_key       arrow push key cap, kiosk_crank  fluted crank knob (rotates about local X)
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, frameShape, polyShape, boxGeo, axisGeo, curvePts } from './core.js';
import * as P from './parts.js';
import { txt, grime, rubOff, drawLogo, hazardTri } from './atlas.js';
import { FONT, font, weightOf } from '../../ui/fonts.js';

// printed text goes through the user's font slots (plates / stencils / signs -> 'sign'), one flat ink
const F = (slot = 'sign') => ({ f: FONT[slot], w: String(weightOf(slot)) });

const YEL = 0xd9a21b, GREY = 0x3c4044, RED = 0xa3271c, HPU = 0x3e5667, OLIVE = 0x56603f, BEIGE = 0xcfc3a0;
const STEEL = FIN.steel, IRON = FIN.iron;

// crusher layout (must match src/game/crusher.js)
const CX = 1.15, CZ0 = -0.95, CZ1 = 0.95, BED = 0.24, CTOP = 2.05, RAM_H = 0.5;

function stripes(c, x, y, w, h, s = 28) {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = '#141414'; c.fillRect(x, y, w, h);
  c.fillStyle = '#f2c418';
  for (let i = -h; i < w + h; i += s * 2) { c.beginPath(); c.moveTo(x + i, y + h); c.lineTo(x + i + h, y); c.lineTo(x + i + h + s, y); c.lineTo(x + i + s, y + h); c.fill(); }
  c.restore();
}
// draw at a reference resolution into any region size
const scaled = (W0, H0, fn) => (c, w, h, rng) => { c.save(); c.scale(w / W0, h / H0); fn(c, W0, H0, rng); c.restore(); };

const signDraw = scaled(1024, 200, (c, w, h) => {
  c.fillStyle = '#1a1c1f'; c.fillRect(0, 0, w, h);
  stripes(c, 0, 0, w, 22); stripes(c, 0, h - 22, w, 22);
  const ink = { col: '#f2c418', ...F(), maxW: w * 0.92 };
  txt(c, 'ASSET COMPACTOR', w / 2, 80, 74, ink);
  txt(c, 'R.O.O.M. CX-9  ·  CRUSH  ·  COMPRESS  ·  TELEPORT', w / 2, 134, 30, ink);
  txt(c, 'KEEP HANDS, FEET AND COWORKERS CLEAR OF THE PRESS', w / 2, 164, 22, ink);
  grime(c, w, h, 1.4, 5); rubOff(c, w, h, 1.6, 7);
});
const bedDraw = scaled(512, 512, (c, w, h, rng) => {
  c.fillStyle = '#2b2f33'; c.fillRect(0, 0, w, h);
  // tread-plate lozenges under the print
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 3; c.lineCap = 'round';
  c.beginPath();
  for (let y = 0; y < h; y += 18) for (let x = (y / 18) % 2 ? 9 : 0; x < w; x += 18) { const d = ((x + y) / 18) % 2 ? 1 : -1; c.moveTo(x - 4.5, y - 3.5 * d); c.lineTo(x + 4.5, y + 3.5 * d); }
  c.stroke();
  stripes(c, 0, 0, w, 26); stripes(c, 0, h - 26, w, 26);
  c.save(); c.translate(w / 2, h / 2);
  c.strokeStyle = 'rgba(160,230,255,0.5)'; c.lineWidth = 3;
  for (let r = 40; r < 220; r += 34) { c.beginPath(); c.arc(0, 0, r, 0, PI * 2); c.stroke(); }
  for (let i = 0; i < 16; i++) { c.rotate(PI / 8); c.beginPath(); c.moveTo(30, 0); c.lineTo(220, 0); c.stroke(); }
  c.restore();
  txt(c, 'TELEPORT BED', w / 2, h / 2 + 2, 26, { col: '#d8d2c0', ...F() });
  for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(${rng.next() < 0.3 ? '90,40,14' : '0,0,0'},${rng.next() * 0.14})`; c.fillRect(rng.next() * w, rng.next() * h, 2 + rng.next() * 8, 1 + rng.next() * 3); }
  grime(c, w, h, 2, 3, { edges: false });
});
// escape-fund scale: y 150..900 of 1024 = the tube (see crusher.js yAt)
const scaleDraw = scaled(256, 1024, (c, w, h) => {
  c.fillStyle = '#ece6d4'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a1c1f'; c.fillRect(0, 0, w, 120); c.fillRect(0, h - 70, w, 70);
  const light = { col: '#ece6d4', ...F() }, dark = { col: '#1a1c1f', ...F(), al: 'left' };
  txt(c, 'ESCAPE', w / 2, 40, 34, light); txt(c, 'FUND', w / 2, 82, 34, light);
  txt(c, 'LEVEL QUOTA', w / 2, h - 36, 22, light);
  const y0 = 900, y1 = 150;
  for (let i = 0; i <= 40; i++) {
    const y = y0 + (y1 - y0) * (i / 40);
    const major = i % 10 === 0, mid = i % 5 === 0;
    c.fillStyle = '#1a1c1f';
    c.fillRect(150, y - (major ? 2 : 1), major ? 70 : mid ? 46 : 26, major ? 4 : 2);
    if (major) txt(c, ['$0', '250K', '500K', '750K', '$1M'][i / 10], 8, y, 30, dark);
  }
  c.fillStyle = '#c8241c'; c.fillRect(150, y1 - 30, 70, 8);
  txt(c, 'EXIT', 160, y1 - 52, 22, dark);
  grime(c, w, h, 2.5, 11);
});
const stencil = (lines, col = '#1a1917') => (c, w, h) => {
  c.clearRect(0, 0, w, h);
  lines.forEach(([s, y, px]) => txt(c, s, w / 2, h * y, h * px, { col, ...F(), maxW: w * 0.94 }));
  rubOff(c, w, h, 2.2, 13);
};
function makerPlate(k, key, l1, l2) {
  return k.reg(key, 240, 96, (c, w, h) => {
    c.fillStyle = '#b8bbb8'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(255,255,255,${0.03 + ((y * 7) % 5) * 0.01})`; c.fillRect(0, y, w, 1); }
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 3; c.strokeRect(6, 6, w - 12, h - 12);
    drawLogo(c, 34, h / 2, 18, '#222');
    txt(c, l1, w / 2 + 22, h * 0.38, 20, { col: '#1a1a1a', ...F(), maxW: w - 80 });
    txt(c, l2, w / 2 + 22, h * 0.68, 13, { col: '#1a1a1a', ...F(), maxW: w - 80 });
    grime(c, w, h, 1, 3);
  }, 'b');
}
function helix(cx, cz, r, y0, y1, turns, perTurn = 14) {
  const n = Math.ceil(turns * perTurn), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * TAU; out.push([cx + Math.cos(a) * r, y0 + (y1 - y0) * t, cz + Math.sin(a) * r]); }
  return out;
}
// hose with crimped ferrules at both ends and a band clamp near each end
function hose(k, pts, r, o = {}) {
  k.tube('dark', curvePts(pts, o.n ?? 40), r, { tint: o.tint ?? 0x1b1b1c, radial: 10, caps: false, rough: 0.9 });
  for (const end of [0, 1]) {
    const a = new THREE.Vector3(...pts[end ? pts.length - 1 : 0]), b = new THREE.Vector3(...pts[end ? pts.length - 2 : 1]);
    const d = b.clone().sub(a).normalize();
    P.rod(k, 'metal', a.clone().addScaledVector(d, -0.01).toArray(), a.clone().addScaledVector(d, 0.11).toArray(), r * 1.28, { ...FIN.zinc, seg: 6, bev: 0.004, rust: 0.4 });
    P.rod(k, 'metal', a.clone().addScaledVector(d, 0.16).toArray(), a.clone().addScaledVector(d, 0.185).toArray(), r * 1.12, { ...STEEL, seg: 12, bev: 0.002 });
  }
}

// ---------------------------------------------------------------------------------------------- crusher
export function b_crusher_frame() {
  const k = new DKit('crusher_frame', { wear: { chip: 0.32, rust: 0.42, grime: 0.6, dust: 0.35 }, ao: { res: 72 } });
  k.atlas(1024, 1536);
  // big prints first (skyline packer): sign, bed, scale
  const R_SIGN = k.reg('sign', 1024, 200, signDraw, { e: 0.08, r: 0.5, m: 0.15 });
  const R_BED = k.reg('bed', 512, 512, bedDraw, 's');
  const R_SCALE = k.reg('scale', 192, 768, scaleDraw, '');
  const pY = { tint: YEL, rough: 0.9 }, pG = { tint: GREY, rough: 1.0 }, pR = { tint: RED };
  const H = CTOP - BED, WY = (CTOP + BED) / 2;

  // --- plinth: welded box base on levelling feet, tread deck, hazard-striped front, steel nosing
  k.box('paint', 3.76, BED - 0.06, 2.46, 0, 0.04 + (BED - 0.06) / 2, -0.15, { ...pG, r: 0.012, seg: 2, div: 0.4 });
  k.box('metal', 3.8, 0.022, 2.5, 0, BED - 0.011, -0.15, { ...IRON, r: 0.005, rust: 0.6 });
  k.box('dark', 3.6, 0.04, 2.3, 0, 0.02, -0.15, { tint: 0x1d1d1e, r: 0.004 });
  P.hazardRect(k, 3.62, BED - 0.1, 0, 0.04 + (BED - 0.06) / 2, 1.08, { sw: 0.07, chip: 0.5 });
  k.box('metal', 3.8, 0.008, 0.06, 0, BED - 0.004 + 0.004, 1.07, { ...STEEL, r: 0.002 });
  k.box('metal', 3.8, 0.05, 0.008, 0, BED - 0.025, 1.104, { ...STEEL, r: 0.002 });
  for (const x of [-1.84, -0.6, 0.6, 1.84]) for (const z of [-1.34, 1.04]) {
    k.lathe('metal', [[0, 0], [0.05, 0, 1], [0.05, 0.012, 2], [0.022, 0.016], [0.022, 0.04]], x, 0, z, { ...IRON, seg: 14 });
    P.screw(k, x, 0.04, z, { kind: 'hex', r: 0.016, dir: 'y', rust: 0.8 });
  }
  for (const sx of [-1, 1]) {
    P.onFace(k, sx * 1.88, BED / 2, -0.15, sx > 0 ? 'x' : '-x', () => {
      P.slotVent(k, 0, 0.0, 0, 0.8, 0.1, 5, { vertical: true, mo: pG });
      for (const u of [-0.95, 0.95]) P.screw(k, u, 0, 0.0, { kind: 'hex', r: 0.01 });
    });
  }
  // teleport bed print + emitter pucks at its corners
  k.label(R_BED, CX * 2, CZ1 - CZ0, 0, BED + 0.0006, (CZ0 + CZ1) / 2, { rot: [-HP, 0, 0], dust: 0.25, grime: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (CX - 0.1), z = (sz > 0 ? CZ1 : CZ0) - sz * 0.1;
    k.lathe('metal', [[0, 0], [0.05, 0, 1], [0.05, 0.008, 2], [0.04, 0.014, 2], [0.02, 0.016], [0, 0.016]], x, BED, z, { ...FIN.chrome, seg: 18 });
  }

  // --- chamber walls: box-section steel, riveted inner face with bolted wear liners, ribbed outside
  for (const s of [-1, 1]) {
    const xc = s * (CX + 0.15);
    k.box('paint', 0.28, H, 2.18, xc, WY, -0.15, { ...pG, r: 0.014, seg: 2, div: 0.35, chip: 0.4 });
    k.box('paint', 0.31, 0.03, 2.21, xc, CTOP - 0.005, -0.15, { ...pY, r: 0.008 });
    // inner liners (dented, rusty) + rivet grid
    for (const [y0, h0] of [[BED + 0.08, 0.78], [BED + 0.9, 0.8]]) {
      k.box('paint', 0.016, h0, 1.84, s * (CX + 0.008), y0 + h0 / 2, -0.07, { tint: 0x55524c, r: 0.004, chip: 0.7, rust: 0.85, dent: 0.004, div: 0.22 });
      for (let i = 0; i < 6; i++) for (const yy of [y0 + 0.05, y0 + h0 - 0.05]) P.screw(k, s * CX, yy, -0.95 + 0.06 + i * 0.335, { kind: 'hex', r: 0.012, dir: s > 0 ? '-x' : 'x', rust: 0.9 });
    }
    // front end face: hazard stripes + vertical weld
    P.hazardRect(k, 0.24, H - 0.12, xc, WY, CZ1 - 0.01 + 0.0, { sw: 0.06, dir: s, chip: 0.55 });
    // outside: vertical stiffeners, a horizontal rib, weld beads and run-off
    const xo = s * (CX + 0.29);
    for (const z of [-1.05, -0.45, 0.2, 0.75]) {
      k.box('paint', 0.06, H - 0.08, 0.025, xo + s * 0.03, WY, z, { ...pG, r: 0.006, seg: 1 });
    }
    P.onFace(k, xo, 0, 0, s > 0 ? 'x' : '-x', () => {
      for (const u of [-0.75, 0.0, 0.48]) P.streak(k, u * s, CTOP - 0.1, 0.002, 0.14, 0.9, { col: '96,42,14', alpha: 0.45 });
      k.label(makerPlate(k, 'mp_wall', 'CX-9 COMPACTOR', '400 T · 1979 · No. 0007'), 0.22, 0.09, -0.6 * s, BED + 0.5, 0.0005);
    });
  }
  // back wall + bolted rust liner on its inner face
  k.box('paint', CX * 2 + 0.58, H, 0.28, 0, WY, CZ0 - 0.15, { ...pG, r: 0.014, seg: 2, div: 0.35 });
  k.box('paint', CX * 2 + 0.62, 0.03, 0.31, 0, CTOP - 0.005, CZ0 - 0.15, { ...pY, r: 0.008 });
  k.box('rust', CX * 2 - 0.1, 1.5, 0.018, 0, BED + 0.12 + 0.75, CZ0 + 0.009, { r: 0.004, dent: 0.006, div: 0.22 });
  for (let i = 0; i < 8; i++) for (const y of [BED + 0.18, BED + 0.86, BED + 1.56]) P.screw(k, -CX + 0.12 + i * ((CX * 2 - 0.24) / 7), y, CZ0 + 0.018, { kind: 'hex', r: 0.013, rust: 1 });
  P.onFace(k, 0, 0, CZ0 - 0.29, '-z', () => {
    for (const y of [BED + 0.5, BED + 1.25]) k.box('paint', CX * 2 + 0.5, 0.025, 0.05, 0, y, 0.025, { ...pG, r: 0.006 });
    for (const x of [-0.9, 0, 0.9]) P.streak(k, x, CTOP - 0.05, 0.002, 0.2, 1.2, { alpha: 0.5 });
  });

  // --- columns: rolled I-beams on gusseted base plates, bolted to the crosshead
  const I = [[-0.2, 0.46], [0.2, 0.46], [0.2, 0.38], [0.04, 0.38], [0.04, -0.58], [0.2, -0.58], [0.2, -0.66], [-0.2, -0.66], [-0.2, -0.58], [-0.04, -0.58], [-0.04, 0.38], [-0.2, 0.38]];
  const ish = polyShape(I.map(([x, z]) => [x, -z]));
  for (const s of [-1, 1]) {
    const cx = s * (CX + 0.5);
    k.ext('paint', ish, 3.74, cx, 0.03, 0, { ...pY, rot: [-HP, 0, 0], bev: 0.005, bevSeg: 1, chip: 0.38 });
    k.box('paint', 0.56, 0.035, 1.3, cx, 0.0175, -0.1, { ...pG, r: 0.006 });
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) P.screw(k, cx + sx * 0.23, 0.035, -0.1 + sz * 0.6, { kind: 'hex', r: 0.016, dir: 'y', thread: 0.025, rust: 0.9 });
    for (const sx of [-1, 1]) for (const z of [-0.35, 0.15]) {
      k.ext('paint', polyShape([[0, 0], [0.15, 0], [0, 0.32]]), 0.018, cx + sx * 0.04, 0.035, z, { ...pY, rot: sx > 0 ? null : [0, PI, 0], bev: 0.002, bevSeg: 1 });
    }
    // rivet rows down the front flange, hazard band at the foot, column splice plate under the head
    P.onFace(k, cx, 0, 0.46, 'z', () => {
      for (let y = 0.85; y < 3.6; y += 0.28) for (const u of [-0.15, 0.15]) P.rivet(k, u, y, 0, { r: 0.009 });
      P.hazardRect(k, 0.4, 0.55, 0, 0.35, 0.0, { sw: 0.06, dir: s });
      P.streak(k, 0.08 * s, 3.5, 0.002, 0.12, 1.1, { alpha: 0.4 });
    });
    k.box('paint', 0.5, 0.3, 0.02, cx, 3.6, 0.47, { ...pY, r: 0.004 });
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) P.screw(k, cx + sx * 0.19, 3.6 + sy * 0.1, 0.48, { kind: 'hex', r: 0.012 });
  }

  // --- crosshead: box girder with stiffeners, bolted cover plate, lifting lugs
  k.box('paint', 3.9, 0.6, 1.7, 0, 4.1, -0.1, { ...pY, r: 0.02, seg: 2, div: 0.4 });
  k.box('paint', 3.98, 0.035, 1.78, 0, 4.42, -0.1, { ...pY, r: 0.008 });
  k.box('paint', 3.98, 0.06, 1.78, 0, 3.77, -0.1, { ...pG, r: 0.01 });
  for (let i = 0; i < 9; i++) {
    const x = -1.8 + i * 0.45;
    if (Math.abs(x) > 0.7) for (const z of [0.775, -0.975]) k.box('paint', 0.03, 0.6, 0.05, x, 4.1, z, { ...pY, r: 0.006, seg: 1 });
    else k.box('paint', 0.03, 0.6, 0.05, x, 4.1, -0.975, { ...pY, r: 0.006, seg: 1 });
    for (const z of [-0.9, 0.7]) P.screw(k, x + 0.22, 4.4375, z, { kind: 'hex', r: 0.012, dir: 'y' });
  }
  for (const x of [-1.2, 1.2]) {
    k.ext('paint', frameShape(0.22, 0.2, 0.09, 0.09, 0.09, 0.045, 0, 0.02), 0.04, x, 4.53, -0.12, { ...pY, bev: 0.006 });
    P.weld(k, [[x - 0.1, 4.44, -0.1], [x + 0.1, 4.44, -0.1]], 0.005);
  }
  k.decal(k.reg('st_load', 512, 96, stencil([['MAX LOAD 400 T', 0.36, 0.5], ['HYDRAULIC · 21 MPa', 0.8, 0.26]], '#1a1917')), 1.3, 0.24, 0, 4.12, 0.751);
  k.label(makerPlate(k, 'mp_head', 'R.O.O.M. HEAVY', 'PRESS DIV. · DO NOT LIFT'), 0.36, 0.14, 1.45, 4.12, 0.752);
  P.onFace(k, 0, 0, 0.75, 'z', () => { for (const x of [-1.6, -0.7, 0.9, 1.7]) P.streak(k, x, 3.8, 0.002, 0.16, 0.6, { alpha: 0.35 }); });

  // --- header plate + sign (front, above the chamber mouth)
  k.box('paint', CX * 2 + 0.6, 0.72, 0.1, 0, CTOP + 0.36, CZ1 + 0.05, { ...pG, r: 0.01 });
  k.ext('paint', frameShape(CX * 2 + 0.6, 0.72, 0.012, CX * 2 + 0.44, 0.6, 0.006), 0.022, 0, CTOP + 0.36, CZ1 + 0.1, { ...pY, bev: 0.004, bevSeg: 1, curveSeg: 2 });
  k.label(R_SIGN, CX * 2 + 0.46, 0.6, 0, CTOP + 0.36, CZ1 + 0.1005);
  for (let i = 0; i < 8; i++) for (const sy of [-1, 1]) P.screw(k, -1.38 + i * (2.76 / 7), CTOP + 0.36 + sy * 0.33, CZ1 + 0.122, { kind: 'button', r: 0.009 });

  // --- hydraulic cylinders: barrel, caps, four tie rods with nuts, rod gland, side ports
  for (const s of [-1, 1]) {
    const x = s * 0.55, z = -0.05;
    k.lathe('paint', [[0.12, 2.6], [0.25, 2.6, 1], [0.25, 2.7, 2], [0.205, 2.71], [0.205, 3.63], [0.25, 3.64, 1], [0.25, 3.74, 2], [0.2, 3.76]], x, 0, z, { ...pG, seg: 32, chip: 0.35 });
    k.lathe('metal', [[0.0, 2.57], [0.13, 2.57, 1], [0.135, 2.6], [0.12, 2.62]], x, 0, z, { ...STEEL, seg: 24 });
    k.tor('dark', 0.116, 0.008, x, 2.565, z, { axis: 'y', ts: 24, rs: 6, tint: 0x111111 });
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + i * HP, rx = x + Math.cos(a) * 0.228, rz = z + Math.sin(a) * 0.228;
      k.cyl('metal', 0.012, 1.14, rx, 3.17, rz, { ...STEEL, seg: 8 });
      P.screw(k, rx, 2.6, rz, { kind: 'hex', r: 0.018, dir: '-y', rust: 0.6 });
    }
    for (const y of [2.8, 3.55]) {
      k.cyl('metal', 0.03, 0.08, x, y, z - 0.24, { ...STEEL, axis: 'z', seg: 6, bev: 0.004 });
      k.cyl('metal', 0.022, 0.06, x, y, z - 0.31, { ...FIN.brass, axis: 'z', seg: 12 });
    }
    k.clabel(makerPlate(k, 'mp_cyl', 'HYD. CYL. 400T', 'STROKE 1800 · 21 MPa'), 0.2065, 0.08, 0.95, x, 3.2, z);
  }
  // supply hoses: cylinder ports -> under the crosshead -> down the back -> power-unit manifold
  const HX = 1.07, HZ = -1.66;
  for (const s of [-1, 1]) {
    hose(k, [[s * 0.55, 3.55, -0.36], [s * 0.6, 3.5, -0.7], [s * 0.85, 3.2, -1.32], [0.5 + s * 0.45, 1.7, -1.42], [HX - 0.05 + (s + 1) * 0.05, 1.25, HZ + 0.06], [HX - 0.05 + (s + 1) * 0.05, 0.86, HZ + 0.06]], 0.032);
    hose(k, [[s * 0.55, 2.8, -0.36], [s * 0.62, 2.75, -0.8], [s * 0.7, 2.5, -1.34], [0.4 + s * 0.4, 1.4, -1.45], [HX - 0.05 + (s + 1) * 0.05, 1.15, HZ - 0.06], [HX - 0.05 + (s + 1) * 0.05, 0.86, HZ - 0.06]], 0.026, { tint: 0x2a2620 });
  }

  // --- hydraulic power unit on its skid behind the press: tank, motor, bell housing, pump, manifold
  {
    const x0 = 1.4, z0 = HZ, TINT = { tint: HPU }, MOT = { tint: 0x2f5d4a };
    P.channel(k, 'paint', 1.0, 0.08, 0.04, 0.005, x0 - 0.5, 0.04, z0 + 0.26, { ...pG });
    P.channel(k, 'paint', 1.0, 0.08, 0.04, 0.005, x0 - 0.5, 0.04, z0 - 0.26, { ...pG, flip: true });
    k.box('paint', 0.9, 0.46, 0.5, x0, 0.08 + 0.23, z0, { ...TINT, r: 0.02, seg: 2, div: 0.2 });
    k.box('paint', 0.92, 0.02, 0.52, x0, 0.55, z0, { ...TINT, r: 0.006 });
    P.onFace(k, x0 + 0.45, 0.3, z0, 'x', () => {
      k.ext('metal', frameShape(0.05, 0.22, 0.012, 0.026, 0.19, 0.008), 0.008, 0.15, 0, 0, { ...STEEL, bev: 0.002 });
      k.box('#c89a2a:g', 0.026, 0.12, 0.004, 0.15, -0.04, 0.002, { r: 0 });
      k.box('glass', 0.026, 0.19, 0.003, 0.15, 0, 0.006);
      k.label(makerPlate(k, 'mp_hpu', 'POWER PACK 15 kW', '400 V · 3~ · ISO VG 46'), 0.24, 0.095, -0.06, 0.06, 0.0005);
      P.screw(k, 0.15, -0.19, 0, { kind: 'hex', r: 0.014 });
      P.streak(k, 0.15, -0.2, 0.001, 0.08, 0.3, { col: '40,30,18', alpha: 0.6 });
    });
    k.lathe('metal', [[0, 0], [0.035, 0, 1], [0.035, 0.02, 2], [0.025, 0.03], [0.025, 0.05], [0, 0.055]], x0 + 0.33, 0.56, z0 + 0.21, { ...FIN.black, seg: 16 });
    // motor (drive end toward the pump), cooling fins, fan cowl + grille, terminal box
    const mx = x0 + 0.08, my = 0.73;
    k.lathe('paint', [[0.0, -0.3], [0.04, -0.3], [0.06, -0.25], [0.15, -0.24, 2], [0.165, -0.2], [0.165, 0.22], [0.15, 0.26, 1], [0, 0.26]], mx, my, z0, { ...MOT, seg: 28, axis: 'x' });
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; k.box('paint', 0.38, 0.008, 0.026, mx - 0.01, my + Math.sin(a) * 0.172, z0 + Math.cos(a) * 0.172, { ...MOT, r: 0, rot: [-a, 0, 0] }); }
    k.cyl('paint', 0.172, 0.08, mx + 0.3, my, z0, { ...MOT, axis: 'x', seg: 28, bev: 0.012 });
    P.onFace(k, mx + 0.34, my, z0, 'x', () => P.perfGrille(k, 0, 0, 0, 0.22, 0.22, { cr: 0.1, step: 0.02, hr: 0.006, mo: MOT }));
    k.box('paint', 0.14, 0.1, 0.12, mx, my + 0.2, z0, { ...MOT, r: 0.01 });
    P.gland(k, mx, my + 0.2, z0 + 0.06, 0.01);
    k.cyl('metal', 0.09, 0.12, x0 - 0.18, my, z0, { ...FIN.alu, axis: 'x', seg: 20, bev: 0.008 });
    k.box('metal', 0.14, 0.16, 0.16, HX, 0.66, z0, { ...FIN.alu, r: 0.012 });
    k.box('metal', 0.16, 0.09, 0.2, HX, 0.785, z0, { ...STEEL, r: 0.008 });
    P.gauge(k, HX + 0.03, 0.785, z0 + 0.1, 0.03, { label: 'MPa', max: 25, red: 0.85, value: 0.55, key: 'hpu', static: true, name: 'hpu_needle' });
  }

  // --- Tesla coils in the back corners: ceramic stack, copper helix, corona ring, wall bracket
  for (const s of [-1, 1]) {
    const x = s * (CX - 0.12), z = CZ0 + 0.12;
    const prof = [[0, BED], [0.08, BED, 1]];
    for (let i = 0; i < 4; i++) { const y = BED + 0.02 + i * 0.04; prof.push([0.075, y], [0.05, y + 0.012], [0.05, y + 0.028], [0.075, y + 0.04]); }
    prof.push([0.035, BED + 0.19], [0.035, BED + 0.2]);
    k.lathe('plastic', prof, x, 0, z, { tint: 0xe6dfcc, rough: 0.4, seg: 20 });
    k.cyl('dark', 0.04, 1.32, x, BED + 0.86, z, { tint: 0x1a1612, seg: 12 });
    k.tube('metal', helix(x, z, 0.066, BED + 0.24, BED + 1.42, 9, 10), 0.011, { ...FIN.copper, radial: 5, caps: true });
    k.tor('metal', 0.075, 0.016, x, BED + 1.5, z, { ...FIN.chrome, axis: 'y', ts: 24, rs: 8 });
    k.box('metal', 0.04, 0.03, 0.11, x, BED + 1.46, z - 0.06, { ...STEEL, r: 0.004 });
    k.box('metal', 0.1, 0.1, 0.008, x, BED + 1.46, CZ0 + 0.022, { ...STEEL, r: 0.003 });
    for (const sy of [-1, 1]) P.screw(k, x, BED + 1.46 + sy * 0.035, CZ0 + 0.026, { kind: 'hex', r: 0.007 });
    k.decal(k.reg('hv', 96, 96, (c, w, h) => { c.clearRect(0, 0, w, h); hazardTri(c, w / 2, h / 2 + 4, w * 0.8, '⚡'); }), 0.12, 0.12, x - s * 0.2, BED + 1.2, CZ0 + 0.019);
  }

  // --- warning beacon base + wire guard (the lens is the game's, it spins)
  {
    const bx = -1.4, by = 4.45, bz = 0.4;
    k.lathe('dark', [[0, by], [0.13, by, 1], [0.13, by + 0.03, 2], [0.11, by + 0.05], [0.09, by + 0.06], [0, by + 0.06]], bx, 0, bz, { tint: 0x1c1c1c, seg: 24 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + PI / 4, c = Math.cos(a), sn = Math.sin(a);
      k.tube('metal', [[bx + c * 0.115, by + 0.05, bz + sn * 0.115], [bx + c * 0.125, by + 0.2, bz + sn * 0.125], [bx + c * 0.05, by + 0.3, bz + sn * 0.05], [bx, by + 0.31, bz]], 0.004, { ...FIN.black, radial: 5, round: 0.04, rseg: 3 });
    }
    k.tor('metal', 0.124, 0.004, bx, by + 0.17, bz, { ...FIN.black, axis: 'y', ts: 24, rs: 4 });
  }

  // --- pressure gauge on the left column (parts.needle, rotated by the game)
  k.lathe('metal', [[0.05, 0], [0.05, 0.03]], -(CX + 0.5), 2.95, 0.46, { ...STEEL, axis: 'z', seg: 12 });
  k.parts.needle = P.gauge(k, -(CX + 0.5), 2.95, 0.49, 0.17, { label: 'MPa', max: 40, red: 0.78, value: 0, key: 'press', bezel: FIN.chrome, cup: FIN.black, screws: true, name: 'needle' });

  // --- escape-fund gauge cabinet (scale print, tube clamps, bulb guard, lamp guard, counter bezel)
  {
    const gx = CX + 1.1, cyc = 2.15;
    k.box('paint', 0.66, 0.2, 0.3, gx, 0.1, 0.25, { ...pG, r: 0.012 });
    for (const sx of [-1, 1]) P.screw(k, gx + sx * 0.26, 0.2, 0.36, { kind: 'hex', r: 0.012, dir: 'y' });
    k.box('paint', 0.62, 3.9, 0.12, gx, cyc, 0.25, { ...pG, r: 0.014, seg: 2, div: 0.3 });
    k.ext('paint', frameShape(0.62, 3.9, 0.014, 0.54, 3.64, 0.008), 0.02, gx, cyc, 0.31, { ...pY, bev: 0.004, bevSeg: 1, curveSeg: 2 });
    k.label(R_SCALE, 0.52, 3.6, gx, cyc, 0.3105);
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) P.screw(k, gx + sx * 0.29, cyc - 1.8 + i * 0.72, 0.33, { kind: 'button', r: 0.008 });
    const tubeX = gx - 0.06, ty0 = 2.15 + 1.8 - (900 / 1024) * 3.6, ty1 = 2.15 + 1.8 - (150 / 1024) * 3.6;
    k.lathe('glass', [[0.06, ty0 - 0.02], [0.06, ty1 + 0.04], [0.045, ty1 + 0.075], [0.0, ty1 + 0.085]], tubeX, 0, 0.38, { seg: 18 });
    for (let y = ty0 + 0.25; y < ty1; y += 0.62) {
      k.tor('metal', 0.066, 0.006, tubeX, y, 0.38, { ...STEEL, axis: 'y', ts: 18, rs: 5 });
      for (const sx of [-1, 1]) { k.box('metal', 0.022, 0.014, 0.03, tubeX + sx * 0.07, y, 0.345, { ...STEEL, r: 0.002 }); P.screw(k, tubeX + sx * 0.07, y, 0.36, { kind: 'slot', r: 0.005 }); }
    }
    k.lathe('metal', [[0.0, ty1 + 0.05], [0.08, ty1 + 0.05, 1], [0.08, ty1 + 0.1, 2], [0.06, ty1 + 0.12], [0.0, ty1 + 0.13]], tubeX, 0, 0.38, { ...FIN.chrome, seg: 20 });
    k.lathe('metal', [[0.0, ty0 - 0.3], [0.1, ty0 - 0.3, 1], [0.12, ty0 - 0.26, 2], [0.12, ty0 - 0.22], [0.0, ty0 - 0.22]], tubeX, 0, 0.38, { ...FIN.chrome, seg: 24 });
    for (let i = 0; i <= 4; i++) { const a = (i / 4) * PI, c = Math.cos(a), sn = Math.sin(a); k.tube('metal', [[tubeX + c * 0.15, ty0 - 0.24, 0.38 + sn * 0.15], [tubeX + c * 0.155, ty0 - 0.12, 0.38 + sn * 0.155], [tubeX + c * 0.075, ty0, 0.38 + sn * 0.075]], 0.005, { ...FIN.chrome, radial: 5 }); }
    k.tor('metal', 0.075, 0.006, tubeX, ty0, 0.38, { ...FIN.chrome, axis: 'y', ts: 18, rs: 5 });
    // exit lamp on a bracket above the board: bezel + guard (the lamp is the game's sphere at z 0.36)
    k.box('paint', 0.26, 0.26, 0.05, gx, 4.2, 0.27, { ...pG, r: 0.01 });
    k.lathe('metal', [[0, 0], [0.1, 0, 1], [0.1, 0.02, 2], [0.085, 0.03], [0.0, 0.03]], gx, 4.22, 0.295, { ...FIN.black, axis: 'z', seg: 20 });
    for (let i = 0; i < 3; i++) k.tor('metal', 0.09, 0.004, gx, 4.22, 0.36, { ...FIN.black, ts: 20, rs: 4, rot: [0, (i / 3) * PI, 0] });
    k.decal(k.reg('st_exit', 128, 40, stencil([['EXIT', 0.55, 0.8]], '#2a8a3a')), 0.16, 0.05, gx, 4.035, 0.3305);
    // counter bezel (the counter screen is the game's, at z 0.336)
    k.ext('metal', frameShape(0.62, 0.27, 0.012, 0.565, 0.215, 0.006), 0.012, gx, 0.42, 0.33, { ...FIN.black, bev: 0.003, bevSeg: 1 });
  }

  // --- control pedestal: cabinet with door, louvres, sloped CRT housing, e-stop collar
  {
    const kx = -(CX + 1.0), kz = 1.15;
    k.box('dark', 0.62, 0.06, 0.46, kx, 0.03, kz, { tint: 0x1a1a1b, r: 0.006 });
    k.box('paint', 0.64, 0.94, 0.48, kx, 0.53, kz, { ...pG, r: 0.016, seg: 2, div: 0.2 });
    k.box('paint', 0.7, 0.05, 0.56, kx, 1.025, kz, { ...pY, r: 0.012, seg: 2 });
    P.onFace(k, kx, 0.52, kz + 0.24, 'z', () => {
      k.box('paint', 0.52, 0.76, 0.014, 0, 0, 0.007, { ...pG, r: 0.006, chip: 0.45 });
      for (const y of [0.22, -0.22]) { P.hingeHalf(k, -0.27, y, 0.012, 0.14, { part: 0 }); P.hingeHalf(k, -0.27, y, 0.012, 0.14, { part: 1 }); }
      P.pullHandle(k, 0.21, 0.02, 0.014, 0.12, { rot: [0, 0, HP], fin: FIN.black });
      P.louvre(k, 0, -0.26, 0.014, 0.36, 0.14, 6, { mo: pG });
      k.decal(k.reg('st_ctl', 256, 64, stencil([['PRESS CONTROL', 0.5, 0.62]], '#e2d9c0')), 0.3, 0.075, 0, 0.24, 0.0145);
      P.handprint(k, 0.16, 0.1, 0.0146, 0.12);
    });
    P.onFace(k, kx - 0.32, 0.6, kz, '-x', () => P.louvre(k, 0, 0, 0, 0.3, 0.2, 7, { mo: pG }));
    P.cable(k, [[kx + 0.15, 0.3, kz - 0.24], [kx + 0.2, 0.03, kz - 0.33], [-1.95, 0.025, kz - 0.42], [-1.885, 0.1, kz - 0.45]], 0.014);
    // CRT housing in the head frame (the screen plane is the game's, at (0, 0.24, 0.044))
    k.push(kx, 1.05, kz - 0.05, [-0.5, 0, 0]);
    k.ext('plastic', frameShape(0.62, 0.46, 0.03, 0.51, 0.35, 0.02, 0, 0.01), 0.04, 0, 0.23, 0.012, { tint: BEIGE, rough: 0.8, bev: 0.008, bevSeg: 2, curveSeg: 4 });
    k.ext('#151515:p', frameShape(0.51, 0.35, 0.02, 0.5, 0.34, 0.012), 0.016, 0, 0.24, 0.03, { curveSeg: 3 });
    const body = boxGeo(0.6, 0.44, 0.3, { r: 0.03, seg: 2 });
    body.deform((p) => { const t = Math.min(1, Math.max(0, 0.5 - p.z / 0.3)); p.x *= 1 - 0.3 * t; p.y *= 1 - 0.28 * t; }, false);
    body.computeNormals(true);
    k.put('plastic', body, 0, 0.23, -0.14, { tint: BEIGE, rough: 0.85 });
    k.push(0, 0.443, -0.04, [-HP, 0, 0]); P.slotVent(k, 0, 0, 0, 0.3, 0.06, 7, { vertical: true, mo: { tint: BEIGE }, slot: 'plastic' }); k.pop();
    k.label(makerPlate(k, 'mp_crt', 'CX-9 CONTROL', 'OPERATOR TERMINAL'), 0.12, 0.045, 0.2, 0.03, 0.0525);
    P.pilotLamp(k, -0.24, 0.03, 0.052, 0.008, 'green', { name: 'crt_led' });
    k.pop();
    // e-stop collar with a printed ring (the red cap is the game's button)
    const ex = kx + 0.18, ey = 1.05, ez = kz + 0.17;
    k.lathe('paint', [[0.0, ey], [0.11, ey, 1], [0.11, ey + 0.03, 2], [0.1, ey + 0.048], [0.0, ey + 0.048]], ex, 0, ez, { ...pY, seg: 28 });
    k.dlabel(k.reg('estop', 128, 128, (c, w, h) => {
      c.fillStyle = '#e8b21c'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, TAU); c.fill();
      c.save(); c.translate(w / 2, h / 2);
      c.font = font('sign', h * 0.13); c.fillStyle = '#141414'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const s = 'CRUSH · CRUSH · ';
      for (let i = 0; i < s.length; i++) { c.save(); c.rotate((i / s.length) * TAU); c.fillText(s[i], 0, -h * 0.4); c.restore(); }
      c.restore();
    }), 0.098, ex, ey + 0.0485, ez, { rot: [-HP, 0, 0], seg: 28 });
  }
  return k.done({ material: 'metal' });
}

export function b_crusher_ram() {
  const k = new DKit('crusher_ram', { wear: { chip: 0.4, rust: 0.55, grime: 0.7, dust: 0.3 }, ao: { res: 48 } });
  k.atlas(256, 256);
  const W = CX * 2 - 0.08, D = CZ1 - CZ0 - 0.08;
  // platen body + yellow top girder
  k.box('paint', W, 0.36, D, 0, 0.26, 0, { tint: GREY, r: 0.02, seg: 2, div: 0.3, chip: 0.5 });
  k.box('paint', W + 0.02, 0.06, D + 0.02, 0, 0.47, 0, { tint: YEL, r: 0.012 });
  for (const x of [-1.0, -0.2, 0.2, 1.0]) k.box('paint', 0.03, 0.12, D - 0.1, x, 0.56, 0, { tint: YEL, r: 0.006 });
  // hardened crushing face: plate + serrated teeth
  k.box('metal', W + 0.01, 0.03, D + 0.01, 0, 0.065, 0, { ...IRON, r: 0.006, rust: 0.8 });
  const tooth = polyShape([[-0.07, 0], [0.07, 0], [0.012, -0.045], [-0.012, -0.045]]);
  for (let i = 0; i < 12; i++) k.ext('metal', tooth, D - 0.04, -W / 2 + 0.09 + i * ((W - 0.18) / 11), 0.05, 0, { ...IRON, rust: 0.9, bev: 0.004, bevSeg: 1, center: true });
  // hazard faces + side guide shoes
  P.hazardRect(k, W - 0.08, 0.22, 0, 0.26, D / 2, { sw: 0.07, chip: 0.6 });
  P.onFace(k, 0, 0, -D / 2, '-z', () => P.hazardRect(k, W - 0.08, 0.22, 0, 0.26, 0, { sw: 0.07, chip: 0.6 }));
  for (const s of [-1, 1]) for (const z of [-0.5, 0.5]) {
    k.box('metal', 0.02, 0.26, 0.3, s * (W / 2 + 0.01), 0.26, z, { ...FIN.bronze, r: 0.004, rough: 1.3 });
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) P.screw(k, s * (W / 2 + 0.02), 0.26 + sy * 0.09, z + sz * 0.11, { kind: 'flat', r: 0.008, dir: s > 0 ? 'x' : '-x' });
  }
  // clevis flanges + chrome rods + wipers
  for (const s of [-1, 1]) {
    const x = s * 0.55, z = -0.05;
    k.lathe('metal', [[0, 0.5], [0.2, 0.5, 1], [0.2, 0.56, 2], [0.15, 0.58], [0.13, 0.62], [0.11, 0.62]], x, 0, z, { ...STEEL, seg: 28 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; P.screw(k, x + Math.cos(a) * 0.17, 0.56, z + Math.sin(a) * 0.17, { kind: 'hex', r: 0.014, dir: 'y', rust: 0.8 }); }
    k.cyl('metal', 0.11, 1.68, x, 0.62 + 0.84, z, { ...FIN.chrome, seg: 28, rust: 0, chip: 0 });
  }
  P.streak(k, -0.6, 0.42, D / 2 + 0.003, 0.2, 0.3, { col: '96,42,14' });
  P.streak(k, 0.7, 0.42, D / 2 + 0.003, 0.16, 0.25, { col: '96,42,14' });
  return k.done({ material: 'metal' });
}

export function b_crusher_gate() {
  const k = new DKit('crusher_gate', { wear: { chip: 0.45, rust: 0.4, grime: 0.5, dust: 0.2 }, ao: { off: true } });
  k.atlas(128, 128);
  const L = CTOP - BED, W = CX * 2 - 0.1;
  for (let i = 0; i < 13; i++) {
    const x = -CX + 0.08 + i * ((CX * 2 - 0.16) / 12);
    k.cyl('metal', 0.018, L - 0.06, x, -(L - 0.06) / 2, 0, { ...STEEL, seg: 10, bev: 0.004, rust: 0.5 });
    k.lathe('metal', [[0, -L], [0.01, -L + 0.004], [0.02, -L + 0.03], [0.02, -L + 0.06]], x, 0, 0, { ...STEEL, seg: 10 });
  }
  k.box('paint', W + 0.06, 0.07, 0.06, 0, -0.035, 0, { tint: GREY, r: 0.008 });
  for (const y of [0.35, 0.95, 1.55]) {
    for (const z of [-0.026, 0.026]) k.box('paint', W, 0.05, 0.012, 0, -y, z, { tint: RED, r: 0.003, chip: 0.55 });
    for (let i = 0; i < 13; i += 2) P.rivet(k, -CX + 0.08 + i * ((CX * 2 - 0.16) / 12), -y, 0.032, { r: 0.007 });
  }
  return k.done({ material: 'metal' });
}

// ---------------------------------------------------------------------------------------------- kiosks
function cabinet(k, w, h, d, y0, o = {}) {
  const pO = { tint: o.tint ?? OLIVE, rough: 0.95 };
  // kick plinth on levelling feet
  k.box('dark', w - 0.04, 0.08, d - 0.04, 0, 0.05, 0, { tint: 0x1a1a1b, r: 0.006 });
  k.box('paint', w + 0.04, 0.03, d + 0.04, 0, 0.095, 0, { tint: GREY, r: 0.008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.lathe('metal', [[0, 0], [0.025, 0, 1], [0.025, 0.008, 2], [0.012, 0.012], [0.012, 0.03]], sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), { ...IRON, seg: 12 });
  // shell with folded edges
  k.box('paint', w, h, d, 0, y0 + h / 2, 0, { ...pO, r: 0.014, seg: 2, div: 0.25 });
  // service door (hinged left), lock, louvre, stencil
  P.onFace(k, 0, y0 + h / 2, d / 2, 'z', () => {
    const dw = w - 0.14, dh = h - 0.12 - (o.doorTrim ?? 0);
    const dy = -(o.doorTrim ?? 0) / 2;
    k.box('dark', dw + 0.008, dh + 0.008, 0.002, 0, dy, 0.001, { tint: 0x0d0d0d, r: 0 });
    k.box('paint', dw, dh, 0.014, 0, dy, 0.008, { ...pO, r: 0.004, chip: 0.4 });
    for (const sy of [-1, 1]) { P.hingeHalf(k, -dw / 2 - 0.004, dy + sy * dh * 0.32, 0.012, 0.09, { part: 0 }); P.hingeHalf(k, -dw / 2 - 0.004, dy + sy * dh * 0.32, 0.012, 0.09, { part: 1 }); }
    k.lathe('metal', [[0, 0], [0.016, 0, 1], [0.016, 0.006, 2], [0.012, 0.009], [0, 0.009]], dw / 2 - 0.06, dy + dh * 0.15, 0.015, { ...FIN.chrome, axis: 'z', seg: 16 });
    k.box('#111111:p', 0.003, 0.012, 0.001, dw / 2 - 0.06, dy + dh * 0.15, 0.0245, { r: 0 });
    P.louvre(k, 0, dy - dh / 2 + 0.07, 0.015, dw * 0.6, 0.08, 4, { mo: { ...pO, dust: 0.2 } });
    if (o.stencil) k.decal(o.stencil, dw * 0.55, dw * 0.55 * 0.25, -dw * 0.08, dy + dh * 0.22, 0.0152);
    P.scuffs(k, 0, dy - dh * 0.3, 0.0153, dw * 0.8, dh * 0.4, { col: '40,36,28', alpha: 0.22 });
  });
  for (const s of [-1, 1]) P.onFace(k, s * w / 2, y0 + h * 0.55, 0, s > 0 ? 'x' : '-x', () => { P.louvre(k, 0, 0, 0, d * 0.5, h * 0.35, 7, { mo: pO }); P.streak(k, d * 0.2, h * 0.4, 0.002, 0.08, 0.4, { alpha: 0.35 }); });
  // front corner guards (angle steel) + top trim band
  for (const s of [-1, 1]) {
    k.box('metal', 0.006, h - 0.02, 0.04, s * (w / 2 + 0.003), y0 + h / 2, d / 2 - 0.02, { ...STEEL, r: 0.002 });
    k.box('metal', 0.04, h - 0.02, 0.006, s * (w / 2 - 0.02), y0 + h / 2, d / 2 + 0.003, { ...STEEL, r: 0.002 });
    for (let y = y0 + 0.08; y < y0 + h - 0.04; y += 0.2) P.rivet(k, s * (w / 2 - 0.02), y, d / 2 + 0.006, { r: 0.004 });
  }
  k.box('metal', w + 0.06, 0.035, d + 0.06, 0, y0 + h + 0.0175, 0, { ...FIN.satin, r: 0.008, seg: 2 });
}
function signFrame(k, w, h, d, x, y, z) {
  // marquee housing: the game's sign plane sits at z + d/2 + 0.002, recessed in a bezel
  k.box('paint', w, h, d, x, y, z, { tint: GREY, r: 0.016, seg: 2 });
  k.ext('paint', frameShape(w, h, 0.016, w - 0.05, h - 0.03, 0.006), 0.012, x, y, z + d / 2, { tint: GREY, bev: 0.003, bevSeg: 1, curveSeg: 2 });
  k.box('paint', w + 0.02, 0.012, 0.07, x, y + h / 2 + 0.02, z + d / 2 + 0.02, { tint: GREY, r: 0.003, rot: [0.35, 0, 0] });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) P.screw(k, x + sx * (w / 2 - 0.012), y + sy * (h / 2 - 0.008), z + d / 2 + 0.012, { kind: 'button', r: 0.004 });
  k.push(x, y + h / 2, z, [-HP, 0, 0]); P.slotVent(k, 0, 0, 0, w * 0.6, d * 0.6, 8, { vertical: true, mo: { tint: GREY } }); k.pop();
}

export function b_kiosk_shop() {
  const k = new DKit('kiosk_shop', { wear: { chip: 0.28, rust: 0.25, grime: 0.55, dust: 0.4 }, ao: { res: 56 } });
  k.atlas(512, 512);
  const st = k.reg('st_shop', 512, 128, stencil([['R.O.O.M. COMPANY STORE', 0.36, 0.34], ['UNIT 07 · AUTHORISED STAFF ONLY', 0.78, 0.2]], '#d8d0b0'));
  cabinet(k, 1.4, 0.7975, 0.62, 0.1, { stencil: st, doorTrim: 0.24 });
  // credits counter bezel (flaps are the game's, at z 0.335)
  k.box('dark', 0.62, 0.12, 0.012, 0, 0.72, 0.318, { tint: 0x0b0b0b, r: 0.002 });
  k.ext('metal', frameShape(0.72, 0.17, 0.012, 0.6, 0.118, 0.006), 0.014, 0, 0.72, 0.318, { ...FIN.black, bev: 0.003, bevSeg: 1, curveSeg: 2 });
  P.cornerScrews(k, 0.72, 0.17, 0, 0.72, 0.333, 0.012, { kind: 'button', r: 0.004 });
  // deck: perforated strip + emitter housings (the emissive rings / discs are the game's)
  k.push(0, 0.9325, -0.255, [-HP, 0, 0]); P.slotVent(k, 0, 0, 0, 1.3, 0.05, 34, { vertical: true, mo: { tint: GREY } }); k.pop();
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.47;
    k.lathe('metal', [[0, 0.932], [0.12, 0.932, 1], [0.125, 0.94, 2], [0.115, 0.95], [0.11, 0.97, 2], [0.095, 0.972], [0.095, 0.968], [0, 0.968]], x, 0, -0.1, { ...FIN.black, seg: 28 });
    k.tor('metal', 0.1, 0.004, x, 0.97, -0.1, { ...FIN.chrome, axis: 'y', ts: 28, rs: 4 });
    for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU; P.screw(k, x + Math.cos(a) * 0.112, 0.951, -0.1 + Math.sin(a) * 0.112, { kind: 'hex', r: 0.004, dir: 'y' }); }
  }
  // backdrop frame + side posts + gussets
  k.box('paint', 1.46, 1.3, 0.05, 0, 1.58, -0.335, { tint: GREY, r: 0.012, seg: 2 });
  k.ext('paint', frameShape(1.5, 1.34, 0.02, 1.36, 1.2, 0.01), 0.028, 0, 1.58, -0.318, { tint: GREY, bev: 0.005, bevSeg: 1, curveSeg: 3 });
  for (let i = 0; i < 6; i++) for (const sy of [-1, 1]) P.screw(k, -0.65 + i * 0.26, 1.58 + sy * 0.64, -0.289, { kind: 'button', r: 0.005 });
  for (const s of [-1, 1]) {
    k.box('paint', 0.05, 1.6, 0.06, s * 0.775, 1.7, -0.33, { tint: GREY, r: 0.008 });
    k.ext('paint', polyShape([[0, 0], [0.1, 0], [0, 0.14]]), 0.012, s * 0.75, 0.9325, -0.33, { tint: GREY, bev: 0.002, rot: s > 0 ? [0, PI, 0] : null });
  }
  signFrame(k, 1.5, 0.3, 0.12, 0, 2.36, -0.3);
  // sloped console in the game's `con` frame
  k.push(0, 0.95, 0.19, [0.5, 0, 0]);
  k.box('paint', 1.42, 0.05, 0.32, 0, -0.005, 0, { tint: GREY, r: 0.012, seg: 2 });
  k.box('dark', 1.3, 0.008, 0.26, 0, 0.024, 0, { tint: 0x161617, r: 0.002 });
  for (let i = 0; i < 24; i++) k.box('dark', 0.004, 0.003, 0.24, -0.62 + i * 0.054, 0.0285, 0, { tint: 0x101011, r: 0 });
  // CRT bezel (the screen plane is the game's, at y 0.052)
  k.ext('dark', frameShape(0.4, 0.29, 0.016, 0.342, 0.227, 0.008), 0.03, 0, 0.026, 0, { tint: 0x141415, bev: 0.005, bevSeg: 2, curveSeg: 3, rot: [-HP, 0, 0] });
  k.box('#050505', 0.34, 0.002, 0.225, 0, 0.045, 0, { r: 0 });
  // drum window + pillow blocks, key bezels, BUY ring
  k.ext('metal', frameShape(0.27, 0.12, 0.01, 0.23, 0.09, 0.006), 0.012, -0.5, 0.028, 0, { ...FIN.black, bev: 0.002, rot: [-HP, 0, 0] });
  for (const s of [-1, 1]) {
    k.box('metal', 0.03, 0.08, 0.1, -0.5 + s * 0.118, 0.06, 0, { ...FIN.alu, r: 0.008 });
    k.cyl('metal', 0.022, 0.036, -0.5 + s * 0.118, 0.075, 0, { ...FIN.chrome, axis: 'x', seg: 16, bev: 0.003 });
  }
  for (const x of [-0.27, 0.27]) {
    k.ext('metal', frameShape(0.11, 0.11, 0.012, 0.086, 0.086, 0.008), 0.014, x, 0.028, 0, { ...FIN.satin, bev: 0.003, rot: [-HP, 0, 0] });
    for (const sx of [-1, 1]) P.screw(k, x + sx * 0.046, 0.042, 0.046, { kind: 'phillips', r: 0.003, dir: 'y' });
  }
  k.lathe('metal', [[0.0, 0.028], [0.09, 0.028, 1], [0.092, 0.036, 2], [0.084, 0.046], [0.072, 0.05], [0, 0.05]], 0.52, 0, 0, { ...FIN.chrome, seg: 28 });
  k.lathe('paint', [[0.072, 0.05], [0.082, 0.052], [0.08, 0.062, 2], [0.066, 0.064], [0.06, 0.064]], 0.52, 0, 0, { tint: YEL, seg: 28 });
  k.pop();
  return k.done({ material: 'metal' });
}

export function b_kiosk_quest() {
  const k = new DKit('kiosk_quest', { wear: { chip: 0.3, rust: 0.22, grime: 0.55, dust: 0.45 }, ao: { res: 56 } });
  k.atlas(512, 512);
  const st = k.reg('st_quest', 512, 128, stencil([['FIELD OPS', 0.36, 0.4], ['QUEST NETWORK TERMINAL · 1979', 0.8, 0.2]], '#d8d0b0'));
  cabinet(k, 1.0, 0.82, 0.6, 0.1, { stencil: st });
  // desk slab with an aluminium nosing (tilted like the game's desk)
  k.push(0, 0.98, 0.2, [0.12, 0, 0]);
  k.box('paint', 1.06, 0.045, 0.34, 0, 0, 0, { tint: GREY, r: 0.01, seg: 2 });
  k.box('metal', 1.08, 0.05, 0.014, 0, -0.002, 0.172, { ...FIN.alu, r: 0.005 });
  k.pop();
  // keyboard: wedge case + 4 rows of sculpted caps
  k.push(0, 1.015, 0.24, [0.12, 0, 0]);
  k.box('plastic', 0.62, 0.028, 0.17, 0, -0.002, 0, { tint: BEIGE, r: 0.008, seg: 2, rough: 0.85 });
  k.box('dark', 0.59, 0.004, 0.15, 0, 0.0125, 0, { tint: 0x202020, r: 0.001 });
  for (let r = 0; r < 4; r++) {
    const n = r === 3 ? 1 : 13 - (r === 0 ? 0 : 1), kw = r === 3 ? 0.3 : 0.036, z = -0.055 + r * 0.035;
    for (let i = 0; i < n; i++) {
      const x = r === 3 ? 0 : -((n - 1) * 0.041) / 2 + i * 0.041 + (r % 2) * 0.008;
      const g = boxGeo(kw, 0.012, 0.03, { r: 0.004, seg: 2 });
      g.deform((p) => { if (p.y > 0) { p.x *= 0.86; p.z *= 0.82; p.y -= 0.002 * (1 - (p.x * p.x) / ((kw / 2) * (kw / 2))); } }, false);
      g.computeNormals(true);
      k.put('plastic', g, x, 0.02, z, { tint: (r === 0 && (i === 0 || i === n - 1)) || r === 3 ? 0x8a8370 : 0xbdb397, rough: 0.7, chip: 0.5 });
    }
  }
  k.pop();
  // monitor head (frame = the game's head group: screen plane at (0, 0.34, 0.212), recessed)
  k.push(0.04, 1.04, -0.06, [-0.06, 0, 0]);
  const body = boxGeo(0.84, 0.66, 0.36, { r: 0.04, seg: 3 });
  k.put('plastic', body, 0, 0.33, 0.02, { tint: BEIGE, rough: 0.85 });
  const back = boxGeo(0.66, 0.52, 0.26, { r: 0.04, seg: 3 });
  back.deform((p) => { const t = Math.min(1, Math.max(0, 0.5 - p.z / 0.26)); p.x *= 1 - 0.25 * t; p.y *= 1 - 0.22 * t; }, false);
  back.computeNormals(true);
  k.put('plastic', back, 0, 0.31, -0.27, { tint: BEIGE, rough: 0.85 });
  k.ext('plastic', frameShape(0.8, 0.62, 0.035, 0.7, 0.5, 0.025, 0, 0.0), 0.025, 0, 0.34, 0.195, { tint: 0xb8ab88, bev: 0.008, bevSeg: 2, curveSeg: 4 });
  k.ext('#121212:p', frameShape(0.7, 0.5, 0.025, 0.665, 0.445, 0.015), 0.015, 0, 0.34, 0.2, { curveSeg: 3 });
  for (const s of [-1, 1]) P.onFace(k, s * 0.42, 0.36, -0.02, s > 0 ? 'x' : '-x', () => P.slotVent(k, 0, 0, 0, 0.22, 0.12, 6, { mo: { tint: BEIGE }, slot: 'plastic' }));
  k.push(0, 0.66, -0.08, [-HP, 0, 0]); P.slotVent(k, 0, 0, 0, 0.5, 0.2, 8, { vertical: true, mo: { tint: BEIGE }, slot: 'plastic' }); k.pop();
  k.label(makerPlate(k, 'mp_term', 'TERMLINK 2000', 'R.O.O.M. FIELD OPS'), 0.15, 0.055, -0.27, 0.06, 0.2205);
  for (const x of [0.18, 0.24]) P.knob(k, x, 0.06, 0.2205, 0.014, { static: true, skirt: false, tint: 0x2a2620 });
  P.cornerScrews(k, 0.8, 0.62, 0, 0.34, 0.2205, 0.02, { kind: 'phillips', r: 0.004 });
  k.pop();
  // marquee + posts
  signFrame(k, 1.06, 0.3, 0.1, 0, 1.95, -0.08);
  for (const s of [-1, 1]) {
    k.box('paint', 0.035, 0.32, 0.035, s * 0.45, 1.78, -0.12, { tint: GREY, r: 0.006 });
    k.box('paint', 0.08, 0.01, 0.08, s * 0.45, 1.703, -0.12, { tint: GREY, r: 0.003 });
    for (const sx of [-1, 1]) P.screw(k, s * 0.45 + sx * 0.028, 1.708, -0.12, { kind: 'hex', r: 0.004, dir: 'y' });
  }
  // projector base (emissive lens is the game's at y 1.03)
  k.lathe('metal', [[0, 0.995], [0.08, 0.995, 1], [0.08, 1.005, 2], [0.07, 1.015], [0.065, 1.025, 2], [0.05, 1.026], [0, 1.026]], -0.4, 0, 0.12, { ...FIN.black, seg: 24 });
  k.tor('metal', 0.058, 0.003, -0.4, 1.026, 0.12, { ...FIN.chrome, axis: 'y', ts: 24, rs: 4 });
  // receipt printer: sloped body, lid seam, slot + tear bar, feed button
  {
    const px = 0.38, py = 1.08, pz = 0.12;
    k.box('paint', 0.22, 0.1, 0.18, px, py, pz, { tint: GREY, r: 0.014, seg: 2, chip: 0.3 });
    k.box('#0a0a0a', 0.15, 0.004, 0.01, px, py + 0.049, pz + 0.085, { r: 0 });
    k.box('metal', 0.16, 0.006, 0.008, px, py + 0.047, pz + 0.094, { ...STEEL, r: 0.001 });
    k.box('#0a0a0a', 0.2, 0.002, 0.002, px, py + 0.0505, pz - 0.03, { r: 0 });
    P.pushButton(k, px + 0.07, py - 0.015, pz + 0.09, 0.008, { static: true, tint: 0x2a8a3a });
    k.label(makerPlate(k, 'mp_prn', 'RECEIPTS', 'TEAR HERE'), 0.08, 0.032, px - 0.04, py - 0.015, pz + 0.0905);
  }
  return k.done({ material: 'metal' });
}

// arrow push key cap (prev / next), origin = cap bottom centre
export function b_kiosk_key() {
  const k = new DKit('kiosk_key', { wear: { chip: 0.2, grime: 0.6, dust: 0.1 }, ao: { off: true } });
  const g = boxGeo(0.08, 0.03, 0.08, { r: 0.008, seg: 2 });
  g.deform((p) => { if (p.y > 0) { p.x *= 0.9; p.z *= 0.9; p.y -= 0.004 * (1 - (p.x * p.x + p.z * p.z) / 0.0025); } }, false);
  g.computeNormals(true);
  k.put('plastic', g, 0, 0.0, 0, { tint: 0x1c1c1d, rough: 0.6 });
  return k.done({ material: 'plastic' });
}
// crank knob for the category drum (rotates about local X): fluted grip + crank arm + spinner
export function b_kiosk_crank() {
  const k = new DKit('kiosk_crank', { wear: { chip: 0.2, grime: 0.5, dust: 0.1 }, ao: { off: true } });
  k.cyl('metal', 0.008, 0.02, 0.0, 0, 0, { ...FIN.chrome, axis: 'x', seg: 12 });
  k.put('dark', axisGeo(P.flutedGeo(0.03, 0.03, 16), '-x'), -0.01, 0, 0, { tint: 0x18181a, rough: 0.7 });
  k.box('metal', 0.006, 0.05, 0.014, -0.043, 0.022, 0, { ...FIN.chrome, r: 0.003 });
  k.lathe('dark', [[0, 0], [0.007, 0, 1], [0.008, 0.02], [0.006, 0.026], [0, 0.027]], -0.046, 0.04, 0, { tint: 0x9a1a14, axis: '-x', seg: 12 });
  return k.done({ material: 'plastic' });
}
