// Dispatch bay + field kit: dimensional dispatch bulkhead door, dispatch lever, FR-90 field radio,
// supply crate, employee starter box. Door / lever: origin on the floor, front +Z.
// Props (radio, crate, starter box): origin at the centre (halfHeight returned).
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, frameShape, rrShape, rrHole, Geo, boxGeo, latheGeo, cylGeo, lerp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, drawLogo, drawClone, drawPerforation, hazardTri } from './atlas.js';
import { RNG } from '../../core/rng.js';

const STEEL = { ...FIN.steel, rust: 0.25 };
const lens = (r, h) => new Geo().append(latheGeo([[0.0001, 0], [r, 0, 1], [r * 0.96, h * 0.4], [r * 0.7, h * 0.85], [0.0001, h]], 14, { rings: false }));

// ---------------------------------------------------------------------------
// DISPATCH DOOR: riveted bulkhead with a 3.0 x 2.6 m opening, hazard-striped frame, hydraulic pistons,
// rotating beacons (parts.beaconLamps own materials, parts.beaconReflectors spin), sliding leaves
// parts.left / parts.right (bones of one skinned mesh per material; position.x slides, userData.x0)
// ---------------------------------------------------------------------------
export function b_dispatch_door(o) {
  void o;
  const k = new DKit('dispatch_door', { wear: { chip: 0.28, rust: 0.3, grime: 0.6, dust: 0.45 }, ao: { res: 72 } });
  const A = k.atlas(1024, 1024);
  const OW = 3.0, OH = 2.6, travel = 1.55;
  const PLATE = { tint: 0x575d63 }, FRAME = { tint: 0x2f3338 }, LEAF = { tint: 0x6b7178 };
  const bw = 6.8, bh = 3.4;
  // bulkhead plates front + back with the opening cut out
  for (const zc of [0.02, -0.28]) {
    for (const sx of [-1, 1]) k.box('paint', (bw - OW) / 2, bh, 0.04, sx * (OW / 2 + (bw - OW) / 4), bh / 2, zc, { ...PLATE, r: 0.004, div: zc > 0 ? 0.9 : 0, dent: zc > 0 ? 0.002 : 0 });
    k.box('paint', OW, bh - OH, 0.04, 0, OH + (bh - OH) / 2, zc, { ...PLATE, r: 0.004 });
  }
  // plate seams + rivet rows
  for (const sx of [-1, 1]) for (const px of [2.35, 3.25]) {
    k.box('paint', 0.04, bh, 0.012, sx * px, bh / 2, 0.046, { ...FRAME, r: 0.003 });
    for (let i = 0; i < 9; i++) P.rivet(k, sx * px, 0.2 + i * 0.42, 0.052, { r: 0.012, rust: 0.6 });
    P.streak(k, sx * px + 0.05, 0.6, 0.0405, 0.08, 0.5, { col: '96,42,14', alpha: 0.4 });
  }
  // frame posts + lintel, hazard faces, hydraulic pistons
  const fw = 0.42, fd = 0.28, lh = 0.5, fz = 0.04 + fd / 2;
  for (const sx of [-1, 1]) {
    const x = sx * (OW / 2 + fw / 2);
    k.box('paint', fw, OH + lh, fd, x, (OH + lh) / 2, fz, { ...FRAME, r: 0.02 });
    k.push(sx * (OW / 2 + 0.002), OH / 2, fz, [0, -sx * HP, 0]);
    P.hazardRect(k, fd - 0.04, OH, 0, 0, 0, { sw: 0.12, t: 0.003 });
    k.pop();
    k.push(x - sx * (fw / 2 - 0.06), (OH + lh) / 2, 0.04 + fd);
    P.hazardRect(k, 0.08, OH + lh, 0, 0, 0, { sw: 0.08, t: 0.003, dir: sx });
    k.pop();
    k.cyl('metal', 0.05, 1.1, x + sx * 0.06, 1.3, 0.04 + fd + 0.07, { ...FIN.steel, seg: 16, bev: 0.006 });
    k.cyl('metal', 0.03, 0.9, x + sx * 0.06, 2.2, 0.04 + fd + 0.07, { ...FIN.chrome, seg: 14, rust: 0 });
    for (const y of [0.72, OH + 0.1]) {
      k.box('paint', 0.14, 0.08, 0.12, x + sx * 0.06, y, 0.04 + fd + 0.04, { ...FRAME, r: 0.01 });
      k.cyl('metal', 0.018, 0.16, x + sx * 0.06, y, 0.04 + fd + 0.07, { ...FIN.steel, axis: 'x', seg: 10 });
    }
    P.conduit(k, [x + sx * 0.12, 0.02, 0.04 + fd + 0.03], [x + sx * 0.12, 1.25, 0.04 + fd + 0.03], 0.011, { couplings: 1 });
  }
  k.box('paint', OW + 2 * fw, lh, fd, 0, OH + lh / 2, fz, { ...FRAME, r: 0.02 });
  k.push(0, OH + 0.002, fz, [HP, 0, 0]);
  P.hazardRect(k, OW, fd - 0.04, 0, 0, 0, { sw: 0.12, t: 0.003 });
  k.pop();
  // threshold track
  k.box('metal', OW + 0.2, 0.012, 0.6, 0, 0.006, -0.12, { ...FIN.steel, r: 0.002 });
  k.push(0, 0.0125, 0.2, [-HP, 0, 0]);
  P.hazardRect(k, OW, 0.18, 0, 0, 0, { sw: 0.1, t: 0.002 });
  k.pop();
  k.box('#0e0e0e', OW + 0.2, 0.01, 0.04, 0, 0.012, -0.12, { r: 0 });
  // lit sign on the lintel
  const sign = A.add(1000, 130, (c, w, h) => {
    c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, 8); c.fillRect(0, h - 8, w, 8);
    txt(c, 'DIMENSIONAL DISPATCH', w / 2, h * 0.4, h * 0.42, { col: '#e8b417', maxW: w * 0.9 });
    txt(c, '— AUTHORIZED CLONES ONLY —', w / 2, h * 0.78, h * 0.2, { col: '#d8d0bc', f: 'mono', maxW: w * 0.9 });
    grime(c, w, h, 0.8, 41);
  }, { e: 0.14, r: 0.5, m: 0 });
  k.box('metal', 3.3, 0.42, 0.03, 0, OH + lh / 2, 0.04 + fd + 0.015, { ...FIN.black, r: 0.01 });
  k.label(sign, 3.24, 0.4, 0, OH + lh / 2, 0.04 + fd + 0.0306);
  for (const [x, y] of [[-1.6, 0.17], [1.6, 0.17], [-1.6, -0.17], [1.6, -0.17]]) P.screw(k, x, OH + lh / 2 + y, 0.04 + fd + 0.03, { kind: 'hex', r: 0.01 });
  // conduits along the top
  k.cyl('metal', 0.035, bw - 0.3, 0, bh - 0.12, 0.1, { ...FIN.zinc, axis: 'x', seg: 12 });
  k.cyl('metal', 0.025, bw - 0.3, 0, bh - 0.22, 0.09, { ...FIN.zinc, axis: 'x', seg: 12 });
  for (const x of [-2.6, -1, 1, 2.6]) for (const [y, r] of [[bh - 0.12, 0.035], [bh - 0.22, 0.025]]) k.tor('metal', r + 0.004, 0.004, x, y, 0.1, { ...FIN.zinc, axis: 'x', ts: 14, rs: 4 });
  // beacons: base, chrome collar, translucent dome (own material) + spinning reflector (instanced)
  const bY = OH + lh;
  k.parts.beacons = []; k.parts.beaconLamps = [];
  const paintUV = (g, s) => { for (let i = 0; i < g.uv.length; i += 2) { g.uv[i] = s.u; g.uv[i + 1] = s.v; } return g; };
  const refl = new Geo()
    .append(paintUV(cylGeo(0.06, 0.11, { seg: 12, open: true, phi0: -HP, phiLen: PI }).translate(0, 0.06, -0.01), A.swatch('#d8dce0:c')))
    .append(paintUV(latheGeo([[0.0001, 0], [0.022, 0, 1], [0.021, 0.012], [0.012, 0.03], [0.0001, 0.034]], 10, { rings: false }).rotX(HP).translate(0, 0.06, -0.004), A.swatch('#ffb040:e')));
  [-1.25, 1.25].forEach((x, i) => {
    const g = k.grp(x, bY, fz, { name: 'beacon_' + i });
    k.insideStatic(g, () => {
      k.cyl('#1a1a1a:p', 0.1, 0.06, 0, 0.03, 0, { seg: 22, r2: 0.11, bev: 0.005 });
      k.cyl('#c4c7ca:c', 0.087, 0.01, 0, 0.065, 0, { seg: 22, bev: 0.002 });
    });
    const dm = new THREE.MeshStandardMaterial({ color: 0xff8a20, emissive: 0xff5a00, emissiveIntensity: 1.6, transparent: true, opacity: 0.72, roughness: 0.2, depthWrite: false });
    dm.userData.unique = true; dm.userData.noShadow = true; dm.name = 'beacon_dome';
    const lm = k.mesh(dm, latheGeo([[0.08, 0], [0.08, 0.1], [0.07, 0.14], [0.045, 0.165], [0.0001, 0.175]], 22, { rings: false }), 0, 0.07, 0, { name: 'beaconLamp_' + i, shadow: false, ao: false, to: g });
    lm.renderOrder = 4;
    k.parts.beacons.push(g); k.parts.beaconLamps.push(lm);
  });
  k.parts.beaconReflectors = k.instanced('beaconReflector', k.mats.atlas, refl, [[-1.25, bY + 0.07, fz], [1.25, bY + 0.07, fz]], { atlasUV: true, uvOff: false });
  // ---- door leaves: two bones, one skinned mesh per material ----
  const LW = OW / 2 + 0.05, LH = OH + 0.02, LD = 0.16, lz = -0.12;
  const stencils = [-1, 1].map((sx) => A.add(300, 160, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, sx < 0 ? 'D-0' : '01', w / 2, h / 2, h * 0.8, { col: 'rgba(230,220,200,0.85)', f: 'stencil' }); rubOff(c, w, h, 1.2, sx + 5); }, 'p'));
  const leaves = k.bones('leaves', [[-LW / 2, 0, lz, null, 'left'], [LW / 2, 0, lz, null, 'right']], (i) => {
    const sx = i ? 1 : -1;
    const s = new THREE.Shape();
    const e = -sx * LW / 2, out = sx * LW / 2;
    s.moveTo(out, 0); s.lineTo(e + sx * 0.05, 0);
    const teeth = 6;
    for (let t = 0; t < teeth; t++) {
      const y0 = (t / teeth) * LH, y1 = ((t + 0.5) / teeth) * LH, y2 = ((t + 1) / teeth) * LH;
      const inX = e + sx * 0.05, outX = e - sx * 0.05;
      if (sx < 0) { s.lineTo(t % 2 ? inX : outX, y0); s.lineTo(t % 2 ? inX : outX, y1); s.lineTo(t % 2 ? outX : inX, y1); s.lineTo(t % 2 ? outX : inX, y2); }
      else { s.lineTo(t % 2 ? outX : inX, y0); s.lineTo(t % 2 ? outX : inX, y1); s.lineTo(t % 2 ? inX : outX, y1); s.lineTo(t % 2 ? inX : outX, y2); }
    }
    s.lineTo(out, LH); s.closePath();
    k.ext('paint', s, LD, 0, 0, -LD / 2, { ...LEAF, bev: 0.01, bevSeg: 1, curveSeg: 1 });
    for (let r = 0; r < 4; r++) {
      const y = 0.55 + r * 0.6;
      k.box('paint', LW - 0.25, 0.06, 0.03, sx * 0.05, y, LD / 2 + 0.015, { ...FRAME, r: 0.005 });
      for (let j = 0; j < 6; j++) P.rivet(k, sx * 0.05 - (LW - 0.35) / 2 + j * ((LW - 0.35) / 5), y, LD / 2 + 0.03, { r: 0.01, slot: '#9aa0a4:m' });
    }
    P.hazardRect(k, LW - 0.06, 0.32, 0, 0.2, LD / 2, { sw: 0.1, t: 0.003 });
    const px = sx * 0.25, py = 1.75;
    k.tor('#9aa0a4:m', 0.14, 0.022, px, py, LD / 2 + 0.008, { rs: 8, ts: 28 });
    k.disc('#16201f:g', 0.13, px, py, LD / 2 + 0.005, { seg: 28 });
    for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU; k.cyl('#9aa0a4:m', 0.01, 0.012, px + Math.cos(a) * 0.14, py + Math.sin(a) * 0.14, LD / 2 + 0.028, { axis: 'z', seg: 6 }); }
    k.label(stencils[i], 0.6, 0.32, sx * 0.1, 1.15, LD / 2 + 0.0008);
    for (let r = 0; r < 3; r++) k.box('paint', LW - 0.25, 0.06, 0.03, sx * 0.05, 0.7 + r * 0.7, -LD / 2 - 0.015, { ...FRAME, r: 0.004 });
  });
  for (const l of leaves) l.userData.x0 = l.position.x;
  k.parts.left = leaves[0];
  k.parts.right = leaves[1];
  // colliders: posts, plates, lintel
  for (const sx of [-1, 1]) {
    k.collide(cbox(fw, OH + lh, fd, sx * (OW / 2 + fw / 2), (OH + lh) / 2, fz));
    k.collide(cbox((bw - OW) / 2, bh, 0.36, sx * (OW / 2 + (bw - OW) / 4), bh / 2, -0.12));
  }
  k.collide(cbox(OW + 2 * fw, bh - OH, 0.36, 0, OH + (bh - OH) / 2, -0.06));
  k.params.travel = travel;
  k.params.opening = [OW, OH];
  k.params.leafCollider = cbox(LW, LH, LD, 0, LH / 2, 0);
  k.anchors.threshold = V3(0, 0, 0.3);
  k.anchors.through = V3(0, 0, -1.0);
  return k.done({ mass: 6000, material: 'metal' });
}

