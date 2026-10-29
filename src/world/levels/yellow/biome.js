// Level 0 biodiversity & environmental storytelling, per chunk (deterministic from the seed).
//  decorateBiome(level, rec)  every peer, static: black mould stains and mushroom tufts (glowcaps too) in damp
//                             cells, blood / oil drag trails, clones torn apart (missing limbs, oil, wires),
//                             the cold fire ring of an abandoned camp
//  populateBiome(level, rec)  host, once: collectible fungus in damp cells; ABANDONED CAMPS (collapsed tent,
//                             sleeping bag, supply crate, camp stove, a broken trolley, loose wheels, boards,
//                             scrap, tools, batteries, a scribbled note, sometimes a case file); lone R.O.O.M.
//                             supply crates, scrap piles and notes
import * as THREE from 'three';
import { CELL, CHUNK } from './layout.js';
import { RNG, hash3, hash01 } from '../../../core/rng.js';
import { EnvGeo } from '../../env/builder.js';
import { bakeInto, sp } from './roomkit.js';
import { Placer } from './placement.js';
import { Avatar } from '../../../entities/avatar.js';
import { ITEM } from '../../../game/itemdefs.js';

const TILE = { blood: 0, oil: 1, mold: 2, smear: 3, ash: 4, prints: 5, stain: 6, scuff: 7 };
const NT = 8; // tiles in the decal atlas
const cellOf = (rec, li, lj) => rec.layout.cells[lj * CHUNK + li];
const x0Of = (rec, li) => (rec.cx * CHUNK + li) * CELL;
const z0Of = (rec, lj) => (rec.cz * CHUNK + lj) * CELL;
const isDamp = (c) => c.wet > 0 || c.zone === 'flooded' || c.zone === 'maintenance';
const open = (c) => c && !c.special && !c.reserved && !c.landmark && !c.pit && !c.crawl && !c.narrow;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

// ----------------------------------------------------------------------------- materials
let _decalMat = null, _tuftMat = null, _glowMat = null;
function decalMat() {
  if (_decalMat) return _decalMat;
  const W = 1024, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const blob = (cx, cy, r, col, n, spread) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() ** 1.6 * spread;
      const rr = r * (0.25 + Math.random() * 0.75) * (1 - d / (spread * 1.4));
      c.fillStyle = col;
      c.beginPath(); c.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, rr * (0.6 + Math.random() * 0.4), a, 0, Math.PI * 2); c.fill();
    }
  };
  // 0 blood splat, 1 oil pool, 2 black mould, 3 drag smear, 4 ash
  blob(64, 64, 26, 'rgba(70,6,4,0.85)', 30, 34); blob(64, 64, 7, 'rgba(40,2,2,0.9)', 18, 52);
  blob(192, 64, 34, 'rgba(8,8,10,0.92)', 20, 22); blob(192, 64, 6, 'rgba(20,18,26,0.9)', 14, 50);
  for (let i = 0; i < 80; i++) blob(320, 64, 9, `rgba(${10 + Math.random() * 20},${16 + Math.random() * 20},${8 + Math.random() * 10},0.55)`, 1, 50);
  const g = c.createLinearGradient(384, 0, 512, 0);
  g.addColorStop(0, 'rgba(60,5,4,0)'); g.addColorStop(0.2, 'rgba(60,5,4,0.7)'); g.addColorStop(0.8, 'rgba(50,4,3,0.75)'); g.addColorStop(1, 'rgba(60,5,4,0)');
  c.fillStyle = g;
  for (let k = 0; k < 7; k++) { c.globalAlpha = 0.5 + Math.random() * 0.5; c.fillRect(384, 30 + k * 9 + Math.random() * 4, 128, 3 + Math.random() * 5); }
  c.globalAlpha = 1;
  blob(576, 64, 30, 'rgba(30,28,26,0.85)', 24, 30); blob(576, 64, 10, 'rgba(70,66,60,0.7)', 20, 40);
  // 5 a pair of dirty shoe prints (sole + heel, tread bars), one stride apart
  for (const [px, py, flip] of [[640 + 44, 34, -1], [640 + 84, 92, 1]]) {
    c.save(); c.translate(px, py); c.rotate(flip * 0.06);
    c.fillStyle = 'rgba(46,34,20,0.55)';
    c.beginPath(); c.ellipse(0, -8, 13, 20, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(0, 22, 10, 10, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(20,14,8,0.35)';
    for (let k = -22; k < 10; k += 5) c.fillRect(-11, k, 22, 2);
    c.restore();
  }
  // 6 tide-marked stain: pale centre, darker dried rim
  for (let k = 0; k < 7; k++) {
    const a = Math.random() * 6.28, d = Math.random() * 14, r = 26 + Math.random() * 16;
    c.fillStyle = 'rgba(88,64,30,0.13)'; c.beginPath(); c.ellipse(832 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, r * 0.8, a, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(70,48,20,0.32)'; c.lineWidth = 2 + Math.random() * 2; c.stroke();
  }
  // 7 black heel scuffs
  c.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const x = 910 + Math.random() * 100, y = 20 + Math.random() * 88, l = 10 + Math.random() * 26, a = Math.random() * 0.8 - 0.4;
    c.strokeStyle = `rgba(18,16,14,${0.35 + Math.random() * 0.35})`; c.lineWidth = 1.5 + Math.random() * 3;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l * 0.5, y + 4 * Math.sin(a * 5), x + l * Math.cos(a), y + l * Math.sin(a)); c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _decalMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: 0.22, metalness: 0, vertexColors: true });
  _decalMat.name = 'biome_decals';
  return _decalMat;
}
function tuftMat() { return _tuftMat || (_tuftMat = Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), { name: 'biome_tufts' })); }
function glowMat() { return _glowMat || (_glowMat = Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x0a1a16, emissive: 0x5affd0, emissiveIntensity: 1.1, roughness: 0.5, side: THREE.DoubleSide }), { name: 'biome_glowcaps' })); }

