// Room shells of the R.O.O.M. HQ lobby (Sublevel B4): 1990s underground corporate interior (today one small
// waiting room; rooms may carry a floor trapdoor / ceiling hatch hole and an explicit troffer grid).
// Carpet-tile offices, VCT break / locker rooms, a tiled cloning lab and a painted-block dispatch bay;
// drop ceilings with grid-aligned recessed troffers (surface fixtures on the bay's concrete soffit),
// wood wainscot with chair rails, tile wainscot with bullnose caps, rubber cove bases, corner beads,
// outlets / switches / thermostats / exit signs. Lit per pixel by the room-grid light mode.
import * as THREE from 'three';
import * as Mat from '../../gfx/materials.js';
import { bakeGeometry, bakedMaterial, LightField } from '../../gfx/bakedlight.js';
import { EnvGeo, fr } from './builder.js';
import { troffer } from './ceiling.js';
import { fixtureMaterial } from './fixtures.js';
import * as Fx from './fixtures.js';
import { hash01 } from '../../core/rng.js';

const TILE = 0.6;
const SKIRT_WOOD = [[0.014, 0], [0.014, 0.1], [0.008, 0.122], [0.0, 0.13]];
const SKIRT_RUBBER = [[0.0075, 0], [0.0035, 0.014], [0.0035, 0.097], [0.0, 0.1]];

