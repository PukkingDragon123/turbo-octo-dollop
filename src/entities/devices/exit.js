// Extraction: exit door (steel fire door glowing from behind) and the decontamination room shell.
// Origin on the floor; the door's wall plane is z = 0 (front +Z), the room extends toward -Z.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, frameShape, rrShape, rrHole, Geo, boxGeo, latheGeo, quadGeo, lerp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, canvasTex } from './atlas.js';
import { emissiveMat } from './mats.js';

const STEEL = { ...FIN.steel, rust: 0.2 };
let _spill = null;
function spillTexture() {
  if (_spill) return _spill;
  _spill = canvasTex(128, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const s = c.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.15, 'rgba(0,0,0,0)'); s.addColorStop(0.85, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = s; c.fillRect(0, 0, w, h);
  });
  return _spill;
}

// ---------------------------------------------------------------------------
// EXIT DOOR: pressed-steel frame, door leaf on 3 hinges (parts.door, + rotation.y opens inward) with a
// wired-glass window lit from behind, light leaking round the leaf (parts.glow own emissive), floor
// spill (parts.glowFloor additive), EXIT sign (screens.sign) + countdown (screens.countdown)
// ---------------------------------------------------------------------------
export function b_exit_door(o) {
  const k = new DKit('exit_door', { ground: 'wall', wear: { chip: 0.3, rust: 0.25, grime: 0.55, dust: 0.4 }, ao: { res: 56 } });
  const A = k.atlas(512, 1024);
  const OW = 0.95, OH = 2.1, fw = 0.06, z0 = -0.12, z1 = 0.04;
  const FR = { tint: 0x3f4a44 }, LEAF = { tint: 0x55665c };
  const glowCol = o.glowColor ?? 0xfff0c8;
  // frame: jambs + head with a rolled return, door stops, threshold
  for (const sx of [-1, 1]) k.box('paint', fw, OH + fw, z1 - z0, sx * (OW / 2 + fw / 2), (OH + fw) / 2, (z0 + z1) / 2, { ...FR, r: 0.006 });
  k.box('paint', OW + 2 * fw, fw, z1 - z0, 0, OH + fw / 2, (z0 + z1) / 2, { ...FR, r: 0.006 });
  for (const sx of [-1, 1]) k.box('paint', 0.012, OH, 0.03, sx * (OW / 2 - 0.006), OH / 2, -0.065, { ...FR, r: 0.002 });
  k.box('paint', OW, 0.012, 0.03, 0, OH - 0.006, -0.065, { ...FR, r: 0.002 });
  k.box('metal', OW + 0.1, 0.014, 0.2, 0, 0.007, -0.04, { ...FIN.zinc, r: 0.003 });
  const diamond = k.reg('ed_tread', 64, 64, (c, w, h) => { c.fillStyle = '#8a8e90'; c.fillRect(0, 0, w, h); c.fillStyle = '#b8bcbe'; for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { c.save(); c.translate(x + 4, y + 4); c.rotate(0.7); c.fillRect(-5, -1.5, 10, 3); c.restore(); } }, 'm');
  k.label(diamond, OW + 0.08, 0.18, 0, 0.0142, -0.04, { rot: [-HP, 0, 0] });
  // light leaking through the gaps (own emissive material; the game animates its intensity)
  const gm = emissiveMat(0x000000, glowCol, 2.4, { name: 'exit_glow', rough: 1 });
  const gg = new Geo();
  gg.append(quadGeo(0.018, OH).translate(-OW / 2 + 0.009, OH / 2, -0.05));
  gg.append(quadGeo(0.018, OH).translate(OW / 2 - 0.009, OH / 2, -0.05));
  gg.append(quadGeo(OW, 0.018).translate(0, OH - 0.009, -0.05));
  gg.append(quadGeo(OW, 0.016).translate(0, 0.022, -0.05));
  gg.append(quadGeo(OW, 0.03).rotX(-HP).translate(0, 0.0145, -0.035));
  const glow = k.mesh(gm, gg, 0, 0, 0, { name: 'glow', shadow: false, ao: false });
  const sm = new THREE.MeshBasicMaterial({ map: spillTexture(), color: glowCol, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  sm.userData.unique = true; sm.userData.noShadow = true; sm.name = 'exit_spill';
  const sg = new THREE.PlaneGeometry(OW + 0.3, 0.7).rotateX(-HP).translate(0, 0.003, 0.33);
  const spill = k.mesh(sm, sg, 0, 0, 0, { name: 'glowFloor', shadow: false });
  spill.renderOrder = 5;
  // door leaf
  const LW = OW - 0.024, LH = OH - 0.042, LT = 0.045;
  const door = k.grp(-OW / 2 + 0.008, 0.03, -0.025, { name: 'door' });
  const win = k.grp(0, 0, 0, { name: 'window' });
  k.inside(door, () => {
    const cx = LW / 2;
    const s = rrShape(LW, LH, 0.004, cx, LH / 2);
    s.holes.push(rrHole(0.26, 0.36, 0.01, cx, 1.55));
    k.ext('paint', s, LT, 0, 0, -LT / 2, { ...LEAF, bev: 0.003, bevSeg: 1, curveSeg: 2 });
    // pressed panels
    k.box('paint', LW - 0.12, 0.5, 0.004, cx, 0.65, LT / 2 + 0.002, { ...LEAF, r: 0.003 });
    k.ext('metal', frameShape(0.3, 0.4, 0.012, 0.26, 0.36, 0.01), 0.012, cx, 1.55, LT / 2 - 0.002, { ...STEEL, bev: 0.002, bevSeg: 1, curveSeg: 2 });
    for (const [x, y] of [[-0.13, -0.18], [0.13, -0.18], [-0.13, 0.18], [0.13, 0.18]]) P.screw(k, cx + x, 1.55 + y, LT / 2 + 0.01, { r: 0.003, kind: 'slot' });
    // wired glass lit from behind (emissive print)
    const wt = k.reg('ed_wire', 130, 180, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.7);
      g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#d8c89a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(60,60,60,0.55)'; c.lineWidth = 1.5;
      for (let i = -h; i < w + h; i += 14) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); }
    }, { e: 1, r: 0.12, m: 0 });
    k.label(wt, 0.26, 0.36, cx, 1.55, 0);
    k.label(wt, 0.26, 0.36, cx, 1.55, -0.0005, { rot: [0, PI, 0] });
    // lever handle + lock, kick plate, push plate
    const hx = LW - 0.07;
    k.box('metal', 0.05, 0.16, 0.012, hx, 1.0, LT / 2 + 0.006, { ...STEEL, r: 0.004 });
    k.cyl('metal', 0.012, 0.03, hx, 1.03, LT / 2 + 0.025, { ...STEEL, axis: 'z', seg: 12 });
    k.box('metal', 0.13, 0.022, 0.022, hx - 0.06, 1.03, LT / 2 + 0.042, { ...FIN.satin, r: 0.009 });
    k.cyl('#c8a254:m', 0.011, 0.012, hx, 0.95, LT / 2 + 0.014, { axis: 'z', seg: 14 });
    k.box('#020202', 0.002, 0.008, 0.001, hx, 0.95, LT / 2 + 0.0205, { r: 0 });
    k.box('metal', LW - 0.04, 0.25, 0.003, cx, 0.15, LT / 2 + 0.0015, { ...FIN.satin, r: 0.001 });
    for (const x of [-0.4, -0.1, 0.2, 0.42]) P.screw(k, cx + x, 0.26, LT / 2 + 0.003, { r: 0.0025, kind: 'phillips' });
    k.box('metal', 0.1, 0.3, 0.003, hx, 1.25, LT / 2 + 0.0015, { ...FIN.satin, r: 0.001 });
    const pl = k.reg('ed_plate', 240, 100, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a1a14'; c.lineWidth = 4; c.strokeRect(5, 5, w - 10, h - 10); txt(c, 'EMPLOYEES MUST', w / 2, h * 0.3, h * 0.16, { col: '#111' }); txt(c, 'EXIT WITH ALL LIMBS', w / 2, h * 0.52, h * 0.16, { col: '#111', maxW: w * 0.9 }); txt(c, '— MANAGEMENT', w * 0.62, h * 0.76, h * 0.12, { col: '#7a1a14', f: 'mono' }); grime(c, w, h, 0.6, 31, { corner: 0.12 }); });
    k.label(pl, 0.24, 0.1, cx, 1.2, LT / 2 + 0.0026);
    // back side: panic bar
    k.box('metal', LW - 0.2, 0.06, 0.05, cx, 1.0, -LT / 2 - 0.03, { ...FIN.satin, r: 0.012 });
    for (const x of [0.12, LW - 0.12]) k.box('metal', 0.05, 0.08, 0.03, x, 1.0, -LT / 2 - 0.015, { ...STEEL, r: 0.006 });
    for (const y of [0.25, 1.05, 1.85]) P.hingeHalf(k, 0, y, 0.0, 0.1, { part: 1, r: 0.009, knuckles: 3, leaf: 1, leafW: 0.03, leafZ: LT / 2 - 0.002 });
  });
  for (const y of [0.25, 1.05, 1.85]) P.hingeHalf(k, -OW / 2 + 0.008, y + 0.03, -0.025, 0.1, { part: 0, r: 0.009, knuckles: 3 });
  // EXIT sign above (screens.sign)
  k.box('paint', 0.4, 0.18, 0.08, 0, OH + 0.3, 0.04, { tint: 0xc9c6bc, r: 0.012, chip: 0.05 });
  k.screen('sign', 0.36, 0.14, 0, OH + 0.3, 0.0806, { style: 'sign', text: 'EXIT', bulge: 0, glow: 1.7 });
  k.box('metal', 0.04, 0.12, 0.04, 0, OH + 0.15, 0.02, { ...STEEL, r: 0.004 });
  // countdown display
  k.box('#161616:p', 0.26, 0.13, 0.05, OW / 2 + 0.3, 1.5, 0.025, { r: 0.01 });
  k.box('metal', 0.27, 0.14, 0.01, OW / 2 + 0.3, 1.5, 0.005, { ...STEEL, r: 0.006 });
  k.screen('countdown', 0.22, 0.088, OW / 2 + 0.3, 1.5, 0.0506, { style: 'led', text: '05:00', bulge: 0 });
  const cl = k.reg('ed_cl', 200, 30, (c, w, h) => { c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); txt(c, 'EXTRACTION WINDOW', w / 2, h / 2, h * 0.55, { col: '#e8b417', f: 'mono' }); });
  k.label(cl, 0.22, 0.033, OW / 2 + 0.3, 1.6, 0.0506);
  P.cable(k, [[OW / 2 + 0.3, 1.43, 0.0], [OW / 2 + 0.3, 1.3, 0.008], [OW / 2 + 0.32, 0.3, 0.008], [OW / 2 + 0.34, 0.01, 0.01]], 0.006, { tint: 0x161616 });
  for (const sx of [-1, 1]) k.collide(cbox(fw, OH + fw, z1 - z0, sx * (OW / 2 + fw / 2), (OH + fw) / 2, (z0 + z1) / 2));
  k.collide(cbox(OW + 2 * fw, fw, z1 - z0, 0, OH + fw / 2, (z0 + z1) / 2));
  k.parts.door = door;
  k.parts.glow = glow;
  k.parts.glowFloor = spill;
  k.parts.window = win;
  k.params.doorOpenSign = 1;
  k.params.doorCollider = cbox(LW, LH, LT, LW / 2, LH / 2, 0);
  k.params.opening = [OW, OH];
  k.anchors.threshold = V3(0, 0, 0.3);
  k.anchors.through = V3(0, 0, -0.8);
  void A;
  return k.done({ mass: 2000, material: 'metal' });
}

