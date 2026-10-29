// Field-camp gear and abandoned-camp props (DKit). Physics props: origin = centre of the visual bounds,
// front +Z, colliders / halfHeight / anchors / parts keep the contracts of the old primitive models.
// Registered as devices (cached templates, cloned per spawn); the game names map onto them in
// models_camp.js (camp_kit, camp_pole, camp_canvas, camp_stakes, camp_lamp) and models_bio.js
// (camp_stove, supply_box, board, sleeping_bag).
//   cg_kit     plank crate with cleats, steel corners, rope handles, stencils, hinged lid (parts.lid)
//   cg_pole    telescoping anodised A-frame with cast apex coupler, spreader bar, rubber feet
//   cg_canvas  rolled canvas: spiral ends, outer flap, webbing straps with buckles, carry handle
//   cg_stakes  five chamfered hardwood stakes tied with cord + rubber mallet
//   cg_stake   one stake (the pitched tent's corner pegs)
//   cg_lamp    stake post, braced gallows arm, S-hook, red tin hurricane lantern (parts.mantle: own material)
//   cg_stove   enamel camp stove + windscreens, burner (parts.flame: own material), wire grate, gas
//              canister + regulator hose, folding legs, cast-iron pan (anchors.pan)
//   cg_supply  painted plank supply crate, battens, corner caps, hasps, rope handles, stencils
//   cg_board   18 mm plywood board (ply layers on the edges), nail holes, grade stamp
//   cg_bag     quilted mummy sleeping bag with hood, zip and draw cord
import * as THREE from 'three';
import { DKit, FIN, PI, HP, TAU, V3, cbox, ccyl, frameShape, polyShape, rrShape, boxGeo, latheGeo, curvePts } from './core.js';
import * as P from './parts.js';
import { txt, rubOff } from './atlas.js';
import { FONT, weightOf } from '../../ui/fonts.js';

const SIGN = { f: FONT.sign, w: String(weightOf('sign')) };
const PINE = [0xd8b688, 0xcfae80, 0xe0c296, 0xc9a576], CLEAT = 0x9c7752;
const NAIL = { kind: 'button', r: 0.0035, fin: FIN.iron };
const stencil = (lines, col) => (c, w, h) => {
  c.clearRect(0, 0, w, h);
  for (const [s, y, px] of lines) txt(c, s, w / 2, h * y, h * px, { col, ...SIGN, maxW: w * 0.94 });
  rubOff(c, w, h, 2.4, 17);
};
const rope = (k, pts, r = 0.009, tint = 0x9a7a52) => k.tube('cloth', curvePts(pts, 24), r, { tint, radial: 7, caps: true });

