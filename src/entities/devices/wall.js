// Wall-mounted hardware: fuse box, fire alarm station, exit sign, hazard sign, wall / ceiling vents,
// wall clock, poster frame, mirror, employee-of-the-month plaque, dart board cabinet.
// Wall devices: origin = centre of the back plane on the wall surface (z = 0), front faces +Z.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, DEG, V3, cbox, ccyl, frameShape, rrShape, rrHole, circleShape, polyShape, latheGeo, axisGeo, Geo, boxGeo, quadGeo } from './core.js';
import { emissiveMat } from './mats.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, hazardTri, drawLogo } from './atlas.js';

// ---------------------------------------------------------------------------
// Fuse box: NEMA-style steel distribution board, hinged door with pressed panel, latch + padlock,
// galvanised back plate with 2x6 breakers and a red main switch, conduits to the ceiling.
// ---------------------------------------------------------------------------
export function b_fuse_box(o) {
  const k = new DKit('fuse_box', { ground: 'wall', wear: { chip: 0.24, rust: 0.2, grime: 0.55, dust: 0.5 } });
  k.atlas(512, 512);
  const W = 0.36, H = 0.48, D = 0.12;
  const body = { tint: 0x7c8781 };
  const dd = D - 0.002;
  // back plate + mounting tabs
  k.box('paint', W - 0.006, H - 0.006, 0.0025, 0, 0, 0.00125, { ...body, r: 0.001 });
  for (const sy of [-1, 1]) {
    k.box('paint', 0.08, 0.032, 0.0025, 0, sy * (H / 2 + 0.012), 0.00125, { ...body, r: 0.004 });
    P.screw(k, 0, sy * (H / 2 + 0.016), 0.0025, { kind: 'hex', r: 0.0048, streak: sy < 0 ? 0.07 : 0.05 });
  }
  // folded side / top / bottom walls
  for (const sx of [-1, 1]) k.box('paint', 0.003, H, dd, sx * (W / 2 - 0.0015), 0, dd / 2, { ...body, r: 0.0013, div: 0.08, dent: 0.0008 });
  for (const sy of [-1, 1]) k.box('paint', W - 0.004, 0.003, dd, 0, sy * (H / 2 - 0.0015), dd / 2, { ...body, r: 0.0013 });
  // front return flange around the opening
  k.ext('paint', frameShape(W, H, 0.004, W - 0.026, H - 0.026, 0.003), 0.003, 0, 0, dd - 0.003, { ...body, bev: 0.001, bevSeg: 1, curveSeg: 3 });
  // interior: galvanised mounting plate, DIN rails, breakers, bus bar, wiring
  k.box('metal', W - 0.034, H - 0.034, 0.002, 0, 0, 0.012, { ...FIN.zinc, r: 0.001, rust: 0.05 });
  P.cornerScrews(k, W - 0.034, H - 0.034, 0, 0, 0.013, 0.012, { r: 0.003 });
  const lbl = k.reg('fb_lbl', 260, 30, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); for (let i = 0; i < 12; i++) txt(c, String(i + 1), (i + 0.5) * (w / 12), h / 2, h * 0.5, { col: '#222', f: 'mono' }); grime(c, w, h, 0.5, 3); });
  // breakers: static geometry (never animated in game); parts.breakers keeps one pivot per handle
  k.parts.breakers = [];
  for (let col = 0; col < 2; col++) {
    const x = (col ? 1 : -1) * 0.065;
    k.box('metal', 0.09, 0.3, 0.004, x, 0.02, 0.016, { ...FIN.zinc, r: 0.0008, wear: 0 });
    for (let r = 0; r < 6; r++) {
      const y = 0.13 - r * 0.045;
      k.box('#1e1e20:p', 0.072, 0.038, 0.024, x, y, 0.03, { r: 0, wear: 0, skip: { nz: true } });
      k.box('#e9e4d6', 0.03, 0.006, 0.0006, x - 0.02, y + 0.013, 0.0423, { r: 0, wear: 0, skip: { nz: true } });
      const ry = (r === 3 && col === 1) ? -0.5 : 0.5;
      k.box('#d8d2c2:s', 0.016, 0.012, 0.016, x + 0.012, y, 0.042 + 0.007, { r: 0, wear: 0, rot: [0, ry, 0], skip: { nz: true } });
      const t = k.grp(x + 0.012, y, 0.042, { name: `breaker_${col * 6 + r}` });
      t.rotation.y = ry;
      k.parts.breakers.push(t);
    }
  }
  k.label(lbl, 0.26, 0.03, 0, 0.19, 0.0135);
  // copper bus bar + wiring loom up into the conduits
  k.box('metal', 0.012, 0.32, 0.004, 0, 0.0, 0.02, { ...FIN.copper, r: 0.001 });
  const wireCols = [0x9a1c16, 0x1d1d1d, 0x2a4f9a, 0x2f7a3a, 0x9a1c16, 0x1d1d1d];
  wireCols.forEach((c, i) => {
    const x0 = (i < 3 ? -1 : 1) * (0.03 + (i % 3) * 0.006);
    P.cable(k, [[x0, 0.14, 0.04], [x0 * 1.4, 0.18, 0.05], [(-0.1 + (i % 3) * 0.1) * 0.9, 0.2, 0.05], [-0.1 + (i % 3) * 0.1, H / 2 - 0.004, 0.05]], 0.0028, { tint: c, rough: 0.6, n: 8, radial: 5 });
  });
  // main switch: housing + red handle (rotation.x)
  k.box('#222224:p', 0.1, 0.07, 0.03, 0, -0.17, 0.027, { r: 0.004, wear: 0 });
  const main = k.grp(0, -0.17, 0.042, { name: 'mainBreaker' });
  k.inside(main, () => {
    k.box('#b02a20:s', 0.03, 0.052, 0.018, 0, 0, 0.009, { r: 0.004 });
    k.box('#b02a20:s', 0.034, 0.012, 0.022, 0, 0.022, 0.012, { r: 0.004 });
  });
  main.rotation.x = -0.4;
  // ---- door (pivot on the left front edge; negative rotation.y opens) ----
  const DW = W - 0.002, DH = H - 0.002;
  const door = k.grp(-W / 2, 0, D, { name: 'door' });
  k.inside(door, () => {
    const cx = DW / 2 + 0.001;
    // tray: front sheet + folded return lips
    k.box('paint', DW, DH, 0.003, cx, 0, 0.0095, { ...body, r: 0.0013, div: 0.07, dent: 0.0006 });
    for (const sx of [-1, 1]) k.box('paint', 0.003, DH - 0.004, 0.012, cx + sx * (DW / 2 - 0.0015), 0, 0.0035, { ...body, r: 0.0012 });
    for (const sy of [-1, 1]) k.box('paint', DW - 0.004, 0.003, 0.012, cx, sy * (DH / 2 - 0.0015), 0.0035, { ...body, r: 0.0012 });
    // pressed stiffening panel
    k.box('paint', DW - 0.07, DH - 0.09, 0.003, cx, 0.006, 0.0125, { ...body, r: 0.0045, seg: 2 });
    // rubber gasket on the inside
    k.tube('#111112:r', [[cx - DW / 2 + 0.008, -DH / 2 + 0.008, 0.0], [cx + DW / 2 - 0.008, -DH / 2 + 0.008, 0.0], [cx + DW / 2 - 0.008, DH / 2 - 0.008, 0.0], [cx - DW / 2 + 0.008, DH / 2 - 0.008, 0.0]], 0.0025, { round: 0.01, closed: true, radial: 5 });
    // DANGER sticker (worn, peeling corner)
    const front = k.reg('fb_danger', 240, 150, (c, w, h) => {
      c.fillStyle = '#ece6d2'; rrect(c, 2, 2, w - 4, h - 4, 10); c.fill();
      c.fillStyle = '#b8201a'; rrect(c, 2, 2, w - 4, h * 0.32, 10); c.fill(); c.fillRect(2, h * 0.2, w - 4, h * 0.14);
      txt(c, 'DANGER', w / 2, h * 0.17, h * 0.2, { col: '#fff' });
      hazardTri(c, w * 0.2, h * 0.64, h * 0.42, 'bolt');
      txt(c, '240 VOLTS', w * 0.64, h * 0.52, h * 0.15, { col: '#111', maxW: w * 0.6 });
      txt(c, 'AUTHORIZED', w * 0.64, h * 0.7, h * 0.095, { col: '#111', f: 'mono', maxW: w * 0.6 });
      txt(c, 'CLONES ONLY', w * 0.64, h * 0.83, h * 0.095, { col: '#111', f: 'mono', maxW: w * 0.6 });
      grime(c, w, h, 0.9, 7, { corner: 0.12 }); rubOff(c, w, h, 0.6, 4);
    });
    k.label(front, 0.2, 0.125, cx, 0.1, 0.0142);
    // engraved phenolic ID plate (riveted)
    const id = k.reg('fb_id', 220, 64, (c, w, h) => {
      c.fillStyle = '#141416'; rrect(c, 0, 0, w, h, 8); c.fill();
      c.strokeStyle = '#d8d0b8'; c.lineWidth = 3; rrect(c, 6, 6, w - 12, h - 12, 6); c.stroke();
      txt(c, 'PANEL B-7', w / 2, h * 0.42, h * 0.38, { col: '#e8e0c8', f: 'mono' });
      txt(c, '240V 1PH  100A', w / 2, h * 0.76, h * 0.16, { col: '#bdb59e', f: 'mono' });
    }, 'g');
    P.plate(k, id, 0.15, 0.044, cx, -0.12, 0.014, { fin: FIN.black, rr: 0.0024, rivets: 2, rd: 0.01 });
    // quarter-turn latch with escutcheon + padlock hasp
    const lx = DW - 0.035;
    const CH = '#c9ccce:c', ZN = '#9da3a5:m', BR = '#c8a254:m';
    k.lathe(CH, [[0.017, 0], [0.019, 0.002, 2], [0.017, 0.006, 2], [0.012, 0.007], [0, 0.0072]], lx, 0.0, 0.014, { axis: 'z', seg: 18 });
    k.box(CH, 0.008, 0.036, 0.012, lx, 0, 0.026, { r: 0.003 });
    k.cyl('#7a7e80:m', 0.005, 0.006, lx, 0, 0.022, { axis: 'z', seg: 10 });
    // hasp + brass padlock hanging below the latch
    k.box(ZN, 0.012, 0.03, 0.003, lx, -0.042, 0.0155, { r: 0.001 });
    k.tor(CH, 0.0065, 0.0016, lx, -0.05, 0.022, { ts: 14, rs: 5, arc: PI, a0: 0, axis: 'x' });
    for (const s of [-1, 1]) k.cyl(CH, 0.0016, 0.004, lx, -0.052, 0.022 + s * 0.0065, { seg: 6 });
    k.box(BR, 0.026, 0.03, 0.012, lx, -0.068, 0.023, { r: 0.004, rot: [0.12, 0, 0] });
    k.cyl('#8a6c34:m', 0.0032, 0.002, lx, -0.073, 0.0295, { axis: 'z', seg: 10, rot: [0.12, 0, 0] });
    // inside of the door: circuit directory card
    const dir = k.reg('fb_dir', 200, 240, (c, w, h) => {
      c.fillStyle = '#efe9d6'; c.fillRect(0, 0, w, h);
      txt(c, 'CIRCUIT DIRECTORY', w / 2, 16, 15, { col: '#111' });
      c.strokeStyle = '#999'; c.lineWidth = 1;
      const rows = ['LOBBY LIGHTS', 'RECEPTION', 'VENDING', 'COFFEE (DO NOT)', 'SERVERS', 'LAB A', 'LAB B', 'DISPATCH', 'ELEVATOR', '???', 'BREAKROOM', 'SPARE'];
      rows.forEach((s, i) => { const y = 34 + i * 17; c.beginPath(); c.moveTo(8, y + 14); c.lineTo(w - 8, y + 14); c.stroke(); txt(c, `${i + 1}`, 16, y + 7, 11, { col: '#333', f: 'mono' }); txt(c, s, 30, y + 7, 12, { col: '#1a2a7a', f: 'mono', al: 'left' }); });
      grime(c, w, h, 0.6, 9);
    });
    k.label(dir, 0.15, 0.18, cx, 0.02, 0.0075, { rot: [0, PI, 0] });
    // door half of the hinges
    for (const y of [-0.15, 0.15]) P.hingeHalf(k, 0, y, 0.008, 0.06, { part: 1, leaf: 1, leafZ: 0.003, slot: '#9a9ea2:m' });
  });
  door.rotation.y = 0;
  for (const y of [-0.15, 0.15]) P.hingeHalf(k, -W / 2, y, D + 0.008, 0.06, { part: 0 });
  // conduits up to the ceiling with locknut fittings + straps
  for (const x of [-0.1, 0.0, 0.1]) {
    k.cyl('metal', 0.016, 0.014, x, H / 2 + 0.007, 0.05, { ...FIN.zinc, seg: 6, bev: 0.0012, bevSeg: 1 });
    k.cyl('metal', 0.0135, 0.012, x, H / 2 + 0.02, 0.05, { ...FIN.zinc, seg: 12, bev: 0.0015, bevSeg: 1 });
    P.conduit(k, [x, H / 2 + 0.026, 0.05], [x, H / 2 + 0.62, 0.05], 0.0115, { couplings: 0 });
    // stand-off clamp to the wall
    k.box('metal', 0.022, 0.026, 0.038, x, H / 2 + 0.36, 0.019, { ...FIN.zinc, r: 0.002 });
    k.tor('metal', 0.0128, 0.0018, x, H / 2 + 0.36, 0.05, { ...FIN.zinc, arc: PI, a0: 0, ts: 10, rs: 4, axis: 'y' });
    P.screw(k, x, H / 2 + 0.36, 0.038, { r: 0.0026, kind: 'hex' });
  }
  // grime: run-off under the box, dust on top
  P.streak(k, -0.06, -H / 2 - 0.002, 0.0003, 0.05, 0.14, { col: '70,58,40', alpha: 0.35 });
  P.streak(k, 0.09, -H / 2 - 0.002, 0.0003, 0.04, 0.1, { col: '96,42,14', alpha: 0.4 });
  k.collide(cbox(W, H, D, 0, 0, D / 2));
  k.parts.door = door;
  k.parts.main = main;
  k.params.doorOpenSign = -1;
  return k.done({ mass: 12, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Employee of the month: walnut plaque, green felt, engraved brass header, gilt portrait frame
// (screens.portrait 3:4 photo, screens.name brass strip; the game swaps their materials)
// ---------------------------------------------------------------------------
function brassGrad(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f6dc94'); g.addColorStop(0.45, '#c9a24e'); g.addColorStop(1, '#8a6a28');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,240,200,0.25)'; c.lineWidth = 1;
  for (let x = 0; x < w; x += 3) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 2, h); c.stroke(); }
}
export function b_employee_of_month(o) {
  void o;
  const k = new DKit('employee_of_month', { ground: 'wall', wear: { chip: 0.08, rust: 0.05, grime: 0.35, dust: 0.5 } });
  k.atlas(512, 256);
  const W = 0.42, H = 0.58, T = 0.028;
  const WAL = { tint: 0x5c3421, rough: 0.8 };
  k.box('wood', W - 0.012, H - 0.012, 0.004, 0, 0, 0.002, { ...WAL, r: 0.001 });
  // walnut moulding: broad bevelled frame + raised inner lip + gilt slip
  k.ext('wood', frameShape(W, H, 0.006, W - 0.056, H - 0.056, 0.003), 0.016, 0, 0, 0.004, { ...WAL, bev: 0.006, bevSeg: 3, curveSeg: 3 });
  k.ext('wood', frameShape(W - 0.05, H - 0.05, 0.003, W - 0.074, H - 0.074, 0.002), 0.006, 0, 0, 0.016, { ...WAL, bev: 0.0022, bevSeg: 2, curveSeg: 2 });
  k.ext('metal', frameShape(W - 0.072, H - 0.072, 0.002, W - 0.08, H - 0.08, 0.0015), 0.003, 0, 0, 0.004, { ...FIN.brass, bev: 0.001, bevSeg: 1, curveSeg: 2 });
  const felt = k.reg('eotm_felt', 128, 176, (c, w, h, rng) => {
    c.fillStyle = '#1d3a2a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { c.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)'; c.fillRect(rng.next() * w, rng.next() * h, 1, 1 + rng.next() * 2); }
    const g = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.7); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, 'r');
  k.label(felt, W - 0.074, H - 0.074, 0, 0, 0.0042);
  // engraved brass header
  const hdr = k.reg('eotm_hdr', 400, 62, (c, w, h) => {
    brassGrad(c, w, h);
    c.strokeStyle = 'rgba(60,40,8,0.75)'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    drawLogo(c, 30, h / 2, h * 0.3, '#3a2606');
    txt(c, 'EMPLOYEE OF THE MONTH', w / 2 + 12, h / 2 + 1, h * 0.4, { col: '#2e1e04', f: 'serif', maxW: w * 0.8 });
    rubOff(c, w, h, 0.3, 5);
  }, 'm');
  const hy = H / 2 - 0.085;
  k.box('metal', 0.33, 0.052, 0.003, 0, hy, 0.0057, { ...FIN.brass, r: 0.0012 });
  k.label(hdr, 0.326, 0.049, 0, hy, 0.0073);
  for (const sx of [-1, 1]) P.screw(k, sx * 0.152, hy, 0.0072, { kind: 'button', r: 0.0028, fin: FIN.brass });
  // portrait: gilt frame, dark fillet, photo screen, glass
  const pw = 0.21, ph = 0.28;
  k.ext('metal', frameShape(pw + 0.034, ph + 0.034, 0.004, pw + 0.004, ph + 0.004, 0.002), 0.008, 0, 0, 0.0045, { ...FIN.brass, rough: 0.6, bev: 0.0028, bevSeg: 2, curveSeg: 3 });
  k.ext('#1a1208:p', frameShape(pw + 0.006, ph + 0.006, 0.002, pw, ph, 0.001), 0.004, 0, 0, 0.0045, { curveSeg: 2 });
  k.screen('portrait', pw, ph, 0, 0, 0.0075, { style: 'photo', text: 'EMPLOYEE #0042', aspect: 3 / 4 });
  k.quad('glass', pw + 0.004, ph + 0.004, 0, 0, 0.0098);
  // name plate
  const ny = -H / 2 + 0.07;
  k.box('metal', 0.27, 0.05, 0.003, 0, ny, 0.0057, { ...FIN.brass, r: 0.0012 });
  k.screen('name', 0.25, 0.04, 0, ny, 0.0074, { style: 'brass', text: 'CLONE #0042', metal: 0.6, rough: 0.35 });
  for (const sx of [-1, 1]) P.screw(k, sx * 0.128, ny, 0.0072, { kind: 'button', r: 0.0026, fin: FIN.brass });
  // mounting screws through the felt
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.screw(k, sx * (W / 2 - 0.05), sy * (H / 2 - 0.05), 0.0043, { kind: 'flat', r: 0.0032, fin: FIN.oldbrass });
  k.collide(cbox(W, H, T, 0, 0, T / 2));
  k.anchors.center = V3(0, 0, T);
  return k.done({ mass: 2.5, material: 'wood' });
}

