// Workshop: crafting workbench (butcher-block, vise, pegboard of tools, diagnostic CRT, task lamp) and the
// wall-mounted maintenance pipe cluster with its open floor duct (critter exit).
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, frameShape, rrShape, Geo, boxGeo, latheGeo, lerp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, hazardTri, drawPerforation } from './atlas.js';
import { emissiveMat } from './mats.js';
import { RNG } from '../../core/rng.js';

const STEEL = { ...FIN.steel, rust: 0.3 };

// ---------------------------------------------------------------------------
// WORKBENCH: laminated butcher-block top on a timber frame, lower shelf with toolbox + paint cans,
// cast vise, pegboard with tool shadows and hung tools, small CRT (screens.main), task lamp (parts.lamp)
// anchors.surfaceMin / surfaceMax / vise
// ---------------------------------------------------------------------------
export function b_workbench(o) {
  void o;
  const k = new DKit('workbench', { wear: { chip: 0.2, rust: 0.2, grime: 0.6, dust: 0.45 }, ao: { res: 64 } });
  const A = k.atlas(1024, 1024);
  const r = new RNG(7);
  const W = 1.8, D = 0.75, TY = 0.92;
  const TOP = { tint: 0xd8b888, rough: 0.9 }, FRAME = { tint: 0xa87a50, rough: 0.85 };
  // butcher-block top: 8 glued strips with slightly varying tone, dings and a burn mark
  for (let i = 0; i < 8; i++) k.box('wood', W, 0.07, D / 8 - 0.0015, 0, TY - 0.035, -D / 2 + (i + 0.5) * (D / 8), { tint: [0xd8b888, 0xceae7e, 0xdcbd8c, 0xc8a878][i % 4], rough: 0.9, r: 0.003, grain: 'x' });
  P.stain(k, 0.35, TY + 0.0008, 0.05, 0.22, 0.2, { col: '40,22,10', alpha: 0.45, rot: [-HP, 0, 0] });
  P.stain(k, -0.2, TY + 0.0008, 0.18, 0.1, 0.1, { col: '30,30,30', alpha: 0.5, ring: true, rot: [-HP, 0, 0] });
  P.scuffs(k, 0, TY + 0.0008, 0.1, 1.6, 0.6, { col: '60,40,20', alpha: 0.35, rot: [-HP, 0, 0] });
  // frame: apron, legs, stretchers, shelf
  k.box('wood', W - 0.06, 0.1, 0.03, 0, TY - 0.12, D / 2 - 0.05, { ...FRAME, r: 0.004 });
  for (const [x, z] of [[-W / 2 + 0.07, -D / 2 + 0.07], [W / 2 - 0.07, -D / 2 + 0.07], [-W / 2 + 0.07, D / 2 - 0.07], [W / 2 - 0.07, D / 2 - 0.07]]) {
    k.box('wood', 0.08, TY - 0.07, 0.08, x, (TY - 0.07) / 2, z, { ...FRAME, r: 0.006, grain: 'y' });
    k.box('#2a2622:r', 0.085, 0.012, 0.085, x, 0.006, z, { r: 0.002 });
  }
  for (const sz of [-1, 1]) k.box('wood', W - 0.1, 0.06, 0.04, 0, 0.18, sz * (D / 2 - 0.07), { ...FRAME, r: 0.004 });
  k.box('wood', W - 0.12, 0.025, D - 0.12, 0, 0.21, 0, { tint: 0xc8a878, rough: 0.95, r: 0.002 });
  for (const [x, z] of [[-W / 2 + 0.07, D / 2 - 0.035], [W / 2 - 0.07, D / 2 - 0.035]]) for (const y of [0.18, TY - 0.12]) P.screw(k, x, y, z + 0.006, { kind: 'hex', r: 0.007, rust: 0.6 });
  // shelf clutter: toolbox + paint cans
  k.box('paint', 0.5, 0.2, 0.22, -0.4, 0.323, 0, { tint: 0xa8261c, r: 0.012, chip: 0.4 });
  k.box('paint', 0.5, 0.012, 0.22, -0.4, 0.41, 0, { tint: 0x8a1e16, r: 0.004 });
  k.tube('metal', [[-0.55, 0.423, 0], [-0.55, 0.47, 0], [-0.25, 0.47, 0], [-0.25, 0.423, 0]], 0.008, { ...STEEL, round: 0.02, rseg: 4, radial: 8 });
  for (const sx of [-1, 1]) k.box('metal', 0.03, 0.04, 0.012, -0.4 + sx * 0.18, 0.4, 0.114, { ...FIN.chrome, r: 0.004 });
  for (const [x, c] of [[0.3, '#2a5fc0'], [0.48, '#d9a92a']]) {
    k.cyl('metal', 0.085, 0.18, x, 0.313, 0.05, { ...FIN.zinc, seg: 22, bev: 0.006 });
    const lab = k.reg('wb_can' + c, 200, 80, (cc, w, h) => { cc.fillStyle = c; cc.fillRect(0, 0, w, h); txt(cc, 'R.O.O.M.', w / 2, h * 0.35, h * 0.26, { col: '#fff' }); txt(cc, c === '#2a5fc0' ? 'BLUE #42' : 'SAFETY YELLOW', w / 2, h * 0.7, h * 0.18, { col: '#fff', f: 'mono' }); grime(cc, w, h, 0.6, 3); });
    k.clabel(lab, 0.0858, 0.1, PI * 1.4, x, 0.31, 0.05);
    P.streak(k, x, 0.402, 0.135, 0.04, 0.1, { col: c === '#2a5fc0' ? '42,95,192' : '217,169,42', alpha: 0.7 });
  }
  // vise (front-left corner)
  const vx = -W / 2 + 0.25, vz = D / 2 + 0.02, vy = TY;
  const VM = { tint: 0x3d5a7a, chip: 0.4 };
  k.box('paint', 0.16, 0.05, 0.22, vx, vy + 0.025, vz - 0.1, { ...VM, r: 0.01 });
  k.box('paint', 0.14, 0.12, 0.06, vx, vy + 0.09, vz - 0.12, { ...VM, r: 0.01 });
  k.box('paint', 0.14, 0.11, 0.06, vx, vy + 0.085, vz + 0.0, { ...VM, r: 0.01 });
  for (const z of [vz - 0.088, vz - 0.032]) k.box('metal', 0.14, 0.035, 0.008, vx, vy + 0.13, z, { ...STEEL, r: 0.002 });
  k.box('paint', 0.06, 0.05, 0.16, vx, vy + 0.045, vz - 0.05, { ...VM, r: 0.006 });
  k.cyl('metal', 0.012, 0.2, vx, vy + 0.07, vz + 0.05, { ...STEEL, axis: 'z', seg: 12 });
  k.cyl('metal', 0.008, 0.22, vx, vy + 0.07, vz + 0.14, { ...STEEL, axis: 'x', seg: 8 });
  for (const sx of [-1, 1]) k.sph('metal', 0.014, vx + sx * 0.11, vy + 0.07, vz + 0.14, { ...STEEL, ws: 10, hs: 8 });
  // pegboard with tool shadows
  const PB = { y0: TY + 0.05, h: 0.95, z: -D / 2 + 0.02 };
  k.box('wood', W, PB.h + 0.04, 0.03, 0, PB.y0 + PB.h / 2, PB.z - 0.02, { ...FRAME, r: 0.004 });
  const peg = k.reg('wb_peg', 512, 256, (c, w, h) => drawPerforation(c, w, h, 16, 3, '#8a6a48', '#2a1e12'), 'r');
  k.label(peg, W - 0.06, PB.h - 0.04, 0, PB.y0 + PB.h / 2, PB.z - 0.0044);
  for (const sx of [-1, 1]) k.box('wood', 0.06, PB.h + 0.04, 0.05, sx * (W / 2 - 0.03), PB.y0 + PB.h / 2, PB.z - 0.01, { ...FRAME, r: 0.004 });
  k.box('wood', W, 0.06, 0.05, 0, PB.y0 + PB.h + 0.01, PB.z - 0.01, { ...FRAME, r: 0.004 });
  const sil = k.reg('wb_sil', 512, 260, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(240,235,220,0.8)'; c.lineWidth = 4;
    c.strokeRect(20, 20, 30, 150); c.strokeRect(10, 20, 50, 30);
    for (let i = 0; i < 3; i++) c.strokeRect(90 + i * 40, 30, 16, 120 - i * 20);
    c.strokeRect(240, 20, 200, 60); c.beginPath(); c.arc(470, 200, 30, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(240,235,220,0.8)'; c.font = 'bold 18px monospace'; c.fillText('IF FOUND MISSING, SO ARE YOU', 120, 240);
  });
  k.decal(sil, 1.2, 0.61, -0.2, PB.y0 + 0.48, PB.z - 0.0038);
  const tz = PB.z + 0.02;
  // hammer
  k.cyl('wood', 0.014, 0.3, -0.75, PB.y0 + 0.58, tz, { tint: 0xc89a60, seg: 10, bev: 0.004 });
  k.box('metal', 0.12, 0.035, 0.03, -0.75, PB.y0 + 0.73, tz, { ...FIN.iron, r: 0.006 });
  // screwdrivers
  ['#b3221a:s', '#e8c41a:s', '#2a5fc0:s'].forEach((sl, i) => {
    const x = -0.55 + i * 0.08, y = PB.y0 + 0.62 - i * 0.03;
    k.lathe(sl, [[0.0001, 0], [0.012, 0.004, 2], [0.014, 0.03], [0.012, 0.09, 2], [0.006, 0.1], [0.0001, 0.102]], x, y, tz, { seg: 10 });
    k.cyl('metal', 0.004, 0.13 - i * 0.02, x, y - (0.13 - i * 0.02) / 2, tz, { ...FIN.chrome, seg: 6 });
  });
  // combination wrenches
  for (let i = 0; i < 3; i++) {
    const x = -0.15 + i * 0.13, y = PB.y0 + 0.62, L = 0.18 + i * 0.03;
    k.box('metal', 0.022, L, 0.006, x, y, tz, { ...FIN.chrome, r: 0.003 });
    k.tor('metal', 0.022, 0.007, x, y + L / 2 + 0.01, tz, { ...FIN.chrome, arc: PI * 1.4, ts: 12, rs: 4, rot: [0, 0, -0.5] });
    k.cyl('metal', 0.016, 0.007, x, y - L / 2 - 0.008, tz, { ...FIN.chrome, axis: 'z', seg: 12 });
  }
  // hand saw
  const saw = new THREE.Shape(); saw.moveTo(0, 0); saw.lineTo(0.42, 0.02); saw.lineTo(0.42, 0.1); saw.lineTo(0, 0.12); saw.closePath();
  k.ext('metal', saw, 0.002, 0.2, PB.y0 + 0.82, tz - 0.005, { ...FIN.steel, rust: 0.4 });
  k.box('wood', 0.12, 0.1, 0.025, 0.16, PB.y0 + 0.88, tz, { tint: 0xa87048, r: 0.01 });
  // tape measure + pliers
  k.cyl('#d9a92a:s', 0.035, 0.03, 0.75, PB.y0 + 0.43, tz, { axis: 'z', seg: 18, bev: 0.006 });
  k.box('#c4c7ca:c', 0.012, 0.006, 0.02, 0.75, PB.y0 + 0.39, tz + 0.012, { r: 0.001 });
  for (const s of [-1, 1]) k.box('#b3221a:s', 0.016, 0.12, 0.012, 0.595 + s * 0.015, PB.y0 + 0.5, tz, { rot: [0, 0, -s * 0.15], r: 0.005 });
  k.box('metal', 0.02, 0.05, 0.01, 0.595, PB.y0 + 0.58, tz, { ...FIN.iron, r: 0.002 });
  // small diagnostic CRT (right)
  k.push(0.58, TY, -0.12, [0, -0.3, 0]);
  crtSmall(k);
  k.pop();
  // articulated task lamp (back-left)
  const lx = -0.55, lz = -0.22;
  k.cyl('metal', 0.08, 0.025, lx, TY + 0.0125, lz, { ...FIN.black, seg: 20, bev: 0.005 });
  k.tube('metal', [[lx, TY + 0.02, lz], [lx + 0.02, TY + 0.2, lz + 0.05], [lx + 0.05, TY + 0.38, lz + 0.1]], 0.008, { ...STEEL, radial: 8 });
  k.tube('metal', [[lx + 0.05, TY + 0.38, lz + 0.1], [lx + 0.18, TY + 0.42, lz + 0.18], [lx + 0.28, TY + 0.38, lz + 0.26]], 0.008, { ...STEEL, radial: 8 });
  k.sph('metal', 0.018, lx + 0.05, TY + 0.38, lz + 0.1, { ...STEEL, ws: 10, hs: 8 });
  k.tube('metal', [[lx + 0.02, TY + 0.18, lz + 0.03], [lx + 0.05, TY + 0.28, lz + 0.09]], 0.004, { ...FIN.chrome, radial: 6 });
  k.push(lx + 0.3, TY + 0.36, lz + 0.28, [0.7, 0.2, 0]);
  k.lathe('paint', [[0.075, -0.09], [0.06, -0.04], [0.035, 0.0], [0.02, 0.02], [0.0001, 0.025]], 0, 0, 0, { tint: 0x2f5a3a, seg: 20, rot: [PI, 0, 0] });
  const bulb = k.mesh(emissiveMat(0xfff4dc, 0xffe2a8, 2, { name: 'wb_bulb' }), new Geo().append(latheGeo([[0.0001, -0.03], [0.02, -0.025], [0.03, 0], [0.02, 0.025], [0.0001, 0.03]], 12, { rings: false })), 0, 0.045, 0, { name: 'lamp', shadow: false, ao: false });
  k.pop();
  // mug + screws box
  k.lathe('#b8b2a2:s', [[0.0001, 0], [0.04, 0, 1], [0.04, 0.095, 2], [0.036, 0.095, 2], [0.036, 0.008]], 0.15, TY, -0.25, { seg: 18 });
  k.cyl('#1e1208:g', 0.036, 0.002, 0.15, TY + 0.08, -0.25, { seg: 18 });
  k.tor('#b8b2a2:s', 0.025, 0.007, 0.195, TY + 0.05, -0.25, { ts: 12, rs: 5 });
  k.box('#2a4a7a:s', 0.18, 0.05, 0.1, 0.25, TY + 0.025, 0.25, { r: 0.006 });
  for (let i = 0; i < 6; i++) k.cyl('#9aa0a4:m', 0.003, 0.02, 0.2 + r.next() * 0.1, TY + 0.052, 0.22 + r.next() * 0.06, { seg: 6, rot: [HP, r.next() * 3, 0] });
  k.collide(cbox(W, 0.07, D, 0, TY - 0.035, 0));
  k.collide(cbox(W - 0.06, TY - 0.07, D - 0.06, 0, (TY - 0.07) / 2, 0));
  k.collide(cbox(W, PB.h + 0.06, 0.06, 0, PB.y0 + PB.h / 2, PB.z - 0.02));
  k.anchors.surfaceMin = V3(-0.5, TY, -0.15);
  k.anchors.surfaceMax = V3(0.3, TY, D / 2 - 0.05);
  k.anchors.vise = V3(vx, vy + 0.13, vz - 0.06);
  k.parts.lamp = bulb;
  void A;
  return k.done({ mass: 140, material: 'wood' });
}
// compact 9" CRT for the workbench (screens.main)
function crtSmall(k) {
  const sw = 0.2, sh = 0.15, bw = 0.285, bh = 0.25, bd = 0.23, cy = 0.055 + bh / 2;
  const SH = { tint: 0xb3aa8a, rough: 0.85 };
  k.ext('plastic', frameShape(bw, bh, 0.016, sw + 0.012, sh + 0.012, 0.01, 0, 0.012), 0.03, 0, cy, -0.036, { ...SH, bev: 0.006, bevSeg: 2, curveSeg: 3 });
  k.ext('#141414:p', frameShape(sw + 0.018, sh + 0.018, 0.01, sw - 0.004, sh - 0.004, 0.008), 0.02, 0, cy + 0.012, -0.044, { curveSeg: 3 });
  const body = boxGeo(bw - 0.012, bh - 0.012, bd - 0.04, { r: 0.014, seg: 2 });
  body.deform((p) => { const t = Math.min(1, Math.max(0, 0.5 - p.z / (bd - 0.04))); p.x *= 1 - 0.38 * t; p.y = p.y * (1 - 0.38 * t) - 0.02 * t; }, false);
  body.computeNormals(true);
  k.put('plastic', body, 0, cy, -0.04 - (bd - 0.04) / 2, SH);
  k.screen('main', sw, sh, 0, cy + 0.012, -0.03, { bulge: sw * 0.04, style: 'crt', text: 'DIAG.EXE\n> ALL TOOLS PRESENT?\n> Y/N_', aspect: 4 / 3 });
  k.box('#30ff60:e', 0.004, 0.003, 0.002, bw * 0.3, cy - bh / 2 + 0.03, 0.001, { r: 0 });
  k.cyl('plastic', bw * 0.3, 0.018, 0, 0.009, -bd * 0.35, { ...SH, seg: 24, r2: bw * 0.32, bev: 0.004 });
  k.box('plastic', bw * 0.4, 0.04, bd * 0.4, 0, 0.05, -bd * 0.35, { ...SH, r: 0.008 });
}

