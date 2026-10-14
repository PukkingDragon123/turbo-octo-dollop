// Cloning laboratory: GENESIS-9 growth vat, clone control console, portable cloning pad.
// Origin on the floor under the centre, front +Z.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, cframe, ccyl, frameShape, rrShape, Geo, boxGeo, cylGeo, latheGeo, discGeo, ringGeo, fromBuffer, lerp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, drawLogo, drawPerforation, hazardTri } from './atlas.js';
import { CLEAR, TINTED } from './mats.js';
import { volumeMat, fluidTick } from './fluids.js';
import { linkTick } from './sync.js';

// seamless diagonal hazard stripes (wraps a full cylinder: width is a multiple of the period)
const hazardBand = (k) => k.reg('haz_band', 512, 32, (c, w, h) => {
  c.fillStyle = '#d8a21a'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a1917';
  for (let x = -h; x < w + h; x += 32) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 16, h); c.lineTo(x + 16 + h, 0); c.lineTo(x + h, 0); c.closePath(); c.fill(); }
  grime(c, w, h, 0.6, 5, { edges: false }); rubOff(c, w, h, 0.4, 9);
}, 'p');
// rounded pipe run through corner points
const pipe = (k, slot, pts, r, mo, bend = 0.1) => k.tube(slot, pts, r, { ...mo, round: bend, rseg: 6, radial: 12, caps: true });

