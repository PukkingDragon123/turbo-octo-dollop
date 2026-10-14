// Tables & office furniture: folding banquet table, cafe table, office desk, cubicle panel, whiteboard.
import * as THREE from 'three';
import { def, boxGeo, cylGeo, latheGeo, tubeGeo, cushionGeo, roundPath, gridGeo, quadGeo, CB, CC, CP, CCbetween, CBbetween, CPbetween, V, PI, TAU, HP, clamp, lerp } from './core.js';
import { matFor, tint } from './mats.js';
import { screw, glide, caster, barPull, cabinetPull } from './parts.js';

// rectangular edge band (T-molding) around a top of size w x d at height y, band height h, thickness t
function edgeBand(b, slot, w, d, y, h, t = 0.004, r = 0.0018) {
  for (const s of [-1, 1]) {
    b.box(slot, w + 2 * t, h, t, 0, y, s * (d / 2 + t / 2), { r, grain: 'x', wear: 0 });
    b.box(slot, t, h, d, s * (w / 2 + t / 2), y, 0, { r, grain: 'z', wear: 0 });
  }
}

// ===========================================================================
// Folding banquet table (6 ft): laminate top with vinyl T-molding, steel apron rails, tubular
// U-legs with gate braces & lock rings, rubber feet.
// ===========================================================================
def('table_folding', {
  variants: 3,
  mats: (o, v) => ({ top: matFor(['laminate', 'laminate_beige', 'oak'][v]), frame: tint('paint_dark', o.color ?? [0x3a3c3f, 0x5c5e60, 0x3a3c3f][v]) }),
  build(b) {
    const W = 1.52, D = 0.76, H = 0.76, T = 0.03;
    b.box('top', W - 0.008, T, D - 0.008, 0, H - T / 2, 0, { r: 0.002, grain: 'x', wear: 0.008 });
    edgeBand(b, '#232325', W - 0.008, D - 0.008, H - T / 2, T + 0.004, 0.006);
    // underside: particle board face + steel apron rails
    for (const s of [-1, 1]) {
      b.box('frame', W - 0.2, 0.034, 0.022, 0, H - T - 0.017, s * (D / 2 - 0.08), { r: 0.003 });
      for (const x of [-0.6, -0.2, 0.2, 0.6]) screw(b, '#6e6c68', [x, H - T - 0.034, s * (D / 2 - 0.08)], [0, -1, 0], 0.004, 'phillips');
    }
    const yb = H - T - 0.034;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.16);
      // U-leg: two uprights joined by a top rail (pivot), cross bar near the floor
      b.tube('frame', roundPath([[x, 0.024, -0.31], [x, yb - 0.012, -0.31], [x, yb - 0.012, 0.31], [x, 0.024, 0.31]], 0.05, 6), 0.0127, { radial: 10, caps: true });
      b.cyl('frame', 0.009, 0.62, x, 0.12, 0, { axis: 'z', seg: 8 });
      for (const z of [-0.31, 0.31]) {
        b.cyl('#1a1a1b', 0.0155, 0.026, x, 0.013, z, { seg: 10, bevel: 0.004 });
        b.box('frame', 0.05, 0.022, 0.04, x, yb + 0.011, z, { r: 0.003 });
        screw(b, '#6e6c68', [x + 0.012, yb, z], [0, -1, 0], 0.004, 'hex');
      }
      // gate brace (two flat bars) from the cross bar to the centre bracket + lock ring
      const bx = x - sx * 0.42;
      b.boxBetween('frame', [x, 0.13, 0], [bx, yb - 0.006, 0], 0.024, 0.005, { r: 0.0015 });
      b.box('frame', 0.07, 0.02, 0.05, bx, yb + 0.01, 0, { r: 0.004 });
      b.cyl('#c9cbcd:m', 0.016, 0.026, x - sx * 0.07, 0.13 + (0.42 - 0.07) * 0, 0, { axis: 'x', seg: 12, bevel: 0.003 });
    }
    b.decal('asset_tag', 0.07, 0.026, 0.3, H - T - 0.0006, 0, { rot: [HP, 0, 0], slot: 'atlas' });
    b.decal('stain', 0.16, 0.14, -0.34, H + 0.0006, 0.12, { rot: [-HP, 0, 0.4] });
    return {
      colliders: [CB(W + 0.012, T + 0.004, D + 0.012, 0, H - T / 2, 0), ...[-1, 1].flatMap((sx) => [-0.31, 0.31].map((z) => CC(0.0155, yb, sx * (W / 2 - 0.16), yb / 2, z)))],
      mass: 16, material: 'wood', friction: 0.5, breakInto: ['plank', 'metal_tube', 'metal_tube', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Cafe / break-room table: round laminate top with T-molding, spider plate, column, cast base.
// ===========================================================================
def('table_round', {
  variants: 4,
  geoVariant: (v) => v % 2,
  mats: (o, v) => ({ top: matFor(['laminate_beige', 'laminate', 'laminate_grey', 'laminate'][v]), base: matFor(v % 2 ? 'chrome' : 'paint_black') }),
  build(b, gv) {
    const H = 0.73, R = 0.3, T = 0.026;
    b.cyl('top', R - 0.004, T, 0, H - T / 2, 0, { seg: 40, bevel: 0.0015 });
    // T-molding edge
    b.lathe('rubber', [[R - 0.006, H - T - 0.001], [R + 0.002, H - T - 0.001, 1], [R + 0.0045, H - T + 0.004], [R + 0.0045, H - 0.004], [R + 0.002, H + 0.001, 1], [R - 0.006, H + 0.001]], 0, 0, 0, { seg: 40 });
    // spider plate under the top + screws
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2 + PI / 4;
      b.box('base', 0.34, 0.012, 0.032, 0, H - T - 0.008, 0, { r: 0.003, rot: [0, a, 0] });
      screw(b, '#5a5856', [Math.cos(a) * 0.155, H - T - 0.014, -Math.sin(a) * 0.155], [0, -1, 0], 0.0045, 'phillips');
    }
    b.cyl('base', 0.05, 0.03, 0, H - T - 0.024, 0, { seg: 18, bevel: 0.004 });
    // column with a collar at the bottom
    b.lathe('base', [[0.036, 0.05], [0.028, 0.08], [0.028, H - T - 0.04], [0.036, H - T - 0.034]], 0, 0, 0, { seg: 18 });
    if (gv === 0) {
      // 4-prong cast iron base with levelling glides
      for (let i = 0; i < 4; i++) {
        const a = (i * PI) / 2;
        const g = boxGeo(0.25, 0.045, 0.05, { r: 0.012, seg: 2, grain: 'x' });
        g.taper(0, -0.125, 0.125, 1, 0.7);
        g.deform((q) => { const t = (q.x + 0.125) / 0.25; q.y -= t * 0.02 * (q.y > 0 ? 1 : 0.4); }, false);
        b.put('base', g, Math.cos(a) * 0.125, 0.045, -Math.sin(a) * 0.125, { rot: [0, a, 0] });
        glide(b, '#2a2927', Math.cos(a) * 0.235, 0, -Math.sin(a) * 0.235, 0.013, 0.012);
      }
      b.lathe('base', [[0.06, 0.02], [0.062, 0.05], [0.05, 0.075], [0.036, 0.08]], 0, 0, 0, { seg: 18 });
    } else {
      // heavy round disc base
      b.lathe('base', [[0, 0.004], [0.215, 0.004, 1], [0.222, 0.01], [0.2, 0.026], [0.07, 0.04], [0.04, 0.05], [0.036, 0.055]], 0, 0, 0, { seg: 36 });
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; b.cyl('rubber', 0.014, 0.004, Math.cos(a) * 0.19, 0.002, Math.sin(a) * 0.19, { seg: 10 }); }
    }
    b.decal('stain', 0.12, 0.12, 0.08, H + 0.0012, -0.05, { rot: [-HP, 0, 1.1] });
    return {
      colliders: gv === 0
        ? [CC(R + 0.005, T + 0.002, 0, H - T / 2, 0), CC(0.03, H - T - 0.06, 0, (H - T - 0.06) / 2 + 0.05, 0), CB(0.5, 0.06, 0.05, 0, 0.03, 0), CB(0.05, 0.06, 0.5, 0, 0.03, 0)]
        : [CC(R + 0.005, T + 0.002, 0, H - T / 2, 0), CC(0.03, H - T - 0.06, 0, (H - T - 0.06) / 2 + 0.05, 0), CC(0.222, 0.055, 0, 0.0275, 0)],
      mass: 11, material: 'wood', breakInto: ['plank', 'metal_tube', 'screws'], anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Single-pedestal office desk. Geometry 0: walnut case with a woodgrain laminate top and vinyl
// edge; geometry 1: steel "tanker" desk (painted body, laminate top with aluminium trim).
// Drawers are animated parts drawer0..2 (+ centre pencil drawer drawerC).
// ===========================================================================
def('desk', {
  variants: 4,
  geoVariant: (v) => (v === 1 || v === 3 ? 1 : 0),
  mats: (o, v) => {
    if (v === 1 || v === 3) return { body: tint('paint_grey', o.color ?? (v === 1 ? 0x8a8f8c : 0x6f7462)), top: matFor(v === 1 ? 'laminate_beige' : 'laminate') };
    return { body: o.color !== undefined ? tint('walnut', o.color) : matFor(v === 2 ? 'teak' : 'walnut'), top: matFor('laminate') };
  },
  build(b, gv) {
    const W = 1.5, D = 0.75, H = 0.76, T = 0.03, steel = gv === 1;
    // top + edge
    b.box('top', W - 0.01, T, D - 0.01, 0, H - T / 2, 0, { r: 0.002, grain: 'x', wear: 0.01 });
    edgeBand(b, steel ? '#b8bcbe:m' : '#2a2724', W - 0.01, D - 0.01, H - T / 2, T + (steel ? 0.002 : 0), 0.005);
    // grommet hole for cables
    b.cyl('#141414', 0.03, 0.004, -W / 2 + 0.13, H + 0.0004, -D / 2 + 0.1, { seg: 18 });
    b.cyl('#1c1c1c', 0.034, 0.003, -W / 2 + 0.13, H + 0.0012, -D / 2 + 0.1, { seg: 18, open: true, caps: false });
    const yT = H - T;
    // end panel (left) on glides
    b.box('body', 0.025, yT - 0.012, D - 0.04, -W / 2 + 0.035, (yT + 0.012) / 2, 0, { r: steel ? 0.004 : 0.003, grain: 'y', wear: 0.012 });
    for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) glide(b, '#2a2927', -W / 2 + 0.035, 0, z, 0.012, 0.012);
    // pedestal (right): sides, back, plinth, drawer opening
    const pw = 0.43, px = W / 2 - 0.235;
    for (const s of [-1, 1]) b.box('body', 0.02, yT - 0.012, D - 0.04, px + s * (pw / 2 - 0.01), (yT + 0.012) / 2, 0, { r: 0.003, grain: 'y', wear: 0.012 });
    b.box('body', pw - 0.04, yT - 0.03, 0.012, px, yT / 2, -D / 2 + 0.03, { r: 0.002 });
    b.box('#1e1c1a', pw - 0.04, 0.055, 0.02, px, 0.04, D / 2 - 0.075, { r: 0.002 });
    b.box('#121110', pw - 0.04, yT - 0.08, 0.005, px, yT / 2 + 0.03, D / 2 - 0.085);
    for (const s of [-1, 1]) for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) glide(b, '#2a2927', px + s * (pw / 2 - 0.02), 0, z, 0.012, 0.012);
    // modesty panel
    b.box('body', W - pw - 0.08, 0.42, 0.018, (-W / 2 + 0.05 + px - pw / 2) / 2, yT - 0.21, -D / 2 + 0.06, { r: 0.003, grain: 'x' });
    // centre pencil drawer (static)
    {
      const cw = 0.56, cx = (-W / 2 + 0.05 + px - pw / 2) / 2, cy = yT - 0.04, fz = D / 2 - 0.03;
      b.box('body', cw, 0.06, 0.02, cx, cy, fz + 0.01, { r: 0.004, grain: 'x', wear: 0.01 });
      if (steel) b.box('#b8bcbe:m', cw * 0.4, 0.012, 0.012, cx, cy - 0.022, fz + 0.025, { r: 0.004 });
      else b.box('#141210', cw * 0.38, 0.008, 0.012, cx, cy - 0.036, fz + 0.012, { r: 0.002 });
    }
    // pedestal drawers: drawer0 (top) is an animated part, the others are merged
    const fz = D / 2 - 0.03;
    const hs = [0.13, 0.19, 0.31];
    let yTop = yT - 0.014;
    hs.forEach((h, i) => {
      const cy = yTop - h / 2;
      const p = i === 0 ? b.part('drawer0', px, cy, fz, { axis: 'z', maxOpen: 0.35 }) : b;
      p.box('body', pw - 0.046, h - 0.008, 0.022, px, cy, fz + 0.011, { r: steel ? 0.006 : 0.004, grain: 'x', wear: 0.012 });
      const hy = i === 2 ? cy + h / 2 - 0.06 : cy;
      const pullMat = steel ? '#c8ccce:m' : '#c9a65a:m';
      if (steel) cabinetPull(p, pullMat, px, hy, fz + 0.022, { w: 0.13, labelDy: i === 2 ? -0.04 : 0.032 });
      else barPull(p, pullMat, px, hy, fz + 0.022, 0.12, { d: 0.026, r: 0.0045 });
      if (i === 0) {
        p.cyl('#d0d2d4:m', 0.0095, 0.012, px + 0.15, cy, fz + 0.026, { axis: 'z', seg: 14, bevel: 0.002 });
        p.box('#2a2a2a', 0.0025, 0.009, 0.002, px + 0.15, cy, fz + 0.0325);
        // drawer box + contents (only this drawer opens)
        const bd = 0.58, bz = fz - bd / 2;
        for (const s of [-1, 1]) p.box('body', 0.01, h - 0.04, bd, px + s * (pw / 2 - 0.035), cy - 0.01, bz, { r: 0, grain: 'z' });
        p.box('body', pw - 0.07, 0.008, bd, px, cy - h / 2 + 0.014, bz, { r: 0, grain: 'z' });
        p.box('body', pw - 0.07, h - 0.04, 0.01, px, cy - 0.01, fz - bd, { r: 0, grain: 'x' });
        for (let k = 0; k < 5; k++) p.cyl(['#d9b23a', '#c2412f', '#2f4f8a', '#d9b23a', '#2a2a2a'][k], 0.0035, 0.17, px - 0.12 + k * 0.03, cy - h / 2 + 0.022, fz - 0.15 - k * 0.04, { rot: [HP, 0.25 * k, 0], seg: 6 });
        p.box('#e8e2c8', 0.076, 0.006, 0.076, px + 0.1, cy - h / 2 + 0.021, fz - 0.2, { r: 0, rot: [0, 0.3, 0] });
        p.decal('memo', 0.15, 0.2, px - 0.05, cy - h / 2 + 0.0185, fz - 0.4, { rot: [-HP, 0, 0.1], slot: 'atlas' });
      }
      if (i === 2 && steel) p.decal('fc_label', 0.07, 0.027, px, hy - 0.04, fz + 0.0255, { slot: 'atlas', cell: 3, cols: 3, rows: 2 });
      yTop -= h + 0.008;
    });
    // wear: coffee ring, asset tag
    b.decal('stain', 0.11, 0.11, -0.35, H + 0.0006, 0.05, { rot: [-HP, 0, 0.3] });
    b.decal('asset_tag', 0.07, 0.026, px + pw / 2 + 0.0006, 0.6, 0.15, { rot: [0, HP, 0], slot: 'atlas' });
    return {
      colliders: [CB(W, T, D, 0, H - T / 2, 0), CB(0.025, yT, D - 0.04, -W / 2 + 0.035, yT / 2, 0), CB(pw, yT, D - 0.04, px, yT / 2, 0), CB(W - pw - 0.08, 0.42, 0.018, (-W / 2 + 0.05 + px - pw / 2) / 2, yT - 0.21, -D / 2 + 0.06)],
      mass: 48, material: steel ? 'metal' : 'wood', friction: 0.3, breakInto: steel ? ['metal_scrap', 'metal_scrap', 'plank', 'screws'] : ['plank', 'plank', 'plank', 'screws'],
      anchors: { top: [-0.2, H, -0.05], chair: [-0.25, 0, D / 2 + 0.35] },
    };
  },
});

// ===========================================================================
// Cubicle panel: fabric-wrapped acoustic panel with plastic trim caps, raceway base, stabiliser
// feet, pinned memo / calendar / sticky notes with push pins.
// ===========================================================================
def('desk_cubicle_panel', {
  variants: 4,
  mats: (o, v) => ({ fab: tint('fabric', o.color ?? [0x6c7280, 0x5f6a63, 0x7a7468, 0x56606e][v]), trim: matFor(v < 2 ? 'plastic_grey' : 'plastic_beige') }),
  build(b, gv) {
    const W = 1.5, H = 1.5, T = 0.065;
    // fabric faces: slightly pillowed panel
    const pan = cushionGeo(W - 0.05, H - 0.11, T - 0.008, { r: 0.008, cell: 0.12, crown: 0, bulge: 0, wrinkle: 0.0008, wrinkleFreq: 5, seed: 70 + gv });
    // rotate cushion so its thin axis is Z: cushion axes (x, y=H, z=T) already: w=W, h=H, d=T
    b.put('fab', pan.geo, 0, 0.08 + (H - 0.11) / 2, 0);
    // trim caps
    b.box('trim', W, 0.032, T + 0.008, 0, H - 0.016, 0, { r: 0.012, seg: 2, grain: 'x' });
    for (const s of [-1, 1]) b.box('trim', 0.03, H - 0.03, T + 0.008, s * (W / 2 - 0.015), (H - 0.03) / 2 + 0.002, 0, { r: 0.01, seg: 2, grain: 'y' });
    // raceway base with outlet cover plates
    b.box('trim', W - 0.06, 0.08, T + 0.004, 0, 0.04 + 0.002, 0, { r: 0.006 });
    for (const s of [-1, 1]) {
      b.box('#cfcab8', 0.07, 0.045, 0.004, s * 0.4, 0.045, T / 2 + 0.003, { r: 0.002 });
      for (const k of [-1, 1]) b.box('#2a2826', 0.008, 0.014, 0.002, s * 0.4 + k * 0.008, 0.048, T / 2 + 0.0055, { r: 0 });
    }
    // stabiliser feet with levelers
    for (const s of [-1, 1]) {
      b.box('paint_dark', 0.05, 0.026, 0.46, s * 0.6, 0.013 + 0.004, 0, { r: 0.006, wear: 0.01 });
      for (const z of [-0.2, 0.2]) glide(b, '#222', s * 0.6, 0, z, 0.016, 0.005);
    }
    // pinned papers
    const fz = T / 2 + 0.0016;
    b.decal('memo', 0.21, 0.28, -0.35, 1.08, fz, { rot: [0, 0, 0.03], slot: 'atlas' });
    b.decal('calendar', 0.2, 0.28, 0.32, 1.12, fz, { rot: [0, 0, -0.02], slot: 'atlas' });
    b.decal('sticky', 0.076, 0.076, -0.15, 0.98, fz + 0.0006, { rot: [0, 0, -0.12], slot: 'atlas' });
    b.decal('sticky', 0.076, 0.076, 0.55, 0.92, fz + 0.0006, { rot: [0, 0, 0.18], slot: 'atlas' });
    for (const [x, y, c] of [[-0.35, 1.21, '#c0302a:g'], [0.32, 1.25, '#2f5d9e:g'], [-0.15, 1.015, '#3f8a4a:g'], [0.4, 0.99, '#c0302a:g'], [0.55, 0.955, '#d9b23a:g']]) {
      b.cyl('#c8c8c8:m', 0.0012, 0.008, x, y, fz + 0.004, { axis: 'z', seg: 5, caps: false });
      b.sphere(c, 0.0065, x, y, fz + 0.01, { ws: 8, hs: 6, scale: [1, 1, 0.8] });
    }
    b.decal('waterstain', 0.3, 0.25, 0.2, 0.35, fz);
    return {
      colliders: [CB(W, H, T + 0.008, 0, H / 2, 0), CB(0.05, 0.03, 0.46, -0.6, 0.015, 0), CB(0.05, 0.03, 0.46, 0.6, 0.015, 0)],
      mass: 34, material: 'fabric', friction: 0.4, breakInto: ['fabric', 'metal_tube', 'plank', 'screws'],
    };
  },
});

// ===========================================================================
// Mobile whiteboard: porcelain board in an aluminium frame with corner caps and marker tray,
// H-frame stand with pivot knobs and locking casters.
// ===========================================================================
def('whiteboard', {
  build(b) {
    const W = 1.2, H = 0.9, yc = 1.2;
    b.box('paint_grey', W, H, 0.012, 0, yc, -0.002, { r: 0.002 });
    b.geo('whiteboard', quadGeo(W - 0.012, H - 0.012, { u0: 0, u1: 1, v0: 0, v1: 1 }), 0, yc, 0.0043, { uvOff: false });
    for (const s of [-1, 1]) {
      b.box('alu', W + 0.03, 0.022, 0.022, 0, yc + s * (H / 2 + 0.004), 0.001, { r: 0.005, grain: 'x' });
      b.box('alu', 0.022, H + 0.03, 0.022, s * (W / 2 + 0.004), yc, 0.001, { r: 0.005, grain: 'y' });
      for (const t of [-1, 1]) b.box('#8d9093:g', 0.034, 0.034, 0.026, s * (W / 2 + 0.006), yc + t * (H / 2 + 0.006), 0.001, { r: 0.008, seg: 2 });
    }
    // marker tray
    b.box('alu', 0.9, 0.008, 0.065, 0, yc - H / 2 - 0.022, 0.03, { r: 0.002 });
    b.box('alu', 0.9, 0.022, 0.006, 0, yc - H / 2 - 0.014, 0.062, { r: 0.002 });
    [['#b8291f', -0.25], ['#1f3f9a', -0.17], ['#1d1d1d', 0.05]].forEach(([c, x], i) => {
      b.cyl(c + ':g', 0.0075, 0.1, x, yc - H / 2 - 0.0105, 0.03, { rot: [0, 0.1 * i, HP], seg: 8, bevel: 0.002 });
      b.cyl('#e8e6de:g', 0.0085, 0.035, x + 0.065, yc - H / 2 - 0.0105, 0.03 + 0.007 * i, { rot: [0, 0.1 * i, HP], seg: 8, bevel: 0.002 });
    });
    b.box('#3b6fb0', 0.13, 0.025, 0.05, 0.25, yc - H / 2 - 0.006, 0.032, { r: 0.006 });
    b.box('#2b2b2d', 0.128, 0.008, 0.048, 0.25, yc - H / 2 - 0.022, 0.032, { r: 0.002 });
    // stand
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.06);
      b.box('alu', 0.035, 1.72, 0.035, x, 0.08 + 0.86, 0, { r: 0.006, grain: 'y' });
      b.cyl('#c9cbcd:m', 0.014, 0.05, x - s * 0.035, yc, 0, { axis: 'x', seg: 12 });
      b.cyl('#1b1b1d:g', 0.024, 0.022, x + s * 0.024, yc, 0, { axis: 'x', seg: 14, bevel: 0.004 });
      b.box('alu', 0.045, 0.04, 0.6, x, 0.07, 0, { r: 0.008, grain: 'z' });
      b.cyl('#1b1b1d:g', 0.02, 0.012, x, 1.806, 0, { seg: 10, bevel: 0.003 });
      for (const z of [-0.26, 0.26]) caster(b, x, z, z * 4 + s, 0.05, { r: 0.025, stem: '#c9cbcd:m' });
    }
    b.cyl('alu', 0.012, W + 0.1, 0, 0.32, 0, { axis: 'x', seg: 10 });
    b.decal('asset_tag', 0.07, 0.026, 0.5, yc - H / 2 + 0.05, -0.0085, { rot: [0, PI, 0], slot: 'atlas' });
    return {
      colliders: [CB(W + 0.04, H + 0.04, 0.03, 0, yc, 0), CB(0.035, 1.72, 0.035, -(W / 2 + 0.06), 0.94, 0), CB(0.035, 1.72, 0.035, W / 2 + 0.06, 0.94, 0), CB(0.045, 0.1, 0.62, -(W / 2 + 0.06), 0.05, 0), CB(0.045, 0.1, 0.62, W / 2 + 0.06, 0.05, 0)],
      mass: 22, material: 'metal', friction: 0.12, breakInto: ['metal_tube', 'metal_tube', 'wheel', 'screws'],
      anchors: { board: [0, yc, 0.01] },
    };
  },
});
