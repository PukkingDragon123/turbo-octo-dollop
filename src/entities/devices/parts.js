// Shared device hardware: fasteners, hinges, knobs, toggles, push buttons, pilot lamps, gauges,
// louvres, punched vents, cables / glands / conduit, nameplates, hazard stripes and grime decals.
// Everything builds in the kit's current frame with the mounting surface at local z and the part
// sticking out toward +Z (use onFace() / k.push() to mount on other faces).
import * as THREE from 'three';
import {
  PI, TAU, HP, NO, clamp, V3, toV, FIN, latheGeo, cylGeo, boxGeo, tubeGeo, curvePts, roundPath, extrudeGeo, axisGeo,
  rrShape, rrHole, frameShape, circleShape, polyShape, quadGeo, Geo, torusGeo, qUp,
} from './core.js';
import { lampMat, CLEAR } from './mats.js';
import { drawScrewHead, drawStreak, drawStain, drawScuffs, drawHandprint, drawDial, txt } from './atlas.js';

export const FACE_ROT = { z: null, '-z': [0, PI, 0], x: [0, HP, 0], '-x': [0, -HP, 0], y: [-HP, 0, 0], '-y': [HP, 0, 0] };
export function onFace(k, x, y, z, dir, fn) {
  k.push(x, y, z, FACE_ROT[dir] || null);
  try { fn(); } finally { k.pop(); }
}

// Gauge needle angle for value v in 0..1 over the 270 deg scale (0 = straight up)
export function gaugeAngle(v) { return (0.5 - Math.min(1, Math.max(0, v))) * 1.5 * PI; }

// ---------------------------------------------------------------------------
// Fasteners
// ---------------------------------------------------------------------------
const screwReg = (k, kind) => k.reg('screw_' + kind, 32, 32, (c, w, h) => drawScrewHead(c, w, h, kind));
// screw / rivet head on the surface at (x, y, z) facing +Z (o.dir to face another axis)
// o: r, kind ('phillips' | 'slot' | 'flat' | 'hex' | 'torx' | 'rivet' | 'button'), fin, slot, roll, rust, tint
export function screw(k, x, y, z, o = NO) {
  const r = o.r ?? 0.0035, kind = o.kind ?? 'phillips';
  const fin = o.fin ?? FIN.zinc;
  const slot = o.slot ?? 'metal';
  const opt = { ...fin, rust: o.rust ?? Math.min(1, k.wear.rust * 1.6), chip: 0, edge: 1.2, ...(o.mo || {}) };
  if (o.tint) opt.tint = o.tint;
  const seg = o.seg ?? (r < 0.0045 ? 6 : r < 0.008 ? 8 : r < 0.014 ? 10 : 12);
  const roll = o.roll ?? k.rng.next() * PI;
  k.push(x, y, z, o.dir ? FACE_ROT[o.dir] : null);
  let h;
  if (kind === 'hex') {
    h = r * 0.62;
    k.cyl(slot, r * 1.42, r * 0.16, 0, 0, r * 0.08, { ...opt, axis: 'z', seg: Math.max(6, seg - 2), caps: true });
    k.cyl(slot, r, h, 0, 0, r * 0.16 + h / 2, { ...opt, axis: 'z', seg: 6, bev: r >= 0.008 ? r * 0.1 : 0, bevSeg: 1, rot: [0, 0, roll] });
    if (o.thread) k.cyl(slot, r * 0.52, o.thread, 0, 0, r * 0.16 + h + o.thread / 2, { ...opt, axis: 'z', seg: 8 });
  } else {
    const prof = kind === 'flat'
      ? [[r, 0], [r, r * 0.12, 2], [r * 0.94, r * 0.2], [0, r * 0.22]]
      : kind === 'rivet' ? [[r, 0], [r * 0.86, r * 0.42], [r * 0.45, r * 0.66], [0, r * 0.7]]
        : kind === 'button' ? [[r, 0], [r * 0.96, r * 0.2], [r * 0.78, r * 0.5], [r * 0.42, r * 0.68], [0, r * 0.72]]
        : [[r, 0], [r * 0.98, r * 0.28, 2], [r * 0.8, r * 0.52], [r * 0.4, r * 0.62], [0, r * 0.64]];
    h = prof[prof.length - 1][1];
    k.lathe(slot, prof, 0, 0, 0, { ...opt, axis: 'z', seg, uv: 'cyl' });
    if (kind !== 'rivet' && kind !== 'button' && k.A) k.label(screwReg(k, kind), r * (kind === 'flat' ? 1.9 : 1.6), r * (kind === 'flat' ? 1.9 : 1.6), 0, 0, h + 0.00012, { rot: [0, 0, roll] });
  }
  k.pop();
  if (o.streak && k.A) streak(k, x, y - r * 0.6, z + 0.0003, r * (o.streakW ?? 5), o.streak, { col: o.streakCol, alpha: o.streakA });
  return h;
}
export function screws(k, pts, o = NO) { for (const p of pts) screw(k, p[0], p[1], p[2], o); }
export const rivet = (k, x, y, z, o = NO) => screw(k, x, y, z, { kind: 'rivet', r: 0.004, fin: FIN.steel, ...o });
export const hexBolt = (k, x, y, z, o = NO) => screw(k, x, y, z, { kind: 'hex', r: 0.006, ...o });
// corner screws of a rectangle (inset d)
export function cornerScrews(k, w, h, x, y, z, d = 0.012, o = NO) {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) screw(k, x + sx * (w / 2 - d), y + sy * (h / 2 - d), z, o);
}
// row of fasteners from a to b (count n)
export function fastenerRow(k, a, b, n, o = NO) {
  for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); screw(k, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, o); }
}