// ---------------------------------------------------------------------------
// Wall clock: moulded black case, aged dial, spade hands (parts.hour/minute/second rotate on Z,
// clockwise = negative), domed crystal
// ---------------------------------------------------------------------------
export function b_wall_clock(o) {
  void o;
  const k = new DKit('wall_clock', { ground: 'wall', wear: { chip: 0.04, rust: 0, grime: 0.3, dust: 0.55 } });
  k.atlas(512, 512);
  const R = 0.16, D = 0.045;
  const RIM = { tint: 0x1b1b1c, rough: 0.85 };
  k.lathe('plastic', [[R - 0.004, 0], [R + 0.004, 0, 1], [R + 0.012, 0.007, 2], [R + 0.014, D - 0.014], [R + 0.011, D - 0.004, 2], [R + 0.003, D, 2], [R - 0.007, D - 0.001, 2], [R - 0.011, D - 0.006], [R - 0.012, D - 0.016], [R - 0.014, 0.011, 1], [R - 0.06, 0.009]], 0, 0, 0, { ...RIM, axis: 'z', seg: 56 });
  const face = k.reg('clock_face', 500, 500, (c, w, h, rng) => {
    const cx = w / 2, cy = h / 2, r = w / 2;
    c.fillStyle = '#e6dfcb'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU, maj = i % 5 === 0;
      c.strokeStyle = '#151515'; c.lineWidth = maj ? 7 : 2.5;
      const r0 = r * (maj ? 0.8 : 0.86), r1 = r * 0.93;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); c.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); c.stroke();
    }
    c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r * 0.935, 0, TAU); c.stroke();
    for (let i = 1; i <= 12; i++) { const a = (i / 12) * TAU; txt(c, String(i), cx + Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66 + 3, r * 0.17, { col: '#151515', f: 'bold', w: 'bold' }); }
    drawLogo(c, cx, cy - r * 0.32, r * 0.1, '#333');
    txt(c, 'TIME IS PROPERTY', cx, cy + r * 0.3, r * 0.065, { col: '#7a1a14', f: 'bold' });
    txt(c, 'QUARTZ', cx, cy + r * 0.4, r * 0.05, { col: '#555', f: 'mono' });
    // age: yellowed rim, a water tide-mark at 7 o'clock, specks under the crystal
    const g = c.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(120,90,20,0.28)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(110,80,30,0.25)'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(cx - r * 0.42, cy + r * 0.5, r * 0.22, r * 0.14, 0.5, 0, TAU); c.stroke();
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(40,30,20,${0.1 + rng.next() * 0.25})`; c.fillRect(rng.next() * w, rng.next() * h, 2, 2); }
  });
  k.disc('#d8d2bf', R - 0.0115, 0, 0, 0.0096, { seg: 40 });
  k.dlabel(face, R - 0.012, 0, 0, 0.0102, { seg: 48 });
  // hands: spade hour / minute, needle second with counterweight (pivot = dial centre)
  const spade = (len, wid, tail) => {
    const s = new THREE.Shape();
    s.moveTo(-wid * 0.3, -tail); s.lineTo(wid * 0.3, -tail); s.lineTo(wid * 0.5, len * 0.12); s.lineTo(wid * 0.22, len * 0.62);
    s.lineTo(wid * 0.75, len * 0.74); s.lineTo(0, len); s.lineTo(-wid * 0.75, len * 0.74); s.lineTo(-wid * 0.22, len * 0.62); s.lineTo(-wid * 0.5, len * 0.12);
    s.closePath();
    s.holes.push(new THREE.Path().absarc(0, len * 0.76, wid * 0.22, 0, TAU, true));
    return s;
  };
  const hand = (name, z, fn) => { const g = k.grp(0, 0, z, { name }); k.inside(g, fn); return g; };
  const INK = '#111214:s';
  k.parts.hour = hand('hour', 0.0128, () => { k.ext(INK, spade(0.075, 0.012, 0.018), 0.0012, 0, 0, 0, { curveSeg: 4 }); k.cyl(INK, 0.0068, 0.0012, 0, 0, 0.0006, { axis: 'z', seg: 16 }); });
  k.parts.minute = hand('minute', 0.0144, () => { k.ext(INK, spade(0.115, 0.0095, 0.022), 0.0012, 0, 0, 0, { curveSeg: 4 }); k.cyl(INK, 0.0058, 0.0012, 0, 0, 0.0006, { axis: 'z', seg: 16 }); });
  k.parts.second = hand('second', 0.016, () => {
    const RED = '#c0201a:s';
    k.box(RED, 0.0018, 0.16, 0.0008, 0, 0.125 - 0.08, 0.0004, { r: 0 });
    k.cyl(RED, 0.0055, 0.0008, 0, -0.03, 0.0004, { axis: 'z', seg: 14 });
    k.cyl(RED, 0.004, 0.0016, 0, 0, 0.0008, { axis: 'z', seg: 12 });
  });
  k.lathe('metal', [[0, 0], [0.0035, 0, 1], [0.0034, 0.002, 2], [0.002, 0.0032], [0, 0.0034]], 0, 0, 0.0175, { ...FIN.brass, axis: 'z', seg: 12 });
  // domed crystal
  k.put('glass', axisGeo(sphereGeoCap(R - 0.009, 0.012), 'z'), 0, 0, D - 0.016);
  k.parts.hour.rotation.z = -1.2; k.parts.minute.rotation.z = -3.9; k.parts.second.rotation.z = -0.5;
  k.collide(ccyl(R + 0.014, D, 0, 0, D / 2, [HP, 0, 0]));
  k.params.clockwise = -1;
  return k.done({ mass: 1.2, material: 'plastic' });
}
// shallow spherical cap (axis +Y) of base radius r and height h
function sphereGeoCap(r, h) {
  const Rs = (r * r + h * h) / (2 * h), t1 = Math.asin(r / Rs);
  const g = latheGeo(Array.from({ length: 9 }, (_, i) => { const t = t1 * (1 - i / 8); return [Math.sin(t) * Rs, Math.cos(t) * Rs - (Rs - h)]; }), 40, { rings: false });
  return g;
}

// ---------------------------------------------------------------------------
// Poster frame: snap-frame (black aluminium) or walnut; backing board, print (screens.main), glazing
// ---------------------------------------------------------------------------
export function b_poster(o) {
  const k = new DKit('poster', { ground: 'wall', wear: { chip: 0.1, rust: 0.02, grime: 0.3, dust: 0.45 } });
  k.atlas(256, 128);
  const asp = o.aspect ?? 0.7;
  const W = o.width ?? 0.6, H = W / asp, T = 0.02, f = 0.022;
  const wood = o.frame === 'wood';
  const slot = wood ? 'wood' : 'metal', fo = wood ? { tint: 0x5a3a22, rough: 0.85 } : { ...FIN.black, rough: 0.8, rust: 0, chip: 0.25 };
  // profiled frame: outer body + inner lip
  k.ext(slot, frameShape(W + 2 * f, H + 2 * f, 0.003, W + 0.006, H + 0.006, 0.001), T - 0.006, 0, 0, 0.002, { ...fo, bev: 0.0035, bevSeg: 2, curveSeg: 2 });
  k.ext(slot, frameShape(W + 0.014, H + 0.014, 0.0015, W - 0.004, H - 0.004, 0.0008), 0.003, 0, 0, T - 0.006, { ...fo, bev: 0.0012, bevSeg: 1, curveSeg: 2 });
  k.box('#9a8a70:r', W + 0.004, H + 0.004, 0.004, 0, 0, 0.004, { r: 0 });
  k.screen('main', W, H, 0, 0, 0.0065, { style: 'poster', text: o.text ?? '', aspect: asp, rough: 0.5 });
  if (o.glass !== false) {
    k.quad('glass', W + 0.004, H + 0.004, 0, 0, T - 0.0062);
    P.scuffs(k, W * 0.15, -H * 0.2, T - 0.0058, W * 0.5, H * 0.4, { alpha: 0.08 });
  }
  if (!wood) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('#2a2b2e:s', 0.012, 0.012, 0.002, sx * (W / 2 + f - 0.004), sy * (H / 2 + f - 0.004), T - 0.003, { r: 0.002, rot: [0, 0, PI / 4] });
  k.collide(cbox(W + 2 * f, H + 2 * f, T, 0, 0, T / 2));
  k.params.size = [W, H];
  return k.done({ mass: 2, material: 'wood' });
}

// ---------------------------------------------------------------------------
// Mirror: chrome (or walnut) frame around a silvered backing (the game adds the Reflector at
// anchors.glassCenter), rosette clips, glass shelf on chrome brackets
// ---------------------------------------------------------------------------
export function b_mirror(o) {
  const k = new DKit('mirror', { ground: 'wall', wear: { chip: 0.06, rust: 0.12, grime: 0.35, dust: 0.4 } });
  k.atlas(256, 128);
  const W = o.width ?? 0.6, H = o.height ?? 0.9, f = o.border ?? 0.035, T = 0.03;
  const wood = o.frame === 'wood';
  const slot = wood ? 'wood' : 'metal', fo = wood ? { tint: 0x5a3a22, rough: 0.85 } : { ...FIN.chrome, rough: 0.35 };
  k.ext(slot, frameShape(W + 2 * f, H + 2 * f, 0.012, W, H, 0.004), T - 0.012, 0, 0, 0.006, { ...fo, bev: 0.006, bevSeg: 3, curveSeg: 4 });
  // silvered backing with a ground bevel band (shows around the live reflection)
  k.box('#c9ced0:c', W + 0.004, H + 0.004, 0.006, 0, 0, 0.004, { r: 0 });
  k.ext('glass', frameShape(W, H, 0.004, W - 0.03, H - 0.03, 0.003), 0.002, 0, 0, 0.0072, { bev: 0.0009, bevSeg: 1, curveSeg: 2 });
  P.stain(k, -W * 0.3, -H * 0.38, 0.0076, W * 0.25, W * 0.18, { col: '60,50,30', alpha: 0.25 });
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.lathe('metal', [[0, 0], [0.0085, 0, 1], [0.0082, 0.0018, 2], [0.006, 0.0042], [0.0025, 0.0052], [0, 0.0054]], sx * (W / 2 + f / 2), sy * (H / 2 + f / 2), T, { ...FIN.chrome, axis: 'z', seg: 16, rust: 0.2 });
  }
  if (o.shelf !== false) {
    const sy = -H / 2 - f - 0.06;
    k.box('glass', W * 0.8, 0.008, 0.11, 0, sy, 0.065, { r: 0 });
    k.box('#8fb5a9:g', W * 0.8, 0.008, 0.0015, 0, sy, 0.1203, { r: 0 });
    k.box('metal', W * 0.8 + 0.01, 0.012, 0.012, 0, sy + 0.001, 0.124, { ...FIN.chrome, r: 0.0045 });
    for (const sx of [-1, 1]) {
      k.box('metal', 0.022, 0.055, 0.008, sx * W * 0.35, sy + 0.012, 0.004, { ...FIN.chrome, r: 0.003 });
      k.box('metal', 0.012, 0.012, 0.115, sx * W * 0.35, sy - 0.01, 0.062, { ...FIN.chrome, r: 0.004 });
      P.screw(k, sx * W * 0.35, sy + 0.028, 0.008, { kind: 'flat', r: 0.003, fin: FIN.chrome });
    }
    P.stain(k, W * 0.12, sy + 0.0042, 0.07, 0.07, 0.06, { col: '230,235,225', alpha: 0.35, ring: true, rot: [-HP, 0, 0] });
    k.collide(cbox(W * 0.8, 0.02, 0.12, 0, sy, 0.06));
  }
  k.collide(cbox(W + 2 * f, H + 2 * f, T, 0, 0, T / 2));
  k.anchors.glassCenter = V3(0, 0, 0.0075);
  k.params.glassSize = [W, H];
  return k.done({ mass: 6, material: 'glass' });
}

// ---------------------------------------------------------------------------
// Ceiling diffuser (origin = ceiling surface centre, hangs down -Y): plenum, stepped 4-way louvre
// cones, centre plate, ceiling smudging around it. parts.grille pivot (static geometry)
// ---------------------------------------------------------------------------
export function b_ceiling_vent(o) {
  const k = new DKit('ceiling_vent', { ground: 'ceiling', wear: { chip: 0.08, rust: 0.1, grime: 0.5, dust: 0.1 } });
  k.atlas(256, 256);
  const S = o.size ?? 0.6;
  const m = { tint: 0xc9c6bc };
  k.box('#0b0b0c:p', S - 0.06, 0.12, S - 0.06, 0, 0.06, 0, { r: 0 });
  const grille = k.grp(0, 0, 0, { name: 'grille' });
  k.insideStatic(grille, () => {
    k.push(0, 0, 0, [HP, 0, 0]);
    k.ext('paint', frameShape(S, S, 0.006, S - 0.07, S - 0.07, 0.003), 0.012, 0, 0, 0, { ...m, bev: 0.004, bevSeg: 2, curveSeg: 2 });
    const rings = 4, step = (S - 0.18) / rings;
    for (let i = 0; i < rings; i++) {
      const so = S - 0.07 - i * step, si = so - step * 0.62;
      k.ext('paint', frameShape(so, so, 0.004, si, si, 0.003), 0.006, 0, 0, 0.012 + i * 0.012, { ...m, bev: 0.0015, bevSeg: 1, curveSeg: 2 });
    }
    k.box('paint', 0.1, 0.1, 0.01, 0, 0, 0.06, { ...m, r: 0.004 });
    P.screw(k, 0, 0, 0.065, { kind: 'phillips', r: 0.004 });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.screw(k, sx * (S / 2 - 0.018), sy * (S / 2 - 0.018), 0.012, { kind: 'phillips', r: 0.0045, streak: 0 });
    // dust tide-lines on the louvres
    const dust = k.reg('cv_dust', 128, 128, (c, w, h, rng) => {
      c.clearRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) { const r0 = w * (0.5 - i * 0.1); c.strokeStyle = `rgba(30,28,24,${0.35 - i * 0.05})`; c.lineWidth = 4 + rng.next() * 3; c.strokeRect(w / 2 - r0 + 4, h / 2 - r0 + 4, 2 * r0 - 8, 2 * r0 - 8); }
    });
    k.decal(dust, S - 0.08, S - 0.08, 0, 0, 0.0605);
    k.pop();
  });
  // ceiling smudging around the diffuser (soot from years of airflow)
  const smudge = k.reg('cv_smudge', 128, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const g = c.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(40,36,30,0.45)'); g.addColorStop(1, 'rgba(40,36,30,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  k.decal(smudge, S + 0.24, S + 0.24, 0, -0.0006, 0, { rot: [HP, 0, 0] });
  k.collide(cbox(S, 0.03, S, 0, -0.015, 0));
  k.anchors.mouth = V3(0, -0.08, 0);
  k.parts.grille = grille;
  return k.done({ mass: 4, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Wall return vent: protruding duct collar, flange, louvred grille hinged at its top edge
// (parts.grille, +X swings out), rusty screws (one missing), dust & critter scratches
// ---------------------------------------------------------------------------
export function b_wall_vent(o) {
  const k = new DKit('wall_vent', { ground: 'wall', wear: { chip: 0.3, rust: 0.35, grime: 0.6, dust: 0.5 } });
  k.atlas(256, 256);
  const W = o.width ?? 0.5, H = o.height ?? 0.3, Dp = 0.05;
  const m = { tint: 0xa8a49a };
  k.box('#050505', W - 0.02, H - 0.02, 0.004, 0, 0, 0.004, { r: 0 });
  for (const sx of [-1, 1]) k.box('paint', 0.01, H, Dp, sx * (W / 2 - 0.005), 0, Dp / 2, { ...m, r: 0.001 });
  for (const sy of [-1, 1]) k.box('paint', W, 0.01, Dp, 0, sy * (H / 2 - 0.005), Dp / 2, { ...m, r: 0.001 });
  // duct seam + interior baffle seen through the louvres
  k.box('#141416:p', W - 0.03, 0.004, Dp - 0.01, 0, -0.03, Dp / 2 - 0.004, { r: 0 });
  k.ext('paint', frameShape(W + 0.05, H + 0.05, 0.006, W - 0.01, H - 0.01, 0.003), 0.008, 0, 0, Dp - 0.004, { ...m, bev: 0.002, bevSeg: 1, curveSeg: 2 });
  const grille = k.grp(0, H / 2 - 0.01, Dp + 0.006, { name: 'grille' });
  k.inside(grille, () => {
    const gy = -(H / 2 - 0.01);
    k.ext('paint', frameShape(W - 0.012, H - 0.012, 0.004, W - 0.05, H - 0.05, 0.002), 0.006, 0, gy, 0, { ...m, bev: 0.0015, bevSeg: 1, curveSeg: 2 });
    const n = Math.round((H - 0.05) / 0.025);
    for (let i = 0; i < n; i++) k.box('paint', W - 0.05, 0.022, 0.0025, 0, gy - (H - 0.05) / 2 + (i + 0.5) * ((H - 0.05) / n), 0.003, { ...m, rot: [0.75, 0, 0], r: 0, edge: 1.5 });
    // bent louvre (something tried to get out)
    k.box('paint', 0.08, 0.004, 0.012, W * 0.18, gy - (H - 0.05) / 2 + 0.5 * ((H - 0.05) / n) + 0.004, 0.006, { ...m, rot: [0.35, 0, 0.18], r: 0 });
    const scr = k.reg('wv_scratch', 128, 64, (c, w, h, rng) => { c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(230,225,210,0.5)'; c.lineWidth = 1.3; for (let i = 0; i < 9; i++) { const x = rng.next() * w; c.beginPath(); c.moveTo(x, h * 0.1); c.lineTo(x + rng.range(-12, 12), h * 0.9); c.stroke(); } });
    k.decal(scr, W * 0.35, H * 0.25, W * 0.15, gy - H * 0.22, 0.0065);
  });
  const SC = { r: 0.006, kind: 'phillips', rust: 0.8, streak: 0.05, streakCol: '96,42,14' };
  for (const [x, y] of [[-W / 2 - 0.006, H / 2 + 0.006], [W / 2 + 0.006, H / 2 + 0.006], [-W / 2 - 0.006, -H / 2 - 0.006]]) P.screw(k, x, y, Dp + 0.004, SC);
  k.cyl('#0a0a0a', 0.003, 0.004, W / 2 + 0.006, -H / 2 - 0.006, Dp + 0.003, { axis: 'z', seg: 8 });
  P.streak(k, 0, -H / 2 - 0.026, 0.0004, W * 0.6, 0.12, { col: '50,44,36', alpha: 0.3 });
  k.collide(cbox(W + 0.05, H + 0.05, Dp + 0.01, 0, 0, (Dp + 0.01) / 2));
  k.anchors.mouth = V3(0, 0, Dp + 0.15);
  k.anchors.inside = V3(0, 0, 0.02);
  k.parts.grille = grille;
  return k.done({ mass: 3, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Fire alarm: die-cast pull station (parts.handle), conduit, strobe (parts.strobe, own emissive)
// and a red gong bell (anchors.bell)
// ---------------------------------------------------------------------------
export function b_fire_alarm(o) {
  void o;
  const k = new DKit('fire_alarm', { ground: 'wall', wear: { chip: 0.22, rust: 0.08, grime: 0.45, dust: 0.5 } });
  k.atlas(256, 256);
  const red = { tint: 0xb3221a };
  // pull station (origin = its back centre): back box + chamfered cover
  k.box('paint', 0.1, 0.135, 0.02, 0, 0, 0.01, { ...red, r: 0.006 });
  k.ext('paint', rrShape(0.094, 0.128, 0.008), 0.026, 0, 0, 0.018, { ...red, bev: 0.006, bevSeg: 3, curveSeg: 3 });
  const ft = k.reg('fa_fire', 120, 60, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'FIRE', w / 2, h * 0.52, h * 0.72, { col: '#f4f0e6' }); }, 's');
  k.label(ft, 0.07, 0.035, 0, 0.038, 0.0442);
  const pd = k.reg('fa_pull', 120, 40, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'PULL DOWN', w / 2, h / 2, h * 0.5, { col: '#f4f0e6' }); rubOff(c, w, h, 0.6, 3); }, 's');
  k.label(pd, 0.07, 0.023, 0, -0.052, 0.0442);
  k.box('#200606:p', 0.062, 0.036, 0.004, 0, -0.008, 0.0425, { r: 0.002 });
  const handle = k.grp(0, 0.01, 0.046, { name: 'handle' });
  k.insideStatic(handle, () => {
    k.box('#e0dcd0:s', 0.05, 0.03, 0.014, 0, -0.018, 0.006, { r: 0.005 });
    k.box('paint', 0.054, 0.008, 0.018, 0, -0.002, 0.006, { ...red, r: 0.003 });
    k.box('#c4beb0:s', 0.04, 0.003, 0.002, 0, -0.026, 0.0132, { r: 0 });
  });
  P.screw(k, 0, 0.056, 0.044, { kind: 'hex', r: 0.003, fin: FIN.zinc });
  // conduit from the pull station up to the bell box
  P.conduit(k, [0.068, -0.02, 0.012], [0.068, 0.27, 0.012], 0.008, { couplings: 0 });
  k.box('metal', 0.03, 0.018, 0.02, 0.06, -0.02, 0.01, { ...FIN.zinc, r: 0.002 });
  // strobe: white housing + clear prismatic lens
  const by = 0.33;
  k.box('#d8d4c8:p', 0.09, 0.06, 0.036, 0, by - 0.13, 0.018, { r: 0.008 });
  const sm = emissiveMat(0xdddddd, 0xffffff, 0.15, { name: 'fa_strobe' });
  sm.userData.unique = true;
  const lens = new Geo();
  lens.append(boxGeo(0.07, 0.035, 0.012, { r: 0.005 }));
  const strobe = k.mesh(sm, lens, 0, by - 0.13, 0.04, { name: 'strobe', shadow: false, ao: false });
  const stl = k.reg('fa_strobe_t', 96, 20, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'FIRE', w / 2, h / 2, h * 0.8, { col: '#b3221a' }); }, 's');
  k.label(stl, 0.04, 0.009, 0, by - 0.168, 0.0362);
  // bell: mounting box, gong, striker
  k.box('paint', 0.12, 0.12, 0.03, 0, by, 0.015, { ...red, r: 0.008 });
  k.lathe('paint', [[0.004, 0.0], [0.075, 0.0, 1], [0.078, 0.008, 2], [0.07, 0.02], [0.05, 0.03], [0.0, 0.034]], 0, by, 0.03, { tint: 0xc22a20, axis: 'z', seg: 32, chip: 0.35 });
  k.cyl('metal', 0.01, 0.012, 0, by, 0.07, { ...FIN.chrome, axis: 'z', seg: 12, bev: 0.002 });
  k.box('metal', 0.012, 0.03, 0.01, 0, by - 0.058, 0.04, { ...FIN.zinc, r: 0.002 });
  k.sph('metal', 0.008, 0, by - 0.074, 0.046, { ...FIN.steel, ws: 10, hs: 6 });
  P.screws(k, [[-0.05, by + 0.05, 0.03], [0.05, by + 0.05, 0.03], [-0.05, by - 0.05, 0.03], [0.05, by - 0.05, 0.03]], { r: 0.003, kind: 'slot' });
  k.collide(cbox(0.1, 0.135, 0.045, 0, 0, 0.0225));
  k.collide(cbox(0.16, 0.2, 0.08, 0, by - 0.03, 0.04));
  k.parts.handle = handle;
  k.parts.strobe = strobe;
  k.anchors.bell = V3(0, by, 0.08);
  return k.done({ mass: 2, material: 'metal' });
}

// ---------------------------------------------------------------------------
// Exit sign: thermoformed housing with canopy, diffuser face (parts.panel, own emissive material)
// ---------------------------------------------------------------------------
export function b_exit_sign(o) {
  const k = new DKit('exit_sign', { ground: 'wall', wear: { chip: 0.05, rust: 0, grime: 0.35, dust: 0.6 } });
  const A = k.atlas(512, 256);
  const W = 0.36, H = 0.2, D = 0.06;
  const col = o.color === 'green' ? ['#1aff6a', '#03200c'] : ['#ff2a1a', '#200402'];
  const hous = { tint: 0xdcd6c6, rough: 0.9 };
  k.box('plastic', W, H, D - 0.004, 0, 0, (D - 0.004) / 2, { ...hous, r: 0.012 });
  k.box('plastic', 0.12, 0.024, 0.034, 0, H / 2 + 0.01, 0.017, { ...hous, r: 0.004 });
  k.box('plastic', 0.14, 0.006, 0.05, 0, H / 2 + 0.023, 0.025, { ...hous, r: 0.002 });
  const art = A.add(360, 200, (c, w, h, rng) => {
    c.fillStyle = col[1]; c.fillRect(0, 0, w, h);
    txt(c, 'EXIT', w * 0.47, h * 0.47, h * 0.62, { col: col[0], maxW: w * 0.66 });
    c.fillStyle = col[0];
    c.beginPath(); c.moveTo(w * 0.88, h * 0.47); c.lineTo(w * 0.79, h * 0.32); c.lineTo(w * 0.79, h * 0.62); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(w * 0.12, h * 0.47); c.lineTo(w * 0.21, h * 0.32); c.lineTo(w * 0.21, h * 0.62); c.closePath(); c.globalAlpha = 0.12; c.fill(); c.globalAlpha = 1;
    c.fillRect(w * 0.12, h * 0.82, w * 0.76, h * 0.03);
    // dead bugs inside the diffuser + lamp hot-spots
    for (let i = 0; i < 3; i++) { c.fillStyle = 'rgba(0,0,0,0.55)'; const x = w * (0.1 + rng.next() * 0.8), y = h * (0.75 + rng.next() * 0.18); c.beginPath(); c.ellipse(x, y, 4, 2.4, rng.next() * 3, 0, TAU); c.fill(); }
    const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  const face = emissiveMat(0xffffff, 0xffffff, 1.1, { name: 'exit_face', map: A.tex, rough: 0.3 });
  face.userData.unique = true; face.userData.noShadow = true;
  const g = quadGeo(W - 0.03, H - 0.03, art);
  const panel = k.mesh(face, g, 0, 0, D + 0.0012, { name: 'panel', shadow: false, atlasUV: true, ao: false });
  k.ext('plastic', frameShape(W, H, 0.012, W - 0.03, H - 0.03, 0.004), 0.006, 0, 0, D - 0.004, { ...hous, bev: 0.002, bevSeg: 1, curveSeg: 3 });
  P.screws(k, [[-W / 2 + 0.008, 0, D + 0.002], [W / 2 - 0.008, 0, D + 0.002]], { r: 0.0025, kind: 'phillips', fin: FIN.zinc });
  const test = k.reg('exit_test', 64, 24, (c, w, h) => { c.fillStyle = '#c8c2b2'; c.fillRect(0, 0, w, h); txt(c, 'TEST', w / 2, h / 2, h * 0.6, { col: '#333', f: 'bold' }); });
  k.box('#9a9488:s', 0.018, 0.008, 0.006, W / 2 - 0.03, -H / 2 + 0.004, D * 0.6, { r: 0.002 });
  k.label(test, 0.02, 0.0075, W / 2 - 0.03, -H / 2 - 0.0002, D * 0.6, { rot: [HP, 0, 0] });
  k.collide(cbox(W, H, D, 0, 0, D / 2));
  k.parts.panel = panel;
  return k.done({ mass: 2, material: 'plastic' });
}

// ---------------------------------------------------------------------------
// Hazard sign: rolled-edge aluminium plate with print, rusty screws + run-off streaks
// ---------------------------------------------------------------------------
const HAZARDS = {
  electric: ['DANGER', '#c0201a', 'bolt', ['HIGH VOLTAGE', 'KEEP OUT']],
  radiation: ['CAUTION', '#e8b417', 'rad', ['RADIATION AREA', 'DOSIMETER REQUIRED']],
  dimensional: ['WARNING', '#e8661c', '!', ['DIMENSIONAL INSTABILITY', 'DO NOT STARE INTO RIFT']],
  biohazard: ['CAUTION', '#e8b417', '!', ['BIOHAZARD', 'CLONE MATERIAL IN USE']],
  general: ['NOTICE', '#1d5fbf', '!', ['HARD HAT AREA', 'R.O.O.M. IS WATCHING']],
};
export function b_hazard_sign(o) {
  const k = new DKit('hazard_sign', { ground: 'wall', wear: { chip: 0.25, rust: 0.4, grime: 0.5, dust: 0.4 } });
  const A = k.atlas(512, 512);
  const [head, hc, sym, lines] = HAZARDS[o.kind || 'dimensional'] || HAZARDS.dimensional;
  const text = o.text ? String(o.text).split('\n') : lines;
  const W = o.width ?? 0.4, H = W * 0.75;
  const art = A.add(400, 300, (c, w, h) => {
    c.fillStyle = '#ece6d4'; c.fillRect(0, 0, w, h);
    c.fillStyle = hc === '#e8b417' ? '#111' : hc; c.fillRect(10, 10, w - 20, h * 0.24);
    if (hc === '#e8b417') { c.fillStyle = hc; c.fillRect(16, 16, w - 32, h * 0.24 - 12); }
    txt(c, head, w / 2, 10 + h * 0.12, h * 0.16, { col: hc === '#e8b417' ? '#111' : '#fff' });
    hazardTri(c, w * 0.2, h * 0.62, h * 0.4, sym);
    text.forEach((s, i) => txt(c, s, w * 0.62, h * (0.52 + i * 0.16), h * 0.085, { col: '#111', maxW: w * 0.6 }));
    c.strokeStyle = '#111'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12);
    grime(c, w, h, 0.8, 13, { corner: 0.15 }); rubOff(c, w, h, 0.7, 6);
  });
  k.box('metal', W, H, 0.0022, 0, 0, 0.0011, { ...FIN.alu, r: 0.0009, div: 0.06, dent: 0.0007 });
  k.tube('metal', [[-W / 2, -H / 2, 0.0011], [W / 2, -H / 2, 0.0011], [W / 2, H / 2, 0.0011], [-W / 2, H / 2, 0.0011]], 0.0016, { ...FIN.alu, round: 0.004, closed: true, radial: 5 });
  k.label(art, W - 0.006, H - 0.006, 0, 0, 0.0023);
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) P.screw(k, sx * (W / 2 - 0.015), sy * (H / 2 - 0.015), 0.0023, { r: 0.0045, kind: 'hex', rust: 0.9, streak: sy < 0 ? 0.05 : 0.035, streakCol: '110,48,16', streakA: 0.45 });
  k.collide(cbox(W, H, 0.006, 0, 0, 0.003));
  return k.done({ mass: 1, material: 'metal' });
}
