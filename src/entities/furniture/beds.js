// Beds & soft goods: innerspring mattress, metal dorm bed with bedding, burlap sandbag.
import * as THREE from 'three';
import { def, Geo, boxGeo, cylGeo, latheGeo, tubeGeo, cushionGeo, gridGeo, roundPath, CB, CC, CP, V, PI, TAU, HP, clamp, lerp, smooth, noise3, fbm3 } from './core.js';
import { matFor, tint } from './mats.js';
import { screw, glide, caster } from './parts.js';
import { piping } from './seating.js';

// innerspring mattress: quilted ticking with tufts, tape-edge binding, handles, vents
function mattressInto(b, w, h, l, y0, gv) {
  const tufts = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 7; j++) tufts.push([(i - 1) * w * 0.3, (j - 3) * l * 0.135]);
  const m = cushionGeo(w, h, l, { r: 0.05, cell: 0.07, crown: 0.012, topOnly: true, flatBottom: true, bulge: 0.012, wrinkle: 0.0018, wrinkleFreq: 6, seed: 90 + gv, buttons: tufts, buttonDepth: 0.014, buttonR: 0.07, sideWrinkle: true });
  // body sag in the middle (old mattress)
  m.geo.deform((q) => { q.y -= Math.exp(-((q.z / (l * 0.32)) ** 2)) * 0.012 * (q.y / h + 0.5); });
  b.put('ticking', m.geo, 0, y0 + h / 2, 0);
  piping(b, 'tape_edge', m.seams.top, 0, y0 + h / 2, 0, 0.0085, null, 1);
  piping(b, 'tape_edge', m.seams.bottom, 0, y0 + h / 2, 0, 0.0085, null, 1);
  for (const [x, z] of tufts) b.cyl('tape_edge', 0.012, 0.006, x, y0 + h - 0.002 + 0.012 - 0.014 + 0.003, z, { seg: 8, bevel: 0.002 });
  // side handles + vents
  for (const s of [-1, 1]) {
    for (const z of [-0.3, 0.3]) b.tube('tape_edge', [[s * (w / 2 + 0.004), y0 + h * 0.5, z * l / 1.9 - 0.06], [s * (w / 2 + 0.022), y0 + h * 0.48, z * l / 1.9 - 0.03], [s * (w / 2 + 0.022), y0 + h * 0.48, z * l / 1.9 + 0.03], [s * (w / 2 + 0.004), y0 + h * 0.5, z * l / 1.9 + 0.06]], [0.012, 0.003], { radial: 6, up: [0, 1, 0] });
    for (const z of [-0.6, -0.2, 0.2, 0.6]) {
      b.cyl('#a8acae:m', 0.007, 0.003, s * (w / 2 + 0.012), y0 + h * 0.5, z * l / 2.1, { axis: 'x', seg: 10, open: false });
      b.cyl('#1a1a1a', 0.0045, 0.0034, s * (w / 2 + 0.012), y0 + h * 0.5, z * l / 2.1, { axis: 'x', seg: 8 });
    }
  }
}

def('mattress', {
  variants: 1,
  build(b, gv) {
    mattressInto(b, 0.9, 0.19, 1.9, 0, 1);
    { b.decal('waterstain', 0.42, 0.42, 0.12, 0.19 + 0.0215, 0.35, { rot: [-HP, 0, 0.4] }); b.decal('stain', 0.2, 0.18, -0.2, 0.19 + 0.0215, -0.5, { rot: [-HP, 0, 1.2] }); }
    return { colliders: [CB(0.9, 0.19, 1.9, 0, 0.095, 0)], mass: 14, material: 'soft', breakInto: ['fabric', 'foam', 'foam', 'spring'], anchors: { sleep: [0, 0.2, 0], top: [0, 0.19, 0] } };
  },
});

