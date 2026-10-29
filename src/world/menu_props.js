// R.O.O.M. — modelled props of the clone factory (main menu set, world/menu_scene.js), built with the device
// kit (entities/devices/core.js): bevelled extrusions, lathe profiles, rivets / hex bolts, welds and the
// shared worn PBR classes (chipped paint over primer, bare steel, rust, grime run-off, dust on top faces).
// Each builder returns one merged object (a few draw calls per material class).
//   factorySet()   I-beam columns + trusses + crane rail, wall pipes, oil drums, scrap bin, shelving, arm
//                  pedestals, floodlight housings, the work lamp over the hook and the sign lamp
//   machinePlate() the riveted back plate + legs of the settings gear machine
//   plaqueBoard()  the commendations board (framed riveted panel)
//   partsBoard()   the workshop parts board (pegboard in an angle-iron frame; 1 x 1 m, scaled by the menu)
import { DKit, FIN, PI, HP, TAU, polyShape, extrudeGeo, frameShape } from '../entities/devices/core.js';
import * as P from '../entities/devices/parts.js';
import { txt, grime, hazardTri } from '../entities/devices/atlas.js';

const RUSTY = { ...FIN.iron, tint: 0x6e4a32, rust: 0.9, rough: 1.5 };
const STEEL = { ...FIN.steel, rust: 0.45 };
const BEAM = { tint: 0x3d4347, chip: 0.45, rust: 0.55 };
const YEL = { tint: 0xc8961a, chip: 0.6, rust: 0.5 };

// I-beam profile (h tall, b wide flanges, tw web, tf flange), centred
function iShape(h, b, tw, tf) {
  return polyShape([[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf], [b / 2, h / 2],
    [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]]);
}
// an I-beam of length L along an axis ('x' | 'y' | 'z'), centred at (x, y, z)
function ibeam(k, slot, L, h, b, axis, x, y, z, o = {}) {
  const g = extrudeGeo(iShape(h, b, Math.max(0.012, b * 0.08), Math.max(0.012, h * 0.07)), L, { bev: 0.003, bevSeg: 1, center: true });
  if (axis === 'y') g.rotX(-HP);
  else if (axis === 'x') g.rotY(HP);
  k.put(slot, g, x, y, z, o);
}
function hazardReg(k) {
  return k.reg('fs_hazard', 256, 64, (c, w, h) => {
    c.fillStyle = '#d6a21a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#16120c';
    for (let x = -h; x < w + h; x += 48) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 24, h); c.lineTo(x + 24 + h, 0); c.lineTo(x + h, 0); c.closePath(); c.fill(); }
    grime(c, w, h, 1.4, 7);
  });
}