// lobby: the LobbyLevel instance (field, world, _addLight); rooms: ROOMS table; walls: wall table
export function buildLobbyShell(lobby, rooms, walls, H, T) {
  const field = lobby.field;
  const phys = lobby.world.physics;
  const G = {};
  const geo = (key, o = {}) => (G[key] = G[key] || new EnvGeo({ room: true, ...o }));
  const roomAt = (x, z) => {
    for (let r = 0; r < rooms.length; r++) { const R = rooms[r]; if (x > R.x0 && x < R.x1 && z > R.z0 && z < R.z1) return r; }
    return -1;
  };
  const edgeDist = (r, x, z) => { const R = rooms[r]; return Math.min(x - R.x0, R.x1 - x, z - R.z0, R.z1 - z); };
  const occ = (d, k, rad) => { const a = 1 - smooth(0, rad, d); return 1 - a * a * k; };

  // ---------------------------------------------------------------- lights (tile-grid aligned)
  const A = field.uniforms.uRoomA.value, B = field.uniforms.uRoomB.value;
  const lightBoxes = [];
  rooms.forEach((R, r) => {
    const w = R.x1 - R.x0, d = R.z1 - R.z0;
    let nx = Math.max(1, Math.round(w / 3.2)), nz = Math.max(1, Math.round(d / 3.2));
    let sx = Math.max(TILE * 2, Math.round(w / nx / TILE) * TILE), sz = Math.max(TILE * 2, Math.round(d / nz / TILE) * TILE);
    let cx0 = Math.round(((R.x0 + R.x1) / 2 - ((nx - 1) / 2) * sx) / TILE) * TILE;
    let cz0 = (Math.round(((R.z0 + R.z1) / 2 - ((nz - 1) / 2) * sz) / TILE - 0.5) + 0.5) * TILE;
    if (R.grid) ({ nx, nz, sx, sz, cx0, cz0 } = R.grid); // explicit troffer grid (small rooms)
    A[r].set(cx0 - sx / 2, cz0 - sz / 2, sx, sz);
    B[r].set(nx, nz, H - 0.04, 0);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const x = cx0 + a * sx, z = cz0 + b * sz;
      const l = lobby._addLight(x, z, R.tone, R.id === 'dispatch' ? 0.95 : 1.05, R.id);
      l.roomIndex = r;
      lightBoxes.push({ r, x0: x - 0.6, x1: x + 0.6, z0: z - 0.3, z1: z + 0.3, dispatch: R.id === 'dispatch' });
    }
  });

  // ---------------------------------------------------------------- floors & ceilings
  rooms.forEach((R, r) => {
    const w = R.x1 - R.x0, d = R.z1 - R.z0;
    const lines = (a, b, extra = []) => {
      const s = new Set([a, b, a + 0.12, b - 0.12, a + 0.5, b - 0.5]);
      for (let v = Math.ceil(a / 1.5) * 1.5; v < b; v += 1.5) s.add(v);
      for (const e of extra) if (e > a && e < b) s.add(e);
      return [...s].filter((v) => v >= a && v <= b).sort((p, q) => p - q);
    };
    const fl = geo('floor_' + R.floor);
    fl.room = r;
    // optional holes (a trapdoor in the floor, a hatch in the ceiling): grid lines on their edges, cells skipped
    const FH = R.floorHole, CH = R.ceilHole;
    const inRect = (h, x, z) => h && x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1;
    const xs = lines(R.x0, R.x1, FH ? [FH.x0, FH.x1] : []), zs = lines(R.z0, R.z1, FH ? [FH.z0, FH.z1] : []);
    const fus = xs.map((x) => (x - R.x0) / w), fvs = zs.map((z) => (R.z1 - z) / d).reverse();
    fl.grid([R.x0, 0, R.z1], [w, 0, 0], [0, 0, -d], [0, 1, 0], fus, fvs, (x, y, z) => [x, z],
      FH ? (iu, iv) => inRect(FH, R.x0 + ((fus[iu] + fus[iu + 1]) / 2) * w, R.z1 - ((fvs[iv] + fvs[iv + 1]) / 2) * d) : null);
    // ceiling
    const mine = lightBoxes.filter((L) => L.r === r);
    if (R.id === 'dispatch') {
      const c = geo('ceil_slab');
      c.room = r;
      c.grid([R.x0, H, R.z0], [w, 0, 0], [0, 0, d], [0, -1, 0], xs.map((x) => (x - R.x0) / w), zs.map((z) => (z - R.z0) / d), (x, y, z) => [x, z]);
      // surface-mounted industrial fixtures: enamel housing hanging under the slab, lens underneath
      const en = geo('enamel'), ln = geo('lens');
      en.room = r; ln.room = r;
      for (const L of mine) {
        en.chamferBox(L.x0 - 0.02, H - 0.11, L.z0 - 0.02, L.x1 + 0.02, H, L.z1 + 0.02, 0.012, 'ny', { py: true }, (x, y, z) => [x, z + y]);
        ln.rectOriented([[L.x0 + 0.03, H - 0.112, L.z0 + 0.03], [L.x1 - 0.03, H - 0.112, L.z0 + 0.03], [L.x1 - 0.03, H - 0.112, L.z1 - 0.03], [L.x0 + 0.03, H - 0.112, L.z1 - 0.03]], [0, -1, 0],
          (x, y, z) => [(x - L.x0) / (L.x1 - L.x0), (z - L.z0) / (L.z1 - L.z0)]);
      }
      return;
    }
    const c = geo('ceil', { wet: true });
    c.room = r; c.wet = -0.15;
    const cxs = lines(R.x0, R.x1, [...mine.flatMap((L) => [L.x0, L.x1]), ...(CH ? [CH.x0, CH.x1] : [])]);
    const czs = lines(R.z0, R.z1, [...mine.flatMap((L) => [L.z0, L.z1]), ...(CH ? [CH.z0, CH.z1] : [])]);
    const inLight = (x, z) => mine.some((L) => x > L.x0 + 0.001 && x < L.x1 - 0.001 && z > L.z0 + 0.001 && z < L.z1 - 0.001);
    c.grid([R.x0, H - 0.002, R.z0], [w, 0, 0], [0, 0, d], [0, -1, 0], cxs.map((x) => (x - R.x0) / w), czs.map((z) => (z - R.z0) / d), (x, y, z) => [x, z],
      (iu, iv) => { const x = (cxs[iu] + cxs[iu + 1]) / 2, z = (czs[iv] + czs[iv + 1]) / 2; return inLight(x, z) || inRect(CH, x, z); });
    const tg = { enamel: geo('enamel'), lens: geo('lens') };
    tg.enamel.room = r; tg.lens.room = r;
    for (const L of mine) troffer(tg, L.x0, L.z0, L.x1, L.z1, true, 0.5, H);
  });

  // ---------------------------------------------------------------- walls
  const fx = geo('fixture', { color: true });
  const P = (spec) => (typeof spec === 'string' ? { lower: spec, upper: spec, split: 0 } : spec);
  const matKey = (m) => (m === 'concrete' ? 'cmu' : m);
  let wi = 0;
  for (const [x0, z0, x1, z1, matA, matB, openings = []] of walls) {
    wi++;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const axis = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 'x' : 'z';
    const s0 = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
    const fixed = axis === 'x' ? z0 : x0;
    const pieces = [];
    let cur = 0;
    for (const o of openings.slice().sort((a, b) => a.a - b.a)) {
      if (o.a > cur) pieces.push([cur, o.a, 0, H]);
      pieces.push([o.a, o.b, o.top, H]);
      cur = o.b;
    }
    if (cur < len) pieces.push([cur, len, 0, H]);
    for (const [a, b, y0, y1] of pieces) {
      if (b - a < 0.01 || y1 - y0 < 0.01) continue;
      const e0 = a === 0 ? -T / 2 : a, e1 = b === len ? len + T / 2 : b;
      const UA = s0 + e0, UB = s0 + e1;
      for (const side of [-1, 1]) {
        const spec0 = side < 0 ? matA : matB;
        if (!spec0) continue;
        const spec = P(spec0);
        const fp = fixed + side * T / 2;
        const n = axis === 'x' ? [0, 0, side] : [side, 0, 0];
        const cxm = axis === 'x' ? (UA + UB) / 2 : fp + side * 0.3, czm = axis === 'x' ? fp + side * 0.3 : (UA + UB) / 2;
        const r = roomAt(cxm, czm);
        if (r < 0) continue;
        const bands = spec.split > y0 && spec.split < y1 ? [[y0, spec.split, spec.lower], [spec.split, y1, spec.upper]] : [[y0, y1, spec.split >= y1 ? spec.lower : spec.upper]];
        for (const [b0, b1, m] of bands) {
          const g = geo('wall_' + matKey(m));
          g.room = r; g.ao = 1;
          const cols = [UA]; for (let u = UA + 1.5; u < UB - 0.3; u += 1.5) cols.push(u); cols.push(UB);
          const rws = [b0]; for (const y of [1.2, 2.2]) if (y > b0 + 0.1 && y < b1 - 0.1) rws.push(y); rws.push(b1);
          const L = UB - UA, Hh = b1 - b0;
          if (axis === 'x') g.grid([UA, b0, fp], [L, 0, 0], [0, Hh, 0], n, cols.map((c) => (c - UA) / L), rws.map((y) => (y - b0) / Hh), (x, y) => [x, y]);
          else g.grid([fp, b0, UA], [0, 0, L], [0, Hh, 0], n, cols.map((c) => (c - UA) / L), rws.map((y) => (y - b0) / Hh), (x, y, z) => [z, y]);
        }
        // chair rail / bullnose cap on the wainscot
        if (spec.split > y0 && spec.split < y1) {
          const wood = spec.lower === 'panel';
          const g = geo(wood ? 'trim' : 'enamel');
          g.room = r;
          const hgt = wood ? 0.05 : 0.022, pr = wood ? 0.024 : 0.011;
          const yb = spec.split - hgt * 0.5;
          const wa = Math.min(fp, fp + side * pr), wb = Math.max(fp, fp + side * pr);
          if (axis === 'x') g.chamferBox(UA, yb, wa, UB, yb + hgt, wb, wood ? 0.01 : 0.008, side > 0 ? 'pz' : 'nz', side > 0 ? { nz: true } : { pz: true }, (x, y) => [x, y]);
          else g.chamferBox(wa, yb, UA, wb, yb + hgt, UB, wood ? 0.01 : 0.008, side > 0 ? 'px' : 'nx', side > 0 ? { nx: true } : { px: true }, (x, y, z) => [z, y]);
        }
        // skirting: wood under panelling, rubber cove base elsewhere, none on tile
        if (y0 === 0) {
          const low = spec.split > 0 ? spec.lower : spec.upper;
          if (low !== 'tile' && low !== 'tile_green') {
            const wood = low === 'panel';
            const g = geo(wood ? 'trim' : 'rubber');
            g.room = r;
            const prof = wood ? SKIRT_WOOD : SKIRT_RUBBER;
            const ext = prof[0][0];
            g.extrude(prof, axis, fp, side, UA - (a === 0 ? ext : 0), UB + (b === len ? ext : 0), [a !== 0, b !== len]);
          }
        }
        // fixtures on long faces
        if (y0 === 0 && UB - UA > 2.2) {
          const fr2 = { axis, plane: fp, side };
          const h = hash01(wi, Math.round(UA * 10), side > 0 ? 7 : 8, 11);
          fx.room = r;
          if (h < 0.55) Fx.outlet(fx, fr2, UA + 0.6 + hash01(wi, 3, 9, 1) * (UB - UA - 1.2), 0.3);
          if (h > 0.8) Fx.thermostat(fx, fr2, UA + 0.8 + hash01(wi, 5, 9, 1) * (UB - UA - 1.6), 1.5);
          else if (h > 0.62 && h < 0.7) Fx.grille(fx, fr2, UA + 0.8 + hash01(wi, 6, 9, 1) * (UB - UA - 1.6), 2.45);
        }
        // light switch beside passage openings
        if (y0 === 0 && (a > 0 || b < len)) {
          const h2 = hash01(wi, Math.round(UB * 10), side > 0 ? 11 : 12, 11);
          if (h2 < 0.5 && UB - UA > 0.6) {
            fx.room = r;
            Fx.lightSwitch(fx, { axis, plane: fp, side }, b < len ? UB - 0.18 : UA + 0.18, 1.2);
          }
        }
      }
      // free ends: drywall return + corner beads
      if (y0 === 0) {
        for (const [at, free] of [[UA, a > 0], [UB, b < len]]) {
          if (!free) continue;
          for (const side of [-1, 1]) {
            const spec0 = side < 0 ? matA : matB;
            if (!spec0) continue;
            const fp = fixed + side * T / 2;
            const r = roomAt(axis === 'x' ? at : fp + side * 0.3, axis === 'x' ? fp + side * 0.3 : at);
            if (r < 0) continue;
            const spec = P(spec0);
            const g = geo('wall_' + matKey(spec.upper));
            g.room = r;
            bead(g, axis, fp, side, at, 0.13, y1);
          }
        }
      }
      // end faces (jamb returns) + soffits
      {
        const spec0 = matB || matA;
        const spec = P(spec0);
        const g = geo('wall_' + matKey(spec.upper));
        const zA = fixed - T / 2, zB = fixed + T / 2;
        const rIn = roomAt(axis === 'x' ? UA - 0.3 : fixed + 0.3, axis === 'x' ? fixed + 0.3 : UA - 0.3);
        g.room = Math.max(0, rIn);
        if (a > 0) endFace(g, axis, UA, zA, zB, y0, y1, -1);
        if (b < len) endFace(g, axis, UB, zA, zB, y0, y1, 1);
        if (y0 > 0) {
          g.ao = 0.85;
          if (axis === 'x') g.rectOriented([[UA, y0, zA], [UB, y0, zA], [UB, y0, zB], [UA, y0, zB]], [0, -1, 0], (x, y, z) => [x, z]);
          else g.rectOriented([[zA, y0, UA], [zB, y0, UA], [zB, y0, UB], [zA, y0, UB]], [0, -1, 0], (x, y, z) => [z, x]);
          g.ao = 1;
        }
      }
      // collider for the full thickness
      if (axis === 'x') phys.addStaticBox(s0 + (e0 + e1) / 2, (y0 + y1) / 2, fixed, (e1 - e0) / 2, (y1 - y0) / 2, T / 2, { kind: 'static' });
      else phys.addStaticBox(fixed, (y0 + y1) / 2, s0 + (e0 + e1) / 2, T / 2, (y1 - y0) / 2, (e1 - e0) / 2, { kind: 'static' });
    }
  }
  // ---------------------------------------------------------------- bake + meshes
  return { G, roomAt, edgeDist, occ };
}