// ---------------------------------------------------------------------------
// DISPATCH LEVER: bolted pedestal, lever on an axle (parts.handle rotation.x -0.6 armed .. +0.6 pulled),
// status CRT (screens.main), READY / ARMED lamps (parts.lamps, names lamp_ready / lamp_armed)
// ---------------------------------------------------------------------------
export function b_dispatch_lever(o) {
  void o;
  const k = new DKit('dispatch_lever', { wear: { chip: 0.25, rust: 0.2, grime: 0.55, dust: 0.4 } });
  const A = k.atlas(512, 1024);
  const BODY = { tint: 0x3b4046 };
  k.box('metal', 0.5, 0.04, 0.45, 0, 0.02, 0, { ...STEEL, r: 0.008 });
  for (const [x, z] of [[-0.21, -0.18], [0.21, -0.18], [-0.21, 0.18], [0.21, 0.18]]) P.screw(k, x, 0.04, z, { kind: 'hex', r: 0.012, dir: 'y', rust: 0.6 });
  k.box('paint', 0.24, 0.72, 0.22, 0, 0.4, 0, { ...BODY, r: 0.015, div: 0.2, dent: 0.0008 });
  k.push(0, 0.14, 0.1105);
  P.hazardRect(k, 0.24, 0.18, 0, 0, 0, { sw: 0.05 });
  k.pop();
  for (const sx of [-1, 1]) { k.push(sx * 0.1205, 0.14, 0, [0, sx * HP, 0]); P.hazardRect(k, 0.22, 0.18, 0, 0, 0, { sw: 0.05 }); k.pop(); }
  k.box('paint', 0.36, 0.22, 0.3, 0, 0.87, 0, { ...BODY, r: 0.025 });
  k.box('#0e0e0e', 0.06, 0.012, 0.24, 0, 0.98, 0, { r: 0.002 });
  for (const sx of [-1, 1]) k.cyl('metal', 0.05, 0.03, sx * 0.165, 0.9, 0, { ...STEEL, axis: 'x', seg: 18, bev: 0.004 });
  const handle = k.grp(0, 0.9, 0, { name: 'handle' });
  k.inside(handle, () => {
    k.cyl('metal', 0.025, 0.08, 0, 0, 0, { ...STEEL, axis: 'x', seg: 16, bev: 0.003 });
    k.cyl('metal', 0.016, 0.5, 0, 0.25, 0, { ...STEEL, seg: 12 });
    k.cyl('#b3221a:r', 0.032, 0.14, 0, 0.53, 0, { seg: 16, bev: 0.006 });
    for (let i = 0; i < 6; i++) k.tor('#8a1a14:r', 0.033, 0.002, 0, 0.475 + i * 0.022, 0, { axis: 'y', ts: 16, rs: 3 });
    k.sph('#c8231b:s', 0.045, 0, 0.62, 0, { ws: 18, hs: 12 });
  });
  handle.rotation.x = -0.6;
  // status CRT on an arm, tilted toward the operator
  k.box('metal', 0.06, 0.05, 0.05, 0.2, 0.92, 0.06, { ...STEEL, r: 0.008 });
  k.push(0.29, 1.0, 0.1, [-0.25, -0.35, 0]);
  k.box('paint', 0.2, 0.17, 0.14, 0, 0, -0.05, { ...BODY, r: 0.015 });
  k.ext('#0e0e0e:p', frameShape(0.18, 0.15, 0.015, 0.14, 0.105, 0.01), 0.01, 0, 0, 0.018, { bev: 0.003, bevSeg: 1, curveSeg: 3 });
  k.screen('main', 0.14, 0.105, 0, 0, 0.02, { style: 'amber', text: 'DISPATCH STATUS\nTARGET: LEVEL 0\nCREW: 4/4\nAWAITING LEVER_', bulge: 0.006, aspect: 4 / 3 });
  k.pop();
  // lamps (one glow draw) in chrome bezels
  for (const x of [-0.1, 0.1]) k.lathe('metal', [[0.0125, 0], [0.018, 0, 1], [0.0175, 0.004, 2], [0.0135, 0.0055, 2], [0.0125, 0.003]], x, 0.84, 0.15, { ...FIN.chrome, axis: 'z', seg: 16 });
  k.parts.lamps = k.glow('lamps', [[-0.1, 0x30ff60], [0.1, 0xff2a1a]].map(([x, col]) => ({ geo: lens(0.0125, 0.009).rotX(HP).translate(x, 0.84, 0.15), color: col, intensity: 2.2 })));
  k.parts.lamps[0].name = 'lamp_ready'; k.parts.lamps[1].name = 'lamp_armed';
  const lb = k.reg('dl_lb', 300, 70, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'DISPATCH', w / 2, h * 0.36, h * 0.38, { col: '#e8b417' }); txt(c, 'PULL TO SEND', w / 2, h * 0.76, h * 0.22, { col: '#d8d0bc', f: 'mono' }); rubOff(c, w, h, 0.4, 2); });
  k.label(lb, 0.2, 0.047, 0, 0.91, 0.1506);
  const rd = k.reg('dl_rd', 160, 30, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'READY', w * 0.25, h / 2, h * 0.5, { col: '#8f8', f: 'mono' }); txt(c, 'ARMED', w * 0.75, h / 2, h * 0.5, { col: '#f88', f: 'mono' }); });
  k.label(rd, 0.26, 0.03, 0, 0.8, 0.1506);
  const wl = k.reg('dl_wl', 200, 120, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); hazardTri(c, w * 0.2, h * 0.5, h * 0.55); ['ONE PULL', 'PER CREW', 'NO REFUNDS'].forEach((s, i) => txt(c, s, w * 0.62, h * (0.28 + i * 0.24), h * 0.16, { col: '#111', f: 'mono' })); grime(c, w, h, 0.6, 2, { corner: 0.15 }); });
  k.label(wl, 0.16, 0.096, 0, 0.55, 0.1106);
  P.cable(k, [[0.0, 0.3, -0.11], [0.0, 0.1, -0.2], [0.05, 0.015, -0.4], [0.3, 0.015, -0.9]], 0.02, { tint: 0x161616, radial: 9 });
  P.scuffs(k, 0, 0.3, 0.1104, 0.22, 0.3, { col: '20,18,16', alpha: 0.35 });
  k.collide(cbox(0.5, 0.04, 0.45, 0, 0.02, 0));
  k.collide(cbox(0.24, 0.72, 0.22, 0, 0.4, 0));
  k.collide(cbox(0.36, 0.22, 0.3, 0, 0.87, 0));
  k.parts.handle = handle;
  k.anchors.grip = V3(0, 0.9 + 0.53 * Math.cos(-0.6), 0.53 * Math.sin(-0.6));
  k.params.handleRange = [-0.6, 0.6];
  void A;
  return k.done({ mass: 180, material: 'metal' });
}

