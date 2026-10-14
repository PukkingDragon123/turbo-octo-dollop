// The Bacteria — sculpted body. The whole emaciated anatomy is modelled as a signed-distance
// "clay" (smooth unions of bones, tendons, wasted muscle and taut skin; smooth carves for the eye
// pits, the mouth and a few eaten-through perforations), meshed with sparse surface nets, decimated
// and skinned by proximity to the primitives' bones (shared sculpt toolkit from ../stilllife/).
// Worker-safe (no DOM): bacteria_worker.js runs buildTemplateData() off the main thread.
//
// Output: flat typed arrays for one skinned geometry in bind space —
//   position, normal, skinIndex, skinWeight,
//   aTis (x: ambient occlusion, y: hard tissue (claws/teeth/bone tips), z: raw inner tissue, w: wetness)
import { Sculpt, MAT } from '../stilllife/sdf.js';
import { meshRaw, finishMesh, clusterBoxes } from '../stilllife/mesher.js';
import { rig, frameOf, D, FINGER_X, TENDRILS } from './bacteria_rig.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// small deterministic RNG (mulberry32)
function rng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (a, b) => a + (b - a) * next() };
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const HARD = MAT.RUBBER, INNER = MAT.INNER, SKIN = MAT.SKIN;

// ---------------------------------------------------------------------------
// Torso: pelvis, wasted abdomen, a rib cage you can count, spine, shoulder blades, collarbones
// ---------------------------------------------------------------------------
const SPINE_Y0 = 1.46; // sp0 origin (bind)
const spineBone = (y) => (y < SPINE_Y0 ? 'pelvis' : 'sp' + clamp(Math.floor((y - SPINE_Y0) / D.spine), 0, 4));

// rib cage core: half-width / half-depth / centre-z as a function of height
function cage(y) {
  const u = clamp((y - 1.70) / (2.33 - 1.70), 0, 1); // 0 bottom .. 1 top
  const w = 0.098 + 0.05 * Math.sin(Math.PI * Math.pow(u, 0.75)) - 0.03 * u * u;
  const d = 0.07 + 0.03 * Math.sin(Math.PI * Math.pow(u, 0.8));
  const cz = 0.012 - 0.008 * u;
  return { w, d, cz };
}

