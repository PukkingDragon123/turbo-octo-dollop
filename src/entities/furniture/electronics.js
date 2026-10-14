// 1990s office electronics: CRT monitor, mini-tower PC, keyboard, desk phone, laser printer,
// microwave, wood-cabinet CRT TV, clock radio, boombox.
import * as THREE from 'three';
import { def, Geo, boxGeo, cylGeo, latheGeo, tubeGeo, extrudeGeo, roundPath, quadGeo, CB, CC, CS, CP, CBbetween, V, toV, PI, TAU, HP, clamp, lerp } from './core.js';
import { matFor, tint } from './mats.js';
import { rUV } from './atlas.js';
import { glyphUV } from './labels.js';
import { screw, glide } from './parts.js';

// rounded-rectangle THREE.Shape centred on (cx, cy)
export function rrShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
export function rrPath(w, h, r, cx = 0, cy = 0) {
  const p = new THREE.Path();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  p.moveTo(x0 + r, y0); p.lineTo(x0 + w - r, y0); p.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  p.lineTo(x0 + w, y0 + h - r); p.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  p.lineTo(x0 + r, y0 + h); p.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}

// curved CRT face (sphere cap), UVs 0..1 for screen textures
function crtScreenGeo(w, h, R, nx = 12, ny = 10) {
  const g = new Geo();
  const z0 = Math.sqrt(R * R - (w / 2) ** 2 - (h / 2) ** 2);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = (i / nx - 0.5) * w, y = (j / ny - 0.5) * h;
    const z = Math.sqrt(R * R - x * x - y * y) - z0;
    const n = V(x, y, z + z0).normalize();
    g.v(x, y, z, n.x, n.y, n.z, i / nx, j / ny, 0);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; g.quad(a, a + 1, a + nx + 2, a + nx + 1); }
  return g;
}

// rounded box tapered towards -Z (CRT housings): back face scaled by (sx, sy), bottom kept flat
function taperBox(w, h, d, sx, sy, r = 0.012, o = {}) {
  const g = boxGeo(w, h, d, { r, seg: 2, wear: o.wear ?? 0.01 });
  for (let i = 0; i < g.count; i++) {
    const t = clamp((d / 2 - g.p[i * 3 + 2]) / d, 0, 1);
    g.p[i * 3] *= lerp(1, sx, t);
    g.p[i * 3 + 1] = -h / 2 + (g.p[i * 3 + 1] + h / 2) * lerp(1, sy, t);
  }
  return g.computeNormals(false);
}

// ===========================================================================
// 14" CRT monitor (beige): extruded bezel with a real screen opening, curved glass, tapered tube
// housing with vents, tilt/swivel base, controls, badge.
// ===========================================================================
def('crt_monitor', {
  variants: 3,
  mats: (o, v) => ({ shell: tint('plastic_beige', o.color ?? [0xd2c7a8, 0xc6bc9e, 0xd8d0b8][v]) }),
  build(b, gv) {
    const yb = 0.036, H = 0.345, W = 0.36, yc = yb + H / 2, fz = 0.18, bd = 0.056;
    // base + swivel
    b.lathe('shell', [[0, 0.002], [0.116, 0.002, 1], [0.124, 0.008], [0.12, 0.018], [0.09, 0.024], [0.06, 0.026], [0, 0.026]], 0, 0, 0.01, { seg: 28 });
    b.box('shell', 0.12, 0.03, 0.15, 0, 0.034, 0.01, { r: 0.01, seg: 2 });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; b.cyl('#222', 0.008, 0.003, Math.cos(a) * 0.1, 0.0015, 0.01 + Math.sin(a) * 0.1, { seg: 8 }); }
    // bezel with opening
    const sw = 0.29, sh = 0.222, sy = 0.247;
    const bezel = rrShape(W, H, 0.022, 0, yc);
    bezel.holes.push(rrPath(sw, sh, 0.014, 0, sy));
    b.ext('shell', bezel, bd, 0, 0, fz - bd / 2, { bevel: 0.006, bevelSeg: 2, curveSeg: 6 });
    // dark inner tunnel lip + glass
    const lip = rrShape(sw + 0.002, sh + 0.002, 0.014, 0, sy);
    lip.holes.push(rrPath(sw - 0.016, sh - 0.016, 0.01, 0, sy));
    b.ext('#2a2723', lip, 0.006, 0, 0, fz - 0.03, {});
    b.named('screen', 'crt_glass', crtScreenGeo(sw - 0.006, sh - 0.006, 0.9), 0, sy, fz - 0.03, {});
    // tube housing
    b.put('shell', taperBox(0.33, 0.3, 0.32, 0.6, 0.66, 0.022), 0, yb + 0.155, fz - bd - 0.16 + 0.005);
    b.decal('vents', 0.2, 0.09, 0, yb + 0.285, -0.05, { rot: [-(HP + 0.26), 0, 0] });
    for (const s of [-1, 1]) b.decal('vents', 0.16, 0.06, s * 0.142, 0.22, -0.04, { rot: [0, s * (HP + 0.16), 0] });
    b.decal('crt_badge', 0.1, 0.025, -0.07, yb + 0.047, fz + 0.0065, {});
    // controls: power rocker, LED, OSD buttons
    b.box('#c4b898', 0.028, 0.016, 0.01, 0.135, yb + 0.03, fz + 0.004, { r: 0.004 });
    b.box('#30ff60:e', 0.005, 0.005, 0.003, 0.108, yb + 0.03, fz + 0.0055, { r: 0.0012 });
    for (let i = 0; i < 4; i++) b.box('#c4b898', 0.012, 0.008, 0.006, 0.02 + i * 0.018, yb + 0.028, fz + 0.003, { r: 0.002 });
    b.decal('asset_tag', 0.06, 0.022, -0.12, yb + H - 0.012, fz + 0.0065, { slot: 'atlas' });
    // cable stub out of the back
    b.tube('#1c1c1c', [[0.03, 0.12, -0.17], [0.035, 0.09, -0.2], [0.045, 0.05, -0.215], [0.06, 0.03, -0.23]], 0.0055, { radial: 6, round: 0.02 });
    return {
      colliders: [CB(W, H, bd + 0.01, 0, yc, fz - bd / 2), CB(0.24, 0.24, 0.3, 0, yb + 0.13, -0.05), CC(0.124, 0.036, 0, 0.018, 0.01)],
      mass: 12, material: 'plastic', breakInto: ['glass_shard', 'electronics', 'plastic_scrap', 'wire'],
      anchors: { screen: [0, 0.247, 0.195], top: [0, yb + H, 0.05] },
    };
  },
});