export function factorySet({ railY = 3.78, armBase = [] } = {}) {
  const k = new DKit('factory_set', { wear: { chip: 0.4, rust: 0.55, grime: 0.7, dust: 0.5 }, ao: { off: true } });
  k.atlas(1024, 1024);
  const HZ = hazardReg(k);
  // ---- I-beam columns: base plate + hex bolts, hazard-striped foot, rivet rows, gusset plates
  for (let x = -12; x <= 12; x += 6) for (const z of [-3.4, 4.6]) {
    if (Math.abs(x) < 1 && z > 0) continue;
    ibeam(k, 'paint', 7.2, 0.3, 0.3, 'y', x, 3.6, z, BEAM);
    k.box('metal', 0.5, 0.025, 0.5, x, 0.0125, z, { ...RUSTY, r: 0.004 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.hexBolt(k, x + sx * 0.2, 0.025, z + sz * 0.2, { dir: 'y', r: 0.011, rust: 0.9 });
    for (const s of [-1, 1]) {
      k.label(HZ, 0.3, 0.5, x, 0.28, z + s * 0.151, { rot: [0, s < 0 ? PI : 0, HP] });
      for (let y = 0.8; y < 7; y += 0.45) for (const e of [-1, 1]) P.rivet(k, x + e * 0.12, y, z + s * 0.152, { dir: s < 0 ? '-z' : 'z', r: 0.007, rust: 0.8 });
    }
    for (const s of [-1, 1]) k.ext('paint', polyShape([[0, 0], [0.13, 0], [0, 0.24]]), 0.012, x + s * 0.012, 0.025, z, { ...BEAM, rot: [0, s < 0 ? PI : 0, 0], center: true });
  }
  // ---- roof trusses and the crane rail (hung on rods with clamp plates)
  for (let x = -14; x <= 14; x += 3.5) ibeam(k, 'paint', 22, 0.36, 0.18, 'z', x, 7.2, -1, { ...BEAM, chip: 0.3 });
  ibeam(k, 'paint', 30, 0.29, 0.22, 'x', 0, railY, 0, { tint: 0x494e52, chip: 0.5, rust: 0.6 });
  ibeam(k, 'paint', 30, 0.2, 0.18, 'x', 0, 4.5, -5.6, BEAM);
  const hanger = (x, y0, y1, z) => {
    P.rod(k, 'metal', [x, y0, z], [x, y1, z], 0.022, { ...STEEL, seg: 10 });
    k.box('metal', 0.16, 0.02, 0.24, x, y0 + 0.01, z, { ...RUSTY, r: 0.003 });
    k.box('metal', 0.16, 0.02, 0.24, x, y1 - 0.01, z, { ...RUSTY, r: 0.003 });
    for (const s of [-1, 1]) { P.hexBolt(k, x + s * 0.055, y0 + 0.02, z + 0.08, { dir: 'y', r: 0.008 }); P.hexBolt(k, x + s * 0.055, y0 + 0.02, z - 0.08, { dir: 'y', r: 0.008 }); }
  };
  for (let x = -12; x <= 12; x += 4) { hanger(x, railY + 0.145, 7.02, 0); hanger(x, 4.6, 7.02, -5.6); }
  // ---- pipes along the back wall: flanged runs on wall brackets, a valve, run-off rust
  for (const [y, r, tint] of [[5.6, 0.12, 0x5a6a5e], [5.25, 0.08, 0x8a3a2a], [6.1, 0.18, 0x6a6a64]]) {
    k.cyl('paint', r, 32, 0, y, -9.6, { tint, axis: 'x', seg: 18, chip: 0.55, rust: 0.7 });
    for (let x = -14; x <= 14; x += 4) {
      k.cyl('metal', r + 0.03, 0.04, x, y, -9.6, { ...RUSTY, axis: 'x', seg: 18, bev: 0.005, bevSeg: 1 });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.hexBolt(k, x + 0.022, y + Math.cos(a) * (r + 0.018), -9.6 + Math.sin(a) * (r + 0.018), { dir: 'x', r: 0.006, rust: 0.9 }); }
      k.box('metal', 0.04, 0.04, 0.4 - r, x + 1.2, y, -9.8 + (0.4 - r) / 2 - 0.2, { ...RUSTY, r: 0.004 });
      k.tor('metal', r + 0.01, 0.008, x + 1.2, y, -9.6, { ...RUSTY, rot: [0, HP, 0], ts: 18, rs: 4 });
    }
  }
  // ---- oil drums: rolled hoops, lid rim with bung caps, dents, rust, a stencilled label
  const DRUM = k.reg('fs_drum', 256, 128, (c, w, h) => {
    c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, w, h);
    hazardTri(c, w * 0.2, h * 0.5, h * 0.7, '!');
    txt(c, 'FLAMMABLE', w * 0.62, h * 0.38, h * 0.26, { col: '#e8dcc0', f: 'main', w: '700' });
    txt(c, 'COOLANT  9', w * 0.62, h * 0.7, h * 0.18, { col: '#e8dcc0', f: 'main', w: '600' });
    grime(c, w, h, 1.5, 3);
  }, 'decal');
  const drumProf = (r, h) => [[0, 0], [r - 0.01, 0, 1], [r, 0.012, 2], [r, h * 0.33 - 0.012], [r + 0.012, h * 0.33, 2], [r, h * 0.33 + 0.012], [r, h * 0.66 - 0.012], [r + 0.012, h * 0.66, 2], [r, h * 0.66 + 0.012], [r, h - 0.02], [r + 0.008, h - 0.008, 2], [r - 0.005, h, 1], [r - 0.02, h - 0.012], [0, h - 0.012]];
  const drums = [[-7.5, -3, 0x2a4a7a, 0], [-7.0, -2.6, 0x8a2418, 0.2], [8.2, 4.1, 0x2c2e30, 0], [6.6, -7.8, 0x2a4a7a, 0], [-9.6, 3.8, 0x5a6a3a, 1.4]];
  for (const [x, z, tint, tip] of drums) {
    k.push(x, tip ? 0.29 : 0, z, tip ? [0, 0.4, HP] : [0, x * 3, 0]);
    k.lathe('paint', drumProf(0.29, 0.88), 0, 0, 0, { tint, seg: 28, chip: 0.7, rust: 0.8, dent: 0.006 });
    k.cyl('metal', 0.03, 0.012, 0.16, 0.876, 0.05, { ...RUSTY, seg: 10 });
    k.cyl('metal', 0.018, 0.012, -0.15, 0.876, -0.08, { ...RUSTY, seg: 8 });
    k.push(0, 0.5, 0); k.clabel(DRUM, 0.2925, 0.26, 1.3, 0, 0, 0, { decal: true, a: 0.2 }); k.pop();
    k.pop();
  }
  // ---- scrap bin: angle-iron frame, dented sheet walls, a few offcuts sticking out
  {
    const x = 2.2, z = 1.2;
    for (const s of [-1, 1]) {
      k.box('metal', 0.9, 0.5, 0.02, x, 0.27, z + s * 0.34, { ...RUSTY, dent: 0.012, r: 0.003 });
      k.box('metal', 0.02, 0.5, 0.66, x + s * 0.44, 0.27, z, { ...RUSTY, dent: 0.012, r: 0.003 });
    }
    k.box('metal', 0.9, 0.02, 0.7, x, 0.03, z, { ...RUSTY, r: 0.003 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('paint', 0.04, 0.56, 0.04, x + sx * 0.45, 0.28, z + sz * 0.35, { ...YEL, r: 0.004 });
    for (const s of [-1, 1]) { k.box('paint', 0.94, 0.04, 0.04, x, 0.54, z + s * 0.35, { ...YEL, r: 0.004 }); k.box('paint', 0.04, 0.04, 0.74, x + s * 0.45, 0.54, z, { ...YEL, r: 0.004 }); }
    P.rod(k, 'metal', [x - 0.2, 0.3, z - 0.1], [x + 0.1, 0.85, z + 0.15], 0.012, { ...RUSTY });
    k.box('metal', 0.3, 0.012, 0.22, x + 0.18, 0.52, z - 0.05, { ...STEEL, rot: [0.5, 0.3, 0.2], dent: 0.01 });
    P.angleIron(k, 'metal', 0.6, 0.04, 0.04, 0.005, x - 0.3, 0.45, z + 0.1, { ...RUSTY, rot: [0, 0.4, 0.7] });
  }
  // ---- shelving along the back wall: slotted angle uprights, lipped shelves, boxes and cans on them
  for (const sx of [-11, -8.5, 9.5, 12]) {
    for (const ex of [-1, 1]) for (const ez of [0, 1]) {
      k.push(sx + ex * 1.1, 0, -9.3 - 0.33 + ez * 0.66, [0, 0, HP]);
      P.angleIron(k, 'paint', 3, 0.04, 0.04, 0.004, 0, 0, 0, { tint: 0x5a6058, chip: 0.5, rust: 0.6 });
      k.pop();
    }
    for (let y = 0.5; y < 3; y += 0.9) {
      k.box('paint', 2.2, 0.03, 0.7, sx, y, -9.3, { tint: 0x5a6058, chip: 0.5, rust: 0.6, r: 0.006 });
      for (let i = 0; i < 3; i++) {
        const bx = sx - 0.8 + i * 0.7 + Math.sin(y * 7 + i) * 0.1;
        if ((i + Math.round(y * 3)) % 3 === 0) k.cyl('paint', 0.09, 0.22, bx, y + 0.125, -9.25, { tint: [0x8a2418, 0x2a4a7a, 0x9a8a2a][i], seg: 14, chip: 0.6, rust: 0.6 });
        else k.box('wood', 0.42, 0.26, 0.42, bx, y + 0.145, -9.28, { tint: 0x9a7448, r: 0.006, dent: 0.006 });
      }
    }
  }
  // ---- outfitting-arm pedestals: lathe-turned column, base flange with a bolt ring, painted hazard collar
  for (const b of armBase) {
    k.lathe('paint', [[0, 0], [0.3, 0, 1], [0.3, 0.035, 2], [0.22, 0.05, 2], [0.2, 0.09], [0.2, b.y - 0.06], [0.23, b.y - 0.03, 2], [0.23, b.y, 1], [0, b.y]], b.x, 0, b.z, { tint: 0x3f4448, seg: 30, chip: 0.4, rust: 0.5 });
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; P.hexBolt(k, b.x + Math.cos(a) * 0.26, 0.035, b.z + Math.sin(a) * 0.26, { dir: 'y', r: 0.011, rust: 0.9 }); }
    k.push(b.x, 0.32, b.z); k.clabel(HZ, 0.202, 0.18, TAU, 0, 0, 0, { decal: false, a: 0, seg: 30 }); k.pop();
  }
  // ---- floodlight housings (two per bank): pressed-steel hood, end caps, louvre fins, hanging rods
  for (let b = 0; b < 4; b++) for (const z of [2.2, -2.2]) {
    const x = -4.5 + b * 3;
    k.box('paint', 1.6, 0.12, 0.5, x, 6.66, z, { tint: 0x30353a, r: 0.02, chip: 0.4, rust: 0.4 });
    for (const s of [-1, 1]) k.box('paint', 0.04, 0.16, 0.54, x + s * 0.8, 6.64, z, { tint: 0x30353a, r: 0.008, chip: 0.4 });
    for (let i = 1; i < 8; i++) k.box('metal', 0.006, 0.05, 0.46, x - 0.8 + i * 0.2, 6.555, z, { ...STEEL, r: 0 });
    for (const s of [-1, 1]) P.rod(k, 'metal', [x + s * 0.6, 6.72, z], [x + s * 0.6, 7.02, z], 0.008, STEEL);
  }
  // ---- caged work lamp over the hook (its lens disc stays a separate, animated mesh in the menu)
  {
    const lx = 0.6, ly = 6.55, lz = 1.4;
    k.lathe('paint', [[0.02, 0.2], [0.06, 0.19, 2], [0.22, 0.04], [0.33, -0.15, 2], [0.32, -0.16, 1], [0.21, 0.03], [0.05, 0.17], [0.02, 0.18]], lx, ly, lz, { tint: 0x2e3a34, seg: 28, chip: 0.5, rust: 0.6 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.rod(k, 'metal', [lx + Math.cos(a) * 0.3, ly - 0.15, lz + Math.sin(a) * 0.3], [lx + Math.cos(a) * 0.12, ly - 0.36, lz + Math.sin(a) * 0.12], 0.004, STEEL); }
    k.tor('metal', 0.12, 0.005, lx, ly - 0.36, lz, { ...STEEL, rot: [HP, 0, 0], ts: 18, rs: 4 });
    P.rod(k, 'metal', [lx, ly + 0.2, lz], [lx, 7.02, lz], 0.01, STEEL);
  }
  return k.done();
}

// the caged lamp shade of the hub signs' work lamp, aimed along local -z (built at the origin)
export function signLampShade() {
  const k = new DKit('sign_lamp', { wear: { chip: 0.5, rust: 0.6, grime: 0.6, dust: 0.5 }, ao: { res: 32 } });
  k.push(0, 0, 0, [-HP, 0, 0]);
  k.lathe('paint', [[0.02, 0.12], [0.05, 0.11, 2], [0.14, 0.0], [0.17, -0.1, 2], [0.165, -0.11, 1], [0.13, -0.01], [0.04, 0.1], [0.02, 0.11]], 0, 0, 0, { tint: 0x7a5a1a, seg: 24, chip: 0.6, rust: 0.7 });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; P.rod(k, 'metal', [Math.cos(a) * 0.16, -0.1, Math.sin(a) * 0.16], [Math.cos(a) * 0.06, -0.24, Math.sin(a) * 0.06], 0.003, STEEL); }
  k.tor('metal', 0.06, 0.004, 0, -0.24, 0, { ...STEEL, rot: [HP, 0, 0], ts: 14, rs: 4 });
  k.cyl('metal', 0.03, 0.06, 0, 0.14, 0, { ...STEEL, seg: 12 });
  k.pop();
  return k.done();
}

// settings machine back: riveted plate with stiffener ribs on two I-beam legs (front face at z = 0)
export function machinePlate(w = 2.5, h = 2.2, cy = 1.62) {
  const k = new DKit('gear_machine', { wear: { chip: 0.45, rust: 0.6, grime: 0.7, dust: 0.4 }, ao: { res: 48 } });
  k.atlas(512, 256);
  const PL = { tint: 0x4f5a52, chip: 0.5, rust: 0.6 };
  k.box('paint', w, h, 0.03, 0, cy, -0.015, { ...PL, r: 0.008, dent: 0.004 });
  for (const s of [-1, 1]) k.box('paint', 0.08, h, 0.05, s * (w / 2 - 0.04), cy, 0.01, { ...PL, r: 0.006 });
  for (const s of [-1, 1]) k.box('paint', w - 0.16, 0.08, 0.05, 0, cy + s * (h / 2 - 0.04), 0.01, { ...PL, r: 0.006 });
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) {
    P.rivet(k, -w / 2 + 0.12 + i * ((w - 0.24) / 11), cy + s * (h / 2 - 0.04), 0.037, { r: 0.008, rust: 0.85 });
    P.rivet(k, s * (w / 2 - 0.04), cy - h / 2 + 0.12 + i * ((h - 0.24) / 11), 0.037, { r: 0.008, rust: 0.85 });
  }
  for (const s of [-1, 1]) {
    ibeam(k, 'paint', 0.6, 0.14, 0.14, 'y', s * 0.95, 0.3, -0.06, { tint: 0x3d4347, chip: 0.5, rust: 0.6 });
    k.box('metal', 0.3, 0.02, 0.3, s * 0.95, 0.01, -0.06, { ...RUSTY, r: 0.003 });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.hexBolt(k, s * 0.95 + a * 0.11, 0.02, -0.06 + b * 0.11, { dir: 'y', r: 0.009 });
  }
  P.streak(k, -0.7, cy + 0.6, 0.002, 0.2, 0.9, { col: '96,42,14', alpha: 0.5 });
  P.streak(k, 0.8, cy + 0.2, 0.002, 0.25, 1.1, { col: '60,40,20', alpha: 0.45 });
  return k.done();
}

