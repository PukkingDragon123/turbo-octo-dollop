// Break room appliances: water cooler, aquarium, service bell, dart board cabinet, coffee brewer, fridge.
// Floor devices: origin on the floor under the centre, front +Z. Wall devices: origin on the wall plane.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, DEG, V3, cbox, ccyl, frameShape, rrShape, rrHole, Geo, boxGeo, cylGeo, latheGeo, axisGeo, gridGeo, discGeo, fromBuffer, lerp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, drawLogo, drawClone, canvasTex } from './atlas.js';
import { RNG } from '../../core/rng.js';
import { TINTED, CLEAR, lampMat, emissiveMat } from './mats.js';
import { volumeMat, withCaustics, fluidTick } from './fluids.js';
import { linkTick } from './sync.js';

// ---------------------------------------------------------------------------
// WATER COOLER: enamel cabinet, paddle taps, drip tray, side cup dispenser, inverted 5-gal PET bottle
// (parts.bottle renderOrder 2, parts.water origin at the neck: scale.y drains it, parts.bubbleOrigin)
// ---------------------------------------------------------------------------
export function b_water_cooler(o) {
  void o;
  const k = new DKit('water_cooler', { wear: { chip: 0.12, rust: 0.05, grime: 0.45, dust: 0.4 } });
  k.atlas(512, 1024);
  const W = 0.31, D = 0.33, top = 0.95;
  const SH = { tint: 0xd6d0c0 };
  const GR = { tint: 0x8d8f90 };
  k.box('#1a1a1b:r', W - 0.02, 0.014, D - 0.02, 0, 0.007, 0, { r: 0.003 });
  // cabinet around the dispensing alcove (y 0.6..0.87)
  k.box('paint', W, 0.586, D, 0, 0.307, 0, { ...SH, r: 0.016, div: 0.25, dent: 0.0008 });
  k.box('paint', W, 0.1, D, 0, top - 0.05, 0, { ...SH, r: 0.016 });
  for (const sx of [-1, 1]) k.box('paint', 0.045, 0.28, D, sx * (W / 2 - 0.0225), 0.735, 0, { ...SH, r: 0.008 });
  k.box('paint', W - 0.08, 0.28, D - 0.1, 0, 0.735, -0.05, { ...SH, r: 0.004 });
  k.box('plastic', W - 0.09, 0.27, 0.004, 0, 0.735, 0.0672, { ...GR, r: 0 });
  // drip tray + slotted grille
  k.box('plastic', W - 0.085, 0.022, 0.1, 0, 0.611, 0.116, { tint: 0x5d5f61, r: 0.005 });
  const gs = rrShape(W - 0.1, 0.085, 0.006);
  for (let i = 0; i < 8; i++) gs.holes.push(rrHole(0.012, 0.064, 0.005, -0.098 + i * 0.028, 0));
  k.ext('plastic', gs, 0.003, 0, 0.6225, 0.116, { tint: 0x9a9c9e, rot: [-HP, 0, 0], curveSeg: 2 });
  P.stain(k, -0.03, 0.6232, 0.11, 0.06, 0.05, { col: '120,150,170', alpha: 0.35, rot: [-HP, 0, 0] });
  // paddle taps (cold blue, hot red with child lock)
  const tap = (x, col, name, hot) => {
    k.lathe('#e2ded2:s', [[0, 0], [0.017, 0, 1], [0.017, 0.026, 2], [0.0145, 0.032, 2], [0, 0.033]], x, 0.815, 0.108, { seg: 16 });
    k.cyl('metal', 0.0055, 0.016, x, 0.808, 0.108, { ...FIN.chrome, seg: 10, rust: 0 });
    const g = k.grp(x, 0.845, 0.128, { name });
    k.insideStatic(g, () => {
      k.box('#' + col.toString(16).padStart(6, '0') + ':s', 0.032, 0.062, 0.012, 0, -0.031, 0.006, { r: 0.005 });
      k.cyl('#' + col.toString(16).padStart(6, '0') + ':s', 0.008, 0.014, 0, -0.012, 0.008, { axis: 'z', seg: 10 });
      if (hot) k.box('#f0ece0:s', 0.018, 0.012, 0.006, 0, 0.004, 0.012, { r: 0.002 });
    });
    return g;
  };
  k.parts.tapCold = tap(-0.05, 0x2b6fd0, 'tapCold', false);
  k.parts.tapHot = tap(0.05, 0xd0302a, 'tapHot', true);
  // bottle collar
  k.cyl('paint', 0.11, 0.03, 0, top + 0.015, 0, { ...SH, seg: 28, r2: 0.13, bev: 0.004 });
  k.cyl('plastic', 0.047, 0.012, 0, top + 0.036, 0, { tint: 0x777a7c, seg: 20, bev: 0.002 });
  k.cyl('plastic', 0.012, 0.03, 0, top + 0.05, 0, { tint: 0x6a6d70, seg: 10 });
  // badge, labels, power LEDs (lens prints; parts.leds keep the two pivots)
  const badge = k.reg('wc_badge', 200, 60, (c, w, h) => {
    c.fillStyle = '#1f4f8a'; rrect(c, 0, 0, w, h, 10); c.fill();
    txt(c, 'R.O.O.M.', w * 0.3, h * 0.5, h * 0.42, { col: '#fff' });
    txt(c, 'AQUA-COOL', w * 0.72, h * 0.38, h * 0.26, { col: '#bfe3ff', f: 'bold' });
    txt(c, 'MODEL WC-9', w * 0.72, h * 0.7, h * 0.18, { col: '#bfe3ff', f: 'mono' });
  }, 'g');
  k.box('metal', 0.176, 0.056, 0.003, 0, 0.5, D / 2 + 0.0015, { ...FIN.chrome, r: 0.0012 });
  k.label(badge, 0.17, 0.051, 0, 0.5, D / 2 + 0.0034);
  const hc = k.reg('wc_hc', 140, 36, (c, w, h) => {
    c.fillStyle = '#e2ddcf'; c.fillRect(0, 0, w, h);
    txt(c, 'COLD', w * 0.25, h / 2, h * 0.5, { col: '#2b6fd0' }); txt(c, 'HOT', w * 0.75, h / 2, h * 0.5, { col: '#d0302a' });
    rubOff(c, w, h, 0.4, 5);
  });
  k.label(hc, 0.13, 0.033, 0, 0.885, D / 2 + 0.0006);
  k.parts.leds = [];
  for (const [x, col, name] of [[-0.05, '#2aff6a:e', 'ledCold'], [0.05, '#ff3020:e', 'ledHot']]) {
    k.cyl('#202022:p', 0.0065, 0.003, x, 0.915, D / 2 + 0.0015, { axis: 'z', seg: 12 });
    k.sph(col, 0.0042, x, 0.915, D / 2 + 0.003, { ws: 10, hs: 6, s: [1, 1, 0.6] });
    k.parts.leds.push(k.grp(x, 0.915, D / 2 + 0.003, { name }));
  }
  P.scuffs(k, 0, 0.18, D / 2 + 0.0005, W * 0.9, 0.3, { col: '30,26,20', alpha: 0.3 });
  // back: condenser serpentine + brackets + cord
  const coil = [];
  for (let i = 0; i < 9; i++) { const y = 0.12 + i * 0.05; coil.push([i % 2 ? 0.1 : -0.1, y, -D / 2 - 0.02]); coil.push([i % 2 ? -0.1 : 0.1, y, -D / 2 - 0.02]); }
  k.tube('metal', coil, 0.004, { ...FIN.iron, round: 0.022, rseg: 4, radial: 6, caps: true, rust: 0.3 });
  for (const y of [0.12, 0.52]) k.box('metal', 0.24, 0.01, 0.025, 0, y, -D / 2 - 0.012, { ...FIN.iron, r: 0.002 });
  P.cable(k, [[0.08, 0.15, -D / 2], [0.1, 0.05, -D / 2 - 0.05], [0.12, 0.008, -D / 2 - 0.12], [0.3, 0.008, -D / 2 - 0.3]], 0.004, { tint: 0x161616 });
  // cup dispenser tube (right side)
  const tx = W / 2 + 0.05, tz = 0.06;
  for (const y of [0.86, 0.6]) k.box('paint', 0.04, 0.05, 0.03, W / 2 + 0.012, y, tz, { ...SH, r: 0.006 });
  k.cyl('glass', 0.04, 0.34, tx, 0.72, tz, { seg: 18, open: true });
  k.cyl('paint', 0.044, 0.02, tx, 0.9, tz, { ...SH, seg: 18, bev: 0.003 });
  k.tor('paint', 0.042, 0.005, tx, 0.552, tz, { ...SH, axis: 'y', ts: 18, rs: 5 });
  const cup = latheGeo([[0.024, 0], [0.035, 0.085, 1], [0.0375, 0.088, 2], [0.0355, 0.0885], [0.0225, 0.0045]], 14, { rings: false });
  for (let i = 0; i < 9; i++) k.put('#e6e0d0:r', axisGeo(new Geo().append(cup), 'y'), tx, 0.645 + i * 0.025, tz, { rot: [PI, 0, 0] });
  // ---- bottle (inverted 5-gal PET) + water + label band ----
  const prof = [[0.028, 0], [0.028, 0.055], [0.036, 0.068], [0.08, 0.09], [0.12, 0.118], [0.134, 0.15], [0.134, 0.2], [0.127, 0.21], [0.134, 0.22],
    [0.134, 0.3], [0.127, 0.31], [0.134, 0.32], [0.134, 0.41], [0.126, 0.45], [0.095, 0.476], [0.04, 0.488], [0.0, 0.49]];
  const by = top + 0.02;
  const bottle = k.mesh(TINTED(0x8fc4f0, 0.2, { rough: 0.1, env: 1.1 }), latheGeo(prof, 32, { rings: false }), 0, by, 0, { name: 'bottle', shadow: false, ao: false });
  bottle.renderOrder = 2;
  k.cyl('#2b6fd0:s', 0.031, 0.018, 0, by + 0.008, 0, { seg: 18, bev: 0.002 });
  const lvl = 0.42;
  const wprof = [[0.0, 0.004], [0.026, 0.004]].concat(prof.filter(([, y]) => y > 0.004 && y < lvl).map(([r, y]) => [r * 0.94, y]), [[0.126, lvl], [0.0, lvl]]);
  const water = k.mesh(TINTED(0x3a8ad8, 0.42, { rough: 0.05, env: 0.8 }), latheGeo(wprof, 24, { rings: false }), 0, by, 0, { name: 'water', shadow: false, ao: false });
  water.renderOrder = 1;
  const bub = k.grp(0, by + 0.06, 0, { name: 'bubbleOrigin' });
  const lab = k.reg('wc_label', 400, 80, (c, w, h) => {
    c.fillStyle = '#f4f2ea'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f4f8a'; c.fillRect(0, 0, w, h * 0.12); c.fillRect(0, h * 0.88, w, h * 0.12);
    txt(c, 'R.O.O.M. SPRING', w * 0.35, h * 0.42, h * 0.32, { col: '#1f4f8a' });
    txt(c, '100% COMPLIANT HYDRATION • 18.9 L', w * 0.35, h * 0.72, h * 0.15, { col: '#333', f: 'mono', maxW: w * 0.6 });
    drawLogo(c, w * 0.85, h * 0.5, h * 0.3, '#1f4f8a', { text: false });
    grime(c, w, h, 0.4, 3);
  });
  k.clabel(lab, 0.1356, 0.07, 2.2, 0, by + 0.265, 0, { seg: 18 });
  k.collide(cbox(W, top, D, 0, top / 2, 0));
  k.collide(ccyl(0.135, 0.49, 0, by + 0.245, 0));
  k.anchors.tap = V3(-0.05, 0.625, 0.11);
  k.anchors.tapHot = V3(0.05, 0.625, 0.11);
  k.anchors.cups = V3(tx, 0.55, tz);
  k.parts.water = water;
  k.parts.bubbleOrigin = bub;
  k.parts.bottle = bottle;
  return k.done({ mass: 38, material: 'plastic' });
}

