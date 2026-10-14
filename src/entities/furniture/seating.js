// Seating: stacking chair, office chair, folding chair, stool, couch, armchair.
import * as THREE from 'three';
import { def, boxGeo, cylGeo, latheGeo, tubeGeo, cushionGeo, roundPath, extrudeGeo, CB, CC, CS, CP, CCbetween, CBbetween, CPbetween, V, toV, PI, TAU, HP, clamp, lerp, qUp } from './core.js';
import { matFor, tint } from './mats.js';
import { screw, glide, caster } from './parts.js';

const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _s4 = new THREE.Vector3(1, 1, 1);

// piping cord along a cushion seam (seam points in cushion-local space, placed like the cushion)
export function piping(b, slot, seam, x, y, z, r = 0.0035, rot = null, step = 1) {
  _e4.set(...(rot || [0, 0, 0]));
  _m4.compose(V(x, y, z), _q4.setFromEuler(_e4), _s4);
  const pts = [];
  for (let i = 0; i < seam.length; i += step) pts.push(seam[i].p.clone().addScaledVector(seam[i].n, r * 0.35).applyMatrix4(_m4));
  b.tube(slot, pts, r, { radial: 6, closed: true });
}

// turned spindle between a and c (bulged middle), wood grain along its length
export function spindle(b, slot, a, c, rEnd, rMid, seg = 10) {
  const A = toV(a), C = toV(c), L = A.distanceTo(C);
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([lerp(rEnd, rMid, Math.sin(t * PI) ** 0.8), (t - 0.5) * L]); }
  const g = latheGeo(pts, seg, { swap: true, uv: 'cyl' });
  const q = qUp(C.clone().sub(A));
  const m = A.clone().add(C).multiplyScalar(0.5);
  b.put(slot, g, m.x, m.y, m.z, { quat: q });
}

// ===========================================================================
// Stacking chair (waiting room / banquet chair, upholstered seat & back pad)
// ===========================================================================
const FAB90 = [0x2a5f59, 0x6a2a32, 0x8a6a2c, 0x2a3c5c, 0x7a5068, 0x31503c];
const CHAIR_WOOD = ['maple', 'walnut', 'cherry', 'walnut', 'maple', 'teak'];