// ---------------------------------------------------------------------------
// FR-90 FIELD RADIO (prop, origin = centre): olive case with ribs and rubber guards, amber screen
// (screens.main), speaker, knobs / switches (static pivots), link LEDs (parts.leds, one glow draw),
// telescopic antenna (parts.antenna, scale.y), sample intake hatch (parts.intakeHatch), handset
// ---------------------------------------------------------------------------
export function b_radio(o) {
  void o;
  const k = new DKit('radio', { ground: 'none', wear: { chip: 0.3, rust: 0.15, grime: 0.5, dust: 0.3 } });
  const A = k.atlas(512, 1024);
  const W = 0.55, H = 0.42, D = 0.3, hh = 0.225;
  const OLIVE = { tint: 0x55603e }, DARK = { tint: 0x2c2f2a };
  const y0 = -hh + 0.015;
  k.box('paint', W, H, D, 0, y0 + H / 2, 0, { ...OLIVE, r: 0.025, div: 0.2, dent: 0.0012 });
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) k.box('paint', 0.012, H - 0.08, 0.02, sx * (W / 2 + 0.004), y0 + H / 2, -0.09 + i * 0.06, { ...OLIVE, r: 0.004 });
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) k.box('#151515:r', 0.06, 0.06, 0.06, sx * (W / 2 - 0.02), y0 + (sy ? H - 0.02 : 0.02), sz * (D / 2 - 0.02), { r: 0.012 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('#151515:r', 0.02, 0.015, sx * 0.2, -hh + 0.0075, sz * 0.1, { seg: 10 });
  // front panel
  const fz = D / 2;
  k.box('paint', W - 0.08, H - 0.07, 0.012, 0, y0 + H / 2, fz + 0.002, { ...DARK, r: 0.006 });
  P.cornerScrews(k, W - 0.08, H - 0.07, 0, y0 + H / 2, fz + 0.008, 0.01, { r: 0.003, kind: 'slot' });
  const pz = fz + 0.008;
  k.ext('#0e0e0e:p', frameShape(0.25, 0.195, 0.012, 0.205, 0.155, 0.008), 0.012, -0.1, y0 + 0.29, pz, { bev: 0.003, bevSeg: 1, curveSeg: 3 });
  k.screen('main', 0.2, 0.15, -0.1, y0 + 0.29, pz + 0.004, { style: 'amber', text: 'FR-90 LINK\nFREQ 104.7\nSIGNAL ▮▮▮▯▯\nSAMPLES 0/3', bulge: 0.006, aspect: 4 / 3 });
  const grill = k.reg('rd_grill', 160, 120, (c, w, h) => drawPerforation(c, w, h, 9, 3, '#2a2c28', '#050505'), 'p');
  k.box('#0e0e0e:p', 0.17, 0.13, 0.008, 0.15, y0 + 0.3, pz + 0.002, { r: 0.006 });
  k.label(grill, 0.16, 0.12, 0.15, y0 + 0.3, pz + 0.0066);
  const kl = k.reg('rd_kl', 300, 28, (c, w, h) => { c.clearRect(0, 0, w, h); ['VOL', 'FREQ', 'SQL'].forEach((s, i) => txt(c, s, (i + 0.5) * (w / 3), h / 2, h * 0.6, { col: '#d8d0b8', f: 'mono' })); });
  k.label(kl, 0.3, 0.028, -0.06, y0 + 0.155, pz + 0.0006);
  k.parts.knobs = [0, 1, 2].map((i) => P.knob(k, -0.16 + i * 0.1, y0 + 0.1, pz, 0.026, { name: 'knob_' + i, static: true, slot: '#141414:p', h: 0.025, angle: [0.6, -0.9, 1.7][i] }));
  for (const x of [0.13, 0.17, 0.21]) k.cyl('#0e0e0e:p', 0.009, 0.004, x, y0 + 0.145, pz + 0.002, { axis: 'z', seg: 12 });
  k.parts.leds = k.glow('leds', [[0.13, 0x30ff60], [0.17, 0xffa020], [0.21, 0xff2a1a]].map(([x, col]) => ({ geo: lens(0.006, 0.006).rotX(HP).translate(x, y0 + 0.145, pz + 0.004), color: col, intensity: 2.2 })));
  ['led_green', 'led_amber', 'led_red'].forEach((n, i) => { k.parts.leds[i].name = n; });
  k.parts.switches = [P.toggle(k, 0.14, y0 + 0.08, pz, { name: 'switch_power', on: true, static: true }), P.toggle(k, 0.2, y0 + 0.08, pz, { name: 'switch_band', static: true })];
  const brand = k.reg('rd_brand', 260, 40, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. FIELD COMMS FR-90', w / 2, h / 2, h * 0.5, { col: '#d8d0b8', f: 'stencil', maxW: w * 0.96 }); });
  k.label(brand, 0.18, 0.028, 0.15, y0 + 0.2, pz + 0.0006);
  // carry handle
  for (const sx of [-1, 1]) k.box('metal', 0.03, 0.03, 0.05, sx * 0.13, y0 + H + 0.012, 0, { ...STEEL, r: 0.006 });
  k.tube('metal', [[-0.13, y0 + H + 0.02, 0], [-0.13, y0 + H + 0.07, 0], [0.13, y0 + H + 0.07, 0], [0.13, y0 + H + 0.02, 0]], 0.009, { ...STEEL, round: 0.03, rseg: 5, radial: 10 });
  k.cyl('#151515:r', 0.016, 0.16, 0, y0 + H + 0.07, 0, { axis: 'x', seg: 14, bev: 0.004 });
  // telescopic antenna (scale.y: 1 = extended)
  const ax = -W / 2 + 0.05, az = -D / 2 + 0.05;
  k.cyl('#151515:r', 0.022, 0.03, ax, y0 + H + 0.015, az, { seg: 14, bev: 0.004 });
  const ant = k.grp(ax, y0 + H + 0.03, az, { name: 'antenna' });
  k.inside(ant, () => {
    for (const [r, y, l] of [[0.008, 0.0, 0.22], [0.0065, 0.2, 0.22], [0.005, 0.4, 0.22], [0.0035, 0.6, 0.2]]) k.cyl('#d0d4d8:c', r, l, 0, y + l / 2, 0, { seg: 8 });
    k.sph('#d0d4d8:c', 0.007, 0, 0.8, 0, { ws: 8, hs: 6 });
  });
  // sample intake hatch (top, right) + cable port (right side)
  const ix = 0.15, iz = 0.0, iy = y0 + H;
  k.cyl('metal', 0.05, 0.012, ix, iy + 0.006, iz, { ...STEEL, seg: 22, bev: 0.002 });
  k.cyl('#050505', 0.032, 0.014, ix, iy + 0.007, iz, { seg: 18 });
  const hatch = k.grp(ix, iy + 0.013, iz - 0.045, { name: 'intakeHatch' });
  hatch.rotation.x = -1.3;
  k.insideStatic(hatch, () => { k.cyl('paint', 0.045, 0.008, 0, 0.004, 0.045, { ...DARK, seg: 22, bev: 0.002 }); k.box('metal', 0.02, 0.008, 0.012, 0, 0.006, 0.09, { ...STEEL, r: 0.003 }); });
  const il = k.reg('rd_intake', 140, 30, (c, w, h) => { c.fillStyle = '#e8b417'; c.fillRect(0, 0, w, h); txt(c, 'SAMPLE INTAKE', w / 2, h / 2, h * 0.55, { col: '#111', f: 'mono' }); rubOff(c, w, h, 0.6, 3); });
  k.label(il, 0.11, 0.024, ix, iy + 0.0006, iz + 0.075, { rot: [-HP, 0, 0] });
  k.cyl('metal', 0.022, 0.025, W / 2 + 0.012, y0 + 0.12, 0.06, { ...STEEL, axis: 'x', seg: 16 });
  k.cyl('#c8a254:m', 0.012, 0.03, W / 2 + 0.02, y0 + 0.12, 0.06, { axis: 'x', seg: 12 });
  const st = k.reg('rd_stencil', 300, 90, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'PROPERTY OF', w / 2, h * 0.3, h * 0.24, { col: 'rgba(225,215,190,0.85)', f: 'stencil' }); txt(c, 'R.O.O.M.', w / 2, h * 0.72, h * 0.42, { col: 'rgba(225,215,190,0.85)', f: 'stencil' }); rubOff(c, w, h, 1.5, 5); }, 'p');
  k.label(st, 0.2, 0.06, -W / 2 - 0.0106, y0 + 0.26, 0.02, { rot: [0, -HP, 0] });
  // handset clipped on the left side with a coiled cord
  k.box('#151515:r', 0.04, 0.16, 0.05, -W / 2 - 0.025, y0 + 0.2, -0.06, { r: 0.015 });
  const coil = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * TAU * 9; coil.push(V3(-W / 2 - 0.03 + Math.cos(a) * 0.01, y0 + 0.11 - t * 0.05 + Math.sin(a) * 0.01, -0.06 + t * 0.12)); }
  k.tube('#151515:r', coil, 0.003, { radial: 4 });
  k.collide(cbox(W, H + 0.03, D, 0, 0, 0));
  k.anchors.intake = V3(ix, iy + 0.015, iz);
  k.anchors.cable = V3(W / 2 + 0.035, y0 + 0.12, 0.06);
  k.anchors.handle = V3(0, y0 + H + 0.07, 0);
  k.parts.antenna = ant;
  k.parts.intakeHatch = hatch;
  void A;
  return k.done({ mass: 22, material: 'metal', halfHeight: hh });
}