function torso(S, R) {
  // --- core column: overlapping ellipsoid slices (one bone each, so the skin bends with the
  // spine); over the rib cage they sit just under the ribs so the skin is stretched across them
  const slices = [
    // y, rx, ry, rz, cz
    [1.375, 0.104, 0.07, 0.066, 0.014],
    [1.46, 0.088, 0.07, 0.056, 0.022],
    [1.54, 0.08, 0.07, 0.05, 0.026],
    [1.62, 0.078, 0.07, 0.05, 0.026],
    [1.69, 0.086, 0.06, 0.056, 0.022],
  ];
  for (let y = 1.75; y <= 2.315; y += 0.045) {
    const c = cage(y);
    slices.push([y, c.w * 0.985, 0.06, c.d * 0.975, c.cz]);
  }
  S.with({ k: 0.04, noise: [0.0012, 38] }, () => {
    for (const [y, rx, ry, rz, cz] of slices) S.ell([0, y, cz], [rx, ry, rz], null, { bone: spineBone(y) });
  });
  // belly hollow: suck the front of the abdomen in under the ribs
  S.with({ k: 0.03, bone: 'sp0' }, () => {
    S.ell([0, 1.62, -0.072], [0.07, 0.085, 0.03], null, { sub: true, k: 0.035, bone: 'sp0' });
  });

  // --- wasted abdominal wall (two flat columns with tendinous bands) + serratus fingers
  S.with({ k: 0.016, noise: [0.0008, 60] }, () => {
    for (const s of [-1, 1]) {
      S.chain([[s * 0.024, 1.36, -0.045], [s * 0.026, 1.5, -0.03], [s * 0.028, 1.64, -0.026], [s * 0.032, 1.76, -0.05]], [0.014, 0.0135, 0.0135, 0.012], { bones: ['pelvis', 'sp0', 'sp1'] });
      for (let i = 0; i < 4; i++) {
        const y = 1.97 + i * 0.045, c = cage(y), th = 2.05 - i * 0.05;
        S.ell([s * (c.w + 0.002) * Math.sin(th), y - 0.02, c.cz + (c.d + 0.002) * Math.cos(th)], [0.009, 0.022, 0.008], [0.35, 0, s * 0.5], { bone: spineBone(y), k: 0.012 });
      }
    }
  });
  for (const y of [1.48, 1.57, 1.66]) S.groove([[-0.045, y, -0.034], [0.045, y + 0.006, -0.034]], 0.004, 0.0025, { bone: spineBone(y) });

  // --- spine: spinous processes in a groove between two wasted erector columns
  S.with({ k: 0.014, noise: [0.0012, 45] }, () => {
    for (const s of [-1, 1]) {
      const pts = [], rad = [];
      for (let y = 1.4; y <= 2.31; y += 0.07) {
        const c = y > 1.7 ? cage(y) : { d: 0.055, cz: 0.025 };
        pts.push([s * 0.03, y, c.cz + c.d * 0.88 + 0.004]);
        rad.push(y < 1.7 ? 0.02 : 0.016 - 0.004 * (y - 1.7));
      }
      S.chain(pts, rad, { bones: pts.map((p) => spineBone(p[1])) });
    }
  });
  S.with({ k: 0.007 }, () => {
    for (let y = 1.38; y <= 2.34; y += 0.042) {
      const c = y > 1.7 ? cage(y) : { d: 0.055, cz: 0.025 };
      const z = c.cz + c.d * 0.88 + 0.012;
      const big = y > 2.24 ? 1.15 : 1;
      S.ell([0, y, z], [0.0085 * big, 0.011, 0.009 * big], [-0.35, 0, 0], { bone: spineBone(y) });
    }
  });

  // --- ribs: ten pairs wrapping the core, descending toward the front
  S.with({ k: 0.0095, mat: SKIN }, () => {
    for (let k = 0; k < 10; k++) {
      const yb = 2.255 - k * 0.047;
      const drop = 0.08 + 0.007 * k;
      const thEnd = k <= 5 ? 2.72 : k === 6 ? 2.5 : k === 7 ? 2.2 : k === 8 ? 1.95 : 1.7;
      const r0 = 0.0072 + 0.0008 * Math.sin(k * 0.6);
      const bone = spineBone(yb - 0.02);
      for (const s of [-1, 1]) {
        const pts = [[s * 0.022, yb + 0.004, 0.05]];
        const rad = [r0 * 0.9];
        const n = 7;
        for (let i = 0; i <= n; i++) {
          const th = lerp(0.42, thEnd, i / n);
          const y = yb - drop * Math.pow(th / Math.PI, 1.25);
          const c = cage(y);
          const bulge = 1 + 0.08 * Math.sin(th);
          pts.push([s * (c.w * bulge + 0.003) * Math.sin(th), y, c.cz + (c.d + 0.004) * Math.cos(th)]);
          rad.push(r0 * (i === n ? 0.75 : 1));
        }
        S.chain(pts, rad, { bone });
      }
    }
    // sternum + costal arch (the inverted V under the chest)
    const st = [];
    for (let y = 2.27; y >= 1.86; y -= 0.05) { const c = cage(y); st.push([0, y, c.cz - c.d - 0.003]); }
    S.chain(st, st.map((_, i) => 0.012 - i * 0.0006), { bones: st.map((p) => spineBone(p[1])), k: 0.012 });
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const y = lerp(1.87, 1.745, t), c = cage(y);
        const th = lerp(Math.PI - 0.12, 1.95, t);
        pts.push([s * (c.w + 0.004) * Math.sin(th), y, c.cz + (c.d + 0.006) * Math.cos(th)]);
      }
      S.chain(pts, pts.map(() => 0.0085), { bones: pts.map((p) => spineBone(p[1])) });
    }
  });

  // --- pelvis: iliac crests, hip bones, sacrum, wasted buttocks (lesions are carved at the end)
  S.with({ k: 0.016, bone: 'pelvis', noise: [0.001, 50] }, () => {
    for (const s of [-1, 1]) {
      S.chain([[s * 0.035, 1.475, 0.07], [s * 0.095, 1.495, 0.045], [s * 0.128, 1.468, -0.01], [s * 0.112, 1.43, -0.06]], [0.011, 0.012, 0.012, 0.013]);
      S.sphere([s * 0.108, 1.425, -0.064], 0.014); // anterior iliac spine (bony point)
      S.ell([s * 0.072, 1.33, 0.055], [0.05, 0.06, 0.036], null, { k: 0.03 });
      // inguinal ligament / groin line
      S.cone([s * 0.105, 1.425, -0.06], [s * 0.02, 1.32, -0.055], 0.008, 0.007, { k: 0.012 });
    }
    S.ell([0, 1.39, 0.072], [0.042, 0.065, 0.02], [0.25, 0, 0], { k: 0.02 });
    S.ell([0, 1.305, -0.04], [0.04, 0.03, 0.032], null, { k: 0.025 });
  });

  // --- shoulder girdle: shoulder blades, collarbones, trapezius, bony shoulders
  for (const o of R.sides) {
    const s = o.s, S2 = o.S;
    S.with({ k: 0.018, bone: 'sp4', noise: [0.0012, 40] }, () => {
      // scapula plate lying on the back + its spine and medial border
      S.ell([s * 0.088, 2.13, 0.083], [0.052, 0.078, 0.011], [0.12, s * 0.55, s * 0.16], { k: 0.022 });
      S.cone([s * 0.045, 2.205, 0.092], [s * 0.175, 2.265, 0.04], 0.0085, 0.011, { k: 0.012 });
      S.cone([s * 0.05, 2.21, 0.088], [s * 0.065, 2.055, 0.083], 0.007, 0.006, { k: 0.01 });
      // trapezius slope from the neck to the shoulder
      S.cone([s * 0.025, 2.36, 0.03], [s * 0.17, 2.3, 0.025], 0.03, 0.02, { k: 0.03 });
    });
    S.with({ k: 0.012, bone: 'clav' + S2 }, () => {
      S.chain([[s * 0.016, 2.285, -0.072], [s * 0.085, 2.3, -0.074], [s * 0.15, 2.312, -0.045], [s * 0.2, 2.315, -0.008]], [0.0095, 0.0085, 0.0085, 0.011]);
    });
    // shoulder cap (acromion + wasted deltoid)
    const U = frameOf(R, o.uarm);
    S.with({ k: 0.03, bone: 'uarm' + S2, bone2: null, noise: [0.0012, 40] }, () => {
      S.sphere(U.p(0, 0.0, 0), 0.036);
      S.ell(U.p(0, 0.07, 0.004), [0.04, 0.075, 0.036], U.q, {});
    });
  }
}

