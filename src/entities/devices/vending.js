// Vending machines: 90s glass-front snack merchandiser and illuminated-panel soda machine.
// Origin on the floor under the centre, front +Z. Contract (src/game/devicekinds.js VendingMachine):
// parts.coils[i] (rotation.z spins), parts.products[i] (visible toggles), parts.buttonLights[i] (own
// glow material, emissiveIntensity flashes), parts.flap, parts.light / parts.panel, screens.main,
// anchors.slots[i] (drop points), anchors.tray.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, frameShape, rrShape, rrHole, Geo, tubeGeo, cylGeo, boxGeo, axisGeo, fromBuffer, crtGeo, lerp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, hazardTri, drawLogo, drawClone } from './atlas.js';
import { RNG } from '../../core/rng.js';
import { emissiveMat, classMat, atlasGlowMat } from './mats.js';
import { linkFlash } from './sync.js';

// ---------------------------------------------------------------------------
// product art
// ---------------------------------------------------------------------------
const SNACKS = [
  ['CRUNCHOS', '#f4c21b', '#c8231b', '#7a1410'], ['VOID CHIPS', '#2a1840', '#c9a2ff', '#f0e8ff'], ['NUTRI-BAR', '#2c63b5', '#ffffff', '#f2c418'],
  ['CHOCO LOOPS', '#5a2f1a', '#f6d7a8', '#e2392b'], ['SALTY BOYS', '#1f8a4a', '#fff7d6', '#0d4a24'], ['MOIST CAKES', '#f08fb0', '#ffffff', '#8a2048'],
  ['PORK RINDZ', '#e8661c', '#fff2c0', '#5a2008'], ['LEVEL 0 CRISPS', '#d9c36a', '#3a3420', '#8a7a2a'], ['MEAT STIX', '#8a1c14', '#ffd66b', '#2a0805'],
  ['MINT GUM', '#9fe0d0', '#0d5a4a', '#ffffff'], ['CHEEZ PUFS', '#ff9a1a', '#1a3a8a', '#ffffff'], ['PRETZL', '#3a2a8a', '#ffd21a', '#ffffff'],
  ['ALMOND JOYLESS', '#e9e2cf', '#6a3a1a', '#2f6a3a'], ['GLUE-E BEARS', '#e23a8a', '#fff04a', '#3a0a2a'],
];
function drawSnack(c, w, h, b, kind, seed) {
  const [name, bg, fg, ac] = b;
  const r = new RNG(seed);
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.18, 'rgba(255,255,255,0.2)'); g.addColorStop(0.32, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (kind === 'chips' || kind === 'pastry') {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < w; x += 6) { c.fillRect(x, 0, 3, h * 0.07); c.fillRect(x, h * 0.93, 3, h * 0.07); }
    for (let i = 0; i < 5; i++) {
      c.fillStyle = i % 2 ? '#f0c060' : '#e2a840';
      c.beginPath(); c.ellipse(w * (0.25 + r.next() * 0.5), h * (0.62 + r.next() * 0.18), w * 0.16, w * 0.1, r.next() * 3, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(120,60,0,0.5)'; c.lineWidth = 1.5; c.stroke();
    }
  } else if (kind === 'bar') {
    c.fillStyle = ac; c.fillRect(0, h * 0.72, w, h * 0.1);
    c.fillStyle = '#5a2f1a'; rrect(c, w * 0.2, h * 0.84, w * 0.6, h * 0.1, 4); c.fill();
  } else {
    c.fillStyle = ac;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(w * (0.28 + i * 0.22), h * 0.72, w * 0.1, 0, TAU); c.fill(); }
  }
  c.fillStyle = ac; c.beginPath(); c.arc(w * 0.8, h * 0.18, w * 0.13, 0, TAU); c.fill();
  txt(c, r.pick(['NEW!', '50%', 'XTRA', '!!!', 'HOT']), w * 0.8, h * 0.18, w * 0.09, { col: bg, f: 'sans' });
  const words = name.split(' ');
  c.save(); c.translate(w / 2, h * 0.36); c.rotate(-0.12);
  words.forEach((wd, i) => txt(c, wd, 0, (i - (words.length - 1) / 2) * w * 0.24, w * 0.24, { col: fg, stroke: ac, lw: w * 0.035, maxW: w * 0.92 }));
  c.restore();
  txt(c, 'NET WT 1.5 OZ', w / 2, h * 0.96, w * 0.065, { col: fg, f: 'bold', w: 'bold' });
  // specular crinkles of the foil
  c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
  for (let i = 0; i < 6; i++) { const x = r.next() * w; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + r.range(-8, 8), h); c.stroke(); }
}
// pillow bag (chips): front/back faces inflated, top & bottom seals crimped flat. UVs: front/back -> art, rest -> side
function pillowGeo(w, h, d, art, side) {
  const g = new Geo();
  const nx = 4, ny = 6;
  for (const s of [1, -1]) {
    const base = g.count;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      const x = (u - 0.5) * w, y = (v - 0.5) * h;
      const seal = Math.min(1, Math.min(v, 1 - v) / 0.1);
      const puff = (1 - (2 * u - 1) ** 2 * 0.65) * Math.sin(seal * HP);
      const z = s * (d / 2) * puff;
      const uu = s > 0 ? u : 1 - u;
      g.v(x * (1 - 0.06 * puff), y, z, 0, 0, s, art.u0 + uu * (art.u1 - art.u0), art.v0 + v * (art.v1 - art.v0), 0);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i;
      if (s > 0) g.quad(a, a + 1, a + nx + 2, a + nx + 1); else g.quad(a, a + nx + 1, a + nx + 2, a + 1);
    }
  }
  g.computeNormals(false);
  void side;
  return g;
}