// ----------------------------------------------------------------------------- geometry helpers
function tri(g, a, b, c) {
  _n.subVectors(b, a).cross(_c.subVectors(c, a)).normalize();
  g.autoCell((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, _n.x, _n.z);
  const i = g.v(a.x, a.y, a.z, _n.x, _n.y, _n.z, 0, 0), j = g.v(b.x, b.y, b.z, _n.x, _n.y, _n.z, 0, 0), k = g.v(c.x, c.y, c.z, _n.x, _n.y, _n.z, 0, 0);
  g.tri(i, j, k);
}
// faceted mushroom: hex stem + low dome cap
function shroom(g, gCap, x, z, h, r, capCol, stemCol, rng, lean = 0) {
  const tx = x + Math.sin(lean) * h * 0.3, tz = z + Math.cos(lean) * h * 0.3 * (rng.next() - 0.5);
  const n = 5, sr = r * 0.22;
  g.setRGB(...stemCol);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const p0 = _a.set(x + Math.cos(a0) * sr, 0, z + Math.sin(a0) * sr).clone(), p1 = _a.set(x + Math.cos(a1) * sr, 0, z + Math.sin(a1) * sr).clone();
    const q0 = _a.set(tx + Math.cos(a0) * sr * 0.8, h, tz + Math.sin(a0) * sr * 0.8).clone(), q1 = _a.set(tx + Math.cos(a1) * sr * 0.8, h, tz + Math.sin(a1) * sr * 0.8).clone();
    tri(g, p0, q1, p1); tri(g, p0, q0, q1);
  }
  const cg = gCap || g;
  cg.setRGB(...capCol);
  const m = 7, top = new THREE.Vector3(tx, h + r * 0.45, tz);
  for (let k = 0; k < m; k++) {
    const a0 = (k / m) * Math.PI * 2, a1 = ((k + 1) / m) * Math.PI * 2;
    const j0 = 1 + (rng.next() - 0.5) * 0.25, j1 = 1 + (rng.next() - 0.5) * 0.25;
    const e0 = new THREE.Vector3(tx + Math.cos(a0) * r * j0, h - r * 0.15, tz + Math.sin(a0) * r * j0);
    const e1 = new THREE.Vector3(tx + Math.cos(a1) * r * j1, h - r * 0.15, tz + Math.sin(a1) * r * j1);
    const m0 = e0.clone().lerp(top, 0.45).setY(h + r * 0.3), m1 = e1.clone().lerp(top, 0.45).setY(h + r * 0.3);
    tri(cg, e0, m1, e1); tri(cg, e0, m0, m1); tri(cg, m0, top, m1);
    tri(cg, e0, e1, _b.set(tx, h - r * 0.05, tz).clone()); // gills underneath
  }
}
function decal(g, x, z, w, d, rot, tile, y = 0.006, col = [1, 1, 1]) {
  g.setRGB(...col);
  g.autoCell(x, z);
  const c = Math.cos(rot), s = Math.sin(rot), u0 = tile / NT, u1 = (tile + 1) / NT;
  const P = [[-w, -d, u0, 0], [w, -d, u1, 0], [w, d, u1, 1], [-w, d, u0, 1]].map(([px, pz, u, v]) => g.v(x + px * c - pz * s, y, z + px * s + pz * c, 0, 1, 0, u, v));
  g.quad(P[0], P[3], P[2], P[1]);
}
// everyday grime: tide-marked stains on the carpet, heel scuffs at the doorways, tracks of dirty shoe prints
// down the long corridors -- and across the empty halls, stopping dead in the middle
function grime(level, rec, gD) {
  const seed = level.seed, N = CHUNK, L = rec.layout;
  for (const c of L.cells) {
    if (!open(c) || c.water) continue;
    const x0 = x0Of(rec, c.li), z0 = z0Of(rec, c.lj), h = (k) => hash01(c.i, c.j, 6300 + k, seed);
    if (h(0) < (c.zone === 'dark' || c.zone === 'flooded' ? 0.3 : 0.14)) {
      const tint = c.floor === 'concrete' ? [0.5, 0.5, 0.5] : [1, 1, 1];
      decal(gD, x0 + 0.5 + h(1) * 2, z0 + 0.5 + h(2) * 2, 0.25 + h(3) * 0.4, 0.22 + h(4) * 0.35, h(5) * 6.28, TILE.stain, 0.0045, tint);
    }
    // scuffs both sides of a doorway on this cell's N / W edge
    for (const [t, ax] of [[L.edgesN[c.lj * N + c.li], 'x'], [L.edgesW[c.lj * N + c.li], 'z']]) {
      if ((t !== 2 && t !== 3) || h(ax === 'x' ? 6 : 7) > 0.45) continue;
      for (const sd of [-1, 1]) {
        const off = 0.35 * sd, jit = (h(8) - 0.5) * 0.4;
        if (ax === 'x') decal(gD, x0 + CELL / 2 + jit, z0 + off, 0.3, 0.18, h(9) * 0.6, TILE.scuff, 0.0047);
        else decal(gD, x0 + off, z0 + CELL / 2 + jit, 0.3, 0.18, Math.PI / 2 + h(9) * 0.6, TILE.scuff, 0.0047);
      }
    }
    // shoe-print tracks along a corridor (per segment, so a track runs on for a while)
    const sp = c.spine;
    if (sp && !(c.spineX && c.spineZ) && hash01(sp.seg, sp.line, 6310, seed) < 0.45) {
      const lat = (hash01(sp.seg, sp.line, 6311, seed) - 0.5) * 1.0, dir = hash01(sp.seg, 0, 6312, seed) < 0.5 ? 0 : Math.PI;
      for (let k = 0; k < 4; k++) {
        const u = (k + 0.5) * (CELL / 4), w = Math.sin((c.i + c.j) * 1.7 + k) * 0.06;
        if (sp.ax === 0) decal(gD, x0 + u, z0 + CELL / 2 + lat + w, 0.15, 0.18, -Math.PI / 2 + dir + w, TILE.prints, 0.005, [0.9, 0.9, 0.9]);
        else decal(gD, x0 + CELL / 2 + lat + w, z0 + u, 0.15, 0.18, dir + w, TILE.prints, 0.005, [0.9, 0.9, 0.9]);
      }
    } else if (c.hall && h(10) < 0.09) {
      // a few steps into the hall that stop in the middle of the floor
      const a = h(11) * 6.28, dx = Math.cos(a), dz = Math.sin(a);
      for (let k = 0; k < 3; k++) decal(gD, x0 + CELL / 2 - dx * k * 0.75, z0 + CELL / 2 - dz * k * 0.75, 0.15, 0.18, Math.atan2(dz, dx) - Math.PI / 2, TILE.prints, 0.005, [0.9, 0.9, 0.9]);
    }
  }
}