// ---------------------------------------------------------------------------
// GROWTH VAT: iron plinth with hazard band, glass cylinder (front + back faces), swirling volume
// fluid (parts.fluid), cap with motor + pipes, status screen (screens.label) + lamps (parts.lamps)
// anchors.specimen / fluidTop, parts.bubbleOrigin, parts.glass, parts.ringLight
// ---------------------------------------------------------------------------
export function b_clone_tube(o) {
  void o;
  const k = new DKit('clone_tube', { wear: { chip: 0.2, rust: 0.18, grime: 0.55, dust: 0.4 }, ao: { res: 56 } });
  const A = k.atlas(1024, 1024);
  const IRON = { tint: 0x3b4046 };
  const COP = { ...FIN.copper, tint: 0x9a6a4a, rough: 1.2, rust: 0.25 };
  const GR = 0.45, gy0 = 0.36, gy1 = 1.92;
  const haz = hazardBand(k);
  // ---- plinth ----
  k.lathe('paint', [[0.0001, 0.0], [0.63, 0.0, 1], [0.64, 0.015, 2], [0.64, 0.05, 2], [0.61, 0.07], [0.6, 0.27, 2], [0.56, 0.31], [0.52, 0.33, 2], [0.52, gy0], [0.0001, gy0]], 0, 0, 0, { ...IRON, seg: 48 });
  k.clabel(haz, 0.6045, 0.1, TAU, 0, 0.17, 0, { seg: 48 });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; P.screw(k, Math.sin(a) * 0.54, 0.3305, Math.cos(a) * 0.54, { kind: 'hex', r: 0.011, dir: 'y', rust: 0.5 }); }
  k.tor('metal', 0.47, 0.018, 0, gy0 + 0.005, 0, { ...FIN.steel, axis: 'y', ts: 48, rs: 6 });
  // vat floor: nutrient inlet + emitter ring
  k.cyl('metal', 0.3, 0.006, 0, gy0 + 0.003, 0, { ...FIN.iron, seg: 32, bev: 0.002 });
  const inlet = k.reg('ct_inlet', 128, 128, (c, w, h) => drawPerforation(c, w, h, 10, 3, '#2a2e33', '#050607'), 'm');
  k.dlabel(inlet, 0.28, 0, gy0 + 0.0065, 0, { rot: [-HP, 0, 0], seg: 32 });
  k.tor('#2aff6a:e', 0.4, 0.012, 0, gy0 + 0.012, 0, { axis: 'y', ts: 48, rs: 6 });
  const ringLight = k.grp(0, gy0 + 0.012, 0, { name: 'ringLight' });
  // ---- glass (front faces additive over back faces) ----
  const glass = k.mesh(CLEAR({ env: 1.5, rough: 0.04, tint: 0x010302 }), cylGeo(GR, gy1 - gy0, { seg: 48, open: true }), 0, (gy0 + gy1) / 2, 0, { name: 'glass', shadow: false, ao: false });
  glass.renderOrder = 3;
  const gback = k.mesh(CLEAR({ env: 0.8, rough: 0.04, side: THREE.BackSide }), cylGeo(GR, gy1 - gy0, { seg: 48, open: true }), 0, 0, 0, { name: 'glass_back', shadow: false, ao: false, to: glass });
  gback.renderOrder = 1;
  // ---- fluid (origin at its bottom so scale.y drains it) ----
  const fh = 1.48, fy = gy0 + 0.02;
  const fluid = k.mesh(volumeMat({ shape: 'cyl', min: [0, 0, 0], max: [0, fh, 0], radius: GR - 0.01, tint: 0x0b4a1e, deep: 0x02240c, glow: new THREE.Color(0.12, 1.25, 0.38), density: 2.2, a0: 0.3, a1: 0.72, swirl: true, rough: 0.35, env: 0.25 }),
    fromBuffer(new THREE.CylinderGeometry(GR - 0.01, GR - 0.01, fh, 40, 1).translate(0, fh / 2, 0)), 0, fy, 0, { name: 'fluid', shadow: false, ao: false });
  fluid.renderOrder = 2;
  linkTick(fluid, fluidTick);
  // ---- ribs + clamps ----
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2, x = Math.sin(a) * (GR + 0.035), z = Math.cos(a) * (GR + 0.035);
    k.box('metal', 0.04, gy1 - gy0 + 0.06, 0.03, x, (gy0 + gy1) / 2, z, { ...FIN.steel, rot: [0, a, 0], r: 0.006 });
    for (const y of [gy0 + 0.25, (gy0 + gy1) / 2, gy1 - 0.25]) {
      k.box('paint', 0.07, 0.05, 0.05, x, y, z, { ...IRON, rot: [0, a, 0], r: 0.008 });
      k.push(x + Math.sin(a) * 0.026, y, z + Math.cos(a) * 0.026, [0, a, 0]);
      P.screw(k, 0, 0, 0, { kind: 'hex', r: 0.007 });
      k.pop();
    }
  }
  // ---- cap ----
  k.lathe('paint', [[0.52, gy1 - 0.02], [0.56, gy1, 2], [0.57, gy1 + 0.07, 2], [0.53, gy1 + 0.1], [0.44, gy1 + 0.18], [0.3, gy1 + 0.24], [0.16, gy1 + 0.27], [0.0001, gy1 + 0.28]], 0, 0, 0, { ...IRON, seg: 48 });
  k.tor('metal', 0.47, 0.018, 0, gy1 - 0.005, 0, { ...FIN.steel, axis: 'y', ts: 48, rs: 6 });
  k.disc('paint', 0.53, 0, gy1 - 0.019, 0, { ...IRON, seg: 40, rot: [HP, 0, 0] });
  k.clabel(haz, 0.5725, 0.05, TAU, 0, gy1 + 0.04, 0, { seg: 48 });
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; P.screw(k, Math.sin(a) * 0.5, gy1 + 0.132, Math.cos(a) * 0.5, { kind: 'hex', r: 0.009, dir: 'y', rust: 0.5 }); }
  k.box('paint', 0.3, 0.16, 0.24, 0, gy1 + 0.33, -0.05, { ...IRON, r: 0.02 });
  k.cyl('metal', 0.08, 0.2, 0.0, gy1 + 0.33, 0.12, { ...FIN.steel, axis: 'z', seg: 18, bev: 0.006 });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.box('metal', 0.006, 0.012, 0.16, Math.cos(a) * 0.082, gy1 + 0.33 + Math.sin(a) * 0.082, 0.12, { ...FIN.steel, rot: [0, 0, a], r: 0 }); }
  k.push(0, gy1 + 0.33, 0.071);
  P.slotVent(k, 0, 0, 0, 0.2, 0.1, 5, { mo: IRON });
  k.pop();
  // pipes out of the cap and down the back (with flanges)
  pipe(k, 'metal', [[0.2, gy1 + 0.2, -0.2], [0.2, gy1 + 0.55, -0.2], [0.2, gy1 + 0.55, -0.7], [0.2, 2.8, -0.7]], 0.045, COP);
  pipe(k, 'metal', [[-0.2, gy1 + 0.2, -0.2], [-0.2, gy1 + 0.45, -0.2], [-0.2, gy1 + 0.45, -0.65], [-0.2, 0.05, -0.65], [-0.2, 0.05, -0.4]], 0.035, COP);
  for (const [x, y, z, r] of [[0.2, gy1 + 0.4, -0.2, 0.065], [-0.2, gy1 + 0.35, -0.2, 0.055], [-0.2, 0.9, -0.65, 0.055]]) {
    k.cyl('metal', r, 0.03, x, y, z, { ...FIN.steel, seg: 14, bev: 0.004 });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; P.screw(k, x + Math.cos(a) * r * 0.8, y + 0.015, z + Math.sin(a) * r * 0.8, { kind: 'hex', r: 0.006, dir: 'y' }); }
  }
  // floor cables
  [0x1a1a1a, 0x7a1a14, 0x1a3a7a].forEach((c, i) => P.cable(k, [[-0.3 + i * 0.12, 0.2, -0.5], [-0.32 + i * 0.12, 0.08, -0.7], [-0.4 + i * 0.15, 0.015, -1.0], [-0.6 + i * 0.3, 0.015, -1.4]], 0.018, { tint: c, radial: 8 }));
  // ---- status console on the plinth front ----
  k.push(0, 0.2, 0.58, [-0.25, 0, 0]);
  k.box('paint', 0.3, 0.16, 0.12, 0, 0, -0.04, { ...IRON, r: 0.012 });
  k.box('#0e0e0e:p', 0.25, 0.11, 0.01, 0, 0.005, 0.02, { r: 0.006 });
  k.screen('label', 0.22, 0.09, 0, 0.005, 0.0255, { style: 'crt', text: 'SPECIMEN #0042\nGESTATION 87%\nSTATUS: DREAMING', bulge: 0.004 });
  const lampGeo = (x) => new Geo().append(latheGeo([[0.0001, 0], [0.0062, 0, 1], [0.006, 0.002], [0.0045, 0.004], [0.0001, 0.0045]], 12, { rings: false })).rotX(HP).translate(x, -0.062, 0.02);
  for (const x of [-0.1, 0, 0.1]) k.cyl('#c4c7ca:c', 0.009, 0.004, x, -0.062, 0.02, { axis: 'z', seg: 14 });
  k.pop();
  // lamps (parts.lamps, one glow draw): built in the console frame
  const cm = new THREE.Matrix4().makeRotationX(-0.25).setPosition(0, 0.2, 0.58);
  const lamps = k.glow('lamps', [[-0.1, 0x30ff60], [0, 0xffa020], [0.1, 0xff2a1a]].map(([x, col]) => ({ geo: lampGeo(x).applyMatrix(cm), color: col, intensity: 2.2 })));
  ['lamp_ok', 'lamp_busy', 'lamp_fail'].forEach((n, i) => { lamps[i].name = n; });
  const plate = k.reg('ct_plate', 300, 60, (c, w, h) => { c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, w, h); txt(c, 'GENESIS-9 GROWTH VAT', w / 2, h * 0.35, h * 0.3, { col: '#111' }); txt(c, 'R.O.O.M. BIOLOGICAL DIVISION', w / 2, h * 0.72, h * 0.18, { col: '#333', f: 'mono' }); grime(c, w, h, 0.5, 2); }, 'b');
  k.clabel(plate, 0.6006, 0.05, 0.5, 0, 0.245, 0, { a: PI * 0.32 });
  k.clabel(plate, 0.6006, 0.05, 0.5, 0, 0.245, 0, { a: -PI * 0.32 });
  P.streak(k, 0.25, 0.3, 0.595, 0.06, 0.2, { col: '30,90,40', alpha: 0.35 });
  const bub = k.grp(0, fy + 0.04, 0, { name: 'bubbleOrigin' });
  k.collide(ccyl(0.64, gy0, 0, gy0 / 2, 0));
  k.collide(ccyl(GR + 0.05, gy1 - gy0, 0, (gy0 + gy1) / 2, 0));
  k.collide(ccyl(0.57, 0.3, 0, gy1 + 0.13, 0));
  k.collide(cbox(0.3, 0.17, 0.39, 0, gy1 + 0.33, 0.025)); // pump motor housing on the cap
  k.collide(ccyl(0.05, gy1 + 0.4, -0.2, (gy1 + 0.4) / 2 + 0.02, -0.65)); // return pipe standing behind the vat
  k.anchors.specimen = V3(0, fy + fh * 0.5, 0);
  k.anchors.fluidTop = V3(0, fy + fh, 0);
  k.parts.fluid = fluid;
  k.parts.glass = glass;
  k.parts.bubbleOrigin = bub;
  k.parts.ringLight = ringLight;
  k.parts.lamps = lamps;
  k.params.fluidRadius = GR - 0.01;
  k.params.fluidHeight = fh;
  return k.done({ mass: 900, material: 'metal' });
}