// commendations board: framed riveted sheet (front at z = 0, centre at the origin)
export function plaqueBoard(w = 4.4, h = 3.2) {
  const k = new DKit('plaque_board', { wear: { chip: 0.4, rust: 0.5, grime: 0.6, dust: 0.4 }, ao: { res: 48 } });
  k.box('paint', w, h, 0.03, 0, 0, -0.015, { tint: 0x2c3436, r: 0.006, dent: 0.003, chip: 0.4 });
  k.ext('paint', frameShape(w + 0.12, h + 0.12, 0.01, w - 0.04, h - 0.04, 0.004), 0.05, 0, 0, -0.02, { tint: 0x3a3226, chip: 0.6, rust: 0.6, bev: 0.006, bevSeg: 1 });
  for (let i = 0; i < 16; i++) for (const s of [-1, 1]) P.rivet(k, -w / 2 + 0.1 + i * ((w - 0.2) / 15), s * (h / 2 + 0.03), 0.032, { r: 0.008, rust: 0.8 });
  for (let i = 0; i < 12; i++) for (const s of [-1, 1]) P.rivet(k, s * (w / 2 + 0.03), -h / 2 + 0.1 + i * ((h - 0.2) / 11), 0.032, { r: 0.008, rust: 0.8 });
  return k.done();
}

