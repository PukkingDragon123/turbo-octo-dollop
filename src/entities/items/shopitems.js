// R.O.O.M. items — company-store gear and quest paperwork (game/economy.js sells them through the shop
// terminal; purchases materialise in the crusher's teleport chamber):
//   weapons   weapon_pipe (lead pipe), bat (nail bat), machete, nailgun
//   armor     hard_hat, padded_vest, riot_shield
//   upgrades  up_battery (tool battery), up_carry (carry harness), up_plasma (plasma tank), up_sanity (sanity dampener)
//   quest     case_file (manila dossier hidden in office rooms)
// Long tools are built along Z (handle at +Z) like the crowbar.
import * as THREE from 'three';
import { Kit, def, PI, TAU, rrectShape, sheetGeo } from './core.js';
import { mat, clear, glow, S } from './mats.js';
import { atlas, txt, rect, noise, wear, inkStamp, roomIcon, hazardStripes, MONO } from './paint.js';

const wood = () => mat({ name: 'shop_wood', color: 0xc8955a, rough: 0.55, det: 'roughwood', ns: 0.7 });
const tape = () => mat({ name: 'shop_tape', color: 0x1b1b1d, rough: 0.7, det: 'weave', ns: 0.6 });
const caseMat = () => mat({ name: 'shop_case', color: 0xffffff, rough: 0.5, det: 'powder', ns: 0.5 });

// a short stencilled plate for the upgrade modules
function plate(key, title, sub, col) {
  return atlas('shopplate_' + key, 256, 96, (c) => {
    rect(c, 0, 0, 256, 96, '#1b1d20');
    rect(c, 0, 0, 256, 14, col);
    hazardStripes(c, 0, 82, 256, 14, 14, col, '#141414');
    txt(c, title, 128, 40, { size: 30, color: '#f0eadc', fam: MONO, weight: '900', maxW: 236 });
    txt(c, sub, 128, 66, { size: 14, color: col, fam: MONO, weight: 'bold', maxW: 236 });
    roomIcon(c, 18, 40, 12, col);
    wear(c, 0, 0, 256, 96, 3, 1.2, { edge: true });
  }, { plain: '#1b1d20' });
}

// rugged module case: body, rubber corner bumpers, a carry handle and a status lamp (part 'led')
function moduleCase(k, w, h, d, bodyCol, A, ledCol) {
  const body = caseMat();
  k.rbox(w, h, d, 0.018, body, { p: [0, h / 2, 0], col: bodyCol });
  const rub = S.rubber();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.012, h - 0.012]) k.rbox(0.03, 0.03, 0.03, 0.008, rub, { p: [sx * (w / 2 - 0.006), y, sz * (d / 2 - 0.006)] });
  // carry handle
  const st = S.steelDark();
  for (const sx of [-1, 1]) k.cyl(0.007, 0.03, st, { p: [sx * w * 0.28, h + 0.015, 0], seg: 8 });
  k.cyl(0.011, w * 0.6, rub, { p: [0, h + 0.032, 0], r: [0, 0, PI / 2], seg: 10 });
  // label plate on the front
  const lab = mat({ name: 'shop_plate_' + A.key, map: A, rough: 0.6, det: 'powder', ns: 0.3 });
  k.box(w * 0.78, h * 0.34, 0.003, lab, { p: [0, h * 0.42, d / 2 + 0.0015], faces: { pz: A.R(0, 0, 256, 96) } });
  k.cyl(0.012, 0.01, glow({ name: 'shop_led', color: 0x101010, emissive: ledCol, ei: 2.2 }), { p: [w * 0.36, h * 0.8, d / 2 + 0.004], r: [PI / 2, 0, 0], seg: 12, part: 'led' });
  k.colBox([w, h + 0.04, d], [0, (h + 0.04) / 2, 0]);
}