def('chair_wood', {
  variants: 6,
  geoVariant: (v) => (v === 2 || v === 5 ? 1 : 0), // 1 = stained & worn
  mats: (o, v) => ({ wood: matFor(CHAIR_WOOD[v]), seat: tint('fabric', o.color ?? FAB90[v]) }),
  build(b, gv, rng) {
    const FX = 0.195, FZ = 0.185, Y0 = 0.008, YS = 0.4;
    const pz = (y) => -0.172 - (y - 0.47) * 0.2025; // back post line (z at height y)
    const tilt = -0.2;
    const LEGS = [];
    for (const s of [-1, 1]) {
      // tapered front leg with eased edges
      const g = boxGeo(0.034, YS - Y0, 0.034, { r: 0.006, grain: 'y', wear: 0.012 });
      g.taper(1, -(YS - Y0) / 2, (YS - Y0) / 2, 0.74, 1);
      b.put('wood', g, s * FX, Y0 + (YS - Y0) / 2, FZ);
      glide(b, '#2a2927', s * FX, 0, FZ, 0.0105, Y0);
      LEGS.push([[s * FX, 0.016, FZ], [s * FX, YS - 0.06, FZ]]);
      // rear leg + back post: one bent piece, oval section
      const path = roundPath([[s * 0.2, Y0, -0.215], [s * 0.196, 0.24, -0.19], [s * FX, 0.47, pz(0.47)], [s * 0.193, 0.872, pz(0.872)]], 0.09, 6);
      b.tube('wood', path, [0.0145, 0.0172], { radial: 10, caps: [true, 'round'] });
      glide(b, '#2a2927', s * 0.2, 0, -0.215, 0.0105, Y0);
      LEGS.push([[s * 0.2, 0.016, -0.215], [s * FX, YS - 0.06, pz(0.4)]]);
      // side apron (tenoned into both legs)
      b.box('wood', 0.02, 0.062, 0.36, s * 0.199, YS - 0.031, 0.006, { r: 0.003, grain: 'z' });
      // turned side stretcher
      spindle(b, 'wood', [s * FX, 0.165, FZ], [s * 0.198, 0.155, -0.2], 0.0072, 0.0105);
    }
    // front / back aprons
    b.box('wood', 0.37, 0.062, 0.02, 0, YS - 0.031, FZ + 0.004, { r: 0.003, grain: 'x' });
    b.box('wood', 0.37, 0.062, 0.02, 0, YS - 0.031, -0.176, { r: 0.003, grain: 'x' });
    spindle(b, 'wood', [-0.198, 0.16, -0.005], [0.198, 0.16, -0.005], 0.0068, 0.0095);
    // corner glue blocks with screws (visible when the chair tips over)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * 0.187, cz = sz > 0 ? 0.172 : -0.163;
      const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-sx * 0.05, 0), new THREE.Vector2(0, sz * 0.05)]);
      // shape (x, y) -> world (x, -z) after rot X(+90deg): flip y sign so the block points inwards
      b.ext('wood', sh, 0.032, cx, YS - 0.025, cz, { rot: [-HP, 0, 0], bevel: 0.0015, bevelSeg: 1 });
      const n = V(-sx, 0, -sz).normalize();
      screw(b, '#8c8a86', [cx - sx * 0.0255, YS - 0.025, cz - sz * 0.0255], n, 0.0033, 'phillips');
    }
    // plywood seat deck (hidden inside the upholstery)
    b.box('wood', 0.36, 0.012, 0.35, 0, YS + 0.004, 0.004, { r: 0.002, grain: 'x' });
    // upholstered drop-in seat with piping
    const cu = cushionGeo(0.412, 0.06, 0.4, { r: 0.026, cell: 0.03, crown: 0.01, topOnly: true, bulge: 0.005, sag: { x: 0, z: 0.03, rx: 0.13, rz: 0.12, d: gv ? 0.013 : 0.009 }, wrinkle: 0.0022, wrinkleFreq: 12, seed: 3 + gv * 5, frontRoll: true });
    const cy = YS + 0.001 + 0.03;
    b.put('seat', cu.geo, 0, cy, 0.006);
    piping(b, 'seat', cu.seams.top, 0, cy, 0.006, 0.0032);
    // back: top rail (bowed), lower rail and an upholstered pad
    const railAt = (w, h, d, y, bow) => {
      const g = boxGeo(w, h, d, { r: Math.min(0.007, d * 0.32), grain: 'x', wear: 0.01 });
      g.bend(2, 0, bow);
      const c = V(0, y, pz(y) - 0.002 - bow * 0.03);
      b.put('wood', g, c.x, c.y, c.z, { rot: [tilt, 0, 0] });
      const R = new THREE.Matrix4().makeRotationX(tilt).setPosition(c);
      return (lx, ly, lz) => V(lx, ly, lz).applyMatrix4(R);
    };
    const topRail = railAt(0.386, 0.064, 0.024, 0.81, 0.32);
    railAt(0.376, 0.03, 0.02, 0.555, 0.32);
    const pad = cushionGeo(0.34, 0.03, 0.212, { r: 0.013, cell: 0.03, crown: 0.008, topOnly: true, bulge: 0.003, wrinkle: 0.0014, wrinkleFreq: 15, seed: 7 });
    pad.geo.bend(1, 0, 0.3); // follow the bowed rails
    const py = 0.683, pzz = pz(py) + 0.012;
    b.put('seat', pad.geo, 0, py, pzz, { rot: [HP + tilt, 0, 0] });
    piping(b, 'seat', pad.seams.top, 0, py, pzz, 0.0027, [HP + tilt, 0, 0]);
    // property tag on the back of the top rail
    const tp = topRail(0, 0.002, -0.0127);
    b.decal('asset_tag', 0.058, 0.022, tp.x, tp.y, tp.z, { rot: [tilt, PI, 0], slot: 'atlas' });
    if (gv === 1) {
      b.decal('stain', 0.15, 0.13, 0.05, cy + 0.0335, 0.04, { rot: [-HP, 0, 0.7] });
      b.decal('waterstain', 0.12, 0.12, -0.08, py + 0.03, pzz + 0.016, { rot: [tilt, 0, 0.3] });
    }
    return {
      colliders: [
        CB(0.43, 0.13, 0.415, 0, YS - 0.002, 0.006),
        CB(0.41, 0.4, 0.05, 0, 0.685, pz(0.685) - 0.004, tilt),
        ...LEGS.map(([a, c]) => CPbetween(a, c, 0.016)),
      ],
      mass: 6.5, material: 'wood', breakInto: ['plank', 'plank', 'fabric', 'screws'],
      anchors: { seat: [0, 0.47, 0.02], back: [0, 0.69, -0.2] },
      stackOffset: [0, 0.09, -0.035],
    };
  },
});

