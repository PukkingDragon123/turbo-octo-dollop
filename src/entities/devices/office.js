// Office hardware: CRT terminal (monitor, keyboard, 486 tower), curved reception desk, photocopier,
// server rack, lockers. Floor devices: origin on the floor under the centre, front +Z.
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, DEG, V3, cbox, frameShape, rrShape, rrHole, Geo, boxGeo, lerp, clamp } from './core.js';
import * as P from './parts.js';
import { txt, rrect, grime, rubOff, drawLogo, drawClone, drawPerforation } from './atlas.js';
import { RNG } from '../../core/rng.js';

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------
// box tapering from full size at the front (+Z) to (tx, ty) at the back, back face dropped by dy
function taperBox(w, h, d, tx, ty, o = {}) {
  const g = boxGeo(w, h, d, { r: o.r ?? 0.01, seg: o.seg ?? 2 });
  g.deform((p) => { const t = clamp(0.5 - p.z / d, 0, 1); p.x *= lerp(1, tx, t); p.y = p.y * lerp(1, ty, t) + (o.dy ?? 0) * t; }, false);
  g.computeNormals(true);
  return g;
}
const BEIGE = { tint: 0xb3aa8a, rough: 0.85 };
const solid = (A, hex) => { const w = A.swatch(hex); return { u0: w.u, u1: w.u, v0: w.v, v1: w.v }; };
// 14" CRT monitor in the kit's current frame (screen faces +Z); returns geometry facts
function crtMonitor(k, name, o = {}) {
  const sw = o.sw ?? 0.28, sh = sw * 0.75;
  const bw = sw + 0.085, bh = sh + 0.1, bd = sw * 1.15;
  const sh0 = o.shell || BEIGE;
  const cy = 0.055 + bh / 2;
  const oy = 0.012;
  k.ext('plastic', frameShape(bw, bh, 0.018, sw + 0.012, sh + 0.012, 0.012, 0, oy), 0.03, 0, cy, -0.036, { ...sh0, bev: 0.006, bevSeg: 2, curveSeg: 4 });
  k.ext('#141414:p', frameShape(sw + 0.018, sh + 0.018, 0.012, sw - 0.004, sh - 0.004, 0.01), 0.02, 0, cy + oy, -0.044, { curveSeg: 3 });
  k.put('plastic', taperBox(bw - 0.012, bh - 0.012, bd - 0.04, 0.62, 0.62, { r: 0.016, dy: -0.02 }), 0, cy, -0.04 - (bd - 0.04) / 2, sh0);
  k.box('plastic', (bw - 0.012) * 0.6, (bh - 0.012) * 0.6, 0.04, 0, cy - 0.024, -bd - 0.005, { ...sh0, r: 0.01 });
  for (let i = 0; i < 6; i++) k.box('#121212', 0.01, 0.003, bd * 0.36, -0.06 + i * 0.024, cy + (bh - 0.012) * 0.42 * 0.8 + 0.004, -bd * 0.55, { rot: [-0.13, 0, 0], r: 0 });
  const screen = k.screen(name, sw, sh, 0, cy + oy, -0.03, { bulge: sw * 0.04, style: o.style || 'crt', text: o.text ?? 'R.O.O.M. OS v2.1\n> READY_', aspect: 4 / 3, glow: o.glow });
  // controls row under the screen
  const by = cy - bh / 2 + 0.03;
  const reg = k.reg('crt_badge_' + (o.badge || 'v14'), 128, 24, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, o.badge || 'R.O.O.M. VISION 14', w / 2, h / 2, h * 0.62, { col: '#4a4436', f: 'bold', maxW: w * 0.95 }); });
  k.label(reg, bw * 0.38, bw * 0.38 * 24 / 128, -bw * 0.22, by, 0.0012);
  k.box('#858176:s', 0.018, 0.012, 0.006, bw * 0.38, by, 0.002, { r: 0.002 });
  for (let i = 0; i < 3; i++) k.cyl('#5a574e:s', 0.005, 0.006, bw * 0.06 + i * 0.022, by, 0.003, { axis: 'z', seg: 10 });
  const led = { geo: new Geo().append(boxGeo(0.005, 0.003, 0.002, { r: 0 }).translate(bw * 0.3, by, 0.001)), color: 0x30ff60, intensity: 2.2 };
  k.box('#0e0e0e:p', 0.009, 0.007, 0.002, bw * 0.3, by, 0.0002, { r: 0 });
  if (o.staticLed) k.box('#30ff60:e', 0.005, 0.003, 0.002, bw * 0.3, by, 0.001, { r: 0 });
  // swivel stand
  k.cyl('plastic', bw * 0.3, 0.018, 0, 0.009, -bd * 0.35, { ...sh0, seg: 28, r2: bw * 0.32, bev: 0.004 });
  k.cyl('plastic', bw * 0.2, 0.03, 0, 0.033, -bd * 0.35, { ...sh0, seg: 24, r2: bw * 0.24 });
  k.box('plastic', bw * 0.4, 0.03, bd * 0.4, 0, 0.05, -bd * 0.35, { ...sh0, r: 0.008 });
  if (o.cables !== false) {
    P.cable(k, [[0.03, cy - 0.06, -bd - 0.02], [0.04, cy - 0.12, -bd - 0.1], [0.05, 0.01, -bd - 0.14], [0.12, 0.006, -bd - 0.2]], 0.004, { tint: 0x858176 });
    P.cable(k, [[-0.03, cy - 0.06, -bd - 0.02], [-0.04, cy - 0.12, -bd - 0.08], [-0.06, 0.01, -bd - 0.12], [-0.2, 0.006, -bd - 0.15]], 0.004, { tint: 0x161616 });
  }
  // dust on the screen glass edge + a sticky note
  return { screen, cy: cy + oy, led, bw, bh, bd };
}
// 101-key keyboard: wedge case, keycaps through the atlas with a top-down printed legend layer
const KB_ROWS = [
  [['ESC', 1, 1], [null, 1], ['F1', 1, 1], ['F2', 1, 1], ['F3', 1, 1], ['F4', 1, 1], [null, 0.5], ['F5', 1, 1], ['F6', 1, 1], ['F7', 1, 1], ['F8', 1, 1], [null, 0.5], ['F9', 1, 1], ['F10', 1, 1], ['F11', 1, 1], ['F12', 1, 1]],
  [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['BKSP', 2, 1]],
  [['TAB', 1.5, 1], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['[', 1], [']', 1], ['\\', 1.5, 1]],
  [['CAPS', 1.75, 1], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], [';', 1], ["'", 1], ['ENTER', 2.25, 1]],
  [['SHIFT', 2.25, 1], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], [',', 1], ['.', 1], ['/', 1], ['SHIFT', 2.75, 1]],
  [['CTRL', 1.5, 1], ['ALT', 1.25, 1], [' ', 7.25], ['ALT', 1.25, 1], ['CTRL', 1.5, 1]],
];
const KB_PAD = [['NUM', '/', '*', '-'], ['7', '8', '9', '+'], ['4', '5', '6', null], ['1', '2', '3', 'EN'], ['0', null, '.', null]];
function keyboard(k, x, y, z, o = {}) {
  const u = 0.019, W = 0.46, D = 0.17;
  const keys = [];
  const x0 = -W / 2 + 0.012, zTop = -D / 2 + 0.018;
  KB_ROWS.forEach((row, ri) => {
    let cx = x0;
    const kz = zTop + (ri === 0 ? 0 : ri * u + 0.008);
    for (const [lab, wu, mod] of row) { if (lab !== null) keys.push({ x: cx + (wu * u) / 2, z: kz + u / 2, w: wu * u - 0.003, d: u - 0.003, lab, mod: !!mod, ri }); cx += wu * u; }
  });
  const px0 = W / 2 - 0.012 - 4 * u;
  KB_PAD.forEach((row, ri) => row.forEach((lab, ci) => {
    if (lab === null) return;
    const tall = lab === '+' || lab === 'EN', wide = lab === '0';
    keys.push({ x: px0 + (ci + (wide ? 1 : 0.5)) * u, z: zTop + (ri + 1) * u + 0.008 + (tall ? u : u / 2), w: (wide ? 2 : 1) * u - 0.003, d: (tall ? 2 : 1) * u - 0.003, lab, mod: ci === 3, ri: ri + 1 });
  }));
  const PX = 1000;
  const reg = k.reg('kb_legend', Math.round(W * PX), Math.round(D * PX), (c, w, h) => {
    c.fillStyle = '#9a917a'; c.fillRect(0, 0, w, h);
    for (const kk of keys) {
      const cx = (kk.x + W / 2) * PX, cz = (kk.z + D / 2) * PX, kw = (kk.w + 0.003) * PX, kd = (kk.d + 0.003) * PX;
      c.fillStyle = kk.mod ? '#8a8576' : '#cfc7aa'; c.fillRect(cx - kw / 2, cz - kd / 2, kw, kd);
      const g = c.createRadialGradient(cx, cz, 1, cx, cz, kw * 0.6); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
      c.fillStyle = g; c.fillRect(cx - kw / 2, cz - kd / 2, kw, kd);
      if (kk.lab && kk.lab !== ' ') txt(c, kk.lab, cx - (kk.lab.length > 1 ? kw * 0.12 : 0), cz - kd * 0.08, kk.lab.length > 2 ? 4.5 : kk.lab.length > 1 ? 5.5 : 8, { col: '#222018', f: 'bold', maxW: kw * 0.85 });
    }
    // shine on the most used keys
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (const kk of keys) if ('WASDE '.includes(kk.lab) && kk.lab.length === 1) { const cx = (kk.x + W / 2) * PX, cz = (kk.z + D / 2) * PX; c.beginPath(); c.ellipse(cx, cz, kk.w * PX * 0.3, kk.d * PX * 0.3, 0, 0, TAU); c.fill(); }
  }, 's');
  k.push(x, y, z);
  k.put('plastic', taperBox(W, 0.026, D, 1, 0.5, { r: 0.006, dy: -0.006 }).translate(0, 0.013, 0), 0, 0, 0, o.shell || BEIGE);
  k.box('#858176:p', W - 0.012, 0.003, D - 0.02, 0, 0.0255, 0.0, { r: 0 });
  const kg = new Geo();
  for (const kk of keys) {
    const ky = 0.024 + (5 - kk.ri) * 0.0016;
    const g = boxGeo(kk.w, 0.009, kk.d, { r: 0, skip: { ny: true } });
    g.deform((p) => { if (p.y > 0) { p.x *= 0.82; p.z *= 0.8; } }, false);
    g.computeNormals(false);
    kg.append(g.translate(kk.x, ky + 0.0045, kk.z));
  }
  for (let i = 0; i < kg.count; i++) { kg.uv[i * 2] = lerp(reg.u0, reg.u1, clamp((kg.p[i * 3] + W / 2) / W, 0, 1)); kg.uv[i * 2 + 1] = lerp(reg.v1, reg.v0, clamp((kg.p[i * 3 + 2] + D / 2) / D, 0, 1)); }
  k.put('atlas', kg, 0, 0, 0, { uvOff: false });
  for (let i = 0; i < 3; i++) k.box('#2a8a3a:e', 0.004, 0.002, 0.003, W / 2 - 0.06 + i * 0.012, 0.0272, -D / 2 + 0.01, { r: 0 });
  k.pop();
}