// ---------------------------------------------------------------------------
// Neck: thin column, two cords standing out, windpipe, vertebrae
// ---------------------------------------------------------------------------
function neck(S, R) {
  const H = frameOf(R, 'head');
  S.with({ k: 0.03, noise: [0.001, 50] }, () => {
    S.chain([[0, 2.29, 0.02], [0, 2.38, 0.017], [0, 2.47, 0.013], [0, 2.56, 0.014], H.p(0, 0.035, 0.02)], [0.046, 0.031, 0.026, 0.025, 0.027], { bones: ['sp4', 'neck0', 'neck1', 'head'] });
  });
  S.with({ k: 0.012 }, () => {
    for (const s of [-1, 1]) {
      // sternocleidomastoid: behind the jaw down to the sternum
      S.chain([H.p(s * 0.04, 0.045, 0.03), [s * 0.034, 2.5, -0.016], [s * 0.026, 2.4, -0.046], [s * 0.016, 2.3, -0.068]], [0.0092, 0.0105, 0.0098, 0.009], { bones: ['neck1', 'neck0', 'sp4'] });
    }
    // windpipe with a hint of rings
    S.cone([0, 2.53, -0.02], [0, 2.31, -0.048], 0.0115, 0.0125, { bone: 'neck0', bone2: 'sp4', t0: 0.3, t1: 0.9 });
    for (let y = 2.38; y < 2.58; y += 0.04) S.ell([0, y, 0.044], [0.008, 0.01, 0.008], null, { bone: y > 2.47 ? 'neck1' : 'neck0', k: 0.008 });
  });
  // folds of loose skin at the throat, rings of the windpipe
  S.fold([0, 2.47, -0.025], 0.05, [0, 1, 0.25], 90, 0.0012, { bone: 'neck1' });
  S.fold([0, 2.41, -0.04], 0.06, [0, 1, 0.13], 150, 0.0009, { bone: 'neck0' });
}

// ---------------------------------------------------------------------------
// Arms: bone-thin, every tendon visible. Upper arm + forearm in the body piece.
// ---------------------------------------------------------------------------
function latSign(R, bone, s) {
  // which local X direction points away from the body (lateral)
  const q = R.quat[R.id[bone] ?? bone];
  const ax = [1, 0, 0];
  // rotate X axis by q
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const ix = w * ax[0] + y * ax[2] - z * ax[1], iy = w * ax[1] + z * ax[0] - x * ax[2], iz = w * ax[2] + x * ax[1] - y * ax[0], iw = -x * ax[0] - y * ax[1] - z * ax[2];
  const rx = ix * w + iw * -x + iy * -z - iz * -y;
  return Math.sign(rx * s) || 1;
}

function arm(S, R, o, holes) {
  const s = o.s, S2 = o.S;
  const U = frameOf(R, o.uarm), F = frameOf(R, o.farm);
  const lu = latSign(R, o.uarm, s), lf = latSign(R, o.farm, s);
  const ub = 'uarm' + S2, fb = 'farm' + S2;
  S.with({ k: 0.02, noise: [0.0012, 42] }, () => {
    // humerus + wasted biceps (front, +z) / triceps (back, -z)
    S.cone(U.p(0, 0.04, 0), U.p(0, 0.8, 0), 0.023, 0.019, { bone: ub });
    S.cone(U.p(0, 0.12, 0.014), U.p(0, 0.6, 0.016), 0.025, 0.019, { bone: ub, k: 0.02 });
    S.cone(U.p(0, 0.6, 0.012), U.p(0, 0.83, 0.02), 0.02, 0.008, { bone: ub, bone2: fb, t0: 0.6, t1: 1, k: 0.012 });
    S.cone(U.p(0, 0.1, -0.016), U.p(0, 0.66, -0.019), 0.026, 0.016, { bone: ub, k: 0.02 });
    // elbow: epicondyles + olecranon (bony point sticks out of the back of the elbow)
    S.sphere(U.p(lu * 0.03, 0.83, -0.004), 0.0145, { bone: ub, k: 0.012 });
    S.sphere(U.p(-lu * 0.031, 0.825, -0.002), 0.016, { bone: ub, k: 0.012 });
    S.sphere(F.p(0, 0.012, -0.024), 0.0165, { bone: fb, k: 0.014 });
    // forearm: ulna (back/medial) + radius (front/lateral), muscle bellies near the elbow
    S.cone(F.p(-lf * 0.006, 0.0, -0.016), F.p(-lf * 0.012, 0.82, -0.004), 0.0155, 0.0105, { bone: fb, k: 0.014 });
    S.cone(F.p(lf * 0.008, 0.05, 0.008), F.p(lf * 0.013, 0.82, 0.006), 0.012, 0.0165, { bone: fb, k: 0.014 });
    S.ell(F.p(lf * 0.006, 0.17, 0.006), [0.026, 0.13, 0.022], F.q, { bone: fb, k: 0.026 });
    S.ell(F.p(-lf * 0.01, 0.15, -0.006), [0.02, 0.12, 0.02], F.q, { bone: fb, k: 0.022 });
    S.sphere(F.p(-lf * 0.015, 0.815, -0.004), 0.0125, { bone: fb, k: 0.01 }); // ulnar head
  });
  // tendons down the forearm (flexors on the palm side +z, extensors on the back -z)
  S.with({ k: 0.006, bone: fb }, () => {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.008;
      S.cone(F.p(x * 1.3, 0.42, 0.017), F.p(x, 0.83, 0.013), 0.0032, 0.0034);
      S.cone(F.p(x * 1.2, 0.48, -0.013), F.p(x * 1.1, 0.83, -0.011), 0.0026, 0.003);
    }
    // a vein snaking along the forearm
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(F.p(lf * (0.016 + 0.006 * Math.sin(t * 7)), lerp(0.15, 0.78, t), 0.012 + 0.006 * Math.cos(t * 5))); }
    S.chain(pts, pts.map(() => 0.0024), { k: 0.004 });
  });
  // tendons/veins in the upper arm
  S.with({ k: 0.006, bone: ub }, () => {
    S.cone(U.p(-lu * 0.018, 0.2, 0.018), U.p(-lu * 0.014, 0.78, 0.016), 0.0028, 0.0025);
  });
  // creases inside the elbow + over the olecranon
  S.fold(U.p(0, 0.8, 0.02), 0.045, U.d(0, 1, 0), 140, 0.0011, { bone: ub });
  S.fold(F.p(0, 0.01, -0.022), 0.03, F.d(0, 1, 0.3), 170, 0.0009, { bone: fb });
  // perforations: one eaten between the forearm bones, one through the upper arm (asymmetric)
  if (holes) {
    if (s < 0) holes.push({ S, a: F.p(0, 0.36, -0.05), b: F.p(0, 0.4, 0.05), r: 0.0085, bone: fb });
    else holes.push({ S, a: U.p(-0.05, 0.26, 0.01), b: U.p(0.05, 0.3, -0.005), r: 0.0105, bone: ub });
  }
}