// ------------------------------------------------------------------------------------------- camp kit
export function b_cg_kit() {
  const k = new DKit('cg_kit', { ground: 'none', wear: { chip: 0.2, rust: 0.35, grime: 0.55, dust: 0.35 }, ao: { res: 48 } });
  k.atlas(512, 256);
  const L = 1.3, H = 0.5, D = 0.6, t = 0.04, by = -H / 2;
  const wood = (i, o = {}) => ({ tint: PINE[i % PINE.length], r: 0.004, ...o });
  // floor + plank walls (3 boards a side, hairline gaps over a dark core)
  k.box('#2a2017', L - 0.02, H - 0.03, D - 0.02, 0, 0.005, 0, { r: 0 });
  for (let i = 0; i < 4; i++) k.box('wood', L, t, D / 4 - 0.004, 0, by + t / 2, -D / 2 + D / 8 + i * (D / 4), wood(i, { grain: 'x' }));
  const bh = (H - t) / 3;
  for (let i = 0; i < 3; i++) {
    const y = by + t + bh * (i + 0.5);
    for (const sz of [-1, 1]) k.box('wood', L, bh - 0.004, t, 0, y, sz * (D / 2 - t / 2), wood(i + (sz > 0 ? 1 : 2), { grain: 'x' }));
    for (const sx of [-1, 1]) k.box('wood', t, bh - 0.004, D - 2 * t, sx * (L / 2 - t / 2), y, 0, wood(i + 3, { grain: 'z' }));
  }
  // cleats + bottom rails, nailed
  for (const sz of [-1, 1]) {
    const z = sz * (D / 2 + 0.011);
    for (const sx of [-1, 1]) {
      k.box('wood', 0.07, H - 0.03, 0.022, sx * (L / 2 - 0.085), 0, z, { tint: CLEAT, r: 0.005, grain: 'y' });
      P.onFace(k, sx * (L / 2 - 0.085), 0, z + sz * 0.011, sz > 0 ? 'z' : '-z', () => { for (const y of [-0.17, -0.05, 0.07, 0.19]) P.screw(k, 0, y, 0, NAIL); });
    }
    k.box('wood', L - 0.24, 0.055, 0.022, 0, by + 0.05, z, { tint: CLEAT, r: 0.005, grain: 'x' });
  }
  // bent steel corner caps with rivets (8 corners, 2 legs each)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (L / 2 + 0.002), y = sy * (H / 2 - 0.04), z = sz * (D / 2 + 0.024);
    k.box('metal', 0.08, 0.075, 0.003, x - sx * 0.04, y, z, { ...FIN.black, r: 0.001, rust: 0.6 });
    k.box('metal', 0.003, 0.075, 0.06, x, y, z - sz * 0.03, { ...FIN.black, r: 0.001, rust: 0.6 });
    P.rivet(k, x - sx * 0.05, y, z + sz * 0.0015, { r: 0.004, dir: sz > 0 ? 'z' : '-z' });
    P.rivet(k, x + sx * 0.0015, y, z - sz * 0.035, { r: 0.004, dir: sx > 0 ? 'x' : '-x' });
  }
  // rope handles through cleat blocks on the ends
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 + 0.02);
    for (const sz of [-1, 1]) k.box('wood', 0.04, 0.06, 0.05, x, 0.06, sz * 0.12, { tint: CLEAT, r: 0.006 });
    rope(k, [[x, 0.07, -0.12], [x + sx * 0.04, 0.02, -0.1], [x + sx * 0.055, -0.01, 0], [x + sx * 0.04, 0.02, 0.1], [x, 0.07, 0.12]], 0.011);
  }
  // stencils both long sides
  const st = k.reg('kit_st', 512, 170, stencil([['FIELD CAMP KIT', 0.38, 0.3], ['R.O.O.M. · TENT MODEL 4B · 1 SET', 0.66, 0.15], ['▲ THIS SIDE UP ▲', 0.88, 0.14]], 'rgba(25,20,14,0.9)'));
  for (const sz of [-1, 1]) k.decal(st, 0.86, 0.29, 0, 0.03, sz * (D / 2 + 0.0006), { rot: sz > 0 ? null : [0, PI, 0] });
  // hasp staple on the front wall, hinge knuckles on the back
  k.box('metal', 0.05, 0.03, 0.006, 0, H / 2 - 0.05, D / 2 + 0.003, { ...FIN.zinc, r: 0.002 });
  k.tor('metal', 0.012, 0.003, 0, H / 2 - 0.05, D / 2 + 0.012, { ...FIN.zinc, ts: 12, rs: 4, arc: PI, rot: [HP, 0, 0] });
  for (const sx of [-1, 1]) k.box('metal', 0.08, 0.1, 0.004, sx * 0.4, H / 2 - 0.05, -D / 2 - 0.002, { ...FIN.black, r: 0.001 });
  // contents: rolled canvas + pole ends (seen when the lid is open)
  k.cyl('cloth', 0.12, L - 0.2, 0, by + 0.16, 0.1, { tint: 0x56704a, axis: 'x', seg: 18, bev: 0.03, bevSeg: 2 });
  for (const z of [-0.12, -0.18]) k.cyl('paint', 0.02, L - 0.15, 0, by + 0.1, z, { tint: 0x4f6b46, axis: 'x', seg: 10, bev: 0.004 });
  // lid on its hinge line (back top edge)
  const lid = k.grp(0, H / 2, -D / 2, { name: 'lid' });
  k.inside(lid, () => {
    for (let i = 0; i < 3; i++) k.box('wood', L + 0.02, 0.03, (D + 0.02) / 3 - 0.004, 0, 0.015, (i + 0.5) * ((D + 0.02) / 3), wood(i + 1, { grain: 'x' }));
    for (const x of [-0.45, 0, 0.45]) {
      k.box('wood', 0.07, 0.022, D - 0.04, x, 0.041, D / 2, { tint: CLEAT, r: 0.005, grain: 'z' });
      for (const z of [0.08, D / 2, D - 0.08]) P.screw(k, x, 0.052, z, { ...NAIL, dir: 'y' });
    }
    for (const sx of [-1, 1]) {
      k.box('metal', 0.06, 0.004, 0.16, sx * 0.4, 0.032, 0.08, { ...FIN.black, r: 0.001 });
      k.cyl('metal', 0.007, 0.07, sx * 0.4, 0.0, -0.004, { ...FIN.black, axis: 'x', seg: 8 });
    }
    k.box('metal', 0.04, 0.09, 0.004, 0, -0.02, D + 0.013, { ...FIN.zinc, r: 0.002 });
    k.box('dark', 0.012, 0.03, 0.006, 0, -0.04, D + 0.013, { tint: 0x120d08, r: 0 });
  });
  k.parts.lid = lid;
  k.params.lidOpenSign = -1;
  k.collide(cbox(L, H, D, 0, 0, 0));
  return k.done({ mass: 30, material: 'wood', halfHeight: H / 2 });
}

