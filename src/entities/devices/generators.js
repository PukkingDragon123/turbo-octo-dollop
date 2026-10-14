// Mission generators: open-frame diesel set, 480 V grid switchgear cabinet, steam "mechano-dynamo".
// Floor devices: origin on the floor under the centre, front faces +Z. Every contract part / anchor
// (see src/game/generators.js) keeps its original position, pivot and meaning.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, cframe, ccyl, frameShape, rrShape, rrHole, circleShape, polyShape, curvePts, latheGeo, axisGeo, cylGeo, extrudeGeo, mat4 } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, hazardTri, drawLogo, drawPerforation } from './atlas.js';

const WIRE_COL = { red: 0xc8231b, blue: 0x2a5fc0, green: 0x2a9a3a, yellow: 0xe8c020 };
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// ---------------------------------------------------------------------------
// shared prints
// ---------------------------------------------------------------------------
function fieldPowerPlate(k) {
  return k.reg('fp_plate', 300, 120, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d6d8d6'); g.addColorStop(1, '#a8aaa8');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(255,255,255,${0.04 + ((y * 7) % 5) * 0.01})`; c.fillRect(0, y, w, 1); }
    c.strokeStyle = '#333'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    drawLogo(c, w * 0.17, h * 0.28, h * 0.15, '#1a1a1a', { text: false });
    txt(c, 'R.O.O.M. FIELD POWER', w * 0.58, h * 0.22, h * 0.14, { col: '#111', maxW: w * 0.62 });
    const L = ['MODEL  FPU-3  7.5 kVA', 'SERIAL 0042-0077-B', '230 V  50 Hz  1 PH  32 A', 'MFD 06/1994  DO NOT DISASSEMBLE'];
    L.forEach((s, i) => txt(c, s, 16, h * (0.46 + i * 0.14), h * 0.1, { col: '#1a1a1a', f: 'mono', al: 'left', maxW: w - 30 }));
    grime(c, w, h, 0.8, 21);
  }, 'b');
}