// ---------------------------------------------------------------------------
// PIPE CLUSTER (wall-mounted, origin at the floor on the wall plane): flanged risers with clamps,
// elbowed runs, gate valves with hand-wheels (parts.valves, static pivots), pressure gauge (parts.needle),
// flow markers, junction box, and the big open floor duct (anchors.mouth / inside: critter exit)
// ---------------------------------------------------------------------------
export function b_pipe_cluster(o) {
  const k = new DKit('pipe_cluster', { ground: 'wall', wear: { chip: 0.35, rust: 0.45, grime: 0.6, dust: 0.45 }, ao: { res: 64 } });
  const A = k.atlas(1024, 1024);
  const W = o.width ?? 2.0, H = o.height ?? 2.6;
  const PA = { tint: 0x5a6a5e }, PB = { tint: 0x8a3a2a }, PC = { tint: 0x9a9890 };
  const clamp = (x, y, z, r, horiz) => {
    k.push(x, y, z, horiz ? [0, 0, HP] : null);
    k.tor('metal', r + 0.008, 0.008, 0, 0, 0, { ...STEEL, arc: PI, ts: 12, rs: 4, rot: [HP, 0, 0] });
    for (const s of [-1, 1]) k.box('metal', 0.016, 0.016, z, s * (r + 0.008), 0, -z / 2, { ...STEEL, r: 0 });
    k.box('metal', r * 2 + 0.06, 0.03, 0.012, 0, 0, -z + 0.006, { ...STEEL, r: 0.003 });
    for (const s of [-1, 1]) P.screw(k, s * (r + 0.02), 0, -z + 0.012, { kind: 'hex', r: 0.006, rust: 0.7 });
    k.pop();
  };
  // vertical risers with bolted flanges
  const risers = [[-0.75, 0.09, PA, 0.12], [-0.45, 0.06, PB, 0.1], [0.55, 0.075, PC, 0.11]];
  for (const [x, r, m, z] of risers) {
    k.cyl('paint', r, H, x, H / 2, z, { ...m, seg: 18, chip: 0.4 });
    for (const y of [0.9, 1.8]) {
      k.cyl('metal', r + 0.03, 0.035, x, y, z, { ...STEEL, seg: 18, bev: 0.004, bevSeg: 1 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.screw(k, x + Math.cos(a) * (r + 0.018), y + 0.0175, z + Math.sin(a) * (r + 0.018), { kind: 'hex', r: 0.006, dir: 'y', rust: 0.7 }); }
    }
    for (const y of [0.5, 1.4, 2.3]) clamp(x, y, z, r);
    P.streak(k, x, 0.9, z + r + 0.0006, r * 1.2, 0.5, { col: '96,42,14', alpha: 0.5 });
  }
  // horizontal runs with elbows into the risers
  k.tube('paint', [[-0.75, 2.05, 0.12], [-0.75, 2.2, 0.12], [0.55, 2.2, 0.11], [0.55, 2.05, 0.11]], 0.06, { ...PA, round: 0.12, rseg: 6, radial: 16, chip: 0.4 });
  k.tube('paint', [[-0.45, 1.1, 0.1], [-0.45, 1.25, 0.1], [0.55, 1.25, 0.11]], 0.045, { ...PB, round: 0.1, rseg: 6, radial: 14, chip: 0.4 });
  for (const x of [-0.2, 0.2]) clamp(x, 1.25, 0.1, 0.045, true);
  for (const x of [-0.3, 0.25]) clamp(x, 2.2, 0.12, 0.06, true);
  // gate valves with hand-wheels (static; pivots kept)
  k.parts.valves = [];
  for (const [x, y, z, r] of [[0.0, 2.2, 0.12, 0.06], [0.1, 1.25, 0.1, 0.045], [-0.75, 0.7, 0.12, 0.09]]) {
    k.box('metal', 0.12, 0.12, 0.12, x, y, z, { ...FIN.iron, r: 0.012, seg: 2 });
    for (const s of [-1, 1]) k.cyl('metal', r + 0.025, 0.02, x + s * 0.07, y, z, { ...FIN.iron, axis: 'x', seg: 16, bev: 0.003, bevSeg: 1 });
    k.cyl('metal', 0.014, 0.12, x, y, z + 0.1, { ...FIN.chrome, axis: 'z', seg: 10 });
    const v = k.grp(x, y, z + 0.17, { name: 'valve' });
    v.rotation.z = (x + y) * 3;
    k.insideStatic(v, () => {
      k.tor('paint', 0.08, 0.011, 0, 0, 0, { tint: 0xb3221a, ts: 22, rs: 6, chip: 0.5 });
      for (let i = 0; i < 3; i++) k.box('paint', 0.16, 0.014, 0.012, 0, 0, 0, { tint: 0xb3221a, rot: [0, 0, (i / 3) * PI], r: 0.003 });
      k.cyl('metal', 0.02, 0.03, 0, 0, 0, { ...STEEL, axis: 'z', seg: 12 });
    });
    k.parts.valves.push(v);
  }
  // pressure gauge on a tee
  k.cyl('metal', 0.012, 0.12, 0.3, 2.31, 0.12, { ...STEEL, seg: 10 });
  k.parts.needle = P.gauge(k, 0.3, 2.42, 0.13, 0.06, { label: 'BAR', max: 16, red: 0.8, value: 0.7, name: 'needle', key: 'bar', static: true });
  // flow markers wrapped on the pipes
  const marker = (key, s, col, x, y, z, r) => {
    const reg = k.reg('pc_m_' + key, 200, 40, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); txt(c, s + '  ➜', w / 2, h / 2, h * 0.55, { col: '#111', maxW: w * 0.92 }); grime(c, w, h, 0.5, 3); });
    k.push(x, y, z, [0, 0, HP]);
    k.clabel(reg, r + 0.002, 0.05, 2.2, 0, 0, 0, { a: 0 });
    k.pop();
  };
  marker('steam', 'STEAM', '#e8b417', -0.1, 2.2, 0.12, 0.06);
  marker('cool', 'COOLANT', '#3a9a5a', -0.05, 1.25, 0.1, 0.045);
  const vm = k.reg('pc_unk', 160, 40, (c, w, h) => { c.fillStyle = '#c8c4b4'; c.fillRect(0, 0, w, h); txt(c, '??? ⬆', w / 2, h / 2, h * 0.6, { col: '#111' }); grime(c, w, h, 0.6, 2); });
  k.clabel(vm, 0.077, 0.05, 2.0, 0.55, 1.6, 0.11, { a: 0 });
  // junction box + conduit
  k.box('paint', 0.22, 0.3, 0.12, 0.15, 0.65, 0.06, { tint: 0x7b8086, r: 0.01 });
  P.cornerScrews(k, 0.22, 0.3, 0.15, 0.65, 0.12, 0.015, { r: 0.004 });
  P.conduit(k, [0.15, 0.8, 0.06], [0.15, 1.15, 0.06], 0.015, { couplings: 0 });
  const jb = k.reg('pc_jb', 120, 60, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); hazardTri(c, w * 0.22, h * 0.5, h * 0.7, 'bolt'); txt(c, '480V', w * 0.65, h / 2, h * 0.4, { col: '#111' }); grime(c, w, h, 0.6, 4, { corner: 0.15 }); });
  k.label(jb, 0.12, 0.06, 0.15, 0.7, 0.1206);
  // the open floor duct (critter exit): rusty collar, dark throat, bent grate hanging off
  const dR = 0.17, dy = 0.24, dx = -0.1;
  k.cyl('rust', dR, 0.14, dx, dy, 0.07, { axis: 'z', seg: 22, open: true });
  k.cyl('metal', dR + 0.03, 0.03, dx, dy, 0.02, { ...STEEL, axis: 'z', seg: 22, bev: 0.004 });
  k.tor('metal', dR + 0.01, 0.02, dx, dy, 0.14, { ...STEEL, rs: 6, ts: 26 });
  const throat = new Geo().append(cylGeoInside(dR - 0.005, 0.14, 20));
  k.put('#020202', throat, dx, dy, 0.07, { rot: [HP, 0, 0] });
  k.disc('#000000', dR, dx, dy, 0.004, { seg: 20 });
  k.push(dx + 0.05, dy - dR, 0.16, [0.9, 0.3, 0.2]);
  k.tor('rust', dR - 0.01, 0.006, 0, dR, 0, { rs: 4, ts: 20 });
  for (let i = -3; i <= 3; i++) k.box('rust', 0.006, Math.sqrt(Math.max(0, (dR - 0.01) ** 2 - (i * 0.04) ** 2)) * 2, 0.006, i * 0.04, dR, 0, { r: 0 });
  k.pop();
  for (const [x, y] of [[dx - dR - 0.015, dy], [dx + dR + 0.015, dy], [dx, dy + dR + 0.015]]) P.screw(k, x, y, 0.036, { kind: 'hex', r: 0.008, rust: 1, streak: 0.06 });
  P.stain(k, dx, 0.0008, 0.3, 0.5, 0.35, { col: '50,40,24', alpha: 0.45, rot: [-HP, 0, 0] });
  // wall bracket plate
  k.box('paint', W, 0.08, 0.02, 0, 0.04, 0.01, { tint: 0x4a4e52, r: 0.003 });
  k.collide(cbox(1.6, H, 0.26, -0.1, H / 2, 0.13));
  k.anchors.mouth = V3(dx, dy, 0.3);
  k.anchors.inside = V3(dx, dy, 0.02);
  void A;
  return k.done({ mass: 800, material: 'metal' });
}
// inward-facing open cylinder (axis Y), for dark duct throats
function cylGeoInside(r, h, seg) {
  const g = new Geo();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU, s = Math.sin(a), c = Math.cos(a);
    g.v(s * r, -h / 2, c * r, -s, 0, -c, a * r, 0, 0); g.v(s * r, h / 2, c * r, -s, 0, -c, a * r, h, 0);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; g.quad(a, a + 1, a + 3, a + 2); }
  return g;
}