// ---------------------------------------------------------------------------
// shared cabinet bits
// ---------------------------------------------------------------------------
function levelingFeet(k, W, D) {
  for (const [x, z] of [[-W / 2 + 0.06, -D / 2 + 0.06], [W / 2 - 0.06, -D / 2 + 0.06], [-W / 2 + 0.06, D / 2 - 0.08], [W / 2 - 0.06, D / 2 - 0.08]]) {
    k.cyl('#1a1a1b:r', 0.026, 0.012, x, 0.006, z, { seg: 12, bev: 0.003, bevSeg: 1 });
    k.cyl('metal', 0.006, 0.03, x, 0.027, z, { ...FIN.zinc, seg: 8 });
    k.cyl('metal', 0.013, 0.008, x, 0.036, z, { ...FIN.zinc, seg: 6, bev: 0.001, bevSeg: 1 });
  }
}
// money section on a fascia facing +Z at (cx, *, z): coin slot plate + return button, bill validator, coin cup
function moneySection(k, cx, ySlot, yBill, yCup, z, o = {}) {
  const CH = '#c4c7ca:c';
  k.box(CH, 0.07, 0.1, 0.012, cx - 0.05, ySlot, z + 0.006, { r: 0.006 });
  k.box('#050505', 0.006, 0.042, 0.003, cx - 0.05, ySlot + 0.008, z + 0.0125, { r: 0 });
  k.box(CH, 0.02, 0.012, 0.006, cx - 0.05, ySlot - 0.034, z + 0.014, { r: 0.003 });
  const cr = P.pushButton(k, cx + 0.06, ySlot, z, 0.018, { tint: 0xb9bcbf, ringSlot: CH, slot: '#c4c7ca:c', name: 'coinReturn', static: true });
  void cr;
  // bill validator
  k.box('#111214:s', 0.15, 0.08, 0.034, cx, yBill, z + 0.017, { r: 0.01 });
  k.box('#1d1e20:s', 0.13, 0.03, 0.02, cx, yBill - 0.014, z + 0.036, { r: 0.008 });
  k.box('#020202', 0.1, 0.004, 0.003, cx, yBill - 0.008, z + 0.046, { r: 0 });
  const bill = k.reg('bills', 160, 28, (c, w, h) => { c.fillStyle = '#062'; c.fillRect(0, 0, w, h); txt(c, '▼ BILLS FACE UP ▼', w / 2, h / 2, h * 0.62, { col: '#7dff9a', f: 'bold', maxW: w * 0.95 }); }, 'e');
  k.label(bill, 0.11, 0.019, cx, yBill + 0.022, z + 0.0345);
  // coin return cup (chrome recess)
  k.ext(CH, frameShape(0.1, 0.075, 0.012, 0.08, 0.055, 0.009), 0.012, cx, yCup, z, { bev: 0.003, bevSeg: 1, curveSeg: 3 });
  k.box('#0a0a0b:p', 0.082, 0.057, 0.028, cx, yCup, z - 0.012, { r: 0.006 });
  const cr2 = k.reg('coinret', 128, 20, (c, w, h) => txt(c, 'COIN RETURN', w / 2, h / 2, h * 0.75, { col: '#151515', f: 'bold' }));
  k.label(cr2, 0.1, 0.016, cx, yCup + 0.055, z + 0.0006);
  void o;
}
// delivery bin with hinged push flap (parts.flap: pivot on the hinge rod, flap hangs down)
function pickupBin(k, bx, w, hy, hz, ybot, zback, o = {}) {
  const IN = '#101113:p';
  k.box(IN, w, 0.012, hz - zback + 0.02, bx, ybot, (hz + zback) / 2, { r: 0 });
  k.box(IN, w, hy - ybot + 0.04, 0.012, bx, (hy + ybot) / 2, zback, { r: 0, rot: [0.35, 0, 0] });
  for (const s of [-1, 1]) k.box(IN, 0.012, hy - ybot + 0.03, hz - zback + 0.02, bx + s * (w / 2 - 0.006), (hy + ybot) / 2, (hz + zback) / 2, { r: 0 });
  k.cyl('#c4c7ca:c', 0.0055, w, bx, hy, hz, { axis: 'x', seg: 8 });
  const flap = k.grp(bx, hy, hz, { name: 'flap' });
  const push = k.reg('push', 128, 48, (c, w2, h2) => { c.fillStyle = '#1a1b1e'; c.fillRect(0, 0, w2, h2); txt(c, 'PUSH', w2 / 2, h2 * 0.55, h2 * 0.6, { col: '#d8d2c0' }); rubOff(c, w2, h2, 1, 4); });
  k.inside(flap, () => {
    k.box('#1d1e22:s', w - 0.008, o.fh ?? 0.205, 0.006, 0, -(o.fh ?? 0.205) / 2, 0, { r: 0.002 });
    k.box('#2a2b30:s', w - 0.008, 0.02, 0.012, 0, -(o.fh ?? 0.205) + 0.01, 0.004, { r: 0.004 });
    k.label(push, 0.1, 0.0375, 0, -0.07, 0.0036);
  });
  k.parts.flap = flap;
}