// ---------------------------------------------------------------------------
// DIESEL: tubular roll cage, channel skid, air-cooled single, blue alternator, red tank,
// rusty muffler with perforated heat shield, battery, sloped control panel.
// ---------------------------------------------------------------------------
export function b_generator_diesel(o) {
  const k = new DKit('generator_diesel', { wear: { chip: 0.32, rust: 0.3, grime: 0.65, dust: 0.45 }, ao: { res: 60 } });
  k.atlas(1024, 1024);
  const W = 1.4, D = 0.8, ch = 0.98;
  const SKID = { tint: 0x2c3034, chip: 0.42 };
  const CAGE = { tint: 0xd09c1a, chip: 0.42, rust: 0.4 };
  const ENG = { tint: 0x4b5a47 };
  const BLK = { tint: 0x26282a, chip: 0.35 };
  const ALT = { tint: 0x2b4a74 };
  const TANK = { tint: 0xa1261c, chip: 0.36 };
  const RUST = { ...FIN.iron, rust: 0.95, tint: 0x4a3a30 };
  const RUB = '#161617:r';

  // ---- skid: two C-channel rails, cross channels, fork pockets ----
  for (const sz of [-1, 1]) P.channel(k, 'paint', W, 0.08, 0.05, 0.005, 0, 0.04, sz * (D / 2), { ...SKID, flip: sz > 0 });
  for (const x of [-0.55, 0, 0.55]) {
    k.push(x, 0.035, 0, [0, HP, 0]);
    P.channel(k, 'paint', D - 0.012, 0.06, 0.04, 0.004, 0, 0, -0.02, SKID);
    k.pop();
  }
  for (const x of [-0.35, 0.35]) {
    k.push(x, 0.03, 0, [0, HP, 0]);
    P.rhs(k, 'paint', D + 0.02, 0.15, 0.05, 0.004, 0, 0, 0, SKID);
    k.pop();
    for (const sz of [-1, 1]) k.box('#050506', 0.13, 0.04, 0.002, x, 0.03, sz * (D / 2 + 0.0095), { r: 0 });
  }
  // earth stud + green/yellow strap
  P.screw(k, 0.62, 0.05, D / 2 + 0.002, { kind: 'hex', r: 0.006, fin: FIN.brass });
  P.cable(k, [[0.62, 0.05, D / 2 + 0.01], [0.6, 0.11, D / 2 - 0.02], [0.52, 0.2, 0.18]], 0.004, { tint: 0x3a8a2a, slot: '#3c8a2c:p' });
  const earth = k.reg('earth', 64, 64, (c, w, h) => { c.fillStyle = '#e8c020'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.moveTo(w / 2, 10); c.lineTo(w / 2, 32); c.moveTo(16, 34); c.lineTo(48, 34); c.moveTo(22, 42); c.lineTo(42, 42); c.moveTo(28, 50); c.lineTo(36, 50); c.stroke(); });
  k.label(earth, 0.03, 0.03, 0.66, 0.055, D / 2 + 0.0011);

  // engine bed rails on the cross members
  for (const sz of [-1, 1]) k.box('paint', 1.16, 0.015, 0.05, 0, 0.0725, sz * 0.145, { ...SKID, r: 0.003 });
  // ---- anti-vibration mounts ----
  const avm = (x, z, y0 = 0.08) => {
    k.box('metal', 0.07, 0.004, 0.05, x, y0 + 0.002, z, { ...FIN.zinc, r: 0.001 });
    k.cyl(RUB, 0.02, 0.022, x, y0 + 0.015, z, { seg: 10 });
    k.box('metal', 0.07, 0.004, 0.05, x, y0 + 0.028, z, { ...FIN.zinc, r: 0.001 });
  };
  for (const x of [-0.48, -0.12]) for (const z of [-0.15, 0.15]) avm(x, z);
  for (const x of [0.2, 0.42]) for (const z of [-0.14, 0.14]) avm(x, z);

  // ---- engine (air-cooled single, x ~ -0.3) ----
  const ex = -0.3;
  k.box('paint', 0.44, 0.13, 0.38, ex, 0.175, 0, { ...ENG, r: 0.02 });                              // sump
  k.box('paint', 0.47, 0.17, 0.42, ex, 0.32, 0, { ...ENG, r: 0.03, dent: 0.0008, div: 0.12 });       // crankcase
  for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) k.box('paint', 0.012, 0.15, 0.012, ex - 0.15 + i * 0.1, 0.31, sz * 0.212, { ...ENG, r: 0, wear: 0 }); // cast ribs
  k.box('paint', 0.5, 0.012, 0.44, ex, 0.405, 0, { ...ENG, r: 0.005 });                              // head gasket flange
  // finned cylinder barrel + head
  const cx = ex - 0.02;
  k.cyl('metal', 0.075, 0.24, cx, 0.53, 0, { ...FIN.iron, seg: 16 });
  const fin = rrShape(0.27, 0.27, 0.04);
  for (let i = 0; i < 8; i++) k.ext('paint', fin, 0.006, cx, 0.428 + i * 0.026, 0, { ...BLK, rot: [-HP, 0, 0], curveSeg: 2, bev: 0.0012, bevSeg: 1, chip: 0.5 });
  k.box('paint', 0.31, 0.09, 0.3, cx, 0.665, 0, { ...BLK, r: 0.018 });
  for (let i = 0; i < 3; i++) k.ext('paint', rrShape(0.29, 0.28, 0.035), 0.005, cx, 0.628 + i * 0.024, 0, { ...BLK, rot: [-HP, 0, 0], curveSeg: 2, chip: 0.5 });
  k.box('paint', 0.24, 0.05, 0.2, cx, 0.734, 0, { ...ENG, r: 0.016 });                              // rocker cover
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.screw(k, cx + sx * 0.1, 0.759, sz * 0.08, { kind: 'hex', r: 0.005, dir: 'y' });
  const rock = k.reg('rocker', 180, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M.', w / 2, h * 0.42, h * 0.5, { col: '#cfd4c8' }); txt(c, '4-STROKE DIESEL', w / 2, h * 0.82, h * 0.2, { col: '#cfd4c8', f: 'bold' }); rubOff(c, w, h, 1.2, 9); }, 'm');
  k.label(rock, 0.15, 0.05, cx, 0.7595, 0.01, { rot: [-HP, 0, 0] });
  // injection pump + steel injector line, fuel line, oil filler, dipstick, drain plug
  k.box('paint', 0.07, 0.08, 0.05, ex + 0.16, 0.45, 0.17, { ...ENG, r: 0.008 });
  P.cable(k, [[ex + 0.16, 0.49, 0.17], [ex + 0.14, 0.58, 0.16], [ex + 0.02, 0.66, 0.15], [cx + 0.04, 0.69, 0.12]], 0.003, { slot: 'metal', mo: { ...FIN.steel }, n: 16, radial: 6 });
  k.cyl('#d4a21e:s', 0.012, 0.016, ex + 0.17, 0.418, -0.12, { seg: 10 });
  k.box('#d4a21e:s', 0.034, 0.008, 0.008, ex + 0.17, 0.43, -0.12, { r: 0.003 });
  k.tor('#d4a21e:s', 0.012, 0.003, ex - 0.2, 0.43, 0.16, { ts: 12, rs: 5 });
  P.rod(k, '#8a8c8e:m', [ex - 0.2, 0.42, 0.16], [ex - 0.2, 0.36, 0.17], 0.002);
  P.screw(k, ex + 0.1, 0.12, 0.19, { kind: 'hex', r: 0.007 });
  // fan shroud + recoil starter (front, +Z)
  const rs = [ex - 0.02, 0.38, 0.23];
  k.lathe('paint', [[0.155, 0], [0.158, 0.012, 2], [0.15, 0.035], [0.13, 0.06], [0.1, 0.075, 2], [0.06, 0.081], [0, 0.082]], rs[0], rs[1], rs[2], { ...ENG, axis: 'z', seg: 28 });
  for (let i = 0; i < 14; i++) { // intake slots ringed around the starter cup
    const a = (i / 14) * TAU;
    k.box('#070708', 0.03, 0.006, 0.004, rs[0] + Math.cos(a) * 0.118, rs[1] + Math.sin(a) * 0.118, rs[2] + 0.05, { r: 0, rot: [-0.62 * Math.sin(a), 0.62 * Math.cos(a), a] });
  }
  k.cyl('metal', 0.03, 0.006, rs[0], rs[1], rs[2] + 0.083, { ...FIN.zinc, axis: 'z', seg: 14, bev: 0.002 });
  const exit = [rs[0] + 0.08, rs[1] + 0.07, rs[2] + 0.07];
  k.tor('metal', 0.008, 0.0035, exit[0], exit[1], exit[2], { ...FIN.chrome, ts: 14, rs: 6 });
  // (cord handle: built below as a bone of the shared skinned mesh)
  const cordBuild = () => {
    k.cyl('#141414:r', 0.016, 0.11, 0, 0, 0, { axis: 'x', seg: 10, bev: 0.006, bevSeg: 2 });
    for (let i = -2; i <= 2; i++) k.cyl('#101010:r', 0.0168, 0.004, i * 0.017, 0, 0, { axis: 'x', seg: 10 });
    k.cyl('#a8231a:s', 0.0035, 0.032, 0, 0, -0.016, { axis: 'z', seg: 6 });
  };
  // coupling housing to the alternator
  k.lathe('paint', [[0.15, 0], [0.16, 0.02, 2], [0.19, 0.14], [0.2, 0.15, 2], [0.2, 0.16]], ex + 0.235, 0.36, 0, { ...ENG, axis: 'x', seg: 28 });

  // ---- alternator (x ~ 0.28, along X) ----
  const axx = 0.28, ay = 0.36;
  k.lathe('paint', [[0.2, 0], [0.205, 0.01, 2], [0.205, 0.33, 2], [0.2, 0.34]], axx - 0.17, ay, 0, { ...ALT, axis: 'x', seg: 32, uvOff: true });
  for (const dx of [-0.13, 0.13]) k.lathe('paint', [[0.205, -0.012], [0.212, -0.008, 2], [0.212, 0.008, 2], [0.205, 0.012]], axx + dx, ay, 0, { ...ALT, axis: 'x', seg: 32 });
  // non-drive end bell with vent slots + bearing cap
  k.lathe('paint', [[0.2, 0], [0.19, 0.03, 2], [0.15, 0.06], [0.07, 0.075, 2], [0, 0.078]], axx + 0.17, ay, 0, { ...ALT, axis: 'x', seg: 28 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    k.box('#060607', 0.004, 0.045, 0.012, axx + 0.215, ay + Math.cos(a) * 0.14, Math.sin(a) * 0.14, { r: 0, rot: [-a, 0, 0] });
  }
  k.cyl('metal', 0.045, 0.012, axx + 0.25, ay, 0, { ...FIN.zinc, axis: 'x', seg: 16, bev: 0.003 });
  // feet
  for (const dx of [-0.08, 0.14]) k.box('paint', 0.06, 0.13, 0.36, axx + dx, 0.17, 0, { ...ALT, r: 0.005 });
  // terminal box + glands
  k.box('paint', 0.16, 0.09, 0.13, axx, 0.6, 0.02, { ...ALT, r: 0.012 });
  k.box('paint', 0.168, 0.012, 0.138, axx, 0.648, 0.02, { ...ALT, r: 0.004 });
  P.cornerScrews(k, 0.168, 0.138, axx, 0.02, 0, 0.012, { dir: 'y', r: 0.003 });
  for (const dx of [-0.04, 0.04]) P.gland(k, axx + dx, 0.6, 0.085, 0.008, { fin: FIN.zinc });
  P.plate(k, fieldPowerPlate(k), 0.15, 0.06, axx, ay + 0.02, 0.206, { fin: FIN.alu, rr: 0.002 });

  // ---- fuel tank (red, across the top) with strap brackets to the cage ----
  const tx = 0.08, ty = 0.89;
  k.box('paint', 0.8, 0.17, 0.44, tx, ty, 0, { ...TANK, r: 0.045, seg: 2, div: 0.16, dent: 0.0012 });
  k.box('paint', 0.812, 0.012, 0.452, tx, ty, 0, { ...TANK, r: 0.005 });                            // seam flange
  for (const x of [-0.22, 0.38]) {
    k.tube('metal', [[x, 0.985, -0.37], [x, 0.985, -0.24], [x, 0.8, -0.23], [x, 0.795, 0], [x, 0.8, 0.23], [x, 0.985, 0.24], [x, 0.985, 0.37]], 0.004, { ...FIN.zinc, round: 0.03, rseg: 3, radial: 5, rust: 0.5 });
    for (const sz of [-1, 1]) k.box('paint', 0.04, 0.03, 0.03, x, 0.972, sz * 0.355, { ...CAGE, r: 0.004 });
  }
  k.cyl('metal', 0.036, 0.022, 0.22, 0.986, 0.08, { ...FIN.zinc, seg: 18, bev: 0.002 });
  const cap = k.grp(0.22, 0.997, 0.08, { name: 'fuelCap' });
  k.insideStatic(cap, () => {
    k.put('#151516:p', axisGeo(P.flutedGeo(0.044, 0.024, 10, 0.07), 'y'), 0, 0, 0);
    k.box('#151516:p', 0.074, 0.016, 0.014, 0, 0.03, 0, { r: 0.005 });
  });
  k.tube('#8a8d90:m', curvePts([[0.22 + 0.04, 0.995, 0.08], [0.29, 0.99, 0.1], [0.31, 0.982, 0.12]], 10), 0.0012, { radial: 4 });
  // tank gauge
  const tg = k.reg('tankgauge', 96, 96, (c, w, h) => { c.fillStyle = '#e8e0c8'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, TAU); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.arc(w / 2, h * 0.65, w * 0.34, -PI * 0.85, -PI * 0.15); c.stroke(); txt(c, 'E', w * 0.22, h * 0.55, 14, { col: '#c00' }); txt(c, 'F', w * 0.78, h * 0.55, 14, { col: '#111' }); c.strokeStyle = '#c00'; c.lineWidth = 3; c.beginPath(); c.moveTo(w / 2, h * 0.65); c.lineTo(w * 0.28, h * 0.42); c.stroke(); txt(c, 'FUEL', w / 2, h * 0.84, 12, { col: '#111' }); });
  k.cyl('metal', 0.028, 0.008, -0.05, ty + 0.087, 0.14, { ...FIN.chrome, seg: 18, bev: 0.002 });
  k.dlabel(tg, 0.024, -0.05, ty + 0.0915, 0.14, { rot: [-HP, 0, 0] });
  k.disc('glass', 0.024, -0.05, ty + 0.0925, 0.14, { rot: [-HP, 0, 0] });
  // stickers on the tank front
  const dsl = k.reg('diesel_only', 220, 60, (c, w, h) => { c.fillStyle = '#e8b417'; rrect(c, 0, 0, w, h, 8); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 3; rrect(c, 4, 4, w - 8, h - 8, 6); c.stroke(); txt(c, 'DIESEL ONLY', w / 2, h / 2, h * 0.5, { col: '#111' }); grime(c, w, h, 1, 5, { corner: 0.18 }); });
  k.label(dsl, 0.16, 0.044, -0.16, ty + 0.01, 0.2215, { rot: [0, 0, 0.02] });
  const stencil = k.reg('fp_stencil', 360, 80, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'FIELD POWER', w / 2, h * 0.38, h * 0.42, { col: 'rgba(236,228,206,0.92)', f: 'stencil', maxW: w * 0.96 }); txt(c, 'FPU-3   7.5 kVA', w / 2, h * 0.82, h * 0.22, { col: 'rgba(236,228,206,0.85)', f: 'stencil' }); rubOff(c, w, h, 2, 13); });
  k.decal(stencil, 0.3, 0.067, 0.27, ty + 0.012, 0.2215);
  P.streak(k, 0.2, ty + 0.085, 0.2213, 0.04, 0.09, { col: '70,40,16', alpha: 0.5 });

  // ---- exhaust: manifold, muffler with perforated heat shield, flex, stack + rain flap ----
  const my = 0.62, mz = -0.3;
  k.lathe('metal', [[0, -0.17], [0.05, -0.17, 1], [0.074, -0.15], [0.078, -0.13], [0.078, 0.13, 2], [0.074, 0.15], [0.05, 0.17, 1], [0, 0.17]], -0.5, my, mz, { ...RUST, axis: 'x', seg: 18 });
  const perf = k.reg('perf', 128, 128, (c, w, h) => { c.fillStyle = '#9a9c9c'; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'destination-out'; drawPerforation(c, w, h, 10, 3.4, null, '#000', { lip: false }); c.globalCompositeOperation = 'source-over'; grime(c, w, h, 1.5, 3); }, 'm');
  k.push(-0.5, my, mz, [0, 0, HP]);
  for (let i = 0; i < 3; i++) k.clabel(perf, 0.092, 0.09, 1.1, 0, -0.09 + i * 0.09, 0, { a: PI * 0.8, seg: 8 });
  k.pop();
  for (const dx of [-0.1, 0.1]) k.tor('metal', 0.092, 0.003, -0.5 + dx, my, mz, { ...FIN.zinc, axis: 'x', ts: 18, rs: 4, rust: 0.6 });
  P.cable(k, [[cx + 0.0, 0.66, -0.15], [cx - 0.02, 0.66, -0.22], [-0.33, 0.63, -0.3], [-0.335, my, mz]], 0.024, { slot: 'metal', mo: RUST, n: 14, radial: 10 });
  k.cyl('metal', 0.03, 0.03, -0.32, my, mz, { ...RUST, axis: 'x', seg: 12, bev: 0.003 });
  const stack = [[-0.67, my, mz], [-0.72, my, mz], [-0.72, 0.92, mz], [-0.72, 1.12, mz], [-0.66, 1.18, mz]];
  k.tube('metal', stack, 0.028, { ...RUST, round: 0.06, rseg: 5, radial: 12 });
  for (let i = 0; i < 5; i++) k.tor('metal', 0.03, 0.004, -0.72, 0.74 + i * 0.018, mz, { ...RUST, axis: 'y', ts: 10, rs: 4 }); // flex bellows
  k.tor('metal', 0.029, 0.004, -0.66, 1.18, mz, { ...FIN.iron, axis: 'x', ts: 12, rs: 4, rust: 1 });
  k.push(-0.655, 1.205, mz, [0, 0, -0.5]);
  k.cyl('metal', 0.033, 0.003, 0, 0, 0, { ...RUST, axis: 'x', seg: 14 });
  k.pop();
  P.stain(k, -0.66, 1.16, mz + 0.03, 0.05, 0.07, { col: '12,10,8', alpha: 0.7 });
  const hot = k.reg('hot', 120, 100, (c, w, h) => { c.fillStyle = '#e8b417'; c.beginPath(); c.moveTo(w / 2, 4); c.lineTo(w - 4, h - 4); c.lineTo(4, h - 4); c.closePath(); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 5; c.stroke(); for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(w * (0.38 + i * 0.12), h * 0.78); c.bezierCurveTo(w * (0.32 + i * 0.12), h * 0.62, w * (0.44 + i * 0.12), h * 0.55, w * (0.38 + i * 0.12), h * 0.4); c.stroke(); } grime(c, w, h, 1, 2); });
  k.label(hot, 0.05, 0.042, -0.5, my + 0.035, mz + 0.082, { rot: [-0.45, 0, 0] });
  k.anchors.exhaust = V3(-0.65, 1.18, -0.3);

  // ---- battery ----
  const bx = 0.55, by = 0.16, bz = -0.2;
  k.box('#1d1e1f:p', 0.2, 0.15, 0.13, bx, by, bz, { r: 0.005 });
  k.box('#262728:p', 0.204, 0.018, 0.134, bx, by + 0.075, bz, { r: 0.004 });
  for (let i = 0; i < 6; i++) k.cyl('#d9b21e:p', 0.008, 0.006, bx - 0.075 + i * 0.03, by + 0.087, bz - 0.03, { seg: 8 });
  for (const [dx, col] of [[-0.06, '#9a8a7a:m'], [0.06, '#9a8a7a:m']]) k.cyl(col, 0.008, 0.014, bx + dx, by + 0.09, bz + 0.03, { seg: 8 });
  k.box('metal', 0.012, 0.012, 0.15, bx, by + 0.088, bz, { ...FIN.zinc, r: 0.002 });
  P.cable(k, [[bx - 0.06, by + 0.098, bz + 0.03], [bx - 0.1, by + 0.16, bz + 0.08], [0.38, 0.32, -0.12], [0.33, 0.35, -0.08]], 0.006, { tint: 0x8c1a14 });
  P.cable(k, [[bx + 0.06, by + 0.098, bz + 0.03], [bx + 0.08, by + 0.12, bz + 0.12], [0.6, 0.09, 0.0], [0.5, 0.085, 0.1]], 0.006, { tint: 0x161616 });
  const batt = k.reg('battery', 140, 60, (c, w, h) => { c.fillStyle = '#c8231b'; c.fillRect(0, 0, w, h); txt(c, 'POWER-CELL', w / 2, h * 0.36, h * 0.3, { col: '#fff' }); txt(c, '12V 45Ah  410A', w / 2, h * 0.74, h * 0.2, { col: '#ffe', f: 'mono' }); grime(c, w, h, 1, 8); });
  k.label(batt, 0.12, 0.05, bx, by, bz + 0.0651);

  // ---- control panel (front, right), sloped ----
  const panelBase = { tint: 0x2b2e31, chip: 0.35 };
  k.box('paint', 0.05, 0.42, 0.03, 0.33, 0.29, 0.235, { ...SKID, r: 0.006 });
  k.box('paint', 0.07, 0.012, 0.3, 0.33, 0.074, 0.27, { ...SKID, r: 0.003 });
  k.push(0.33, 0.6, 0.27, [-0.25, 0, 0]);
  k.box('paint', 0.44, 0.27, 0.06, 0, 0, -0.03, { ...panelBase, r: 0.012 });
  k.box('paint', 0.42, 0.25, 0.004, 0, 0, 0.0015, { ...panelBase, r: 0.006 });
  P.cornerScrews(k, 0.42, 0.25, 0, 0, 0.0035, 0.012, { r: 0.003 });
  const pz = 0.0035;
  const needlePl = [
    P.gauge(k, -0.14, 0.05, pz, 0.042, { label: 'OIL', max: 80, red: 0.85, value: 0.1, name: 'needle_oil', key: 'oil', noNeedle: true }),
    P.gauge(k, -0.03, 0.05, pz, 0.042, { label: 'TEMP', labels: ['C', '', '', '', '', 'H'], red: 0.8, value: 0.05, name: 'needle_temp', key: 'temp', noNeedle: true }),
    P.gauge(k, 0.08, 0.05, pz, 0.042, { label: 'VOLTS', max: 300, green: [0.6, 0.85], value: 0.0, name: 'needle_volts', key: 'volts', noNeedle: true }),
  ];
  k.parts.lamp = P.pilotLamp(k, 0.17, 0.07, pz, 0.013, 'red', { name: 'lamp', bezel: 'chrome' });
  k.box('#0e0f10:g', 0.152, 0.054, 0.008, -0.06, -0.06, pz + 0.004, { r: 0.004 });
  k.screen('main', 0.13, 0.04, -0.06, -0.06, pz + 0.0095, { style: 'lcd', text: 'HRS 0042.7', bulge: 0, aspect: 0.13 / 0.04 });
  k.parts.switches = [P.toggle(k, 0.07, -0.06, pz, { name: 'switch_run', static: true }), P.toggle(k, 0.12, -0.06, pz, { name: 'switch_choke', on: true, static: true })];
  const tl = k.reg('dz_tl', 160, 36, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); txt(c, 'RUN', w * 0.25, h / 2, h * 0.55, { col: '#111', f: 'mono' }); txt(c, 'CHOKE', w * 0.75, h / 2, h * 0.55, { col: '#111', f: 'mono' }); });
  k.label(tl, 0.09, 0.02, 0.095, -0.1, pz + 0.0004);
  P.pushButton(k, 0.17, -0.07, pz, 0.015, { tint: 0x2a8a3a, name: 'startButton', static: true });
  for (const sx of [-1, 1]) k.box('#c9ccce:c', 0.004, 0.034, 0.018, 0.17 + sx * 0.026, -0.07, pz + 0.009, { r: 0.0015 });
  const pl = k.reg('dz_panel', 400, 40, (c, w, h) => { c.fillStyle = '#15171a'; c.fillRect(0, 0, w, h); txt(c, 'GENERATOR CONTROL', w * 0.36, h / 2, h * 0.5, { col: '#e8c860' }); txt(c, 'START ▶', w * 0.86, h / 2, h * 0.42, { col: '#9f9', f: 'mono' }); });
  k.label(pl, 0.38, 0.038, 0, 0.112, pz + 0.0004);
  k.pop();
  // harness from the panel back to the terminal box
  P.cable(k, [[0.33, 0.55, 0.24], [0.33, 0.58, 0.16], [0.3, 0.62, 0.1], [0.3, 0.6, 0.085]], 0.009, { tint: 0x1a1a1b, n: 12 });

  // ---- roll cage ----
  const cr = 0.022;
  for (const sz of [-1, 1]) {
    const zz = sz * (D / 2 - 0.03);
    k.tube('paint', [[-W / 2 + 0.03, 0.08, zz], [-W / 2 + 0.03, ch, zz], [W / 2 - 0.03, ch, zz], [W / 2 - 0.03, 0.08, zz]], cr, { ...CAGE, round: 0.09, rseg: 6, radial: 10 });
    for (const sx of [-1, 1]) k.box('paint', 0.07, 0.008, 0.07, sx * (W / 2 - 0.03), 0.084, zz, { ...CAGE, r: 0 });
  }
  for (const x of [-(W / 2 - 0.03), 0, W / 2 - 0.03]) k.cyl('paint', x === 0 ? cr * 1.1 : cr, D - 0.06, x, ch, 0, { ...CAGE, axis: 'z', seg: 12 });
  k.box('paint', 0.12, 0.012, 0.14, 0, ch + 0.024, 0, { ...CAGE, r: 0.004 });
  k.tor('metal', 0.04, 0.009, 0, ch + 0.07, 0, { ...FIN.zinc, ts: 18, rs: 7 });
  const caution = k.reg('dz_co', 160, 120, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); hazardTri(c, w * 0.25, h * 0.45, h * 0.6); txt(c, 'CO', w * 0.7, h * 0.32, h * 0.3, { col: '#c0201a' }); txt(c, 'DO NOT RUN', w * 0.68, h * 0.62, h * 0.12, { col: '#111', f: 'mono' }); txt(c, 'INDOORS*', w * 0.68, h * 0.78, h * 0.12, { col: '#111', f: 'mono' }); grime(c, w, h, 0.9, 5, { corner: 0.15 }); });
  k.label(caution, 0.12, 0.09, ex + 0.12, 0.31, 0.2115);
  P.streak(k, ex - 0.12, 0.39, 0.2112, 0.05, 0.16, { col: '24,20,14', alpha: 0.55 });
  P.streak(k, ex + 0.05, 0.39, 0.2112, 0.03, 0.12, { col: '24,20,14', alpha: 0.4 });
  // oil puddle on the floor under the engine
  k.push(ex + 0.05, 0.0015, 0.05, [-HP, 0, 0]);
  P.stain(k, 0, 0, 0, 0.5, 0.4, { col: '14,12,8', alpha: 0.65, ring: true });
  k.pop();

  // animated parts (3 gauge needles + recoil cord handle) as bones of one skinned mesh
  const PM = mat4(0.33, 0.6, 0.27, [-0.25, 0, 0]);
  const rig = k.bones('rig', [
    ...needlePl.map(([x, y, z, rot, name]) => { const v = V3(x, y, z).applyMatrix4(PM); return [v.x, v.y, v.z, [-0.25, 0, rot[2]], name]; }),
    [exit[0], exit[1], exit[2] + 0.03, null, 'cordHandle'],
  ], (i) => (i < 3 ? P.needle(k, 0.042) : cordBuild()));
  k.parts.needles = rig.slice(0, 3);
  const cord = rig[3];
  cord.userData.z0 = cord.position.z;
  k.collide(cbox(W, ch + 0.04, D, 0, (ch + 0.04) / 2, 0));
  k.anchors.fuelCap = V3(0.22, 1.0, 0.08);
  k.anchors.cordRest = cord.position.clone();
  k.anchors.cordExit = V3(...exit);
  k.anchors.panel = V3(0.33, 0.6, 0.35);
  k.parts.fuelCap = cap;
  k.parts.cordHandle = cord;
  return k.done({ mass: 230, material: 'metal' });
}