// ------------------------------------------------------------------------------------------ tent pole
export const POLE_W = 0.78, POLE_H = 1.36;
export function b_cg_pole() {
  const k = new DKit('cg_pole', { ground: 'none', wear: { chip: 0.35, rust: 0.1, grime: 0.4, dust: 0.2 }, ao: { off: true } });
  const AN = { tint: 0x4f6b46, rough: 0.7, chip: 0.45 };
  const B = V3(0, POLE_H / 2 - 0.02, 0);
  for (const sx of [-1, 1]) {
    const A = V3(sx * POLE_W, -POLE_H / 2, 0), d = B.clone().sub(A).normalize(), M = A.clone().lerp(B, 0.52);
    P.rod(k, 'paint', A.clone().addScaledVector(d, 0.03), M.clone().addScaledVector(d, 0.03), 0.022, { ...AN, seg: 12 });
    P.rod(k, 'paint', M.clone().addScaledVector(d, -0.02), B.clone().addScaledVector(d, -0.06), 0.0185, { ...AN, seg: 12 });
    P.rod(k, 'metal', M.clone().addScaledVector(d, -0.01), M.clone().addScaledVector(d, 0.045), 0.026, { ...FIN.alu, seg: 14, bev: 0.004 });
    const n = V3(0, 0, 1);
    const btn = M.clone().addScaledVector(d, 0.07).addScaledVector(n, 0.019);
    k.sph('metal', 0.005, btn.x, btn.y, btn.z, { ...FIN.chrome, ws: 8, hs: 6 });
    // rubber foot
    P.rod(k, 'dark', A.clone().addScaledVector(d, -0.005), A.clone().addScaledVector(d, 0.06), 0.03, { tint: 0x1c1c1c, r2: 0.026, seg: 14, bev: 0.006 });
  }
  // cast apex coupler: two leg sockets, ridge socket, wing bolt
  for (const sx of [-1, 1]) {
    const A = V3(sx * POLE_W, -POLE_H / 2, 0), d = B.clone().sub(A).normalize();
    P.rod(k, 'metal', B.clone().addScaledVector(d, -0.11), B.clone().addScaledVector(d, 0.0), 0.026, { ...FIN.alu, seg: 14, bev: 0.004, rust: 0 });
  }
  k.cyl('metal', 0.032, 0.14, 0, B.y + 0.005, 0, { ...FIN.alu, axis: 'z', seg: 16, bev: 0.005 });
  k.box('metal', 0.07, 0.05, 0.06, 0, B.y - 0.02, 0, { ...FIN.alu, r: 0.012 });
  P.screw(k, 0, B.y - 0.02, 0.03, { kind: 'hex', r: 0.007 });
  k.box('metal', 0.04, 0.012, 0.004, 0, B.y - 0.02, 0.042, { ...FIN.zinc, r: 0.002 });
  // spreader bar with clevis ends + wing nuts
  const ys = -POLE_H / 2 + POLE_H * 0.38, xs = POLE_W * 0.62;
  P.rod(k, 'metal', [-xs + 0.03, ys, 0], [xs - 0.03, ys, 0], 0.01, { ...FIN.zinc, seg: 10 });
  for (const sx of [-1, 1]) {
    k.box('metal', 0.05, 0.03, 0.05, sx * (xs - 0.01), ys, 0, { ...FIN.zinc, r: 0.006 });
    k.box('metal', 0.03, 0.006, 0.012, sx * (xs - 0.01), ys, 0.03, { ...FIN.zinc, r: 0.002 });
  }
  const tilt = Math.atan2(POLE_W, POLE_H), half = Math.hypot(POLE_W, POLE_H) / 2;
  k.collide({ type: 'capsule', radius: 0.035, halfHeight: half - 0.035, pos: [-POLE_W / 2, 0, 0], rot: [0, 0, -tilt] });
  k.collide({ type: 'capsule', radius: 0.035, halfHeight: half - 0.035, pos: [POLE_W / 2, 0, 0], rot: [0, 0, tilt] });
  return k.done({ mass: 3.5, material: 'metal', halfHeight: POLE_H / 2 });
}

// ---------------------------------------------------------------------------------------- canvas roll
export function b_cg_canvas() {
  const k = new DKit('cg_canvas', { ground: 'none', wear: { chip: 0, rust: 0.2, grime: 0.6, dust: 0.3 }, ao: { res: 40 } });
  const len = 1.0, r = 0.17, CAN = { tint: 0x5a7450 }, WEB = { tint: 0x6b4f33 };
  k.lathe('cloth', [[0, -len / 2], [0.12, -len / 2], [0.152, -len / 2 + 0.004, 2], [0.166, -len / 2 + 0.016], [r, -len / 2 + 0.05], [r + 0.004, 0], [r, len / 2 - 0.05], [0.166, len / 2 - 0.016], [0.152, len / 2 - 0.004, 2], [0.12, len / 2], [0, len / 2]], 0, 0, 0, { ...CAN, axis: 'x', seg: 28 });
  // spiral layers on the ends + the outer flap edge
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * 4.2 * TAU, rr = 0.02 + t * 0.13; pts.push([sx * (len / 2 + 0.002), Math.sin(a) * rr, Math.cos(a) * rr]); }
    k.tube('cloth', pts, 0.0045, { tint: 0x3f5236, radial: 5 });
  }
  k.tube('cloth', [[-len / 2 + 0.03, r * Math.sin(0.6), r * Math.cos(0.6)], [len / 2 - 0.03, r * Math.sin(0.6), r * Math.cos(0.6)]], 0.006, { tint: 0x4a6040, radial: 6 });
  // webbing straps with buckles
  for (const x of [-0.3, 0.3]) {
    k.lathe('cloth', [[r + 0.002, x - 0.016], [r + 0.009, x - 0.016, 2], [r + 0.009, x + 0.016, 2], [r + 0.002, x + 0.016]], 0, 0, 0, { ...WEB, axis: 'x', seg: 28 });
    k.ext('metal', frameShape(0.044, 0.04, 0.004, 0.034, 0.026, 0.002), 0.004, x, r + 0.011, 0, { ...FIN.black, rot: [-HP, 0, 0], bev: 0.001 });
  }
  // carry handle stitched to the straps
  k.tube('cloth', curvePts([[-0.3, r + 0.008, 0.02], [-0.22, r + 0.07, 0.02], [0.0, r + 0.1, 0.02], [0.22, r + 0.07, 0.02], [0.3, r + 0.008, 0.02]], 30), 0.011, { ...WEB, radial: 7 });
  for (const x of [-0.3, 0.3]) k.box('cloth', 0.04, 0.012, 0.045, x, r + 0.01, 0.02, { ...WEB, r: 0.004 });
  k.collide(ccyl(r, len, 0, 0, 0, [0, 0, PI / 2]));
  return k.done({ mass: 6, material: 'fabric', halfHeight: r });
}