// ===========================================================================
// Office task chair (1990s): 5-star nylon/chrome base with twin-wheel casters, gas lift with a
// telescoping shroud, tilt mechanism, molded foam seat with waterfall front, J-bar back with a
// plastic back shell, T-arms or chrome loop arms. The seat assembly is the 'seat' part (spins).
// ===========================================================================
const OFFICE_FAB = [0x3b4658, 0x5b5249, 0x2c2e33, 0x46304a];
def('chair_office', {
  variants: 4,
  geoVariant: (v) => (v === 1 || v === 3 ? 1 : 0),
  mats: (o, v) => ({ seat: tint('fabric', o.color ?? OFFICE_FAB[v]) }),
  build(b, gv) {
    const chromeBase = gv === 1;
    const baseMat = chromeBase ? 'chrome' : 'plastic_black';
    const bits = chromeBase ? 'chrome' : '#c9cbcd:m'; // small bright-metal bits
    const legTop = 0.112, legEnd = 0.088;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.31, ca = Math.cos(a), sa = Math.sin(a);
      const g = boxGeo(0.27, 0.04, 0.046, { r: 0.012, seg: 1, grain: 'x', wear: 0 });
      g.taper(0, -0.135, 0.135, 1, 0.72);
      g.deform((p) => { const t = (p.x + 0.135) / 0.27; p.y -= t * t * 0.018 + (p.y < 0 ? t * 0.006 : 0); });
      b.put(baseMat, g, ca * 0.18, legTop - 0.02, sa * 0.18, { rot: [0, -a, 0] });
      // caster socket boss under the leg end
      b.cyl(baseMat, 0.013, 0.016, ca * 0.31, legEnd - 0.03, sa * 0.31, { seg: 10, bevel: 0.003 });
      caster(b, ca * 0.31, sa * 0.31, a + 1.3 + i * 0.7, legEnd - 0.038, { stem: '#c9cbcd:m', seg: 12 });
    }
    // hub + gas lift with telescoping shroud
    b.lathe(baseMat, [[0.036, 0.075, 1], [0.052, 0.08], [0.056, 0.1], [0.05, 0.128], [0.034, 0.135, 1], [0.034, 0.14]], 0, 0, 0, { seg: 20 });
    b.lathe(chromeBase ? '#1b1b1d:g' : 'plastic_black', [[0.032, 0.135], [0.033, 0.2], [0.03, 0.203, 1], [0.03, 0.25], [0.027, 0.253, 1], [0.027, 0.29], [0.024, 0.293], [0.016, 0.296]], 0, 0, 0, { seg: 18 });
    // --- rotating seat assembly ---
    const p = b.part('seat', 0, 0.33, 0, { axis: 'y', spin: true });
    p.cyl(bits, 0.0142, 0.07, 0, 0.325, 0, { seg: 12 });
    // tilt mechanism: pressed steel housing, tension knob, height lever
    p.box('plastic_black', 0.2, 0.034, 0.25, 0, 0.372, 0.0, { r: 0.006, wear: 0.008 });
    p.box('plastic_black', 0.13, 0.02, 0.07, 0, 0.35, 0.03, { r: 0.005 });
    p.cyl('plastic_black', 0.026, 0.03, 0, 0.36, 0.142, { axis: 'z', seg: 18, bevel: 0.004 });
    p.cyl(bits, 0.008, 0.04, 0, 0.36, 0.115, { axis: 'z', seg: 8 });
    p.tube(bits, [[0.09, 0.37, 0.06], [0.2, 0.37, 0.08], [0.235, 0.364, 0.11]], 0.0042, { radial: 6, round: 0.03 });
    p.box('plastic_black', 0.03, 0.012, 0.05, 0.246, 0.362, 0.12, { r: 0.005, rot: [0, -0.35, 0] });
    // seat pan (black shell) + molded foam seat with waterfall front
    p.box('plastic_black', 0.47, 0.026, 0.45, 0, 0.402, 0.0, { r: 0.012, seg: 2 });
    const cu = cushionGeo(0.49, 0.085, 0.47, { r: 0.04, cell: 0.045, crown: 0.012, topOnly: true, bulge: 0.006, sag: { x: 0, z: 0.0, rx: 0.15, rz: 0.13, d: 0.012 }, wrinkle: 0.0018, wrinkleFreq: 11, seed: 21, frontRoll: true });
    cu.geo.deform((q) => { if (q.z > 0.12) q.y -= (q.z - 0.12) ** 2 * 0.6; }); // waterfall
    const sy = 0.414 + 0.0425;
    p.put('seat', cu.geo, 0, sy, 0.0);
    piping(p, 'plastic_black', cu.seams.bottom, 0, sy, 0, 0.0045, null, 1);
    // back: plastic outer shell + upholstered cushion (wrapped, lumbar curve) on a J-bar
    const tilt = -0.11, yc = 0.775, zc = -0.3;
    const zBack = (y) => zc - 0.017 + Math.tan(tilt) * (y - yc);
    p.tube('plastic_black', roundPath([[0, 0.384, -0.06], [0, 0.384, -0.2], [0, 0.45, zBack(0.45) - 0.009], [0, 0.6, zBack(0.6) - 0.009], [0, 0.71, zBack(0.71) - 0.009]], 0.07, 6), [0.0065, 0.031], { radial: 10, caps: [true, 'round'] });
    p.cyl('plastic_black', 0.024, 0.028, 0, 0.64, zBack(0.64) - 0.031, { axis: 'z', seg: 16, bevel: 0.004 });
    const shell = boxGeo(0.43, 0.47, 0.034, { r: 0.016, seg: 2, wear: 0 });
    shell.bend(2, 0, 0.32);
    p.put('plastic_black', shell, 0, yc, zc, { rot: [tilt, 0, 0] });
    const bk = cushionGeo(0.44, 0.07, 0.48, { r: 0.032, cell: 0.045, crown: 0.012, topOnly: true, bulge: 0.004, wrinkle: 0.0015, wrinkleFreq: 12, seed: 22 });
    bk.geo.bend(1, 0, 0.32);
    bk.geo.deform((q) => { q.y += Math.exp(-(((q.z + 0.07) / 0.09) ** 2)) * 0.012; }); // lumbar bump
    const bkz = zc + 0.017 + 0.033;
    p.put('seat', bk.geo, 0, yc + 0.005, bkz, { rot: [HP + tilt, 0, 0] });
    piping(p, 'plastic_black', bk.seams.bottom, 0, yc + 0.005, bkz, 0.004, [HP + tilt, 0, 0], 1);
    p.decal('asset_tag', 0.07, 0.026, 0, 0.86, zBack(0.86) - 0.0012, { rot: [tilt, PI, 0], slot: 'atlas' });
    // arms
    for (const s of [-1, 1]) {
      if (!chromeBase) {
        p.box('plastic_black', 0.17, 0.014, 0.06, s * 0.17, 0.381, 0.0, { r: 0.004 });
        screw(p, '#3a3a3a', [s * 0.12, 0.374, 0.012], [0, -1, 0], 0.005, 'hex');
        screw(p, '#3a3a3a', [s * 0.12, 0.374, -0.012], [0, -1, 0], 0.005, 'hex');
        const post = boxGeo(0.034, 0.24, 0.062, { r: 0.012, seg: 2, wear: 0.008 });
        post.deform((q) => { q.z += (q.y + 0.12) * 0.06; }, false);
        p.put('plastic_black', post, s * 0.262, 0.5, 0.005);
        p.box('plastic_black', 0.05, 0.03, 0.08, s * 0.258, 0.392, 0.0, { r: 0.006 });
        const pad = cushionGeo(0.076, 0.03, 0.26, { r: 0.012, cell: 0.04, crown: 0.003, wrinkle: 0 });
        p.put('plastic_black', pad.geo, s * 0.262, 0.635, 0.02);
      } else {
        // chrome loop arm: flat bar from under the seat, up and around to the arm pad
        const path = roundPath([[s * 0.15, 0.386, -0.12], [s * 0.262, 0.386, -0.12], [s * 0.262, 0.6, -0.14], [s * 0.262, 0.6, 0.15], [s * 0.262, 0.43, 0.12]], 0.05, 6);
        p.tube('chrome', path, [0.006, 0.019], { radial: 10, caps: [true, 'round'], up: [s, 0, 0] });
        const pad = cushionGeo(0.06, 0.026, 0.24, { r: 0.011, cell: 0.04, crown: 0.003, wrinkle: 0 });
        p.put('plastic_black', pad.geo, s * 0.262, 0.62, 0.005);
      }
    }
    return {
      colliders: [
        CC(0.32, 0.1, 0, 0.05, 0), CC(0.032, 0.26, 0, 0.23, 0),
        CB(0.5, 0.12, 0.48, 0, 0.44, 0), CB(0.45, 0.5, 0.09, 0, 0.775, -0.3, tilt),
        CB(0.08, 0.27, 0.27, -0.262, 0.52, 0.01), CB(0.08, 0.27, 0.27, 0.262, 0.52, 0.01),
      ],
      mass: 15, material: 'plastic', friction: 0.12, angularDamping: 0.9, breakInto: ['metal_scrap', 'fabric', 'foam', 'screws', 'wheel'],
      anchors: { seat: [0, 0.53, 0.03] },
    };
  },
});