// ---------------------------------------------------------------------------
// ELECTRIC: 480 V grid switchgear cabinet. Fixed instrument header (CRT status screen, panel meters,
// beacon lamp), hinged lower door with louvres; inside: galvanised mounting plate, colour-coded
// terminal blocks (anchors.terminals), ceramic fuse holder (+ fuse cartridge in parts.fuseSlot),
// big rotary-lever breaker, wire ducts, contactors.
// ---------------------------------------------------------------------------
export function b_generator_electric(o) {
  const k = new DKit('generator_electric', { wear: { chip: 0.24, rust: 0.18, grime: 0.6, dust: 0.5 }, ao: { res: 56 } });
  k.atlas(1024, 1024);
  const W = 1.0, H = 1.7, D = 0.7, t = 0.02;
  const BODY = { tint: 0x7a8085 };
  const DARK = { tint: 0x2a2d30 };
  // plinth with fork slots
  k.box('paint', W - 0.02, 0.08, D - 0.02, 0, 0.04, 0, { ...DARK, r: 0.004, chip: 0.4 });
  for (const sz of [-1, 1]) for (const x of [-0.25, 0.25]) k.box('#060607', 0.18, 0.045, 0.004, x, 0.035, sz * (D / 2 - 0.008), { r: 0 });
  // carcass: sides, back, top canopy, bottom
  for (const sx of [-1, 1]) {
    k.box('paint', t, H - 0.08, D, sx * (W / 2 - t / 2), 0.08 + (H - 0.08) / 2, 0, { ...BODY, r: 0.004, div: 0.25, dent: 0.0012 });
    k.push(sx * W / 2, 1.25, -0.05, [0, sx * HP, 0]);
    P.louvre(k, 0, 0, 0.0005, 0.32, 0.2, 7, { mo: BODY });
    k.pop();
  }
  k.box('paint', W - 2 * t, H - 0.08, t, 0, 0.08 + (H - 0.08) / 2, -D / 2 + t / 2, { ...BODY, r: 0.003 });
  k.box('paint', W + 0.03, 0.035, D + 0.03, 0, H - 0.0175, 0, { ...BODY, r: 0.008 });
  k.box('paint', W + 0.01, 0.012, D + 0.01, 0, H - 0.04, 0, { ...BODY, r: 0.004 });
  k.box('paint', W - 2 * t, t, D - t, 0, 0.09, 0, { ...BODY, r: 0.003 });
  for (const sx of [-1, 1]) { // lifting eyes
    k.box('paint', 0.05, 0.01, 0.05, sx * 0.38, H + 0.005, 0, { ...BODY, r: 0.003 });
    k.tor('metal', 0.025, 0.007, sx * 0.38, H + 0.035, 0, { ...FIN.zinc, ts: 16, rs: 6 });
  }
  // front frame (folded posts around the door opening)
  for (const sx of [-1, 1]) k.box('paint', 0.03, 1.38, 0.025, sx * (W / 2 - 0.015), 0.1 + 0.65, D / 2 - 0.0125, { ...BODY, r: 0.004 });
  // ---- fixed header instrument panel ----
  const hy = 1.53;
  k.box('paint', W - 0.04, 0.3, 0.02, 0, hy, D / 2 - 0.01, { ...BODY, r: 0.004 });
  k.box('paint', W - 0.08, 0.26, 0.004, 0, hy, D / 2 + 0.001, { ...BODY, r: 0.003, tint: 0x6e747a });
  P.cornerScrews(k, W - 0.08, 0.26, 0, hy, D / 2 + 0.003, 0.014, { r: 0.0032 });
  // CRT status screen in a gasketed bezel
  k.box('paint', 0.31, 0.21, 0.022, -0.2, hy, D / 2 + 0.006, { ...DARK, r: 0.012 });
  k.ext('#0b0b0c:r', frameShape(0.285, 0.19, 0.012, 0.264, 0.174, 0.008), 0.004, -0.2, hy, D / 2 + 0.0155, { bev: 0.0012, curveSeg: 3 });
  k.screen('main', 0.26, 0.17, -0.2, hy, D / 2 + 0.0155, { style: 'crt', text: 'GRID UNIT GU-7\nPHASE: --\nFUSE: MISSING\nBREAKER: OFF', bulge: 0.006, aspect: 0.26 / 0.17 });
  // panel meters (static needles)
  const meter = (x, label, max, v) => {
    k.box('paint', 0.092, 0.092, 0.03, x, hy + 0.04, D / 2 + 0.012, { ...DARK, r: 0.006 });
    const reg = k.reg('pm_' + label, 120, 120, (c, w, h) => {
      c.fillStyle = '#ece6d4'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#111'; c.lineWidth = 2;
      c.beginPath(); c.arc(w / 2, h * 0.86, w * 0.62, -PI * 0.78, -PI * 0.22); c.stroke();
      for (let i = 0; i <= 10; i++) { const a = -PI * 0.78 + (i / 10) * PI * 0.56; c.lineWidth = i % 5 ? 1.5 : 3; c.beginPath(); c.moveTo(w / 2 + Math.cos(a) * w * 0.62, h * 0.86 + Math.sin(a) * w * 0.62); c.lineTo(w / 2 + Math.cos(a) * w * (i % 5 ? 0.56 : 0.52), h * 0.86 + Math.sin(a) * w * (i % 5 ? 0.56 : 0.52)); c.stroke(); }
      txt(c, '0', w * 0.2, h * 0.36, 11, { col: '#111', f: 'bold' }); txt(c, String(max), w * 0.82, h * 0.36, 11, { col: '#111', f: 'bold' });
      txt(c, label, w / 2, h * 0.7, 14, { col: '#111', f: 'bold' });
      c.strokeStyle = '#c0201a'; c.lineWidth = 2; const a = -PI * 0.78 + v * PI * 0.56;
      c.beginPath(); c.moveTo(w / 2, h * 0.86); c.lineTo(w / 2 + Math.cos(a) * w * 0.6, h * 0.86 + Math.sin(a) * w * 0.6); c.stroke();
      grime(c, w, h, 0.5, 7);
    });
    k.label(reg, 0.076, 0.076, x, hy + 0.04, D / 2 + 0.0272);
    k.box('glass', 0.078, 0.078, 0.002, x, hy + 0.04, D / 2 + 0.0285, { r: 0 });
  };
  meter(0.06, 'AMPS', 400, 0.02);
  meter(0.18, 'VOLTS', 600, 0.04);
  k.parts.lamp = P.pilotLamp(k, 0.33, hy + 0.05, D / 2 + 0.004, 0.025, 'red', { name: 'lamp', bezel: 'chrome' });
  const lampRing = k.reg('lamp_ring', 128, 40, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'SYSTEM', w / 2, h / 2, h * 0.55, { col: '#e8c860', f: 'mono' }); });
  k.label(lampRing, 0.08, 0.025, 0.33, hy + 0.0, D / 2 + 0.0035);
  const np = k.reg('gu_plate', 280, 80, (c, w, h) => {
    c.fillStyle = '#16181b'; rrect(c, 0, 0, w, h, 8); c.fill();
    txt(c, 'R.O.O.M. GRID UNIT', w / 2, h * 0.36, h * 0.3, { col: '#e8c860', maxW: w * 0.92 });
    txt(c, 'GU-7 • 480V 3Ø • 200A', w / 2, h * 0.74, h * 0.2, { col: '#ccc', f: 'mono' });
    rubOff(c, w, h, 0.8, 3);
  }, 'g');
  P.plate(k, np, 0.26, 0.074, 0.22, hy - 0.08, D / 2 + 0.003, { fin: FIN.black, rivets: 2, rd: 0.012 });
  // key switch
  k.cyl('metal', 0.014, 0.008, -0.2 + 0.0, hy - 0.125, D / 2 + 0.007, { ...FIN.chrome, axis: 'z', seg: 14, bev: 0.002 });
  // ---- interior: mounting plate, terminal blocks, wiring ----
  const tz = -D / 2 + 0.036;
  k.box('metal', W - 0.12, 1.2, 0.006, 0, 0.75, -D / 2 + 0.027, { ...FIN.zinc, r: 0.002, rust: 0.05 });
  P.cornerScrews(k, W - 0.12, 1.2, 0, 0.75, -D / 2 + 0.03, 0.02, { r: 0.004, kind: 'hex' });
  const left = o.leftOrder ?? ['red', 'blue', 'green', 'yellow'];
  const right = o.rightOrder ?? ['yellow', 'red', 'blue', 'green'];
  k.anchors.terminals = [];
  k.params.terminalColors = [];
  k.params.terminalSides = [];
  const rows = [1.18, 1.04, 0.9, 0.76];
  [[left, -0.22, 'left'], [right, 0.22, 'right']].forEach(([cols, x, side]) => {
    k.box('#1a1a1b:p', 0.12, 0.56, 0.02, x, 0.97, tz + 0.01, { r: 0.004 });
    for (let i = 0; i <= 4; i++) k.box('#202022:p', 0.112, 0.008, 0.07, x, 1.25 - i * 0.14, tz + 0.045, { r: 0 });
    cols.forEach((col, i) => {
      const y = rows[i];
      k.box(hex(WIRE_COL[col]) + ':s', 0.07, 0.068, 0.05, x, y, tz + 0.045, { r: 0.005 });
      k.box('#ece6d2', 0.05, 0.012, 0.0015, x, y - 0.024, tz + 0.0705, { r: 0 });
      k.cyl('metal', 0.0105, 0.04, x, y, tz + 0.085, { ...FIN.brass, axis: 'z', seg: 10 });
      k.cyl('metal', 0.017, 0.006, x, y, tz + 0.073, { ...FIN.brass, axis: 'z', seg: 6, bev: 0.001, bevSeg: 1 });
      k.cyl('metal', 0.016, 0.0025, x, y, tz + 0.0715 - 0.004, { ...FIN.brass, axis: 'z', seg: 10 });
      k.anchors.terminals.push(V3(x, y, tz + 0.105));
      k.params.terminalColors.push(col);
      k.params.terminalSides.push(side);
    });
  });
  const phase = k.reg('phase', 200, 260, (c, w, h) => {
    c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h);
    txt(c, 'PHASE MATCH', w / 2, h * 0.08, h * 0.07, { col: '#111' });
    ['red', 'blue', 'green', 'yellow'].forEach((col, i) => { c.strokeStyle = hex(WIRE_COL[col]); c.lineWidth = 6; c.beginPath(); c.moveTo(w * 0.12, h * (0.22 + i * 0.18)); c.bezierCurveTo(w * 0.5, h * (0.22 + i * 0.18), w * 0.5, h * (0.22 + ((i + 1) % 4) * 0.18), w * 0.88, h * (0.22 + ((i + 1) % 4) * 0.18)); c.stroke(); });
    txt(c, 'COLOR TO COLOR. ALWAYS.', w / 2, h * 0.94, h * 0.05, { col: '#a01a14', f: 'mono', maxW: w * 0.95 });
    grime(c, w, h, 0.8, 4);
  });
  k.label(phase, 0.2, 0.26, 0, 1.0, tz + 0.0015);
  // wire ducts (slotted trunking) + bundles
  for (const x of [-0.41, 0.41]) {
    k.box('#8e9093:p', 0.05, 1.12, 0.05, x, 0.74, tz + 0.025, { r: 0.002 });
    for (let i = 0; i < 18; i++) k.box('#5c5e60:p', 0.052, 0.012, 0.0015, x, 0.22 + i * 0.06, tz + 0.0505, { r: 0 });
  }
  ['red', 'blue', 'green', 'yellow'].forEach((col, i) => {
    P.cable(k, [[-0.4 + i * 0.008, 1.3, tz + 0.05], [-0.36, 1.25, tz + 0.07], [-0.3, rows[left.indexOf(col)] + 0.03, tz + 0.06], [-0.255, rows[left.indexOf(col)], tz + 0.045]], 0.0055, { tint: WIRE_COL[col], rough: 0.6, n: 12, radial: 6 });
    P.cable(k, [[0.4 - i * 0.008, 0.25, tz + 0.05], [0.36, 0.32, tz + 0.07], [0.3, rows[right.indexOf(col)] - 0.03, tz + 0.06], [0.255, rows[right.indexOf(col)], tz + 0.045]], 0.0055, { tint: WIRE_COL[col], rough: 0.6, n: 12, radial: 6 });
  });
  // DIN rail with contactors along the top
  k.box('metal', 0.6, 0.035, 0.008, 0, 1.3, tz + 0.012, { ...FIN.zinc, r: 0 });
  for (let i = 0; i < 6; i++) {
    const x = -0.24 + i * 0.096;
    k.box('#d6d2c6:p', 0.07, 0.085, 0.06, x, 1.3, tz + 0.045, { r: 0.003 });
    k.box('#2a2c2e:p', 0.06, 0.02, 0.004, x, 1.322, tz + 0.077, { r: 0 });
    k.cyl(i % 3 ? '#40ff70:e' : '#ffa830:e', 0.004, 0.003, x + 0.02, 1.282, tz + 0.0765, { axis: 'z', seg: 8 });
  }
  // fuse socket: ceramic holder with brass spring clips
  const fy = 0.5;
  k.box('#e2ddd0:g', 0.24, 0.085, 0.05, 0, fy, tz + 0.025, { r: 0.01 });
  for (const sx of [-1, 1]) {
    k.box('metal', 0.022, 0.05, 0.03, sx * 0.07, fy, tz + 0.06, { ...FIN.brass, r: 0.003 });
    for (const sy of [-1, 1]) k.box('metal', 0.02, 0.004, 0.026, sx * 0.07, fy + sy * 0.016, tz + 0.084, { ...FIN.brass, r: 0, rot: [sy * 0.35, 0, 0] });
  }
  const fuseSlot = k.grp(0, fy, tz + 0.08, { name: 'fuseSlot' });
  k.inside(fuseSlot, () => {
    k.cyl('#e8e2d2:p', 0.021, 0.12, 0, 0, 0, { axis: 'x', seg: 14 });
    for (const sx of [-1, 1]) {
      k.cyl('#b89a54:m', 0.023, 0.016, sx * 0.064, 0, 0, { axis: 'x', seg: 14, bev: 0.002, bevSeg: 1 });
      k.box('#b89a54:m', 0.03, 0.004, 0.02, sx * 0.084, 0, 0, { r: 0 });
    }
    const fl = k.reg('fuse_lbl', 120, 40, (c, w, h) => { c.fillStyle = '#e8e2d2'; c.fillRect(0, 0, w, h); txt(c, '200A gG', w / 2, h * 0.4, h * 0.38, { col: '#a01a14' }); txt(c, '500V ~', w / 2, h * 0.78, h * 0.24, { col: '#111', f: 'mono' }); });
    k.clabel(fl, 0.0212, 0.05, 1.6, 0, 0, 0, { a: 0, rot: [0, 0, HP] });
  });
  const fz = k.reg('fuse200', 160, 36, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'FUSE 200A', w / 2, h / 2, h * 0.6, { col: '#e8c860', f: 'mono' }); });
  k.label(fz, 0.16, 0.035, 0, fy - 0.07, tz + 0.0015);
  // big breaker: housing + lever (rotation.x)
  const bx = 0.3, by = 0.4;
  k.box('paint', 0.15, 0.25, 0.1, bx, by, tz + 0.05, { ...DARK, r: 0.01 });
  for (const sx of [-1, 1]) k.box('metal', 0.012, 0.11, 0.04, bx + sx * 0.042, by, tz + 0.115, { ...FIN.steel, r: 0.002 });
  const breakerBuild = () => {
    k.cyl('#9a9ea2:m', 0.016, 0.084, 0, 0, 0, { axis: 'x', seg: 12 });
    k.box('#9a9ea2:m', 0.03, 0.026, 0.15, 0, 0, 0.075, { r: 0.006 });
    k.put('#b3221a:s', axisGeo(cylGeo(0.022, 0.1, { seg: 14, bev: 0.006, bevSeg: 2 }), 'z'), 0, 0, 0.19);
  };
  const onoff = k.reg('onoff', 120, 60, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'ON ▲', w / 2, h * 0.3, h * 0.28, { col: '#8f8', f: 'mono' }); txt(c, 'OFF ▼', w / 2, h * 0.72, h * 0.28, { col: '#f88', f: 'mono' }); });
  k.label(onoff, 0.12, 0.06, bx - 0.13, by, tz + 0.0015);
  // ---- door (pivot on the left edge; negative rotation.y opens) ----
  const DW = W - 0.02, DH = 1.3, dy0 = 0.1;
  const doorBuild = () => {
    const cx = DW / 2;
    k.box('paint', DW, DH, 0.004, cx, dy0 + DH / 2, 0.023, { ...BODY, r: 0.0018, div: 0.2, dent: 0.0012 });
    for (const sx of [-1, 1]) k.box('paint', 0.004, DH - 0.006, 0.022, cx + sx * (DW / 2 - 0.002), dy0 + DH / 2, 0.011, { ...BODY, r: 0.0015 });
    for (const sy of [-1, 1]) k.box('paint', DW - 0.008, 0.004, 0.022, cx, dy0 + DH / 2 + sy * (DH / 2 - 0.002), 0.011, { ...BODY, r: 0.0015 });
    k.box('paint', DW - 0.12, DH - 0.14, 0.004, cx, dy0 + DH / 2, 0.027, { ...BODY, r: 0.006 });   // pressed panel
    P.louvre(k, cx, dy0 + 0.2, 0.0255, 0.5, 0.18, 6, { mo: BODY });
    P.louvre(k, cx, dy0 + DH - 0.15, 0.0255, 0.5, 0.12, 4, { mo: BODY });
    const dz = k.reg('hv_sign', 300, 220, (c, w, h) => {
      c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c0201a'; c.fillRect(0, 0, w, h * 0.28);
      txt(c, 'DANGER', w / 2, h * 0.15, h * 0.2, { col: '#fff' });
      hazardTri(c, w * 0.2, h * 0.62, h * 0.4, 'bolt');
      ['HIGH VOLTAGE', 'INSIDE. WEAR', 'YOUR GLOVES.'].forEach((s, i) => txt(c, s, w * 0.64, h * (0.45 + i * 0.16), h * 0.1, { col: '#111', maxW: w * 0.6 }));
      grime(c, w, h, 1, 17, { corner: 0.1 }); rubOff(c, w, h, 0.8, 5);
    });
    k.label(dz, 0.3, 0.22, cx, 0.95, 0.0293);
    const arc = k.reg('arcflash', 200, 120, (c, w, h) => { c.fillStyle = '#f2a01c'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(0, 0, w, h * 0.25); txt(c, 'WARNING', w / 2, h * 0.13, h * 0.17, { col: '#f2a01c' }); txt(c, 'ARC FLASH HAZARD', w / 2, h * 0.45, h * 0.13, { col: '#111', maxW: w * 0.9 }); txt(c, 'PPE CAT 2 REQUIRED', w / 2, h * 0.65, h * 0.1, { col: '#111', f: 'mono', maxW: w * 0.9 }); txt(c, 'CLONES: CAT 0', w / 2, h * 0.83, h * 0.1, { col: '#111', f: 'mono' }); grime(c, w, h, 1, 31); });
    k.label(arc, 0.16, 0.096, cx, 0.66, 0.0293);
    // swing handle in a recessed cup + lock cylinder
    k.box('#24262a:p', 0.05, 0.2, 0.01, DW - 0.06, 0.75, 0.027, { r: 0.008 });
    k.box('#c4c7ca:c', 0.026, 0.16, 0.012, DW - 0.06, 0.75, 0.04, { r: 0.006 });
    k.box('#c4c7ca:c', 0.03, 0.03, 0.03, DW - 0.06, 0.82, 0.035, { r: 0.006 });
    k.cyl('#b8a060:m', 0.008, 0.006, DW - 0.06, 0.66, 0.031, { axis: 'z', seg: 12 });
    // inside: wiring diagram pocket
    const diag = k.reg('wiring_diag', 240, 300, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); txt(c, 'WIRING DIAGRAM', w / 2, 14, 12, { col: '#111' }); c.strokeStyle = '#333'; c.lineWidth = 1.5; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(20, 40 + i * 22); c.lineTo(w - 20, 40 + i * 22 + (i % 3) * 8); c.stroke(); c.strokeRect(10, 34 + i * 22, 12, 12); } grime(c, w, h, 0.7, 6); });
    k.label(diag, 0.24, 0.3, cx, 0.8, 0.0205, { rot: [0, PI, 0] });
    for (const y of [0.3, 0.75, 1.2]) P.hingeHalf(k, 0, y, 0.012, 0.08, { part: 1, leaf: 1, leafZ: 0.013, slot: '#8d9195:m', r: 0.007 });
  };
  // door + breaker lever: bones of one skinned mesh per material
  const [breaker, door] = k.bones('rig', [[bx, by, tz + 0.12, [0.7, 0, 0], 'breaker'], [-W / 2 + 0.01, 0, D / 2, null, 'door']], (i) => (i ? doorBuild() : breakerBuild()));
  for (const y of [0.3, 0.75, 1.2]) P.hingeHalf(k, -W / 2 + 0.01, y, D / 2 + 0.012, 0.08, { part: 0, r: 0.007 });
  // conduits out of the top
  for (const x of [-0.3, -0.15]) {
    k.cyl('metal', 0.032, 0.02, x, H + 0.01, -0.1, { ...FIN.zinc, seg: 6, bev: 0.002, bevSeg: 1 });
    P.conduit(k, [x, H + 0.02, -0.1], [x, H + 0.8, -0.1], 0.025, { couplings: 1 });
  }
  P.streak(k, -0.35, 0.55, D / 2 + 0.0002, 0.08, 0.3, { col: '60,50,36', alpha: 0.3 });
  k.collide(cbox(W, H, D, 0, H / 2, 0));
  k.anchors.fuseSocket = V3(0, fy, tz + 0.08);
  k.parts.door = door;
  k.parts.fuseSlot = fuseSlot;
  k.parts.breaker = breaker;
  k.params.doorOpenSign = -1;
  k.params.breakerOn = -0.7;
  k.params.breakerOff = 0.7;
  k.params.doorCollider = cbox(DW, DH, 0.025, DW / 2, dy0 + DH / 2, 0.0125);
  return k.done({ mass: 320, material: 'metal' });
}