// ---------------------------------------------------------------------------
// Hinges, handles, latches
// ---------------------------------------------------------------------------
// one half of a barrel hinge (pin axis along Y at x, y, z). part 0 = fixed half (knuckles 0, 2, ..),
// part 1 = moving half (knuckles 1, 3, ..). leaf: direction of the leaf in X (+1 / -1), lying in z = z + o.leafZ
export function hingeHalf(k, x, y, z, h, o = NO) {
  const r = o.r ?? 0.0055, n = o.knuckles ?? 5, gap = 0.0008;
  const fin = o.fin ?? FIN.steel, slot = o.slot ?? 'metal';
  const opt = { ...fin, rust: o.rust ?? k.wear.rust, chip: 0, ...(o.mo || {}) };
  const part = o.part ?? 0;
  const sl = h / n;
  for (let i = 0; i < n; i++) if (i % 2 === part) k.cyl(slot, r, sl - gap, x, y - h / 2 + (i + 0.5) * sl, z, { ...opt, seg: 8, bev: r * 0.16, bevSeg: 1 });
  if (part === 0) { k.cyl(slot, r * 0.62, 0.003, x, y + h / 2 + 0.0015, z, { ...opt, seg: 8, bev: 0.0008, bevSeg: 1 }); k.cyl(slot, r * 0.62, 0.003, x, y - h / 2 - 0.0015, z, { ...opt, seg: 8, bev: 0.0008, bevSeg: 1 }); }
  if (o.leaf) {
    const lw = o.leafW ?? 0.024, lt = 0.0018, lz = z + (o.leafZ ?? -r + lt / 2);
    k.box(slot, lw, h * 0.94, lt, x + o.leaf * (r * 0.6 + lw / 2), y, lz, { ...opt, r: 0.0006 });
    for (const sy of [-0.32, 0.32]) screw(k, x + o.leaf * (r * 0.6 + lw * 0.55), y + sy * h, lz + lt / 2, { r: 0.0026, kind: 'flat', fin, rust: opt.rust, slot });
  }
}
// U pull handle along X sticking out +Z (w = centre distance)
export function pullHandle(k, x, y, z, w, o = NO) {
  const d = o.d ?? 0.032, r = o.r ?? 0.0055, slot = o.slot ?? 'metal';
  const opt = { ...(o.fin ?? FIN.chrome), ...(o.mo || {}) };
  const pts = [[-w / 2, 0, 0], [-w / 2, 0, d], [w / 2, 0, d], [w / 2, 0, 0]];
  k.push(x, y, z, o.rot || null);
  k.tube(slot, pts, r, { ...opt, round: o.bend ?? 0.012, rseg: 5, radial: 10, caps: true });
  for (const s of [-1, 1]) k.cyl(slot, r * 1.9, 0.004, s * w / 2, 0, 0.002, { ...opt, axis: 'z', seg: 12, bev: 0.001 });
  k.pop();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
// fluted knob body (lathe along +Y, n grooves)
export function flutedGeo(r, h, n = 18, depth = 0.08) {
  const g = latheGeo([[0, 0], [r, 0, 1], [r, h * 0.82], [r * 0.93, h, 2], [r * 0.6, h, 1], [0, h]], n * 4, { uv: 'cyl' });
  for (let i = 0; i < g.count; i++) {
    const y = g.p[i * 3 + 1];
    if (y > h * 0.86) continue;
    const x = g.p[i * 3], z = g.p[i * 3 + 2];
    const rr = Math.hypot(x, z);
    if (rr < r * 0.7) continue;
    const a = Math.atan2(x, z);
    const c = 0.5 + 0.5 * Math.cos(n * a);
    const s = 1 - depth * c * c * c;
    g.p[i * 3] = x * s; g.p[i * 3 + 2] = z * s;
  }
  g.computeNormals(true);
  return g;
}
// rotary knob: returns group (rotate around local Z). o: h, tint, flutes, skirt (false), pointer colour, name
export function knob(k, x, y, z, r, o = NO) {
  const g = k.grp(x, y, z, { name: o.name || 'knob' });
  if (o.angle) g.rotation.z = o.angle;
  k.within(g, () => {
    const h = o.h ?? r * 0.9;
    if (o.skirt !== false) k.cyl('metal', r * 1.3, 0.0024, 0, 0, 0.0012, { ...(o.skirtFin ?? FIN.alu), axis: 'z', seg: 28, bev: 0.0007 });
    const z0 = o.skirt !== false ? 0.0024 : 0;
    k.put(o.slot ?? 'dark', axisGeo(flutedGeo(r, h, o.flutes ?? 18), 'z'), 0, 0, z0, { tint: o.tint ?? 0x18181a, rough: o.rough ?? 0.75 });
    k.cyl('metal', r * 0.6, 0.0012, 0, 0, z0 + h + 0.0004, { ...(o.capFin ?? FIN.alu), axis: 'z', seg: 18 });
    k.box(o.pointer ?? '#ece6d6:g', r * 0.13, r * 0.62, 0.0008, 0, r * 0.52, z0 + h + 0.0002, { r: 0.0002 });
  }, o.static);
  return g;
}
// bat-handle toggle switch: returns the lever group (rotate local X; lever along +Y)
export function toggle(k, x, y, z, o = NO) {
  const fin = o.fin ?? FIN.chrome;
  k.push(x, y, z);
  if (o.plate !== false) k.box('metal', 0.026, 0.042, 0.0016, 0, 0, 0.0008, { ...FIN.alu, r: 0.0012 });
  k.cyl('metal', 0.0078, 0.0035, 0, 0, 0.0016 + 0.00175, { ...fin, axis: 'z', seg: 6, bev: 0.0006, rot: [0, 0, 0.3] });
  k.cyl('metal', 0.0048, 0.0075, 0, 0, 0.0016 + 0.0035 + 0.00375, { ...fin, axis: 'z', seg: 12 });
  if (o.guard) for (const s of [-1, 1]) k.box('metal', 0.002, 0.03, 0.016, s * 0.0085, 0.004, 0.012, { ...fin, r: 0.0008 });
  k.pop();
  const g = k.grp(x, y, z + 0.0126, { name: o.name || 'toggle' });
  g.rotation.x = o.on ? -0.45 : 0.45;
  const ls = o.leverSlot ?? 'metal';
  k.within(g, () => {
    k.sph(ls, 0.0036, 0, 0, 0, { ...fin, ws: 10, hs: 6 });
    k.lathe(ls, [[0.0014, 0], [0.0024, 0.004], [0.0017, 0.019], [0.0034, 0.0215], [0.0033, 0.024], [0, 0.0252]], 0, 0, 0, { ...fin, seg: 10, uv: 'cyl' });
    if (o.tip) k.sph(o.tip, 0.0042, 0, 0.023, 0, { ws: 10, hs: 8 });
  }, o.static);
  return g;
}
// push button: bezel ring + cap. Returns the cap group (translate local Z to press)
export function pushButton(k, x, y, z, r, o = NO) {
  const ringFin = o.ringFin ?? FIN.chrome;
  k.lathe(o.ringSlot ?? 'metal', [[r * 1.02, 0], [r * 1.42, 0, 1], [r * 1.42, 0.004, 2], [r * 1.3, 0.0085, 2], [r * 1.04, 0.0095, 2], [r * 1.04, 0.002]], x, y, z, { ...ringFin, axis: 'z', seg: 20 });
  const g = k.grp(x, y, z + 0.0095, { name: o.name || 'button' });
  k.within(g, () => {
    const h = o.h ?? r * 0.55, dome = o.dome ?? r * 0.22;
    const prof = [[0, -0.006], [r * 0.98, -0.006], [r, h * 0.7, 2], [r * 0.9, h + dome * 0.4], [r * 0.55, h + dome * 0.85], [0, h + dome]];
    k.lathe(o.slot ?? (k.A ? '#' + (o.tint ?? 0xc8231b).toString(16).padStart(6, '0') + ':s' : 'plastic'), prof, 0, 0, 0, { tint: o.tint ?? 0xc8231b, rough: o.rough ?? 0.5, axis: 'z', seg: 20, chip: 0.3 });
  }, o.static);
  return g;
}
// pilot lamp / LED with bezel; returns the lens mesh (own emissive material)
export function pilotLamp(k, x, y, z, r, color = 'red', o = NO) {
  const bez = o.bezel ?? 'chrome';
  const fin = bez === 'black' ? FIN.black : FIN[bez] || FIN.chrome;
  const t = Math.max(0.003, Math.min(0.009, r * 0.6));
  if (bez === 'plastic') k.lathe('dark', [[r * 1.05, 0], [r * 1.5, 0, 1], [r * 1.45, t * 0.8, 2], [r * 1.1, t, 2], [r * 1.05, t * 0.5]], x, y, z, { axis: 'z', seg: 16, tint: o.bezelTint ?? 0x1a1a1b });
  else {
    k.cyl('metal', r * 1.65, t * 0.35, x, y, z + t * 0.175, { ...fin, axis: 'z', seg: 6, bev: 0.0005, rot: [0, 0, 0.26] });
    k.lathe('metal', [[r * 1.02, t * 0.3], [r * 1.38, t * 0.3, 1], [r * 1.36, t * 0.95, 2], [r * 1.12, t * 1.12, 2], [r * 1.04, t * 0.9]], x, y, z, { ...fin, axis: 'z', seg: 16 });
  }
  // faceted (fresnel) dome lens
  const lp = [[0, 0], [r * 1.04, 0, 1], [r * 1.02, r * 0.18], [r * 0.9, r * 0.5], [r * 0.66, r * 0.74], [r * 0.34, r * 0.88], [0, r * 0.92]];
  const lens = axisGeo(latheGeo(lp, o.seg ?? 12, { uv: 'cyl' }), 'z');
  return k.mesh(lampMat(color, o.ov), lens, x, y, z + t * 0.55, { name: o.name || 'lamp_' + color, shadow: false });
}

// Round analog gauge; returns the needle pivot (rotate around local Z; use gaugeAngle(v)).
// o: dial options (label, max, red, green, labels, bg, ink, brand), bezel fin, cup fin, value, name, glass:false, screws
export function gauge(k, x, y, z, r, o = NO) {
  const reg = k.reg('dial_' + (o.key || [o.label, o.max, o.red, o.green, (o.labels || []).join(), o.bg].join('|')), o.px ?? 160, o.px ?? 160, (c, w, h) => drawDial(c, w, h, o), '', {});
  const bez = o.bezel ?? FIN.chrome, cup = o.cup ?? FIN.black;
  // cup / case (deep drawn steel)
  k.lathe(o.cupSlot ?? 'metal', [[0, -0.024], [r * 0.9, -0.024, 1], [r * 1.08, -0.018, 2], [r * 1.12, -0.006], [r * 1.12, 0]], x, y, z, { ...cup, axis: 'z', seg: 24 });
  // bezel ring with a rolled lip
  k.lathe('metal', [[r * 1.18, 0], [r * 1.2, 0.003, 2], [r * 1.16, 0.0075, 2], [r * 1.07, 0.0085, 2], [r * 1.0, 0.004, 2], [r * 0.97, 0.0005]], x, y, z, { ...bez, axis: 'z', seg: 28 });
  k.dlabel(reg, r * 0.985, x, y, z + 0.001, { seg: 28 });
  if (o.glass !== false) k.lathe('glass', [[r * 1.0, 0.0062], [r * 0.6, 0.008], [0, 0.0085]], x, y, z, { axis: 'z', seg: 24 });
  if (o.screws) for (let i = 0; i < 3; i++) { const a = HP + (i * TAU) / 3; screw(k, x + Math.cos(a) * r * 1.14, y + Math.sin(a) * r * 1.14, z + 0.006, { r: 0.0018, kind: 'slot' }); }
  // o.noNeedle: the caller builds the needle itself (e.g. as a bone of a shared skinned mesh)
  if (o.noNeedle) return [x, y, z + 0.0035, [0, 0, gaugeAngle(o.value ?? 0.3)], o.name || 'needle'];
  const piv = k.grp(x, y, z + 0.0035, { name: o.name || 'needle' });
  piv.rotation.z = gaugeAngle(o.value ?? 0.3);
  k.within(piv, () => needle(k, r, o), o.static);
  return piv;
}
// gauge needle + hub at the pivot (current frame, rotates about local Z)
export function needle(k, r, o = NO) {
  const s = new THREE.Shape();
  s.moveTo(-r * 0.04, -r * 0.2); s.lineTo(r * 0.04, -r * 0.2); s.lineTo(r * 0.013, r * 0.78); s.lineTo(0, r * 0.84); s.lineTo(-r * 0.013, r * 0.78); s.closePath();
  k.ext(o.needle ?? '#d42a1a:g', s, 0.0012, 0, 0, 0);
  k.cyl(o.hub ?? '#18181a:m', r * 0.075, 0.003, 0, 0, 0.0015, { axis: 'z', seg: 10, bev: 0.0006, bevSeg: 1 });
}

// ---------------------------------------------------------------------------
// Vents
// ---------------------------------------------------------------------------
// stamped louvres. raised (default): lips pressed out of a solid panel (opening downward) over a dark
// backing; o.raised === false: recessed blades in a real opening (cavity behind z)
export function louvre(k, x, y, z, w, h, n, o = NO) {
  const slot = o.slot ?? 'paint', mo = o.mo ?? {};
  const pitch = h / n;
  if (o.raised !== false) {
    const phi = o.angle ?? 0.5, lh = pitch * 0.92;
    k.box('#08080a', w - 0.004, h - 0.004, 0.0008, x, y, z + 0.0004, { r: 0 });
    for (let i = 0; i < n; i++) {
      const yy = y - h / 2 + (i + 0.5) * pitch;
      const zc = z + 0.0008 + (lh / 2) * Math.sin(phi);
      k.box(slot, w - 0.006, lh, 0.0012, x, yy, zc, { ...mo, r: 0, rot: [-phi, 0, 0], edge: 1.4 });
      for (const sx of [-1, 1]) k.box(slot, 0.0012, lh * 0.55, lh * Math.sin(phi) * 0.9, x + sx * (w / 2 - 0.0035), yy - lh * 0.2, z + 0.0008 + lh * Math.sin(phi) * 0.45, { ...mo, r: 0 });
    }
    if (o.frame !== false) k.ext(slot, frameShape(w + (o.fw ?? 0.012), h + (o.fw ?? 0.012), 0.004, w, h, 0.002), 0.0016, x, y, z, { ...mo, bev: 0.0006, bevSeg: 1, curveSeg: 2 });
    return;
  }
  const depth = o.depth ?? 0.01;
  k.box('#08080a', w, h, 0.002, x, y, z - depth);
  for (const sx of [-1, 1]) k.box(slot, 0.002, h, depth, x + sx * (w / 2 - 0.001), y, z - depth / 2, { ...mo, r: 0 });
  for (let i = 0; i < n; i++) k.box(slot, w - 0.003, pitch * 1.02, 0.0012, x, y - h / 2 + (i + 0.5) * pitch, z - depth * 0.45, { ...mo, r: 0, rot: [-0.72, 0, 0], edge: 1.4 });
  if (o.frame !== false) k.ext(slot, frameShape(w + (o.fw ?? 0.014), h + (o.fw ?? 0.014), 0.004, w, h, 0.002), 0.0035, x, y, z - 0.0015, { ...mo, bev: 0.0012, bevSeg: 1, curveSeg: 2 });
}
// punched slot vent plate (applied over a surface): plate with rounded slots over a dark back
export function slotVent(k, x, y, z, w, h, n, o = NO) {
  const slot = o.slot ?? 'paint', mo = o.mo ?? {};
  const vert = !!o.vertical, t = o.t ?? 0.0018, m = o.margin ?? 0.012;
  const s = rrShape(w, h, o.cr ?? 0.004);
  for (let i = 0; i < n; i++) {
    if (vert) { const sw = (w - 2 * m) / n; s.holes.push(rrHole(sw * 0.5, h - 2 * m, sw * 0.25, -w / 2 + m + (i + 0.5) * sw, 0)); }
    else { const sh = (h - 2 * m) / n; s.holes.push(rrHole(w - 2 * m, sh * 0.5, sh * 0.25, 0, -h / 2 + m + (i + 0.5) * sh)); }
  }
  k.box('#09090b', w - 2 * m + 0.004, h - 2 * m + 0.004, 0.0006, x, y, z + 0.0003);
  k.ext(slot, s, t, x, y, z, { ...mo, bev: Math.min(0.0006, t * 0.3), curveSeg: 4 });
}
// perforated grille (round holes through a plate) over a dark cavity
export function perfGrille(k, x, y, z, w, h, o = NO) {
  const slot = o.slot ?? 'paint', mo = o.mo ?? {};
  const step = o.step ?? 0.012, hr = o.hr ?? 0.0035, t = o.t ?? 0.0015;
  const s = rrShape(w, h, o.cr ?? 0.006);
  const nx = Math.floor((w - 0.012) / step), ny = Math.floor((h - 0.012) / step);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px = -((nx - 1) * step) / 2 + i * step + (j % 2 ? step / 2 : 0);
    if (Math.abs(px) > w / 2 - 0.008) continue;
    s.holes.push(new THREE.Path().absarc(px, -((ny - 1) * step) / 2 + j * step, hr, 0, TAU, true));
  }
  k.box('#09090b', w - 0.006, h - 0.006, 0.0006, x, y, z + 0.0003);
  k.ext(slot, s, t, x, y, z, { ...mo, curveSeg: 3 });
}