// ---------------------------------------------------------------------------
// Hands: long spindly fingers ending in hooked black nails
// ---------------------------------------------------------------------------
function hand(S, R, o) {
  const s = o.s, S2 = o.S;
  const F = frameOf(R, o.farm), Hn = frameOf(R, o.hand);
  const hb = 'hand' + S2;
  // wrist
  S.with({ k: 0.012, noise: [0.0008, 70] }, () => {
    S.cone(F.p(0, 0.78, 0), Hn.p(0, 0.012, 0), 0.0185, 0.018, { bone: 'farm' + S2, bone2: hb, t0: 0.5, t1: 1 });
    S.ell(Hn.p(0, 0.022, 0.003), [0.024, 0.022, 0.013], Hn.q, { bone: hb, k: 0.012 });
    // palm (thin, -z) and metacarpal ridges on the back (+z)
    S.ell(Hn.p(0, 0.058, -0.002), [0.036, 0.05, 0.0085], Hn.q, { bone: hb, k: 0.01 });
    for (let k = 0; k < 4; k++) {
      S.cone(Hn.p(FINGER_X[k] * 0.45, 0.014, 0.004), Hn.p(FINGER_X[k], D.hand - 0.004, 0.003), 0.0055, 0.0068, { bone: hb, k: 0.006 });
      S.sphere(Hn.p(FINGER_X[k], D.hand, 0.0015), 0.0088, { bone: hb, k: 0.006 });
    }
    // thenar pad toward the thumb
    S.ell(Hn.p(-s * 0.02, 0.035, -0.007), [0.014, 0.026, 0.0095], Hn.q, { bone: hb, k: 0.012 });
  });
  // fingers: order across the hand -> index (thumb side) ... little
  const thumbSide = -s; // hand-local x sign of the thumb
  const order = [0, 1, 2, 3].sort((a, b) => FINGER_X[b] * thumbSide - FINGER_X[a] * thumbSide); // index first
  const lenMul = [0.94, 1.0, 0.96, 0.8];
  order.forEach((k, rank) => {
    const [fa, fb] = o.fing[k];
    const A = frameOf(R, fa), B = frameOf(R, fb);
    const an = R.names[fa], bn = R.names[fb];
    const L2 = D.f2 * lenMul[rank];
    const r0 = 0.0078 - rank * 0.0003;
    S.with({ k: 0.006, noise: [0.0006, 90] }, () => {
      S.cone(A.p(0, -0.004, 0), A.p(0, D.f1, 0), r0, r0 * 0.86, { bone: an, bone2: bn, t0: 0.85, t1: 1.0 });
      S.sphere(A.p(0, D.f1, 0.0012), r0 * 0.98, { bone: an, k: 0.005 });
      S.cone(B.p(0, 0, 0), B.p(0, L2 * 0.62, 0), r0 * 0.86, r0 * 0.74, { bone: bn });
      S.sphere(B.p(0, L2 * 0.62, 0.001), r0 * 0.8, { bone: bn, k: 0.004 });
      // knuckle creases
      S.fold(A.p(0, D.f1, 0.004), 0.011, A.d(0, 1, 0), 520, 0.00035, { bone: an });
    });
    // hooked nail: hard tissue
    S.with({ k: 0.004, mat: HARD, bone: bn }, () => {
      S.chain([B.p(0, L2 * 0.62, 0), B.p(0, L2 * 0.83, -0.0012), B.p(0, L2 * 1.0, -0.0055)], [r0 * 0.74, r0 * 0.5, 0.0009]);
    });
  });
  // thumb
  const T = frameOf(R, o.thumb), tb = 'thumb' + S2;
  S.with({ k: 0.007, noise: [0.0006, 90] }, () => {
    S.cone(T.p(0, -0.01, 0), T.p(0, 0.05, 0), 0.0088, 0.0072, { bone: tb });
    S.sphere(T.p(0, 0.05, 0.0012), 0.0075, { bone: tb, k: 0.005 });
  });
  S.with({ k: 0.004, mat: HARD, bone: tb }, () => {
    S.chain([T.p(0, 0.05, 0), T.p(0, 0.072, -0.001), T.p(0, D.thumb, -0.0045)], [0.0066, 0.0045, 0.001]);
  });
}