// ============================================================================ weapon_pipe
// 24" galvanised water pipe with a threaded coupling on the business end and a black tape grip.
def('weapon_pipe', () => {
  const k = new Kit();
  const gal = mat({ name: 'shop_galv', color: 0xa9aeb0, metal: 1, rough: 0.48, det: 'cast', ns: 0.7 });
  const L = 0.62, R = 0.0165;
  k.push({ r: [PI / 2, 0, 0] });
  k.cyl(R, L, gal, { p: [0, 0, 0], seg: 16, bevel: 0.002 });
  k.cyl(R * 1.42, 0.058, S.steelDark(), { p: [0, -L / 2 + 0.03, 0], seg: 16, bevel: 0.004 });
  for (let i = 0; i < 4; i++) k.torus(R * 1.43, 0.0018, S.steelDark(), { p: [0, -L / 2 + 0.008 + i * 0.014, 0], r: [PI / 2, 0, 0], rseg: 4, tseg: 18 });
  k.cyl(R * 1.18, 0.17, tape(), { p: [0, L / 2 - 0.1, 0], seg: 16, bevel: 0.003 });
  for (let i = 0; i < 5; i++) k.torus(R * 1.19, 0.0013, tape(), { p: [0, L / 2 - 0.17 + i * 0.035, 0], r: [PI / 2, 0.3, 0], rseg: 4, tseg: 16 });
  k.pop();
  k.colCyl(R * 1.4, L, [0, 0, 0], [PI / 2, 0, 0]);
  return { kit: k, meta: { mass: 1.6, material: 'metal', hold: { grip: [0, 0, 0.24], rot: [0.42, 0.25, -1.2], off: [0, -0.02, 0] } } };
});

// ============================================================================ bat
// Ash baseball bat with a taped handle and a crown of bent nails driven through the barrel.
def('bat', () => {
  const k = new Kit();
  k.push({ r: [-PI / 2, 0, 0] }); // knob at +Z
  const prof = [[0, -0.42], [0.026, -0.418, 0.006], [0.024, -0.405], [0.0125, -0.39], [0.0135, -0.2], [0.022, -0.06], [0.031, 0.12], [0.0335, 0.3], [0.031, 0.39, 0.01], [0, 0.405]];
  k.lathe(prof, wood(), { seg: 22 });
  k.cyl(0.0146, 0.16, tape(), { p: [0, -0.31, 0], seg: 14, bevel: 0.002 });
  const nail = S.steel();
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, y = 0.16 + (i % 3) * 0.075;
    k.push({ p: [Math.cos(a) * 0.03, y, Math.sin(a) * 0.03], r: [0, -a, PI / 2 + 0.25 * ((i % 2) * 2 - 1)] });
    k.cyl(0.0019, 0.06, nail, { p: [0, 0.018, 0], seg: 5, bevel: 0 });
    k.cyl(0.0042, 0.002, nail, { p: [0, -0.011, 0], seg: 8, bevel: 0 });
    k.pop();
  }
  k.pop();
  k.colCap(0.03, 0.36, [0, 0, 0], [PI / 2, 0, 0]);
  return { kit: k, meta: { mass: 0.95, material: 'wood', hold: { grip: [0, 0, 0.33], rot: [0.42, 0.25, -1.2], off: [0, -0.02, 0] } } };
});

// ============================================================================ machete
// 18" blade with a clipped point, black grip scales with brass rivets and a lanyard hole.
def('machete', () => {
  const k = new Kit();
  const blade = mat({ name: 'shop_blade', color: 0xbfc4c8, metal: 1, rough: 0.28, det: 'brushed', ns: 0.4 });
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(0.43, 0.0); sh.quadraticCurveTo(0.475, 0.006, 0.47, 0.03);
  sh.quadraticCurveTo(0.43, 0.055, 0.36, 0.052); sh.lineTo(0.02, 0.04); sh.lineTo(0, 0.034); sh.lineTo(0, 0);
  k.push({ r: [0, PI / 2, 0], p: [0, 0, 0.08] }); // blade toward -Z
  k.extrude(sh, 0.0035, 0.0008, blade, { p: [0, -0.02, 0] });
  k.pop();
  const grip = mat({ name: 'shop_grip', color: 0x1e1f22, rough: 0.6, det: 'stipple', ns: 0.8 });
  k.rbox(0.022, 0.036, 0.135, 0.009, grip, { p: [0, -0.003, 0.15] });
  k.rbox(0.03, 0.05, 0.012, 0.004, S.steelDark(), { p: [0, 0, 0.083] });
  for (const z of [0.12, 0.17]) k.cyl(0.0045, 0.025, S.brass(), { p: [0, -0.003, z], r: [0, 0, PI / 2], seg: 10 });
  k.torus(0.006, 0.0018, S.steelDark(), { p: [0, -0.004, 0.212], r: [0, PI / 2, 0], rseg: 4, tseg: 12 });
  k.colBox([0.025, 0.06, 0.62], [0, 0, -0.08]);
  return { kit: k, meta: { mass: 0.7, material: 'metal', hold: { grip: [0, 0, 0.15], rot: [0.42, 0.25, -1.2], off: [0, -0.02, 0] } } };
});