// ===========================================================================
// Steel folding chair: tube frame, pressed steel seat with rolled edges, curved back panel,
// rivets at the pivots, plastic foot caps. Variant geometry 1 = padded vinyl seat.
// ===========================================================================
const FOLD_COL = [0xc4b896, 0x7c8084, 0x5b4636, 0x2f3a46];
def('chair_folding', {
  variants: 4,
  geoVariant: (v) => (v === 2 ? 1 : 0),
  mats: (o, v) => ({ frame: tint('paint_beige', o.color ?? FOLD_COL[v]) }),
  build(b, gv) {
    const r = 0.0105, F = [], Rl = [];
    for (const s of [-1, 1]) {
      const foot = [s * 0.205, 0.016, 0.218], seatB = [s * 0.2, 0.462, -0.11], top = [s * 0.19, 0.826, -0.2];
      b.tube('frame', roundPath([foot, seatB, top], 0.09, 6), r, { radial: 10, caps: [true, 'round'] });
      const rf = [s * 0.182, 0.016, -0.252], rt = [s * 0.182, 0.448, 0.172];
      b.tube('frame', [rf, rt], r * 0.95, { radial: 10, caps: [true, 'round'] });
      // plastic foot caps
      b.cyl('#232322', 0.0135, 0.026, foot[0], 0.013, foot[2] + 0.003, { rt: 0.0128, seg: 10, bevel: 0.003 });
      b.cyl('#232322', 0.0132, 0.026, rf[0], 0.013, rf[2] - 0.003, { rt: 0.0125, seg: 10, bevel: 0.003 });
      // pivot rivets
      screw(b, 'zinc', [s * 0.212, 0.284, 0.016], [s, 0, 0], 0.0065, 'rivet');
      screw(b, 'zinc', [s * 0.21, 0.45, 0.172], [s, 0, 0], 0.0055, 'rivet');
      b.cyl('zinc', 0.0035, 0.044, s * 0.193, 0.284, 0.016, { axis: 'x', seg: 6 });
      F.push([[foot[0], 0.013, foot[2] + 0.003], seatB]); Rl.push([[rf[0], 0.013, rf[2] - 0.003], rt]);
      // seat side rails (pressed channel)
      b.box('frame', 0.013, 0.024, 0.37, s * 0.19, 0.45, 0.03, { r: 0.004, wear: 0.006 });
    }
    // cross braces
    b.cyl('frame', 0.0085, 0.41, 0, 0.1, 0.215 - 0.7 * 0.088, { axis: 'x', seg: 8 });
    b.cyl('frame', 0.0085, 0.366, 0, 0.08, -0.25 + 0.93 * 0.068, { axis: 'x', seg: 8 });
    b.cyl('frame', 0.0085, 0.366, 0, 0.448, 0.172, { axis: 'x', seg: 8 });
    // pressed steel seat pan: rolled edge, slight dish, stamped ribs underneath
    const pan = boxGeo(0.405, 0.024, 0.392, { r: 0.0105, seg: 2, wear: 0.012 });
    pan.deform((q) => { if (q.y > 0) q.y -= 0.005 * (1 - (q.x / 0.2) ** 2) * (1 - (q.z / 0.196) ** 2); }, false);
    b.put('frame', pan, 0, 0.466, 0.03);
    for (const x of [-0.08, 0.08]) b.box('frame', 0.022, 0.01, 0.3, x, 0.451, 0.03, { r: 0.004 });
    if (gv === 1) {
      const cu = cushionGeo(0.39, 0.04, 0.375, { r: 0.016, cell: 0.03, crown: 0.006, topOnly: true, sag: { x: 0, z: 0.02, rx: 0.13, rz: 0.12, d: 0.005 }, wrinkle: 0.0018, wrinkleFreq: 13, seed: 31 });
      b.put('vinyl_black', cu.geo, 0, 0.478 + 0.02, 0.03);
      piping(b, 'vinyl_black', cu.seams.top, 0, 0.498, 0.03, 0.0028);
    }
    // curved back panel with rolled edges
    const bp = boxGeo(0.372, 0.135, 0.016, { r: 0.0075, seg: 2, wear: 0.012 });
    bp.bend(2, 0, 0.36);
    b.put('frame', bp, 0, 0.738, -0.196, { rot: [-0.245, 0, 0] });
    b.decal('asset_tag', 0.06, 0.022, 0, 0.738, -0.208, { rot: [-0.245, PI, 0], slot: 'atlas' });
    b.decal('asset_tag', 0.06, 0.022, 0.1, 0.438, 0.04, { rot: [HP, 0, 0], slot: 'atlas' });
    return {
      colliders: [
        CB(0.41, 0.035 + (gv ? 0.04 : 0), 0.395, 0, 0.462 + (gv ? 0.02 : 0), 0.03), CB(0.38, 0.15, 0.03, 0, 0.738, -0.198, -0.245),
        ...F.map(([a, c]) => CPbetween(a, c, 0.013)), ...Rl.map(([a, c]) => CPbetween(a, c, 0.013)),
      ],
      mass: 3.8, material: 'metal', breakInto: ['metal_tube', 'metal_tube', 'screws'],
      anchors: { seat: [0, 0.49, 0.03] },
    };
  },
});