// ---------------------------------------------------------------------------
// Cables & conduit
// ---------------------------------------------------------------------------
// flexible cable through control points (smooth). o: tint, slot, radial, n (samples), caps
export function cable(k, pts, r = 0.006, o = NO) {
  const P = pts.map(toV);
  let len = 0;
  for (let i = 1; i < P.length; i++) len += P[i].distanceTo(P[i - 1]);
  const n = o.n ?? Math.max(6, Math.min(64, Math.ceil(len / Math.max(0.012, r * 3))));
  const path = P.length > 2 ? curvePts(P, n) : P;
  // insulation: palette swatch through the atlas material by default (no extra draw call)
  const slot = o.slot ?? (k.A ? '#' + (o.tint ?? 0x1c1c1d).toString(16).padStart(6, '0') + (o.gloss ? ':s' : ':p') : 'dark');
  return k.tube(slot, path, r, { tint: o.tint ?? 0x1c1c1d, rough: o.rough ?? 0.85, radial: o.radial ?? 7, caps: o.caps ?? true, ...(o.mo || {}) });
}
// cable gland on a surface facing +Z: hex body, dome nut, cable leaving along `dir` (cable drawn by caller)
export function gland(k, x, y, z, r = 0.009, o = NO) {
  const fin = o.fin ?? FIN.zinc;
  k.push(x, y, z, o.dir ? FACE_ROT[o.dir] : null);
  k.cyl('metal', r * 1.25, r * 0.55, 0, 0, r * 0.275, { ...fin, axis: 'z', seg: 6, bev: r * 0.08 });
  k.lathe(o.domeSlot ?? (k.A ? '#' + (o.domeTint ?? 0x202022).toString(16).padStart(6, '0') + ':p' : 'dark'), [[r * 1.05, 0], [r * 1.08, r * 0.5, 2], [r * 0.85, r * 1.0], [r * 0.6, r * 1.15], [0.0, r * 1.18]], 0, 0, r * 0.55, { axis: 'z', seg: 12, tint: o.domeTint ?? 0x202022 });
  k.pop();
}
// straight conduit with couplings + mounting straps (axis from a to b)
export function conduit(k, a, b, r = 0.011, o = NO) {
  const A = toV(a), B = toV(b), L = A.distanceTo(B);
  const fin = o.fin ?? FIN.zinc;
  const opt = { ...fin, rust: o.rust ?? k.wear.rust, chip: 0 };
  const dir = B.clone().sub(A).normalize();
  k.tube('metal', [A, B], r, { ...opt, radial: o.radial ?? 10, caps: false });
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
  const cpl = o.couplings ?? Math.floor(L / 0.9);
  for (let i = 1; i <= cpl; i++) {
    const p = A.clone().lerp(B, i / (cpl + 1));
    k.put('metal', cylGeo(r * 1.22, 0.04, { seg: 10, bev: 0.002 }), p.x, p.y, p.z, { ...opt, q });
  }
}