// ===========================================================================
// Mini-tower PC (486 era): steel cover + plastic bezel, drive bays, buttons, LEDs, MHz display.
// ===========================================================================
def('computer_tower', {
  variants: 3,
  mats: (o, v) => ({ shell: tint('plastic_beige', [0xd2c7a8, 0xc8bfa2, 0xdad2bc][v]), body: tint('paint_beige', [0xcfc4a6, 0xc4b998, 0xd6ceb6][v]) }),
  build(b, gv) {
    const W = 0.19, H = 0.42, D = 0.43, y0 = 0.01;
    for (const [x, z] of [[-0.07, -0.18], [0.07, -0.18], [-0.07, 0.17], [0.07, 0.17]]) b.cyl('#1e1e1e', 0.012, y0, x, y0 / 2, z, { seg: 10, bevel: 0.002 });
    b.box('body', W, H - 0.004, D - 0.03, 0, y0 + (H - 0.004) / 2, -0.015, { r: 0.004, wear: 0.012 });
    b.box('shell', W + 0.004, H, 0.032, 0, y0 + H / 2, D / 2 - 0.016, { r: 0.012, seg: 2, wear: 0.01 });
    const fz = D / 2 + 0.0002;
    // 5.25" CD-ROM + blank
    b.box('#c9bd9d', 0.148, 0.042, 0.012, 0, y0 + 0.37, fz, { r: 0.003 });
    b.box('#4a4436', 0.13, 0.002, 0.002, 0, y0 + 0.366, fz + 0.006);
    b.box('#b7ab8c', 0.016, 0.007, 0.006, 0.052, y0 + 0.358, fz + 0.005, { r: 0.002 });
    b.box('#ffa020:e', 0.004, 0.003, 0.002, 0.03, y0 + 0.358, fz + 0.0062);
    b.cyl('#222', 0.003, 0.004, -0.058, y0 + 0.358, fz + 0.005, { axis: 'z', seg: 8 });
    b.decal('cdrom', 0.045, 0.011, -0.03, y0 + 0.378, fz + 0.0062, {});
    b.box('#d3c8aa', 0.148, 0.042, 0.01, 0, y0 + 0.322, fz, { r: 0.003 });
    // 3.5" floppy
    b.box('#c9bd9d', 0.102, 0.027, 0.012, 0, y0 + 0.276, fz, { r: 0.003 });
    b.box('#2a2620', 0.09, 0.0035, 0.002, 0, y0 + 0.28, fz + 0.006);
    b.box('#b7ab8c', 0.014, 0.006, 0.006, 0.034, y0 + 0.268, fz + 0.005, { r: 0.002 });
    b.box('#30ff60:e', 0.004, 0.003, 0.002, -0.04, y0 + 0.268, fz + 0.0062);
    b.decal('floppy_lbl', 0.03, 0.0075, -0.005, y0 + 0.268, fz + 0.0062, {});
    // power / reset / turbo, LEDs, MHz readout
    b.box('#bfb394', 0.03, 0.03, 0.012, -0.045, y0 + 0.2, fz + 0.002, { r: 0.005, seg: 2 });
    b.box('#bfb394', 0.012, 0.012, 0.008, 0.0, y0 + 0.2, fz + 0.001, { r: 0.003 });
    b.box('#bfb394', 0.024, 0.012, 0.008, 0.04, y0 + 0.2, fz + 0.001, { r: 0.003 });
    b.box('#30ff60:e', 0.005, 0.003, 0.003, -0.02, y0 + 0.235, fz + 0.001);
    b.box('#ffa020:e', 0.005, 0.003, 0.003, 0.0, y0 + 0.235, fz + 0.001);
    b.decal('mhz', 0.03, 0.019, 0.045, y0 + 0.237, fz + 0.0012, { slot: 'glow' });
    b.decal('vents', 0.15, 0.07, 0, y0 + 0.07, fz + 0.0012, {});
    b.decal('tower_badge', 0.1, 0.0375, 0, y0 + 0.14, fz + 0.0012, { slot: 'atlas' });
    // back panel: PSU fan, ports, slot covers, thumbscrews
    const bz = -D / 2 - 0.0006;
    b.decal('fan_grille', 0.08, 0.08, -0.04, y0 + 0.36, bz, { rot: [0, PI, 0] });
    b.decal('ports', 0.1, 0.15, 0.03, y0 + 0.17, bz, { rot: [0, PI, 0], slot: 'atlas' });
    for (let i = 0; i < 5; i++) b.box('#a8acae:m', 0.012, 0.11, 0.002, -0.06 + i * 0.016, y0 + 0.07, bz - 0.001, { r: 0.0008 });
    for (const [x, y] of [[-0.085, 0.4], [0.085, 0.4], [-0.085, 0.02], [0.085, 0.02]]) screw(b, '#b0b2b4', [x, y0 + y, -D / 2], [0, 0, -1], 0.0045, 'phillips');
    b.tube('#1c1c1c', [[-0.04, y0 + 0.3, -D / 2 - 0.01], [-0.04, y0 + 0.24, -D / 2 - 0.05], [-0.03, 0.01, -D / 2 - 0.1]], 0.004, { radial: 6, round: 0.03 });
    b.decal('asset_tag', 0.07, 0.026, W / 2 + 0.0006, y0 + 0.3, 0.1, { rot: [0, HP, 0], slot: 'atlas' });
    b.decal('vents', 0.12, 0.06, W / 2 + 0.0006, y0 + 0.08, -0.12, { rot: [0, HP, 0] });
    return { colliders: [CB(W + 0.004, H + y0, D, 0, (H + y0) / 2, 0)], mass: 10, material: 'metal', breakInto: ['electronics', 'electronics', 'metal_scrap', 'wire', 'screws'], anchors: { top: [0, H + y0, 0] } };
  },
});