// ===========================================================================
// Shop / counter stool: chrome tube legs with a welded foot ring, vinyl seat with piping.
// ===========================================================================
def('stool', {
  variants: 3,
  mats: (o, v) => ({ cushion: o.color !== undefined ? tint('vinyl_red', o.color) : matFor(['vinyl_red', 'vinyl_black', 'vinyl_red'][v]) }),
  build(b) {
    const H = 0.668;
    // seat: vinyl cushion over a steel pan
    b.lathe('cushion', [[0, 0.6, 0], [0.165, 0.6], [0.178, 0.604], [0.186, 0.618], [0.188, 0.632], [0.186, 0.646], [0.178, 0.658], [0.15, 0.665], [0.08, 0.668], [0, H]], 0, 0, 0, { seg: 32 });
    b.tube('cushion', Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * TAU; return [Math.cos(a) * 0.1885, 0.632, Math.sin(a) * 0.1885]; }), 0.0034, { radial: 6, closed: true });
    b.lathe('#232426', [[0.0, 0.585], [0.15, 0.585, 1], [0.155, 0.59], [0.155, 0.6, 1], [0.0, 0.6]], 0, 0, 0, { seg: 24 });
    const L = [];
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + (i * PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
      const top = [ca * 0.118, 0.585, sa * 0.118], foot = [ca * 0.212, 0.03, sa * 0.212];
      b.tube('chrome', [top, foot], 0.0118, { radial: 10, caps: [true, false] });
      // mounting bracket + screws under the seat pan
      b.box('#232426', 0.04, 0.012, 0.04, ca * 0.112, 0.58, sa * 0.112, { r: 0.003, rot: [0, -a, 0] });
      screw(b, '#a9abad:m', [ca * 0.098, 0.574, sa * 0.098], [0, -1, 0], 0.004, 'phillips');
      // rubber foot cap
      b.cylBetween('#1a1a1b', [foot[0] * 1.005, 0, foot[2] * 1.005], [foot[0] * 0.992, 0.034, foot[2] * 0.992], 0.0148, 0.0138, { seg: 12, bevel: 0.003 });
      L.push([[ca * 0.213, 0.0148, sa * 0.213], top]);
    }
    // foot ring (welded to the legs)
    const rr = 0.185;
    b.tube('chrome', Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * TAU; return [Math.cos(a) * rr, 0.24, Math.sin(a) * rr]; }), 0.0082, { radial: 8, closed: true });
    for (let i = 0; i < 4; i++) { const a = PI / 4 + (i * PI) / 2; b.sphere('chrome', 0.0115, Math.cos(a) * 0.186, 0.24, Math.sin(a) * 0.186, { ws: 8, hs: 6 }); }
    return {
      colliders: [CC(0.188, 0.083, 0, 0.6265, 0), ...L.map(([a, c]) => CPbetween(a, c, 0.0148))],
      mass: 4.2, material: 'metal', angularDamping: 2.2, linearDamping: 0.4, breakInto: ['metal_tube', 'foam', 'screws'],
      anchors: { seat: [0, 0.67, 0], top: [0, 0.67, 0] },
    };
  },
});