// fieldstone: jittered icosphere (watertight: the jitter hashes the unit direction), sooted on the side
// facing `soot` (the fire), lichen-dark low down
const _ico = (() => { const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, out = []; for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i)); g.dispose(); return out; })();
function rock(g, cx, cy, cz, sx, sy, sz, rotY, col, rng, soot = null) {
  const c = Math.cos(rotY), s = Math.sin(rotY), seed = rng.next() * 100;
  const P = _ico.map((d) => {
    const j = 0.82 + 0.36 * hash01(Math.round(d.x * 97 + seed), Math.round(d.y * 89), Math.round(d.z * 83));
    const lx = d.x * sx * j, ly = d.y * sy * j * (d.y < 0 ? 0.55 : 1), lz = d.z * sz * j;
    return new THREE.Vector3(cx + lx * c - lz * s, Math.max(0.002, cy + ly), cz + lx * s + lz * c);
  });
  for (let i = 0; i < P.length; i += 3) {
    const mx = (P[i].x + P[i + 1].x + P[i + 2].x) / 3, my = (P[i].y + P[i + 1].y + P[i + 2].y) / 3, mz = (P[i].z + P[i + 1].z + P[i + 2].z) / 3;
    let k = 0.86 + 0.28 * hash01(Math.round(mx * 300), Math.round(my * 300), Math.round(mz * 300));
    if (soot) { const dx = soot.x - mx, dz = soot.z - mz, l = Math.hypot(dx, dz) || 1, nx = mx - cx, nz = mz - cz, nl = Math.hypot(nx, nz) || 1; k *= 1 - 0.55 * Math.max(0, (nx * dx + nz * dz) / (nl * l)); }
    if (my < cy) k *= 0.8;
    g.setRGB(col[0] * k, col[1] * k, col[2] * k);
    tri(g, P[i], P[i + 1], P[i + 2]);
  }
}
// jittered N-sided prism along local X (logs, limbs, wires). shade(rng) -> [r, g, b] per facet; ends:
// [cap0, cap1] colours (null = open); taper: end radius scale at x = +len/2 (rounded limb end)
function prism(g, cx, cy, cz, len, r, rotY, rng, o) {
  const c = Math.cos(rotY), s = Math.sin(rotY), N = o.N ?? 7, seg = o.seg ?? 4, ring = [];
  for (let j = 0; j <= seg; j++) {
    const t = j / seg, x = -len / 2 + len * t, end = j === 0 || j === seg;
    const rr = r * (end ? (j === seg && o.taper ? o.taper : 0.85) : 1 - (o.jit ?? 0.08) + rng.next() * (o.jit ?? 0.08) * 2) * (o.taper && t > 0.6 ? 1 - (t - 0.6) * 0.6 : 1);
    const row = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, y = Math.sin(a) * rr, z = Math.cos(a) * rr; row.push(new THREE.Vector3(cx + x * c - z * s, Math.max(0.002, cy + y), cz + x * s + z * c)); }
    ring.push(row);
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < N; i++) {
    const A = ring[j][i], B = ring[j][(i + 1) % N], C = ring[j + 1][(i + 1) % N], D = ring[j + 1][i];
    g.setRGB(...o.shade(rng)); tri(g, A, B, C); tri(g, A, C, D);
  }
  [[ring[0], true, o.caps?.[0]], [ring[seg], false, o.caps?.[1]]].forEach(([row, flip, col]) => {
    if (!col) return;
    const m = row.reduce((v, p) => v.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
    g.setRGB(...col);
    for (let i = 0; i < N; i++) { const a = row[i], b = row[(i + 1) % N]; if (flip) tri(g, m, b, a); else tri(g, m, a, b); }
  });
}
// charred log with ash-grey patches and dead ends
function charLog(g, cx, cy, cz, len, r, rotY, rng) {
  prism(g, cx, cy, cz, len, r, rotY, rng, { shade: (q) => { const k = 0.7 + 0.6 * q.next(); return q.chance(0.25) ? [0.32 * k, 0.31 * k, 0.29 * k] : [0.06 * k, 0.05 * k, 0.04 * k]; }, caps: [[0.16, 0.12, 0.09], [0.16, 0.12, 0.09]] });
}