// ===========================================================================
// 101-key keyboard: tapered case, sculpted rows of chamfered keycaps with printed legends.
// ===========================================================================
function keyLayout() {
  const R = [];
  const row = (y, x0, keys) => { let x = x0; for (const k of keys) { if (typeof k === 'number') { x += k; continue; } const [l, w = 1, h = 1] = Array.isArray(k) ? k : [k]; R.push({ l, x, y, w, h }); x += w; } };
  row(5.25, 0, ['Esc', 1, 'F1', 'F2', 'F3', 'F4', 0.5, 'F5', 'F6', 'F7', 'F8', 0.5, 'F9', 'F10', 'F11', 'F12', 0.25, 'PrtSc', 'ScrLk', 'Pause']);
  row(4, 0, ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['Bksp', 2], 0.25, 'Ins', 'Home', 'PgUp', 0.25, 'Num', '/', '*', '-']);
  row(3, 0, [['Tab', 1.5], 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', ['\\', 1.5], 0.25, 'Del', 'End', 'PgDn', 0.25, '7', '8', '9', ['+', 1, 2]]);
  row(2, 0, [['Caps', 1.75], 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", ['Enter', 2.25], 3.5, '4', '5', '6']);
  row(1, 0, [['Shift', 2.25], 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', ['Shift', 2.75], 1.25, '↑', 1.25, '1', '2', '3', ['Enter', 1, 2]]);
  row(0, 0, [['Ctrl', 1.5], 1, ['Alt', 1.5], ['', 7], ['Alt', 1.5], 1, ['Ctrl', 1.5], 0.25, '←', '↓', '→', 0.25, ['0', 2], '.']);
  return R;
}
const MOD_KEYS = new Set(['Esc', 'Bksp', 'Tab', 'Caps', 'Enter', 'Shift', 'Ctrl', 'Alt', 'Num', '+', 'Ins', 'Home', 'PgUp', 'Del', 'End', 'PgDn', 'PrtSc', 'ScrLk', 'Pause', '↑', '←', '↓', '→']);
const keyGeoCache = new Map();
// chamfered, slightly dished keycap (bottom w x d, height h)
function keycapGeo(w, d, h) {
  const k = `${w.toFixed(4)}|${d.toFixed(4)}|${h}`;
  if (keyGeoCache.has(k)) return keyGeoCache.get(k);
  const g = new Geo();
  const rings = [[w / 2, d / 2, 0], [w / 2 - 0.0016, d / 2 - 0.0022, h * 0.82], [w / 2 - 0.0026, d / 2 - 0.0032, h]];
  const corner = (rx, rz, y) => [[-rx, y, -rz], [rx, y, -rz], [rx, y, rz], [-rx, y, rz]];
  const base = [];
  for (const [rx, rz, y] of rings) { const ids = []; for (const p of corner(rx, rz, y)) ids.push(g.v(p[0], p[1], p[2], 0, 1, 0, p[0], p[2], 0)); base.push(ids); }
  for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) { const a = base[r][i], b2 = base[r][(i + 1) % 4], c = base[r + 1][(i + 1) % 4], d2 = base[r + 1][i]; g.quad(a, d2, c, b2); }
  const t = base[2];
  const mid = g.v(0, h - 0.0006, 0, 0, 1, 0, 0, 0, 0); // dish
  for (let i = 0; i < 4; i++) g.tri(t[i], mid, t[(i + 1) % 4]);
  g.computeNormals(false);
  for (const id of base[1]) g.e[id] = 0.8;
  keyGeoCache.set(k, g);
  return g;
}
def('keyboard', {
  variants: 2,
  mats: (o, v) => ({ shell: tint('plastic_beige', v ? 0xcfc6ab : 0xd7cfb6) }),
  build(b) {
    const u = 0.019, W = 0.46, D = 0.18, tilt = 0.06;
    const caseG = boxGeo(W, 0.03, D, { r: 0.008, seg: 2, wear: 0.01 });
    caseG.deform((p) => { if (p.y > 0) p.y += ((D / 2 - p.z) / D) * 0.012; }, false);
    b.put('shell', caseG, 0, 0.015 + 0.002, 0);
    b.box('#9e957e', W - 0.02, 0.003, D - 0.035, 0, 0.034 + 0.006, 0.006, { r: 0, rot: [-tilt * 0.6, 0, 0], wear: 0 });
    const keys = keyLayout();
    const x0 = -W / 2 + 0.012, z0 = D / 2 - 0.022;
    const plane = (x, rowY) => { const z = z0 - rowY * u; return [x, 0.038 + (z0 - z) * 0.066 + 0.0042, z]; };
    for (const k of keys) {
      const cx = x0 + (k.x + k.w / 2) * u, rowY = k.y + (k.h - 1) / 2;
      const [x, y, z] = plane(cx, rowY);
      // sculpted profile: each row slightly pitched
      const pitch = -tilt * 0.6 + (k.y - 2.5) * 0.045;
      b.put(MOD_KEYS.has(k.l) ? '#b8ae94' : '#d9d0b6', keycapGeo(k.w * u - 0.0034, k.h * u - 0.0034, 0.0085), x, y - 0.0042, z, { rot: [pitch, 0, 0] });
      if (k.l) {
        const lx = k.w > 1.2 ? x - (k.w * u) / 2 + 0.0075 : x;
        const gl = quadGeo(0.0092, 0.0092, glyphUV(k.l));
        b.put('decal', gl, lx, y + 0.0045, z, { rot: [-HP + pitch, 0, 0] });
      }
    }
    const [lx, ly, lz] = plane(x0 + 19.5 * u, 5.25);
    for (let i = 0; i < 3; i++) b.box(i === 1 ? '#30ff60:e' : '#1a3a1a', 0.004, 0.0015, 0.0025, lx + i * 0.016, ly - 0.004, lz, { r: 0, rot: [-tilt * 0.6, 0, 0], wear: 0 });
    b.decal('kb_badge', 0.05, 0.0125, x0 + 0.03, ly - 0.0032, lz, { rot: [-HP - tilt * 0.6, 0, 0] });
    // flip-out feet + cable
    for (const s of [-1, 1]) b.box('#bdb498', 0.03, 0.006, 0.012, s * 0.2, 0.004, -D / 2 + 0.014, { r: 0.002 });
    b.tube('#cfc6aa', roundPath([[0.0, 0.02, -D / 2 + 0.004], [0.0, 0.016, -D / 2 - 0.03], [0.02, 0.006, -D / 2 - 0.07], [0.05, 0.0035, -D / 2 - 0.1]], 0.02, 4), 0.0029, { radial: 6 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('#2a2a2a', 0.02, 0.002, 0.012, sx * 0.19, 0.001, sz * 0.06, { r: 0, wear: 0 });
    return { colliders: [CB(W, 0.042, D, 0, 0.021, 0)], mass: 1.1, material: 'plastic', breakInto: ['plastic_scrap', 'electronics', 'wire'] };
  },
});

// ===========================================================================
// Office desk phone: sloped body, handset in its cradle, coiled cord, keypad, feature keys, LCD.
// ===========================================================================
function coilAlong(pts, r, turns, per = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map(toV));
  const n = Math.ceil(turns * per);
  const fr = curve.computeFrenetFrames(n, false);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * TAU;
    out.push(curve.getPointAt(t).addScaledVector(fr.normals[i], Math.cos(a) * r).addScaledVector(fr.binormals[i], Math.sin(a) * r));
  }
  return out;
}
def('desk_phone', {
  variants: 2,
  mats: (o, v) => ({ shell: matFor(v ? 'plastic_grey' : 'plastic_beige') }),
  build(b) {
    const g = boxGeo(0.2, 0.065, 0.22, { r: 0.014, seg: 2, wear: 0.01 });
    g.deform((p) => { p.y -= ((p.z + 0.11) / 0.22) * 0.03 * clamp((p.y + 0.0325) / 0.065, 0, 1) ** 2; }, false);
    b.put('shell', g, 0, 0.0325, 0);
    const slope = Math.atan2(0.03, 0.22);
    const yAt = (z) => 0.065 - ((z + 0.11) / 0.22) * 0.03;
    // cradle + handset
    b.box('#2d2a26', 0.065, 0.006, 0.2, -0.058, yAt(0) + 0.001, 0, { r: 0.003, rot: [slope, 0, 0] });
    const hs = new Geo();
    hs.append(boxGeo(0.045, 0.026, 0.13, { r: 0.012, seg: 2 }));
    for (const s of [-1, 1]) { const ear = boxGeo(0.056, 0.036, 0.062, { r: 0.016, seg: 2 }); ear.translate(0, -0.005, s * 0.085); hs.append(ear); }
    b.put('shell', hs, -0.058, yAt(0) + 0.03, 0, { rot: [slope, 0, 0] });
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) b.cyl('#1a1a1a', 0.0018, 0.002, -0.058 + (i - 2) * 0.008, yAt(s * 0.085) + 0.03 + 0.0128, s * 0.085, { seg: 6 });
    // keypad
    const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    labels.forEach((l, i) => {
      const x = (i % 3) * 0.024, z = -0.045 + Math.floor(i / 3) * 0.024, y = yAt(z) + 0.002;
      b.put('#e2dac6', keycapGeo(0.018, 0.016, 0.006), x, y - 0.003, z, { rot: [slope, 0, 0] });
      b.put('decal', quadGeo(0.011, 0.011, glyphUV(l)), x, y + 0.0032, z, { rot: [-HP + slope, 0, 0] });
    });
    ['MUTE', 'HOLD', 'REDIAL', 'XFER', 'CONF', 'SPKR'].forEach((l, i) => {
      const x = 0.075, z = -0.075 + i * 0.024, y = yAt(z) + 0.002;
      b.put('#b8b0a0', keycapGeo(0.016, 0.014, 0.005), x, y - 0.0025, z, { rot: [slope, 0, 0] });
      b.put('decal', quadGeo(0.013, 0.013, glyphUV(l)), x, y + 0.0028, z, { rot: [-HP + slope, 0, 0] });
    });
    b.decal('phone_lcd', 0.07, 0.018, 0.024, yAt(-0.08) + 0.0006, -0.08, { rot: [-HP + slope, 0, 0], slot: 'glow' });
    b.box('#ff2010:e', 0.006, 0.003, 0.004, 0.075, yAt(-0.095) + 0.002, -0.097, { r: 0.001, rot: [slope, 0, 0] });
    b.tube('#d6ccb0', coilAlong([[-0.058, 0.035, 0.12], [-0.06, 0.016, 0.16], [-0.11, 0.014, 0.14], [-0.115, 0.017, 0.06], [-0.101, 0.024, 0.03]], 0.0055, 24, 6), 0.0017, { radial: 4, caps: false });
    b.tube('#2a2a2a', [[0.0, 0.01, -0.105], [0.0, 0.004, -0.13], [0.02, 0.003, -0.16]], 0.002, { radial: 4, round: 0.015 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('#1e1e1e', 0.007, 0.002, sx * 0.08, 0.001, sz * 0.09, { seg: 8 });
    return {
      colliders: [CB(0.2, 0.065, 0.22, 0, 0.0325, 0), CB(0.056, 0.04, 0.23, -0.058, yAt(0) + 0.03, 0, slope, 0, 0)],
      mass: 1.2, material: 'plastic', breakInto: ['plastic_scrap', 'electronics', 'wire'],
    };
  },
});

// ===========================================================================
// Laser printer (LaserJet 4 class): body, sloped top with output bin and a printed page, paper
// cassette, control panel with LCD & keys, vents.
// ===========================================================================
def('printer', {
  variants: 2,
  build(b, v) {
    const W = 0.42;
    for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) b.cyl('#1e1e1e', 0.012, 0.01, x, 0.005, z, { seg: 10 });
    b.box('shell', W, 0.22, 0.42, 0, 0.12, 0, { r: 0.02, seg: 2, wear: 0.012 });
    const top = boxGeo(W - 0.01, 0.09, 0.34, { r: 0.03, seg: 2, wear: 0.01 });
    top.deform((p) => { p.y -= ((p.z + 0.17) / 0.34) * 0.035 * clamp((p.y + 0.045) / 0.09, 0, 1) ** 2; }, false);
    b.put('shell', top, 0, 0.26, -0.035);
    b.box('#5e5a52', 0.27, 0.008, 0.15, -0.04, 0.287, 0.0, { r: 0.002, rot: [0.12, 0, 0] });
    // printed sheet curling out of the bin
    const sg = new Geo();
    for (let j = 0; j <= 6; j++) for (let i = 0; i <= 1; i++) { const x = (i - 0.5) * 0.216, y = (j / 6 - 0.5) * 0.16, z = Math.pow(j / 6, 2) * 0.02; sg.v(x, y, z, 0, 0, 1, i, j / 6, 0); }
    for (let j = 0; j < 6; j++) { const a = j * 2; sg.quad(a, a + 1, a + 3, a + 2); }
    sg.computeNormals(false);
    const R = rUV(v ? 'memo' : 'memo2');
    for (let i = 0; i < sg.count; i++) { sg.uv[i * 2] = lerp(R.u0, R.u1, sg.uv[i * 2]); sg.uv[i * 2 + 1] = lerp(R.v0, R.v1, sg.uv[i * 2 + 1]); }
    b.put('atlas', sg, -0.04, 0.293, 0.0, { rot: [-HP + 0.12, 0, 0], uvOff: false });
    b.put('paper', new Geo().append(sg).flip(), -0.04, 0.2925, 0.0, { rot: [-HP + 0.12, 0, 0] });
    // paper cassette
    b.box('#cfc4a6', 0.38, 0.06, 0.03, 0, 0.055, 0.205, { r: 0.008, seg: 2 });
    b.box('#2a2620', 0.1, 0.012, 0.004, 0, 0.068, 0.221, { r: 0.002 });
    b.decal('tray_lbl', 0.06, 0.015, 0.12, 0.045, 0.2206, {});
    // control panel
    b.box('#4a4842', 0.12, 0.004, 0.07, 0.13, 0.247, 0.17, { r: 0.002, rot: [0.25, 0, 0] });
    b.decal('printer_lcd', 0.06, 0.015, 0.11, 0.2498, 0.165, { rot: [-HP + 0.25, 0, 0], slot: 'glow' });
    for (let i = 0; i < 4; i++) b.box('#d8cfb4', 0.014, 0.006, 0.01, 0.095 + i * 0.022, 0.244, 0.19, { r: 0.002, rot: [0.25, 0, 0] });
    b.box('#30ff60:e', 0.004, 0.003, 0.004, 0.175, 0.252, 0.155, { r: 0.001, rot: [0.25, 0, 0] });
    b.box('#ffa020:e', 0.004, 0.003, 0.004, 0.175, 0.249, 0.168, { r: 0.001, rot: [0.25, 0, 0] });
    b.decal('printer_badge', 0.11, 0.0275, -0.12, 0.2, 0.2106, {});
    for (const s of [-1, 1]) b.decal('vents', 0.2, 0.08, s * (W / 2 + 0.0006), 0.15, -0.05, { rot: [0, s * HP, 0] });
    return { colliders: [CB(W, 0.31, 0.44, 0, 0.155, 0)], mass: 18, material: 'plastic', breakInto: ['electronics', 'plastic_scrap', 'plastic_scrap', 'paper', 'screws'], anchors: { top: [0, 0.31, -0.1] } };
  },
  mats: (o, v) => ({ shell: tint('plastic_beige', v ? 0xcbc2a6 : 0xd6ceb4) }),
});

// ===========================================================================
// Countertop microwave: cabinet, door part with mesh window & handle, control panel.
// ===========================================================================
def('microwave', {
  variants: 2,
  mats: (o, v) => ({ paint_white: o.color !== undefined ? tint('paint_white', o.color) : matFor(v ? 'paint_dark' : 'paint_white') }),
  build(b, v) {
    const W = 0.48, H = 0.28, D = 0.36, y0 = 0.012, body = 'paint_white';
    for (const [x, z] of [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.14], [0.2, 0.14]]) b.cyl('#1e1e1e', 0.012, y0, x, y0 / 2, z, { seg: 10 });
    b.box(body, W, H, D, 0, y0 + H / 2, 0, { r: 0.012, seg: 2, wear: 0.014 });
    b.box('#3d3a34', 0.33, 0.23, 0.003, -0.065, y0 + H / 2, D / 2 + 0.001, { r: 0 });
    const px = W / 2 - 0.065;
    b.box('#2a2a2c', 0.11, H - 0.03, 0.004, px, y0 + H / 2, D / 2 + 0.002, { r: 0.002 });
    b.decal('mw_display', 0.08, 0.027, px, y0 + H - 0.04, D / 2 + 0.0045, { slot: 'glow' });
    for (let i = 0; i < 12; i++) b.box('#d0d0cc', 0.02, 0.013, 0.005, px - 0.022 + (i % 3) * 0.022, y0 + H - 0.08 - Math.floor(i / 3) * 0.018, D / 2 + 0.005, { r: 0.002 });
    b.box('#d0d0cc', 0.064, 0.016, 0.005, px, y0 + 0.08, D / 2 + 0.005, { r: 0.003 });
    b.box('#a8302a', 0.064, 0.022, 0.005, px, y0 + 0.05, D / 2 + 0.005, { r: 0.003 });
    b.decal('mw_keys', 0.064, 0.128, px, y0 + H - 0.1 - 0.035, D / 2 + 0.0078, {});
    for (const s of [-1, 1]) b.decal('vents', 0.16, 0.06, s * (W / 2 + 0.0006), y0 + H - 0.06, -0.06, { rot: [0, s * HP, 0] });
    const hx = -W / 2 + 0.005, dz = D / 2 + 0.012;
    const p = b.part('door', hx, y0 + H / 2, dz, { axis: 'y', maxOpen: -1.9 });
    p.box(body, 0.35, H - 0.025, 0.022, hx + 0.175, y0 + H / 2, dz, { r: 0.008, seg: 2, wear: 0.012 });
    p.box('#15130f', 0.25, 0.17, 0.004, hx + 0.155, y0 + H / 2 + 0.005, dz + 0.0105, { r: 0.004 });
    p.decal('mwmesh', 0.25, 0.17, hx + 0.155, y0 + H / 2 + 0.005, dz + 0.0128, {});
    p.box('#bdbdb8:g', 0.02, 0.2, 0.024, hx + 0.32, y0 + H / 2, dz + 0.02, { r: 0.008, seg: 2 });
    return {
      colliders: [CB(W, H + y0, D + 0.03, 0, (H + y0) / 2, 0.012)],
      mass: 14, material: 'metal', breakInto: ['electronics', 'metal_scrap', 'glass_shard', 'wire'], anchors: { top: [0, H + y0, 0] },
    };
  },
});

// ===========================================================================
// Wood-cabinet CRT television with rabbit ears, knobs and speaker grille.
// ===========================================================================
def('tv_crt', {
  variants: 2,
  mats: (o, v) => ({ wood: matFor(v ? 'teak' : 'walnut') }),
  build(b) {
    const W = 0.62, H = 0.5, D = 0.34, y0 = 0.014;
    for (const [x, z] of [[-0.27, -0.13], [0.27, -0.13], [-0.27, 0.13], [0.27, 0.13]]) b.cyl('#1a1a1a', 0.016, y0, x, y0 / 2, z, { seg: 10, bevel: 0.003 });
    b.box('wood', W, H, D, 0, y0 + H / 2, 0, { r: 0.012, seg: 2, grain: 'x', wear: 0.016 });
    const front = rrShape(W - 0.03, H - 0.03, 0.012, 0, y0 + H / 2);
    const sx = -0.065, sy = y0 + 0.27, fz = D / 2 + 0.011;
    front.holes.push(rrPath(0.44, 0.33, 0.03, sx, sy));
    b.ext('#1b1a19', front, 0.02, 0, 0, D / 2 + 0.001, { bevel: 0.003, bevelSeg: 1 });
    b.named('screen', 'crt_glass', crtScreenGeo(0.43, 0.32, 1.1), sx, sy, fz - 0.012, {});
    b.put('plastic_black', taperBox(0.5, 0.4, 0.2, 0.55, 0.6, 0.03), 0, y0 + 0.24, -D / 2 - 0.1 + 0.002);
    b.decal('vents', 0.25, 0.1, 0, y0 + 0.38, -D / 2 - 0.15, { rot: [-(HP + 0.6), 0, 0] });
    const cx = W / 2 - 0.075;
    b.decal('tv_grille', 0.08, 0.16, cx, y0 + 0.16, fz + 0.0006, {});
    b.lathe('#8a8a86:m', [[0.024, 0], [0.024, 0.016], [0.02, 0.022], [0, 0.023]], cx, y0 + 0.41, fz, { rot: [HP, 0, 0], seg: 18 });
    b.box('#ddd', 0.003, 0.02, 0.003, cx, y0 + 0.42, fz + 0.024, { r: 0 });
    b.lathe('#8a8a86:m', [[0.017, 0], [0.017, 0.014], [0.014, 0.019], [0, 0.02]], cx, y0 + 0.335, fz, { rot: [HP, 0, 0], seg: 16 });
    b.box('#3a3a38', 0.04, 0.016, 0.01, cx, y0 + 0.27, fz + 0.004, { r: 0.003 });
    b.box('#ff2010:e', 0.004, 0.004, 0.003, cx + 0.03, y0 + 0.27, fz + 0.002, { r: 0.001 });
    b.decal('tv_badge', 0.12, 0.0225, sx, y0 + 0.065, fz + 0.0006, {});
    // rabbit ears
    b.sphere('plastic_black', 0.045, 0, y0 + H, -0.06, { ws: 14, hs: 6, scale: [1, 0.6, 1], thetaLen: HP });
    for (const s of [-1, 1]) {
      const a = [s * 0.012, y0 + H + 0.022, -0.06], c = [s * 0.2, y0 + H + 0.46, -0.13];
      b.cylBetween('#d8dadc:m', a, c, 0.0032, 0.0022, { seg: 6 });
      b.sphere('#d8dadc:m', 0.005, c[0], c[1], c[2], { ws: 6, hs: 4 });
    }
    return {
      colliders: [CB(W, H + y0, D + 0.02, 0, (H + y0) / 2, 0.01), CB(0.28, 0.24, 0.2, 0, y0 + 0.2, -D / 2 - 0.1)],
      mass: 24, material: 'plastic', breakInto: ['glass_shard', 'electronics', 'plank', 'wire', 'screws'],
      anchors: { screen: [sx, sy, fz + 0.02], top: [0, y0 + H, 0.05] },
    };
  },
});

// ===========================================================================
// Clock radio with red 7-segment LED display.
// ===========================================================================
def('clock_desk', {
  ao: false,
  build(b) {
    const g = boxGeo(0.16, 0.075, 0.09, { r: 0.014, seg: 2, wear: 0.008 });
    g.deform((p) => { if (p.z > 0) p.z -= ((p.y + 0.0375) / 0.075) * 0.018; }, false);
    b.put('plastic_black', g, 0, 0.0375 + 0.004, 0);
    for (const s of [-1, 1]) b.box('#151515', 0.03, 0.004, 0.07, s * 0.055, 0.002, 0, { r: 0.001 });
    const tilt = Math.atan2(0.018, 0.075);
    b.box('#1a0606:g', 0.13, 0.05, 0.002, 0, 0.042, 0.0455 - 0.009, { r: 0, rot: [-tilt, 0, 0] });
    b.decal('clock_display', 0.105, 0.039, 0, 0.042, 0.0468 - 0.009, { rot: [-tilt, 0, 0], slot: 'glow' });
    b.box('#38383a', 0.11, 0.01, 0.024, 0, 0.081, 0.008, { r: 0.004 });
    b.decal('clock_lbl', 0.05, 0.008, 0, 0.0862, 0.008, { rot: [-HP, 0, 0] });
    for (let i = 0; i < 4; i++) b.box('#2c2c2e', 0.014, 0.006, 0.01, -0.045 + i * 0.03, 0.079, -0.024, { r: 0.002 });
    b.tube('#151515', [[0.04, 0.02, -0.044], [0.045, 0.008, -0.07], [0.06, 0.003, -0.1]], 0.0022, { radial: 4, round: 0.015 });
    return { colliders: [CB(0.16, 0.08, 0.09, 0, 0.04, 0)], mass: 0.45, material: 'plastic', breakInto: ['electronics', 'plastic_scrap', 'wire', 'battery'] };
  },
});

// ===========================================================================
// Boombox: twin speakers with chrome rings, cassette deck, tuner, carry handle, telescopic aerial.
// ===========================================================================
def('radio_cassette', {
  variants: 2,
  build(b, v) {
    const W = 0.5, H = 0.24, D = 0.12, y0 = 0.008;
    b.box('plastic_black', W, H, D, 0, y0 + H / 2, 0, { r: 0.02, seg: 2, wear: 0.012 });
    b.box(v ? 'plastic_black' : '#b6b9be:m', W - 0.02, H - 0.05, 0.006, 0, y0 + H / 2 - 0.012, D / 2, { r: 0.005 });
    const fz = D / 2 + 0.003;
    for (const s of [-1, 1]) {
      b.cyl('#141414', 0.072, 0.004, s * 0.155, y0 + 0.105, fz, { axis: 'z', seg: 28 });
      b.decal('grille', 0.142, 0.142, s * 0.155, y0 + 0.105, fz + 0.0025, {});
      b.tube('#d8dadc:m', Array.from({ length: 29 }, (_, i) => { const a = (i / 28) * TAU; return [s * 0.155 + Math.cos(a) * 0.073, y0 + 0.105 + Math.sin(a) * 0.073, fz + 0.002]; }), 0.0035, { radial: 5, closed: true });
      b.cyl('#b6b9be:m', 0.012, 0.012, s * 0.215, y0 + 0.2, fz, { axis: 'z', seg: 12, bevel: 0.002 });
    }
    b.box('#262626', 0.13, 0.085, 0.006, 0, y0 + 0.095, fz, { r: 0.004 });
    b.decal('cassette', 0.1, 0.0625, 0, y0 + 0.097, fz + 0.0035, {});
    b.decal('tuner', 0.17, 0.035, 0, y0 + 0.19, fz + 0.0006, { slot: 'atlas' });
    b.decal('boombox_badge', 0.19, 0.0178, 0, y0 + 0.155, fz + 0.0006, {});
    for (let i = 0; i < 6; i++) b.box(i === 0 ? '#9a2a22' : '#2b2b2b', 0.019, 0.012, 0.03, -0.054 + i * 0.0215, y0 + H + 0.003, 0.03, { r: 0.003 });
    b.decal('deck_keys', 0.13, 0.016, 0.0, y0 + H - 0.005, D / 2 + 0.0006, {});
    b.tube('#d8dadc:m', roundPath([[-0.2, y0 + H - 0.005, 0], [-0.17, y0 + H + 0.07, 0], [0.17, y0 + H + 0.07, 0], [0.2, y0 + H - 0.005, 0]], 0.04, 5), 0.0075, { radial: 8 });
    for (const s of [-1, 1]) b.box('plastic_black', 0.035, 0.02, 0.03, s * 0.2, y0 + H + 0.005, 0, { r: 0.006 });
    b.cyl('#d8dadc:m', 0.003, 0.4, -0.02, y0 + H + 0.004, -0.045, { axis: 'x', seg: 6 });
    b.sphere('#d8dadc:m', 0.005, 0.18, y0 + H + 0.004, -0.045, { ws: 6, hs: 4 });
    for (const s of [-1, 1]) b.box('#151515', 0.06, y0, 0.08, s * 0.18, y0 / 2, 0, { r: 0.002 });
    return { colliders: [CB(W, H + y0, D, 0, (H + y0) / 2, 0), CB(0.38, 0.07, 0.03, 0, y0 + H + 0.035, 0)], mass: 3.2, material: 'plastic', breakInto: ['electronics', 'plastic_scrap', 'wire', 'battery', 'battery'] };
  },
});