function endFace(g, axis, at, zA, zB, y0, y1, dir) {
  if (axis === 'x') g.rectOriented([[at, y0, zA], [at, y0, zB], [at, y1, zB], [at, y1, zA]], [dir, 0, 0], (x, y, z) => [z, y]);
  else g.rectOriented([[zA, y0, at], [zB, y0, at], [zB, y1, at], [zA, y1, at]], [0, 0, dir], (x, y) => [x, y]);
}

function bead(g, axis, f, side, at, yb, yt) {
  const w = 0.011, pr = 0.0018, s2 = Math.SQRT1_2;
  if (axis === 'x') {
    const z1 = f + side * pr;
    g.rectOriented([[at - w, yb, z1], [at + w, yb, z1], [at + w, yt, z1], [at - w, yt, z1]], [0, 0, side], (x, y) => [x, y]);
    g.rectOriented([[at - w - 0.004, yb, f], [at - w, yb, z1], [at - w, yt, z1], [at - w - 0.004, yt, f]], [-s2, 0, side * s2], (x, y) => [x, y]);
    g.rectOriented([[at + w + 0.004, yb, f], [at + w, yb, z1], [at + w, yt, z1], [at + w + 0.004, yt, f]], [s2, 0, side * s2], (x, y) => [x, y]);
  } else {
    const x1 = f + side * pr;
    g.rectOriented([[x1, yb, at - w], [x1, yb, at + w], [x1, yt, at + w], [x1, yt, at - w]], [side, 0, 0], (x, y, z) => [z, y]);
    g.rectOriented([[f, yb, at - w - 0.004], [x1, yb, at - w], [x1, yt, at - w], [f, yt, at - w - 0.004]], [side * s2, 0, -s2], (x, y, z) => [z, y]);
    g.rectOriented([[f, yb, at + w + 0.004], [x1, yb, at + w], [x1, yt, at + w], [f, yt, at + w + 0.004]], [side * s2, 0, s2], (x, y, z) => [z, y]);
  }
}

