// Modelled dressing of the HQ waiting room (levels/lobby.js), built with the device kit: moulded brass and
// walnut frames, lathe-turned lamp parts and planters, riveted hatch flaps, with the shared worn PBR classes.
// Every builder returns { object } (one merged mesh per material class) in local coordinates.
import { DKit, FIN, PI, HP, TAU, frameShape } from '../../entities/devices/core.js';
import * as P from '../../entities/devices/parts.js';

const BRASS = { ...FIN.oldbrass, rust: 0.05, chip: 0 };

// walnut feature panel (W x H, front face at z = 0.03) in a stepped brass moulding, with two brass
// picture lights on swan-neck arms over the top edge
export function featurePanel(W, H) {
  const k = new DKit('feature_panel', { ground: 'wall', wear: { chip: 0.05, rust: 0, grime: 0.25, dust: 0.25 }, ao: { res: 48 } });
  k.box('wood', W, H, 0.03, 0, 0, 0.015, { tint: 0x7a4422, rough: 0.55, r: 0.006, grain: 'x' });
  k.ext('wood', frameShape(W - 0.06, H - 0.06, 0.004, W - 0.1, H - 0.1, 0.002), 0.008, 0, 0, 0.03, { tint: 0x3a2010, rough: 0.5, bev: 0.003, bevSeg: 1 });
  k.ext('metal', frameShape(W + 0.07, H + 0.07, 0.012, W - 0.004, H - 0.004, 0.003), 0.03, 0, 0, 0.012, { ...BRASS, bev: 0.008, bevSeg: 2, curveSeg: 3 });
  k.ext('metal', frameShape(W + 0.1, H + 0.1, 0.016, W + 0.06, H + 0.06, 0.01), 0.018, 0, 0, 0.004, { ...BRASS, tint: 0x8a6c3a, bev: 0.005, bevSeg: 1, curveSeg: 3 });
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.screw(k, x * (W / 2 + 0.02), y * (H / 2 + 0.02), 0.043, { kind: 'flat', r: 0.006, fin: FIN.brass });
  for (const x of [-0.7, 0.7]) {
    k.cyl('metal', 0.025, 0.02, x, H / 2 + 0.05, 0.012, { ...BRASS, axis: 'z', seg: 18, bev: 0.004, bevSeg: 1 });
    k.tube('metal', [[x, H / 2 + 0.05, 0.02], [x, H / 2 + 0.11, 0.06], [x, H / 2 + 0.12, 0.13]], 0.007, { ...BRASS, radial: 8, round: 0.04, rseg: 4 });
    k.push(x, H / 2 + 0.105, 0.15, [0.35, 0, 0]);
    k.cyl('metal', 0.032, 0.6, 0, 0, 0, { ...BRASS, axis: 'x', seg: 16, phiLen: PI, bev: 0.004, bevSeg: 1 });
    for (const s of [-1, 1]) k.cyl('metal', 0.034, 0.01, s * 0.3, 0, 0, { ...BRASS, axis: 'x', seg: 16 });
    k.pop();
  }
  return k.done();
}

// green banker's lamp: stepped brass base with a switch, fluted stem, cased-glass shade on a yoke
export function bankerLamp() {
  const k = new DKit('banker_lamp', { wear: { chip: 0, rust: 0, grime: 0.3, dust: 0.3 }, ao: { res: 32 } });
  k.lathe('metal', [[0, 0], [0.075, 0, 1], [0.078, 0.006, 2], [0.072, 0.014, 2], [0.05, 0.02], [0.046, 0.03, 2], [0.02, 0.036], [0.012, 0.042], [0, 0.042]], 0, 0, 0, { ...BRASS, seg: 32 });
  k.cyl('metal', 0.007, 0.28, 0, 0.18, -0.02, { ...BRASS, seg: 10 });
  k.cyl('dark', 0.006, 0.03, 0.045, 0.03, 0.02, { tint: 0x1a1a1a, seg: 8, rot: [0.3, 0, 0] });
  k.box('metal', 0.012, 0.012, 0.06, 0, 0.32, -0.005, { ...BRASS, r: 0.003 });
  for (const s of [-1, 1]) k.tube('metal', [[0, 0.32, -0.02], [s * 0.06, 0.32, -0.02], [s * 0.11, 0.315, 0.0]], 0.004, { ...BRASS, radial: 6, round: 0.02, rseg: 3 });
  // the shade: a half-round cased-glass trough with curved end caps
  k.lathe('plastic', [[0.0001, -0.125], [0.06, -0.125, 1], [0.074, -0.118, 2], [0.078, -0.1], [0.078, 0.1], [0.074, 0.118, 2], [0.06, 0.125, 1], [0.0001, 0.125]], 0, 0.32, 0.01,
    { tint: 0x14552a, rough: 0.12, seg: 18, phiLen: PI, phi0: PI, axis: 'x', edge: 0.2 });
  k.lathe('plastic', [[0.0001, -0.12], [0.07, -0.12], [0.072, -0.1], [0.072, 0.1], [0.07, 0.12], [0.0001, 0.12]], 0, 0.318, 0.01, { tint: 0xe8e2cc, rough: 0.4, seg: 16, phiLen: PI, phi0: 0, axis: 'x' });
  return k.done();
}