// ---------------------------------------------------------------------------
// SUPPLY CRATE (prop, origin = centre): ribbed olive case with steel corners, foam insert, side handles,
// over-centre latches, stencils; lid hinged at the back top edge (parts.lid, negative rotation.x opens)
// ---------------------------------------------------------------------------
export function b_supply_crate(o) {
  void o;
  const k = new DKit('supply_crate', { ground: 'none', wear: { chip: 0.3, rust: 0.2, grime: 0.5, dust: 0.35 } });
  const A = k.atlas(512, 1024);
  const W = 0.9, H = 0.6, D = 0.6, hh = H / 2, lidH = 0.14;
  const GRN = { tint: 0x4b5a3c };
  const by = -hh, ty = hh - lidH;
  k.box('paint', W, 0.03, D, 0, by + 0.015, 0, { ...GRN, r: 0.01 });
  for (const sx of [-1, 1]) k.box('paint', 0.025, ty - by, D, sx * (W / 2 - 0.0125), (by + ty) / 2, 0, { ...GRN, r: 0.006 });
  for (const sz of [-1, 1]) k.box('paint', W, ty - by, 0.025, 0, (by + ty) / 2, sz * (D / 2 - 0.0125), { ...GRN, r: 0.006, div: 0.2, dent: 0.0012 });
  k.box('#262626:r', W - 0.05, 0.12, D - 0.05, 0, by + 0.09, 0, { r: 0.004 });
  for (const [x, z, w, d] of [[-0.2, -0.05, 0.3, 0.35], [0.22, 0.08, 0.25, 0.18]]) k.box('#0b0b0b', w, 0.004, d, x, by + 0.152, z, { r: 0 });
  for (const y of [by + 0.12, ty - 0.08]) k.box('paint', W + 0.012, 0.03, D + 0.012, 0, y, 0, { ...GRN, r: 0.008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('metal', 0.05, H - 0.02, 0.05, sx * (W / 2 - 0.02), 0, sz * (D / 2 - 0.02), { ...STEEL, r: 0.012 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.box('metal', 0.02, 0.04, 0.03, sx * (W / 2 + 0.01), ty - 0.06, sz * 0.12, { ...STEEL, r: 0.004 });
    k.tube('metal', [[sx * (W / 2 + 0.015), ty - 0.06, -0.12], [sx * (W / 2 + 0.045), ty - 0.09, -0.1], [sx * (W / 2 + 0.045), ty - 0.09, 0.1], [sx * (W / 2 + 0.015), ty - 0.06, 0.12]], 0.008, { ...STEEL, round: 0.02, rseg: 4, radial: 8 });
  }
  const front = k.reg('sc_front', 420, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    txt(c, 'R.O.O.M. SUPPLY', w / 2, h * 0.32, h * 0.3, { col: 'rgba(232,222,196,0.92)', f: 'stencil', maxW: w * 0.95 });
    txt(c, 'NSN 8465-01-ROOM-0042', w / 2, h * 0.62, h * 0.11, { col: 'rgba(232,222,196,0.85)', f: 'mono' });
    txt(c, 'QTY 1  •  DIMENSIONAL DROP  •  32 KG', w / 2, h * 0.8, h * 0.09, { col: 'rgba(232,222,196,0.85)', f: 'mono', maxW: w * 0.95 });
    rubOff(c, w, h, 1.3, 7);
  }, 'p');
  k.label(front, 0.62, 0.236, 0, (by + ty) / 2 + 0.02, D / 2 + 0.0006);
  k.label(front, 0.62, 0.236, 0, (by + ty) / 2 + 0.02, -D / 2 - 0.0006, { rot: [0, PI, 0] });
  const arrows = k.reg('sc_arrows', 200, 120, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = 'rgba(232,222,196,0.9)'; for (const x of [0.3, 0.7]) { c.beginPath(); c.moveTo(w * x, h * 0.1); c.lineTo(w * (x + 0.12), h * 0.4); c.lineTo(w * (x + 0.05), h * 0.4); c.lineTo(w * (x + 0.05), h * 0.75); c.lineTo(w * (x - 0.05), h * 0.75); c.lineTo(w * (x - 0.05), h * 0.4); c.lineTo(w * (x - 0.12), h * 0.4); c.closePath(); c.fill(); } txt(c, 'THIS SIDE UP', w / 2, h * 0.9, h * 0.14, { col: 'rgba(232,222,196,0.9)', f: 'stencil' }); }, 'p');
  for (const sx of [-1, 1]) k.label(arrows, 0.25, 0.15, sx * (W / 2 + 0.0006), (by + ty) / 2, 0, { rot: [0, sx * HP, 0] });
  for (const sx of [-1, 1]) {
    k.box('metal', 0.07, 0.05, 0.015, sx * 0.25, ty - 0.03, D / 2 + 0.008, { ...STEEL, r: 0.004 });
    k.box('metal', 0.05, 0.07, 0.012, sx * 0.25, ty + 0.0, D / 2 + 0.02, { ...STEEL, r: 0.004, rot: [0.15, 0, 0] });
    k.cyl('metal', 0.006, 0.06, sx * 0.25, ty - 0.02, D / 2 + 0.018, { ...STEEL, axis: 'x', seg: 8 });
  }
  // lid (pivot on the back top edge)
  const lid = k.grp(0, ty, -D / 2, { name: 'lid' });
  k.inside(lid, () => {
    k.box('paint', W + 0.01, lidH, D + 0.01, 0, lidH / 2, D / 2, { ...GRN, r: 0.015 });
    k.push(0, 0.05, D + 0.0057);
    P.hazardRect(k, W - 0.02, 0.04, 0, 0, 0, { sw: 0.035, t: 0.002 });
    k.pop();
    for (let i = 0; i < 3; i++) k.box('paint', W - 0.1, 0.012, 0.05, 0, lidH + 0.006, 0.1 + i * 0.2, { ...GRN, r: 0.004 });
    const top = k.reg('sc_top', 400, 220, (c, w, h) => { c.clearRect(0, 0, w, h); drawLogo(c, w / 2, h * 0.3, h * 0.26, 'rgba(232,222,196,0.9)', { f: 'stencil' }); txt(c, 'SUPPLY DROP', w / 2, h * 0.7, h * 0.18, { col: 'rgba(232,222,196,0.9)', f: 'stencil' }); rubOff(c, w, h, 1.2, 4); }, 'p');
    k.label(top, 0.5, 0.275, 0, lidH + 0.0126, D / 2 + 0.2, { rot: [-HP, 0, 0] });
    k.box('#262626:r', W - 0.06, 0.01, D - 0.06, 0, 0.004, D / 2, { r: 0 });
    for (const sx of [-1, 1]) k.cyl('#9aa0a4:m', 0.012, 0.08, sx * 0.3, 0.0, 0.0, { axis: 'x', seg: 10 });
  });
  k.collide(cbox(W, H, D, 0, 0, 0));
  k.parts.lid = lid;
  k.anchors.inside = V3(0, by + 0.17, 0);
  k.params.lidOpenSign = -1;
  void A;
  return k.done({ mass: 32, material: 'metal', halfHeight: hh });
}

// ---------------------------------------------------------------------------
// STARTER BOX (prop, origin = centre): corrugated kraft carton with prints and tape; four flaps on
// static mounts (parts.flaps are bones: rotation.x > 0 opens; one skinned draw for all flaps)
// ---------------------------------------------------------------------------
export function b_starter_box(o) {
  void o;
  const k = new DKit('starter_box', { ground: 'none', wear: { chip: 0, rust: 0, grime: 0.4, dust: 0.3 } });
  const A = k.atlas(1024, 1024);
  const W = 0.6, H = 0.35, D = 0.45, hh = H / 2, t = 0.006;
  const kraft = (key, base) => k.reg(key, 128, 128, (c, w, h, rng) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { c.fillStyle = rng.next() < 0.5 ? 'rgba(255,240,210,0.12)' : 'rgba(80,50,20,0.12)'; c.fillRect(rng.next() * w, rng.next() * h, 1 + rng.next() * 3, 1); }
    c.fillStyle = 'rgba(80,50,20,0.06)'; for (let x = 0; x < w; x += 6) c.fillRect(x, 0, 2, h);
  }, 'r');
  const kr = kraft('sb_kraft', '#cfb48a'), kin = kraft('sb_kraft_in', '#a88e68');
  const box = (w, h, d, x, y, z) => k.labelBox({ pz: kr, nz: kin, px: kr, nx: kin, py: kr, ny: kin }, w, h, d, x, y, z);
  box(W, t, D, 0, -hh + t / 2, 0);
  for (const sx of [-1, 1]) k.labelBox({ all: sx > 0 ? kr : kr, nx: sx > 0 ? kin : kr, px: sx > 0 ? kr : kin }, t, H, D, sx * (W / 2 - t / 2), 0, 0);
  for (const sz of [-1, 1]) k.labelBox({ all: kr, nz: sz > 0 ? kin : kr, pz: sz > 0 ? kr : kin }, W, H, t, 0, 0, sz * (D / 2 - t / 2));
  const front = k.reg('sb_front', 600, 340, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(30,40,90,0.9)'; c.lineWidth = 5; c.strokeRect(14, 14, w - 28, h - 28);
    drawClone(c, w * 0.18, h * 0.52, h * 0.5, { wave: true, ink: '#1e285a', col: 'rgba(242,196,24,0.9)' });
    txt(c, 'EMPLOYEE', w * 0.62, h * 0.22, h * 0.13, { col: '#1e285a', maxW: w * 0.6 });
    txt(c, 'STARTER KIT', w * 0.62, h * 0.37, h * 0.13, { col: '#1e285a', maxW: w * 0.6 });
    txt(c, 'WELCOME TO YOUR', w * 0.62, h * 0.55, h * 0.075, { col: '#a0281c', maxW: w * 0.6 });
    txt(c, 'FIRST DAY!', w * 0.62, h * 0.66, h * 0.1, { col: '#a0281c', maxW: w * 0.6 });
    txt(c, 'Contents: 1x Optimism (Unverified)', w * 0.62, h * 0.8, h * 0.045, { col: '#1e285a', f: 'mono', maxW: w * 0.62 });
    drawLogo(c, w * 0.72, h * 0.9, h * 0.05, '#1e285a');
    rubOff(c, w, h, 0.8, 6);
  }, 'r');
  k.decal(front, W - 0.04, (W - 0.04) * 340 / 600, 0, 0.0, D / 2 + 0.0006);
  k.decal(front, W - 0.04, (W - 0.04) * 340 / 600, 0, 0.0, -D / 2 - 0.0006, { rot: [0, PI, 0] });
  const side = k.reg('sb_side', 300, 230, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(30,40,90,0.9)';
    for (const x of [0.32, 0.68]) { c.beginPath(); c.moveTo(w * x, h * 0.08); c.lineTo(w * (x + 0.1), h * 0.3); c.lineTo(w * (x + 0.04), h * 0.3); c.lineTo(w * (x + 0.04), h * 0.5); c.lineTo(w * (x - 0.04), h * 0.5); c.lineTo(w * (x - 0.04), h * 0.3); c.lineTo(w * (x - 0.1), h * 0.3); c.closePath(); c.fill(); }
    txt(c, 'THIS SIDE UP', w / 2, h * 0.6, h * 0.1, { col: '#1e285a' });
    c.strokeStyle = '#a0281c'; c.lineWidth = 3; c.strokeRect(w * 0.12, h * 0.7, w * 0.76, h * 0.22);
    txt(c, 'FRAGILE: CONTAINS HOPE', w / 2, h * 0.81, h * 0.07, { col: '#a0281c', maxW: w * 0.72 });
  }, 'r');
  for (const sx of [-1, 1]) k.decal(side, D - 0.06, (D - 0.06) * 230 / 300, sx * (W / 2 + 0.0006), -0.01, 0, { rot: [0, sx * HP, 0] });
  const tape = k.reg('sb_tape', 64, 64, (c, w, h) => { c.fillStyle = 'rgba(200,170,110,0.8)'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(0, h * 0.2, w, h * 0.1); }, 'g');
  k.label(tape, 0.06, 0.1, 0, hh - 0.05, D / 2 + 0.0009);
  k.label(tape, 0.06, 0.1, 0, hh - 0.05, -D / 2 - 0.0009, { rot: [0, PI, 0] });
  // flaps: static mount (faces outward) -> bone hinge (rotation.x opens)
  const defs = [['flapFront', 0, 0, D / 2 - t / 2, D / 2 - 0.004, W - 0.004, t], ['flapBack', PI, 0, -D / 2 + t / 2, D / 2 - 0.004, W - 0.004, t], ['flapLeft', -HP, -W / 2 + t / 2, 0, D / 2 - 0.02, D - 0.02, 0], ['flapRight', HP, W / 2 - t / 2, 0, D / 2 - 0.02, D - 0.02, 0]];
  const mounts = defs.map(([name, ry, px, pz, , , lift]) => k.grp(px, hh - t / 2 + lift, pz, { name: name + 'Mount', rot: [0, ry, 0] }));
  k.parts.flaps = k.bones('flaps', defs.map((d, i) => [0, 0, 0, null, d[0], mounts[i]]), (i) => {
    const [name, , , , len, wid] = defs[i];
    k.labelBox({ py: kr, ny: kin, all: kr }, wid, t, len, 0, 0, -len / 2);
    if (name === 'flapFront' || name === 'flapBack') k.label(tape, 0.06, len - 0.005, 0, t / 2 + 0.0007, -len / 2, { rot: [-HP, 0, 0] });
  });
  k.collide(cbox(W, H, D, 0, 0, 0));
  k.anchors.inside = V3(0, -hh + 0.05, 0);
  void A;
  return k.done({ mass: 3, material: 'cardboard', halfHeight: hh });
}