// ---------------------------------------------------------------------------
// Labels, plates, stripes, grime
// ---------------------------------------------------------------------------
// riveted metal nameplate showing atlas region `reg` (draw it with kind 'b' for brushed metal)
export function plate(k, reg, w, h, x, y, z, o = NO) {
  const t = o.t ?? 0.0012;
  k.box('metal', w, h, t, x, y, z + t / 2, { ...(o.fin ?? FIN.alu), r: Math.min(0.002, t * 0.45) });
  k.label(reg, w - (o.inset ?? 0.002), h - (o.inset ?? 0.002), x, y, z + t + 0.0001, o.lo || NO);
  if (o.rivets !== false) {
    const d = o.rd ?? Math.min(w, h) * 0.12;
    const pts = o.rivets === 2 ? [[-1, 0], [1, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [sx, sy] of pts) screw(k, x + sx * (w / 2 - d), y + sy * (o.rivets === 2 ? 0 : h / 2 - d), z + t, { kind: 'rivet', r: o.rr ?? 0.0022, fin: o.rivetFin ?? FIN.alu });
  }
}
// clip a convex polygon [[x,y],...] to an axis-aligned rect
function clipRect(poly, x0, y0, x1, y1) {
  let out = poly;
  const edges = [[(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= y0, (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y0]; }],
    [(p) => p[1] <= y1, (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y1]; }]];
  for (const [inside, inter] of edges) {
    const inp = out; out = [];
    if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(inter(prev, cur)); out.push(cur); } else if (pi) out.push(inter(prev, cur));
    }
  }
  return out;
}
// painted hazard stripes on a flat rectangle facing +Z (w x h at x, y, z): yellow ground + black bands
// (real geometry, so the paint chips / wears like the rest). o: sw (band width), t, colors, angle sign
export function hazardRect(k, w, h, x, y, z, o = NO) {
  const t = o.t ?? 0.0012, sw = o.sw ?? 0.05, dir = o.dir ?? 1;
  const c0 = o.c0 ?? 0xd8a21a, c1 = o.c1 ?? 0x1a1917;
  const mo = { chip: o.chip ?? Math.max(0.25, k.wear.chip), rust: o.rust ?? k.wear.rust, ...(o.mo || {}) };
  if (o.base !== false) k.box('paint', w, h, t, x, y, z + t / 2, { ...mo, tint: c0, r: Math.min(0.0008, t * 0.4) });
  const g = new Geo();
  for (let u = -w / 2 - h - sw * 2; u < w / 2 + sw; u += sw * 2) {
    const poly = dir > 0 ? [[u, -h / 2], [u + sw, -h / 2], [u + sw + h, h / 2], [u + h, h / 2]] : [[u + h, -h / 2], [u + h + sw, -h / 2], [u + sw, h / 2], [u, h / 2]];
    const c = clipRect(poly, -w / 2, -h / 2, w / 2, h / 2);
    if (c.length < 3) continue;
    const base = g.count;
    for (const [px, py] of c) g.v(px, py, 0, 0, 0, 1, px, py, 0);
    for (let i = 1; i < c.length - 1; i++) g.tri(base, base + i, base + i + 1);
  }
  k.put('paint', g, x, y, z + t + 0.0002, { ...mo, tint: c1 });
}
// grime / rust run-off streak decal hanging down from (x, y) on the current +Z face
export function streak(k, x, y, z, w, len, o = NO) {
  const col = o.col ?? '96,42,14';
  const key = 'streak_' + col + '_' + (o.variant ?? (k.rng.next() * 3) | 0);
  const reg = k.reg(key, 48, 160, (c, ww, hh, rng) => drawStreak(c, ww, hh, (rng.next() * 1000) | 0, col, { alpha: o.alpha ?? 0.55, n: o.n ?? 4 }));
  k.decal(reg, w, len, x, y - len / 2, z, { rot: o.rot });
}
export function stain(k, x, y, z, w, h, o = NO) {
  const col = o.col ?? '40,30,18';
  const key = 'stain_' + col + '_' + (o.ring ? 1 : 0) + (o.variant ?? (k.rng.next() * 2) | 0);
  const reg = k.reg(key, 96, 96, (c, ww, hh, rng) => drawStain(c, ww, hh, (rng.next() * 1000) | 0, col, o.alpha ?? 0.5, { ring: o.ring }));
  k.decal(reg, w, h, x, y, z, { rot: o.rot });
}
export function scuffs(k, x, y, z, w, h, o = NO) {
  const col = o.col ?? '255,255,255';
  const reg = k.reg('scuff_' + col, 128, 128, (c, ww, hh, rng) => drawScuffs(c, ww, hh, (rng.next() * 1000) | 0, col, o.alpha ?? 0.35));
  k.decal(reg, w, h, x, y, z, { rot: o.rot });
}
export function handprint(k, x, y, z, s, o = NO) {
  const reg = k.reg('hand', 96, 96, (c, ww, hh, rng) => drawHandprint(c, ww, hh, (rng.next() * 1000) | 0, o.col ?? '30,24,16', o.alpha ?? 0.3));
  k.decal(reg, s, s, x, y, z, { rot: o.rot });
}
// text sticker helper (atlas region drawn by fn) at (x,y,z) facing +Z
export function sticker(k, key, pxW, pxH, draw, w, h, x, y, z, o = NO) {
  const reg = k.reg(key, pxW, pxH, draw, o.kind ?? '');
  return k.label(reg, w, h, x, y, z, o);
}