// ---------------------------------------------------------------------------
// CRT TERMINAL: beige 14" CRT (screens.main 4:3), keyboard, mouse + pad, 486 tower, floppy
// parts.powerLed + parts.leds (glow proxies), anchors.view / screenCenter / keyboard
// ---------------------------------------------------------------------------
export function b_crt_terminal(o) {
  const k = new DKit('crt_terminal', { wear: { chip: 0.04, rust: 0.02, grime: 0.55, dust: 0.45 } });
  const A = k.atlas(1024, 1024);
  k.push(-0.06, 0, -0.1);
  const mon = crtMonitor(k, 'main', { sw: 0.28, text: o.text ?? 'R.O.O.M. OS v2.1\nC:\\> LOGIN_\n\nWELCOME, EMPLOYEE', badge: 'R.O.O.M. VISION 14' });
  k.pop();
  const sc = mon.screen.position;
  const note = A.add(64, 64, (c, w, h) => { c.fillStyle = '#f7e36a'; c.fillRect(0, 0, w, h); txt(c, 'PASSWORD:', w / 2, h * 0.3, 10, { col: '#2a2aa0', f: 'mono' }); txt(c, 'ROOM123', w / 2, h * 0.55, 13, { col: '#2a2aa0', f: 'mono' }); grime(c, w, h, 0.4, 3, { corner: 0.2 }); });
  k.label(note, 0.05, 0.05, -0.06 + mon.bw / 2 - 0.035, mon.cy + mon.bh / 2 - 0.06, -0.1 + 0.0035, { rot: [0, 0, -0.12] });
  keyboard(k, -0.06, 0, 0.21);
  P.cable(k, [[-0.06, 0.012, 0.12], [-0.02, 0.006, 0.05], [0.05, 0.006, 0.0], [0.15, 0.006, -0.1], [0.24, 0.02, -0.2]], 0.003, { tint: 0xb8b09a });
  // mouse + pad
  const pad = A.add(128, 112, (c, w, h) => { c.fillStyle = '#1d3a6a'; c.fillRect(0, 0, w, h); drawLogo(c, w * 0.6, h * 0.82, 18, '#8fb0e0'); c.strokeStyle = '#4a6a9a'; c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8); grime(c, w, h, 0.8, 9); }, 'r');
  k.box('#1a1a1a:r', 0.22, 0.003, 0.19, 0.3, 0.0015, 0.2, { r: 0.0012 });
  k.label(pad, 0.215, 0.185, 0.3, 0.0034, 0.2, { rot: [-HP, 0, 0] });
  const mouse = taperBox(0.06, 0.03, 0.1, 0.8, 0.55, { r: 0.012, seg: 3 });
  k.put('plastic', mouse, 0.31, 0.018, 0.21, { ...BEIGE, rot: [0, PI, 0] });
  for (const s of [-1, 1]) k.box('#bdb498:s', 0.026, 0.003, 0.038, 0.31 + s * 0.0145, 0.0335, 0.187, { r: 0.0014 });
  P.cable(k, [[0.31, 0.012, 0.16], [0.3, 0.006, 0.08], [0.33, 0.006, -0.05], [0.34, 0.03, -0.12]], 0.0025, { tint: 0xb8b09a });
  // tower
  const tx = 0.4, tz = -0.12, tw = 0.18, th = 0.42, td = 0.42;
  k.box('plastic', tw, th, td, tx, th / 2 + 0.01, tz, { ...BEIGE, r: 0.008 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('#151515:r', 0.03, 0.01, 0.03, tx + x * 0.06, 0.005, tz + z * 0.17, { r: 0.003 });
  const fz = tz + td / 2;
  k.box('plastic', tw - 0.02, th - 0.03, 0.01, tx, th / 2 + 0.01, fz + 0.002, { tint: 0xc4bb9c, rough: 0.8, r: 0.004 });
  for (let i = 0; i < 2; i++) {
    k.box('#d8d0b4:s', 0.148, 0.042, 0.006, tx, 0.37 - i * 0.05, fz + 0.008, { r: 0.002 });
    k.box('#0e0e0e', 0.1, 0.004, 0.004, tx, 0.37 - i * 0.05, fz + 0.011, { r: 0 });
  }
  k.box('#d8d0b4:s', 0.11, 0.028, 0.006, tx, 0.26, fz + 0.008, { r: 0.002 });
  k.box('#0e0e0e', 0.09, 0.003, 0.004, tx, 0.265, fz + 0.011, { r: 0 });
  k.box('#8a8678:s', 0.016, 0.008, 0.004, tx + 0.04, 0.253, fz + 0.011, { r: 0 });
  P.pushButton(k, tx, 0.12, fz + 0.007, 0.014, { tint: 0x8a8678, ringSlot: '#b3aa8a:s', name: 'power', static: true });
  k.box('#8a8678:s', 0.02, 0.012, 0.008, tx - 0.05, 0.19, fz + 0.01, { r: 0.002 });
  k.cyl('#c4c7ca:c', 0.007, 0.008, tx + 0.05, 0.19, fz + 0.01, { axis: 'z', seg: 12 });
  const tb = k.reg('crt_486', 160, 40, (c, w, h) => { c.fillStyle = '#2a2a2a'; rrect(c, 0, 0, w, h, 6); c.fill(); txt(c, 'R.O.O.M. 486DX', w / 2, h * 0.4, h * 0.36, { col: '#e8c860' }); txt(c, 'TURBO 66MHz', w / 2, h * 0.76, h * 0.2, { col: '#bbb', f: 'mono' }); }, 's');
  k.label(tb, 0.1, 0.025, tx, 0.06, fz + 0.0078);
  const turbo = k.reg('crt_turbo', 64, 24, (c, w, h) => { c.fillStyle = '#1a0606'; c.fillRect(0, 0, w, h); txt(c, '66', w / 2, h / 2, h * 0.8, { col: '#ff3a1e', f: 'vt' }); }, { e: 0.6, r: 0.3, m: 0 });
  k.label(turbo, 0.026, 0.01, tx - 0.05, 0.215, fz + 0.0078);
  k.push(tx, 0.3, tz - td / 2, [0, PI, 0]);
  P.slotVent(k, 0, 0, 0, 0.1, 0.12, 6, { mo: BEIGE, slot: 'plastic' });
  k.pop();
  P.cable(k, [[tx - 0.04, 0.3, tz - td / 2], [tx - 0.08, 0.2, tz - td / 2 - 0.06], [tx - 0.2, 0.02, tz - td / 2 - 0.08], [-0.1, 0.01, -0.5]], 0.004, { tint: 0x161616 });
  P.scuffs(k, tx, 0.2, fz + 0.0075, 0.16, 0.3, { col: '40,34,24', alpha: 0.25 });
  // floppy disk on the desk
  const fd = A.add(64, 64, (c, w, h) => { c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#aaa'; c.fillRect(w * 0.3, 0, w * 0.4, h * 0.3); c.fillStyle = '#eee'; c.fillRect(w * 0.15, h * 0.45, w * 0.7, h * 0.5); txt(c, 'BACKUP', w / 2, h * 0.62, 11, { col: '#c00', f: 'mono' }); txt(c, 'DO NOT LOSE', w / 2, h * 0.8, 7, { col: '#333', f: 'mono' }); });
  k.labelBox({ py: fd, side: solid(A, '#1a1a1a') }, 0.09, 0.003, 0.094, -0.36, 0.0015, 0.12, { rot: [0, 0.4, 0] });
  // LEDs: monitor power (parts.powerLed) + tower power / disk (parts.leds), one glow draw
  const tled = (x, col) => ({ geo: new Geo().append(boxGeo(0.005, 0.003, 0.002, { r: 0 }).translate(x, 0.155, fz + 0.008)), color: col, intensity: 2.2 });
  const monLed = { ...mon.led, geo: new Geo().append(mon.led.geo).translate(-0.06, 0, -0.1) };
  const leds = k.glow('leds', [monLed, tled(tx - 0.03, 0x30ff60), tled(tx + 0.03, 0xffa020)]);
  leds[0].name = 'powerLed'; leds[1].name = 'ledPower'; leds[2].name = 'ledDisk';
  k.collide(cbox(mon.bw, mon.bh + 0.06, 0.34, -0.06, (mon.bh + 0.06) / 2, -0.24));
  k.collide(cbox(0.46, 0.04, 0.17, -0.06, 0.02, 0.21));
  k.collide(cbox(tw, th + 0.01, td, tx, (th + 0.01) / 2, tz));
  k.anchors.view = V3(sc.x, sc.y, sc.z + 0.55);
  k.anchors.screenCenter = V3(sc.x, sc.y, sc.z);
  k.anchors.keyboard = V3(-0.06, 0.035, 0.21);
  k.parts.powerLed = leds[0];
  k.parts.leds = [leds[1], leds[2]];
  return k.done({ mass: 26, material: 'plastic' });
}

// annular-sector slab around +Y (angle 0 = +Z, increasing toward +X), radii r0..r1, heights y0..y1
function arcSlab(r0, r1, a0, a1, y0, y1, seg = 24, edge = 0.6) {
  const g = new Geo();
  const S = Math.sin, C = Math.cos;
  for (const [r, s] of [[r1, 1], [r0, -1]]) {
    const base = g.count;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      for (const y of [y0, y1]) g.v(S(a) * r, y, C(a) * r, S(a) * s, 0, C(a) * s, a * r, y, s > 0 && y === y1 ? edge : 0);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; if (s > 0) g.quad(a, a + 2, a + 3, a + 1); else g.quad(a, a + 1, a + 3, a + 2); }
  }
  for (const [y, s] of [[y1, 1], [y0, -1]]) {
    const base = g.count;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      g.v(S(a) * r0, y, C(a) * r0, 0, s, 0, S(a) * r0, C(a) * r0, 0);
      g.v(S(a) * r1, y, C(a) * r1, 0, s, 0, S(a) * r1, C(a) * r1, s > 0 ? edge : 0);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; if (s > 0) g.quad(a, a + 1, a + 3, a + 2); else g.quad(a, a + 2, a + 3, a + 1); }
  }
  for (const [a, s] of [[a0, -1], [a1, 1]]) {
    const nx = C(a) * s, nz = -S(a) * s, base = g.count;
    for (const r of [r0, r1]) for (const y of [y0, y1]) g.v(S(a) * r, y, C(a) * r, nx, 0, nz, r, y, 0);
    if (s > 0) g.quad(base, base + 1, base + 3, base + 2); else g.quad(base, base + 2, base + 3, base + 1);
  }
  return g;
}

// ---------------------------------------------------------------------------
// RECEPTION DESK: curved veneer counter (convex toward +Z) with brass trims and raised lettering,
// inner work surface with phone, CRT (screens.main) + keyboard, drawer pedestal, counter clutter
// anchors.bell / top / receptionist / workSurface / screenView
// ---------------------------------------------------------------------------
export function b_reception_desk(o) {
  void o;
  const k = new DKit('reception_desk', { wear: { chip: 0.1, rust: 0.04, grime: 0.45, dust: 0.35 }, ao: { res: 64 } });
  const A = k.atlas(1024, 1024);
  const R = 1.8, a0 = -38 * DEG, a1 = 38 * DEG, zc = -R + 0.45;
  const VEN = { tint: 0xc89060, rough: 0.75 }, DW = { tint: 0x5a3a24, rough: 0.8 };
  const BEI = { tint: 0xa49a7c }, LAM = { tint: 0x8f8670, chip: 0.04 };
  const BR = { ...FIN.brass, rough: 0.5, rust: 0.1 };
  const slab = (slot, mo, r0, r1, y0, y1, aa = a0, ab = a1, seg = 28) => k.put(slot, arcSlab(r0, r1, aa, ab, y0, y1, seg), 0, 0, zc, mo);
  slab('#151515:p', {}, R - 0.13, R - 0.09, 0, 0.1);
  slab('wood', VEN, R - 0.04, R, 0.1, 0.9);
  slab('metal', BR, R - 0.03, R + 0.004, 0.9, 0.912);
  slab('paint', BEI, R - 0.035, R + 0.002, 0.912, 1.04);
  slab('wood', DW, R - 0.34, R + 0.065, 1.04, 1.075);
  slab('metal', BR, R + 0.064, R + 0.069, 1.044, 1.071);
  for (let i = 1; i < 8; i++) { const a = a0 + ((a1 - a0) * i) / 8; slab('wood', DW, R - 0.01, R + 0.003, 0.1, 0.9, a - 0.004, a + 0.004, 1); }
  for (const s2 of [-1, 1]) {
    const aa = s2 > 0 ? a1 - 0.012 : a0, ab = s2 > 0 ? a1 : a0 + 0.012;
    slab('wood', VEN, R - 0.36, R - 0.002, 0.1, 1.04, aa, ab, 1);
    slab('#151515:p', {}, R - 0.36, R - 0.09, 0, 0.1, aa, ab, 1);
  }
  // inner work surface + edge + modesty panel + support
  slab('paint', LAM, R - 1.0, R - 0.34, 0.72, 0.75, a0 + 0.02, a1 - 0.02);
  slab('wood', DW, R - 1.005, R - 0.995, 0.7, 0.75, a0 + 0.02, a1 - 0.02);
  slab('wood', { tint: 0x4a3020, rough: 0.85 }, R - 0.36, R - 0.34, 0.1, 1.04);
  k.put('paint', arcSlab(R - 0.98, R - 0.36, a0 + 0.06, a0 + 0.075, 0.0, 0.72, 1), 0, 0, zc, LAM);
  // drawer pedestal (behind, right)
  const px = 0.62, pz = zc + R - 0.75;
  k.box('paint', 0.42, 0.7, 0.55, px, 0.36, pz, { ...BEI, r: 0.006, rot: [0, 0.2, 0] });
  for (let i = 0; i < 3; i++) {
    k.push(px, 0.15 + i * 0.22, pz, [0, 0.2, 0]);
    k.box('paint', 0.39, 0.2, 0.012, 0, 0, -0.28, { ...LAM, r: 0.004 });
    P.pullHandle(k, 0, 0.06, -0.286, 0.1, { rot: [0, PI, 0], d: 0.022, r: 0.004, slot: '#c4c7ca:c' });
    k.pop();
  }
  // brass lettering following the curve (with an offset shadow for a raised look) + logo medallion
  const sign = A.add(1000, 120, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fbe6a0'); g.addColorStop(0.5, '#caa04c'); g.addColorStop(1, '#8a6420');
    c.font = `900 ${h * 0.62}px Georgia, 'Times New Roman', serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = g; c.fillText('R.O.O.M.  RECEPTION', w / 2, h * 0.55);
  }, 'm');
  const shadow = A.add(1000, 120, (c, w, h) => { c.font = `900 ${h * 0.62}px Georgia, 'Times New Roman', serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(26,14,4,0.7)'; c.fillText('R.O.O.M.  RECEPTION', w / 2 + 4, h * 0.55 + 5); });
  const arc = 1.5 / R;
  k.put('decal', clabelGeo(R + 0.002, 0.16, arc, shadow, 24), 0, 0.64, zc);
  k.put('atlas', clabelGeo(R + 0.008, 0.16, arc, sign, 24), 0, 0.645, zc);
  const logo = A.add(160, 160, (c, w, h) => { c.clearRect(0, 0, w, h); const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); g.addColorStop(0, '#fbe6a0'); g.addColorStop(1, '#8a6420'); c.fillStyle = g; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); c.fill(); drawLogo(c, w / 2, h / 2, w * 0.55, '#3a2808', { text: false }); }, 'm');
  k.cyl('metal', 0.072, 0.008, 0, 0.81, zc + R + 0.004, { ...BR, axis: 'z', seg: 32, bev: 0.002 });
  k.dlabel(logo, 0.07, 0, 0.81, zc + R + 0.0085);
  // counter-top props: forms tray, pen cup, ring placard
  const fz = zc + R - 0.12;
  k.push(-0.5, 1.075, fz - 0.06, [0, 0.2, 0]);
  k.box('#222222:p', 0.24, 0.04, 0.3, 0, 0.02, 0, { r: 0.004 });
  k.box('#cfcab8:r', 0.215, 0.02, 0.28, 0, 0.03, 0, { r: 0.001, rot: [0, 0.02, 0] });
  const form = A.add(110, 140, (c, w, h) => { c.fillStyle = '#ede8d8'; c.fillRect(0, 0, w, h); txt(c, 'VISITOR FORM 7-B', w / 2, 10, 8, { col: '#222', f: 'mono' }); c.fillStyle = '#9a9488'; for (let i = 0; i < 12; i++) c.fillRect(8, 24 + i * 9, w - 16, 1); });
  k.label(form, 0.2, 0.26, 0, 0.0405, 0, { rot: [-HP, 0, 0.02] });
  k.pop();
  k.cyl('#1d1d1d:p', 0.035, 0.1, -0.22, 1.125, fz - 0.05, { seg: 16, bev: 0.002 });
  ['#2a5fc0:s', '#c8231b:s', '#1a1a1a:s', '#e8c41a:s'].forEach((sl, i) => k.cyl(sl, 0.004, 0.15, -0.22 + Math.cos(i * 1.6) * 0.015, 1.16, fz - 0.05 + Math.sin(i * 1.6) * 0.015, { seg: 6, rot: [Math.sin(i) * 0.2, 0, Math.cos(i) * 0.2] }));
  const ring = A.add(200, 90, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a1a14'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12); txt(c, 'PLEASE RING', w / 2, h * 0.36, h * 0.24, { col: '#7a1a14', f: 'serif' }); txt(c, 'FOR SERVICE', w / 2, h * 0.68, h * 0.24, { col: '#7a1a14', f: 'serif' }); grime(c, w, h, 0.3, 4); });
  for (const s of [-1, 1]) k.label(ring, 0.15, 0.067, 0.18, 1.105, fz - 0.06 + s * 0.012, { rot: [s * 0.35, s > 0 ? 0 : PI, 0] });
  // receptionist side: phone, CRT, keyboard
  const seatZ = zc + R - 1.25;
  k.push(-0.55, 0.75, seatZ + 0.55, [0, 0.5, 0]);
  k.put('plastic', taperBox(0.2, 0.06, 0.2, 1, 0.7, { r: 0.02 }), 0, 0.03, 0, BEIGE);
  k.box('plastic', 0.22, 0.04, 0.05, 0, 0.075, 0, { ...BEIGE, r: 0.015 });
  for (let i = 0; i < 12; i++) k.box('#d8d0b8:s', 0.018, 0.006, 0.014, -0.025 + (i % 3) * 0.025, 0.061, 0.045 - Math.floor(i / 3) * 0.02, { r: 0.002, rot: [0.3, 0, 0] });
  k.pop();
  P.cable(k, [[-0.5, 0.79, seatZ + 0.5], [-0.42, 0.76, seatZ + 0.46], [-0.38, 0.755, seatZ + 0.55], [-0.45, 0.755, seatZ + 0.6]], 0.004, { tint: 0xb3aa8a });
  k.push(0.15, 0.75, seatZ + 0.48, [0, PI - 0.25, 0]);
  const mon = crtMonitor(k, 'main', { sw: 0.26, text: 'VISITOR LOG\n> NO VISITORS_', badge: 'R.O.O.M. VISION 14', cables: false, staticLed: true });
  k.pop();
  k.push(0.1, 0.75, seatZ + 0.33, [0, PI, 0]);
  keyboard(k, 0, 0, 0);
  k.pop();
  // colliders: arc approximated with rotated boxes
  const nseg = 6;
  for (let i = 0; i < nseg; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / nseg, rr = R - 0.12;
    const len = 2 * R * Math.sin((a1 - a0) / nseg / 2) + 0.02;
    k.collide(cbox(len, 1.075, 0.26, rr * Math.sin(a), 0.5375, zc + rr * Math.cos(a), [0, a, 0]));
  }
  k.collide(cbox(1.9, 0.05, 0.6, 0, 0.735, zc + R - 0.65));
  k.anchors.bell = V3((R - 0.14) * Math.sin(0.18), 1.075, zc + (R - 0.14) * Math.cos(0.18));
  k.anchors.top = V3(0, 1.075, zc + R - 0.14);
  k.anchors.receptionist = V3(0, 0.47, seatZ);
  k.anchors.workSurface = V3(-0.2, 0.75, seatZ + 0.45);
  k.anchors.screenView = mon.screen.position.clone().addScaledVector(new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), PI - 0.25), 0.55);
  k.params.receptionistFacing = '+Z';
  return k.done({ mass: 420, material: 'wood' });
}
// atlas print wrapped on a cylinder of radius r around +Y, centred on +Z
function clabelGeo(r, h, arc, reg, seg) {
  const g = new Geo();
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= seg; i++) {
    const t = -arc / 2 + (i / seg) * arc;
    g.v(Math.sin(t) * r, (j - 0.5) * h, Math.cos(t) * r, Math.sin(t), 0, Math.cos(t), lerp(reg.u0, reg.u1, i / seg), lerp(reg.v0, reg.v1, j), 0);
  }
  for (let i = 0; i < seg; i++) g.quad(i, i + 1, i + seg + 2, i + seg + 1);
  return g;
}