// ============================================================================ nailgun
// Pneumatic framing nailer: yellow housing, black grip, angled nail strip, nose guard and an air fitting.
def('nailgun', () => {
  const A = atlas('nailgun', 256, 64, (c) => {
    rect(c, 0, 0, 256, 64, '#f2b718');
    txt(c, 'R.O.O.M. FRAMER 90', 128, 26, { size: 24, color: '#141414', fam: MONO, weight: '900', maxW: 230 });
    txt(c, 'NEVER POINT AT COWORKERS', 128, 50, { size: 12, color: '#141414', fam: MONO, weight: 'bold' });
  }, { plain: '#f2b718' });
  const k = new Kit();
  const shell = mat({ name: 'shop_nailer', map: A, rough: 0.42, det: 'stipple', ns: 0.5 });
  const black = S.plasticBlack();
  k.rbox(0.07, 0.11, 0.25, 0.03, shell, { p: [0, 0.05, -0.02], faces: { px: A.R(0, 0, 256, 64), nx: A.R(0, 0, 256, 64) } });
  k.cyl(0.05, 0.075, shell, { p: [0, 0.05, 0.11], r: [PI / 2, 0, 0], seg: 18 }); // piston cap
  k.rbox(0.042, 0.13, 0.05, 0.016, black, { p: [0, -0.05, 0.08], r: [0.32, 0, 0] }); // grip
  k.rbox(0.03, 0.03, 0.2, 0.01, S.steelDark(), { p: [0, -0.04, -0.06], r: [-0.18, 0, 0] }); // nail magazine
  for (let i = 0; i < 9; i++) k.cyl(0.0016, 0.05, S.steel(), { p: [0, -0.07 + i * 0.002, -0.14 + i * 0.019], r: [-0.18, 0, 0], seg: 4, bevel: 0 });
  k.rbox(0.026, 0.07, 0.03, 0.006, S.steelDark(), { p: [0, 0.0, -0.16] }); // nose
  k.cyl(0.008, 0.03, S.steel(), { p: [0, -0.045, -0.165], seg: 8 }); // contact tip
  k.cyl(0.009, 0.03, S.brass(), { p: [0, -0.12, 0.1], r: [0.32, 0, 0], seg: 10 }); // air fitting
  k.box(0.004, 0.02, 0.024, black, { p: [0, -0.02, 0.05] }); // trigger
  k.colBox([0.075, 0.22, 0.3], [0, 0, -0.02]);
  return { kit: k, meta: { mass: 1.9, material: 'plastic', hold: { grip: [0, -0.05, 0.08], rot: [0.06, 0, 0], off: [0, 0.02, 0.02] } } };
});