// ---------------------------------------------------------------------------
// SNACK MERCHANDISER
// ---------------------------------------------------------------------------
export function b_vending_snack(o) {
  const k = new DKit('vending_snack', { wear: { chip: 0.14, rust: 0.04, grime: 0.4, dust: 0.35 }, ao: { res: 56 } });
  const A = k.atlas(1024, 1024);
  const W = 1.0, H = 1.85, D = 0.85;
  const BODY = { tint: 0x26282d };
  const DOOR = { tint: 0x9a1d18 };
  const zf = 0.398, zF = 0.439;
  // ---- cabinet ----
  levelingFeet(k, W, D);
  k.box('#141416:p', W - 0.06, 0.06, D - 0.08, 0, 0.07, -0.01, { r: 0.003 });
  for (const sx of [-1, 1]) k.box('paint', 0.03, H - 0.1, D - 0.03, sx * (W / 2 - 0.015), 0.1 + (H - 0.1) / 2, -0.015, { ...BODY, r: 0.008, div: 0.35, dent: 0.0015 });
  k.box('paint', W, 0.035, D - 0.03, 0, H - 0.0175, -0.015, { ...BODY, r: 0.01 });
  k.box('paint', W - 0.06, H - 0.1, 0.02, 0, 0.1 + (H - 0.1) / 2, -D / 2 + 0.01, { ...BODY, r: 0.003 });
  k.box('paint', W - 0.06, 0.03, D - 0.06, 0, 0.115, -0.01, { ...BODY, r: 0.003 });
  // interior liner + light valance
  const LIN = { tint: 0x9a9ea2, chip: 0.05 };
  k.box('paint', 0.64, 1.2, 0.01, -0.14, 1.16, -0.385, { ...LIN, r: 0 });
  k.box('paint', 0.01, 1.2, 0.77, -0.463, 1.16, 0.0, { ...LIN, r: 0 });
  k.box('paint', 0.01, 1.2, 0.77, 0.178, 1.16, 0.0, { ...LIN, r: 0 });
  k.box('paint', 0.64, 0.01, 0.77, -0.14, 1.755, 0.0, { ...LIN, r: 0 });
  k.box('paint', 0.63, 0.045, 0.012, -0.14, 1.728, 0.385, { ...BODY, r: 0.002 });
  const light = k.mesh(emissiveMat(0xffffff, 0xf4fbff, 0.9, { name: 'snack_light' }), axisGeo(cylGeo(0.011, 0.6, { seg: 10 }), 'x'), -0.14, 1.745, 0.37, { name: 'light', shadow: false });
  k.box('#e8e8e4:s', 0.62, 0.02, 0.03, -0.14, 1.765, 0.37, { r: 0.003 });
  // ---- door: frame with window + delivery openings, gasket, aluminium glazing trim, glass ----
  const ds = rrShape(0.98, 1.75, 0.02, 0, 0.955);
  ds.holes.push(rrHole(0.62, 1.12, 0.012, -0.14, 1.16));
  ds.holes.push(rrHole(0.44, 0.22, 0.01, -0.16, 0.31));
  k.ext('paint', ds, 0.041, 0, 0, zf, { ...DOOR, bev: 0.006, bevSeg: 2, curveSeg: 4 });
  k.tube('#0d0d0e:r', [[-0.49, 0.08, zf + 0.002], [0.49, 0.08, zf + 0.002], [0.49, 1.83, zf + 0.002], [-0.49, 1.83, zf + 0.002]], 0.004, { round: 0.02, closed: true, radial: 5 });
  k.ext('metal', frameShape(0.665, 1.165, 0.02, 0.62, 1.12, 0.012), 0.009, -0.14, 1.16, zF - 0.003, { ...FIN.alu, bev: 0.0025, bevSeg: 1, curveSeg: 4 });
  k.ext('#0b0b0c:r', frameShape(0.626, 1.126, 0.013, 0.61, 1.11, 0.008), 0.006, -0.14, 1.16, zf + 0.014, { curveSeg: 3 });
  k.box('glass', 0.62, 1.12, 0.004, -0.14, 1.16, zf + 0.018, { r: 0 });
  // smudges on the glass (finger grease, light)
  P.handprint(k, 0.02, 0.98, zf + 0.0215, 0.14, { col: '255,255,255', alpha: 0.07 });
  P.scuffs(k, -0.25, 0.75, zf + 0.0215, 0.25, 0.22, { alpha: 0.12 });
  // lit marquee header
  const hdr = A.add(512, 56, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f2c040'); g.addColorStop(1, '#c47a10');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    txt(c, 'SNACKS  •  CANDY  •  CHIPS', w / 2, h * 0.54, h * 0.62, { col: '#5a0c08', maxW: w * 0.94 });
  }, 'E');
  k.box('#101012:s', 0.62, 0.075, 0.012, -0.14, 1.778, zF + 0.002, { r: 0.004 });
  k.label(hdr, 0.58, 0.056, -0.14, 1.778, zF + 0.0085);
  // ---- trays, coils, products ----
  const rows = 5, cols = 4;
  const colX = [-0.365, -0.215, -0.065, 0.085];
  const kinds = ['bar', 'chips', 'chips', 'cookie', 'pastry'];
  const dims = { bar: [0.075, 0.15, 0.024], chips: [0.13, 0.185, 0.05], cookie: [0.125, 0.12, 0.04], pastry: [0.125, 0.15, 0.045] };
  // coil: steel spiral + motor hub + drive dog (one geometry, a separate mesh per coil)
  const coilG = new Geo();
  {
    const pts = [];
    const n = 5 * 14;
    for (let i = 0; i <= n; i++) { const t = i / n, a = t * 5 * TAU; pts.push(V3(Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0.33 - 0.66 * t)); }
    coilG.append(tubeGeo(pts, 0.0028, { radial: 5, caps: false }));
    coilG.append(axisGeo(cylGeo(0.016, 0.02, { seg: 8 }), 'z').translate(0, 0, -0.34));
    coilG.append(boxGeo(0.004, 0.052, 0.004, { r: 0 }).translate(0, 0.026, -0.335));
  }
  k.anchors.slots = [];
  const brandIdx = new RNG(o.seed ?? 7).shuffle(SNACKS.map((_, i) => i));
  const swatch = {};
  const rowY = (r) => 1.72 - (r + 1) * 0.218 + 0.012;
  const coilPlaces = [], prodPlaces = [];
  for (let r = 0; r < rows; r++) {
    const yb = rowY(r);
    // tray: pressed zinc shelf with turned-down lip, spiral dividers, price strip
    k.box('metal', 0.62, 0.006, 0.74, -0.14, yb - 0.004, 0.0, { ...FIN.zinc, r: 0, rust: 0 });
    k.box('metal', 0.62, 0.02, 0.004, -0.14, yb - 0.014, -0.368, { ...FIN.zinc, r: 0 });
    for (let j = 0; j <= cols; j++) k.box('metal', 0.004, 0.03, 0.72, -0.44 + j * 0.15, yb + 0.012, -0.005, { ...FIN.zinc, r: 0 });
    k.box('#141416:s', 0.62, 0.032, 0.01, -0.14, yb - 0.006, 0.374, { r: 0.002 });
    const strip = A.add(512, 26, (c, w, h) => {
      c.fillStyle = '#f4f0e2'; c.fillRect(0, 0, w, h);
      for (let j = 0; j < cols; j++) {
        const cx = (j + 0.5) * (w / cols);
        txt(c, `${'ABCDE'[r]}${j + 1}`, cx - w * 0.07, h / 2, h * 0.75, { col: '#c8231b', f: 'sans' });
        txt(c, ['75¢', '$1.00', '85¢', '60¢', '$1.25'][(r + j) % 5], cx + w * 0.045, h / 2, h * 0.7, { col: '#111', f: 'mono' });
        c.fillStyle = '#999'; c.fillRect((j + 1) * (w / cols) - 1, 0, 2, h);
      }
      grime(c, w, h, 0.4, 30 + r);
    });
    k.label(strip, 0.6, 0.024, -0.14, yb - 0.006, 0.3796);
    for (let j = 0; j < cols; j++) {
      // motor pod at the back of each spiral
      k.box('#18191b:p', 0.05, 0.06, 0.03, colX[j], yb + 0.056, -0.365, { r: 0.004 });
      k.anchors.slots.push(V3(colX[j], yb + 0.1, 0.34));
      coilPlaces.push([colX[j], yb + 0.056, 0]);
      prodPlaces.push([colX[j], yb, 0]);
    }
  }
  // coils: one instanced draw, parts.coils[i] are pivots on the spiral axis (rotation.z spins)
  k.parts.coils = k.instanced('coil', classMat('metal'), coilG, coilPlaces, { tint: 0xb9bdc1, rough: 0.62, grime: 0.3, rust: 0 });
  // products: 5 packages per spiral, all slots in one merged mesh; parts.products[i].visible hides a slot
  k.parts.products = k.masked('products', prodPlaces, (i) => {
    const r = Math.floor(i / cols);
    const b = SNACKS[brandIdx[i % brandIdx.length]];
    const kind = kinds[r];
    const [pw, ph, pd] = dims[kind];
    const art = A.add(kind === 'bar' ? 64 : 104, kind === 'bar' ? 128 : Math.round(104 * ph / pw), (c, w, h) => drawSnack(c, w, h, b, kind, i + 3));
    const side = swatch[b[1]] || (swatch[b[1]] = A.add(8, 8, (c, w, h) => { c.fillStyle = b[1]; c.fillRect(0, 0, w, h); }));
    for (let s = 0; s < 5; s++) {
      const z = 0.33 - (s + 0.5) * 0.132;
      const rot = [kind === 'bar' ? -0.06 : 0, 0, (s % 2 ? 0.02 : -0.015)];
      if (kind === 'chips') k.put('atlas', pillowGeo(pw, ph, pd, art, side), 0, ph / 2 + 0.001, z, { rot });
      else k.labelBox({ pz: art, nz: art, side }, pw, ph, pd, 0, ph / 2 + 0.001, z, { rot });
    }
  });
  // ---- control column (brushed fascia) ----
  const cx = 0.33;
  k.box('metal', 0.27, 1.12, 0.004, cx, 1.16, zF + 0.002, { ...FIN.alu, r: 0.002, rust: 0 });
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.screw(k, cx + sx * 0.122, 1.16 + sy * 0.545, zF + 0.004, { r: 0.0035, kind: 'torx' });
  const brand = A.add(256, 150, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b0806'); g.addColorStop(1, '#6a120d');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    drawClone(c, w * 0.2, h * 0.55, h * 0.7, { wave: true });
    txt(c, 'R.O.O.M.', w * 0.66, h * 0.32, h * 0.22, { col: '#ffd34a', maxW: w * 0.6 });
    txt(c, 'SNAX', w * 0.66, h * 0.62, h * 0.36, { col: '#ffffff', stroke: '#c8231b', maxW: w * 0.6 });
    txt(c, 'FUEL FOR THE DISPOSABLE', w * 0.66, h * 0.86, h * 0.08, { col: '#ffd34a', f: 'bold', maxW: w * 0.6 });
  }, 'E');
  k.ext('#c4c7ca:c', frameShape(0.272, 0.166, 0.01, 0.25, 0.145, 0.006), 0.009, cx, 1.62, zF + 0.003, { bev: 0.002, bevSeg: 1, curveSeg: 3 });
  k.label(brand, 0.25, 0.146, cx, 1.62, zF + 0.0065);
  k.box('glass', 0.25, 0.146, 0.002, cx, 1.62, zF + 0.0095, { r: 0 });
  // LED display module
  k.box('#0e0f10:s', 0.22, 0.085, 0.016, cx, 1.465, zF + 0.009, { r: 0.007 });
  k.box('#2a0806:g', 0.196, 0.06, 0.002, cx, 1.465, zF + 0.0175, { r: 0 });
  k.screen('main', 0.19, 0.055, cx, 1.465, zF + 0.0186, { style: 'led', text: 'MAKE SELECTION', bulge: 0 });
  // keypad: sculpted keys with printed legends
  k.box('#141416:p', 0.235, 0.22, 0.008, cx, 1.29, zF + 0.006, { r: 0.006 });
  const keys = ['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4', '*', '0', 'CLR'];
  keys.forEach((s, i) => {
    const kx = cx + ((i % 3) - 1) * 0.068, ky = 1.36 - Math.floor(i / 3) * 0.046;
    k.box('#c6c0ab:s', 0.056, 0.036, 0.014, kx, ky, zF + 0.016, { r: 0.006, seg: 1 });
    const reg = k.reg('key_' + s, 48, 30, (c, w, h) => { c.fillStyle = '#c6c0ab'; c.fillRect(0, 0, w, h); txt(c, s, w / 2, h / 2 + 1, h * (s.length > 1 ? 0.5 : 0.75), { col: i < 5 ? '#c8231b' : '#151515' }); rubOff(c, w, h, 0.6, i); }, 's');
    k.label(reg, 0.044, 0.026, kx, ky, zF + 0.0232);
  });
  const coinTxt = k.reg('cointxt', 160, 24, (c, w, h) => txt(c, '25¢  50¢  $1 COIN', w / 2, h / 2, h * 0.7, { col: '#151515', f: 'bold', maxW: w * 0.95 }));
  k.label(coinTxt, 0.2, 0.03, cx, 1.165, zF + 0.0045);
  moneySection(k, cx, 1.09, 0.95, 0.8, zF + 0.004);
  const inst = k.reg('instr', 200, 190, (c, w, h) => {
    c.fillStyle = '#d9d2bc'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c8231b'; c.fillRect(0, 0, w, h * 0.17);
    txt(c, 'HOW TO SNACK', w / 2, h * 0.09, h * 0.11, { col: '#fff' });
    ['1. INSERT EXACT CHANGE', '2. ENTER LETTER + NUMBER', '3. RETRIEVE PRODUCT BELOW', '4. RETURN TO WORK'].forEach((s, i) => txt(c, s, w * 0.06, h * (0.29 + i * 0.12), h * 0.075, { col: '#151515', f: 'mono', al: 'left', maxW: w * 0.9 }));
    txt(c, 'R.O.O.M. is not liable for products', w / 2, h * 0.82, h * 0.055, { col: '#555', f: 'mono', maxW: w * 0.92 });
    txt(c, 'lost to other dimensions.', w / 2, h * 0.9, h * 0.055, { col: '#555', f: 'mono', maxW: w * 0.92 });
    grime(c, w, h, 0.5, 11);
  });
  k.box('#1a1b1d:s', 0.235, 0.224, 0.006, cx, 0.56, zF + 0.004, { r: 0.004 });
  k.label(inst, 0.22, 0.209, cx, 0.56, zF + 0.0072);
  k.box('glass', 0.22, 0.209, 0.002, cx, 0.56, zF + 0.0085, { r: 0 });
  // ---- delivery bin + flap ----
  pickupBin(k, -0.16, 0.44, 0.418, 0.415, 0.2, 0.2);
  // kick plate grille
  P.louvre(k, -0.16, 0.13, zF - 0.006, 0.6, 0.05, 4, { mo: BODY, raised: false, depth: 0.012 });
  P.scuffs(k, 0, 0.13, zF + 0.0005, 0.9, 0.08, { col: '20,18,16', alpha: 0.35 });
  // ---- side graphics + back ----
  const sideArt = A.add(160, 420, (c, w, h) => {
    c.fillStyle = '#8a1d19'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2b318'; c.fillRect(w * 0.1, 0, w * 0.06, h); c.fillRect(w * 0.84, 0, w * 0.06, h);
    c.save(); c.translate(w / 2, h * 0.42); c.rotate(-HP);
    txt(c, 'R.O.O.M. SNAX', 0, 0, w * 0.34, { col: '#fff', stroke: '#2a0805', maxW: h * 0.75 });
    c.restore();
    drawClone(c, w / 2, h * 0.86, w * 0.55);
    grime(c, w, h, 0.7, 4); rubOff(c, w, h, 1.2, 7);
  });
  k.label(sideArt, 0.32, 0.84, W / 2 + 0.0008, 1.1, -0.05, { rot: [0, HP, 0] });
  k.label(sideArt, 0.32, 0.84, -W / 2 - 0.0008, 1.1, -0.05, { rot: [0, -HP, 0] });
  k.push(0.2, 0.42, -D / 2, [0, PI, 0]);
  P.slotVent(k, 0, 0, 0, 0.3, 0.2, 8, { mo: BODY });
  k.pop();
  const serial = k.reg('snack_serial', 200, 70, (c, w, h) => { c.fillStyle = '#c9c9c4'; c.fillRect(0, 0, w, h); txt(c, 'SNAK-MATIC 3000', w / 2, h * 0.28, h * 0.22, { col: '#111' }); txt(c, '115V 60Hz 4.2A  S/N 0042-SNX', w / 2, h * 0.58, h * 0.13, { col: '#222', f: 'mono', maxW: w * 0.92 }); txt(c, 'R.O.O.M. FACILITIES DIV.', w / 2, h * 0.82, h * 0.12, { col: '#222', f: 'mono' }); }, 'b');
  k.push(-0.2, 1.4, -D / 2, [0, PI, 0]);
  P.plate(k, serial, 0.16, 0.056, 0, 0, 0, { fin: FIN.alu, rr: 0.0018 });
  k.pop();
  P.cable(k, [[0.3, 0.3, -0.43], [0.32, 0.12, -0.46], [0.36, 0.012, -0.55], [0.6, 0.012, -0.75]], 0.006, { tint: 0x161616 });
  k.collide(cbox(W, H, 0.87, 0, H / 2, 0.005));
  k.anchors.tray = V3(-0.16, 0.24, 0.3);
  k.parts.light = light;
  return k.done({ mass: 320, material: 'metal' });
}