// ---------------------------------------------------------------------------
// Legs: femur, wasted thigh, kneecap, knife-edge shin, calf string, Achilles cord
// ---------------------------------------------------------------------------
function leg(S, R, o, holes) {
  const s = o.s, S2 = o.S;
  const T = frameOf(R, o.thigh), Sh = frameOf(R, o.shin);
  const lt = latSign(R, o.thigh, s), ls = latSign(R, o.shin, s);
  const tb = 'thigh' + S2, sb = 'shin' + S2;
  S.with({ k: 0.022, noise: [0.0014, 36] }, () => {
    S.cone(T.p(0, -0.02, 0.0), T.p(0, 0.6, 0), 0.03, 0.024, { bone: tb, k: 0.03 });
    S.sphere(T.p(lt * 0.042, 0.035, 0.004), 0.026, { bone: tb, k: 0.03 }); // greater trochanter
    S.cone(T.p(0, 0.06, -0.01), T.p(0, 0.44, -0.017), 0.043, 0.032, { bone: tb, k: 0.03 }); // quadriceps
    S.cone(T.p(0, 0.44, -0.017), T.p(0, 0.62, -0.024), 0.032, 0.018, { bone: tb, k: 0.02 });
    S.cone(T.p(0, 0.1, 0.014), T.p(lt * 0.006, 0.52, 0.02), 0.035, 0.018, { bone: tb, k: 0.026 }); // hamstrings
    S.ell(T.p(-lt * 0.026, 0.13, 0.0), [0.028, 0.11, 0.032], T.q, { bone: tb, k: 0.03 }); // adductors
    // knee: femoral condyles, kneecap, tibial plateau
    S.sphere(T.p(lt * 0.026, 0.643, 0.006), 0.024, { bone: tb, k: 0.014 });
    S.sphere(T.p(-lt * 0.027, 0.643, 0.006), 0.025, { bone: tb, k: 0.014 });
    S.ell(T.p(0, 0.66, -0.03), [0.02, 0.025, 0.011], T.q, { bone: tb, k: 0.012 });
    S.ell(Sh.p(0, 0.022, 0.002), [0.036, 0.022, 0.03], Sh.q, { bone: sb, k: 0.016 });
    S.sphere(Sh.p(0, 0.05, -0.028), 0.011, { bone: sb, k: 0.012 }); // tibial tuberosity
    // shin: tibia with a sharp front crest, fibula, emaciated calf + Achilles cord
    S.cone(Sh.p(0, 0.03, -0.008), Sh.p(0, 0.6, -0.003), 0.022, 0.015, { bone: sb, k: 0.016 });
    S.cone(Sh.p(0, 0.07, -0.024), Sh.p(0, 0.52, -0.016), 0.0062, 0.005, { bone: sb, k: 0.012 });
    S.cone(Sh.p(ls * 0.022, 0.05, 0.007), Sh.p(ls * 0.02, 0.6, 0.004), 0.0085, 0.0075, { bone: sb, k: 0.012 });
    S.ell(Sh.p(0, 0.19, 0.02), [0.03, 0.12, 0.026], Sh.q, { bone: sb, k: 0.022 });
    S.cone(Sh.p(0, 0.3, 0.028), Sh.p(0, 0.625, 0.03), 0.011, 0.0065, { bone: sb, k: 0.012 });
    // ankle bones
    S.sphere(Sh.p(ls * 0.023, 0.622, 0.002), 0.0115, { bone: sb, k: 0.01 });
    S.sphere(Sh.p(-ls * 0.021, 0.612, 0.0), 0.0125, { bone: sb, k: 0.01 });
  });
  // hamstring tendons into the back of the knee
  S.with({ k: 0.008 }, () => {
    for (const x of [-0.024, 0.026]) S.cone(T.p(x, 0.5, 0.024), Sh.p(x * 1.15, 0.07, 0.016), 0.0065, 0.0055, { bone: tb, bone2: sb, t0: 0.55, t1: 1 });
    S.cone(T.p(0, 0.6, -0.024), Sh.p(0, 0.05, -0.028), 0.0075, 0.0072, { bone: tb, bone2: sb, t0: 0.4, t1: 0.8 }); // patellar tendon
  });
  S.fold(T.p(0, 0.66, 0.03), 0.05, T.d(0, 1, 0), 120, 0.0012, { bone: tb });
  S.fold(Sh.p(0, 0.62, -0.012), 0.03, Sh.d(0, 1, 0), 170, 0.0008, { bone: sb });
  if (holes) {
    if (s > 0) holes.push({ S, a: T.p(0.0, 0.31, -0.07), b: T.p(0.01, 0.34, 0.07), r: 0.0125, bone: tb });
    else holes.push({ S, a: Sh.p(-0.05, 0.2, 0.03), b: Sh.p(0.05, 0.22, 0.025), r: 0.0085, bone: sb });
  }
}

// ---------------------------------------------------------------------------
// Feet: digitigrade — long metatarsus, raised heel spur, three clawed toes
// ---------------------------------------------------------------------------
function foot(S, R, o) {
  const S2 = o.S;
  const Sh = frameOf(R, o.shin), Ft = frameOf(R, o.foot), To = frameOf(R, o.toe);
  const fb = 'foot' + S2, tb = 'toe' + S2;
  S.with({ k: 0.012, noise: [0.0008, 60] }, () => {
    S.cone(Sh.p(0, 0.58, 0), Ft.p(0, 0.015, 0), 0.0175, 0.019, { bone: 'shin' + S2, bone2: fb, t0: 0.55, t1: 1 });
    S.ell(Ft.p(0, -0.012, 0.016), [0.017, 0.032, 0.017], Ft.q, { bone: fb, k: 0.012 }); // heel spur
    S.cone(Sh.p(0, 0.56, 0.028), Ft.p(0, -0.03, 0.022), 0.0068, 0.0075, { bone: 'shin' + S2, bone2: fb, t0: 0.6, t1: 1, k: 0.008 }); // Achilles
    S.ell(Ft.p(0, 0.08, 0.002), [0.021, 0.075, 0.0125], Ft.q, { bone: fb, k: 0.012 });
    for (const x of [-0.019, 0, 0.019]) {
      S.cone(Ft.p(x * 0.35, 0.02, -0.004), Ft.p(x, D.foot - 0.006, -0.002), 0.0072, 0.0078, { bone: fb, k: 0.008 });
      S.sphere(Ft.p(x, D.foot, 0.004), 0.0105, { bone: fb, bone2: tb, k: 0.007 });
    }
  });
  for (const x of [-0.019, 0, 0.019]) {
    const len = x === 0 ? 1 : 0.86;
    S.with({ k: 0.006, noise: [0.0006, 90], bone: tb }, () => {
      S.cone(To.p(x, -0.004, 0), To.p(x * 1.35, 0.05 * len, 0), 0.0085, 0.0068);
      S.sphere(To.p(x * 1.35, 0.05 * len, -0.001), 0.0072, { k: 0.004 });
    });
    S.with({ k: 0.004, mat: HARD, bone: tb }, () => {
      S.chain([To.p(x * 1.35, 0.05 * len, 0), To.p(x * 1.5, 0.078 * len, 0.002), To.p(x * 1.6, D.toe * len, 0.0075)], [0.0064, 0.0042, 0.0009]);
    });
  }
}