// ---------------------------------------------------------------------------
// DECONTAMINATION ROOM SHELL: tiled 3 x 3 m room (open +Z side, optional inner front wall with the door
// cut-out), drain, bench, decon nozzles, ceiling light (parts.ceilingLight), caged red emergency lights
// (parts.lights: one glow draw, the game clones / flashes their materials), sealed hatch, signage
// ---------------------------------------------------------------------------
export function b_exit_room_shell(o) {
  const k = new DKit('exit_room_shell', { ground: 'none', wear: { chip: 0.15, rust: 0.2, grime: 0.55, dust: 0.3 }, ao: { res: 72 } });
  const A = k.atlas(1024, 1024);
  const W = 3, Dp = 3, H = 2.6, T = 0.1;
  const TILE = { tint: 0xd8ddd8 }, FLOOR = { tint: 0xb8bcb8 }, CEIL = { tint: 0xd0d0cc };
  k.box('tile', W + 2 * T, T, Dp, 0, -T / 2 + 0.002, -Dp / 2, { ...FLOOR, r: 0 });
  k.box('paint', W + 2 * T, T, Dp, 0, H + T / 2, -Dp / 2, { ...CEIL, r: 0 });
  k.box('tile', W + 2 * T, H, T, 0, H / 2, -Dp - T / 2, { ...TILE, r: 0 });
  for (const sx of [-1, 1]) k.box('tile', T, H, Dp, sx * (W / 2 + T / 2), H / 2, -Dp / 2, { ...TILE, r: 0 });
  // stainless coving skirting + hazard border
  for (const sx of [-1, 1]) k.box('metal', 0.01, 0.1, Dp, sx * (W / 2 - 0.005), 0.05, -Dp / 2, { ...FIN.satin, r: 0.002 });
  k.box('metal', W, 0.1, 0.01, 0, 0.05, -Dp + 0.005, { ...FIN.satin, r: 0.002 });
  for (const sx of [-1, 1]) { k.push(sx * (W / 2 - 0.12), 0.003, -Dp / 2 - 0.1, [-HP, 0, 0]); P.hazardRect(k, 0.1, Dp - 0.2, 0, 0, 0, { sw: 0.06, t: 0.001 }); k.pop(); }
  k.push(0, 0.003, -Dp + 0.12, [-HP, 0, 0]); P.hazardRect(k, W - 0.14, 0.1, 0, 0, 0, { sw: 0.06, t: 0.001 }); k.pop();
  // floor drain + stains
  k.cyl('metal', 0.15, 0.006, 0, 0.003, -Dp / 2, { ...STEEL, seg: 28, bev: 0.002 });
  for (let i = 0; i < 7; i++) k.box('#0a0a0a', 0.2, 0.002, 0.012, 0, 0.0065, -Dp / 2 - 0.09 + i * 0.03, { r: 0 });
  P.stain(k, 0.1, 0.0035, -Dp / 2 + 0.05, 0.7, 0.6, { col: '60,50,30', alpha: 0.35, rot: [-HP, 0, 0] });
  // bench (left wall)
  const bx = -W / 2 + 0.22;
  k.box('metal', 0.4, 0.04, 1.6, bx, 0.46, -Dp / 2, { ...FIN.satin, r: 0.008 });
  for (const z of [-Dp / 2 - 0.65, -Dp / 2 + 0.65]) {
    k.box('metal', 0.05, 0.44, 0.05, bx + 0.12, 0.22, z, { ...STEEL, r: 0.004 });
    k.box('metal', 0.3, 0.04, 0.05, bx, 0.06, z, { ...STEEL, r: 0.004 });
  }
  k.box('metal', 0.02, 0.4, 1.6, -W / 2 + 0.01, 0.75, -Dp / 2, { ...FIN.satin, r: 0.003 });
  // decon nozzles + ceiling light frame
  for (const [x, z] of [[-0.7, -0.8], [0.7, -0.8], [-0.7, -2.2], [0.7, -2.2]]) {
    k.cyl('metal', 0.03, 0.04, x, H - 0.02, z, { ...FIN.chrome, seg: 14, bev: 0.003 });
    k.cyl('metal', 0.012, 0.03, x, H - 0.055, z, { ...FIN.chrome, seg: 10, r2: 0.02 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.box('#111', 0.002, 0.001, 0.002, x + Math.cos(a) * 0.012, H - 0.0705, z + Math.sin(a) * 0.012, { r: 0 }); }
  }
  k.box('metal', 0.66, 0.03, 1.26, 0, H - 0.015, -Dp / 2, { ...FIN.satin, r: 0.006 });
  const lm = emissiveMat(0xeef4ff, 0xe8f0ff, 1.2, { name: 'decon_light' });
  const panel = k.mesh(lm, boxGeo(0.6, 0.012, 1.2, { r: 0.002 }), 0, H - 0.032, -Dp / 2, { name: 'ceilingLight', shadow: false, ao: false });
  // caged red emergency lights (one glow draw)
  const lights = [];
  for (const [x, z, ry] of [[-W / 2, -0.7, HP], [-W / 2, -2.3, HP], [W / 2, -0.7, -HP], [W / 2, -2.3, -HP], [0, -Dp, 0]]) {
    k.push(x, H - 0.25, z, [0, ry, 0]);
    k.box('metal', 0.14, 0.14, 0.03, 0, 0, 0.015, { ...STEEL, r: 0.006 });
    for (let i = 0; i < 4; i++) k.tor('metal', 0.062, 0.003, 0, 0, 0.03, { ...STEEL, arc: PI, ts: 10, rs: 3, rot: [HP, (i / 4) * PI, 0] });
    k.pop();
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, H - 0.25, z);
    lights.push({ geo: new Geo().append(latheGeo([[0.0001, 0], [0.055, 0, 1], [0.052, 0.018], [0.04, 0.04], [0.02, 0.052], [0.0001, 0.055]], 14, { rings: false })).rotX(HP).translate(0, 0, 0.03).applyMatrix(m), color: 0xff2010, intensity: 2.4 });
  }
  k.parts.lights = k.glow('lights', lights, { ref: 2.4 });
  k.parts.lights.forEach((l) => { l.name = 'emergencyLight'; });
  // sealed hatch on the back wall (the way out)
  const hz = -Dp + 0.005;
  k.tor('metal', 0.55, 0.06, 0, 1.1, hz + 0.04, { ...STEEL, rs: 10, ts: 48 });
  k.cyl('paint', 0.52, 0.06, 0, 1.1, hz + 0.05, { tint: 0x6a7076, axis: 'z', seg: 48, bev: 0.008 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; P.screw(k, Math.cos(a) * 0.55, 1.1 + Math.sin(a) * 0.55, hz + 0.1, { kind: 'hex', r: 0.016 }); }
  k.tor('paint', 0.18, 0.018, 0, 1.1, hz + 0.14, { tint: 0xb3221a, rs: 8, ts: 28 });
  for (let i = 0; i < 3; i++) k.box('paint', 0.36, 0.024, 0.024, 0, 1.1, hz + 0.14, { tint: 0xb3221a, r: 0.006, rot: [0, 0, (i / 3) * PI] });
  k.cyl('metal', 0.04, 0.08, 0, 1.1, hz + 0.1, { ...STEEL, axis: 'z', seg: 14, bev: 0.004 });
  // signage
  const sign = k.reg('er_sign', 860, 150, (c, w, h) => {
    c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b3221a'; c.fillRect(0, 0, w, h * 0.3);
    txt(c, 'DECONTAMINATION', w / 2, h * 0.16, h * 0.22, { col: '#fff' });
    txt(c, 'PLEASE REMAIN CALM. SCANNING FOR DIMENSIONAL RESIDUE.', w / 2, h * 0.52, h * 0.13, { col: '#111', maxW: w * 0.94 });
    txt(c, 'Do not touch the walls. The walls are touching you back.', w / 2, h * 0.78, h * 0.1, { col: '#555', f: 'mono', maxW: w * 0.94 });
    grime(c, w, h, 0.5, 4);
  });
  k.label(sign, 1.6, 0.279, 0, 2.05, -Dp + 0.0026);
  const rules = k.reg('er_rules', 250, 300, (c, w, h) => {
    c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, w, h);
    txt(c, 'EXTRACTION', w / 2, 26, 24, { col: '#111' });
    ['1. SIT ON BENCH', '2. CLOSE EYES', '3. DO NOT COUNT', '   THE OTHERS', '4. AWAIT HATCH', '5. FILL OUT FORM', '   EX-7B (BLUE)'].forEach((s, i) => txt(c, s, 16, 66 + i * 32, 18, { col: '#222', f: 'mono', al: 'left' }));
    grime(c, w, h, 0.5, 8, { corner: 0.12 });
  });
  k.label(rules, 0.4, 0.48, W / 2 - 0.0026, 1.45, -1.5, { rot: [0, -HP, 0] });
  P.streak(k, -0.6, H - 0.3, -Dp + 0.0024, 0.3, 1.2, { col: '70,60,40', alpha: 0.3 });
  if (o.frontWall) {
    const ow = 1.07, oh = 2.16;
    for (const sx of [-1, 1]) k.box('tile', (W - ow) / 2, H, T, sx * (ow / 2 + (W - ow) / 4), H / 2, -0.13 - T / 2, { ...TILE, r: 0 });
    k.box('tile', ow, H - oh, T, 0, oh + (H - oh) / 2, -0.13 - T / 2, { ...TILE, r: 0 });
  }
  k.collide(cbox(W + 2 * T, T, Dp, 0, -T / 2, -Dp / 2));
  k.collide(cbox(W + 2 * T, T, Dp, 0, H + T / 2, -Dp / 2));
  k.collide(cbox(W + 2 * T, H, T, 0, H / 2, -Dp - T / 2));
  for (const sx of [-1, 1]) k.collide(cbox(T, H, Dp, sx * (W / 2 + T / 2), H / 2, -Dp / 2));
  k.collide(cbox(0.4, 0.48, 1.6, bx, 0.24, -Dp / 2));
  k.anchors.bench = V3(bx, 0.48, -Dp / 2);
  k.anchors.center = V3(0, 0, -Dp / 2);
  k.anchors.hatch = V3(0, 1.1, -Dp + 0.15);
  k.parts.ceilingLight = panel;
  void A;
  return k.done({ mass: 10000, material: 'metal' });
}