// ------------------------------------------------------------------------------------- stakes bundle
function stake(k, x, y, z, len, roll = 0, tint = 0xc89e6a) {
  const g = boxGeo(len, 0.032, 0.032, { r: 0.004, seg: 1, div: 0.06 });
  g.deform((p) => { const u = (p.x + len / 2) / 0.12; if (u < 1) { const s = Math.max(0.06, u); p.y *= s; p.z *= s; } }, false);
  g.computeNormals(true);
  k.put('wood', g, x, y, z, { tint, grain: 'x', rot: [roll, 0, 0] });
  k.box('#2a1d12', 0.006, 0.03, 0.03, x + len / 2 - 0.06, y, z, { r: 0, rot: [roll, 0, 0] });
}
export function b_cg_stakes() {
  const k = new DKit('cg_stakes', { ground: 'none', wear: { chip: 0, rust: 0, grime: 0.6, dust: 0.3 }, ao: { res: 32 } });
  k.atlas(128, 64);
  const len = 0.5;
  const offs = [[0, 0], [0.045, 0.03], [-0.045, 0.03], [0.025, -0.04], [-0.025, -0.04]];
  offs.forEach(([y, z], i) => stake(k, -0.005 + (i % 2) * 0.01, y, z, len - 0.02, 0.785 + i * 0.3, [0xc89e6a, 0xbf9460, 0xd2aa78][i % 3]));
  // cord lashings (two turns each) + knot
  for (const x of [-0.1, 0.12]) {
    for (const dx of [-0.006, 0.006]) k.tor('cloth', 0.061, 0.0055, x + dx, 0, 0, { tint: 0x9a2a22, ts: 22, rs: 5, rot: [0, HP, 0] });
    k.sph('cloth', 0.012, x, 0.06, 0.02, { tint: 0x8a2620, ws: 8, hs: 6 });
  }
  // rubber mallet tucked on top
  k.lathe('wood', [[0, -0.11], [0.013, -0.11, 1], [0.011, 0.02], [0.012, 0.1], [0, 0.104]], 0.12, 0.08, 0, { tint: 0x8a6a48, axis: 'x', seg: 10 });
  k.lathe('dark', [[0, -0.06], [0.03, -0.06, 1], [0.036, -0.052, 2], [0.036, 0.052, 2], [0.03, 0.06], [0, 0.06]], 0.22, 0.08, 0, { tint: 0x1e1e1f, axis: 'z', seg: 18 });
  k.collide(cbox(len, 0.18, 0.16, 0, 0.01, 0));
  return k.done({ mass: 2.2, material: 'wood', halfHeight: 0.08 });
}
// one pitched stake (origin at the ground point, shaft up +Y)
export function b_cg_stake() {
  const k = new DKit('cg_stake', { ground: 'none', wear: { grime: 0.7, dust: 0.3 }, ao: { off: true } });
  k.atlas(128, 64);
  k.push(0, 0.1, 0, [0, 0, HP]);
  stake(k, 0, 0, 0, 0.3, 0.785);
  k.pop();
  return k.done({ mass: 0.3, material: 'wood' });
}