// ---------------------------------------------------------------------------
// Head: small, smooth, swept-back skull; eyeless pits; a lipless seam of a mouth on a hinged jaw
// ---------------------------------------------------------------------------
function head(S, R) {
  const H = frameOf(R, 'head'), J = frameOf(R, 'jaw');
  S.with({ k: 0.028, bone: 'head', noise: [0.0007, 75] }, () => {
    S.cone(H.p(0, -0.04, 0.012), H.p(0, 0.05, 0.02), 0.03, 0.034, { bone: 'neck1', bone2: 'head', t0: 0.3, t1: 0.8, k: 0.02 });
    S.ell(H.p(0, 0.135, 0.004), [0.058, 0.074, 0.07], [0.2, 0, 0]); // cranium
    S.ell(H.p(0, 0.175, 0.07), [0.045, 0.056, 0.078], [0.75, 0, 0], { k: 0.035 }); // swept-back occiput
    S.ell(H.p(0, 0.09, -0.052), [0.04, 0.058, 0.042], [-0.12, 0, 0]); // narrow face
    for (const s of [-1, 1]) {
      S.ell(H.p(s * 0.034, 0.085, -0.05), [0.009, 0.007, 0.02], null, { k: 0.026 }); // faint cheekbone
      S.ell(H.p(s * 0.046, 0.06, 0.02), [0.01, 0.03, 0.03], null, { k: 0.026 }); // temple/jaw muscle
    }
    S.ell(H.p(0, 0.17, 0.115), [0.02, 0.02, 0.02], null, { k: 0.03 }); // occipital knob
  });
  // jaw (moves): mandible V + chin + floor
  S.with({ k: 0.016, bone: 'jaw', noise: [0.0007, 75] }, () => {
    for (const s of [-1, 1]) S.cone(J.p(s * 0.041, -0.004, 0.006), J.p(s * 0.012, -0.05, -0.083), 0.0105, 0.0085);
    S.ell(J.p(0, -0.05, -0.083), [0.017, 0.013, 0.015], null, {});
    S.ell(J.p(0, -0.03, -0.045), [0.03, 0.014, 0.04], null, { k: 0.02 });
  });
  // eye pits: shallow, smooth, empty
  for (const s of [-1, 1]) S.ell(H.p(s * 0.026, 0.104, -0.088), [0.013, 0.0075, 0.009], [0, s * 0.4, 0], { sub: true, k: 0.02, bone: 'head' });
  // mouth: a thin lipless seam that opens into a wet cavity
  S.ell(H.p(0, 0.031, -0.074), [0.022, 0.0022, 0.03], null, { sub: true, k: 0.003, bone: 'head', mat: INNER });
  S.ell(H.p(0, 0.04, -0.034), [0.02, 0.013, 0.032], null, { sub: true, k: 0.008, bone: 'head', mat: INNER });
  // needle teeth (hard), hidden behind the seam until the jaw drops
  for (let i = 0; i < 9; i++) {
    const t = (i / 8) * 2 - 1;
    const x = t * 0.017, zz = -0.066 + t * t * 0.02;
    S.cone(H.p(x, 0.046, zz + 0.004), H.p(x * 1.05, 0.034, zz + 0.002), 0.0017, 0.0003, { bone: 'head', mat: HARD, k: 0.002 });
    S.cone(J.p(x, -0.034, zz + 0.006), J.p(x * 1.05, -0.022, zz + 0.004), 0.0015, 0.0003, { bone: 'jaw', mat: HARD, k: 0.002 });
  }
  S.fold(H.p(0, 0.2, 0.04), 0.07, H.d(0, 0.3, 1), 70, 0.0006, { bone: 'head' });
}