// ===========================================================================
// Sofa / armchair (1990s contract lounge): upholstered base and arms with solid wood arm caps,
// tapered wood legs, boxed seat cushions and pillow back cushions with piping, sag & wrinkles.
// ===========================================================================
const SOFA_FAB = ['uph_teal', 'uph_mauve', 'fabric'];
function sofa(b, seats, gv, rng) {
  const sw = 0.6, aw = 0.175, W = seats * sw + 2 * aw, D = 0.84, legH = 0.1, baseTop = 0.3;
  // legs: tapered square wood legs with glides
  const lx = W / 2 - 0.07, lz = D / 2 - 0.07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = boxGeo(0.05, legH - 0.006, 0.05, { r: 0.006, grain: 'y' });
    g.taper(1, -(legH - 0.006) / 2, (legH - 0.006) / 2, 0.72, 1);
    b.put('wood', g, sx * lx, 0.006 + (legH - 0.006) / 2, sz * lz);
    glide(b, '#2a2927', sx * lx, 0, sz * lz, 0.014, 0.006);
  }
  // base / deck
  const base = cushionGeo(W - 2 * aw + 0.03, baseTop - legH, D - 0.03, { r: 0.022, cell: 0.07, crown: 0.0, bulge: 0.006, wrinkle: 0.0015, wrinkleFreq: 9, seed: 40 + gv });
  b.put('fab', base.geo, 0, legH + (baseTop - legH) / 2, 0.005);
  piping(b, 'fab', base.seams.top, 0, legH + (baseTop - legH) / 2, 0.005, 0.0042);
  // dust cover underneath
  b.box('#191919', W - 0.1, 0.004, D - 0.08, 0, legH + 0.002, 0, { r: 0, wear: 0 });
  // arms with wood caps
  const armH = 0.5;
  for (const s of [-1, 1]) {
    const ax = s * (W / 2 - aw / 2);
    const arm = cushionGeo(aw, armH, D, { r: 0.04, cell: 0.06, crown: 0.0, bulge: 0.01, wrinkle: 0.002, wrinkleFreq: 8, seed: 44 + s });
    b.put('fab', arm.geo, ax, legH + armH / 2, 0);
    piping(b, 'fab', arm.seams.top, ax, legH + armH / 2, 0, 0.0042);
    const cap = boxGeo(aw + 0.012, 0.034, D + 0.012, { r: 0.012, seg: 2, grain: 'z', wear: 0.014 });
    b.put('wood', cap, ax, legH + armH + 0.017 - 0.004, 0.0);
  }
  // back frame
  const bd = 0.17, bh = 0.84 - legH;
  const back = cushionGeo(W, bh, bd, { r: 0.045, cell: 0.065, crown: 0.0, bulge: 0.008, wrinkle: 0.002, wrinkleFreq: 8, seed: 48 });
  back.geo.deform((q) => { q.z += (q.y / bh + 0.5) * -0.02; }, false);
  b.put('fab', back.geo, 0, legH + bh / 2, -D / 2 + bd / 2);
  piping(b, 'fab', back.seams.top, 0, legH + bh / 2, -D / 2 + bd / 2, 0.0042);
  // loose cushions
  const cd = D - bd - 0.025, cz = -D / 2 + bd + cd / 2 + 0.005;
  for (let i = 0; i < seats; i++) {
    const x = (i - (seats - 1) / 2) * sw;
    const used = i === 0 ? 1 : 0.55;
    const sc = cushionGeo(sw - 0.012, 0.15, cd, { r: 0.034, cell: 0.042, crown: 0.016, bulge: 0.008, sag: { x: (rng.next() - 0.5) * 0.06, z: 0.04, rx: 0.2, rz: 0.17, d: 0.018 * used + 0.004 }, wrinkle: 0.0026, wrinkleFreq: 9, seed: 50 + i + gv * 7, frontRoll: true, sideWrinkle: true });
    const yaw = (rng.next() - 0.5) * 0.03;
    b.put('fab', sc.geo, x + (rng.next() - 0.5) * 0.008, baseTop + 0.075, cz, { rot: [0, yaw, 0] });
    piping(b, 'fab', sc.seams.top, x, baseTop + 0.075, cz, 0.0045, [0, yaw, 0]);
    piping(b, 'fab', sc.seams.bottom, x, baseTop + 0.075, cz, 0.0045, [0, yaw, 0]);
    // pillow back cushion, leaning back
    const tilt = -0.2 - rng.next() * 0.05;
    const bc = cushionGeo(sw - 0.016, 0.16, 0.44, { r: 0.07, cell: 0.042, crown: 0.022, bulge: 0.012, wrinkle: 0.0032, wrinkleFreq: 8, seed: 60 + i + gv * 3, sideWrinkle: true });
    const by = baseTop + 0.15 + 0.2, bz = -D / 2 + bd + 0.07;
    b.put('fab', bc.geo, x, by, bz, { rot: [HP + tilt, 0, 0] });
    piping(b, 'fab', bc.seams.top, x, by, bz, 0.0045, [HP + tilt, 0, 0]);
  }
  b.decal('stain', 0.18, 0.15, -(seats - 1) / 2 * sw + 0.04, baseTop + 0.15 + 0.014, 0.06, { rot: [-HP, 0, 0.4] });
  return { W, D, aw, legH, baseTop, bd };
}
const sofaCols = ({ W, D, aw, legH, bd }) => [
  CB(aw, legH + 0.535, D, -(W / 2 - aw / 2), (legH + 0.535) / 2, 0), CB(aw, legH + 0.535, D, W / 2 - aw / 2, (legH + 0.535) / 2, 0),
  CB(W - 2 * aw, 0.36, D - 0.03, 0, legH + 0.18, 0.005), CB(W - 2 * aw, 0.74, bd + 0.08, 0, legH + 0.37, -D / 2 + (bd + 0.08) / 2),
];
def('couch', {
  variants: 6,
  mats: (o, v) => ({ fab: o.color !== undefined ? tint('fabric', o.color) : v % 3 === 2 ? tint('fabric', 0x5a4632) : matFor(SOFA_FAB[v % 3]), wood: matFor(v % 2 ? 'walnut' : 'teak') }),
  build(b, gv, rng) {
    const d = sofa(b, 2, gv, rng);
    return {
      colliders: sofaCols(d),
      mass: 48, material: 'fabric', breakInto: ['fabric', 'fabric', 'foam', 'foam', 'plank', 'spring'],
      anchors: { seat0: [-0.3, 0.47, 0.08], seat1: [0.3, 0.47, 0.08], seat: [-0.3, 0.47, 0.08] },
    };
  },
});
def('armchair', {
  variants: 6,
  mats: (o, v) => ({ fab: o.color !== undefined ? tint('fabric', o.color) : v % 3 === 2 ? tint('fabric', 0x4a3a2a) : matFor(SOFA_FAB[v % 3]), wood: matFor(v % 2 ? 'walnut' : 'teak') }),
  build(b, gv, rng) {
    const d = sofa(b, 1, gv, rng);
    return {
      colliders: sofaCols(d),
      mass: 28, material: 'fabric', breakInto: ['fabric', 'foam', 'plank', 'spring'],
      anchors: { seat: [0, 0.47, 0.08] },
    };
  },
});