// ---------------------------------------------------------------------------
// CLONE CONTROL CONSOLE: sloped desk, oscilloscope (screens.main), gauges (parts.needles), lamp row
// (parts.lamps), sliders / knobs / switches (static pivots), big red button (parts.button) with a
// flipped-up safety cover (parts.cover)
// ---------------------------------------------------------------------------
export function b_clone_console(o) {
  void o;
  const k = new DKit('clone_console', { wear: { chip: 0.18, rust: 0.08, grime: 0.5, dust: 0.45 }, ao: { res: 56 } });
  const A = k.atlas(1024, 1024);
  const SH = { tint: 0x9c9a8a }, PN = { tint: 0x3a3e42 };
  const W = 1.3;
  k.box('paint', W, 0.72, 0.62, 0, 0.4, -0.02, { ...SH, r: 0.01, div: 0.3, dent: 0.0008 });
  k.box('#141416:p', W - 0.06, 0.06, 0.56, 0, 0.03, -0.04, { r: 0 });
  for (const sx of [-1, 1]) { k.push(sx * 0.4, 0.4, 0.29); P.louvre(k, 0, 0, 0, 0.3, 0.25, 7, { mo: SH }); k.pop(); }
  const prof = new THREE.Shape();
  prof.moveTo(-0.33, 0.76); prof.lineTo(-0.33, 0.8); prof.lineTo(0.12, 1.0); prof.lineTo(0.33, 1.0); prof.lineTo(0.33, 0.76); prof.closePath();
  k.ext('paint', prof, W, -W / 2, 0, 0, { ...SH, rot: [0, HP, 0], bev: 0.008, bevSeg: 2, curveSeg: 2 });
  // upper instrument panel
  k.box('paint', W, 0.5, 0.2, 0, 1.25, -0.23, { ...SH, r: 0.012 });
  k.box('paint', W - 0.06, 0.44, 0.01, 0, 1.25, -0.125, { ...PN, r: 0.002 });
  P.cornerScrews(k, W - 0.06, 0.44, 0, 1.25, -0.12, 0.014, { r: 0.0035 });
  // oscilloscope
  k.box('paint', 0.3, 0.26, 0.04, -0.38, 1.27, -0.11, { ...SH, r: 0.012 });
  k.ext('#0e0e0e:p', frameShape(0.24, 0.19, 0.03, 0.2, 0.15, 0.025), 0.012, -0.38, 1.285, -0.095, { bev: 0.004, bevSeg: 1, curveSeg: 4 });
  k.screen('main', 0.2, 0.15, -0.38, 1.285, -0.093, { style: 'scope', bulge: 0.008, aspect: 4 / 3 });
  for (let i = 0; i < 3; i++) P.knob(k, -0.47 + i * 0.09, 1.165, -0.09, 0.012, { name: 'scopeKnob_' + i, static: true, slot: '#18181a:p' });
  k.parts.needles = [
    P.gauge(k, -0.05, 1.31, -0.12, 0.06, { label: 'DNA %', max: 100, red: 0.85, value: 0.6, name: 'needle_dna', key: 'dna', screws: true, static: true }),
    P.gauge(k, 0.12, 1.31, -0.12, 0.06, { label: 'PSI', max: 50, red: 0.8, value: 0.35, name: 'needle_psi', key: 'cpsi', screws: true, static: true }),
  ];
  // lamp row (parts.lamps, one glow draw) with chrome bezels
  const lampCols = [0x30ff60, 0x30ff60, 0xffa020, 0xffa020, 0xff2a1a, 0x3a8aff];
  const lampDefs = lampCols.map((col, i) => {
    const x = 0.29 + (i % 3) * 0.07, y = 1.36 - Math.floor(i / 3) * 0.08;
    k.lathe('metal', [[0.0125, 0], [0.018, 0, 1], [0.0175, 0.004, 2], [0.0135, 0.0055, 2], [0.0125, 0.003]], x, y, -0.12, { ...FIN.chrome, axis: 'z', seg: 16 });
    return { geo: new Geo().append(latheGeo([[0.0001, 0], [0.0125, 0, 1], [0.012, 0.003], [0.009, 0.0065], [0.0045, 0.008], [0.0001, 0.0085]], 14, { rings: false })).rotX(HP).translate(x, y, -0.12), color: col, intensity: 2.2 };
  });
  k.parts.lamps = k.glow('lamps', lampDefs);
  k.parts.lamps.forEach((l, i) => { l.name = 'lamp_' + i; });
  const hdr = k.reg('cc_hdr', 480, 48, (c, w, h) => { c.fillStyle = '#1b1d20'; c.fillRect(0, 0, w, h); txt(c, 'GENESIS-9  CLONE CONTROL', w * 0.42, h / 2, h * 0.5, { col: '#e8c860' }); drawLogo(c, w * 0.9, h / 2, h * 0.3, '#e8c860', { text: false }); });
  k.label(hdr, 0.62, 0.062, -0.1, 1.455, -0.1194);
  // sloped control surface (local +Z = surface normal)
  const slope = Math.atan2(0.2, 0.45);
  k.push(0, 0.9, 0.1, [-(HP - slope), 0, 0]);
  const pz = 0.009;
  k.box('paint', W - 0.08, 0.44, 0.004, 0, 0, pz, { ...PN, r: 0.001 });
  const sl = k.reg('cc_sl', 300, 40, (c, w, h) => { c.clearRect(0, 0, w, h); ['NUTRIENT', 'GROWTH', 'MEMORY', 'OBEDIENCE'].forEach((s, i) => txt(c, s, (i + 0.5) * (w / 4), h / 2, h * 0.38, { col: '#ddd', f: 'mono', maxW: w / 4 - 6 })); });
  k.label(sl, 0.36, 0.048, -0.4, 0.17, pz + 0.0026);
  k.parts.sliders = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.535 + i * 0.09;
    k.box('#0e0e0e', 0.014, 0.16, 0.004, x, 0.03, pz + 0.003, { r: 0 });
    for (let t = 0; t < 5; t++) k.box('#bbbbbb:s', 0.02, 0.002, 0.001, x + 0.022, -0.045 + t * 0.038, pz + 0.0026, { r: 0 });
    const track = k.grp(x, 0.03, pz + 0.005, { name: 'sliderTrack_' + i });
    const s = k.grp(0, [0.02, -0.03, 0.05, -0.01][i], 0, { to: track, name: 'slider_' + i });
    k.insideStatic(s, () => { k.box('#9a9a9a:s', 0.04, 0.022, 0.018, 0, 0, 0.009, { r: 0.004 }); k.box('#0e0e0e', 0.04, 0.003, 0.0185, 0, 0, 0.009, { r: 0 }); });
    k.parts.sliders.push(s);
  }
  k.params.sliderTravel = 0.14;
  const kl = k.reg('cc_kl', 300, 30, (c, w, h) => { c.clearRect(0, 0, w, h); ['TEMP', 'pH', 'FLOW', 'VOLT'].forEach((s, i) => txt(c, s, (i + 0.5) * (w / 4), h / 2, h * 0.5, { col: '#ddd', f: 'mono' })); });
  k.label(kl, 0.34, 0.034, 0, 0.17, pz + 0.0026);
  k.parts.knobs = [];
  for (let i = 0; i < 4; i++) k.parts.knobs.push(P.knob(k, -0.13 + i * 0.087, 0.09, pz + 0.002, 0.022, { name: 'knob_' + i, static: true, slot: '#18181a:p', angle: [0.4, -1.2, 2.1, -0.3][i] }));
  k.parts.switches = [];
  for (let i = 0; i < 6; i++) k.parts.switches.push(P.toggle(k, -0.14 + i * 0.058, -0.05, pz + 0.002, { on: i % 3 === 0, name: 'switch_' + i, static: true }));
  const warn = k.reg('cc_warn', 260, 60, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(4, 4, w - 8, h - 8); c.fillStyle = '#e8b417'; c.fillRect(8, 8, w - 16, h - 16); txt(c, 'DO NOT PRESS TWICE', w / 2, h / 2, h * 0.36, { col: '#111', maxW: w * 0.9 }); rubOff(c, w, h, 0.5, 3); });
  k.label(warn, 0.26, 0.06, 0.0, -0.15, pz + 0.0026);
  k.box('#0e0e0e', 0.2, 0.012, 0.01, 0.4, 0.17, pz + 0.006, { r: 0 });
  k.pop();
  // printout curling out of the slot
  const paper = new Geo();
  const pp = [[0.4, 1.0, -0.0], [0.4, 1.06, 0.02], [0.4, 1.07, 0.09], [0.4, 1.02, 0.12]];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, a = Math.floor(t * 2.999), f = t * 3 - a;
    const p0 = pp[a], p1 = pp[a + 1];
    const y = lerp(p0[1], p1[1], f), z = lerp(p0[2], p1[2], f);
    paper.v(0.4 - 0.09, y, z, 0, 1, 0, 0, t, 0); paper.v(0.4 + 0.09, y, z, 0, 1, 0, 1, t, 0);
    if (i) paper.quad(i * 2 - 2, i * 2 - 1, i * 2 + 1, i * 2);
  }
  paper.computeNormals(false);
  const pr = k.reg('cc_paper', 64, 128, (c, w, h) => { c.fillStyle = '#e2ddcf'; c.fillRect(0, 0, w, h); c.strokeStyle = '#2a2a6a'; c.lineWidth = 1; c.beginPath(); for (let y = 0; y < h; y += 2) c.lineTo(w * 0.5 + Math.sin(y * 0.3) * w * 0.3 * Math.sin(y * 0.05), y); c.stroke(); });
  for (let i = 0; i < paper.count; i++) { paper.uv[i * 2] = lerp(pr.u0, pr.u1, paper.uv[i * 2]); paper.uv[i * 2 + 1] = lerp(pr.v0, pr.v1, paper.uv[i * 2 + 1]); }
  const pback = new Geo().append(paper).flip();
  k.put('atlas', paper.append(pback), 0, 0, 0, { uvOff: false });
  // big red button on its pedestal + flip-up safety cover
  const bx = 0.43, bz = 0.15, by = 0.98;
  k.box('paint', 0.2, 0.1, 0.2, bx, by - 0.04, bz, { tint: 0xd9a92a, r: 0.012 });
  k.clabel(hazardBand(k), 0.0856, 0.012, TAU, bx, by + 0.016, bz, { seg: 32 });
  k.cyl('#d8a21a:p', 0.085, 0.012, bx, by + 0.016, bz, { seg: 28 });
  k.cyl('#0e0e0e:p', 0.065, 0.006, bx, by + 0.025, bz, { seg: 28 });
  const btn = k.grp(bx, by + 0.028, bz, { name: 'button' });
  k.insideStatic(btn, () => {
    k.cyl('#c8231b:s', 0.05, 0.035, 0, 0.0175, 0, { seg: 28, r2: 0.052, bev: 0.004 });
    k.sph('#c8231b:s', 0.05, 0, 0.035, 0, { ws: 28, hs: 6, tl: 0.6, s: [1, 0.35, 1] });
  });
  const cover = k.grp(bx, by + 0.03, bz - 0.075, { name: 'cover' });
  cover.rotation.x = -1.9;
  const cvm = TINTED(0xff5a30, 0.42, { rough: 0.2, env: 0.8 });
  const cg = new Geo().append(boxGeo(0.15, 0.07, 0.15, { r: 0.008 }).translate(0, 0.035, 0.075));
  k.mesh(cvm, cg, 0, 0, 0, { to: cover, name: 'coverShell', shadow: false, ao: false });
  k.cyl('#c4c7ca:c', 0.006, 0.16, bx, by + 0.03, bz - 0.075, { axis: 'x', seg: 8 });
  k.collide(cbox(W, 1.0, 0.66, 0, 0.5, 0));
  k.collide(cbox(W, 0.5, 0.25, 0, 1.25, -0.205)); // incl. the scope housing / gauge bezels on its face
  k.parts.button = btn;
  k.parts.cover = cover;
  k.anchors.view = V3(-0.38, 1.285, 0.45);
  k.anchors.operator = V3(0, 0, 0.75);
  void A;
  return k.done({ mass: 260, material: 'metal' });
}