// ---------------------------------------------------------------------------
// Tube helper (explicit geometry for thin strands: head tendrils, goo strings)
// ---------------------------------------------------------------------------
function tubeMesh(out, pts, radii, radial, weightFn, tis = [1, 0, 0, 0.6]) {
  // pts: [[x,y,z]...] with radii; parallel-transport frames; closed tip if radius ~0
  const n = pts.length;
  const base = out.nV;
  let N = null;
  const T = [];
  for (let i = 0; i < n; i++) T.push(norm3(sub3(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  for (let i = 0; i < n; i++) {
    const t = T[i];
    if (!N) { N = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; }
    const d = N[0] * t[0] + N[1] * t[1] + N[2] * t[2];
    N = norm3([N[0] - t[0] * d, N[1] - t[1] * d, N[2] - t[2] * d]);
    const B = [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]];
    const w = weightFn(i / (n - 1));
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU, c = Math.cos(a), sn = Math.sin(a);
      const nx = N[0] * c + B[0] * sn, ny = N[1] * c + B[1] * sn, nz = N[2] * c + B[2] * sn;
      const r = radii[i];
      out.pos.push(pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r);
      out.nor.push(nx, ny, nz);
      out.si.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0);
      out.sw.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
      out.tis.push(tis[0], tis[1], tis[2], tis[3]);
      out.nV++;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * radial + j, b = base + i * radial + ((j + 1) % radial);
      const c = a + radial, d = b + radial;
      out.idx.push(a, b, c, b, d, c);
    }
  }
  // cap the root end (hidden in the body) and the tip
  const cap = (ring, flip) => {
    const c = out.nV;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < radial; j++) { const v = (base + ring * radial + j) * 3; cx += out.pos[v]; cy += out.pos[v + 1]; cz += out.pos[v + 2]; }
    const t = T[ring];
    const sg = flip ? -1 : 1;
    out.pos.push(cx / radial + t[0] * radii[ring] * 0.6 * sg, cy / radial + t[1] * radii[ring] * 0.6 * sg, cz / radial + t[2] * radii[ring] * 0.6 * sg);
    out.nor.push(t[0] * sg, t[1] * sg, t[2] * sg);
    const w = weightFn(ring / (n - 1));
    out.si.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0);
    out.sw.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
    out.tis.push(tis[0], tis[1], tis[2], tis[3]);
    out.nV++;
    for (let j = 0; j < radial; j++) {
      const a = base + ring * radial + j, b = base + ring * radial + ((j + 1) % radial);
      if (flip) out.idx.push(c, b, a); else out.idx.push(c, a, b);
    }
  };
  cap(0, true);
  cap(n - 1, false);
}

function tendrils(out, R, rand) {
  R.tenIds.forEach(([a, b], n) => {
    const A = frameOf(R, a), B = frameOf(R, b);
    const pts = [], rad = [];
    const N = 22;
    const ph = rand.range(0, 10);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const along = t * (D.tenA + D.tenB * 0.96) - 0.012;
      const onA = along < D.tenA;
      const wob = 0.0025 * Math.sin(t * 13 + ph);
      const p = onA ? A.p(wob, along, 0.0015 * Math.sin(t * 9 + ph)) : B.p(wob, along - D.tenA, 0.0015 * Math.sin(t * 9 + ph));
      pts.push(p);
      const bulb = 1 + 0.35 * Math.max(0, Math.sin(t * 17 + ph)) ** 3;
      rad.push(lerp(0.0088, 0.0012, Math.pow(t, 0.75)) * bulb * (n >= 2 ? 0.85 : 1));
    }
    tubeMesh(out, pts, rad, 7, (t) => {
      const along = t * (D.tenA + D.tenB);
      const f = clamp((along - D.tenA + 0.02) / 0.04, 0, 1);
      return [[a, 1 - f], [b, f]];
    }, [1, 0, 0, 0.9]);
  });
}

// glistening strings of goo stretched between two places on the body (skinned to both ends)
function gooStrings(out, R) {
  const id = R.id;
  const strand = (pa, ba, pb, bb, sag, r) => {
    const pts = [], rad = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = mix3(pa, pb, t);
      p[1] -= sag * Math.sin(Math.PI * t);
      pts.push(p);
      rad.push(r * 1.5 * (1 + 1.8 * Math.pow(Math.abs(t - 0.5) * 2, 6)) * (1 + 0.35 * Math.max(0, Math.sin(t * 11 + r * 900))));
    }
    tubeMesh(out, pts, rad, 5, (t) => [[ba, 1 - t], [bb, t]], [1, 0, 0, 1]);
  };
  for (const o of R.sides) {
    const s = o.s;
    const T = frameOf(R, o.thigh), lt = latSign(R, o.thigh, s);
    // groin -> inner thigh
    strand([s * 0.03, 1.31, -0.03], id.pelvis, T.p(-lt * 0.032, 0.22, -0.01), o.thigh, 0.03, 0.0022);
    // between the fingers (webbing strings)
    const [i0, i1, i2] = [o.fing[0][0], o.fing[1][0], o.fing[2][0]];
    const F0 = frameOf(R, i0), F1 = frameOf(R, i1), F2 = frameOf(R, i2);
    strand(F0.p(0, 0.05, 0), i0, F1.p(0, 0.06, 0), i1, 0.006, 0.0011);
    strand(F1.p(0, 0.04, 0), i1, F2.p(0, 0.05, 0), i2, 0.005, 0.0010);
  }
  // inner thigh to inner thigh (the long glossy string between the legs)
  const TL = frameOf(R, R.sides[0].thigh), TR = frameOf(R, R.sides[1].thigh);
  const lL = latSign(R, R.sides[0].thigh, -1), lR = latSign(R, R.sides[1].thigh, 1);
  strand(TL.p(-lL * 0.03, 0.3, 0), R.sides[0].thigh, TR.p(-lR * 0.03, 0.34, 0), R.sides[1].thigh, 0.07, 0.0018);
  // chin to chest
  const H = frameOf(R, 'jaw');
  strand(H.p(0, -0.05, -0.08), id.jaw, [0.012, 2.24, -0.09], id.sp4, 0.04, 0.0016);
}

// ---------------------------------------------------------------------------
// Template build
// ---------------------------------------------------------------------------
const PIECES = {
  // h: voxel size (m), tris: decimation target
  body: { h: 0.0074, tris: 26000 },
  head: { h: 0.0034, tris: 6500 },
  hands: { h: 0.0028, tris: 9000 },
  feet: { h: 0.0042, tris: 4200 },
};