// ---------------------------------------------------------------------------
// Structural shapes
// ---------------------------------------------------------------------------
// L-profile angle iron along X (length L), legs a (vertical, +Y) and b (horizontal, +Z), thickness t
export function angleIron(k, slot, L, a, b, t, x, y, z, o = NO) {
  const s = polyShape([[0, 0], [b, 0], [b, t], [t, t], [t, a], [0, a]]);
  const g = extrudeGeo(s, L, { bev: Math.min(0.0015, t * 0.3) });
  // shape in XY (x = horizontal leg, y = vertical leg), extruded along Z -> rotate so the length runs along X
  g.rotY(-HP);
  g.translate(L / 2, 0, 0);
  k.put(slot, g, x, y, z, o);
}
// rectangular hollow section / C-channel helper: thin-walled box tube along X
export function rhs(k, slot, L, w, h, t, x, y, z, o = NO) {
  const s = frameShape(w, h, Math.min(0.004, t * 1.5), w - 2 * t, h - 2 * t, Math.min(0.002, t), 0, 0);
  const g = extrudeGeo(s, L, { bev: Math.min(0.0015, t * 0.4), bevSeg: 1, curveSeg: 2 });
  g.rotY(-HP);
  g.translate(L / 2, 0, 0);
  k.put(slot, g, x, y, z, o);
}
// weld bead along a polyline (lumpy thin tube)
export function weld(k, pts, r = 0.003, o = NO) {
  const P = pts.length > 2 ? curvePts(pts.map(toV), Math.max(8, pts.length * 6)) : pts.map(toV);
  const path = [];
  for (let i = 1; i < P.length; i++) {
    const m = Math.max(1, Math.ceil(P[i].distanceTo(P[i - 1]) / (r * 2.2)));
    for (let j = 0; j < m; j++) path.push(P[i - 1].clone().lerp(P[i], j / m));
  }
  path.push(P[P.length - 1]);
  k.tube('metal', path, (t, i) => r * (0.82 + 0.32 * Math.abs(Math.sin(i * 1.7))), { ...(o.fin ?? { tint: 0x6a6662, rough: 1.2 }), radial: 5, caps: true, rust: o.rust ?? k.wear.rust * 1.5 });
}