// ----------------------------------------------------------------------------------------- camp lamp
export const LAMP_H = 1.2;
export function b_cg_lamp() {
  const k = new DKit('cg_lamp', { ground: 'none', wear: { chip: 0.4, rust: 0.45, grime: 0.55, dust: 0.3 }, ao: { res: 40 } });
  const H = LAMP_H, WOOD = { tint: 0x8a6a48, grain: 'y' }, TIN = { tint: 0xa3291c, chip: 0.5, rust: 0.6 };
  // post with a spiked foot, gallows arm, diagonal brace, steel angle bracket
  const post = boxGeo(0.055, H, 0.055, { r: 0.008, seg: 2, div: 0.15 });
  post.deform((p) => { const u = (p.y + H / 2) / 0.13; if (u < 1) { const s = Math.max(0.05, u); p.x *= s; p.z *= s; } }, false);
  post.computeNormals(true);
  k.put('wood', post, 0, 0, 0, WOOD);
  k.box('wood', 0.32, 0.042, 0.055, 0.13, H / 2 - 0.04, 0, { tint: 0x7e5f40, r: 0.006, grain: 'x' });
  P.rod(k, 'wood', [0.0, H / 2 - 0.2, 0], [0.17, H / 2 - 0.06, 0], 0.011, { tint: 0x7e5f40, seg: 8 });
  for (const sz of [-1, 1]) {
    k.ext('metal', polyShape([[-0.024, 0.021], [0.1, 0.021], [0.1, 0.0], [0.0, -0.09], [-0.024, -0.09]]), 0.003, 0, H / 2 - 0.04, sz > 0 ? 0.0275 : -0.0305, { ...FIN.black, rust: 0.7, bev: 0.0008 });
    for (const [x, y] of [[0.07, 0.0], [0.0, -0.06]]) P.screw(k, x, H / 2 - 0.04 + y, sz * 0.0305, { kind: 'hex', r: 0.005, dir: sz > 0 ? 'z' : '-z' });
  }
  // S-hook from the arm tip to the bail
  k.tube('metal', curvePts([[0.24, H / 2 - 0.061, 0], [0.252, H / 2 - 0.07, 0], [0.24, H / 2 - 0.085, 0], [0.228, H / 2 - 0.098, 0], [0.24, H / 2 - 0.11, 0]], 14), 0.0025, { ...FIN.black, radial: 5 });
  // hurricane lantern (static; parts.lantern kept as its frame)
  const lan = k.grp(0.24, H / 2 - 0.24, 0, { name: 'lantern' });
  k.insideStatic(lan, () => {
    k.lathe('paint', [[0, -0.135], [0.07, -0.135, 1], [0.078, -0.125, 2], [0.078, -0.09], [0.07, -0.075, 2], [0.05, -0.07], [0, -0.07]], 0, 0, 0, { ...TIN, seg: 24 });
    k.lathe('metal', [[0.05, -0.07], [0.052, -0.06], [0.045, -0.055], [0, -0.055]], 0, 0, 0, { ...FIN.oldbrass, seg: 18 });
    k.lathe('metal', [[0, 0], [0.006, 0, 1], [0.006, 0.012], [0, 0.012]], 0.05, -0.064, 0, { ...FIN.oldbrass, axis: 'z', seg: 10 });
    k.lathe('glass', [[0.042, -0.056], [0.06, -0.03], [0.066, 0.0], [0.06, 0.035], [0.044, 0.065], [0.036, 0.075]], 0, 0, 0, { seg: 20 });
    // side air tubes + guard wires + top cap
    for (const sx of [-1, 1]) k.tube('paint', [[sx * 0.074, -0.08, 0], [sx * 0.082, -0.02, 0], [sx * 0.08, 0.06, 0], [sx * 0.05, 0.1, 0]], 0.007, { ...TIN, radial: 8, round: 0.03, rseg: 3 });
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + (i * PI) / 2, c = Math.cos(a), s = Math.sin(a);
      k.tube('metal', [[c * 0.05, -0.065, s * 0.05], [c * 0.07, -0.02, s * 0.07], [c * 0.074, 0.01, s * 0.074], [c * 0.06, 0.05, s * 0.06], [c * 0.042, 0.078, s * 0.042]], 0.002, { ...FIN.black, radial: 4 });
    }
    k.tor('metal', 0.072, 0.0022, 0, 0.0, 0, { ...FIN.black, axis: 'y', ts: 24, rs: 4 });
    k.lathe('paint', [[0.044, 0.07], [0.056, 0.078, 2], [0.05, 0.094], [0.03, 0.106], [0.024, 0.113], [0.0, 0.114]], 0, 0, 0, { ...TIN, seg: 20 });
    k.tor('metal', 0.04, 0.0025, 0, 0.1, 0, { ...FIN.black, axis: 'y', ts: 16, rs: 4 });
    // bail handle
    k.tube('metal', curvePts([[-0.058, 0.085, 0], [-0.048, 0.115, 0], [0, 0.131, 0], [0.048, 0.115, 0], [0.058, 0.085, 0]], 18), 0.0025, { ...FIN.black, radial: 5 });
  });
  const mantleMat = new THREE.MeshStandardMaterial({ color: 0x40301a, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.8, name: 'lamp_mantle' });
  mantleMat.userData.unique = true;
  mantleMat.userData.noProbe = true;
  const mg = latheGeo([[0, -0.03], [0.012, -0.028], [0.02, -0.012], [0.022, 0.006], [0.016, 0.022], [0.006, 0.03], [0, 0.031]], 14);
  const mantle = k.mesh(mantleMat, mg, 0.24, H / 2 - 0.25, 0, { name: 'mantle', shadow: false, ao: false });
  k.parts.mantle = mantle;
  k.parts.lantern = lan;
  k.collide(cbox(0.07, H, 0.07, 0, 0, 0));
  k.collide(cbox(0.18, 0.3, 0.16, 0.24, H / 2 - 0.2, 0));
  return k.done({ mass: 3, material: 'wood', halfHeight: H / 2 });
}