// workshop parts board: perforated pegboard sheet in an angle frame, 1 x 1 m (the menu scales it)
export function partsBoard() {
  const k = new DKit('parts_board', { wear: { chip: 0.35, rust: 0.4, grime: 0.6, dust: 0.3 }, ao: { off: true } });
  k.atlas(512, 512);
  const peg = k.reg('pb_peg', 256, 256, (c, w, h) => {
    c.fillStyle = '#3a3e3c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0c0d0c';
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { c.beginPath(); c.arc(x, y, 3.2, 0, TAU); c.fill(); }
    grime(c, w, h, 1.2, 5);
  });
  k.label(peg, 0.96, 0.96, 0, 0, 0.001);
  k.box('paint', 0.98, 0.98, 0.015, 0, 0, -0.008, { tint: 0x2a2e2c, r: 0.002 });
  for (const s of [-1, 1]) {
    k.box('paint', 1.02, 0.03, 0.03, 0, s * 0.49, 0.005, { tint: 0x6a5a2a, chip: 0.6, rust: 0.6, r: 0.004 });
    k.box('paint', 0.03, 0.96, 0.03, s * 0.49, 0, 0.005, { tint: 0x6a5a2a, chip: 0.6, rust: 0.6, r: 0.004 });
  }
  return k.done();
}