// deterministic abandoned-camp spot of a chunk (both decorate and populate need it)
function campSpot(level, rec) {
  if (hash01(rec.cx, rec.cz, 8181, level.seed) > 0.13) return null;
  const pillars = new Set(rec.layout.pillars.map((p) => p.li + ',' + p.lj));
  const cands = [];
  for (let lj = 1; lj < CHUNK - 1; lj++) for (let li = 1; li < CHUNK - 1; li++) {
    const c = cellOf(rec, li, lj);
    if (!open(c) || c.water || pillars.has(li + ',' + lj) || c.zone === 'warehouse' || c.zone === 'office') continue;
    cands.push([li, lj]);
  }
  if (!cands.length) return null;
  const [li, lj] = cands[Math.floor(hash01(rec.cx, rec.cz, 8282, level.seed) * cands.length)];
  return { li, lj, x: x0Of(rec, li) + CELL / 2, z: z0Of(rec, lj) + CELL / 2, torn: hash01(rec.cx, rec.cz, 8383, level.seed) < 0.35 };
}

// ============================================================================ decorate (every peer)
export function decorateBiome(level, rec) {
  const rng = new RNG(hash3(rec.cx, rec.cz, 6161, level.seed));
  const gD = new EnvGeo({ color: true }), gT = new EnvGeo({ color: true }), gG = new EnvGeo({ color: true });
  const pillars = new Set(rec.layout.pillars.map((p) => p.li + ',' + p.lj));
  // --- damp cells: mould stains + mushroom tufts in the corners
  for (const c of rec.layout.cells) {
    if (!open(c) || !isDamp(c) || c.water) continue;
    const h = hash01(c.i, c.j, 6262, level.seed);
    if (h > 0.55) continue;
    const x0 = x0Of(rec, c.li), z0 = z0Of(rec, c.lj);
    const corners = [[0.45, 0.45], [CELL - 0.45, 0.45], [0.45, CELL - 0.45], [CELL - 0.45, CELL - 0.45]].filter((_, k) => !(k === 0 && pillars.has(c.li + ',' + c.lj)));
    const nc = 1 + (h < 0.2 ? 1 : 0);
    for (let k = 0; k < nc; k++) {
      const [ox, oz] = corners[(Math.floor(h * 97) + k) % corners.length];
      const x = x0 + ox + (rng.next() - 0.5) * 0.3, z = z0 + oz + (rng.next() - 0.5) * 0.3;
      decal(gD, x, z, 0.5 + rng.next() * 0.4, 0.5 + rng.next() * 0.4, rng.next() * 6, TILE.mold, 0.005);
      const glowy = c.zone === 'flooded' || (c.zone !== 'maintenance' && rng.chance(0.35));
      const n = 3 + rng.int(0, 5);
      for (let m = 0; m < n; m++) {
        const a = rng.next() * 6.28, d = rng.next() * 0.28;
        const hh = 0.04 + rng.next() * 0.09, r = 0.025 + rng.next() * 0.04;
        if (glowy) shroom(gT, gG, x + Math.cos(a) * d, z + Math.sin(a) * d, hh, r * 0.7, [0.7, 1, 0.9], [0.75, 0.78, 0.7], rng, a);
        else shroom(gT, null, x + Math.cos(a) * d, z + Math.sin(a) * d, hh, r, c.zone === 'maintenance' ? [0.05, 0.055, 0.04] : [0.55, 0.4, 0.2], [0.6, 0.55, 0.45], rng, a);
      }
    }
  }
  // --- drag trails (blood or oil) between open cells, sometimes ending at a torn-apart clone
  const trails = rng.chance(0.3) ? 1 + (rng.chance(0.3) ? 1 : 0) : 0;
  const physics = level.world.physics;
  for (let t = 0; t < trails; t++) {
    let li = rng.int(1, CHUNK - 2), lj = rng.int(1, CHUNK - 2);
    if (!open(cellOf(rec, li, lj)) || cellOf(rec, li, lj).water) continue;
    const oil = rng.chance(0.45);
    const pts = [new THREE.Vector3(x0Of(rec, li) + 0.6 + rng.next() * 1.8, 0, z0Of(rec, lj) + 0.6 + rng.next() * 1.8)];
    for (let s = 0; s < 3; s++) {
      const [dx, dz] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      const ni = li + dx, nj = lj + dz;
      if (ni < 0 || nj < 0 || ni >= CHUNK || nj >= CHUNK || !open(cellOf(rec, ni, nj)) || cellOf(rec, ni, nj).water) break;
      const q = new THREE.Vector3(x0Of(rec, ni) + 0.6 + rng.next() * 1.8, 0, z0Of(rec, nj) + 0.6 + rng.next() * 1.8);
      if (!physics.lineOfSight(_a.copy(pts[pts.length - 1]).setY(0.3), _b.copy(q).setY(0.3))) break;
      pts.push(q); li = ni; lj = nj;
    }
    if (pts.length < 2) continue;
    const col = oil ? [0.35, 0.35, 0.4] : [1, 1, 1];
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1], L = a.distanceTo(b), rot = Math.atan2(b.z - a.z, b.x - a.x);
      for (let d = 0; d < L; d += 0.32) {
        const p = _c.copy(a).lerp(b, d / L);
        decal(gD, p.x + (rng.next() - 0.5) * 0.06, p.z + (rng.next() - 0.5) * 0.06, 0.2, 0.09 + rng.next() * 0.05, rot + (rng.next() - 0.5) * 0.3, TILE.smear, 0.006 + s * 0.0002, col);
      }
    }
    const end = pts[pts.length - 1];
    decal(gD, end.x, end.z, 0.55, 0.45, rng.next() * 6, oil ? TILE.oil : TILE.blood, 0.007);
    if (rng.chance(0.55)) tornClone(level, rec, gT, end, rng, oil);
  }
  // --- abandoned camp: cold fire ring with ash and charred logs
  const camp = campSpot(level, rec);
  if (camp) {
    const cr = new RNG(hash3(rec.cx, rec.cz, 8484, level.seed));
    decal(gD, camp.x, camp.z, 0.5, 0.5, cr.next() * 6, TILE.ash, 0.006);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      rock(gT, camp.x + Math.cos(a) * 0.42, 0.045, camp.z + Math.sin(a) * 0.42, 0.075, 0.055, 0.065, a, [0.42, 0.41, 0.38].map((v) => v * (0.8 + cr.next() * 0.3)), cr, camp);
    }
    for (let k = 0; k < 3; k++) charLog(gT, camp.x + (cr.next() - 0.5) * 0.2, 0.035, camp.z + (cr.next() - 0.5) * 0.2, 0.38, 0.032, cr.next() * 3, cr);
    if (camp.torn) tornClone(level, rec, gT, new THREE.Vector3(camp.x - 1.0, 0, camp.z + 1.0), cr, false);
  }
  grime(level, rec, gD);
  if (!gD.isEmpty()) bakeInto(level, rec, gD, decalMat(), { quant: 0.3, mix: [1, 0.4] });
  if (!gT.isEmpty()) bakeInto(level, rec, gT, tuftMat(), { quant: 0.2, mix: [1, 0.4] });
  if (!gG.isEmpty()) bakeInto(level, rec, gG, glowMat(), { quant: 0.2, mix: [1, 0.4] });
}