// ---------------------------------------------------------------------------
// SERVICE BELL: spun brass dome on a lacquered base, plunger (parts.plunger pivot)
// ---------------------------------------------------------------------------
export function b_service_bell(o) {
  void o;
  const k = new DKit('service_bell', { wear: { chip: 0.05, rust: 0.05, grime: 0.3, dust: 0.3 } });
  k.atlas(64, 64);
  k.lathe('plastic', [[0.0001, 0], [0.044, 0, 1], [0.047, 0.004, 2], [0.047, 0.01, 2], [0.043, 0.014, 2], [0.0001, 0.0142]], 0, 0, 0, { tint: 0x161616, rough: 0.45, seg: 36, edge: 0.4 });
  k.lathe('metal', [[0.04, 0.0142], [0.043, 0.0145, 1], [0.0425, 0.02, 2], [0.041, 0.03], [0.036, 0.039], [0.026, 0.046], [0.012, 0.0495], [0.0, 0.05]], 0, 0, 0, { ...FIN.brass, rough: 0.35, seg: 36, rust: 0.15 });
  k.cyl('metal', 0.0045, 0.006, 0, 0.053, 0, { ...FIN.brass, seg: 12, bev: 0.001 });
  const pl = k.grp(0, 0, 0, { name: 'plunger' });
  k.insideStatic(pl, () => {
    k.cyl('metal', 0.0025, 0.014, 0, 0.06, 0, { ...FIN.chrome, seg: 10 });
    k.sph('metal', 0.0075, 0, 0.069, 0, { ...FIN.brass, rough: 0.3, ws: 14, hs: 10, s: [1, 0.75, 1] });
  });
  // felt pads underneath
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; k.cyl('#3a2a1e:r', 0.006, 0.0015, Math.cos(a) * 0.032, -0.0007, Math.sin(a) * 0.032, { seg: 8 }); }
  k.collide(ccyl(0.047, 0.075, 0, 0.0375, 0));
  k.parts.plunger = pl;
  k.anchors.top = V3(0, 0.075, 0);
  return k.done({ mass: 0.4, material: 'metal' });
}