// floor hatch of the drop shaft: an angle-iron frame round the opening (w x w, top at y = 0.04) ...
export function hatchFrame(w) {
  const k = new DKit('hatch_frame', { wear: { chip: 0.5, rust: 0.6, grime: 0.8, dust: 0.5 }, ao: { res: 32 } });
  k.atlas(512, 256);
  const HZ = hazardReg(k), fw = 0.12;
  for (const s of [-1, 1]) {
    k.box('paint', w + fw * 2, 0.04, fw, 0, 0.02, s * (w / 2 + fw / 2), { ...YEL, r: 0.006 });
    k.box('paint', fw, 0.04, w, s * (w / 2 + fw / 2), 0.02, 0, { ...YEL, r: 0.006 });
    k.label(HZ, w + fw * 2 - 0.02, fw - 0.02, 0, 0.0405, s * (w / 2 + fw / 2), { rot: [-HP, 0, 0] });
    k.label(HZ, w - 0.02, fw - 0.02, s * (w / 2 + fw / 2), 0.0405, 0, { rot: [-HP, 0, HP] });
    for (let i = 0; i < 6; i++) {
      const t = -w / 2 + (i + 0.5) * (w / 6);
      P.hexBolt(k, t, 0.041, s * (w / 2 + fw / 2), { dir: 'y', r: 0.008, rust: 0.9 });
      P.hexBolt(k, s * (w / 2 + fw / 2), 0.041, t, { dir: 'y', r: 0.008, rust: 0.9 });
    }
  }
  return k.done();
}
// ... and one door leaf: hinge on local x = 0, the leaf lies toward -x (mirror it with scale.x = -1)
export function hatchDoor(w) {
  const k = new DKit('hatch_door', { wear: { chip: 0.55, rust: 0.55, grime: 0.7, dust: 0.5 }, ao: { res: 32 } });
  k.atlas(512, 256);
  const HZ = hazardReg(k), lw = w / 2 - 0.01, ld = w - 0.01;
  k.box('paint', lw, 0.045, ld, -lw / 2 - 0.005, 0.0225, 0, { ...YEL, r: 0.008, dent: 0.004 });
  k.label(HZ, lw - 0.08, ld - 0.08, -lw / 2 - 0.005, 0.0456, 0, { rot: [-HP, 0, 0] });
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) P.rivet(k, -0.03 - i * ((lw - 0.06) / 7), 0.046, s * (ld / 2 - 0.025), { dir: 'y', r: 0.006, rust: 0.8 });
  for (const z of [-ld / 2 + 0.12, 0, ld / 2 - 0.12]) k.cyl('metal', 0.018, 0.14, 0, 0.03, z, { ...RUSTY, axis: 'z', seg: 12, bev: 0.003, bevSeg: 1 });
  k.tor('metal', 0.05, 0.008, -lw + 0.08, 0.05, 0, { ...STEEL, arc: PI, rot: [0, HP, 0], ts: 12, rs: 5 });
  return k.done();
}