// blanket / sheet drape: a grid that lies on the bed top and falls over both long sides
function drapeGeo(w, l, top, edge, rb, maxDrop, nx, nz, seed, wr = 0.008, fold = 0) {
  const g = gridGeo(w, l, nx, nz);
  const ph = seed * 1.7;
  for (let i = 0; i < g.count; i++) {
    const x = g.p[i * 3], z = g.p[i * 3 + 2];
    const d = Math.abs(x) - edge;
    let nx2 = x, ny = top;
    if (d > 0) {
      const arc = rb * HP;
      if (d < arc) { const a = d / rb; nx2 = Math.sign(x) * (edge + rb * Math.sin(a)); ny = top - rb * (1 - Math.cos(a)); }
      else { nx2 = Math.sign(x) * (edge + rb); ny = top - rb - Math.min(d - arc, maxDrop); }
    }
    const n1 = fbm3(x * 5 + ph, 0, z * 3, seed, 3) - 0.5, n2 = noise3(x * 14, 3, z * 9 + ph, seed + 2) - 0.5;
    const folds = Math.sin(z * 11 + n1 * 3 + ph) * 0.5 + Math.sin(z * 23 + x * 4) * 0.2;
    const wv = wr * (n1 * 1.6 + n2 * 0.6 + folds * 0.4);
    if (d > 0) nx2 += Math.sign(x) * (Math.abs(wv) * 1.2 + Math.max(0, d - rb * HP) * 0.02); else ny += wv * 0.6 + 0.003;
    // turned-down fold at the head end
    if (fold && z < -l / 2 + fold) ny += 0.006;
    g.p[i * 3] = nx2; g.p[i * 3 + 1] = ny;
    g.uv[i * 2] = x; g.uv[i * 2 + 1] = -z;
  }
  g.computeNormals(false);
  // thickness: duplicate as back face so the cloth is visible from below
  const back = new Geo().append(g).flip();
  for (let i = 0; i < back.count; i++) back.p[i * 3 + 1] -= 0.002;
  return g.append(back);
}

def('bed', {
  variants: 3,
  mats: (o, v) => ({ frame: tint('paint_green', [0x3e4a44, 0xd8d5cc, 0x26272a][v]), blanket: tint('fabric', o.color ?? [0x5b6878, 0x7a3434, 0x6b6248][v]) }),
  build(b, gv, rng) {
    const L = 1.98, W = 0.94, yM = 0.33, mh = 0.19, top = yM + mh;
    // head / foot boards: tube frame + spindles + cap balls
    for (const [z, hgt, sp] of [[-L / 2, 0.95, 7], [L / 2, 0.66, 5]]) {
      b.tube('frame', roundPath([[-W / 2, 0.03, z], [-W / 2, hgt, z], [W / 2, hgt, z], [W / 2, 0.03, z]], 0.09, 7), 0.016, { radial: 12, caps: true });
      b.cyl('frame', 0.009, W, 0, 0.4, z, { axis: 'x', seg: 10 });
      b.cyl('frame', 0.009, W, 0, hgt - 0.16, z, { axis: 'x', seg: 10 });
      for (let i = 0; i < sp; i++) { const x = ((i + 1) / (sp + 1) - 0.5) * W; b.cyl('frame', 0.0068, hgt - 0.16 - 0.4, x, (hgt - 0.16 + 0.4) / 2, z, { seg: 8 }); }
      for (const s of [-1, 1]) {
        b.lathe('frame', [[0, 0], [0.019, 0.002], [0.02, 0.012], [0.017, 0.018], [0.019, 0.026, 1], [0, 0.03]], s * W / 2, 0.0, z, { seg: 12 });
        for (const y of [0.4, hgt - 0.16]) b.sphere('frame', 0.012, s * (W / 2 - 0.002), y, z, { ws: 10, hs: 6 });
      }
    }
    // side rails (angle iron) with bolts, link-spring deck
    for (const s of [-1, 1]) {
      b.box('frame', 0.004, 0.042, L - 0.02, s * (W / 2 - 0.012), yM - 0.024, 0, { r: 0.0015, grain: 'z' });
      b.box('frame', 0.036, 0.004, L - 0.02, s * (W / 2 - 0.03), yM - 0.043, 0, { r: 0.0015, grain: 'z' });
      for (const z of [-L / 2 + 0.03, L / 2 - 0.03]) screw(b, '#4a4a48', [s * (W / 2 + 0.002), yM - 0.024, z], [s, 0, 0], 0.006, 'hex');
    }
    for (let i = 0; i < 9; i++) b.box('#6a6c6e:m', W - 0.06, 0.002, 0.004, 0, yM - 0.041, -L / 2 + 0.1 + i * (L - 0.2) / 8, { r: 0, wear: 0 });
    for (let i = 0; i < 11; i++) b.box('#6a6c6e:m', 0.003, 0.002, L - 0.06, -W / 2 + 0.06 + i * (W - 0.12) / 10, yM - 0.04, 0, { r: 0, wear: 0 });
    mattressInto(b, W - 0.04, mh, L - 0.06, yM - 0.002, gv);
    // fitted sheet top layer, pillow, blanket with turned-down sheet
    const pil = cushionGeo(0.6, 0.13, 0.38, { r: 0.06, cell: 0.04, crown: 0.02, bulge: 0.02, wrinkle: 0.005, wrinkleFreq: 9, seed: 95 + gv, sag: { x: 0.04, z: 0, rx: 0.14, rz: 0.1, d: 0.03 }, sideWrinkle: true });
    b.put('linen', pil.geo, 0, top + 0.06, -L / 2 + 0.26, { rot: [-0.14, 0.03 * (gv - 1), 0] });
    const bz0 = -L / 2 + 0.56, bl = L - 0.6;
    b.geo('blanket', drapeGeo(W + 0.24, bl, top + 0.012, (W - 0.04) / 2 + 0.006, 0.04, 0.24, 26, 30, 3 + gv, 0.01), 0, 0, bz0 + bl / 2 - 0.02);
    b.geo('linen', drapeGeo(W + 0.12, 0.18, top + 0.022, (W - 0.04) / 2 + 0.014, 0.034, 0.1, 18, 4, 7 + gv, 0.004), 0, 0, bz0 + 0.06);
    return {
      colliders: [CB(W, mh + 0.05, L - 0.06, 0, yM + mh / 2 - 0.02, 0), CB(W + 0.03, 0.95, 0.035, 0, 0.475, -L / 2), CB(W + 0.03, 0.66, 0.035, 0, 0.33, L / 2)],
      mass: 46, material: 'metal', friction: 0.45, breakInto: ['metal_tube', 'metal_tube', 'fabric', 'foam', 'spring'],
      anchors: { sleep: [0, top + 0.02, -0.15], pillow: [0, top + 0.08, -L / 2 + 0.26], under: [0, 0.15, 0], top: [0, top, 0.3] },
    };
  },
});