// ----------------------------------------------------------------------------------------- camp stove
export const PAN_Y = 0.36, PAN_R = 0.13;
export function b_cg_stove() {
  const k = new DKit('cg_stove', { ground: 'none', wear: { chip: 0.45, rust: 0.5, grime: 0.65, dust: 0.25 }, ao: { res: 40 } });
  k.atlas(256, 128);
  const C = 0.19, EN = { tint: 0x2e5c3d, chip: 0.55 }, IR = { ...FIN.iron, rust: 0.55 };
  k.push(0, -C, 0);
  // enamel body, inset control panel, drip tray with a rim
  k.box('paint', 0.42, 0.11, 0.26, 0, 0.22, 0, { ...EN, r: 0.012, seg: 2 });
  k.box('paint', 0.36, 0.07, 0.006, 0, 0.215, 0.131, { tint: 0x23432d, r: 0.002 });
  k.box('metal', 0.4, 0.008, 0.24, 0, 0.279, 0, { ...FIN.steel, r: 0.002 });
  k.ext('metal', frameShape(0.41, 0.25, 0.008, 0.38, 0.22, 0.004), 0.012, 0, 0.283, 0, { ...FIN.steel, rot: [-HP, 0, 0], bev: 0.002 });
  // windscreens (left full height, right low under the pan handle)
  for (const [x, h] of [[-0.205, 0.08], [0.205, 0.05]]) {
    k.box('paint', 0.004, h, 0.24, x, 0.283 + h / 2, 0, { ...EN, r: 0.001 });
    k.cyl('metal', 0.003, 0.24, x, 0.284, 0, { ...FIN.steel, axis: 'z', seg: 6 });
  }
  // burner head + wire grate (the blue flame ring is parts.flame)
  k.lathe('metal', [[0, 0.283], [0.06, 0.283, 1], [0.058, 0.29], [0.054, 0.296, 2], [0.03, 0.298], [0.03, 0.302], [0, 0.302]], 0.04, 0, 0, { ...FIN.black, seg: 24 });
  for (let i = 0; i < 4; i++) k.box('metal', 0.29, 0.005, 0.005, 0.04, 0.308, 0, { ...FIN.black, r: 0.0015, rot: [0, (i * PI) / 4, 0] });
  k.tor('metal', 0.14, 0.003, 0.04, 0.308, 0, { ...FIN.black, axis: 'y', ts: 28, rs: 4 });
  const flameMat = new THREE.MeshStandardMaterial({ color: 0x081030, emissive: 0x3a7aff, emissiveIntensity: 0, roughness: 0.5, name: 'stove_flame' });
  flameMat.userData.unique = true;
  flameMat.userData.noProbe = true;
  const fg = new THREE.TorusGeometry(0.05, 0.008, 6, 20); fg.rotateX(PI / 2);
  k.parts.flame = k.mesh(flameMat, fg, 0.04, 0.3, 0, { name: 'flame', shadow: false });
  // control knob + printed scale
  P.knob(k, 0.15, 0.215, 0.134, 0.016, { static: true, skirt: false, tint: 0x18181a });
  k.label(k.reg('stv', 128, 40, (c, w, h) => { c.fillStyle = '#23432d'; c.fillRect(0, 0, w, h); txt(c, 'R.O.O.M. FIELD STOVE', w * 0.5, h * 0.5, h * 0.42, { col: '#d8d0b0', ...SIGN, maxW: w * 0.92 }); rubOff(c, w, h, 2, 3); }, 'p'), 0.2, 0.05, -0.05, 0.215, 0.1345);
  // folding wire legs with rubber feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.tube('metal', [[sx * 0.17, 0.168, sz * 0.09], [sx * 0.19, 0.08, sz * 0.11], [sx * 0.2, 0.012, sz * 0.12]], 0.005, { ...FIN.zinc, radial: 6 });
    k.sph('dark', 0.012, sx * 0.2, 0.01, sz * 0.12, { tint: 0x1a1a1a, ws: 10, hs: 6 });
  }
  // gas canister in a clamp + regulator hose
  k.lathe('paint', [[0, 0.12], [0.04, 0.12, 1], [0.046, 0.13, 2], [0.046, 0.24], [0.04, 0.262, 2], [0.022, 0.275], [0.018, 0.282], [0, 0.282]], -0.265, 0, 0, { tint: 0xb02a1c, chip: 0.5, rust: 0.4, seg: 20 });
  k.lathe('metal', [[0, 0.28], [0.014, 0.28], [0.014, 0.3, 2], [0.009, 0.305], [0, 0.305]], -0.265, 0, 0, { ...FIN.oldbrass, seg: 12 });
  k.tor('metal', 0.048, 0.004, -0.265, 0.2, 0, { ...FIN.black, axis: 'y', ts: 20, rs: 4 });
  k.box('metal', 0.04, 0.02, 0.012, -0.226, 0.2, 0, { ...FIN.black, r: 0.002 });
  k.tube('dark', curvePts([[-0.265, 0.305, 0], [-0.25, 0.33, 0.03], [-0.22, 0.27, 0.07], [-0.21, 0.24, 0.08]], 16), 0.005, { tint: 0x1c1c1d, radial: 6 });
  // seasoned cast-iron pan + hang-hole handle
  k.lathe('metal', [[0, PAN_Y - 0.038], [PAN_R - 0.012, PAN_Y - 0.038, 1], [PAN_R + 0.004, PAN_Y - 0.03, 2], [PAN_R + 0.013, PAN_Y + 0.018], [PAN_R + 0.012, PAN_Y + 0.024, 2], [PAN_R + 0.003, PAN_Y + 0.024, 2], [PAN_R - 0.003, PAN_Y - 0.018], [PAN_R - 0.012, PAN_Y - 0.026, 2], [0, PAN_Y - 0.026]], 0.04, 0, 0, { ...IR, seg: 28 });
  const hs = rrShape(0.2, 0.034, 0.014, 0, 0);
  const hole = new THREE.Path(); hole.absarc(0.07, 0, 0.007, 0, TAU, true); hs.holes.push(hole);
  k.ext('metal', hs, 0.014, 0.04 + PAN_R + 0.1, PAN_Y - 0.008, 0, { ...IR, rot: [-HP, 0, 0], bev: 0.004, bevSeg: 1, center: true });
  k.pop();
  // colliders: body, pan floor slab, pan wall ring, handle (unchanged contract)
  k.collide(cbox(0.42, 0.29, 0.26, 0, 0.145 - C, 0));
  k.collide(ccyl(PAN_R, 0.03, 0.04, PAN_Y - 0.03 - C, 0));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; k.collide(cbox(0.018, 0.05, 0.085, 0.04 + Math.cos(a) * (PAN_R + 0.006), PAN_Y - C, Math.sin(a) * (PAN_R + 0.006), [0, -a, 0])); }
  k.collide(cbox(0.2, 0.02, 0.03, 0.04 + PAN_R + 0.1, PAN_Y - 0.01 - C, 0));
  k.anchors.pan = V3(0.04, PAN_Y - 0.015 - C, 0);
  return k.done({ mass: 14, material: 'metal', halfHeight: C, friction: 1.2, restitution: 0.02, angularDamping: 2 });
}