// Bake every builder (light from other rooms through the openings: legacy weights; AO from the room
// rectangle) and add the meshes. lightsNear / occl / H come from the lobby.
export function bakeLobbyShell(lobby, shell, rooms, lightsNear, occl, H, hazardMat) {
  const { G, edgeDist } = shell;
  const field = lobby.field;
  const group = lobby.world.group;
  const matFor = {
    'floor_office_carpet': [Mat.get('office_carpet'), 5],
    'floor_linoleum': [Mat.get('linoleum'), 5],
    'floor_concrete_dark': [Mat.get('concrete_dark'), 4],
    ceil: [Mat.get('ceiling'), 3, { tiles: true, mix: [0.25, 0.5] }],
    ceil_slab: [Mat.get('plenum'), 4, { mix: [0.3, 0.45] }],
    enamel: [Mat.get('enamel'), 0, { mix: [0.6, 0.6] }],
    lens: [Mat.get('lightpanel'), 0, { emissive: true, mix: [0.2, 0.4] }],
    trim: [Mat.get('trim'), 0],
    rubber: [Mat.get('rubber_base'), 0],
    fixture: [fixtureMaterial(), 0],
  };
  for (const [key, g] of Object.entries(G)) {
    if (g.isEmpty()) continue;
    const geo = g.build();
    const roomArr = geo.attributes.aRoom.array;
    const isWall = key.startsWith('wall_');
    const isFloor = key.startsWith('floor_');
    const isCeil = key === 'ceil' || key === 'ceil_slab';
    const ao = (x, y, z, nx, ny, nz) => {
      // contact AO against the room rectangle (floors / ceilings); walls use the analytic y term
      let r = -1;
      for (let k = 0; k < rooms.length; k++) { const R = rooms[k]; if (x >= R.x0 - 0.2 && x <= R.x1 + 0.2 && z >= R.z0 - 0.2 && z <= R.z1 + 0.2) { r = k; break; } }
      if (r < 0 || (!isFloor && !isCeil)) return 1;
      const R = rooms[r];
      const dx = Math.min(x - R.x0, R.x1 - x), dz = Math.min(z - R.z0, R.z1 - z);
      const o = (d) => { const a = 1 - smooth(0.04, isFloor ? 0.55 : 0.45, d); return 1 - a * a * (isFloor ? 0.4 : 0.3); };
      return o(dx) * o(dz);
    };
    void edgeDist;
    bakeGeometry(geo, new THREE.Matrix4(), lightsNear, occl, ao, {
      direct: 1, bounce: 0.3,
      exclude: (l, sx, sy, sz, i) => l.roomIndex === roomArr[i],
    });
    let base, grime, o = {};
    if (isWall) {
      const m = key.slice(5);
      base = Mat.get(m === 'cmu' ? 'cmu' : m);
      grime = m === 'cmu' ? 4 : 5;
      o = { ao: 'wall', macro: m.startsWith('paint') ? 0.04 : 0 };
    } else if (matFor[key]) {
      [base, grime, o = {}] = matFor[key];
      o = { ...o };
    } else continue;
    const mat = bakedMaterial(base, field, grime, { grid: 2, wet: !!g.Wt, mix: o.mix || [1, 0.3], ...o });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = isWall;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  void hazardMat; void H; void fr; void LightField;
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