// a clone torn apart: skinned doll in a dead pose with limbs ripped off at the joints, the parts flung around,
// oil / plasma pooled under it and wires hanging out of the stumps
function tornClone(level, rec, gT, pos, rng, oil) {
  try {
    const a = new Avatar({ suit: rng.pick(['yellow', 'orange', 'white']), hat: rng.pick(['none', 'hardhat', 'beanie']), visor: 'none', face: 'dots', backpack: rng.pick(['tank', 'none']), accessory: 'none' });
    a.update(0.016, { speed: 0, grounded: true, dead: true, expression: 'dead', moveDir: new THREE.Vector2() });
    const torn = rng.shuffle(['elL', 'elR', 'knL', 'knR', 'head']).slice(0, 2 + rng.int(0, 1));
    for (const b of torn) if (a.bones?.[b]) a.bones[b].scale.setScalar(0.001);
    a.root.position.copy(pos).setY(0.12);
    a.root.rotation.set(-Math.PI / 2 + 0.15, rng.next() * 6, (rng.next() - 0.5) * 0.6);
    a.root.traverse((o) => { if (o.isMesh) o.userData.sharedGeo = true; });
    rec.group.add(a.root);
    level.prepStatic(a.root, rec);
  } catch (e) { console.warn('torn clone', e); }
  const suit = [0.86, 0.66, 0.14];
  for (let k = 0; k < 3; k++) {
    const ang = rng.next() * 6.28, d = 0.6 + rng.next() * 0.9;
    const x = pos.x + Math.cos(ang) * d, z = pos.z + Math.sin(ang) * d, r = rng.next() * 3;
    const base = k === 2 ? [0.9, 0.86, 0.78] : suit;
    // a torn limb in its suit sleeve (rounded far end, dark torn stump with the wires hanging out)
    prism(gT, x, 0.048, z, 0.32, 0.046, r, rng, { N: 9, seg: 5, jit: 0.05, taper: 0.45, shade: (q) => { const kk = 0.86 + q.next() * 0.2; return base.map((v) => v * kk); }, caps: [[0.08, 0.07, 0.06], base] });
    for (let w = 0; w < 3; w++) {
      const rw = r + Math.PI + (rng.next() - 0.5) * 1.2, l = 0.06 + rng.next() * 0.05, col = [[0.75, 0.42, 0.2], [0.7, 0.1, 0.08], [0.15, 0.25, 0.7]][w];
      prism(gT, x - Math.cos(r) * 0.16 + Math.cos(rw) * l / 2, 0.012 + w * 0.006, z - Math.sin(r) * 0.16 + Math.sin(rw) * l / 2, l, 0.004, rw, rng, { N: 4, seg: 2, jit: 0, shade: () => col, caps: [col, [0.7, 0.62, 0.4]] });
    }
  }
  void oil;
}