// ---------------------------------------------------------------------------
// SODA MACHINE: back-lit selection panel behind bowed acrylic, chrome-bezel flavour buttons
// ---------------------------------------------------------------------------
function drawColaPanel(c, w, h) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#e01a2a'); g.addColorStop(0.55, '#a50c18'); g.addColorStop(1, '#5c040b');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // white swoosh
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.beginPath(); c.moveTo(0, h * 0.62); c.bezierCurveTo(w * 0.4, h * 0.5, w * 0.6, h * 0.78, w, h * 0.6);
  c.lineTo(w, h * 0.66); c.bezierCurveTo(w * 0.6, h * 0.84, w * 0.4, h * 0.57, 0, h * 0.68); c.closePath(); c.fill();
  // bubbles
  const r = new RNG(5);
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 60; i++) { c.lineWidth = r.range(1, 3); c.beginPath(); c.arc(r.next() * w, r.next() * h, r.range(2, 12), 0, TAU); c.stroke(); }
  // giant can with condensation
  const cx = w * 0.5, cy = h * 0.43, cw = w * 0.44, ch = h * 0.36;
  c.save(); c.translate(cx, cy); c.rotate(-0.12);
  const cg = c.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  cg.addColorStop(0, '#5a0008'); cg.addColorStop(0.25, '#e8303c'); cg.addColorStop(0.4, '#ff9aa0'); cg.addColorStop(0.55, '#d01828'); cg.addColorStop(1, '#4a0006');
  c.fillStyle = cg; rrect(c, -cw / 2, -ch / 2, cw, ch, cw * 0.12); c.fill();
  const tg = c.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  tg.addColorStop(0, '#666'); tg.addColorStop(0.4, '#eee'); tg.addColorStop(1, '#555');
  c.fillStyle = tg; c.fillRect(-cw / 2 + 4, -ch / 2 - 6, cw - 8, 14); c.fillRect(-cw / 2 + 4, ch / 2 - 8, cw - 8, 14);
  txt(c, 'R.O.O.M.', 0, -ch * 0.18, cw * 0.2, { col: '#fff' });
  txt(c, 'COLA', 0, ch * 0.08, cw * 0.32, { col: '#fff', i: true, stroke: '#7a0010' });
  for (let i = 0; i < 70; i++) {
    const x = -cw * 0.46 + r.next() * cw * 0.92, y = -ch * 0.45 + r.next() * ch * 0.9, rr = r.range(1, 3.2);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(x, y, rr * 0.8, rr, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(80,0,0,0.35)'; c.beginPath(); c.ellipse(x + rr * 0.3, y + rr * 0.4, rr * 0.5, rr * 0.4, 0, 0, TAU); c.fill();
  }
  c.restore();
  // header + tagline
  drawLogo(c, w * 0.56, h * 0.07, w * 0.09, '#ffffff');
  txt(c, 'R.O.O.M. COLA', w / 2, h * 0.16, w * 0.13, { col: '#ffffff', i: true, stroke: '#5c040b', maxW: w * 0.92 });
  txt(c, 'Refreshment is Mandatory', w / 2, h * 0.81, w * 0.075, { col: '#ffe08a', f: 'serif', i: true, w: 'bold', maxW: w * 0.9 });
  // ice cold badge
  c.fillStyle = '#1d5fbf'; c.beginPath(); c.arc(w * 0.83, h * 0.3, w * 0.1, 0, TAU); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke();
  txt(c, 'ICE', w * 0.83, h * 0.288, w * 0.05, { col: '#fff' });
  txt(c, 'COLD', w * 0.83, h * 0.316, w * 0.045, { col: '#fff' });
  txt(c, 'NOW WITH 30% MORE CAFFEINE-ADJACENT COMPOUNDS', w / 2, h * 0.9, w * 0.028, { col: '#ffd0d0', f: 'mono', maxW: w * 0.9 });
  txt(c, 'Consumption logged to your employee file.', w / 2, h * 0.94, w * 0.028, { col: '#ffd0d0', f: 'mono', maxW: w * 0.9 });
  // back-light falloff toward the edges (fluorescent tubes behind the middle)
  const v = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.28)');
  c.fillStyle = v; c.fillRect(0, 0, w, h);
}