// ===========================================================================
// Burlap sandbag: filled, slumped sack with a gathered, twine-tied neck and a stencilled print.
// ===========================================================================
def('sandbag', {
  variants: 1,
  build(b, gv) {
    const c = cushionGeo(0.46, 0.12, 0.27, { r: 0.055, cell: 0.03, crown: 0.012, topOnly: true, flatBottom: true, bulge: 0.02, wrinkle: 0.006, wrinkleFreq: 9, seed: 100 + gv, sideWrinkle: true });
    c.geo.deform((q) => {
      // flat bottom, slumped top, gathered neck towards +x
      if (q.y < -0.045) q.y = -0.06 + (q.y + 0.06) * 0.25;
      const t = smooth(0.12, 0.23, q.x);
      q.y = lerp(q.y, q.y * 0.35 - 0.012, t);
      q.z = lerp(q.z, q.z * 0.28, t);
    });
    b.put('burlap', c.geo, 0, 0.06, 0);
    // neck & tie
    b.lathe('burlap', [[0.0, 0.0], [0.026, 0.004], [0.022, 0.03], [0.018, 0.05], [0.032, 0.075, 1], [0.0, 0.08]], 0.235, 0.05, 0, { rot: [0, 0, -HP], seg: 10 });
    for (let k = 0; k < 3; k++) b.tube('#c9b48a', Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * TAU; return [0.245 + k * 0.004, 0.05 + Math.sin(a) * 0.021, Math.cos(a) * 0.021]; }), 0.0022, { radial: 5, closed: true });
    b.tube('#c9b48a', [[0.25, 0.071, 0], [0.262, 0.06, 0.03], [0.255, 0.012, 0.05]], 0.0022, { radial: 5 });
    b.decal('sandbag_print', 0.2, 0.1, -0.03, 0.124, 0.0, { rot: [-HP + 0.05, 0, 0.05] });
    return { colliders: [CB(0.44, 0.115, 0.26, 0, 0.0575, 0)], mass: 18, material: 'soft', breakInto: ['fabric', 'sand', 'sand'] };
  },
});