// C-channel along X: web in the XY plane at z, flanges of width b toward +Z (o.flip: toward -Z)
export function channel(k, slot, L, h, b, t, x, y, z, o = NO) {
  const s = polyShape([[0, -h / 2], [b, -h / 2], [b, -h / 2 + t], [t, -h / 2 + t], [t, h / 2 - t], [b, h / 2 - t], [b, h / 2], [0, h / 2]]);
  const g = extrudeGeo(s, L, { bev: Math.min(0.0015, t * 0.3), bevSeg: 1, curveSeg: 2 });
  g.rotY(-HP);
  g.translate(L / 2, 0, 0);
  if (o.flip) g.scale(1, 1, -1);
  k.put(slot, g, x, y, z, o);
}
// cylinder / rod between two points (in the current frame)
export function rod(k, slot, a, b, r, o = NO) {
  const A = toV(a), B = toV(b), L = A.distanceTo(B);
  const q = qUp(B.clone().sub(A));
  const m = A.clone().add(B).multiplyScalar(0.5);
  k.put(slot, cylGeo(r, L, { seg: o.seg ?? 10, r2: o.r2, bev: o.bev, bevSeg: o.bevSeg ?? 1, caps: o.caps }), m.x, m.y, m.z, { ...o, q });
}

export { CLEAR, txt };