// ---------------------------------------------------------------------------------------- supply box
export function b_cg_supply() {
  const k = new DKit('cg_supply', { ground: 'none', wear: { chip: 0.3, rust: 0.4, grime: 0.6, dust: 0.28 }, ao: { res: 40 } });
  k.atlas(512, 512);
  const W = 0.7, H = 0.42, D = 0.46, OD = [0x8f9c6c, 0x86935f, 0x95a273], BAT = 0x6f7a50;
  k.box('#1c1a14', W - 0.02, H - 0.02, D - 0.02, 0, 0, 0, { r: 0 });
  const bh = H / 3;
  for (let i = 0; i < 3; i++) {
    const y = -H / 2 + bh * (i + 0.5);
    for (const sz of [-1, 1]) k.box('wood', W, bh - 0.004, 0.02, 0, y, sz * (D / 2 - 0.01), { tint: OD[(i + (sz > 0 ? 0 : 1)) % 3], r: 0.003, grain: 'x' });
    for (const sx of [-1, 1]) k.box('wood', 0.02, bh - 0.004, D - 0.04, sx * (W / 2 - 0.01), y, 0, { tint: OD[(i + 2) % 3], r: 0.003, grain: 'z' });
  }
  k.box('wood', W, 0.02, D, 0, H / 2 - 0.01, 0, { tint: OD[1], r: 0.004, grain: 'x' });
  // battens round top and bottom
  for (const sy of [-1, 1]) {
    const y = sy * 0.17;
    for (const sz of [-1, 1]) k.box('wood', W + 0.02, 0.05, 0.02, 0, y, sz * (D / 2 + 0.01), { tint: BAT, r: 0.004, grain: 'x' });
    for (const sx of [-1, 1]) k.box('wood', 0.02, 0.05, D + 0.02, sx * (W / 2 + 0.01), y, 0, { tint: BAT, r: 0.004, grain: 'z' });
  }
  // steel corner caps
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 + 0.021), y = sy * (H / 2 + 0.0), z = sz * (D / 2 + 0.021);
    k.box('metal', 0.003, 0.06, 0.06, x, y - sy * 0.03, z - sz * 0.03, { ...FIN.black, r: 0.001, rust: 0.7 });
    k.box('metal', 0.06, 0.06, 0.003, x - sx * 0.03, y - sy * 0.03, z, { ...FIN.black, r: 0.001, rust: 0.7 });
    k.box('metal', 0.06, 0.003, 0.06, x - sx * 0.03, y, z - sz * 0.03, { ...FIN.black, r: 0.001, rust: 0.7 });
  }
  // hasps on the front + rope handles on the ends
  for (const sx of [-1, 1]) {
    k.box('metal', 0.05, 0.06, 0.004, sx * 0.2, H / 2 - 0.035, D / 2 + 0.022, { ...FIN.zinc, r: 0.002 });
    k.cyl('metal', 0.005, 0.05, sx * 0.2, H / 2 - 0.005, D / 2 + 0.024, { ...FIN.zinc, axis: 'x', seg: 8 });
    k.tor('metal', 0.012, 0.003, sx * 0.2, H / 2 - 0.07, D / 2 + 0.03, { ...FIN.zinc, ts: 12, rs: 4, arc: PI, rot: [HP, 0, 0] });
    const x = sx * (W / 2 + 0.02);
    for (const sz of [-1, 1]) k.box('wood', 0.03, 0.05, 0.04, x + sx * 0.005, 0.02, sz * 0.1, { tint: BAT, r: 0.005 });
    rope(k, [[x + sx * 0.01, 0.03, -0.1], [x + sx * 0.04, -0.01, -0.07], [x + sx * 0.05, -0.03, 0], [x + sx * 0.04, -0.01, 0.07], [x + sx * 0.01, 0.03, 0.1]], 0.009);
  }
  const st = k.reg('sb_st', 512, 190, stencil([['R.O.O.M.', 0.3, 0.3], ['FIELD SUPPLY', 0.62, 0.2], ['DO NOT DROP', 0.86, 0.12]], 'rgba(236,228,200,0.92)'));
  for (const sz of [-1, 1]) k.decal(st, 0.46, 0.17, 0, 0.0, sz * (D / 2 + 0.0006), { rot: sz > 0 ? null : [0, PI, 0] });
  P.onFace(k, 0, 0.0, D / 2 + 0.0007, 'z', () => P.stain(k, 0.22, -0.1, 0, 0.14, 0.12));
  k.collide(cbox(0.72, 0.44, 0.48, 0, 0, 0));
  return k.done({ mass: 18, material: 'wood', friction: 0.9, halfHeight: 0.22 });
}