// ============================================================================ hard_hat
def('hard_hat', () => {
  const A = atlas('hard_hat', 256, 64, (c) => {
    rect(c, 0, 0, 256, 64, '#f3c418');
    roomIcon(c, 40, 32, 22, '#141414');
    txt(c, 'R.O.O.M.', 150, 34, { size: 34, color: '#141414', weight: '900' });
  }, { plain: '#f3c418' });
  const k = new Kit();
  const shell = mat({ name: 'shop_hat', color: 0xf3c418, rough: 0.35, det: 'gloss', ns: 0.3, cc: 0.4 });
  // moulded shell with thickness: inside down, brim underside, rolled lip, brim top, crown up
  k.lathe([[0, 0.142], [0.065, 0.137, 0.01], [0.105, 0.105, 0.01], [0.122, 0.045], [0.125, 0.022], [0.158, 0.018], [0.166, 0.019, 0.003], [0.165, 0.026, 0.003], [0.16, 0.027], [0.134, 0.032, 0.006], [0.132, 0.05, 0.01], [0.115, 0.11, 0.015], [0.07, 0.145, 0.02], [0, 0.152]], shell, { seg: 30, s: [1, 1, 1.18] });
  k.tube([[0, 0.05, 0.158], [0, 0.11, 0.139], [0, 0.146, 0.085], [0, 0.156, 0], [0, 0.146, -0.085], [0, 0.11, -0.139], [0, 0.05, -0.158]], 0.009, shell, { tseg: 40, rseg: 10 }); // ridge
  for (const sx of [-1, 1]) k.tube([[sx * 0.05, 0.12, 0.118], [sx * 0.058, 0.142, 0.03], [sx * 0.058, 0.142, -0.03], [sx * 0.05, 0.12, -0.118]], 0.005, shell, { tseg: 24, rseg: 8 });
  const lab = mat({ name: 'shop_hat_lab', map: A, rough: 0.4 });
  k.box(0.08, 0.026, 0.002, lab, { p: [0, 0.098, 0.146], r: [-0.55, 0, 0], faces: { pz: A.R(0, 0, 256, 64) } });
  // suspension webbing inside
  for (let i = 0; i < 3; i++) k.box(0.2, 0.004, 0.018, tape(), { p: [0, 0.07, 0], r: [0, i * PI / 3, 0] });
  k.lathe([[0.1, 0.035], [0.104, 0.036], [0.104, 0.06], [0.1, 0.061]], tape(), { seg: 28, s: [1, 1, 1.18], raw: true }); // headband
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.box(0.006, 0.03, 0.012, tape(), { p: [Math.cos(a) * 0.1, 0.06, Math.sin(a) * 0.118], r: [0, -a, 0] }); }
  k.colCyl(0.15, 0.13, [0, 0.075, 0]);
  return { kit: k, meta: { mass: 0.4, material: 'plastic' } };
});

