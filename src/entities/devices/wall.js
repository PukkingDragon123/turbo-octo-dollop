// Wall-mounted hardware: fuse box, fire alarm station, exit sign, hazard sign, wall / ceiling vents,
// wall clock, poster frame, mirror, employee-of-the-month plaque, dart board cabinet.
// Wall devices: origin = centre of the back plane on the wall surface (z = 0), front faces +Z.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, DEG, V3, cbox, ccyl, frameShape, rrShape, rrHole, circleShape, polyShape, latheGeo, axisGeo } from './core.js';
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
  k.ext('paint', frameShape(W, H, 0.004, W - 0.026, H - 0.026, 0.003), 0.003, 0, 0, dd - 0.003, { ...body, bev: 0.001 });
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
      k.box('#1e1e20:p', 0.072, 0.038, 0.024, x, y, 0.03, { r: 0.0015, wear: 0 });
      k.box('#e9e4d6', 0.03, 0.006, 0.0006, x - 0.02, y + 0.013, 0.0423, { r: 0, wear: 0 });
      const ry = (r === 3 && col === 1) ? -0.5 : 0.5;
      k.box('#d8d2c2:s', 0.016, 0.012, 0.016, x + 0.012, y, 0.042 + 0.007, { r: 0.0015, wear: 0, rot: [0, ry, 0] });
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
    k.cyl('metal', 0.016, 0.014, x, H / 2 + 0.007, 0.05, { ...FIN.zinc, seg: 6, bev: 0.002 });
    k.cyl('metal', 0.0135, 0.012, x, H / 2 + 0.02, 0.05, { ...FIN.zinc, seg: 14, bev: 0.002 });
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