// ------------------------------------------------------------------------------------- plywood board
export function b_cg_board() {
  const k = new DKit('cg_board', { ground: 'none', wear: { chip: 0, rust: 0.2, grime: 0.5, dust: 0.3 }, ao: { off: true } });
  k.atlas(512, 256);
  const L = 1.0, D = 0.52, n = 5, t = 0.022 / n;
  for (let i = 0; i < n; i++) k.box('wood', L, t, D, 0, -0.011 + t * (i + 0.5), 0, { r: i === 0 || i === n - 1 ? 0.0015 : 0, grain: i % 2 ? 'z' : 'x', tint: i % 2 ? 0xb8925e : i === n - 1 ? 0xf0dcb4 : 0xe4cca0, keepBevel: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P.screw(k, sx * (L / 2 - 0.03), 0.011, sz * (D / 2 - 0.03), { ...NAIL, dir: 'y' });
    k.disc('#2a1d12', 0.0035, sx * (L / 2 - 0.06), 0.0112, sz * (D / 2 - 0.035), { rot: [-HP, 0, 0], seg: 8 });
  }
  k.decal(k.reg('bd_st', 256, 96, stencil([['GRADE C · 18 MM', 0.4, 0.3], ['EXTERIOR PLY', 0.76, 0.2]], 'rgba(30,40,90,0.7)')), 0.22, 0.08, -0.25, 0.0115, 0.12, { rot: [-HP, 0, 0.1] });
  k.push(0, 0.0114, 0, [-HP, 0, 0]); P.stain(k, 0.2, 0.05, 0, 0.22, 0.18, { alpha: 0.4 }); P.scuffs(k, -0.1, -0.1, 0, 0.5, 0.3, { col: '70,58,44', alpha: 0.2 }); k.pop();
  k.collide(cbox(L, 0.024, D, 0, 0, 0));
  return k.done({ mass: 4, material: 'wood', friction: 0.9, halfHeight: 0.012 });
}

// ------------------------------------------------------------------------------------- sleeping bag
export function b_cg_bag() {
  const k = new DKit('cg_bag', { ground: 'none', wear: { chip: 0, rust: 0, grime: 0.7, dust: 0.08 }, ao: { res: 40 } });
  const W = 0.72, T = 0.09, L = 1.9;
  const g = boxGeo(W, T, L, { r: 0.035, seg: 3, div: 0.035 });
  g.deform((p) => {
    const u = p.z / L + 0.5;
    p.x *= 1 - Math.max(0, u - 0.55) * 0.42;
    if (p.y > -T / 2 + 0.01) {
      const cr = Math.max(0, 1 - (2 * p.x / W) ** 2), up = (p.y + T / 2) / T;
      p.y += up * (cr * 0.04 + Math.abs(Math.sin(p.z * PI / 0.17)) * 0.028 * cr + Math.sin(p.x * 9 + p.z * 3) * 0.004);
      p.x *= 1 + up * 0.03;
    }
  }, false);
  g.computeNormals(true);
  k.put('cloth', g, 0, 0, 0, { tint: 0xc8641e, rough: 1.1 });
  // stitched baffle seams in the valleys
  for (let zz = -0.68; zz < L / 2 - 0.08; zz += 0.17) {
    const hw = (W / 2) * (1 - Math.max(0, zz / L + 0.5 - 0.55) * 0.42) * 0.9, pts = [];
    for (let i = 0; i <= 12; i++) { const x = -hw + (2 * hw * i) / 12, cr = Math.max(0, 1 - (2 * x / W) ** 2); pts.push([x, T / 2 + cr * 0.04 + 0.001, zz]); }
    k.tube('cloth', pts, 0.003, { tint: 0x8a3e12, radial: 4 });
  }
  // hood + draw cord + toggle
  k.sph('cloth', 0.2, 0, 0.028, -0.86, { tint: 0x34485a, s: [1.45, 0.42, 0.75], ws: 18, hs: 9 });
  k.tor('cloth', 0.13, 0.004, 0, 0.06, -0.86, { tint: 0x222222, axis: 'y', ts: 24, rs: 4, s: [1.5, 1, 0.7] });
  k.lathe('dark', [[0, -0.01], [0.006, -0.01], [0.007, 0.01], [0, 0.012]], 0.05, 0.075, -0.72, { tint: 0x111111, seg: 8 });
  // zip down the right side with its pull
  k.tube('metal', [[W / 2 - 0.004, 0.012, -0.72], [W / 2 - 0.02, 0.014, 0.2], [W / 2 * 0.62, 0.01, 0.92]], 0.004, { ...FIN.black, radial: 5 });
  k.box('metal', 0.012, 0.004, 0.03, W / 2 - 0.006, 0.02, -0.1, { ...FIN.chrome, r: 0.001 });
  k.collide(cbox(W, 0.1, L, 0, 0, 0));
  return k.done({ mass: 2.5, material: 'fabric', friction: 1.1, halfHeight: 0.05 });
}