// moulded picture frame (outer w x h around a print w x h, front at z ~ 0.03); the print is a separate plane
export function pictureFrame(w, h) {
  const k = new DKit('picture_frame', { ground: 'wall', wear: { chip: 0.15, rust: 0, grime: 0.35, dust: 0.4 }, ao: { res: 32 } });
  k.ext('wood', frameShape(w + 0.07, h + 0.07, 0.004, w, h, 0.001), 0.028, 0, 0, 0, { tint: 0x2a180c, rough: 0.5, bev: 0.007, bevSeg: 2, curveSeg: 2 });
  k.ext('metal', frameShape(w + 0.012, h + 0.012, 0.002, w, h, 0.001), 0.024, 0, 0, 0.002, { ...BRASS, bev: 0.002, bevSeg: 1, curveSeg: 2 });
  k.box('dark', w + 0.06, h + 0.06, 0.004, 0, 0, 0.002, { tint: 0x111111, r: 0 });
  return k.done();
}

// glazed stoneware planter: lathe body with a rolled rim and a foot ring, dark soil (scale 1 = 0.38 m tall)
export function planter() {
  const k = new DKit('planter', { wear: { chip: 0.15, rust: 0, grime: 0.6, dust: 0.5 }, ao: { res: 32 } });
  k.atlas(128, 128);
  k.lathe('plastic', [[0, 0.01], [0.12, 0.01, 1], [0.125, 0, 2], [0.135, 0.004, 2], [0.132, 0.02], [0.15, 0.12], [0.168, 0.3], [0.172, 0.355], [0.184, 0.365, 2], [0.186, 0.38, 2], [0.176, 0.39, 1], [0.165, 0.385], [0.16, 0.36], [0, 0.36]], 0, 0, 0, { tint: 0x26302c, rough: 0.35, seg: 32 });
  k.disc('#1a120a', 0.158, 0, 0.358, 0, { seg: 24, rot: [-HP, 0, 0] });
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; k.sph('#2a1c10', 0.012 + (i % 3) * 0.004, Math.cos(a) * 0.1, 0.362, Math.sin(a) * 0.1, { seg: 6 }); }
  return k.done();
}

// a ceiling-hatch flap: riveted steel plate with hinge knuckles on its pivot edge (pivot at x = 0, plate
// toward -x when s = 1)
export function hatchFlap(w, d) {
  const k = new DKit('hatch_flap', { wear: { chip: 0.4, rust: 0.5, grime: 0.7, dust: 0.4 }, ao: { off: true } });
  k.box('paint', w, 0.02, d, -w / 2, 0, 0, { tint: 0x4a4e50, r: 0.004, dent: 0.003 });
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) P.rivet(k, -0.03 - i * ((w - 0.06) / 5), 0.011, s * (d / 2 - 0.025), { dir: 'y', r: 0.005 });
  for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) k.cyl('metal', 0.012, 0.1, 0, 0, z, { ...FIN.iron, axis: 'z', seg: 10, rust: 0.6 });
  k.box('dark', w * 0.5, 0.012, 0.06, -w * 0.55, -0.016, 0, { tint: 0x222222, r: 0.002 });
  return k.done();
}