// ---------------------------------------------------------------------------
// PORTABLE CLONING PAD (prop): rubber-footed disc, perforated deck, emitter ring (parts.ring) + lens
// (parts.lens) + status LEDs (parts.leds) in one glow draw, pole with screen (screens.main),
// carry handles (anchors.handles), T-bar (anchors.handleBar), battery pack
// ---------------------------------------------------------------------------
export function b_clone_pad(o) {
  void o;
  const k = new DKit('clone_pad', { wear: { chip: 0.25, rust: 0.15, grime: 0.55, dust: 0.4 }, ao: { res: 48 } });
  const A = k.atlas(1024, 512);
  const BODY = { tint: 0x4a5058 };
  const R = 0.65, H = 0.25;
  k.lathe('#141414:r', [[0.0001, 0], [R - 0.03, 0, 1], [R - 0.02, 0.025, 2], [0.0001, 0.025]], 0, 0, 0, { seg: 48 });
  k.lathe('paint', [[R - 0.03, 0.02], [R, 0.05, 2], [R, 0.18, 2], [R - 0.03, H - 0.02, 2], [R - 0.08, H, 2], [R - 0.09, H - 0.012], [0.0001, H - 0.012]], 0, 0, 0, { ...BODY, seg: 56 });
  k.clabel(hazardBand(k), R + 0.0025, 0.07, TAU, 0, 0.115, 0, { seg: 56 });
  const deck = k.reg('cp_deck', 256, 256, (c, w, h) => drawPerforation(c, w, h, 16, 5, '#2a2e33', '#0b0d0f'), 'm');
  k.dlabel(deck, R - 0.1, 0, H - 0.0115, 0, { rot: [-HP, 0, 0], seg: 48 });
  k.tor('metal', 0.435, 0.008, 0, H - 0.006, 0, { ...FIN.steel, axis: 'y', ts: 56, rs: 5 });
  k.tor('metal', 0.497, 0.008, 0, H - 0.006, 0, { ...FIN.steel, axis: 'y', ts: 56, rs: 5 });
  k.cyl('metal', 0.12, 0.02, 0, H - 0.002, 0, { ...FIN.steel, seg: 28, bev: 0.004 });
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; P.screw(k, Math.sin(a) * (R - 0.055), H - 0.012, Math.cos(a) * (R - 0.055), { kind: 'hex', r: 0.007, dir: 'y' }); }
  // carry handles
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2;
    k.push(Math.sin(a) * R, 0.15, Math.cos(a) * R, [0, a, 0]);
    for (const sx of [-1, 1]) k.box('metal', 0.05, 0.06, 0.03, sx * 0.11, 0, 0.0, { ...FIN.steel, r: 0.008 });
    k.tube('metal', [[-0.11, 0, 0.0], [-0.11, 0, 0.08], [0.11, 0, 0.08], [0.11, 0, 0.0]], 0.014, { ...FIN.steel, round: 0.03, rseg: 5, radial: 10 });
    k.cyl('#1d1d1d:r', 0.018, 0.14, 0, 0, 0.08, { axis: 'x', seg: 12 });
    k.pop();
  }
  // pole + screen head + T-bar
  const pz = -R + 0.08;
  k.box('metal', 0.12, 0.05, 0.12, 0, H + 0.02, pz, { ...FIN.steel, r: 0.01 });
  k.box('paint', 0.05, 0.9, 0.05, 0, H + 0.45, pz, { ...BODY, r: 0.008 });
  k.push(0, H + 0.82, pz + 0.02, [-0.35, 0, 0]);
  k.box('paint', 0.22, 0.18, 0.08, 0, 0, 0, { ...BODY, r: 0.015 });
  k.box('#0e0e0e:p', 0.18, 0.14, 0.01, 0, 0.005, 0.04, { r: 0.006 });
  k.screen('main', 0.16, 0.12, 0, 0.005, 0.0455, { style: 'crt', text: 'CLONE PAD MK.II\nCHARGE 100%\nREADY_', bulge: 0.004, aspect: 4 / 3 });
  k.pop();
  const hm = new THREE.Matrix4().makeRotationX(-0.35).setPosition(0, H + 0.82, pz + 0.02);
  k.box('paint', 0.05, 0.1, 0.05, 0, H + 1.0, pz, { ...BODY, r: 0.008 });
  k.cyl('metal', 0.016, 0.46, 0, H + 1.06, pz, { ...FIN.steel, axis: 'x', seg: 12 });
  for (const sx of [-1, 1]) k.cyl('#1d1d1d:r', 0.022, 0.14, sx * 0.16, H + 1.06, pz, { axis: 'x', seg: 14, bev: 0.005 });
  // battery pack + cable
  k.box('paint', 0.2, 0.12, 0.12, 0.25, H + 0.06, pz + 0.12, { tint: 0xd9a92a, r: 0.012, rot: [0, -0.4, 0] });
  k.box('#0e0e0e:p', 0.06, 0.02, 0.04, 0.25, H + 0.13, pz + 0.12, { r: 0.006 });
  P.cable(k, [[0.2, H + 0.1, pz + 0.1], [0.12, H + 0.2, pz + 0.02], [0.03, H + 0.35, pz + 0.0]], 0.008, { tint: 0x161616 });
  const lbl = k.reg('cp_lbl', 300, 60, (c, w, h) => { c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, w, h); txt(c, 'PORTABLE CLONING PAD', w / 2, h * 0.36, h * 0.28, { col: '#111', maxW: w * 0.95 }); txt(c, 'TEAM LIFT • 95 KG • KEEP LEVEL', w / 2, h * 0.74, h * 0.2, { col: '#a01a14', f: 'mono', maxW: w * 0.95 }); grime(c, w, h, 0.5, 4); });
  k.clabel(lbl, R + 0.004, 0.04, 0.42, 0, 0.175, 0, { a: 0 });
  // emitter ring + lens + LEDs: one vertex-coloured glow mesh driven through the proxies' materials
  const ringG = new Geo().append(ringGeo(0.44, 0.49, 56)).rotX(-HP).translate(0, H - 0.004, 0);
  const lensG = new Geo().append(latheGeo([[0.0001, 0], [0.09, 0, 1], [0.085, 0.012], [0.06, 0.024], [0.03, 0.03], [0.0001, 0.0315]], 24, { rings: false })).translate(0, H + 0.008, 0);
  const ledG = (x) => new Geo().append(latheGeo([[0.0001, 0], [0.005, 0, 1], [0.0045, 0.002], [0.0001, 0.0035]], 10, { rings: false })).rotX(HP).translate(x, -0.07, 0.04).applyMatrix(hm);
  const gl = k.glow('glow', [{ geo: ringG, color: 0x30e8ff, intensity: 1.6 }, { geo: lensG, color: 0x30e8ff, intensity: 1.2 }, { geo: ledG(-0.08), color: 0x30ff60, intensity: 2.2 }, { geo: ledG(0.08), color: 0xff2a1a, intensity: 2.2 }]);
  gl[0].name = 'ring'; gl[1].name = 'lens'; gl[2].name = 'led_power'; gl[3].name = 'led_busy';
  k.collide(ccyl(R, H, 0, H / 2, 0));
  k.collide(cbox(0.08, 0.95, 0.08, 0, H + 0.47, pz));
  k.collide(cbox(0.46, 0.05, 0.05, 0, H + 1.06, pz));
  k.collide(cframe(cbox(0.22, 0.18, 0.09, 0, 0, 0.003), 0, H + 0.82, pz + 0.02, [-0.35, 0, 0])); // screen head
  k.collide(cbox(0.2, 0.12, 0.12, 0.25, H + 0.06, pz + 0.12, [0, -0.4, 0])); // battery pack
  k.anchors.spawn = V3(0, H, 0);
  k.anchors.handles = [0, 1, 2, 3].map((i) => { const a = PI / 4 + (i * PI) / 2; return V3(Math.sin(a) * (R + 0.08), 0.15, Math.cos(a) * (R + 0.08)); });
  k.anchors.handleBar = V3(0, H + 1.06, pz);
  k.parts.ring = gl[0];
  k.parts.lens = gl[1];
  k.parts.leds = [gl[2], gl[3]];
  void A;
  return k.done({ mass: 95, material: 'metal' });
}
