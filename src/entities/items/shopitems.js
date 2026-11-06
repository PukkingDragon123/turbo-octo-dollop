// Found and crafted gear: weapons (lead pipe, nail bat, machete), the scrap helmet, padded armour and a riot shield.
// The survival loop's own items (materials, hand-made and bench-made tools, shelter pieces, radio parts) are in
// ./survival.js, registered from here. Long tools are built along Z (handle at +Z) like the crowbar.
import * as THREE from 'three';
import { Kit, def, PI, TAU, rrectShape, sheetGeo } from './core.js';
import { mat, clear, S } from './mats.js';
import './survival.js';

const wood = () => mat({ name: 'shop_wood', color: 0xc8955a, rough: 0.55, det: 'roughwood', ns: 0.7 });
const tape = () => mat({ name: 'shop_tape', color: 0x1b1b1d, rough: 0.7, det: 'weave', ns: 0.6 });

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

// ============================================================================ hard_hat (scrap helmet)
// A dented steel bowl beaten out of scrap, lined with foam, a strip of cloth for a chin strap.
def('hard_hat', () => {
  const k = new Kit();
  const shell = mat({ name: 'shop_helmet', color: 0x8a7a64, rough: 0.6, metal: 0.55, det: 'cast', ns: 0.9 });
  k.lathe([[0, 0.15], [0.07, 0.143, 0.01], [0.11, 0.11, 0.012], [0.128, 0.05], [0.134, 0.02], [0.152, 0.016, 0.004], [0.15, 0.024, 0.003], [0.132, 0.03], [0.126, 0.05, 0.01], [0.105, 0.108, 0.015], [0.066, 0.137, 0.02], [0, 0.144]], shell, {
    seg: 26, s: [1, 1, 1.15], col: 0xd8ccb8,
    deform: (v) => { v.y -= Math.max(0, Math.sin(v.x * 30 + v.z * 20)) * 0.004; },
  });
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; k.cyl(0.006, 0.004, S.steelDark(), { p: [Math.cos(a) * 0.126, 0.04, Math.sin(a) * 0.145], r: [0, -a, PI / 2], seg: 6 }); }
  k.lathe([[0.1, 0.035], [0.112, 0.036], [0.112, 0.07], [0.1, 0.071]], mat({ name: 'shop_helmet_foam', color: 0xe8c464, rough: 0.98, det: 'stipple', ns: 1.4 }), { seg: 22, s: [1, 1, 1.15], raw: true });
  k.tube([[-0.11, 0.04, 0.02], [-0.06, -0.06, 0.06], [0.06, -0.06, 0.06], [0.11, 0.04, 0.02]], 0.008, tape(), { tseg: 20, rseg: 6 });
  k.colCyl(0.14, 0.13, [0, 0.075, 0]);
  return { kit: k, meta: { mass: 0.6, material: 'metal' } };
});

// ============================================================================ padded_vest
// Padded armour: a quilted vest stuffed with foam, patched brown cloth, taped seams and two reflective bands.
def('padded_vest', () => {
  const k = new Kit();
  const quilt = mat({ name: 'shop_vest', color: 0x9a6a3e, rough: 0.8, det: 'twill', ns: 0.8, sheen: 0.6 });
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
  // grip and forearm strap at the back
  k.tube([[0, H * 0.45 - 0.085, -0.004], [0, H * 0.45 - 0.07, -0.04], [0, H * 0.45 + 0.07, -0.04], [0, H * 0.45 + 0.085, -0.004]], 0.013, frame, { tseg: 28, rseg: 10, tension: 0.2 });
  for (const sy of [-1, 1]) k.cyl(0.02, 0.008, frame, { p: [0, H * 0.45 + sy * 0.085, -0.008], r: [PI / 2, 0, 0], seg: 16 });
  k.rbox(0.16, 0.04, 0.01, 0.005, tape(), { p: [0, H * 0.62, -0.03] });
  k.colBox([W, H, 0.03], [0, H / 2, 0]);
  return { kit: k, meta: { mass: 2.2, material: 'plastic', hold: { grip: [0, H * 0.45, -0.035], rot: [0, 0.2, 0], off: [0.05, -0.12, 0.06] } } };
});