// ============================================================================ padded_vest
// Quilted orange work vest: front panels with a zip, back panel, shoulder straps, reflective bands.
def('padded_vest', () => {
  const k = new Kit();
  const quilt = mat({ name: 'shop_vest', color: 0xe8661c, rough: 0.8, det: 'twill', ns: 0.8, sheen: 0.6 });
  const lining = mat({ name: 'shop_vest_in', color: 0x2a2a2c, rough: 0.9, det: 'weave', ns: 0.7 });
  const refl = mat({ name: 'shop_refl', color: 0xd8dcdc, rough: 0.25, metal: 0.4, det: 'film', ns: 0.4 });
  const W = 0.46, H = 0.56, D = 0.22, A = W / 2, B = D / 2, G = 0.13; // G: half-gap of the front opening (rad)
  // torso-wrapping quilted shell: elliptical tube open at the front, arm holes, V neck
  const th = (u) => G + u * (TAU - 2 * G);
  const top = (t) => { const c = Math.cos(t), f = Math.min(t, TAU - t); return H - 0.2 * Math.exp(-(c * c) / 0.05) - 0.13 * Math.exp(-(f * f) / 0.12) - 0.03 * Math.exp(-((t - PI) ** 2) / 0.2); };
  const at = (t, y, sc) => { const q = 1 + 0.07 * Math.abs(Math.sin((PI * y) / 0.093)) * (sc > 0.95 ? 1 : 0), w = 1 + (1 - y / H) * 0.05; return [Math.sin(t) * A * sc * q * w, y, Math.cos(t) * B * sc * q * w * 1.15]; };
  k.add(sheetGeo(56, 28, (u, v) => { const t = th(u); return at(t, v * top(t), 1); }), quilt, { smooth: true });
  k.add(sheetGeo(48, 12, (u, v) => { const t = th(u); return at(t, v * top(t), 0.9); }, { flip: true }), lining, {});
  // bindings round every edge (hide the gap between shell and lining), zip tapes
  const edge = (f, n) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
  k.tube(edge((u) => { const t = th(u); return at(t, top(t), 0.96); }, 64), 0.013, tape(), { tseg: 84, rseg: 6 });
  k.tube(edge((u) => at(th(u), 0.006, 0.96), 40), 0.013, tape(), { tseg: 56, rseg: 6 });
  for (const u of [0, 1]) k.tube(edge((v) => { const t = th(u); return at(t, 0.006 + v * (top(t) - 0.012), 0.96); }, 16), 0.012, tape(), { tseg: 24, rseg: 7 });
  for (const sx of [-1, 1]) k.box(0.006, H - 0.18, 0.004, S.steelDark(), { p: [sx * 0.012, (H - 0.18) / 2 + 0.02, B * 1.16] });
  // shoulder straps over the arm holes
  for (const sx of [-1, 1]) {
    const tf = sx > 0 ? 0.62 : TAU - 0.62, tb = sx > 0 ? PI - 0.55 : PI + 0.55, pf = at(tf, top(tf) - 0.02, 0.96), pb = at(tb, top(tb) - 0.02, 0.96);
    k.tube([pf, [(pf[0] + pb[0]) / 2, H + 0.025, pf[2] * 0.3], [(pf[0] + pb[0]) / 2, H + 0.025, pb[2] * 0.3], pb], 0.022, quilt, { tseg: 24, rseg: 10, s: [1, 1, 1] });
  }
  // reflective bands
  for (const y of [0.15, 0.29]) k.add(sheetGeo(64, 1, (u, v) => { const t = th(u); return at(t, y - 0.013 + v * 0.026, 1.075); }), refl, {});
  k.colBox([W + 0.02, H, D + 0.06], [0, H / 2, 0]);
  return { kit: k, meta: { mass: 1.4, material: 'fabric' } };
});

// ============================================================================ riot_shield
def('riot_shield', () => {
  const A = atlas('riot_shield', 256, 64, (c) => {
    rect(c, 0, 0, 256, 64, '#0d0f12');
    txt(c, 'R.O.O.M. SECURITY', 128, 34, { size: 30, color: '#f0eadc', fam: MONO, weight: '900', maxW: 240 });
  }, { plain: '#0d0f12' });
  const k = new Kit();
  const poly = clear({ name: 'shop_poly', tint: 0x0b1416, rough: 0.08 });
  const W = 0.5, H = 0.86;
  k.extrude(rrectShape(W, H, 0.05), 0.008, 0.002, poly, { p: [0, H / 2, 0] });
  const frame = S.plasticBlack();
  // rubber edge guard all round + top / bottom stiffener rails
  const rim = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU, c = Math.cos(a), sn = Math.sin(a), e = 0.12; rim.push([Math.sign(c) * Math.pow(Math.abs(c), e) * (W / 2), H / 2 + Math.sign(sn) * Math.pow(Math.abs(sn), e) * (H / 2), 0.004]); }
  k.tube(rim, 0.009, S.rubber(), { tseg: 112, rseg: 6, tension: 0.2 });
  k.rbox(W - 0.06, 0.02, 0.012, 0.005, frame, { p: [0, 0.03, -0.006] });
  k.rbox(W - 0.06, 0.02, 0.012, 0.005, frame, { p: [0, H - 0.03, -0.006] });
  const lab = mat({ name: 'shop_shield_lab', map: A, rough: 0.5 });
  k.box(0.34, 0.07, 0.002, lab, { p: [0, H * 0.62, 0.006], faces: { pz: A.R(0, 0, 256, 64) } });
  // grip and forearm strap at the back
  k.tube([[0, H * 0.45 - 0.085, -0.004], [0, H * 0.45 - 0.07, -0.04], [0, H * 0.45 + 0.07, -0.04], [0, H * 0.45 + 0.085, -0.004]], 0.013, frame, { tseg: 28, rseg: 10, tension: 0.2 });
  for (const sy of [-1, 1]) k.cyl(0.02, 0.008, frame, { p: [0, H * 0.45 + sy * 0.085, -0.008], r: [PI / 2, 0, 0], seg: 16 });
  k.rbox(0.16, 0.04, 0.01, 0.005, tape(), { p: [0, H * 0.62, -0.03] });
  k.colBox([W, H, 0.03], [0, H / 2, 0]);
  return { kit: k, meta: { mass: 2.2, material: 'plastic', hold: { grip: [0, H * 0.45, -0.035], rot: [0, 0.2, 0], off: [0.05, -0.12, 0.06] } } };
});