// ---------------------------------------------------------------------------
// PHOTOCOPIER: casters, three paper drawers, toner door, sloped control panel with LCD (screens.main),
// keypad, COPY key, jam lamp (parts.lamp), platen glass + lid pivot (parts.lid, static), output tray
// ---------------------------------------------------------------------------
export function b_photocopier(o) {
  void o;
  const k = new DKit('photocopier', { wear: { chip: 0.05, rust: 0.04, grime: 0.55, dust: 0.45 }, ao: { res: 56 } });
  const A = k.atlas(1024, 1024);
  const W = 1.1, D = 0.68;
  const GR = { tint: 0x6e6c66, rough: 0.8 };
  // casters + plinth
  k.box('plastic', W - 0.04, 0.05, D - 0.06, 0, 0.045, 0, { ...GR, r: 0.006 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.box('metal', 0.04, 0.008, 0.04, sx * (W / 2 - 0.06), 0.02, sz * (D / 2 - 0.06), { ...FIN.zinc, r: 0.002 });
    k.cyl('#111111:r', 0.016, 0.014, sx * (W / 2 - 0.06), 0.016, sz * (D / 2 - 0.06) + 0.008, { axis: 'x', seg: 12, bev: 0.003 });
  }
  // base cabinet + drawers
  k.box('plastic', W, 0.46, D, 0, 0.3, 0, { ...BEIGE, r: 0.012 });
  for (let i = 0; i < 3; i++) {
    const y = 0.15 + i * 0.13;
    k.box('plastic', W - 0.06, 0.115, 0.012, 0, y, D / 2 + 0.006, { ...BEIGE, r: 0.004 });
    k.box('#4e4c46:p', 0.2, 0.026, 0.006, 0, y + 0.02, D / 2 + 0.0125, { r: 0.006 });
    k.box('plastic', 0.18, 0.012, 0.02, 0, y + 0.028, D / 2 + 0.018, { ...GR, r: 0.005 });
    const lb = k.reg('pc_size' + i, 80, 30, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); txt(c, ['A3', 'A4', 'LTR'][i], w / 2, h / 2, h * 0.6, { col: '#111', f: 'mono' }); });
    k.label(lb, 0.06, 0.022, -0.35, y + 0.02, D / 2 + 0.0126);
    // paper level indicator
    k.box('#202020', 0.03, 0.008, 0.002, 0.38, y + 0.02, D / 2 + 0.0124, { r: 0 });
    k.box('#e8c41a:s', 0.01 + i * 0.006, 0.004, 0.002, 0.37 + i * 0.003, y + 0.02, D / 2 + 0.0132, { r: 0 });
  }
  // main body + toner door
  k.box('plastic', W, 0.42, D, 0, 0.74, 0, { ...BEIGE, r: 0.015 });
  k.box('plastic', W - 0.2, 0.2, 0.012, -0.05, 0.68, D / 2 + 0.002, { ...GR, r: 0.006 });
  k.box('#3a3a38:p', W - 0.2, 0.004, 0.004, -0.05, 0.582, D / 2 + 0.008, { r: 0 });
  const jam = k.reg('pc_jam', 200, 120, (c, w, h) => { c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h); txt(c, 'PAPER JAM?', w / 2, h * 0.2, h * 0.16, { col: '#a01a14' }); c.strokeStyle = '#333'; c.lineWidth = 2; c.strokeRect(30, 40, w - 60, 50); c.beginPath(); c.moveTo(50, 65); c.lineTo(w - 50, 65); c.stroke(); txt(c, 'Pull lever A. Pray.', w / 2, h * 0.88, h * 0.11, { col: '#111', f: 'mono' }); grime(c, w, h, 0.6, 7, { corner: 0.1 }); });
  k.label(jam, 0.18, 0.108, -0.3, 0.68, D / 2 + 0.0085);
  k.box('#2a5fc0:s', 0.03, 0.05, 0.016, 0.22, 0.66, D / 2 + 0.012, { r: 0.006 });
  P.handprint(k, 0.1, 0.72, D / 2 + 0.0085, 0.12, { alpha: 0.2 });
  // output tray (left) with a stack of copies
  k.push(-W / 2 - 0.12, 0.62, 0, [0, 0, 0.18]);
  k.box('plastic', 0.26, 0.01, 0.36, 0, 0, 0, { ...GR, r: 0.003 });
  for (let i = 0; i < 5; i++) k.box('#e2ddd0:r', 0.21, 0.0035, 0.297, 0.005 * Math.sin(i * 2.1), 0.007 + i * 0.0036, 0.006 * Math.cos(i * 1.7), { r: 0, rot: [0, 0.01 * i, 0] });
  k.pop();
  // platen glass + lid (static pivot at the hinge)
  k.box('#1d2a2a:g', 0.62, 0.004, 0.44, -0.1, 0.951, 0.02, { r: 0 });
  const lid = k.grp(-0.1, 0.953, -D / 2 + 0.05, { name: 'lid' });
  k.insideStatic(lid, () => {
    k.box('plastic', 0.72, 0.035, 0.54, 0, 0.0175, 0.27, { ...BEIGE, r: 0.01 });
    k.box('plastic', 0.1, 0.012, 0.02, 0, 0.02, 0.545, { ...GR, r: 0.004 });
    k.box('#c8c8c4:p', 0.66, 0.002, 0.48, 0, -0.001, 0.27, { r: 0 });
    for (const sx of [-1, 1]) k.box('metal', 0.05, 0.03, 0.03, sx * 0.25, 0.0, -0.01, { ...FIN.zinc, r: 0.004 });
  });
  // control panel (front right, sloped)
  k.push(0.38, 0.958, D / 2 - 0.12, [-0.35, 0, 0]);
  k.box('plastic', 0.3, 0.025, 0.22, 0, 0, 0, { ...GR, r: 0.008 });
  k.box('#0e0e0e:p', 0.15, 0.06, 0.006, -0.05, 0.015, -0.04, { rot: [-HP, 0, 0], r: 0.002 });
  k.screen('main', 0.13, 0.045, -0.05, 0.0185, -0.04, { style: 'lcd', text: 'READY\nCOPIES: 1', bulge: 0, rot: [-HP, 0, 0], aspect: 0.13 / 0.045 });
  const keys = k.reg('pc_keys', 120, 120, (c, w, h) => { c.fillStyle = '#c8c4b4'; c.fillRect(0, 0, w, h); txt(c, '7 8 9  4 5 6  1 2 3  * 0 #', w / 2, h / 2, 10, { col: '#222' }); }, 's');
  void keys;
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '#'].forEach((lab, i) => {
    const r = Math.floor(i / 3), c = i % 3;
    k.box('#c8c4b4:s', 0.025, 0.012, 0.02, -0.1 + c * 0.032, 0.018, 0.02 + r * 0.025, { r: 0.004 });
    const reg = k.reg('pc_k' + lab, 24, 20, (cc, w, h) => { cc.fillStyle = '#c8c4b4'; cc.fillRect(0, 0, w, h); txt(cc, lab, w / 2, h / 2 + 1, h * 0.7, { col: '#222', f: 'bold' }); }, 's');
    k.label(reg, 0.02, 0.016, -0.1 + c * 0.032, 0.0242, 0.02 + r * 0.025, { rot: [-HP, 0, 0] });
  });
  k.box('#2a9a3a:s', 0.07, 0.016, 0.05, 0.09, 0.02, 0.05, { r: 0.01 });
  const cl = k.reg('pc_copy', 80, 24, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'COPY', w / 2, h / 2, h * 0.7, { col: '#fff' }); });
  k.label(cl, 0.05, 0.015, 0.09, 0.0285, 0.05, { rot: [-HP, 0, 0] });
  k.push(0.09, 0.014, -0.06, [-HP, 0, 0]);
  k.parts.lamp = P.pilotLamp(k, 0, 0, 0, 0.007, 'red', { name: 'jamLamp', bezel: 'black', ov: { emissiveIntensity: 0.3 } });
  k.pop();
  k.pop();
  const br = k.reg('pc_brand', 300, 50, (c, w, h) => { c.clearRect(0, 0, w, h); txt(c, 'R.O.O.M. XEROGRAPH 9000', w / 2, h / 2, h * 0.45, { col: '#4a4436', maxW: w * 0.95 }); });
  k.label(br, 0.36, 0.06, -0.3, 0.885, D / 2 + 0.0006);
  k.push(W / 2, 0.75, 0, [0, HP, 0]);
  P.slotVent(k, 0, 0, 0, 0.3, 0.2, 7, { mo: BEIGE, slot: 'plastic' });
  k.pop();
  P.cable(k, [[0.3, 0.2, -D / 2], [0.32, 0.05, -D / 2 - 0.05], [0.4, 0.008, -D / 2 - 0.3]], 0.006, { tint: 0x161616 });
  P.scuffs(k, 0, 0.3, D / 2 + 0.0004, W * 0.9, 0.4, { col: '40,34,24', alpha: 0.25 });
  k.collide(cbox(W, 0.96, D, 0, 0.48, 0));
  k.parts.lid = lid;
  k.anchors.output = V3(-W / 2 - 0.12, 0.66, 0);
  k.anchors.platen = V3(-0.1, 0.953, 0.02);
  k.params.lidOpenSign = -1;
  return k.done({ mass: 140, material: 'plastic' });
}