// ============================================================================ populate (host)
export function populateBiome(level, rec) {
  const rng = new RNG(hash3(rec.cx, rec.cz, 7171, level.seed));
  const placer = new Placer(level);
  const props = level.world.props;
  const put = (type, x, z, rot = 0, o = {}) => {
    if (!ITEM[type]) return null;
    const got = placer.place(type, x, z, rot, o.ax ?? x, o.az ?? z, 0.04);
    if (!got) return null;
    let busy = false;
    props.query(_a.set(got.x, 0.3, got.z), o.clear ?? 0.35, () => { busy = true; });
    if (busy) return null;
    return sp(level, type, got.x, 0, got.z, got.rotY, o);
  };
  const pillars = new Set(rec.layout.pillars.map((p) => p.li + ',' + p.lj));
  const openCells = rec.layout.cells.filter((c) => open(c) && !c.water);
  // --- collectible fungus in damp corners (and glowcaps in the dark)
  for (const c of openCells) {
    const damp = isDamp(c);
    if (!(damp ? rng.chance(0.16) : c.zone === 'dark' && rng.chance(0.05))) continue;
    const x0 = x0Of(rec, c.li), z0 = z0Of(rec, c.lj);
    const pool = !damp ? [['fungus_glow', 1]] : c.zone === 'maintenance' ? [['fungus_black', 5], ['fungus_shelf', 3], ['fungus_puff', 2]] : c.zone === 'flooded' ? [['fungus_glow', 4.5], ['fungus_puff', 3], ['fungus_black', 2.5]] : [['fungus_shelf', 4], ['fungus_black', 3], ['fungus_glow', 3]];
    const n = 1 + (rng.chance(0.2) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      let ox = rng.chance(0.5) ? 0.5 : CELL - 0.5, oz = rng.chance(0.5) ? 0.5 : CELL - 0.5;
      if (ox < 1 && oz < 1 && pillars.has(c.li + ',' + c.lj)) { ox = CELL - 0.5; }
      put(rng.weighted(pool), x0 + ox + (rng.next() - 0.5) * 0.4, z0 + oz + (rng.next() - 0.5) * 0.4, rng.next() * 6, { ax: x0 + CELL / 2, az: z0 + CELL / 2, clear: 0.2 });
    }
  }
  // --- abandoned camp
  const camp = campSpot(level, rec);
  if (camp) {
    const cx = camp.x, cz = camp.z, r = (a) => (rng.next() - 0.5) * a;
    const o = { ax: cx, az: cz };
    put('tent_ruin', cx + 0.75, cz - 0.55, rng.next() * 6, { ...o, clear: 0.6 });
    put('sleeping_bag', cx - 0.95, cz + 0.2, Math.PI / 2 + r(0.5), o);
    put(rng.chance(0.7) ? 'supply_box' : 'crate_wood', cx + 1.05, cz + 0.95, r(0.8), o);
    if (rng.chance(0.45)) put('camp_stove', cx - 0.7, cz - 0.9, r(3), o);
    if (rng.chance(0.55)) put('trolley_broken', cx + 0.1, cz + 1.05, Math.PI / 2 + r(0.6), { ...o, clear: 0.5 });
    const wheels = rng.int(0, 2);
    for (let k = 0; k < wheels; k++) put('wheel', cx + r(1.6), cz + r(1.6), rng.next() * 6, o);
    put(rng.chance(0.6) ? 'board' : 'plank', cx - 0.3 + r(0.6), cz + 1.2, rng.next() * 6, o);
    for (const t of ['metal_scrap', 'screws', rng.pick(['battery', 'battery', 'flashlight']), rng.pick(['canned_food', 'almond_water', 'mole_meat'])]) put(t, cx + r(1.8), cz + r(1.8), rng.next() * 6, { ...o, clear: 0.18 });
    if (rng.chance(0.35)) put(rng.pick(['wrench', 'crowbar', 'tape_roll']), cx + r(1.6), cz + r(1.6), rng.next() * 6, o);
    put('note_scribble', cx - 0.4 + r(0.4), cz - 0.2 + r(0.4), rng.next() * 6, { ...o, clear: 0.15, state: { n: rng.int(0, 999) } });
    if (rng.chance(0.07)) put('case_file', cx + r(1.2), cz + r(1.2), rng.next() * 6, o);
  }
  // --- lone supply crate / scrap pile / note somewhere open
  const pickCell = () => (openCells.length ? openCells[rng.int(0, openCells.length - 1)] : null);
  if (rng.chance(0.16)) {
    const c = pickCell();
    if (c) { const x0 = x0Of(rec, c.li), z0 = z0Of(rec, c.lj); put('supply_box', x0 + (rng.chance(0.5) ? 0.6 : CELL - 0.6), z0 + (rng.chance(0.5) ? 0.5 : CELL - 0.5), rng.pick([0, Math.PI / 2]), { ax: x0 + CELL / 2, az: z0 + CELL / 2 }); }
  }
  if (rng.chance(0.2)) {
    const c = pickCell();
    if (c) {
      const x = x0Of(rec, c.li) + CELL / 2, z = z0Of(rec, c.lj) + CELL / 2;
      for (const t of ['metal_scrap', 'metal_scrap', 'screws', 'wire_spool', rng.pick(['pipe_short', 'gear', 'wheel', 'battery'])]) put(t, x + (rng.next() - 0.5) * 1.2, z + (rng.next() - 0.5) * 1.2, rng.next() * 6, { clear: 0.15 });
    }
  }
  if (rng.chance(0.22)) {
    const c = pickCell();
    if (c) put('note_scribble', x0Of(rec, c.li) + 0.8 + rng.next() * 1.4, z0Of(rec, c.lj) + 0.8 + rng.next() * 1.4, rng.next() * 6, { clear: 0.15, state: { n: rng.int(0, 999) } });
  }
}