export function b_vending_drink(o) {
  void o;
  const k = new DKit('vending_drink', { wear: { chip: 0.16, rust: 0.03, grime: 0.42, dust: 0.35 }, ao: { res: 56 } });
  const A = k.atlas(1024, 1024);
  const W = 1.0, H = 1.85, D = 0.85;
  const RED = { tint: 0x8c0f18 };
  const DARK = { tint: 0x1d1d21, chip: 0.24 };
  const zP = D / 2 + 0.03; // contract front plane (screen / flap hinge reference)
  const zD = D / 2 - 0.004 + 0.03; // door skin front
  // ---- cabinet ----
  levelingFeet(k, W, D);
  k.box('#141416:p', W - 0.06, 0.06, D - 0.08, 0, 0.07, -0.01, { r: 0.003 });
  for (const sx of [-1, 1]) {
    k.box('paint', 0.03, H - 0.1, D - 0.004, sx * (W / 2 - 0.015), 0.1 + (H - 0.1) / 2, -0.002, { ...RED, r: 0.008, div: 0.35, dent: 0.0012 });
    // pressed stiffening swage near the back + rivet line
    k.box('paint', 0.004, H - 0.3, 0.02, sx * (W / 2 + 0.0005), 1.0, -0.33, { ...RED, r: 0.0018 });
    P.fastenerRow(k, [sx * W / 2, 0.25, -0.375], [sx * W / 2, 1.72, -0.375], 6, { kind: 'rivet', r: 0.0035, fin: { tint: 0x8c0f18, rough: 1 }, slot: 'paint', mo: { chip: 0.3 }, dir: sx > 0 ? 'x' : '-x' });
  }
  k.box('paint', W, 0.035, D - 0.004, 0, H - 0.0175, -0.002, { ...RED, r: 0.01 });
  k.box('paint', W - 0.06, H - 0.1, 0.02, 0, 0.1 + (H - 0.1) / 2, -D / 2 + 0.01, { tint: 0x2a2b2e, r: 0.003 });
  // ---- door: dark frame with the panel window and the delivery opening ----
  const ds = rrShape(0.98, 1.75, 0.02, 0, 0.955);
  ds.holes.push(rrHole(0.6, 1.24, 0.015, -0.16, 1.11));
  ds.holes.push(rrHole(0.34, 0.2, 0.012, -0.16, 0.255));
  k.ext('paint', ds, 0.03, 0, 0, zD - 0.03, { ...DARK, bev: 0.006, bevSeg: 2, curveSeg: 4 });
  k.tube('#0d0d0e:r', [[-0.49, 0.08, zD - 0.028], [0.49, 0.08, zD - 0.028], [0.49, 1.83, zD - 0.028], [-0.49, 1.83, zD - 0.028]], 0.004, { round: 0.02, closed: true, radial: 5 });
  for (const hy of [0.34, 1.56]) {
    k.cyl('metal', 0.0085, 0.085, -0.494, hy, zD - 0.012, { ...FIN.chrome, seg: 12, bev: 0.0015, bevSeg: 1, rust: 0 });
    k.cyl('metal', 0.005, 0.006, -0.494, hy + 0.0455, zD - 0.012, { ...FIN.chrome, seg: 8, rust: 0 });
  }
  // header lip with chrome trim strip
  k.box('paint', 0.98, 0.06, 0.06, 0, 1.8, D / 2 + 0.02, { ...DARK, r: 0.01 });
  k.box('metal', 0.94, 0.008, 0.004, 0, 1.784, D / 2 + 0.051, { ...FIN.chrome, r: 0.0015, rust: 0 });
  // ---- illuminated panel (own material: game may flicker / switch it) behind bowed acrylic ----
  const art = A.add(420, 860, drawColaPanel);
  const pg = fromBuffer(crtGeo(0.6, 1.24, 0.012));
  for (let i = 0; i < pg.uv.length; i += 2) { pg.uv[i] = lerp(art.u0, art.u1, pg.uv[i]); pg.uv[i + 1] = lerp(art.v0, art.v1, pg.uv[i + 1]); }
  const pm = atlasGlowMat(A.tex, 0.38);
  pm.roughness = 0.25; pm.alphaTest = 0; pm.name = 'cola_panel';
  const panel = k.mesh(pm, pg, -0.16, 1.11, zP - 0.012, { name: 'panel', atlasUV: true, ao: false, shadow: false });
  k.geo('glass', fromBuffer(crtGeo(0.6, 1.24, 0.014)), -0.16, 1.11, zP - 0.011);
  k.ext('metal', frameShape(0.632, 1.272, 0.022, 0.6, 1.24, 0.015), 0.008, -0.16, 1.11, zP, { ...FIN.chrome, rust: 0, chip: 0, bev: 0.0025, bevSeg: 1, curveSeg: 4 });
  P.screws(k, [[-0.465, 1.735, zP + 0.008], [0.145, 1.735, zP + 0.008], [-0.465, 0.485, zP + 0.008], [0.145, 0.485, zP + 0.008]], { r: 0.0032, kind: 'torx', fin: FIN.chrome });
  P.handprint(k, -0.02, 1.05, zP + 0.0125, 0.16, { col: '255,255,255', alpha: 0.06 });
  P.scuffs(k, -0.25, 0.75, zP + 0.0105, 0.3, 0.25, { alpha: 0.1 });
  // ---- selection column ----
  const cx = 0.32;
  k.box('paint', 0.27, 1.5, zP + 0.008 - zD, cx, 1.02, (zP + 0.008 + zD) / 2, { ...DARK, r: 0.004 });
  const flav = [['R.O.O.M. COLA', '#c8102e', '#fff'], ['DIET COLA', '#a9a9a9', '#9a0010'], ['ALMOND WATER', '#c8b890', '#4a3010'], ['LEMON-LIME', '#7fd23a', '#0d3a0d'], ['ORANGE FIZZ', '#ff8a1a', '#fff'], ['ROOT BEER', '#5a2a12', '#ffd9a0']];
  k.parts.buttons = []; k.parts.buttonLights = [];
  flav.forEach(([name, bg, fg], i) => {
    const y = 1.66 - i * 0.1;
    const reg = A.add(220, 72, (c, w, h) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      txt(c, name, w / 2, h * 0.42, h * 0.36, { col: fg, maxW: w * 0.9 });
      txt(c, '75¢', w / 2, h * 0.8, h * 0.2, { col: fg, f: 'mono' });
      rubOff(c, w, h, 0.5, 40 + i);
    }, { e: 0.2, r: 0.3, m: 0 });
    k.ext('metal', frameShape(0.229, 0.091, 0.009, 0.207, 0.073, 0.006), 0.007, cx, y, zP + 0.008, { ...FIN.chrome, rust: 0, chip: 0, bev: 0.0016, bevSeg: 1, curveSeg: 3 });
    const bg2 = k.grp(cx, y, zP + 0.018, { name: 'button_' + i });
    k.insideStatic(bg2, () => {
      k.box('#dedad0:s', 0.205, 0.071, 0.012, 0, 0, -0.004, { r: 0.005, seg: 1 });
      k.label(reg, 0.19, 0.06, 0, 0, 0.0021);
    });
    let fl = null;
    k.inside(bg2, () => { fl = k.label(reg, 0.19, 0.06, 0, 0, 0.0027, { glow: 0.32, own: true, name: 'buttonLight_' + i }); });
    linkFlash(fl, 0.32);
    k.parts.buttonLights.push(fl);
    k.parts.buttons.push(bg2);
  });
  // LED display + exact-change lamp
  k.box('#0e0f10:s', 0.2, 0.07, 0.014, cx, 1.03, zP + 0.015, { r: 0.006 });
  k.box('#2a0806:g', 0.18, 0.052, 0.002, cx, 1.03, zP + 0.0225, { r: 0 });
  k.screen('main', 0.17, 0.045, cx, 1.03, zP + 0.0245, { style: 'led', text: 'INSERT COINS', bulge: 0 });
  const exact = k.reg('exact', 200, 30, (c, w, h) => { c.fillStyle = '#1a0504'; c.fillRect(0, 0, w, h); txt(c, 'USE EXACT CHANGE', w / 2, h / 2, h * 0.62, { col: '#ff5a3a', f: 'bold', maxW: w * 0.92 }); }, { e: 0.35, r: 0.2, m: 0 });
  k.box('#0e0f10:s', 0.13, 0.026, 0.006, cx, 0.975, zP + 0.011, { r: 0.003 });
  k.label(exact, 0.12, 0.018, cx, 0.975, zP + 0.0142);
  // money: coin slot + return, bill validator, coin cup
  moneySection(k, cx, 0.895, 0.775, 0.635, zP + 0.008);
  // T-handle lock
  const lx = cx + 0.065, ly = 0.53, lz = zP + 0.008;
  k.lathe('metal', [[0, 0], [0.022, 0, 1], [0.022, 0.003, 2], [0.017, 0.006, 2], [0.0085, 0.0065], [0, 0.0065]], lx, ly, lz, { ...FIN.chrome, axis: 'z', seg: 22, rust: 0 });
  k.cyl('metal', 0.006, 0.02, lx, ly, lz + 0.016, { ...FIN.chrome, axis: 'z', seg: 12, rust: 0 });
  k.box('metal', 0.068, 0.014, 0.013, lx, ly, lz + 0.031, { ...FIN.chrome, r: 0.0055, rust: 0 });
  k.cyl('metal', 0.0055, 0.002, lx, ly, lz + 0.0385, { ...FIN.brass, axis: 'z', seg: 12 });
  k.box('#050505', 0.0016, 0.0062, 0.0008, lx, ly, lz + 0.0396, { r: 0 });
  // warning sticker
  const warn = k.reg('warn', 220, 150, (c, w, h) => {
    c.fillStyle = '#d6cfb8'; c.fillRect(0, 0, w, h);
    hazardTri(c, w * 0.15, h * 0.32, h * 0.35);
    txt(c, 'WARNING', w * 0.62, h * 0.2, h * 0.14, { col: '#c8102e' });
    ['DO NOT ROCK OR TILT.', 'MACHINE MAY TIP OVER', 'CAUSING INJURY OR', 'ADMINISTRATIVE DEATH.'].forEach((s, i) => txt(c, s, w * 0.62, h * (0.38 + i * 0.13), h * 0.075, { col: '#111', f: 'mono', maxW: w * 0.62 }));
    grime(c, w, h, 0.5, 9); rubOff(c, w, h, 0.8, 3);
  });
  k.label(warn, 0.2, 0.136, cx - 0.01, 0.38, zP + 0.0085, { rot: [0, 0, 0.02] });
  P.scuffs(k, cx, 1.35, zP + 0.0084, 0.24, 0.6, { col: '30,26,20', alpha: 0.18 });
  // ---- delivery bin + flap ----
  pickupBin(k, -0.16, 0.34, 0.352, zP - 0.016, 0.155, 0.235, { fh: 0.195 });
  // kick plate vents + shoe scuffs
  P.louvre(k, 0.25, 0.115, zD, 0.36, 0.05, 4, { mo: DARK, raised: false, depth: 0.012 });
  P.scuffs(k, 0, 0.12, zD + 0.0005, 0.9, 0.08, { col: '20,18,16', alpha: 0.35 });
  // ---- side graphics + back ----
  const side = A.add(200, 420, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#8c0f18'); g.addColorStop(1, '#c8102e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(0, h * 0.62, w, h * 0.05);
    c.save(); c.translate(w * 0.5, h * 0.36); c.rotate(-HP);
    txt(c, 'R.O.O.M. COLA', 0, 0, w * 0.3, { col: '#fff', i: true, maxW: h * 0.66 });
    c.restore();
    txt(c, 'Refreshment', w / 2, h * 0.76, w * 0.12, { col: '#ffe08a', f: 'serif', i: true });
    txt(c, 'is Mandatory', w / 2, h * 0.82, w * 0.12, { col: '#ffe08a', f: 'serif', i: true });
    grime(c, w, h, 0.6, 21); rubOff(c, w, h, 1.1, 12);
  });
  k.label(side, 0.4, 0.84, W / 2 + 0.0008, 1.05, -0.02, { rot: [0, HP, 0] });
  k.label(side, 0.4, 0.84, -W / 2 - 0.0008, 1.05, -0.02, { rot: [0, -HP, 0] });
  k.push(0.2, 0.42, -D / 2, [0, PI, 0]);
  P.slotVent(k, 0, 0, 0, 0.3, 0.2, 8, { mo: { tint: 0x2a2b2e } });
  P.slotVent(k, -0.42, -0.12, 0, 0.36, 0.16, 6, { mo: { tint: 0x2a2b2e } });
  k.pop();
  const serial = k.reg('cola_serial', 200, 70, (c, w, h) => { c.fillStyle = '#c9c9c4'; c.fillRect(0, 0, w, h); txt(c, 'COLD-VEND 9', w / 2, h * 0.28, h * 0.22, { col: '#111' }); txt(c, '115V 60Hz 6.8A  R-134a 9.5oz', w / 2, h * 0.58, h * 0.13, { col: '#222', f: 'mono', maxW: w * 0.92 }); txt(c, 'R.O.O.M. FACILITIES DIV.', w / 2, h * 0.82, h * 0.12, { col: '#222', f: 'mono' }); }, 'b');
  k.push(-0.2, 1.4, -D / 2, [0, PI, 0]);
  P.plate(k, serial, 0.16, 0.056, 0, 0, 0, { fin: FIN.alu, rr: 0.0018 });
  k.pop();
  P.cable(k, [[0.3, 0.3, -0.43], [0.32, 0.12, -0.46], [0.36, 0.012, -0.55], [0.6, 0.012, -0.75]], 0.006, { tint: 0x161616 });
  k.collide(cbox(W, H, D + 0.04, 0, H / 2, 0.02));
  k.anchors.tray = V3(-0.16, 0.19, 0.34);
  k.parts.panel = panel;
  return k.done({ mass: 340, material: 'metal' });
}