// ============================================================================ upgrade modules
def('up_battery', () => {
  const k = new Kit();
  const A = plate('battery', 'TOOL BATTERY', 'MULTI-CELL 48V • 2X RUNTIME', '#f2c418');
  moduleCase(k, 0.3, 0.16, 0.18, 0x2a2c30, A, 0x7dff8a);
  // three big cells on top with terminals
  for (let i = 0; i < 3; i++) {
    k.cyl(0.032, 0.05, mat({ name: 'shop_cell', color: 0xf2c418, rough: 0.35, det: 'gloss', ns: 0.3 }), { p: [-0.08 + i * 0.08, 0.185, 0.045], seg: 16 });
    k.cyl(0.01, 0.012, S.brass(), { p: [-0.08 + i * 0.08, 0.215, 0.045], seg: 10 });
  }
  return { kit: k, meta: { mass: 3.2, material: 'metal' } };
});

def('up_carry', () => {
  const k = new Kit();
  const A = plate('carry', 'CARRY HARNESS', 'HYDRAULIC LIFT ASSIST • +60%', '#ff7a2a');
  moduleCase(k, 0.34, 0.12, 0.2, 0x34383c, A, 0xffa040);
  // two hydraulic struts and webbing straps folded on top
  for (const sx of [-1, 1]) {
    k.cyl(0.014, 0.26, S.chrome(), { p: [sx * 0.12, 0.14, 0], r: [PI / 2, 0, 0], seg: 12 });
    k.cyl(0.02, 0.12, S.steelDark(), { p: [sx * 0.12, 0.14, 0.06], r: [PI / 2, 0, 0], seg: 12 });
  }
  for (const z of [-0.05, 0.05]) k.box(0.3, 0.008, 0.04, tape(), { p: [0, 0.128, z] });
  return { kit: k, meta: { mass: 3.6, material: 'metal' } };
});

def('up_plasma', () => {
  const k = new Kit();
  const A = plate('plasma', 'PLASMA TANK', 'CRUSHER PAYOUT +25%', '#e05aff');
  moduleCase(k, 0.26, 0.06, 0.26, 0x2a2c30, A, 0xe05aff);
  // glass cylinder of glowing plasma between steel caps (part 'plasma' pulses)
  k.cyl(0.075, 0.025, S.steelDark(), { p: [0, 0.075, 0], seg: 20 });
  k.cyl(0.058, 0.2, glow({ name: 'shop_plasma', color: 0x200028, emissive: 0xd050ff, ei: 2.4 }), { p: [0, 0.19, 0], seg: 20, part: 'plasma' });
  k.cyl(0.068, 0.21, clear({ name: 'shop_tank_glass', tint: 0x150818 }), { p: [0, 0.19, 0], seg: 20 });
  k.cyl(0.075, 0.025, S.steelDark(), { p: [0, 0.305, 0], seg: 20 });
  for (let i = 0; i < 4; i++) k.cyl(0.006, 0.23, S.steel(), { p: [Math.cos(i * PI / 2 + 0.78) * 0.074, 0.19, Math.sin(i * PI / 2 + 0.78) * 0.074], seg: 6 });
  k.colCyl(0.08, 0.32, [0, 0.16, 0]);
  return { kit: k, meta: { mass: 4.0, material: 'metal' } };
});