// ---------------------------------------------------------------------------
// SERVER RACK: 42U frame, perforated back, UPS (screens.ups), servers, switches, tape library
// (screens.tape), patch cables; parts.leds = 10 blink groups (one glow draw)
// ---------------------------------------------------------------------------
export function b_server_rack(o) {
  void o;
  const k = new DKit('server_rack', { wear: { chip: 0.08, rust: 0.05, grime: 0.4, dust: 0.55 }, ao: { res: 56 } });
  const A = k.atlas(512, 1024);
  const W = 0.6, H = 2.0, D = 1.0, U = 0.0445;
  const FR = { tint: 0x1a1b1d }, FACE = { ...FIN.black, tint: 0x2c2e31, rough: 1.1 };
  for (const sx of [-1, 1]) {
    k.box('paint', 0.02, H, D, sx * (W / 2 - 0.01), H / 2, 0, { ...FR, r: 0.003, div: 0.4, dent: 0.0006 });
    for (const sz of [-1, 1]) k.box('metal', 0.04, H - 0.12, 0.03, sx * (W / 2 - 0.04), H / 2, sz * (D / 2 - 0.03), { ...FIN.black, r: 0.002 });
    // cage-nut holes up the front rails
    k.box('#050505', 0.008, H - 0.2, 0.001, sx * (W / 2 - 0.035), H / 2, D / 2 - 0.0145, { r: 0 });
  }
  k.box('paint', W, 0.04, D, 0, H - 0.02, 0, { ...FR, r: 0.004 });
  k.box('paint', W, 0.08, D, 0, 0.04, 0, { ...FR, r: 0.004 });
  k.box('paint', W - 0.04, H - 0.12, 0.01, 0, H / 2, -D / 2 + 0.005, { ...FR, r: 0 });
  const perf = k.reg('sr_perf', 128, 128, (c, w, h) => drawPerforation(c, w, h, 8, 2.5, '#1d1e20', '#030303'));
  for (let i = 0; i < 6; i++) k.label(perf, 0.4, 0.22, 0, 0.3 + i * 0.27, -D / 2 - 0.0006, { rot: [0, PI, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('#111:r', 0.02, 0.02, sx * (W / 2 - 0.05), -0.004, sz * (D / 2 - 0.08), { seg: 10 });
  // units from the bottom
  const ledCols = [0x30ff60, 0x30ff60, 0x30ff60, 0x30ff60, 0xffa020, 0xffa020, 0x30ff60, 0x3a8aff, 0xff2a1a, 0x30ff60];
  const ledGeo = ledCols.map(() => new Geo());
  let li = 0;
  const led = (x, y, z) => { ledGeo[li % ledGeo.length].append(boxGeo(0.004, 0.003, 0.002, { r: 0 }).translate(x, y, z)); li++; };
  let y = 0.08;
  const fz = D / 2 - 0.035;
  const unit = (n, kind) => {
    const h = n * U - 0.002, cy = y + n * U / 2;
    k.box('metal', W - 0.06, h, 0.02, 0, cy, fz, { ...(kind === 'blank' ? { ...FIN.black, rough: 1.3 } : FACE), r: 0.001 });
    for (const sx of [-1, 1]) P.screw(k, sx * (W / 2 - 0.045), cy, fz + 0.01, { r: 0.0035, kind: 'phillips', fin: FIN.zinc });
    if (kind === 'ups') {
      k.box('#1d1e20:p', W - 0.1, h - 0.03, 0.006, 0, cy, fz + 0.012, { r: 0.004 });
      k.screen('ups', 0.08, 0.03, 0.15, cy + 0.03, fz + 0.016, { style: 'lcd', text: 'UPS 87%', bulge: 0, aspect: 0.08 / 0.03 });
      k.push(-0.1, cy, fz + 0.015);
      P.slotVent(k, 0, 0, 0, 0.24, h - 0.06, 8, { mo: { tint: 0x2a2b2e }, slot: 'paint' });
      k.pop();
      for (let i = 0; i < 4; i++) led(0.12 + i * 0.012, cy - 0.02, fz + 0.016);
    } else if (kind === 'server') {
      for (let b = 0; b < 6; b++) {
        k.box('#4a4c50:s', 0.06, h - 0.01, 0.006, -0.2 + b * 0.065, cy, fz + 0.013, { r: 0.002 });
        k.box('#202124:p', 0.04, 0.004, 0.002, -0.2 + b * 0.065, cy - h / 2 + 0.012, fz + 0.0165, { r: 0 });
        led(-0.22 + b * 0.065, cy + h / 2 - 0.01, fz + 0.017);
      }
      k.box('#c4c7ca:c', 0.02, h - 0.01, 0.01, W / 2 - 0.06, cy, fz + 0.016, { r: 0.002 });
      led(W / 2 - 0.09, cy, fz + 0.012);
    } else if (kind === 'switch') {
      for (let p = 0; p < 16; p++) { k.box('#060606', 0.012, 0.01, 0.004, -0.2 + p * 0.016, cy, fz + 0.011, { r: 0 }); led(-0.2 + p * 0.016, cy + 0.012, fz + 0.011); }
    } else if (kind === 'tape') {
      k.box('#1d1e20:p', 0.3, h - 0.03, 0.006, -0.05, cy, fz + 0.012, { r: 0.004 });
      k.box('#060606', 0.18, 0.012, 0.006, -0.05, cy + 0.01, fz + 0.016, { r: 0 });
      k.screen('tape', 0.07, 0.025, 0.18, cy + 0.02, fz + 0.011, { style: 'lcd', text: 'TAPE 3', bulge: 0, aspect: 0.07 / 0.025 });
      led(0.18, cy - 0.02, fz + 0.012);
    } else {
      for (let i = 0; i < Math.max(1, n); i++) k.box('#08080a', W - 0.14, 0.003, 0.001, 0, y + (i + 0.5) * U, fz + 0.0105, { r: 0 });
    }
    y += n * U;
  };
  unit(4, 'ups'); unit(1, 'blank');
  for (let i = 0; i < 3; i++) unit(2, 'server');
  unit(3, 'tape'); unit(1, 'blank');
  for (let i = 0; i < 3; i++) unit(1, 'switch');
  unit(2, 'blank');
  for (let i = 0; i < 4; i++) unit(2, 'server');
  unit(1, 'switch'); unit(2, 'blank');
  for (let i = 0; i < 3; i++) unit(2, 'server');
  while (y < H - 0.1) unit(1, 'blank');
  // patch cables from the switches to the side management arm
  const cols = [0x2a5fc0, 0xd9a92a, 0xc8231b, 0x2a9a3a, 0xdddddd];
  for (let i = 0; i < 10; i++) {
    const sy = 0.08 + (4 + 1 + 6 + 3 + 1) * U + (i % 3) * U + U / 2, sx = -0.2 + ((i * 3) % 16) * 0.016;
    P.cable(k, [[sx, sy, fz + 0.012], [sx, sy - 0.03, fz + 0.06], [W / 2 - 0.07, sy - 0.06 - i * 0.004, fz + 0.06], [W / 2 - 0.05, sy - 0.3, fz + 0.03]], 0.0025, { tint: cols[i % cols.length], gloss: true, radial: 5, n: 14 });
  }
  const leds = k.glow('leds', ledGeo.map((g, i) => ({ geo: g, color: ledCols[i], intensity: 2.2 })));
  const lab = k.reg('sr_label', 300, 40, (c, w, h) => { c.fillStyle = '#e8e2cc'; c.fillRect(0, 0, w, h); txt(c, 'CLONE BACKUP ARRAY — DO NOT UNPLUG', w / 2, h / 2, h * 0.36, { col: '#a01a14', f: 'mono', maxW: w * 0.95 }); grime(c, w, h, 0.5, 5, { corner: 0.12 }); });
  k.label(lab, 0.4, 0.053, 0, H - 0.07, D / 2 + 0.0006);
  k.collide(cbox(W, H, D, 0, H / 2, 0));
  k.parts.leds = leds;
  return k.done({ mass: 420, material: 'metal' });
}

// ---------------------------------------------------------------------------
// LOCKERS: louvred steel lockers, doors hinged on the left edge (negative rotation.y opens).
// locker_bank: parts.doors[i] are bones of ONE skinned door mesh per material, so the whole bank's
// doors cost two draws; screens.label_i (name cards) ride on the door bones.
// ---------------------------------------------------------------------------
const LW = 0.45, LH = 1.9, LD = 0.5, LT = 0.012;
function hazmatSuit(k, x, y, z, s = 1) {
  const YEL = { tint: 0xe2b81c, rough: 0.7 };
  k.push(x, y, z, null, s);
  k.tube('#c4c7ca:c', [[-0.16, -0.08, 0], [0, 0, 0], [0.16, -0.08, 0]], 0.003, { round: 0.03, radial: 5 });
  k.tor('#c4c7ca:c', 0.02, 0.003, 0, 0.02, 0, { arc: PI * 1.3, rs: 4, ts: 10 });
  k.sph('plastic', 0.13, 0, 0.0, -0.06, { ...YEL, ws: 14, hs: 10, s: [1, 0.85, 0.75] });
  k.sph('#26323a:g', 0.1, 0, 0.0, 0.0, { ws: 12, hs: 8, p0: -0.7, pl: 1.4, t0: 0.9, tl: 1.0, s: [1, 0.7, 0.8] });
  k.lathe('plastic', [[0.05, -0.62], [0.14, -0.6], [0.175, -0.48], [0.18, -0.3], [0.165, -0.14], [0.11, -0.08], [0.05, -0.06]], 0, 0, 0, { ...YEL, seg: 14, s: [1, 1, 0.6], rings: false });
  k.box('#1b1b1b:r', 0.355, 0.04, 0.22, 0, -0.5, 0, { r: 0.015 });
  for (const sx of [-1, 1]) {
    k.tube('plastic', [[sx * 0.14, -0.12, 0], [sx * 0.17, -0.3, 0.01], [sx * 0.17, -0.5, 0.02], [sx * 0.165, -0.6, 0.02]], 0.045, { ...YEL, radial: 9 });
    k.cyl('#1b1b1b:r', 0.038, 0.06, sx * 0.165, -0.64, 0.02, { seg: 10, bev: 0.008 });
    k.cyl('#a4a4a4:m', 0.048, 0.02, sx * 0.17, -0.54, 0.02, { seg: 12 });
    k.tube('plastic', [[sx * 0.08, -0.58, 0], [sx * 0.09, -0.85, 0.01], [sx * 0.09, -1.08, 0.0]], 0.07, { ...YEL, radial: 9 });
    k.cyl('#1b1b1b:r', 0.06, 0.12, sx * 0.09, -1.14, 0.0, { seg: 12, bev: 0.01 });
    k.cyl('#a4a4a4:m', 0.072, 0.025, sx * 0.09, -1.0, 0.0, { seg: 12 });
  }
  k.pop();
}
function lockerShell(k, x0, idx, o, body, inner) {
  k.push(x0, 0, 0);
  k.box('#141416:p', LW - 0.02, 0.08, LD - 0.04, 0, 0.04, -0.01, { r: 0.003 });
  for (const sx of [-1, 1]) k.box('paint', LT, LH - 0.08, LD, sx * (LW / 2 - LT / 2), 0.08 + (LH - 0.08) / 2, 0, { ...body, r: 0.002, div: 0.4, dent: 0.0008 });
  k.box('paint', LW, LT, LD, 0, LH - LT / 2, 0, { ...body, r: 0.003 });
  k.box('paint', LW - 2 * LT, LT, LD - LT, 0, 0.08 + LT / 2, 0, { ...inner, r: 0 });
  k.box('paint', LW - 2 * LT, LH - 0.08, LT, 0, 0.08 + (LH - 0.08) / 2, -LD / 2 + LT / 2, { ...inner, r: 0 });
  k.box('paint', LW, 0.02, 0.01, 0, LH - 0.01, LD / 2 - 0.005, { ...body, r: 0.002 });
  k.box('paint', LW, 0.02, 0.01, 0, 0.09, LD / 2 - 0.005, { ...body, r: 0.002 });
  // vents in the top, shelf, coat hook
  for (let i = 0; i < 4; i++) k.box('#060606', 0.24, 0.001, 0.008, 0, LH + 0.0002, -0.12 + i * 0.03, { r: 0 });
  k.box('paint', LW - 2 * LT, 0.012, LD - 0.06, 0, 1.6, -0.02, { ...inner, r: 0 });
  k.box('paint', LW - 0.06, 0.02, 0.012, 0, 1.585, LD / 2 - 0.04, { ...inner, r: 0.002 });
  k.tube('#c4c7ca:c', [[0, 1.594, -0.03], [0, 1.57, -0.03], [0, 1.555, 0.0], [0, 1.565, 0.02]], 0.004, { radial: 6 });
  if (o.suit !== false && (idx + (o.suitOffset || 0)) % (o.suitEvery || 1) === 0) hazmatSuit(k, 0, 1.56, -0.02, 0.92);
  for (const y of [0.3, 1.0, 1.7]) P.hingeHalf(k, -LW / 2 + 0.006, y, LD / 2 + 0.006, 0.07, { part: 0, r: 0.0055, knuckles: 3, slot: '#9a9ea2:m' });
  P.scuffs(k, 0, 0.1, LD / 2 + 0.0004, LW * 0.9, 0.1, { col: '30,26,20', alpha: 0.4 });
  k.pop();
}
// door content in the door's local frame (hinge at origin, leaf extends +X); `to` = parent for the label screen
function lockerDoor(k, idx, o, body, A, to) {
  const DW = LW - 0.016, DH = LH - 0.13, dy0 = 0.105, cx = DW / 2;
  const ds = rrShape(DW, DH, 0.006, cx, dy0 + DH / 2);
  for (const ly of [dy0 + DH - 0.24, dy0 + 0.12]) for (let i = 0; i < 6; i++) ds.holes.push(rrHole(0.22, 0.012, 0.005, cx, ly + (i - 2.5) * 0.024));
  k.ext('paint', ds, 0.016, 0, 0, 0, { ...body, bev: 0.002, bevSeg: 1, curveSeg: 2 });
  for (const ly of [dy0 + DH - 0.24, dy0 + 0.12]) {
    for (let i = 0; i < 6; i++) k.box('paint', 0.22, 0.016, 0.003, cx, ly + (i - 2.5) * 0.024 + 0.002, 0.009, { ...body, rot: [-0.9, 0, 0], r: 0, edge: 1.4 });
    k.box('#0b0b0b', 0.23, 0.16, 0.002, cx, ly, 0.002, { r: 0 });
  }
  k.box('paint', 0.05, DH - 0.3, 0.02, cx, dy0 + DH / 2, -0.008, { ...body, r: 0.002 });
  k.box('paint', 0.006, DH - 0.02, 0.02, DW - 0.003, dy0 + DH / 2, -0.004, { ...body, r: 0 });
  const photo = k.reg('lk_photo', 64, 80, (c, w, h) => { c.fillStyle = '#eee'; c.fillRect(0, 0, w, h); const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#7a9ab0'); g.addColorStop(1, '#4a5a3a'); c.fillStyle = g; c.fillRect(4, 4, w - 8, h - 20); drawClone(c, w / 2, h * 0.55, w * 0.6, { wave: true }); txt(c, 'MOM?', w / 2, h - 8, 10, { col: '#333', f: 'mono' }); c.fillStyle = 'rgba(240,230,170,0.7)'; c.fillRect(w * 0.3, 0, w * 0.4, 8); });
  k.label(photo, 0.08, 0.1, cx + 0.07, 1.3, -0.0186, { rot: [0, PI, -0.08] });
  // name card holder + card (screen) + number plate
  k.ext('#c4c7ca:c', frameShape(0.12, 0.045, 0.004, 0.104, 0.032, 0.002), 0.004, cx, 1.56, 0.016, { curveSeg: 2 });
  const label = k.screen(`label_${idx}`, 0.104, 0.032, cx, 1.56, 0.0176, { style: 'card', text: o.labelText ?? 'EMPLOYEE', glow: 0.08, rough: 0.6, to });
  const num = String((o.start ?? 1) + idx).padStart(3, '0');
  const np = k.reg('lk_num' + num, 64, 36, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f0d488'); g.addColorStop(1, '#9a7a32'); c.fillStyle = g; rrect(c, 0, 0, w, h, h / 2); c.fill(); txt(c, num, w / 2, h / 2 + 1, h * 0.62, { col: '#2a1a04', f: 'bold' }); }, 'm');
  k.label(np, 0.06, 0.034, cx, 1.66, 0.0168);
  for (const sx of [-1, 1]) P.screw(k, cx + sx * 0.026, 1.66, 0.0168, { r: 0.002, kind: 'button', fin: FIN.brass });
  // handle: recessed cup + lift lever + padlock hasp
  const hx = DW - 0.06;
  k.box('#c4c7ca:c', 0.05, 0.13, 0.008, hx, 1.0, 0.018, { r: 0.004 });
  k.box('#0e0e0e', 0.034, 0.08, 0.004, hx, 1.0, 0.0222, { r: 0 });
  k.box('#c4c7ca:c', 0.024, 0.06, 0.012, hx, 1.0, 0.026, { r: 0.004 });
  k.box('#c4c7ca:c', 0.012, 0.03, 0.004, hx, 0.91, 0.022, { r: 0.002 });
  k.cyl('#7a7e80:m', 0.004, 0.012, hx, 0.91, 0.026, { axis: 'z', seg: 8 });
  for (const y of [0.3, 1.0, 1.7]) P.hingeHalf(k, 0, y, 0.004, 0.07, { part: 1, r: 0.0055, knuckles: 3, slot: '#9a9ea2:m' });
  P.handprint(k, hx - 0.02, 1.06, 0.0162, 0.1, { alpha: 0.18 });
  void A;
  return label;
}
const lockerBody = (o) => ({ body: { tint: o.color ?? 0x5f7a72 }, inner: { tint: o.inner ?? 0x3e4a46, chip: 0.05 } });
export function b_locker(o) {
  const k = new DKit('locker', { wear: { chip: 0.2, rust: 0.12, grime: 0.45, dust: 0.45 } });
  const A = k.atlas(512, 1024);
  const { body, inner } = lockerBody(o);
  lockerShell(k, 0, 0, o, body, inner);
  const door = k.grp(-LW / 2 + 0.008, 0, LD / 2 + 0.002, { name: 'door_0' });
  let label = null;
  k.inside(door, () => { label = lockerDoor(k, 0, o, body, A); });
  k.parts.door = door;
  k.screens.label = k.screens.label_0; delete k.screens.label_0;
  void label;
  k.collide(cbox(0.45, 1.9, 0.5, 0, 0.95, 0));
  k.params.doorOpenSign = -1;
  k.params.doorCollider = cbox(0.434, 1.77, 0.018, 0.217, 0.99, 0.01);
  k.anchors.inside = V3(0, 0.6, 0);
  k.anchors.shelf = V3(0, 1.61, -0.02);
  return k.done({ mass: 55, material: 'metal' });
}
export function b_locker_bank(o) {
  const n = Math.max(1, Math.min(12, o.count ?? 4));
  const k = new DKit('locker_bank', { wear: { chip: 0.2, rust: 0.12, grime: 0.45, dust: 0.45 }, ao: { res: Math.min(96, 40 + n * 6) } });
  const A = k.atlas(1024, 1024);
  const { body, inner } = lockerBody(o);
  const oo = { suitEvery: 2, ...o };
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * LW);
  xs.forEach((x, i) => lockerShell(k, x, i, oo, body, inner));
  k.parts.doors = k.bones('doors', xs.map((x, i) => [x - LW / 2 + 0.008, 0, LD / 2 + 0.002, null, `door_${i}`]), (i, bone) => lockerDoor(k, i, oo, body, A, bone));
  k.box('paint', n * LW + 0.02, 0.03, 0.52, 0, 1.915, 0, { ...body, r: 0.005 });
  k.collide(cbox(n * LW, 1.93, 0.5, 0, 0.965, 0));
  k.params.count = n;
  k.params.lockerWidth = LW;
  k.params.doorOpenSign = -1;
  k.params.doorCollider = cbox(0.434, 1.77, 0.018, 0.217, 0.99, 0.01);
  return k.done({ mass: 55 * n, material: 'metal' });
}