export function buildTemplateData(opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const R = rig();
  const names = R.names;
  const rand = rng(0xbac7e1a);
  const body = new Sculpt(names), headS = new Sculpt(names), hands = new Sculpt(names), feet = new Sculpt(names);
  body.maxFoldFreq = 150; headS.maxFoldFreq = 260; hands.maxFoldFreq = 560; feet.maxFoldFreq = 300;
  const holes = [];
  torso(body, R);
  neck(body, R);
  for (const o of R.sides) { arm(body, R, o, holes); leg(body, R, o, holes); hand(hands, R, o); foot(feet, R, o); }
  head(headS, R);
  // a perforation through the left flank, under the ribs
  holes.push({ S: body, a: [-0.11, 1.6, -0.05], b: [-0.03, 1.63, 0.08], r: 0.0125, bone: 'sp0' });
  // lesions eaten into the skin between ribs
  for (const [k, th, s, rr] of [[3, 1.75, -1, 0.0085], [4, 1.95, -1, 0.0075], [5, 1.5, 1, 0.008], [2, 0.9, 1, 0.007]]) {
    const yb = 2.255 - k * 0.047 - 0.0235, drop = 0.08 + 0.007 * k;
    const y = yb - drop * Math.pow(th / Math.PI, 1.25), c = cage(y);
    const out = [s * (c.w + 0.02) * Math.sin(th), y, c.cz + (c.d + 0.02) * Math.cos(th)];
    const inn = [s * (c.w - 0.03) * Math.sin(th), y + 0.003, c.cz + (c.d - 0.03) * Math.cos(th)];
    holes.push({ S: body, a: out, b: inn, r: rr, bone: spineBone(y) });
  }
  for (const hl of holes) hl.S.cone(hl.a, hl.b, hl.r, hl.r * 1.15, { sub: true, k: 0.009, bone: hl.bone, mat: INNER, noise: [0.0022, 70] });

  const pieces = [
    { S: body, ...PIECES.body },
    { S: headS, ...PIECES.head },
    { S: hands, ...PIECES.hands },
    { S: feet, ...PIECES.feet },
  ];
  const meshes = [];
  const stats = { pieces: [] };
  for (const pc of pieces) {
    const boxes = clusterBoxes(pc.S, 0.04 + pc.h * 3);
    const raws = boxes.map((box) => meshRaw(pc.S, { h: pc.h, pad: 0.03, clip: box }));
    const tot = raws.reduce((a, r) => a + r.idx.length / 3, 0);
    for (const raw of raws) {
      const tris = Math.max(80, Math.round(pc.tris * (raw.idx.length / 3) / Math.max(1, tot)));
      const m = finishMesh(pc.S, raw, { tris, errScale: 0.38, aoDist: [0.006, 0.016, 0.035, 0.07] });
      meshes.push(m);
      stats.pieces.push({ h: pc.h, raw: raw.idx.length / 3, tris: m.idx.length / 3, ms: m.stats.ms });
    }
  }
  // explicit strands
  const ex = { pos: [], nor: [], si: [], sw: [], tis: [], idx: [], nV: 0 };
  tendrils(ex, R, rand);
  gooStrings(ex, R);

  // ---- merge
  let nV = ex.nV, nI = ex.idx.length;
  for (const m of meshes) { nV += m.nV; nI += m.idx.length; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3);
  const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4), tis = new Uint8Array(nV * 4);
  const idx = new Uint32Array(nI);
  let vo = 0, io = 0;
  for (const m of meshes) {
    pos.set(m.pos, vo * 3);
    nor.set(m.nor, vo * 3);
    si.set(m.skinI, vo * 4);
    sw.set(m.skinW, vo * 4);
    for (let i = 0; i < m.nV; i++) {
      const k = (vo + i) * 4;
      const M = m.mats, o5 = i * 5;
      tis[k] = clamp(m.ao[i], 0, 1) * 255;
      tis[k + 1] = clamp(M[o5 + HARD], 0, 1) * 255;
      tis[k + 2] = clamp(M[o5 + INNER], 0, 1) * 255;
      tis[k + 3] = clamp(0.55 + 0.45 * m.misc[i * 3 + 2], 0, 1) * 255;
    }
    // orientation: face normals must agree with the field normals
    let agree = 0, cnt = 0;
    for (let t = 0; t < m.idx.length && cnt < 300; t += 3 * 13) {
      const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2];
      const P = m.pos, Nn = m.nor;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * Nn[a * 3] + ny * Nn[a * 3 + 1] + nz * Nn[a * 3 + 2] > 0) agree++;
      cnt++;
    }
    const flip = agree < cnt / 2;
    for (let t = 0; t < m.idx.length; t += 3) {
      idx[io + t] = m.idx[t] + vo;
      idx[io + t + 1] = m.idx[flip ? t + 2 : t + 1] + vo;
      idx[io + t + 2] = m.idx[flip ? t + 1 : t + 2] + vo;
    }
    io += m.idx.length;
    vo += m.nV;
  }
  pos.set(ex.pos, vo * 3);
  nor.set(ex.nor, vo * 3);
  si.set(ex.si, vo * 4);
  sw.set(ex.sw, vo * 4);
  for (let i = 0; i < ex.nV; i++) {
    const k = (vo + i) * 4;
    tis[k] = 255 * ex.tis[i * 4]; tis[k + 1] = 255 * ex.tis[i * 4 + 1]; tis[k + 2] = 255 * ex.tis[i * 4 + 2]; tis[k + 3] = 255 * ex.tis[i * 4 + 3];
  }
  for (let i = 0; i < ex.idx.length; i++) idx[io + i] = ex.idx[i] + vo;
  stats.ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  stats.tris = nI / 3;
  stats.verts = nV;
  return { pos, nor, si, sw, tis, idx, stats };
}
