// Storage & clutter: filing cabinet, bookshelf, crate, pallet, cardboard boxes, toolbox, suitcase,
// binder, paper stack.
import * as THREE from 'three';
import { def, Geo, boxGeo, cylGeo, latheGeo, tubeGeo, cushionGeo, extrudeGeo, roundPath, quadGeo, CB, CC, CP, V, PI, TAU, HP, clamp, lerp, noise3, fbm3 } from './core.js';
import { matFor, tint } from './mats.js';
import { rUV, palUV, regionSize } from './atlas.js';
import { SPINE_COLS, BINDER_COLS } from './labels.js';
import { screw, glide, hinge, cabinetPull, barPull } from './parts.js';

// ===========================================================================
// 4-drawer vertical filing cabinet (sheet steel). drawer0 is an animated part.
// ===========================================================================
def('filing_cabinet', {
  variants: 4,
  mats: (o, v) => ({ body: tint('paint_beige', o.color ?? [0xc7bc9c, 0x8f9295, 0x6f7462, 0x9a9688][v]) }),
  build(b, gv) {
    const W = 0.38, H = 1.32, D = 0.66, t = 0.012;
    // case: sides, top with rolled front edge, back, recessed kick plate
    for (const s of [-1, 1]) b.box('body', t, H - 0.014, D, s * (W / 2 - t / 2), (H - 0.014) / 2, 0, { r: 0.004, grain: 'y', wear: 0.014 });
    b.box('body', W + 0.004, 0.016, D + 0.006, 0, H - 0.008, 0.002, { r: 0.006, seg: 2, wear: 0.016 });
    b.box('body', W - 0.02, H - 0.02, 0.008, 0, H / 2, -D / 2 + 0.004, { r: 0.002 });
    b.box('#161514', W - 0.024, 0.055, 0.02, 0, 0.0275 + 0.006, D / 2 - 0.045, { r: 0.002 });
    b.box('body', W - 0.024, 0.012, D - 0.03, 0, 0.006, -0.01, { r: 0.002 });
    // face frame between drawers
    const dh = 0.3, gap = 0.008, y0 = 0.065;
    b.box('#121212', W - 0.024, H - 0.07, 0.004, 0, H / 2 + 0.02, D / 2 - 0.035);
    for (let i = 0; i <= 4; i++) b.box('body', W - 0.022, i === 4 ? 0.026 : gap + 0.004, 0.02, 0, i === 4 ? H - 0.03 : y0 + i * (dh + gap) - gap / 2, D / 2 - 0.012, { r: 0.002, wear: 0.006 });
    // lock cylinder
    b.cyl('#d0d2d4:m', 0.011, 0.01, W / 2 - 0.05, H - 0.03, D / 2 + 0.003, { axis: 'z', seg: 16, bevel: 0.002 });
    b.box('#222', 0.0022, 0.011, 0.002, W / 2 - 0.05, H - 0.03, D / 2 + 0.0085);
    for (let i = 0; i < 4; i++) {
      const cy = y0 + (3 - i) * (dh + gap) + dh / 2;
      const fz = D / 2;
      const p = i === 0 ? b.part('drawer0', 0, cy, fz, { axis: 'z', maxOpen: 0.5 }) : b;
      p.box('body', W - 0.02, dh - 0.004, 0.022, 0, cy, fz - 0.007, { r: 0.006, seg: 2, wear: 0.016 });
      cabinetPull(p, '#c4c8ca:m', 0, cy - 0.02, fz + 0.004, { w: 0.14, labelDy: 0.075 });
      p.decal('fc_label', 0.078, 0.028, 0, cy + 0.055, fz + 0.0058, { slot: 'atlas', cell: (gv * 2 + i) % 6, cols: 3, rows: 2 });
      if (i === 0) {
        const bd = 0.6, bz = fz - 0.018 - bd / 2;
        for (const s of [-1, 1]) p.box('body', 0.008, dh - 0.06, bd, s * (W / 2 - 0.03), cy - 0.02, bz, { r: 0 });
        p.box('body', W - 0.06, 0.008, bd, 0, cy - dh / 2 + 0.02, bz, { r: 0 });
        p.box('body', W - 0.06, dh - 0.06, 0.008, 0, cy - 0.02, fz - 0.018 - bd, { r: 0 });
        const n = 9 + gv * 3;
        for (let k = 0; k < n; k++) {
          const z = fz - 0.06 - k * (0.5 / n);
          p.box(k % 4 === 3 ? '#88a8c4' : '#d6c18c', W - 0.09, dh - 0.09, 0.002, 0, cy - 0.03 + (k % 3) * 0.004, z, { r: 0, wear: 0 });
          p.box(['#d6c18c', '#8fb4cf', '#d6c18c', '#d89a90', '#a8c890'][k % 5], 0.06, 0.02, 0.002, -0.1 + ((k * 7) % 3) * 0.1, cy + dh / 2 - 0.065, z, { r: 0, wear: 0 });
        }
      }
    }
    // feet + dent / grime decals
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) glide(b, '#2a2927', sx * (W / 2 - 0.03), 0, sz * (D / 2 - 0.04), 0.012, 0.006);
    b.decal('asset_tag', 0.07, 0.026, W / 2 + 0.0007, 1.1, 0.2, { rot: [0, HP, 0], slot: 'atlas' });
    b.decal('sticky', 0.07, 0.07, -0.08, 1.18, D / 2 + 0.0055, { rot: [0, 0, 0.1], slot: 'atlas' });
    return {
      colliders: [CB(W, H, D, 0, H / 2, 0)],
      mass: 42, material: 'metal', friction: 0.35, breakInto: ['metal_scrap', 'metal_scrap', 'paper', 'paper', 'screws'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Bookcase: veneered carcass with a hardboard back, adjustable shelves on pins, books with cover
// boards and page blocks, binders, magazine files, leaning / stacked books.
// ===========================================================================
// book: cover boards + spine (atlas spine on +Z), page block inset (pages colour)
function bookInto(b, x, y, z, t, h, d, spineUV, cover, rot = null, pages = '#e6dcc4') {
  const g = new Geo();
  const cov = boxGeo(t, h, d, { r: 0, wear: 0 });
  // spine face (+Z) gets the atlas spine; other faces the cover colour
  const pc = palUV(cover), pp = palUV(pages);
  for (let i = 0; i < cov.count; i++) {
    const nz = cov.n[i * 3 + 2];
    if (nz > 0.7 && spineUV) {
      cov.uv[i * 2] = lerp(spineUV.u0, spineUV.u1, clamp(cov.p[i * 3] / t + 0.5, 0, 1));
      cov.uv[i * 2 + 1] = lerp(spineUV.v0, spineUV.v1, clamp(cov.p[i * 3 + 1] / h + 0.5, 0, 1));
    } else { cov.uv[i * 2] = pc[0]; cov.uv[i * 2 + 1] = pc[1]; }
  }
  g.append(cov);
  // page block: slightly inset, visible on top / back / front edge
  const pg = boxGeo(t * 0.84, h * 0.97, d * 0.985, { r: 0, wear: 0 });
  for (let i = 0; i < pg.count; i++) { pg.uv[i * 2] = pp[0]; pg.uv[i * 2 + 1] = pp[1]; }
  pg.translate(0, 0.0, -d * 0.012);
  // only keep the page block faces that poke out (top / bottom / back): scale so it pokes 1mm
  for (let i = 0; i < pg.count; i++) { if (Math.abs(pg.p[i * 3 + 1]) > h * 0.4) pg.p[i * 3 + 1] *= 1.012; if (pg.p[i * 3 + 2] < 0) pg.p[i * 3 + 2] -= 0.0012; }
  g.append(pg);
  b.put('atlas', g, x, y, z, { rot, uvOff: false });
}

def('bookshelf', {
  variants: 3,
  geoVariant: (v) => v % 2,
  mats: (o, v) => ({ wood: matFor(['walnut', 'teak', 'laminate'][v]) }),
  build(b, gv, rng) {
    const W = 0.9, H = 1.83, D = 0.31, t = 0.019;
    for (const s of [-1, 1]) b.box('wood', t, H, D, s * (W / 2 - t / 2), H / 2, 0, { r: 0.003, grain: 'y', wear: 0.014 });
    b.box('wood', W + 0.016, 0.022, D + 0.016, 0, H - 0.011, 0.006, { r: 0.004, grain: 'x', wear: 0.016 });
    b.box('wood', W - 2 * t, 0.07, t, 0, 0.035, D / 2 - 0.022, { r: 0.002, grain: 'x' });
    b.box('#3a2c22', W - 2 * t + 0.004, H - 0.024, 0.005, 0, H / 2, -D / 2 + 0.006, { r: 0, wear: 0 });
    const shelves = [0.07, 0.42, 0.77, 1.12, 1.47];
    for (const y of shelves) {
      b.box('wood', W - 2 * t - 0.002, t, D - 0.012, 0, y + t / 2, -0.002, { r: 0.0025, grain: 'x', wear: 0.012 });
      if (y > 0.1) for (const s of [-1, 1]) for (const z of [-0.08, 0.09]) b.cyl('#b8b0a0:m', 0.0028, 0.012, s * (W / 2 - t - 0.006), y - 0.003, z, { axis: 'x', seg: 6 });
    }
    const inner = W - 2 * t;
    shelves.forEach((y0, si) => {
      const y = y0 + t;
      const cap = (si < 4 ? shelves[si + 1] : H - 0.022) - y - 0.012;
      let x = -inner / 2 + 0.004;
      const end = inner / 2 - 0.004;
      const mode = (si + gv) % 5;
      if (mode === 4 && si === 2) {
        // a cardboard file box on this shelf
        b.box('cardboard', 0.3, Math.min(0.26, cap - 0.01), 0.27, -inner / 2 + 0.16, y + Math.min(0.26, cap - 0.01) / 2, -0.01, { r: 0.003 });
        b.decal('box_records', 0.2, 0.1, -inner / 2 + 0.16, y + 0.13, 0.126, { slot: 'decal' });
        x = -inner / 2 + 0.33;
      }
      while (x < end - 0.03) {
        const r = rng.next();
        if (r < 0.07 && x > -inner / 2 + 0.1) { x += 0.04 + rng.next() * 0.1; continue; }
        if (mode === 0 && r < 0.6) {
          const ci = Math.floor(rng.next() * 4), n = 2 + Math.floor(rng.next() * 4);
          for (let k = 0; k < n && x < end - 0.065; k++) {
            const bt = 0.062, bh = Math.min(0.3, cap - 0.006);
            bookInto(b, x + bt / 2, y + bh / 2, D / 2 - 0.02 - 0.135, bt, bh, 0.27, rUV('binder_spines', ci, 4, 1), BINDER_COLS[ci], null, '#f2f0e8');
            x += bt + 0.0015;
          }
          continue;
        }
        if (r > 0.93 && end - x > 0.24) {
          let yy = y;
          for (let k = 0; k < 2 + Math.floor(rng.next() * 3); k++) {
            const bt = 0.025 + rng.next() * 0.02, bw = 0.15 + rng.next() * 0.06, bd = 0.2 + rng.next() * 0.04;
            const ci = Math.floor(rng.next() * 32);
            bookInto(b, x + bw / 2 + (rng.next() - 0.5) * 0.01, yy + bt / 2, D / 2 - 0.03 - bd / 2, bt, bw, bd, rUV('spines', ci, 16, 2), SPINE_COLS[ci], [0, (rng.next() - 0.5) * 0.08, HP]);
            yy += bt;
          }
          x += 0.25;
          continue;
        }
        const bt = 0.02 + rng.next() * 0.035, bh = Math.min(cap - 0.005, 0.18 + rng.next() * 0.12), bd = 0.15 + rng.next() * 0.08;
        const ci = Math.floor(rng.next() * 32);
        // last book leans against the side panel: lean angle from the remaining gap
        const room = end - x - bt;
        const lean = x > end - 0.14 && room > 0.02 && rng.next() > 0.3 ? Math.asin(clamp(room / bh, 0, 0.45)) : 0;
        const back = 0.012 + rng.next() * 0.03;
        if (lean) {
          // pivot about the bottom-right edge: centre = pivot + R(-lean) * (-bt/2, bh/2)
          const c = Math.cos(lean), sn = Math.sin(lean);
          bookInto(b, x + bt - (bt / 2) * c + (bh / 2) * sn, y + (bh / 2) * c + (bt / 2) * sn, D / 2 - back - bd / 2, bt, bh, bd, rUV('spines', ci, 16, 2), SPINE_COLS[ci], [0, 0, -lean]);
        }
        else bookInto(b, x + bt / 2, y + bh / 2, D / 2 - back - bd / 2, bt, bh, bd, rUV('spines', ci, 16, 2), SPINE_COLS[ci]);
        x += bt + (lean ? Math.sin(lean) * bh : 0.001);
        if (lean) break;
      }
    });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) glide(b, '#2a2927', sx * (W / 2 - 0.012), 0, sz * (D / 2 - 0.03), 0.008, 0.004);
    return {
      colliders: [CB(W, H - 0.004, D, 0, (H - 0.004) / 2 + 0.004, 0), CB(W - 0.04, 0.004, D - 0.06, 0, 0.002, 0)],
      mass: 38, material: 'wood', friction: 0.4, breakInto: ['plank', 'plank', 'plank', 'screws', 'paper'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// Rough pine crate: slatted sides with gaps, corner cleats, battens, nails, stencils, straw.
// ===========================================================================
def('crate_wood', {
  variants: 4,
  geoVariant: (v) => v % 2,
  mats: (o, v) => ({ wood: matFor(v < 2 ? 'pine' : 'pine_old') }),
  build(b, gv, rng) {
    const W = 0.6, H = 0.5, D = 0.45, t = 0.018, n = 3, pH = (H - 0.04) / n;
    const slat = (w, h, d, x, y, z, grain, broken = false, wear = 0.01) => {
      const g = boxGeo(w, h, d, { r: 0.0025, grain, wear });
      g.deform((q) => { q.x += (noise3(q.x * 9, q.y * 9, q.z * 9, 5) - 0.5) * 0.002; q.z += (noise3(q.x * 7 + 3, q.y * 7, q.z * 7, 6) - 0.5) * 0.002; }, false);
      if (broken) g.deform((q) => { if (q.x > w * 0.15) { q.y -= (q.x - w * 0.15) * 0.25; q.z += (q.x - w * 0.15) * 0.15; } }, false);
      b.put('wood', g, x, y, z);
    };
    // interior: straw packing visible through gaps
    b.box('#3a2a18', W - 0.05, H - 0.05, D - 0.05, 0, H / 2, 0, { r: 0, wear: 0 });
    for (let i = 0; i < 14; i++) b.tube('#b89a5a', [[(rng.next() - 0.5) * 0.4, H - 0.05, (rng.next() - 0.5) * 0.3], [(rng.next() - 0.5) * 0.45, H - 0.03 - rng.next() * 0.03, (rng.next() - 0.5) * 0.35]], 0.0016, { radial: 3 });
    for (let i = 0; i < n; i++) {
      const y = 0.02 + pH * (i + 0.5);
      for (const s of [-1, 1]) {
        slat(W, pH - 0.016, t, 0, y, s * (D / 2 - t / 2), 'x', gv === 1 && i === 2 && s > 0);
        slat(t, pH - 0.016, D - 2 * t, s * (W / 2 - t / 2), y, 0, 'z');
      }
    }
    // lid & bottom boards
    for (let i = 0; i < 4; i++) slat(W, t, (D - 0.03) / 4 - 0.008, 0, H - t / 2, -D / 2 + 0.015 + ((i + 0.5) * (D - 0.03)) / 4, 'x');
    b.box('wood', W, t, D, 0, t / 2, 0, { r: 0.002, grain: 'x', wear: 0 });
    // corner cleats (outside), diagonal braces
    for (const s of [-1, 1]) {
      for (const k of [-1, 1]) slat(0.07, H, 0.022, k * (W / 2 - 0.035), H / 2, s * (D / 2 + 0.011), 'y', false, 0);
      for (const k of [-1, 1]) slat(0.022, H, 0.07, s * (W / 2 + 0.011), H / 2, k * (D / 2 - 0.035), 'y', false, 0);
      const L = Math.hypot(W - 0.14, H - 0.06), a = Math.atan2(H - 0.06, W - 0.14);
      const g = boxGeo(L, 0.06, 0.02, { r: 0.0025, grain: 'x', wear: 0 });
      b.put('wood', g, 0, H / 2, s * (D / 2 + 0.031), { rot: [0, 0, s * a] });
    }
    // nails
    for (const s of [-1, 1]) for (const k of [-1, 1]) for (const yy of [0.04, H / 2, H - 0.04]) {
      b.cyl('#2b2722:m', 0.0042, 0.0016, k * (W / 2 - 0.035), yy, s * (D / 2 + 0.0228), { axis: 'z', seg: 7 });
      b.cyl('#2b2722:m', 0.0042, 0.0016, s * (W / 2 + 0.0228), yy, k * (D / 2 - 0.035), { axis: 'x', seg: 7 });
    }
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.cyl('#2b2722:m', 0.0042, 0.0016, s * (W / 2 - 0.035), H + 0.0005, -D / 2 + 0.015 + ((i + 0.5) * (D - 0.03)) / 4, { seg: 7 });
    b.decal('crate_stencil', 0.42, 0.21, 0, H * 0.55, D / 2 + 0.0185, {});
    b.decal('crate_stencil', 0.3, 0.15, W / 2 + 0.0185, H * 0.62, 0, { rot: [0, HP, 0] });
    if (gv === 1) b.decal('waterstain', 0.3, 0.3, 0.1, H + 0.0012, 0, { rot: [-HP, 0, 0] });
    return {
      colliders: [CB(W + 0.044, H, D + 0.044, 0, H / 2, 0)],
      mass: 14, material: 'wood', breakInto: ['plank', 'plank', 'plank', 'nails'],
      anchors: { top: [0, H, 0] },
    };
  },
});

// ===========================================================================
// EUR pallet: deck boards, stringer boards, 9 blocks with EPAL-style stamps, nail heads,
// weathered pine; geometry 1 has a cracked / missing deck board.
// ===========================================================================
def('pallet', {
  variants: 4,
  geoVariant: (v) => v % 2,
  mats: (o, v) => ({ wood: matFor(v < 2 ? 'pine_old' : 'pine') }),
  build(b, gv, rng) {
    const W = 1.2, D = 0.8, t = 0.022;
    const board = (w, h, d, x, y, z, grain, o = {}) => {
      const g = boxGeo(w, h, d, { r: 0.0022, grain, wear: 0.012 });
      g.deform((q) => { q.y += (noise3(q.x * 4, 0, q.z * 4, o.seed ?? 3) - 0.5) * 0.003; }, false);
      b.put('wood', g, x, y, z, { rot: o.rot });
    };
    const tops = [[-0.3275, 0.145], [-0.16375, 0.1], [0, 0.145], [0.16375, 0.1], [0.3275, 0.145]];
    tops.forEach(([z, w], i) => {
      if (gv === 1 && i === 1) return;
      board(W - rng.next() * 0.006, t, w - 0.004, (rng.next() - 0.5) * 0.006, 0.144 - t / 2, z, 'x', { seed: i, rot: [0, (rng.next() - 0.5) * 0.008, 0] });
    });
    if (gv === 1) board(W * 0.55, t, 0.096, -W * 0.22, 0.144 - t / 2 + 0.008, -0.16, 'x', { rot: [0.05, 0.05, 0.04] });
    for (const x of [-0.5275, 0, 0.5275]) board(0.145, t, D, x, 0.1 + t / 2, 0, 'z', { seed: 7 });
    for (const x of [-0.5275, 0, 0.5275]) for (const [z, d] of [[-0.35, 0.1], [0, 0.145], [0.35, 0.1]]) b.box('wood', 0.145, 0.078, d, x, 0.022 + 0.039, z, { r: 0.003, grain: 'y', wear: 0.012 });
    for (const [z, d] of [[-0.35, 0.1], [0, 0.145], [0.35, 0.1]]) board(W, t, d, 0, t / 2, z, 'x', { seed: 9 });
    for (const x of [-0.5275, 0.5275]) b.decal('pallet_stamp', 0.12, 0.06, x, 0.061, D / 2 + 0.0008, {});
    b.decal('pallet_stamp', 0.12, 0.06, 0, 0.061, 0.0725 + 0.0008, {});
    for (const x of [-0.5275, 0, 0.5275]) for (const z of [-0.3275, 0, 0.3275]) for (const dx of [-0.04, 0.04]) b.cyl('#3a352e:m', 0.0045, 0.0014, x + dx, 0.1447, z, { seg: 7 });
    return {
      colliders: [CB(W, 0.044, D, 0, 0.122, 0), ...[[-0.35, 0.1], [0, 0.145], [0.35, 0.1]].map(([z, d]) => CB(W, 0.1, d, 0, 0.05, z))],
      mass: 22, material: 'wood', breakInto: ['plank', 'plank', 'plank', 'plank', 'nails'],
      anchors: { top: [0, 0.144, 0] },
    };
  },
});

// ===========================================================================
// Corrugated cardboard boxes (RSC): bulging panels, taped flaps, crushed corners, prints, labels.
// ===========================================================================
const BOX_LOOKS = [
  [['box_files', 'F', 0.75], ['box_files', 'R', 0.55]],
  [['box_donotopen', 'F', 0.7], ['box_donotopen', 'T', 0.5]],
  [['box_roomcorp', 'F', 0.7], ['box_arrows', 'R', 0.38], ['box_label', 'TL', 0.42]],
  [['box_fragile', 'F', 0.72], ['box_roomcorp', 'R', 0.6], ['box_arrows', 'L', 0.38]],
  [['box_misc', 'F', 0.72], ['box_label', 'R', 0.45]],
  [['box_records', 'F', 0.66], ['box_roomcorp', 'B', 0.6]],
];
function cardboardBox(b, v, w, h, d, big, rng) {
  const cu = cushionGeo(w, h, d, { r: 0.004, cell: big ? 0.06 : 0.05, crown: 0.004, topOnly: true, flatBottom: true, bulge: 0.004, wrinkle: 0.0009, wrinkleFreq: 10, seed: 80 + v });
  // crushed corner + dented edge
  const cc = [(v & 1 ? 1 : -1) * w / 2, h / 2, (v & 2 ? 1 : -1) * d / 2];
  cu.geo.deform((q) => {
    const dd = Math.hypot(q.x - cc[0], q.y - cc[1], q.z - cc[2]);
    if (dd < 0.08) { const k = (1 - dd / 0.08) ** 2 * 0.018; q.x -= Math.sign(cc[0]) * k * 0.6; q.y -= k; q.z -= Math.sign(cc[2]) * k * 0.6; }
  });
  b.put('cardboard', cu.geo, 0, h / 2, 0);
  // flap seam (dark gap) under the tape, and the tape itself (decal strips)
  b.box('#3a2a18', w - 0.01, 0.001, 0.003, 0, h + 0.0035, 0, { r: 0, wear: 0 });
  const tw = Math.min(0.05, d * 0.2), drop = Math.min(0.09, h * 0.38);
  b.decal('tape', w + 0.004, tw, 0, h + 0.0045, 0, { rot: [-HP, 0, 0] });
  for (const s of [-1, 1]) b.decal('tape', drop, tw, s * (w / 2 + 0.0058), h - drop / 2 + 0.002, 0, { rot: [0, s * HP, HP] });
  const looks = BOX_LOOKS[v % BOX_LOOKS.length];
  const off = 0.0058;
  for (const [reg, face, frac] of looks) {
    const [rw, rh] = regionSize(reg);
    const asp = rh / rw;
    if (face === 'F' || face === 'B') {
      let dw = w * frac, dh = dw * asp;
      if (dh > (h - 0.02) * 0.8) { dh = (h - 0.02) * 0.8; dw = dh / asp; }
      b.decal(reg, dw, dh, 0, h * 0.48, (face === 'F' ? 1 : -1) * (d / 2 + off), { rot: [0, face === 'F' ? 0 : PI, 0] });
    } else if (face === 'R' || face === 'L') {
      let dw = d * frac, dh = dw * asp;
      if (dh > (h - drop - 0.02) * 0.9) { dh = (h - drop - 0.02) * 0.9; dw = dh / asp; }
      b.decal(reg, dw, dh, (face === 'R' ? 1 : -1) * (w / 2 + off), (h - drop) * 0.48, 0, { rot: [0, face === 'R' ? HP : -HP, 0] });
    } else {
      const dw = Math.min(w * frac, w / 2 - tw), dh = Math.min(dw * asp, d / 2 - tw / 2 - 0.01);
      b.decal(reg, dh / asp, dh, face === 'T' ? -w / 4 : w / 4, h + 0.0052, face === 'T' ? d / 4 : -d / 4, { rot: [-HP, 0, face === 'T' ? 0.05 : -0.08], slot: reg === 'box_label' ? 'atlas' : 'decal' });
    }
  }
  if (big) for (const s of [-1, 1]) b.decal('box_handhole', 0.11, 0.04, s * (w / 2 + off * 0.9), h - 0.1, 0, { rot: [0, s * HP, 0] });
}
for (const [key, w, h, d, mass, big] of [['box_small', 0.3, 0.22, 0.24, 1.6, false], ['box_medium', 0.46, 0.32, 0.34, 3.5, false], ['box_large', 0.6, 0.44, 0.45, 6, true]]) {
  def(key, {
    variants: 6,
    geoVariant: (v) => v,
    build(b, v, rng) {
      cardboardBox(b, v, w, h, d, big, rng);
      return { colliders: [CB(w, h, d, 0, h / 2, 0)], mass, material: 'cardboard', breakInto: v === 0 || v === 5 ? ['cardboard', 'paper', 'paper'] : ['cardboard', 'tape'], anchors: { top: [0, h, 0] } };
    },
  });
}

// ===========================================================================
// Hip-roof steel toolbox: rolled edges, piano hinge, twin latches, handle with grip, sticker.
// ===========================================================================
def('toolbox', {
  variants: 3,
  mats: (o, v) => ({ body: tint('paint_red', o.color ?? [0xa3261e, 0x2f4f7a, 0x3c3e41][v]) }),
  build(b) {
    const W = 0.5, D = 0.22;
    b.box('body', W, 0.15, D, 0, 0.076, 0, { r: 0.008, seg: 2, wear: 0.014 });
    b.box('body', W + 0.006, 0.012, D + 0.006, 0, 0.152, 0, { r: 0.005, wear: 0.01 });
    const sh = new THREE.Shape([new THREE.Vector2(-0.113, 0), new THREE.Vector2(0.113, 0), new THREE.Vector2(0.065, 0.068), new THREE.Vector2(-0.065, 0.068)]);
    b.ext('body', sh, W, 0, 0.158, 0, { rot: [0, HP, 0], bevel: 0.004, bevelSeg: 2, curveSeg: 2 });
    for (const s of [-1, 1]) b.box('#c8ccce:m', 0.032, 0.022, 0.022, s * 0.12, 0.237, 0, { r: 0.004 });
    b.tube('#c8ccce:m', roundPath([[-0.12, 0.24, 0], [-0.105, 0.278, 0], [0.105, 0.278, 0], [0.12, 0.24, 0]], 0.03, 5), 0.0055, { radial: 8 });
    b.cyl('#1e1e1e', 0.0125, 0.15, 0, 0.278, 0, { axis: 'x', seg: 14, bevel: 0.003 });
    for (const s of [-1, 1]) {
      // latch: base plate, bail, catch
      b.box('#c8ccce:m', 0.042, 0.032, 0.008, s * 0.17, 0.152, D / 2 + 0.006, { r: 0.002 });
      b.tube('#c8ccce:m', [[s * 0.17 - 0.014, 0.142, D / 2 + 0.011], [s * 0.17 - 0.014, 0.17, D / 2 + 0.013], [s * 0.17 + 0.014, 0.17, D / 2 + 0.013], [s * 0.17 + 0.014, 0.142, D / 2 + 0.011]], 0.0022, { radial: 5 });
      screw(b, '#9a9c9e', [s * 0.185, 0.143, D / 2 + 0.01], [0, 0, 1], 0.0022, 'rivet');
      screw(b, '#9a9c9e', [s * 0.155, 0.143, D / 2 + 0.01], [0, 0, 1], 0.0022, 'rivet');
    }
    // padlock hasp + piano hinge along the back
    b.box('#c8ccce:m', 0.03, 0.03, 0.006, 0, 0.155, D / 2 + 0.005, { r: 0.002 });
    b.cyl('#c8ccce:m', 0.0048, W - 0.04, 0, 0.158, -D / 2 - 0.003, { axis: 'x', seg: 8 });
    for (let i = 0; i < 12; i++) b.box('#2a2a2a', 0.002, 0.0098, 0.0012, -W / 2 + 0.04 + i * (W - 0.08) / 11, 0.158, -D / 2 - 0.0079, { r: 0, wear: 0 });
    b.decal('toolbox_sticker', 0.14, 0.056, 0.06, 0.075, D / 2 + 0.0008, { rot: [0, 0, 0.04] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('#1c1c1c', 0.03, 0.004, 0.03, sx * 0.21, 0.002, sz * 0.08, { r: 0.0015 });
    return { colliders: [CB(W, 0.23, D, 0, 0.115, 0), CB(0.26, 0.05, 0.03, 0, 0.255, 0)], mass: 5.5, material: 'metal', breakInto: ['metal_scrap', 'metal_scrap', 'screws', 'nails'], anchors: { handle: [0, 0.278, 0] } };
  },
});

// ===========================================================================
// 1990s hard-shell suitcase: two moulded shells with ribs, aluminium valance & gasket, moulded
// handle, chrome latches with keyholes, feet, luggage tag on a strap.
// ===========================================================================
def('suitcase', {
  variants: 4,
  mats: (o, v) => ({ shell: tint('plastic_blue', o.color ?? [0x27324d, 0x5a2228, 0x6b6a66, 0x4f5338][v]) }),
  build(b) {
    const W = 0.46, H = 0.66, D = 0.22, F = 0.014; // F: feet height
    for (const s of [-1, 1]) {
      const sh = cushionGeo(W, H, 0.1, { r: 0.04, cell: 0.09, crown: 0, bulge: 0, wrinkle: 0 });
      // rotate so the thin axis is Z: cushion is w x h x d already (d = 0.1)
      sh.geo.deform((q) => { q.z += s * Math.max(0, s * q.z) * 0.0 + s * 0.006 * (1 - (q.x / (W / 2)) ** 2) * (1 - (q.y / (H / 2)) ** 2) * (s * q.z > 0 ? 1 : 0); });
      b.put('shell', sh.geo, 0, F + H / 2, s * 0.058);
      for (const x of [-0.13, 0, 0.13]) b.box('shell', 0.046, H - 0.12, 0.012, x, F + H / 2, s * 0.112, { r: 0.006, seg: 2, grain: 'y' });
    }
    // valance + gasket line
    b.box('#a8acb0:m', W + 0.006, H + 0.006, 0.022, 0, F + H / 2, 0, { r: 0.04, seg: 2, wear: 0 });
    b.box('#161616', W + 0.008, H + 0.008, 0.004, 0, F + H / 2, 0, { r: 0.04, wear: 0 });
    // handle (moulded) with grip + mounts
    b.tube('#1c1c1e', roundPath([[-0.08, F + H + 0.006, 0], [-0.07, F + H + 0.045, 0], [0.07, F + H + 0.045, 0], [0.08, F + H + 0.006, 0]], 0.025, 5), [0.011, 0.016], { radial: 10, caps: true });
    for (const s of [-1, 1]) b.box('#1c1c1e', 0.034, 0.016, 0.036, s * 0.08, F + H + 0.006, 0, { r: 0.006, seg: 2 });
    // latches with keyholes
    for (const s of [-1, 1]) {
      b.box('#d0d4d6:m', 0.05, 0.016, 0.034, s * 0.16, F + H + 0.004, 0, { r: 0.004, seg: 2 });
      b.cyl('#1a1a1a', 0.002, 0.002, s * 0.16, F + H + 0.0125, 0.006, { seg: 6 });
      for (const z of [-0.07, 0.07]) b.box('#1c1c1e', 0.05, F + 0.004, 0.03, s * 0.17, (F + 0.004) / 2, z, { r: 0.004 });
    }
    // luggage tag on a strap
    b.tube('#2a2420', [[0.06, F + H + 0.03, 0.012], [0.072, F + H - 0.01, 0.03], [0.078, F + H - 0.045, 0.034]], 0.0018, { radial: 4 });
    b.decal('lug_tag', 0.045, 0.08, 0.082, F + H - 0.083, D / 2 + 0.014, { rot: [0, 0, 0.1], slot: 'atlas' });
    b.decal('box_roomcorp', 0.16, 0.1, -0.08, F + 0.2, D / 2 + 0.015, { rot: [0, 0, 0.2] });
    return { colliders: [CB(W, H + F, D + 0.02, 0, (H + F) / 2, 0), CB(0.17, 0.05, 0.035, 0, F + H + 0.025, 0)], mass: 4.5, material: 'plastic', breakInto: ['plastic_scrap', 'fabric', 'metal_scrap'], anchors: { handle: [0, F + H + 0.045, 0] } };
  },
});

// ===========================================================================
// 3-ring binder: vinyl-covered boards with a rounded spine, spine pocket label, page block,
// visible ring mechanism.
// ===========================================================================
def('binder', {
  variants: 4,
  geoVariant: (v) => v,
  ao: false,
  build(b, v) {
    const T = 0.065, H = 0.3, D = 0.28, col = BINDER_COLS[v];
    for (const s of [-1, 1]) b.box(col + ':g', 0.0045, H, D, s * (T / 2 - 0.00225), H / 2, 0, { r: 0.0015, wear: 0 });
    // rounded spine with the label pocket
    b.box(col + ':g', T, H, 0.006, 0, H / 2, D / 2 - 0.003, { r: 0.003, wear: 0 });
    b.decal('binder_spines', T - 0.012, H - 0.02, 0, H / 2, D / 2 + 0.0008, { cell: v, cols: 4, rows: 1, slot: 'atlas_gloss' });
    // page block + rings
    b.box('#f0eee6', T - 0.014, H - 0.016, D - 0.02, 0, H / 2, -0.004, { r: 0.001, wear: 0 });
    for (const y of [0.07, 0.15, 0.23]) b.tube('#c8ccce:m', Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * PI; return [Math.cos(a) * 0.016, y, D / 2 - 0.035 - Math.sin(a) * 0.016]; }), 0.0018, { radial: 5 });
    b.box('#c8ccce:m', 0.012, H - 0.06, 0.004, 0, H / 2, D / 2 - 0.012, { r: 0.001 });
    return { colliders: [CB(T, H, D, 0, H / 2, 0)], mass: 0.9, material: 'paper', breakInto: ['paper', 'paper', 'plastic_scrap'] };
  },
});

// ===========================================================================
// Paper stack: offset bundles of sheets, a printed memo on top, binder clip, coffee ring.
// ===========================================================================
def('paper_stack', {
  ao: false,
  variants: 2,
  geoVariant: (v) => v,
  build(b, v, rng) {
    const W = 0.216, D = 0.279;
    let y = 0;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = 0.007 + rng.next() * 0.003;
      const g = boxGeo(W, t, D, { r: 0.0008, wear: 0.004 });
      // slightly fanned / wavy sheets
      g.deform((q) => { q.y += Math.sin(q.x * 25 + i) * 0.0006 * (q.y > 0 ? 1 : 0.5); }, false);
      b.put('paper', g, (rng.next() - 0.5) * 0.008, y + t / 2, (rng.next() - 0.5) * 0.008, { rot: [0, (rng.next() - 0.5) * 0.06, 0] });
      y += t;
    }
    // stripes of page edges on the sides (sheet lines)
    const ry = (rng.next() - 0.5) * 0.08;
    b.decal(v ? 'memo' : 'memo2', W - 0.004, D - 0.004, 0, y + 0.0009, 0, { rot: [-HP, 0, ry], slot: 'atlas' });
    if (v) b.decal('stain', 0.09, 0.09, 0.05, y + 0.0014, 0.07, { rot: [-HP, 0, 0] });
    // binder clip on the corner
    const cx = -W / 2 + 0.03, cz = -D / 2 + 0.006;
    b.box('plastic_black', 0.032, 0.004, 0.024, cx, y + 0.003, cz, { r: 0.001, rot: [0.15, ry, 0] });
    b.box('plastic_black', 0.032, 0.004, 0.024, cx, 0.002, cz, { r: 0.001, rot: [0, ry, 0] });
    b.box('plastic_black', 0.032, y + 0.004, 0.003, cx, y / 2 + 0.002, cz - 0.012, { r: 0.001, rot: [0, ry, 0] });
    for (const s of [-1, 1]) b.tube('#c8ccce:m', roundPath([[cx + s * 0.012, y + 0.005, cz + 0.004], [cx + s * 0.012, y + 0.018, cz - 0.014], [cx + s * 0.008, y + 0.012, cz - 0.032]], 0.006, 3), 0.0011, { radial: 4 });
    return { colliders: [CB(W + 0.008, y, D + 0.008, 0, y / 2, 0)], mass: 1.4, material: 'paper', breakInto: ['paper', 'paper', 'paper'] };
  },
});