// ---------------------------------------------------------------------------
// COFFEE BREWER: commercial pour-over with stainless hood, two warmers, brew funnel, carafes
// (parts.carafe = lower pot pivot, parts.lamp = power lamp, anchors.spout / cup)
// ---------------------------------------------------------------------------
function carafe(k, x, y, z, fill, name) {
  const g = k.grp(x, y, z, { name });
  k.insideStatic(g, () => {
    const prof = [[0.0001, 0.0], [0.06, 0.0, 1], [0.075, 0.02], [0.08, 0.06], [0.075, 0.1], [0.05, 0.13], [0.045, 0.15], [0.05, 0.165, 2]];
    k.lathe('glass', prof, 0, 0, 0, { seg: 24, rings: false });
    const fh = 0.11 * fill;
    k.lathe('#1a0c04:g', [[0.0001, 0.004], [0.056, 0.004], [0.072, 0.022], [0.077, Math.min(0.06, fh)], [0.075, fh], [0.0001, fh]].filter(([, yy], i, a) => i === 0 || yy >= a[i - 1][1]), 0, 0, 0, { seg: 20, rings: false });
    k.cyl('#e8661c:s', 0.052, 0.025, 0, 0.16, 0, { seg: 20, bev: 0.004 });
    k.cyl('#e8661c:s', 0.02, 0.012, 0, 0.178, 0, { seg: 12, bev: 0.003 });
    k.box('#151515:p', 0.022, 0.1, 0.02, 0.098, 0.1, 0, { r: 0.008 });
    for (const yy of [0.15, 0.05]) k.box('#151515:p', 0.04, 0.015, 0.02, 0.08, yy, 0, { r: 0.005 });
    k.tor('#c8ccce:c', 0.077, 0.002, 0, 0.13, 0, { axis: 'y', ts: 24, rs: 4 });
  });
  return g;
}
export function b_coffee_machine(o) {
  void o;
  const k = new DKit('coffee_machine', { wear: { chip: 0.06, rust: 0.12, grime: 0.6, dust: 0.35 } });
  k.atlas(512, 512);
  const W = 0.4, D = 0.42;
  const BODY = { tint: 0x1c1c1e, rough: 0.6 };
  const SS = { ...FIN.satin, rough: 0.8 };
  k.box('plastic', W, 0.04, D, 0, 0.02, 0, { ...BODY, r: 0.01 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('#111:r', 0.014, 0.006, sx * (W / 2 - 0.03), -0.002, sz * (D / 2 - 0.03), { seg: 10 });
  // drip/warmer plate + burner
  k.box('metal', 0.18, 0.012, 0.18, -0.08, 0.046, 0.06, { ...SS, r: 0.004 });
  k.cyl('metal', 0.075, 0.006, -0.08, 0.052, 0.06, { ...FIN.iron, seg: 28, bev: 0.0015 });
  P.stain(k, -0.06, 0.0556, 0.07, 0.11, 0.1, { col: '30,16,6', alpha: 0.6, ring: true, rot: [-HP, 0, 0] });
  // spine + stainless hood + top
  k.box('plastic', W, 0.55, 0.12, 0, 0.315, -D / 2 + 0.06, { ...BODY, r: 0.012 });
  k.box('metal', W, 0.12, D, 0, 0.53, 0, { ...SS, r: 0.012, dent: 0.0006, div: 0.08 });
  k.box('plastic', W - 0.02, 0.02, D - 0.02, 0, 0.6, 0, { ...BODY, r: 0.006 });
  k.cyl('metal', 0.075, 0.006, 0.0, 0.613, 0.05, { ...FIN.iron, seg: 28, bev: 0.0015 });
  // spray head + brew funnel
  k.cyl('metal', 0.03, 0.01, -0.08, 0.465, 0.06, { ...SS, seg: 16 });
  k.lathe('plastic', [[0.025, 0.0], [0.06, 0.04, 1], [0.085, 0.07], [0.085, 0.075, 2], [0.082, 0.075]], -0.08, 0.375, 0.06, { ...BODY, seg: 24 });
  k.box('plastic', 0.03, 0.02, 0.14, -0.08, 0.448, 0.17, { ...BODY, r: 0.006 });
  P.streak(k, -0.08, 0.37, 0.144, 0.04, 0.08, { col: '40,20,8', alpha: 0.4 });
  // carafes
  k.parts.carafe = carafe(k, -0.08, 0.055, 0.06, 0.6, 'carafe');
  carafe(k, 0.0, 0.616, 0.05, 0.3, 'carafe2');
  // control column: rocker switches, lamp, labels
  k.box('plastic', 0.12, 0.33, 0.04, 0.13, 0.27, D / 2 - 0.02, { ...BODY, r: 0.008 });
  for (let i = 0; i < 2; i++) {
    k.box('#0e0e0f:p', 0.036, 0.052, 0.006, 0.13, 0.3 - i * 0.07, D / 2 + 0.002, { r: 0.003 });
    k.box('#333333:s', 0.03, 0.045, 0.012, 0.13, 0.3 - i * 0.07, D / 2 + 0.006, { r: 0.004, rot: [i ? 0.2 : -0.2, 0, 0] });
  }
  k.parts.lamp = P.pilotLamp(k, 0.13, 0.38, D / 2, 0.007, 'red', { name: 'lamp', bezel: 'black' });
  const lb = k.reg('cm_brand', 300, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. BREW-MASTER 3000', w / 2, h * 0.35, h * 0.28, { col: '#e8c860', maxW: w * 0.95 }); txt(c, 'FRESH POT = PRODUCTIVE CLONE', w / 2, h * 0.75, h * 0.18, { col: '#bbb', f: 'mono', maxW: w * 0.95 }); });
  k.decal(lb, 0.36, 0.072, 0, 0.53, D / 2 + 0.0006);
  const sl = k.reg('cm_sw', 100, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'BREW', w / 2, h * 0.25, h * 0.22, { col: '#ddd', f: 'mono' }); txt(c, 'WARM', w / 2, h * 0.75, h * 0.22, { col: '#ddd', f: 'mono' }); });
  k.decal(sl, 0.06, 0.12, 0.13, 0.17, D / 2 + 0.0006);
  const wn = k.reg('cm_warn', 120, 60, (c, w, h) => { c.fillStyle = '#e8d24a'; c.fillRect(0, 0, w, h); txt(c, 'HOT!', w / 2, h * 0.36, h * 0.34, { col: '#111' }); txt(c, 'DO NOT TOUCH', w / 2, h * 0.74, h * 0.18, { col: '#111', f: 'mono' }); grime(c, w, h, 0.6, 2); });
  k.label(wn, 0.05, 0.025, 0.13, 0.12, D / 2 + 0.0006);
  // water lid on top + cord
  k.box('plastic', 0.16, 0.012, 0.12, 0.0, 0.596, -0.13, { ...BODY, r: 0.004 });
  P.cable(k, [[0.1, 0.06, -D / 2], [0.12, 0.02, -D / 2 - 0.06], [0.2, 0.006, -D / 2 - 0.2]], 0.004, { tint: 0x161616 });
  k.collide(cbox(W, 0.62, D, 0, 0.31, 0));
  k.anchors.spout = V3(-0.08, 0.37, 0.06);
  k.anchors.cup = V3(-0.08, 0.052, 0.06);
  return k.done({ mass: 9, material: 'metal' });
}

// ---------------------------------------------------------------------------
// AQUARIUM: walnut stand with raised-panel doors, 1.2 m tank (parts.glass = [merged panes], hidden
// when smashed), volume water (parts.water), caustic gravel, resin castle, driftwood, swaying plants
// (parts.plants pivots, drawn instanced), air stone (parts.bubbler), hood light strip (parts.light)
// ---------------------------------------------------------------------------
let _gravel = null;
function gravelMat() {
  if (_gravel) return _gravel;
  const tex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#3a3326'; c.fillRect(0, 0, w, h);
    const r = new RNG(31);
    const cols = ['#c9b48a', '#8a7a5a', '#d8d0c0', '#5a6a8a', '#a0584a', '#e0c070', '#6a8a6a', '#ffffff', '#3a3a3a'];
    for (let i = 0; i < 1400; i++) {
      const x = r.next() * w, y = r.next() * h, rr = r.range(2, 5.5), col = r.pick(cols), ar = r.range(0.6, 1), rot = r.next() * 3;
      for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(x + dx + 0.8, y + dy + 1, rr, rr * ar, rot, 0, TAU); c.fill();
        c.fillStyle = col; c.beginPath(); c.ellipse(x + dx, y + dy, rr, rr * ar, rot, 0, TAU); c.fill();
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 600; i++) { const x = r.next() * w, y = r.next() * h; c.fillRect(x, y, 1.5, 1.5); }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _gravel = withCaustics(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 }), 0.4);
  _gravel.name = 'aq_gravel';
  return _gravel;
}
// double-sided tapering leaf strip (UV: u across, v along the region)
function leafGeo(len, wid, bend, twist, reg, seg = 6) {
  const g = new Geo();
  for (const side of [1, -1]) {
    const base = g.count;
    for (let j = 0; j <= seg; j++) {
      const t = j / seg, taper = Math.sin(Math.min(1, t * 1.15) * PI * 0.92 + 0.12);
      for (let i = 0; i <= 1; i++) {
        const x = (i - 0.5) * wid * taper + Math.sin(t * PI * 0.8) * twist * len * 0.2;
        g.v(x, t * len * (1 - Math.abs(bend) * 0.25 * t), bend * t * t * len, 0, 0, side, lerp(reg.u0, reg.u1, i), lerp(reg.v0, reg.v1, t), 0);
      }
    }
    for (let j = 0; j < seg; j++) { const a = base + j * 2; if (side > 0) g.quad(a, a + 1, a + 3, a + 2); else g.quad(a, a + 2, a + 3, a + 1); }
  }
  g.computeNormals(false);
  return g;
}
function plantGeo(rng, tall, reg) {
  const g = new Geo();
  const n = tall ? 7 : 5;
  for (let j = 0; j < n; j++) {
    const len = tall ? rng.range(0.22, 0.4) : rng.range(0.1, 0.18);
    const m = new THREE.Matrix4().makeRotationY((j / n) * TAU + rng.next()).multiply(new THREE.Matrix4().makeRotationX(rng.range(-0.15, 0.15)));
    m.setPosition(rng.range(-0.01, 0.01), 0, rng.range(-0.01, 0.01));
    g.append(leafGeo(len, tall ? 0.018 : 0.045, rng.range(-0.4, 0.4), rng.range(-0.5, 0.5), reg), m);
  }
  return g;
}
export function b_aquarium(o) {
  const k = new DKit('aquarium', { wear: { chip: 0.08, rust: 0.05, grime: 0.4, dust: 0.4 }, ao: { res: 56 } });
  const A = k.atlas(512, 1024);
  const r = new RNG(o.seed ?? 12);
  const WAL = { tint: 0x6a4a34, rough: 0.8 };
  const SW = 1.24, SH = 0.86, SD = 0.52;
  // ---- stand cabinet ----
  k.box('wood', SW, 0.05, SD, 0, SH - 0.025, 0, { ...WAL, r: 0.008 });
  k.box('wood', SW - 0.02, SH - 0.13, SD - 0.04, 0, 0.08 + (SH - 0.13) / 2, -0.01, { ...WAL, r: 0.004 });
  k.box('wood', SW - 0.06, 0.08, SD - 0.08, 0, 0.04, -0.01, { tint: 0x3e2a1c, rough: 0.9, r: 0.004 });
  for (let i = 0; i < 2; i++) {
    const x = (i ? 1 : -1) * 0.3;
    k.box('wood', 0.58, 0.64, 0.02, x, 0.43, SD / 2 - 0.02, { ...WAL, r: 0.005 });
    k.ext('wood', rrShape(0.48, 0.54, 0.01), 0.012, x, 0.43, SD / 2 - 0.01, { tint: 0x5a3c28, rough: 0.8, bev: 0.006, bevSeg: 2, curveSeg: 3 });
    k.sph('#c8a254:m', 0.014, (i ? 1 : -1) * 0.04, 0.5, SD / 2 + 0.008, { ws: 12, hs: 8 });
    for (const y of [0.2, 0.66]) k.cyl('#c8a254:m', 0.005, 0.05, (i ? 1 : -1) * 0.588, y, SD / 2 - 0.008, { seg: 8 });
  }
  const plate = k.reg('aq_plate', 220, 44, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e8c878'); g.addColorStop(1, '#9a7a32');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    txt(c, 'MORALE AQUARIUM', w / 2, h * 0.38, h * 0.32, { col: '#3a2808', f: 'serif' });
    txt(c, 'Do not tap glass. Do not name fish.', w / 2, h * 0.75, h * 0.18, { col: '#3a2808', f: 'serif', i: true, maxW: w * 0.92 });
  }, 'm');
  k.box('#c8a254:m', 0.226, 0.048, 0.002, 0, 0.8, SD / 2 + 0.001, { r: 0.0008 });
  k.label(plate, 0.22, 0.044, 0, 0.8, SD / 2 + 0.0026);
  // air pump on the stand behind the tank
  k.box('#c8c4b8:s', 0.12, 0.05, 0.08, 0.45, SH + 0.025, -SD / 2 + 0.05, { r: 0.012 });
  // ---- tank ----
  const TW = 1.2, TD = 0.5, TH = 0.5, ty = SH + 0.02;
  const TRIM = { tint: 0x141414, rough: 0.7 };
  k.ext('plastic', frameShape(TW + 0.02, TD + 0.02, 0.008, TW - 0.02, TD - 0.02, 0.004), 0.025, 0, SH, 0, { ...TRIM, rot: [-HP, 0, 0], bev: 0.003, bevSeg: 1, curveSeg: 3 });
  k.box('plastic', TW, 0.006, TD, 0, SH + 0.003, 0, { ...TRIM, r: 0 });
  k.ext('plastic', frameShape(TW + 0.02, TD + 0.02, 0.008, TW - 0.03, TD - 0.03, 0.004), 0.02, 0, ty + TH - 0.01, 0, { ...TRIM, rot: [-HP, 0, 0], bev: 0.003, bevSeg: 1, curveSeg: 3 });
  // silicone beads in the corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('#1c221f:g', 0.006, TH - 0.03, 0.006, sx * (TW / 2 - 0.009), ty + TH / 2, sz * (TD / 2 - 0.009), { r: 0 });
  const gg = new Geo();
  const pane = (w, h, x, y, z, ry) => gg.append(boxGeo(w, h, 0.008, { r: 0 }), new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  pane(TW, TH, 0, ty + TH / 2, TD / 2, 0); pane(TW, TH, 0, ty + TH / 2, -TD / 2, 0);
  pane(TD - 0.016, TH, -TW / 2, ty + TH / 2, 0, HP); pane(TD - 0.016, TH, TW / 2, ty + TH / 2, 0, HP);
  const glass = k.mesh(CLEAR({ env: 1.3, tint: 0x020403 }), gg, 0, 0, 0, { name: 'glass', shadow: false, ao: false });
  glass.renderOrder = 3;
  k.parts.glass = [glass];
  // background print behind the back pane (inside view + outside)
  const bgArt = A.add(384, 160, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0e4a6a'); g.addColorStop(1, '#06222e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const rr = new RNG(3);
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = `rgba(30,${90 + rr.next() * 60},60,0.8)`; c.lineWidth = rr.range(3, 8);
      const x = rr.next() * w; c.beginPath(); c.moveTo(x, h); c.quadraticCurveTo(x + rr.range(-30, 30), h * 0.5, x + rr.range(-20, 20), h * rr.range(0.1, 0.6)); c.stroke();
    }
    for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(200,230,255,${rr.range(0.05, 0.15)})`; c.beginPath(); c.arc(rr.next() * w, rr.next() * h * 0.6, rr.range(1, 3), 0, TAU); c.fill(); }
  });
  k.label(bgArt, TW - 0.02, TH - 0.02, 0, ty + TH / 2, -TD / 2 - 0.0062, { rot: [0, PI, 0] });
  k.label(bgArt, TW - 0.02, TH - 0.02, 0, ty + TH / 2, -TD / 2 - 0.0046);
  // water volume (origin at the tank floor)
  const wh = TH - 0.04, wx = TW / 2 - 0.006, wz = TD / 2 - 0.006;
  const wmat = volumeMat({ shape: 'box', min: [-wx, 0, -wz], max: [wx, wh, wz], tint: 0x3a9a8c, deep: 0x0b4446, glow: 0x0a2a26, density: 2.4, a0: 0.04, a1: 0.5, rough: 0.3, env: 0.3 });
  const water = k.mesh(wmat, fromBuffer(new THREE.BoxGeometry(wx * 2, wh, wz * 2).translate(0, wh / 2, 0)), 0, ty, 0, { name: 'water', shadow: false, ao: false });
  water.renderOrder = 2;
  linkTick(water, fluidTick);
  // gravel bed (sloped to the back) + front cut face
  const gb = gridGeo(TW - 0.016, TD - 0.016, 30, 12, (x, z) => 0.035 + (-z / TD + 0.5) * 0.035 + Math.sin(x * 9) * 0.006 + Math.cos(x * 23 + z * 17) * 0.004);
  gb.uvMap(4, 4);
  const gf = new Geo();
  for (let i = 0; i <= 30; i++) {
    const x = -(TW - 0.016) / 2 + (i / 30) * (TW - 0.016), z = (TD - 0.016) / 2;
    const yt = 0.035 + (-z / TD + 0.5) * 0.035 + Math.sin(x * 9) * 0.006 + Math.cos(x * 23 + z * 17) * 0.004;
    gf.v(x, 0.004, z, 0, 0, 1, x * 4, 0, 0); gf.v(x, yt, z, 0, 0, 1, x * 4, yt * 4, 0);
    if (i) gf.quad(i * 2 - 2, i * 2, i * 2 + 1, i * 2 - 1);
  }
  const gmesh = k.mesh(gravelMat(), gb.append(gf), 0, ty, 0, { name: 'gravel', ao: false });
  linkTick(gmesh, fluidTick);
  // resin castle, rocks, driftwood
  const ST = { tint: 0xa49c8c, rough: 1.1 };
  k.push(-0.3, ty + 0.045, -0.06, [0, 0.3, 0]);
  k.box('concrete', 0.16, 0.08, 0.1, 0, 0.04, 0, { ...ST, r: 0.004, dent: 0.002, div: 0.04 });
  for (const sx of [-1, 1]) {
    k.cyl('concrete', 0.035, 0.16, sx * 0.075, 0.08, 0, { ...ST, seg: 14, bev: 0.003 });
    k.cyl('concrete', 0.042, 0.02, sx * 0.075, 0.17, 0, { ...ST, seg: 14, bev: 0.003 });
    if (sx > 0) for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.box('concrete', 0.014, 0.018, 0.014, sx * 0.075 + Math.cos(a) * 0.035, 0.188, Math.sin(a) * 0.035, { ...ST, r: 0.002, rot: [0, -a, 0] }); }
    if (sx < 0) k.cyl('#9a2a1a:s', 0.001, 0.08, sx * 0.075, 0.22, 0, { seg: 14, r2: 0.047 });
  }
  for (let i = 0; i < 4; i++) k.box('concrete', 0.02, 0.02, 0.1, -0.045 + i * 0.03, 0.09, 0, { ...ST, r: 0.003 });
  k.box('#0a0a0a', 0.04, 0.05, 0.004, 0, 0.025, 0.051, { r: 0 });
  k.pop();
  for (let i = 0; i < 6; i++) {
    const s = r.range(0.025, 0.055), ys = r.range(0.5, 0.8);
    const g = new Geo().append(fromBuffer(new THREE.IcosahedronGeometry(s, 1))).deform((p) => { p.x *= 1 + Math.sin(p.y * 40 + i) * 0.15; p.y *= ys; });
    k.put('concrete', g, r.range(-0.52, 0.52), ty + 0.045, r.range(-0.18, 0.08), { tint: [0x8a8478, 0x6e6a62, 0xa49c8c][i % 3], rough: 1.2, rot: [0, r.next() * 3, 0] });
  }
  k.tube('wood', [[0.15, ty + 0.05, -0.15], [0.25, ty + 0.1, -0.1], [0.32, ty + 0.2, -0.12], [0.36, ty + 0.27, -0.08]], 0.018, { tint: 0x4a3424, rough: 1.2, radial: 7, caps: true });
  k.tube('wood', [[0.25, ty + 0.1, -0.1], [0.2, ty + 0.16, -0.04], [0.17, ty + 0.2, -0.03]], 0.008, { tint: 0x4a3424, rough: 1.2, radial: 6, caps: true });
  // plants: pivots at the base (rotation.z sways); two instanced leaf clusters (tall / short)
  const leaf = A.add(48, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#9a9a9a'); g.addColorStop(0.5, '#f4f4f4'); g.addColorStop(1, '#9a9a9a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, h); c.lineTo(w / 2, 0); c.stroke();
    c.strokeStyle = 'rgba(60,60,60,0.35)'; c.lineWidth = 1;
    for (let y = 8; y < h; y += 9) { c.beginPath(); c.moveTo(w / 2, y + 6); c.lineTo(2, y); c.moveTo(w / 2, y + 6); c.lineTo(w - 2, y); c.stroke(); }
  }, 'g');
  const spots = [[-0.48, -0.16], [-0.38, -0.18], [-0.12, -0.19], [0.05, -0.17], [0.42, -0.17], [0.5, -0.05], [-0.52, 0.05], [0.2, -0.2]];
  const tallIdx = spots.map((_, i) => i).filter((i) => i % 3 !== 1), shortIdx = spots.map((_, i) => i).filter((i) => i % 3 === 1);
  const col = (i) => (i === 4 ? 0x9a3a2a : i % 2 ? 0x5aa03a : 0x2f7a32);
  const plants = [];
  for (const [idx, tall] of [[tallIdx, true], [shortIdx, false]]) {
    const pr = k.instanced(tall ? 'plantsTall' : 'plantsShort', k.mats.atlas, plantGeo(r, tall, leaf), idx.map((i) => [spots[i][0], ty + 0.05, spots[i][1]]), { atlasUV: true, colors: idx.map(col), uvOff: false });
    pr.forEach((p, j) => { p.name = 'plant_' + idx[j]; plants[idx[j]] = p; });
  }
  k.parts.plants = plants;
  // air stone + bubbler + airline up to the pump
  k.cyl('#9aa0a8:r', 0.022, 0.025, 0.28, ty + 0.06, -0.15, { seg: 14, bev: 0.004 });
  const bubbler = k.grp(0.28, ty + 0.075, -0.15, { name: 'bubbler' });
  P.cable(k, [[0.28, ty + 0.07, -0.16], [0.3, ty + 0.25, -0.22], [0.31, ty + 0.48, -0.235], [0.33, ty + 0.53, -0.25], [0.36, ty + 0.5, -0.29], [0.4, SH + 0.03, -SD / 2 + 0.06]], 0.003, { tint: 0x9ac8c0, gloss: true, radial: 5 });
  // heater with indicator + suction cups
  k.cyl('#9fb8b8:g', 0.011, 0.24, 0.52, ty + 0.25, -TD / 2 + 0.03, { seg: 10, bev: 0.005 });
  k.cyl('#202224:p', 0.013, 0.05, 0.52, ty + TH - 0.06, -TD / 2 + 0.03, { seg: 10, bev: 0.003 });
  k.sph('#ff7a1a:e', 0.004, 0.52, ty + TH - 0.09, -TD / 2 + 0.042, { ws: 8, hs: 6 });
  for (const y of [0.13, 0.33]) k.cyl('#d8e0e0:g', 0.009, 0.006, 0.52, ty + y, -TD / 2 + 0.017, { axis: 'z', seg: 10 });
  // hang-on-back filter
  const FM = { tint: 0x202224 };
  k.box('plastic', 0.2, 0.18, 0.09, -0.35, ty + TH - 0.06, -TD / 2 - 0.05, { ...FM, r: 0.012 });
  k.box('plastic', 0.18, 0.02, 0.07, -0.35, ty + TH + 0.025, -TD / 2 - 0.0, { ...FM, r: 0.006 });
  k.box('plastic', 0.14, 0.012, 0.04, -0.35, ty + TH - 0.02, -TD / 2 + 0.025, { ...FM, r: 0.003 });
  k.cyl('#9fc0c0:g', 0.012, 0.36, -0.39, ty + TH - 0.2, -TD / 2 + 0.03, { seg: 10 });
  k.cyl('plastic', 0.018, 0.05, -0.39, ty + 0.07, -TD / 2 + 0.03, { ...FM, seg: 10, bev: 0.003 });
  // hood with feeding lid + light strip
  k.box('plastic', TW + 0.02, 0.06, TD + 0.02, 0, ty + TH + 0.04, 0, { tint: 0x18191b, rough: 0.6, r: 0.012 });
  k.box('plastic', 0.3, 0.004, 0.16, 0.25, ty + TH + 0.071, 0.06, { tint: 0x262729, r: 0.002 });
  k.box('#c4c7ca:c', 0.04, 0.008, 0.01, 0.25, ty + TH + 0.073, 0.135, { r: 0.002 });
  const lm = emissiveMat(0xdff6ff, 0xcfeeff, 1.3, { name: 'aq_light' });
  const light = k.mesh(lm, boxGeo(TW - 0.12, 0.008, 0.04, { r: 0.002 }), 0, ty + TH + 0.006, 0.05, { name: 'light', shadow: false, ao: false });
  const hl = k.reg('aq_hood', 160, 26, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. AQUATICS', w / 2, h / 2, h * 0.6, { col: '#bbb', f: 'bold' }); });
  k.label(hl, 0.16, 0.026, 0, ty + TH + 0.04, TD / 2 + 0.0114);
  // thermometer sticker on the front glass
  const th = k.reg('aq_therm', 28, 140, (c, w, h) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { c.fillStyle = i === 4 ? '#3f6' : '#235'; c.fillRect(4, 8 + i * 15, w - 8, 12); txt(c, String(20 + i * 2), w / 2, 14 + i * 15, 9, { col: i === 4 ? '#000' : '#79a', f: 'mono' }); }
  }, { e: 0.15, r: 0.3, m: 0 });
  k.label(th, 0.022, 0.11, 0.52, ty + 0.3, TD / 2 + 0.0046);
  // colliders / anchors
  k.collide(cbox(SW, SH, SD, 0, SH / 2, 0));
  k.collide(cbox(TW + 0.02, TH + 0.1, TD + 0.02, 0, ty + (TH + 0.1) / 2 - 0.01, 0));
  k.anchors.tankMin = V3(-wx + 0.03, ty + 0.1, -wz + 0.03);
  k.anchors.tankMax = V3(wx - 0.03, ty + wh - 0.03, wz - 0.03);
  k.anchors.surface = V3(0, ty + wh, 0);
  k.parts.water = water;
  k.parts.bubbler = bubbler;
  k.parts.light = light;
  return k.done({ mass: 320, material: 'glass' });
}

// ---------------------------------------------------------------------------
// DART BOARD cabinet (wall; origin = back centre): oak cabinet with felt surround, sisal board with
// wire spider, doors swung open showing chalk scoreboards (parts.doors / doorLeft / doorRight pivots)
// anchors.center + params.faceZ / boardRadius drive the game's scoring (scoreDart in models_devices.js)
// ---------------------------------------------------------------------------
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
let _dartMat = null;
function dartFaceMat() {
  if (_dartMat) return _dartMat;
  const S = 1024, R = 0.225, px = S / 2 / R;
  const tex = canvasTex(S, S, (c) => {
    const cx = S / 2, cy = S / 2;
    c.fillStyle = '#121110'; c.beginPath(); c.arc(cx, cy, S / 2, 0, TAU); c.fill();
    const sector = (r0, r1, a0, a1, col) => { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r1 * px, a0, a1); c.arc(cx, cy, r0 * px, a1, a0, true); c.closePath(); c.fill(); };
    for (let i = 0; i < 20; i++) {
      const a = (i * 18 - 90) * DEG, a0 = a - 9 * DEG, a1 = a + 9 * DEG;
      const single = i % 2 ? '#c9b98f' : '#141312', ring = i % 2 ? '#1a6a34' : '#a82018';
      sector(0.162, 0.17, a0, a1, ring); sector(0.107, 0.162, a0, a1, single); sector(0.099, 0.107, a0, a1, ring); sector(0.0159, 0.099, a0, a1, single);
    }
    c.fillStyle = '#1d7a3c'; c.beginPath(); c.arc(cx, cy, 0.0159 * px, 0, TAU); c.fill();
    c.fillStyle = '#c4261c'; c.beginPath(); c.arc(cx, cy, 0.00635 * px, 0, TAU); c.fill();
    const r = new RNG(77);
    for (let i = 0; i < 26000; i++) {
      const x = r.next() * S, y = r.next() * S, ang = r.next() * TAU, l = r.range(1, 4);
      c.strokeStyle = r.next() < 0.5 ? `rgba(255,240,210,${r.range(0.03, 0.12)})` : `rgba(0,0,0,${r.range(0.05, 0.18)})`;
      c.lineWidth = r.range(0.5, 1.4);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); c.stroke();
    }
    // dart holes (mostly around T20, D20 and the bull) + worn treble-20 fibres
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 300; i++) {
      const pick = r.next();
      let rr, aa;
      if (pick < 0.4) { rr = r.range(0.095, 0.112); aa = -HP + r.range(-0.18, 0.18); } else if (pick < 0.6) { rr = r.range(0, 0.03); aa = r.next() * TAU; } else { rr = r.range(0.02, 0.17); aa = r.next() * TAU; }
      c.beginPath(); c.arc(cx + Math.cos(aa) * rr * px, cy + Math.sin(aa) * rr * px, r.range(0.8, 1.6), 0, TAU); c.fill();
    }
    const wg = c.createRadialGradient(cx, cy - 0.103 * px, 2, cx, cy - 0.103 * px, 0.03 * px);
    wg.addColorStop(0, 'rgba(230,215,180,0.35)'); wg.addColorStop(1, 'rgba(230,215,180,0)');
    c.fillStyle = wg; c.fillRect(cx - 0.04 * px, cy - 0.14 * px, 0.08 * px, 0.08 * px);
    ORDER.forEach((n, i) => { const a = (i * 18 - 90) * DEG; txt(c, String(n), cx + Math.cos(a) * 0.196 * px, cy + Math.sin(a) * 0.196 * px, 0.024 * px, { col: '#f2efe6', f: 'bold', w: 'bold' }); });
    const g = c.createRadialGradient(cx, cy, S * 0.3, cx, cy, S * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
  });
  _dartMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  _dartMat.name = 'dart_face';
  return _dartMat;
}
export function b_dart_board(o) {
  void o;
  const k = new DKit('dart_board', { ground: 'wall', wear: { chip: 0.12, rust: 0.05, grime: 0.4, dust: 0.45 } });
  k.atlas(512, 1024);
  const OAK = { tint: 0x7a4a2c, rough: 0.8 };
  const CW = 0.62, CH = 0.66, CD = 0.1, R = 0.225, BT = 0.038;
  // cabinet: back, felt surround, sides / top / bottom, crown
  k.box('wood', CW, CH, 0.015, 0, 0, 0.0075, { ...OAK, r: 0.002 });
  const felt = k.reg('db_felt', 128, 128, (c, w, h, rng) => {
    c.fillStyle = '#1c1d1f'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) { c.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'; c.fillRect(rng.next() * w, rng.next() * h, 1, 1 + rng.next() * 2); }
    // missed-dart holes in the surround
    for (let i = 0; i < 60; i++) { const a = rng.next() * TAU, rr = w * (0.4 + rng.next() * 0.1); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr, 1.5, 1.5); }
  }, 'r');
  k.label(felt, CW - 0.04, CH - 0.04, 0, 0, 0.0152);
  for (const sx of [-1, 1]) k.box('wood', 0.02, CH, CD, sx * (CW / 2 - 0.01), 0, CD / 2, { ...OAK, r: 0.004 });
  for (const sy of [-1, 1]) k.box('wood', CW, 0.02, CD, 0, sy * (CH / 2 - 0.01), CD / 2, { ...OAK, r: 0.004 });
  k.box('wood', CW + 0.02, 0.025, CD + 0.02, 0, CH / 2 + 0.0125, CD / 2, { ...OAK, r: 0.006 });
  k.box('wood', CW + 0.01, 0.012, CD + 0.012, 0, CH / 2 + 0.031, CD / 2, { ...OAK, r: 0.005 });
  const plate = k.reg('db_plate', 200, 40, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f0d488'); g.addColorStop(1, '#9a7a32');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    txt(c, 'R.O.O.M. RECREATION DEPT.', w / 2, h / 2, h * 0.42, { col: '#3a2808', f: 'serif', maxW: w * 0.92 });
  }, 'm');
  k.box('metal', 0.204, 0.044, 0.002, 0, CH / 2 - 0.045, 0.016, { ...FIN.brass, r: 0.0008 });
  k.label(plate, 0.2, 0.04, 0, CH / 2 - 0.045, 0.0176);
  // chalk ledge with chalk + eraser
  k.box('wood', 0.3, 0.012, 0.035, 0, -CH / 2 + 0.035, 0.0325, { ...OAK, r: 0.003 });
  k.cyl('#efece2:r', 0.004, 0.05, -0.06, -CH / 2 + 0.045, 0.035, { axis: 'x', seg: 8 });
  k.box('#5a3a20:r', 0.05, 0.016, 0.02, 0.07, -CH / 2 + 0.049, 0.035, { r: 0.003 });
  // board: moulded rim, bracket, sisal face, wire spider
  const bz = 0.019, zf = bz + BT;
  k.cyl('plastic', R, BT, 0, 0, bz + BT / 2, { tint: 0x121212, rough: 1.1, axis: 'z', seg: 72, bev: 0.004, bevSeg: 2 });
  k.cyl('metal', 0.03, 0.012, 0, 0, bz - 0.002, { ...FIN.black, axis: 'z', seg: 16 });
  k.mesh(dartFaceMat(), discGeo(R - 0.001, 72, { u0: 0, u1: 1, v0: 0, v1: 1 }), 0, 0, zf + 0.0002, { name: 'face', ao: false });
  const WI = { ...FIN.chrome, tint: 0xb8bcc0, rough: 0.45, rust: 0 };
  for (const rr of [0.00635, 0.0159, 0.099, 0.107, 0.162, 0.17]) k.tor('metal', rr, 0.0006, 0, 0, zf + 0.0006, { ...WI, rs: 3, ts: rr < 0.02 ? 16 : 72 });
  for (let i = 0; i < 20; i++) {
    const a = (90 - i * 18 + 9) * DEG, r0 = 0.0159, r1 = 0.17;
    k.box('metal', r1 - r0, 0.0011, 0.0011, Math.cos(a) * (r0 + r1) / 2, Math.sin(a) * (r0 + r1) / 2, zf + 0.0006, { ...WI, rot: [0, 0, a], r: 0 });
  }
  k.tor('metal', 0.212, 0.0008, 0, 0, zf + 0.0006, { ...WI, rs: 3, ts: 72 });
  // doors swung open (static geometry; pivots kept)
  const chalk = k.reg('db_chalk', 150, 330, (c, w, h, rng) => {
    c.fillStyle = '#1e2a24'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 30; i++) c.fillRect(rng.next() * w, rng.next() * h, 30, 4);
    c.strokeStyle = 'rgba(240,240,230,0.8)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(w / 2, 40); c.lineTo(w / 2, h - 20); c.moveTo(10, 40); c.lineTo(w - 10, 40); c.stroke();
    txt(c, 'CLONE A', w * 0.27, 24, 15, { col: '#eee', f: 'mono' }); txt(c, 'CLONE B', w * 0.74, 24, 15, { col: '#eee', f: 'mono' });
    const a = ['501', '441', '380', '301', '245', '180', '121'], b = ['501', '461', '401', '357', '297', '☠'];
    a.forEach((s, i) => txt(c, s, w * 0.27, 62 + i * 30, 17, { col: i < a.length - 1 ? 'rgba(230,230,220,0.55)' : '#f4f4ea', f: 'mono' }));
    b.forEach((s, i) => txt(c, s, w * 0.74, 62 + i * 30, 17, { col: i < b.length - 1 ? 'rgba(230,230,220,0.55)' : '#f4f4ea', f: 'mono' }));
  }, 'r');
  const DW = CW / 2;
  k.parts.doors = [];
  for (const sx of [-1, 1]) {
    const hinge = k.grp(sx * CW / 2, 0, CD, { name: sx < 0 ? 'doorLeft' : 'doorRight' });
    hinge.rotation.y = sx * 165 * DEG;
    k.insideStatic(hinge, () => {
      k.box('wood', DW, CH, 0.018, -sx * DW / 2, 0, 0.009, { ...OAK, r: 0.004 });
      k.ext('wood', rrShape(DW - 0.05, CH - 0.06, 0.006), 0.006, -sx * DW / 2, 0, 0.018, { tint: 0x5e3820, rough: 0.8, bev: 0.003, bevSeg: 1, curveSeg: 2 });
      k.label(chalk, DW - 0.04, CH - 0.05, -sx * DW / 2, 0, -0.0006, { rot: [0, PI, 0] });
      k.sph('metal', 0.008, -sx * (DW - 0.03), 0, 0.026, { ...FIN.brass, ws: 10, hs: 8 });
      for (const y of [-0.22, 0.22]) k.cyl('metal', 0.005, 0.05, 0, y, 0.0, { ...FIN.brass, seg: 8 });
    });
    k.parts.doors.push(hinge);
  }
  k.parts.doorLeft = k.parts.doors[0];
  k.parts.doorRight = k.parts.doors[1];
  k.collide(cbox(CW, CH, 0.02, 0, 0, 0.01));
  k.collide(ccyl(R, BT, 0, 0, bz + BT / 2, [HP, 0, 0]));
  for (const sx of [-1, 1]) k.collide(cbox(0.02, CH, CD, sx * (CW / 2 - 0.01), 0, CD / 2));
  k.anchors.center = V3(0, 0, zf);
  k.params.boardRadius = R;
  k.params.faceZ = zf;
  return k.done({ mass: 7, material: 'wood' });
}

// ---------------------------------------------------------------------------
// FRIDGE: top-freezer, door hinged on the right edge (parts.door, + rotation.y opens), static freezer
// door pivot, glass shelves (anchors.shelves), contents, interior light (parts.light own emissive)
// ---------------------------------------------------------------------------
export function b_fridge(o) {
  void o;
  const k = new DKit('fridge', { wear: { chip: 0.1, rust: 0.08, grime: 0.45, dust: 0.4 }, ao: { res: 56 } });
  const A = k.atlas(512, 1024);
  const W = 0.65, H = 1.75, D = 0.68, t = 0.03;
  const SH = { tint: 0xbdb7a5 };
  const LIN = { tint: 0xc4c4bc, rough: 0.7 };
  const z0 = D / 2 - 0.05;
  k.box('#141416:p', W - 0.04, 0.06, D - 0.1, 0, 0.03, -0.03, { r: 0.004 });
  P.louvre(k, 0, 0.034, z0 + 0.002, W - 0.12, 0.045, 3, { mo: { tint: 0x222222 }, raised: false, depth: 0.01, frame: false });
  for (const sx of [-1, 1]) k.box('paint', t, H - 0.06, D - 0.05, sx * (W / 2 - t / 2), 0.06 + (H - 0.06) / 2, -0.025, { ...SH, r: 0.006, div: 0.3, dent: 0.001 });
  k.box('paint', W, t, D - 0.05, 0, H - t / 2, -0.025, { ...SH, r: 0.006 });
  k.box('paint', W, t, D - 0.05, 0, 0.06 + t / 2, -0.025, { ...SH, r: 0.003 });
  k.box('paint', W, H - 0.06, t, 0, 0.06 + (H - 0.06) / 2, -D / 2 + t / 2, { ...SH, r: 0.003 });
  // liner, divider, glass shelves with trim, crisper
  k.box('plastic', W - 2 * t, 1.12, 0.005, 0, 0.66, -D / 2 + t + 0.003, { ...LIN, r: 0 });
  k.box('paint', W - 2 * t, 0.04, D - 0.1, 0, 1.24, -0.04, { ...SH, r: 0.004 });
  for (const y of [0.45, 0.78, 1.02]) {
    k.box('glass', W - 2 * t - 0.01, 0.006, D - 0.14, 0, y, -0.06, { r: 0 });
    k.box('plastic', W - 2 * t - 0.01, 0.014, 0.012, 0, y, -0.06 + (D - 0.14) / 2, { ...LIN, r: 0.002 });
    for (const sx of [-1, 1]) k.box('plastic', 0.008, 0.008, D - 0.16, sx * (W / 2 - t - 0.004), y - 0.008, -0.06, { ...LIN, r: 0 });
  }
  k.box('plastic', W - 2 * t - 0.02, 0.15, D - 0.16, 0, 0.17, -0.06, { tint: 0xa8b0b0, rough: 0.5, r: 0.01 });
  k.box('#2f6a2a:s', 0.05, 0.05, 0.05, -0.12, 0.2, 0.02, { r: 0.02 });
  k.sph('#c8301e:s', 0.035, 0.08, 0.2, 0.0, { ws: 10, hs: 8 });
  // contents: milk, butter, takeout, cans, mystery jar (glows)
  const milk = k.reg('fr_milk', 64, 128, (c, w, h) => { c.fillStyle = '#f0ece2'; c.fillRect(0, 0, w, h); c.fillStyle = '#2a5fc0'; c.fillRect(0, h * 0.35, w, h * 0.3); txt(c, 'MILK', w / 2, h * 0.5, h * 0.14, { col: '#fff' }); txt(c, 'EXP 03/97', w / 2, h * 0.8, h * 0.07, { col: '#555', f: 'mono' }); grime(c, w, h, 0.5, 4); });
  k.labelBox({ pz: milk, nz: milk, px: milk, nx: milk, side: milk }, 0.075, 0.2, 0.075, -0.18, 0.555, -0.12);
  k.box('#2a5fc0:s', 0.04, 0.04, 0.04, -0.18, 0.675, -0.12, { r: 0.004, rot: [0, 0, PI / 4] });
  k.box('#c8b898:r', 0.16, 0.08, 0.13, 0.08, 0.5, -0.05, { r: 0.006 });
  k.box('#e8e2d0:r', 0.12, 0.05, 0.1, 0.08, 0.565, -0.06, { r: 0.004, rot: [0, 0.3, 0] });
  k.cyl('glass', 0.05, 0.12, -0.05, 0.84, -0.18, { seg: 16 });
  k.cyl('#5aff5a:e', 0.044, 0.08, -0.05, 0.825, -0.18, { seg: 16 });
  k.cyl('#d8d2c2:s', 0.052, 0.02, -0.05, 0.91, -0.18, { seg: 16, bev: 0.003 });
  for (let i = 0; i < 4; i++) {
    const cx = 0.1 + (i % 2) * 0.07, cz = -0.15 + Math.floor(i / 2) * 0.08;
    k.cyl('#b3221a:m', 0.033, 0.12, cx, 1.08, cz, { seg: 14, bev: 0.004 });
    k.cyl('#c4c7ca:c', 0.028, 0.004, cx, 1.141, cz, { seg: 14 });
  }
  k.box('#9a7a52:r', 0.2, 0.22, 0.12, -0.12, 1.13, -0.08, { r: 0.02 });
  const lm = emissiveMat(0xffffff, 0xfff4dc, 1.0, { name: 'fridge_light' });
  const light = k.mesh(lm, boxGeo(0.12, 0.012, 0.04, { r: 0.004 }), 0, 1.214, -0.15, { name: 'light', shadow: false, ao: false });
  // doors: skin, liner with door shelves, magnetic gasket, chrome handle
  const door = (name, y0, h, stat) => {
    const g = k.grp(W / 2, 0, z0, { name });
    k.within(g, () => {
      const cx = -W / 2;
      k.box('paint', W, h, 0.05, cx, y0 + h / 2, 0.025, { ...SH, r: 0.02, div: 0.3, dent: 0.0008 });
      k.box('plastic', W - 0.08, h - 0.08, 0.02, cx, y0 + h / 2, -0.01, { ...LIN, r: 0.01 });
      k.tube('#141414:r', [[cx - W / 2 + 0.012, y0 + 0.012, -0.001], [cx + W / 2 - 0.012, y0 + 0.012, -0.001], [cx + W / 2 - 0.012, y0 + h - 0.012, -0.001], [cx - W / 2 + 0.012, y0 + h - 0.012, -0.001]], 0.006, { round: 0.02, closed: true, radial: 5 });
      const hh = Math.min(0.4, h * 0.6);
      k.box('#c4c7ca:c', 0.025, hh, 0.03, -W + 0.04, y0 + h / 2, 0.065, { r: 0.008 });
      for (const sy of [-1, 1]) k.box('#c4c7ca:c', 0.025, 0.025, 0.04, -W + 0.04, y0 + h / 2 + sy * Math.min(0.18, h * 0.28), 0.045, { r: 0.006 });
      if (h > 0.8) {
        for (const y of [y0 + 0.25, y0 + 0.6, y0 + 0.9]) {
          k.box('plastic', W - 0.12, 0.012, 0.08, cx, y - 0.025, -0.05, { ...LIN, r: 0.002 });
          k.box('plastic', W - 0.12, 0.05, 0.006, cx, y, -0.087, { ...LIN, r: 0.002 });
        }
        // condiments in the door shelves
        k.cyl('#d8341c:s', 0.022, 0.12, cx - 0.15, y0 + 0.29, -0.05, { seg: 12, bev: 0.006 });
        k.cyl('#e8c41a:s', 0.022, 0.11, cx - 0.09, y0 + 0.285, -0.05, { seg: 12, bev: 0.006 });
        k.cyl('#3a6a2a:g', 0.03, 0.22, cx + 0.12, y0 + 0.335, -0.05, { seg: 12, bev: 0.01 });
      }
    }, stat);
    return g;
  };
  const main = door('door', 0.08, 1.15, false);
  const frz = door('freezerDoor', 1.25, 0.48, true);
  const notes = [
    ['WHO TOOK MY\nYOGURT??', '#f7e36a', -0.12, 0.92, -0.06],
    ['CLEAN OUT\nFRIDAY.\n-HR', '#f2a6c0', -0.38, 0.85, 0.08],
    ['LABEL YOUR\nFOOD OR IT\nBECOMES\nCOMPANY\nPROPERTY', '#e8e4d8', -0.3, 0.55, -0.04],
    ['DO NOT EAT\nTHE GREEN\nJAR', '#a8e0a0', -0.14, 0.38, 0.1],
  ];
  const mags = ['#c8231b:s', '#2a5fc0:s', '#e8c41a:s', '#2f8a3a:s'];
  k.inside(main, () => {
    notes.forEach(([s, col, x, y, rr], i) => {
      const reg = A.add(120, 120, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); const L = s.split('\n'); L.forEach((l, j) => txt(c, l, w / 2, h * (0.5 + (j - (L.length - 1) / 2) * 0.17), h * 0.13, { col: '#1a1a6a', f: 'mono', maxW: w * 0.9 })); grime(c, w, h, 0.4, i + 2); });
      k.label(reg, 0.11, 0.11, x, y, 0.0506 + i * 0.0002, { rot: [0, 0, rr] });
      k.cyl(mags[i], 0.013, 0.008, x, y + 0.05, 0.055 + i * 0.0002, { axis: 'z', seg: 12, bev: 0.002 });
    });
  });
  const brand = k.reg('fr_brand', 200, 40, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. FROST-KING', w / 2, h / 2, h * 0.55, { col: '#6a6458', f: 'serif', i: true }); }, 'm');
  k.insideStatic(frz, () => k.label(brand, 0.24, 0.048, -W / 2, 1.62, 0.0506));
  k.collide(cbox(W, H, D, 0, H / 2, 0));
  k.parts.door = main;
  k.parts.freezerDoor = frz;
  k.parts.light = light;
  k.params.doorOpenSign = 1;
  k.params.doorCollider = cbox(W, 1.15, 0.05, -W / 2, 0.08 + 0.575, 0.025);
  k.anchors.inside = V3(0, 0.5, -0.05);
  k.anchors.shelves = [0.45, 0.78, 1.02].map((y) => V3(0, y + 0.004, -0.06));
  return k.done({ mass: 75, material: 'metal' });
}