// ---------------------------------------------------------------------------
// MECHANICAL: riveted copper boiler on cast cradles, flywheel + belt to a dynamo, pressure gauge on a
// pigtail siphon, cracked pressure pipe (anchors.cracks), bolted blind flange (parts.bolts), hand
// crank, smokestack with spark arrestor, sight glass, safety valve, valve wheel, junction box lamp.
// ---------------------------------------------------------------------------
export function b_generator_mech(o) {
  const k = new DKit('generator_mech', { wear: { chip: 0.35, rust: 0.45, grime: 0.7, dust: 0.5 }, ao: { res: 60 } });
  k.atlas(1024, 1024);
  const IRON = { tint: 0x2b2f2e, chip: 0.35 };
  const COPPER = { ...FIN.copper, tint: 0xb87650, rough: 1.0, rust: 0.25 };
  const BRASS = { ...FIN.brass, rust: 0.1 };
  const STEEL = { ...FIN.steel, rust: 0.4 };
  const RUST = { ...FIN.iron, tint: 0x4a3a30, rust: 0.95 };
  // ---- riveted channel skid ----
  for (const sz of [-1, 1]) P.channel(k, 'paint', 1.6, 0.12, 0.06, 0.006, 0, 0.06, sz * 0.45, { ...IRON, flip: sz > 0 });
  for (const x of [-0.7, -0.22, 0.25, 0.7]) { k.push(x, 0.055, 0, [0, HP, 0]); P.channel(k, 'paint', 0.84, 0.1, 0.05, 0.006, 0, 0, -0.025, IRON); k.pop(); }
  k.box('paint', 1.5, 0.008, 0.82, 0, 0.116, 0, { ...IRON, r: 0, div: 0.3 });
  for (let i = 0; i < 9; i++) for (const sz of [-1, 1]) P.rivet(k, -0.72 + i * 0.18, 0.08, sz * 0.453, { dir: sz > 0 ? 'z' : '-z', r: 0.006, seg: 6, fin: { tint: 0x3a3c3a, rough: 1.3 } });
  for (const [x, z] of [[-0.72, -0.38], [0.72, -0.38], [-0.72, 0.38], [0.72, 0.38]]) { k.cyl('paint', 0.045, 0.012, x, 0.006, z, { ...IRON, seg: 10 }); P.screw(k, x, 0.012, z, { kind: 'hex', r: 0.011, dir: 'y' }); }
  // ---- boiler drum on cradles ----
  const dx = -0.22, dy = 0.6, dr = 0.3, dl = 0.95;
  k.cyl('metal', dr, dl - 0.08, dx, dy, 0, { ...COPPER, axis: 'x', seg: 40, open: true });
  for (const s of [-1, 1]) {
    k.lathe('metal', [[dr + 0.004, 0], [dr + 0.006, 0.02, 2], [dr * 0.92, 0.075], [dr * 0.7, 0.11], [dr * 0.35, 0.13], [0, 0.135]], dx + s * (dl / 2 - 0.04), dy, 0, { ...COPPER, axis: s > 0 ? 'x' : '-x', seg: 30, rings: false });
    k.tor('metal', dr + 0.006, 0.012, dx + s * (dl / 2 - 0.04), dy, 0, { ...COPPER, axis: 'x', ts: 32, rs: 5 });
  }
  // hand-hole cover on the right head
  k.push(dx + dl / 2 + 0.088, dy - 0.04, 0, [0, HP, 0]);
  k.cyl('paint', 0.09, 0.016, 0, 0, 0, { ...IRON, axis: 'z', seg: 18, bev: 0.004, s: [1, 0.7, 1] });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.screw(k, Math.cos(a) * 0.076, Math.sin(a) * 0.053, 0.008, { kind: 'hex', r: 0.006 }); }
  k.pop();
  // riveted girth seams
  for (let i = 0; i < 3; i++) {
    const x = dx - dl / 2 + 0.16 + i * 0.315;
    k.tor('metal', dr + 0.003, 0.009, x, dy, 0, { ...COPPER, axis: 'x', ts: 32, rs: 4 });
    for (let j = 0; j < 12; j++) { const a = (j / 12) * TAU; k.push(x, dy + Math.sin(a) * (dr + 0.011), Math.cos(a) * (dr + 0.011), [-a + HP, 0, 0, 'XYZ']); P.rivet(k, 0, 0, 0, { dir: 'y', r: 0.0065, seg: 6, fin: COPPER }); k.pop(); }
  }
  // cradles (cast, with webs)
  for (const x of [dx - 0.3, dx + 0.3]) {
    k.box('paint', 0.1, 0.18, 0.56, x, 0.21, 0, { ...IRON, r: 0.012 });
    k.lathe('paint', [[0.305, -0.05], [0.32, -0.045, 2], [0.32, 0.045, 2], [0.305, 0.05]], x, dy, 0, { ...IRON, axis: 'x', seg: 20, phi0: PI * 0.62, phiLen: PI * 0.76 });
    for (const sz of [-1, 1]) k.box('paint', 0.022, 0.3, 0.05, x, 0.33, sz * 0.21, { ...IRON, r: 0.005, rot: [sz * 0.5, 0, 0] });
  }
  // sight glass (water level) with brass fittings on the front
  const sgx = dx + 0.2, sgz = Math.cos(0.2) * (dr + 0.03);
  k.cyl('metal', 0.012, 0.03, sgx, dy + 0.12, sgz, { ...BRASS, axis: 'z', seg: 8 });
  k.cyl('metal', 0.012, 0.03, sgx, dy - 0.12, sgz, { ...BRASS, axis: 'z', seg: 8 });
  for (const s of [-1, 1]) k.cyl('metal', 0.014, 0.03, sgx, dy + s * 0.105, sgz + 0.022, { ...BRASS, seg: 6, bev: 0.002, bevSeg: 1 });
  k.cyl('glass', 0.008, 0.18, sgx, dy, sgz + 0.022, { seg: 10, open: true });
  k.cyl('#5a7a6a:g', 0.006, 0.09, sgx, dy - 0.045, sgz + 0.022, { seg: 8 });
  // safety valve + lever weight on top
  k.cyl('metal', 0.03, 0.06, dx - 0.15, dy + dr + 0.03, -0.05, { ...BRASS, seg: 14, bev: 0.004 });
  k.lathe('metal', [[0.026, 0], [0.026, 0.02], [0.016, 0.05], [0.0, 0.06]], dx - 0.15, dy + dr + 0.06, -0.05, { ...BRASS, seg: 12 });
  P.rod(k, 'metal', [dx - 0.15, dy + dr + 0.1, -0.05], [dx + 0.08, dy + dr + 0.085, -0.05], 0.006, { ...STEEL });
  k.sph('metal', 0.03, dx + 0.07, dy + dr + 0.085, -0.05, { ...FIN.iron, ws: 12, hs: 8 });
  // ---- flywheel (rotates around X) on an A-frame bearing pedestal ----
  const fx = 0.62, fy = 0.62, FR = 0.42;
  for (const sz of [-1, 1]) k.box('paint', 0.08, 0.62, 0.06, fx + 0.12, 0.38, sz * 0.12, { ...IRON, rot: [sz * 0.25, 0, 0], r: 0.005 });
  k.box('paint', 0.12, 0.12, 0.15, fx + 0.12, fy, 0, { ...IRON, r: 0.015 });
  k.cyl('metal', 0.045, 0.13, fx + 0.12, fy, 0, { ...BRASS, axis: 'x', seg: 16, bev: 0.004 });
  k.cyl('metal', 0.035, 0.42, fx + 0.06, fy, 0, { ...STEEL, axis: 'x', seg: 14 });
  // oil cup on the bearing
  k.cyl('metal', 0.006, 0.03, fx + 0.12, fy + 0.07, 0, { ...BRASS, seg: 8 });
  k.lathe('metal', [[0.004, 0], [0.018, 0.01], [0.02, 0.03], [0.012, 0.042], [0, 0.044]], fx + 0.12, fy + 0.085, 0, { ...BRASS, seg: 12 });
  const flyBuild = () => {
    k.lathe('paint', [[FR - 0.065, -0.045], [FR - 0.005, -0.05, 2], [FR + 0.006, -0.02], [FR + 0.008, 0.02], [FR - 0.005, 0.05, 2], [FR - 0.065, 0.045], [FR - 0.07, 0], [FR - 0.065, -0.045]], 0, 0, 0, { ...IRON, axis: 'x', seg: 40, rings: false, chip: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const pts = [];
      for (let j = 0; j <= 6; j++) { const t = j / 6, r = 0.085 + t * (FR - 0.15), b = Math.sin(t * PI) * 0.035; pts.push([0, Math.cos(a + b * 2) * r, Math.sin(a + b * 2) * r]); }
      k.tube('paint', pts, (t) => [0.018 - t * 0.005, 0.01], { ...IRON, radial: 6, caps: false });
    }
    k.cyl('paint', 0.09, 0.12, 0, 0, 0, { ...IRON, axis: 'x', seg: 18, bev: 0.008 });
    k.cyl('#c8a254:m', 0.05, 0.13, 0, 0, 0, { axis: 'x', seg: 14 });
    P.screw(k, 0, 0.09, 0, { kind: 'hex', r: 0.008, dir: 'y', slot: '#7a7d80:m' });
    k.box('paint', 0.012, 0.07, 0.035, -0.045, FR - 0.03, 0, { tint: 0xb3221a, r: 0.003, chip: 0.4 });
  };
  // flat leather belt to the dynamo pulley
  const py = 1.22, pr = 0.07, bxp = fx - 0.04;
  const belt = [];
  for (let i = 0; i <= 26; i++) { const a = HP + (i / 26) * PI; belt.push([bxp, fy + Math.cos(a) * (FR + 0.012), Math.sin(a) * (FR + 0.012)]); }
  for (let i = 1; i < 14; i++) { const a = -HP + (i / 14) * PI; belt.push([bxp, py + Math.cos(a) * (pr + 0.006), Math.sin(a) * (pr + 0.006)]); }
  k.tube('#3a2416:p', belt.map((p) => V3(...p)), [0.004, 0.026], { closed: true, radial: 6, up: [0, 0, 1] });
  // ---- dynamo on its stand ----
  const dyx = 0.33;
  k.box('paint', 0.32, 0.26, 0.16, dyx, 0.98, 0, { ...IRON, r: 0.012 });
  k.box('paint', 0.36, 0.02, 0.2, dyx, 1.11, 0, { ...IRON, r: 0.004 });
  k.cyl('paint', 0.125, 0.3, dyx, py, 0, { ...IRON, axis: 'x', seg: 24, bev: 0.006 });
  for (let i = 0; i < 2; i++) k.lathe('metal', [[0.126, -0.06], [0.138, -0.055, 2], [0.138, 0.055, 2], [0.126, 0.06]], dyx - 0.06 + i * 0.12, py, 0, { ...COPPER, axis: 'x', seg: 24, rust: 0.05 });
  k.cyl('metal', 0.08, 0.05, dyx - 0.18, py, 0, { ...BRASS, axis: 'x', seg: 18 });
  for (let i = 0; i < 2; i++) { const a = PI * 0.25 + i * PI; k.box('#26282a:p', 0.03, 0.03, 0.04, dyx - 0.2, py + Math.sin(a) * 0.09, Math.cos(a) * 0.09, { r: 0.004, rot: [-a, 0, 0] }); }
  k.cyl('metal', pr, 0.055, bxp, py, 0, { ...STEEL, axis: 'x', seg: 18, bev: 0.004 });
  k.cyl('metal', 0.015, 0.12, fx - 0.1, py, 0, { ...STEEL, axis: 'x', seg: 8 });
  const dynp = k.reg('dyn_plate', 200, 60, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f2d68c'); g.addColorStop(1, '#a07a32'); c.fillStyle = g; rrect(c, 0, 0, w, h, h / 2); c.fill(); txt(c, 'DYNAMO 110V DC', w / 2, h / 2, h * 0.4, { col: '#2e1e04', f: 'serif', maxW: w * 0.86 }); }, 'm');
  k.label(dynp, 0.13, 0.04, dyx, 0.98, 0.0805);
  // ---- smokestack with spark arrestor ----
  const sx0 = -0.52, sz0 = -0.2;
  k.cyl('metal', 0.07, 0.76, sx0, 1.255, sz0, { ...RUST, seg: 16, open: true });
  for (let i = 0; i < 3; i++) k.tor('metal', 0.072, 0.006, sx0, 0.95 + i * 0.25, sz0, { ...RUST, axis: 'y', ts: 16, rs: 4 });
  k.cyl('metal', 0.1, 0.03, sx0, 0.89, sz0, { ...RUST, seg: 16, bev: 0.006 });
  k.lathe('metal', [[0.072, 0], [0.11, 0.05, 2], [0.11, 0.06], [0.06, 0.1], [0.0, 0.11]], sx0, 1.63, sz0, { ...RUST, seg: 16 });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; P.rod(k, 'metal', [sx0 + Math.cos(a) * 0.072, 1.63, sz0 + Math.sin(a) * 0.072], [sx0 + Math.cos(a) * 0.1, 1.68, sz0 + Math.sin(a) * 0.1], 0.004, RUST); }
  P.stain(k, sx0, 1.6, sz0 + 0.072, 0.1, 0.12, { col: '10,8,6', alpha: 0.6 });
  k.anchors.exhaust = V3(sx0, 1.7, sz0);
  // ---- pressure gauge on a pigtail siphon (parts.needle) ----
  const gx = 0.02;
  P.rod(k, 'metal', [gx, 0.9, 0.12], [gx, 1.07, 0.12], 0.008, BRASS);
  const coil = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU * 1.0; coil.push(V3(gx + Math.sin(a) * 0.025, 1.07 + (1 - Math.cos(a)) * 0.025, 0.12 + i * 0.0004)); }
  k.tube('metal', coil, 0.006, { ...BRASS, radial: 6, caps: false });
  P.rod(k, 'metal', [gx, 1.07, 0.136], [gx, 1.13, 0.14], 0.008, BRASS);
  k.box('metal', 0.04, 0.04, 0.05, gx, 1.2, 0.13, { ...BRASS, r: 0.006 });
  const needlePl = P.gauge(k, gx, 1.2, 0.16, 0.07, { label: 'PSI', max: 200, red: 0.8, value: 0.15, bezel: BRASS, cup: BRASS, name: 'needle', key: 'psi', screws: true, noNeedle: true });
  // ---- cracked pressure pipe along X at the front (anchors.cracks) ----
  const cy = 1.04, cz = 0.24, cpr = 0.05;
  k.tube('metal', [[-0.62, dy + dr - 0.02, 0.1], [-0.62, cy, 0.1], [-0.62, cy, cz]], cpr, { ...COPPER, round: 0.07, rseg: 6, radial: 14, caps: false });
  k.tube('metal', [[0.12, cy, cz], [0.18, cy, cz], [0.18, cy, 0.1], [0.18, 0.95, 0.1]], cpr, { ...COPPER, round: 0.05, rseg: 5, radial: 14, caps: false });
  k.cyl('metal', cpr, 0.74, -0.25, cy, cz, { ...STEEL, tint: 0x7a5a42, axis: 'x', seg: 18, open: true });
  for (const x of [-0.6, 0.1]) {
    k.cyl('metal', cpr + 0.028, 0.022, x, cy, cz, { ...STEEL, axis: 'x', seg: 16, bev: 0.003, bevSeg: 1 });
    for (let j = 0; j < 4; j++) { const a = (j / 4) * TAU + PI / 4; k.push(x + (x < 0 ? 0.013 : -0.013), cy + Math.sin(a) * (cpr + 0.016), cz + Math.cos(a) * (cpr + 0.016)); P.screw(k, 0, 0, 0, { kind: 'hex', r: 0.006, dir: x < 0 ? 'x' : '-x' }); k.pop(); }
  }
  const crackArt = k.reg('crack', 128, 96, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(30,14,6,0.85)'); g.addColorStop(0.5, 'rgba(90,50,20,0.55)'); g.addColorStop(1, 'rgba(90,50,20,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#080402'; c.lineWidth = 3; c.lineJoin = 'miter';
    c.beginPath(); c.moveTo(w * 0.08, h * 0.5); c.lineTo(w * 0.28, h * 0.42); c.lineTo(w * 0.45, h * 0.57); c.lineTo(w * 0.6, h * 0.43); c.lineTo(w * 0.76, h * 0.58); c.lineTo(w * 0.92, h * 0.5); c.stroke();
    c.lineWidth = 1.5; c.beginPath(); c.moveTo(w * 0.45, h * 0.57); c.lineTo(w * 0.5, h * 0.78); c.moveTo(w * 0.6, h * 0.43); c.lineTo(w * 0.63, h * 0.22); c.stroke();
    c.fillStyle = 'rgba(220,230,235,0.35)'; for (let i = 0; i < 8; i++) { c.beginPath(); c.arc(w * (0.3 + i * 0.06), h * (0.45 + (i % 3) * 0.05), 1.5, 0, TAU); c.fill(); }
  });
  k.anchors.cracks = [];
  [-0.48, -0.26, -0.04].forEach((x, i) => {
    const a = i * 0.25 - 0.25;
    k.push(x, cy, cz, [0, 0, HP]);
    k.clabel(crackArt, cpr + 0.0012, 0.09, 1.7, 0, 0, 0, { a: -a, seg: 8, decal: true });
    k.pop();
    k.anchors.cracks.push(V3(x, cy - Math.sin(a) * cpr, cz + Math.cos(a) * cpr));
  });
  // valve wheel on the riser
  k.cyl('metal', 0.04, 0.08, -0.62, cy + 0.04, 0.1, { ...BRASS, seg: 10, bev: 0.006 });
  P.rod(k, 'metal', [-0.62, cy + 0.08, 0.1], [-0.62, cy + 0.14, 0.1], 0.006, STEEL);
  k.tor('paint', 0.07, 0.009, -0.62, cy + 0.14, 0.1, { tint: 0xa3261c, axis: 'y', ts: 20, rs: 6, chip: 0.5 });
  for (let i = 0; i < 3; i++) k.box('paint', 0.14, 0.01, 0.012, -0.62, cy + 0.14, 0.1, { tint: 0xa3261c, rot: [0, (i / 3) * PI, 0], r: 0.003, chip: 0.5 });
  // blind flange stub with 4 loose bolts (axis +Z, parts.bolts)
  const bx0 = -0.42, by0 = 0.5;
  k.cyl('metal', 0.07, 0.16, bx0, by0, dr * Math.cos(0.33) + 0.06, { ...COPPER, axis: 'z', seg: 18 });
  k.cyl('metal', 0.12, 0.025, bx0, by0, 0.42, { ...STEEL, axis: 'z', seg: 20, bev: 0.004, bevSeg: 1 });
  k.cyl('metal', 0.12, 0.022, bx0, by0, 0.4455, { ...STEEL, axis: 'z', seg: 20, bev: 0.004, bevSeg: 1 });
  k.tor('#111112:r', 0.105, 0.0025, bx0, by0, 0.4335, { ts: 24, rs: 4 });
  const boltPl = [0, 1, 2, 3].map((i) => { const a = PI / 4 + (i * PI) / 2; return [bx0 + Math.cos(a) * 0.088, by0 + Math.sin(a) * 0.088, 0.4565 + [0.0, 0.012, 0.004, 0.02][i], [0, 0, i * 0.4], 'bolt_' + i]; });
  const boltBuild = () => {
    k.cyl('#9a9da0:m', 0.017, 0.004, 0, 0, 0.002, { axis: 'z', seg: 12 });
    k.cyl('#8a8d90:m', 0.014, 0.012, 0, 0, 0.01, { axis: 'z', seg: 6, bev: 0.0015, bevSeg: 1 });
    k.cyl('#6a6c6e:m', 0.0075, 0.07, 0, 0, -0.035, { axis: 'z', seg: 8 });
  };
  k.anchors.boltFlange = V3(bx0, by0, 0.457);
  // hand crank on the flywheel axle end (rotates around X)
  const crankBuild = () => {
    k.cyl('#2c302f:p', 0.04, 0.05, 0, 0, 0, { axis: 'x', seg: 14, bev: 0.006 });
    k.box('#2c302f:p', 0.03, 0.26, 0.05, 0.02, 0.12, 0, { r: 0.012 });
    k.cyl('#9a9da0:m', 0.012, 0.08, 0.06, 0.24, 0, { axis: 'x', seg: 8 });
    k.put('#6a4528:p', axisGeo(latheGeo([[0, -0.06], [0.018, -0.058], [0.024, -0.03], [0.022, 0.03], [0.018, 0.058], [0, 0.06]], 12), 'x'), 0.13, 0.24, 0);
  };
  // every animated part (flywheel, crank, gauge needle, 4 loose bolts) is a bone of one skinned mesh per material
  const rig = k.bones('rig', [[fx, fy, 0, null, 'flywheel'], [fx + 0.27, fy, 0, null, 'crank'], needlePl, ...boltPl], (i) => (i === 0 ? flyBuild() : i === 1 ? crankBuild() : i === 2 ? P.needle(k, 0.07) : boltBuild()));
  const [fly, crank] = rig;
  k.parts.needle = rig[2];
  k.parts.bolts = rig.slice(3);
  for (const b of k.parts.bolts) b.userData.z0 = 0.4565;
  // junction box + status lamp (parts.lamp)
  k.box('paint', 0.14, 0.14, 0.1, 0.4, 0.3, 0.36, { ...IRON, r: 0.012 });
  P.cornerScrews(k, 0.14, 0.14, 0.4, 0.3, 0.41, 0.014, { r: 0.004 });
  k.parts.lamp = P.pilotLamp(k, 0.4, 0.32, 0.41, 0.025, 'amber', { name: 'lamp', bezel: 'brass' });
  P.gland(k, 0.4, 0.37, 0.36, 0.008, { dir: 'y', fin: FIN.brass });
  P.cable(k, [[0.4, 0.38, 0.36], [0.42, 0.6, 0.3], [0.38, 0.9, 0.12], [dyx - 0.12, py - 0.1, 0.06]], 0.007, { tint: 0x1a1612, n: 16 });
  // brass nameplate on the drum
  const np = k.reg('md_plate', 360, 80, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f6dc94'); g.addColorStop(0.45, '#c9a24e'); g.addColorStop(1, '#8a6a28'); c.fillStyle = g; rrect(c, 0, 0, w, h, h * 0.45); c.fill(); c.strokeStyle = 'rgba(60,40,8,0.7)'; c.lineWidth = 3; rrect(c, 6, 6, w - 12, h - 12, h * 0.35); c.stroke(); txt(c, 'R.O.O.M. MECHANO-DYNAMO Mk.I', w / 2, h * 0.42, h * 0.26, { col: '#2e1e04', f: 'serif', maxW: w * 0.84 }); txt(c, 'PAT. PENDING • 150 PSI MAX', w / 2, h * 0.72, h * 0.15, { col: '#3e2a08', f: 'serif', maxW: w * 0.7 }); }, 'm');
  k.push(dx - 0.12, dy - 0.06, 0, [0, 0, 0]);
  k.clabel(np, dr + 0.004, 0.07, 0.95, 0, 0, 0, { a: 0.35, seg: 10 });
  k.pop();
  P.streak(k, dx + 0.1, dy - 0.08, Math.cos(0.35) * (dr + 0.004), 0.05, 0.16, { col: '40,90,70', alpha: 0.35 });
  k.collide(cbox(1.6, 0.12, 0.9, 0, 0.06, 0));
  k.collide(ccyl(dr + 0.02, dl + 0.2, dx, dy, 0, [0, 0, HP]));
  k.collide(ccyl(FR + 0.01, 0.1, fx, fy, 0, [0, 0, HP]));
  k.collide(cbox(0.4, 0.6, 0.3, dyx, 1.05, 0));
  k.collide(ccyl(0.08, 0.8, -0.52, 1.25, -0.2));
  // front pipework (the welder's raycast lands on the cracked pipe itself), gauge, bolt flange, junction box
  k.collide(ccyl(cpr + 0.012, 0.86, -0.22, cy, cz, [0, 0, HP]));
  k.collide(cbox(0.16, 0.34, 0.16, -0.62, 1.03, 0.1));
  k.collide(cbox(0.12, 0.14, 0.2, 0.18, 1.0, 0.17));
  k.collide(cbox(0.16, 0.36, 0.1, gx, 1.1, 0.15));
  k.collide(ccyl(0.12, 0.2, bx0, by0, 0.36, [HP, 0, 0]));
  k.collide(cbox(0.14, 0.14, 0.12, 0.4, 0.3, 0.37));
  k.parts.flywheel = fly;
  k.parts.crank = crank;
  return k.done({ mass: 650, material: 'metal' });
}