def('up_sanity', () => {
  const k = new Kit();
  const A = plate('sanity', 'SANITY DAMPENER', 'PSYCHO-ACOUSTIC FIELD • CALM', '#5ae8ff');
  moduleCase(k, 0.28, 0.14, 0.18, 0xd8d2c0, A, 0x5ae8ff);
  // coil tower with a little dish
  k.cyl(0.02, 0.12, S.steelDark(), { p: [0.06, 0.22, -0.02], seg: 10 });
  for (let i = 0; i < 6; i++) k.torus(0.026, 0.004, S.copper(), { p: [0.06, 0.18 + i * 0.014, -0.02], r: [PI / 2, 0, 0], rseg: 5, tseg: 14 });
  k.lathe([[0, 0], [0.05, 0.018], [0.055, 0.024]], S.alu(), { seg: 20, p: [-0.07, 0.24, -0.02], r: [0.5, 0, 0.3] });
  k.cyl(0.004, 0.06, S.steel(), { p: [-0.07, 0.2, -0.02], seg: 6 });
  return { kit: k, meta: { mass: 2.6, material: 'metal' } };
});

// ============================================================================ case_file
// Manila dossier: two covers (slightly sprung open), a stack of typed pages, a paper clip and a red
// CONFIDENTIAL stamp.
def('case_file', () => {
  const A = atlas('case_file', 512, 256, (c) => {
    rect(c, 0, 0, 256, 256, '#d9bd84');
    noise(c, 0, 0, 256, 256, 10, 7);
    txt(c, 'R.O.O.M. FIELD DOSSIER', 128, 46, { size: 18, color: '#3a2c18', fam: MONO, weight: 'bold' });
    txt(c, 'CASE NO. 0-____', 128, 74, { size: 14, color: '#3a2c18', fam: MONO });
    inkStamp(c, 'CONFIDENTIAL', 128, 150, { w: 200, h: 48, size: 28, rot: -0.18 });
    wear(c, 0, 0, 256, 256, 4, 1.4, { edge: true });
    // typed page
    rect(c, 256, 0, 256, 256, '#efeadc');
    for (let i = 0; i < 14; i++) rect(c, 276, 24 + i * 15, 120 + ((i * 53) % 90), 4, 'rgba(40,40,40,0.55)');
    rect(c, 276, 240, 60, 6, '#b02a20');
  }, { plain: '#d9bd84' });
  const k = new Kit();
  const card = mat({ name: 'shop_manila', map: A, rough: 0.85, det: 'card', ns: 0.6 });
  const page = mat({ name: 'shop_page', map: A, rough: 0.9, det: 'paper', ns: 0.4 });
  const W = 0.235, D = 0.31;
  k.box(W, 0.002, D, card, { p: [0, 0.001, 0], faces: { py: A.R(0, 0, 256, 256) } });
  for (let i = 0; i < 4; i++) k.box(W - 0.012, 0.0012, D - 0.014, page, { p: [0.003 * (i % 2), 0.0035 + i * 0.0013, -0.002 * i], r: [0, 0.02 * (i - 1.5), 0], faces: { py: A.R(256, 0, 256, 256) } });
  k.box(W, 0.002, D, card, { p: [0, 0.012, 0.004], r: [0.035, 0, 0], faces: { py: A.R(0, 0, 256, 256) } });
  k.box(0.07, 0.0022, 0.02, card, { p: [-0.06, 0.012, -D / 2 - 0.009], r: [0.035, 0, 0] }); // tab
  k.torus(0.008, 0.0009, S.steel(), { p: [0.08, 0.014, -D / 2 + 0.01], r: [PI / 2, 0, 0], rseg: 4, tseg: 12, s: [1, 2.2, 1] });
  k.colBox([W, 0.02, D], [0, 0.008, 0]);
  return { kit: k, meta: { mass: 0.3, material: 'cardboard', hold: { grip: [0, 0, 0.1], rot: [1.25, 0, 0], off: [0, 0.02, 0] } } };
});
