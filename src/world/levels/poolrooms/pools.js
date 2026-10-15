// Pool basins: mosaic walls & floors (sloped deep end, full-width "wedding cake" stairs with dark
// nosings, spa benches), waterline tile band, stone bullnose coping, lane lines & wall targets,
// underwater lamps, chrome ladders (climbable devices), stair handrails, main drains, rope lines
// with floats — plus the matching colliders and water-surface geometry.
import * as THREE from 'three';
import { CELL, WATER_Y, RISE, TREAD, poolFloorAt, poolPoint } from './layout.js';
import { SIGN, signQuad } from './signs.js';

export const BAND = 0.24;                 // waterline tile band (below the coping)
export const TINT_BAND = [0.36, 0.52, 0.8];
export const TINT_LANE = [0.14, 0.22, 0.46];
export const TINT_NOSE = [0.18, 0.27, 0.52];
const WHITE = [1, 1, 1];

// coping cross-section [d (outward from the basin edge), y]
const COPING = [
  [0.0, -0.03], [-0.04, -0.03], [-0.052, -0.012], [-0.05, 0.016], [-0.04, 0.042], [-0.024, 0.062], [-0.005, 0.073],
  [0.04, 0.079], [0.22, 0.079], [0.27, 0.076], [0.292, 0.066], [0.3, 0.05], [0.302, 0.0],
];
export const COPING_W = 0.3;
export const COPING_H = 0.079;

const _v = new THREE.Vector3();

export function poolRect(p, ox, oz) {
  const X0 = ox + p.rx * CELL, Z0 = oz + p.rz * CELL;
  return { X0, Z0, X1: X0 + p.w * CELL, Z1: Z0 + p.h * CELL };
}

// B: { pool, trim, chrome, lamp, void, rope, boxes[], rboxes[], lamps[], ladders[], floats[], water }
export function buildPool(B, p, ox, oz) {
  const { X0, Z0, X1, Z1 } = poolRect(p, ox, oz);
  const L = p.L;
  const A = (p.axis === 'x' ? p.h : p.w) * CELL; // width across
  const sdir = p.axis === 'x' ? [p.dir, 0, 0] : [0, 0, p.dir];
  const tdir = p.axis === 'x' ? [0, 0, 1] : [1, 0, 0];
  const W = (s, t, y) => { const [x, z] = poolPoint(p, ox, oz, s, t); return [x, y, z]; };
  const F = (s, t = 0.5) => poolFloorAt(p, s, t);
  const M = B.pool;
  const seg = 0.5;
  const minY = Math.min(p.deepY, p.shallowY);

  // ---------------- floor ----------------
  if (p.kind === 'spa') {
    const hole = { x0: X0 + 0.45, x1: X1 - 0.45, z0: Z0 + 0.45, z1: Z1 - 0.45 };
    M.setTint(WHITE);
    M.hface(-0.25, 1, X0, X1, Z0, Z1, [hole]);
    M.hface(p.shallowY, 1, hole.x0, hole.x1, hole.z0, hole.z1);
    // bench risers facing the sunken centre
    M.vface('z', hole.z0, 1, hole.x0, hole.x1, p.shallowY, -0.25);
    M.vface('z', hole.z1, -1, hole.x0, hole.x1, p.shallowY, -0.25);
    M.vface('x', hole.x0, 1, hole.z0, hole.z1, p.shallowY, -0.25);
    M.vface('x', hole.x1, -1, hole.z0, hole.z1, p.shallowY, -0.25);
    B.boxes.push({ min: [X0, -0.6, Z0], max: [X1, -0.25, hole.z0] });
    B.boxes.push({ min: [X0, -0.6, hole.z1], max: [X1, -0.25, Z1] });
    B.boxes.push({ min: [X0, -0.6, hole.z0], max: [hole.x0, -0.25, hole.z1] });
    B.boxes.push({ min: [hole.x1, -0.6, hole.z0], max: [X1, -0.25, hole.z1] });
    B.boxes.push({ min: [hole.x0, -0.95, hole.z0], max: [hole.x1, p.shallowY, hole.z1] });
  } else {
    // stairs: treads + risers (all full width), dark nosing strips
    for (let k = 0; k < p.steps - 1; k++) {
      const y = -(k + 1) * RISE;
      const s0 = k * TREAD, s1 = (k + 1) * TREAD;
      M.setTint(WHITE);
      stripS(M, W, s0, s1 - 0.05, 0, 1, () => y, [0, 1, 0], A);
      M.setTint(TINT_NOSE);
      stripS(M, W, s1 - 0.05, s1, 0, 1, () => y, [0, 1, 0], A);
      B.boxes.push(stBox(W, s0, s1, y, minY - 0.4));
    }
    // risers (face +s, toward the deep end)
    for (let k = 0; k < p.steps; k++) {
      const s = k * TREAD;
      const yTop = -k * RISE, yBot = k === p.steps - 1 ? p.shallowY : -(k + 1) * RISE;
      if (k === 0) continue; // the end wall covers the first riser
      M.setTint(TINT_NOSE);
      riser(M, W, s, Math.max(yBot, yTop - 0.05), yTop, sdir, A);
      M.setTint(WHITE);
      riser(M, W, s, yBot, Math.max(yBot, yTop - 0.05), sdir, A);
    }
    // main floor (smooth slope) from the last riser to the end wall
    const s0 = p.run, s1 = L;
    const nu = Math.max(2, Math.round((s1 - s0) / seg)), nv = Math.max(2, Math.round(A / seg));
    M.setTint(WHITE);
    M.param(nu, nv, (fu, fv) => {
      const s = s0 + (s1 - s0) * fu, t = fv;
      const y = F(s, t);
      const dyds = (F(Math.min(L, s + 0.05), t) - F(Math.max(0, s - 0.05), t)) / 0.1;
      // normal tilted against the slope along s
      const nx = -dyds * sdir[0], nz = -dyds * sdir[2];
      const nl = Math.hypot(nx, 1, nz);
      const [x, , z] = W(s, t, y);
      return [x, y, z, nx / nl, 1 / nl, nz / nl, x, z];
    });
    // floor colliders: flat shallow part, slope segments (rotated), deep flat
    const sf0 = p.run, sf1 = p.run + p.flat, sd0 = sf1 + p.slopeLen;
    if (sf1 > sf0 + 0.01) B.boxes.push(stBox(W, sf0, sf1, p.shallowY, minY - 0.4));
    if (p.slopeLen > 0.05 && Math.abs(p.deepY - p.shallowY) > 0.01) {
      const n = Math.max(2, Math.ceil(p.slopeLen / 0.8));
      for (let k = 0; k < n; k++) {
        const a = sf1 + (p.slopeLen * k) / n, b = sf1 + (p.slopeLen * (k + 1)) / n;
        B.rboxes.push(slopeBox(p, W, a, b, F(a), F(b), A, sdir));
      }
    }
    if (L > sd0 + 0.01) B.boxes.push(stBox(W, Math.max(sd0, sf1), L, p.deepY, minY - 0.4));
  }

  // ---------------- basin walls (with the waterline band) ----------------
  // long sides: t = 0 (normal +t) and t = 1 (normal -t); bottom follows the floor profile
  for (const [t, sg] of p.room ? [] : [[0, 1], [1, -1]]) {
    const n = [tdir[0] * sg, 0, tdir[2] * sg];
    const pieces = [];
    if (p.kind === 'spa') pieces.push([0, L, () => -0.25]);
    else {
      for (let k = 0; k < p.steps - 1; k++) { const y = -(k + 1) * RISE; pieces.push([k * TREAD, (k + 1) * TREAD, () => y]); }
      pieces.push([p.run, L, (s) => F(s, t)]);
    }
    for (const [a, b, bot] of pieces) {
      const nu = Math.max(1, Math.round((b - a) / seg));
      // lower mosaic part
      M.setTint(WHITE);
      M.param(nu, 2, (fu, fv) => {
        const s = a + (b - a) * fu;
        const y0 = bot(s), y1 = Math.max(y0, -BAND);
        const y = y0 + (y1 - y0) * fv;
        const [x, , z] = W(s, t, y);
        return [x, y, z, n[0], 0, n[2], s * (sdir[0] + sdir[2]), y];
      });
      M.setTint(TINT_BAND);
      M.param(nu, 1, (fu, fv) => {
        const s = a + (b - a) * fu;
        const y0 = Math.max(bot(s), -BAND);
        const y = y0 + (0 - y0) * fv;
        const [x, , z] = W(s, t, y);
        return [x, y, z, n[0], 0, n[2], s * (sdir[0] + sdir[2]), y];
      });
    }
  }
  // end walls: s = 0 (normal +s) and s = L (normal -s)
  const ends = p.room ? [] : [[0, 1], [L, -1]].filter(([s]) => !(s === 0 ? (p.dir > 0 ? p.openW : p.openE) : (p.dir > 0 ? p.openE : p.openW)));
  for (const [s, sg] of ends) {
    const n = [sdir[0] * sg, 0, sdir[2] * sg];
    const bot = p.kind === 'spa' ? -0.25 : (s === 0 ? (p.steps > 0 ? -RISE : F(0)) : F(L));
    const nv = Math.max(1, Math.round(A / seg));
    M.setTint(WHITE);
    if (bot < -BAND) {
      M.param(nv, 2, (fu, fv) => {
        const y = bot + (-BAND - bot) * fv;
        const [x, , z] = W(s, fu, y);
        return [x, y, z, n[0], 0, n[2], fu * A, y];
      });
    }
    M.setTint(TINT_BAND);
    M.param(nv, 1, (fu, fv) => {
      const y0 = Math.max(bot, -BAND);
      const y = y0 + (0 - y0) * fv;
      const [x, , z] = W(s, fu, y);
      return [x, y, z, n[0], 0, n[2], fu * A, y];
    });
  }
  // wall colliders around the basin (outside the rect, from below the floor to the deck)
  if (!p.room) {
    // open ends (the canal continues into the next chunk) carry no wall, coping or collider
    const oW = p.axis === 'x' && p.openW, oE = p.axis === 'x' && p.openE;
    const wb = 0.32;
    const xa = oW ? X0 : X0 - wb, xb = oE ? X1 : X1 + wb;
    B.boxes.push({ min: [xa, minY - 0.4, Z0 - wb], max: [xb, 0, Z0] });
    B.boxes.push({ min: [xa, minY - 0.4, Z1], max: [xb, 0, Z1 + wb] });
    if (!oW) B.boxes.push({ min: [X0 - wb, minY - 0.4, Z0], max: [X0, 0, Z1] });
    if (!oE) B.boxes.push({ min: [X1, minY - 0.4, Z0], max: [X1 + wb, 0, Z1] });
    // ---------------- coping ----------------
    B.trim.setTint(WHITE);
    B.trim.sweepRect(X0, Z0, X1, Z1, 0, COPING, true, { W: oW, E: oE });
    const cw = COPING_W, ch = COPING_H;
    const ca = oW ? X0 : X0 - cw, cb = oE ? X1 : X1 + cw;
    B.boxes.push({ min: [ca, 0, Z0 - cw], max: [cb, ch, Z0], kind: 'coping' });
    B.boxes.push({ min: [ca, 0, Z1], max: [cb, ch, Z1 + cw], kind: 'coping' });
    if (!oW) B.boxes.push({ min: [X0 - cw, 0, Z0], max: [X0, ch, Z1], kind: 'coping' });
    if (!oE) B.boxes.push({ min: [X1, 0, Z0], max: [X1 + cw, ch, Z1], kind: 'coping' });
  }

  // ---------------- depth markers on the coping ----------------
  if (!p.room && B.sign && p.kind !== 'spa' && p.kind !== 'canal') {
    const kShallow = p.kind === 'wading' ? SIGN.DEPTH_WADE : SIGN.DEPTH_SHALLOW;
    const kDeep = p.kind === 'deep' ? SIGN.DEPTH_DEEP : p.kind === 'lap' ? SIGN.DEPTH_LAP : SIGN.DEPTH_WADE;
    const y = COPING_H + 0.0025;
    for (const [t, sg] of [[-0.13 / A, 1], [1 + 0.13 / A, -1]]) {
      const f = [tdir[0] * sg, 0, tdir[2] * sg]; // reader faces the water
      const r = [-f[2] * 0.15, 0, f[0] * 0.15], u = [f[0] * 0.075, 0, f[2] * 0.075];
      for (const [sm, k] of [[0.6, kShallow], [L - 0.6, kDeep]]) signQuad(B.sign, k, W(sm, t, y), r, u, [0, 1, 0]);
    }
    if (p.steps > 0) {
      const f = sdir;
      signQuad(B.sign, SIGN.NO_DIVING, W(-0.13, 0.5, y), [-f[2] * 0.2, 0, f[0] * 0.2], [f[0] * 0.1, 0, f[2] * 0.1], [0, 1, 0]);
    }
  }

  // ---------------- lane lines & end-wall targets ----------------
  if (p.lanes.length && p.kind !== 'spa') {
    const sa = p.run + 1.2, sb = L - 1.9;
    for (const tl of p.lanes) {
      const hw = 0.13 / A;
      M.setTint(TINT_LANE);
      if (sb > sa) {
        const nu = Math.max(2, Math.round((sb - sa) / seg));
        M.param(nu, 1, (fu, fv) => {
          const s = sa + (sb - sa) * fu, t = tl - hw + 2 * hw * fv;
          const y = F(s, t) + 0.004;
          const [x, , z] = W(s, t, y);
          return [x, y, z, 0, 1, 0, x, z];
        });
        // T-bar at the deep end
        const tw = 0.5 / A;
        M.param(2, 1, (fu, fv) => {
          const s = sb + 0.26 * fv, t = tl - tw + 2 * tw * fu;
          const y = F(s, t) + 0.004;
          const [x, , z] = W(s, t, y);
          return [x, y, z, 0, 1, 0, x, z];
        });
      }
      // target cross on the far end wall
      const n = [-sdir[0], 0, -sdir[2]];
      const sW = L - 0.004;
      const yb = F(L) + 0.35, yt = -0.42;
      if (yt > yb + 0.2) {
        M.param(1, 2, (fu, fv) => { const t = tl - hw + 2 * hw * fu, y = yb + (yt - yb) * fv; const [x, , z] = W(sW, t, y); return [x, y, z, n[0], 0, n[2], t * A, y]; });
        const tw = 0.3 / A, yc = yt - 0.18;
        M.param(2, 1, (fu, fv) => { const t = tl - tw + 2 * tw * fu, y = yc - 0.13 + 0.26 * fv; const [x, , z] = W(sW - 0.001, t, y); return [x, y, z, n[0], 0, n[2], t * A, y]; });
      }
    }
  }

  // ---------------- lamps ----------------
  for (const lp of p.lights) {
    const t = lp.side < 0 ? 0 : 1;
    const nIn = lp.side < 0 ? [tdir[0], 0, tdir[2]] : [-tdir[0], 0, -tdir[2]];
    const fl = p.kind === 'spa' ? -0.25 : F(lp.s, t);
    const y = Math.min(-0.3, Math.max(fl + 0.35, Math.max(-0.85, fl * 0.5)));
    const [x, , z] = W(lp.s, t, y);
    const m = frameAt(x, y, z, nIn);
    B.chrome.lathe([[0.0, -0.002], [0.13, -0.002], [0.15, 0.004], [0.152, 0.012], [0.14, 0.02], [0.118, 0.022]], 24, m);
    B.lamp.lathe([[0.118, 0.016], [0.09, 0.024], [0.05, 0.029], [0.0, 0.03]], 24, m);
    B.lamps.push({ x: x + nIn[0] * 0.12, y, z: z + nIn[2] * 0.12, on: (lp.on ?? p.lightsOn) ? 1 : 0, pool: p });
  }

  // ---------------- main drains ----------------
  for (const d of p.drains) {
    const s = d.s, t = d.t;
    for (const off of p.kind === 'spa' ? [0] : [-0.32, 0.32]) {
      const tt = t + off / A;
      const y = (p.kind === 'spa' ? p.shallowY : F(s, tt)) + 0.003;
      const [x, , z] = W(s, tt, y);
      drainGrate(B, x, y, z, 0.17, p.axis);
    }
  }

  // ---------------- handrails at the stairs ----------------
  if (p.steps > 0) {
    const ts = A > 2.2 ? [0.32 / A, 1 - 0.32 / A] : [0.5];
    for (const t of ts) {
      const pts = [];
      const add = (s, y) => { const [x, , z] = W(s, t, y); pts.push(new THREE.Vector3(x, y, z)); };
      if (p.room) { add(0.12, -RISE + 0.02); add(0.12, 0.6); add(0.15, 0.82); add(0.24, 0.9 - RISE * 0.6); }
      else { add(-0.5, 0.0); add(-0.5, 0.55); add(-0.47, 0.82); add(-0.36, 0.93); add(-0.18, 0.95); }
      const nT = p.steps - 1;
      for (let k = p.room ? 1 : 0; k <= nT; k++) add(k * TREAD + 0.05, 0.9 - k * RISE);
      add(p.run + 0.22, p.shallowY + 0.78); add(p.run + 0.36, p.shallowY + 0.5); add(p.run + 0.38, p.shallowY + 0.02);
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      B.chrome.tube(curve.getPoints(48), 0.022, 10, true);
      // deck escutcheon
      const [ex, , ez] = W(p.room ? 0.12 : -0.5, t, 0);
      const ey = p.room ? -RISE : 0;
      B.chrome.lathe([[0, 0.012], [0.04, 0.012], [0.05, 0.004], [0.05, 0]].reverse(), 16, new THREE.Matrix4().makeTranslation(ex, ey, ez));
      B.boxes.push({ min: [ex - 0.04, ey, ez - 0.04], max: [ex + 0.04, 0.95, ez + 0.04], kind: 'rail' });
    }
  }

  // ---------------- ladders ----------------
  for (const ld of p.ladders) {
    const t = ld.side < 0 ? 0 : 1;
    const nIn = ld.side < 0 ? tdir : [-tdir[0], 0, -tdir[2]];
    const fl = F(ld.s, t);
    const base = W(ld.s, t, 0);
    const rails = [];
    for (const ds of [-0.25, 0.25]) {
      const pts = [];
      const add = (o, y) => {
        const s = ld.s + ds;
        const [x, , z] = W(s, t, y);
        pts.push(new THREE.Vector3(x + nIn[0] * o, y, z + nIn[2] * o));
      };
      add(0.04, fl + 0.32); add(0.1, fl + 0.45); add(0.14, fl + 0.7); add(0.14, -0.2); add(0.14, 0.45); add(0.12, 0.78);
      add(0.02, 0.93); add(-0.12, 0.96); add(-0.26, 0.86); add(-0.32, 0.62); add(-0.33, 0.04);
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      B.chrome.tube(curve.getPoints(40), 0.021, 10, true);
      rails.push(pts);
      const [ex, , ez] = W(ld.s + ds, t, 0);
      const exx = ex - nIn[0] * 0.33, ezz = ez - nIn[2] * 0.33;
      B.chrome.lathe([[0.05, 0], [0.05, 0.004], [0.04, 0.012], [0, 0.012]], 16, new THREE.Matrix4().makeTranslation(exx, 0, ezz));
    }
    // treads
    const yTop = -0.32;
    for (let y = yTop; y > fl + 0.45; y -= 0.3) {
      const [x, , z] = W(ld.s, t, y);
      const cxp = x + nIn[0] * 0.13, czp = z + nIn[2] * 0.13;
      const along = p.axis === 'x' ? 'x' : 'z';
      const hx = along === 'x' ? 0.25 : 0.045, hz = along === 'x' ? 0.045 : 0.25;
      B.chrome.box(new THREE.Vector3(cxp - hx, y - 0.018, czp - hz), new THREE.Vector3(cxp + hx, y + 0.018, czp + hz));
    }
    // climbing device + collider
    const top = W(ld.s, t, 0);
    const deckPos = [top[0] - nIn[0] * 0.75, 0.02, top[2] - nIn[2] * 0.75];
    const poolPos = [top[0] + nIn[0] * 0.55, Math.max(fl, WATER_Y - 1.1) + 0.02, top[2] + nIn[2] * 0.55];
    const c0 = [top[0] + nIn[0] * 0.12, (fl + 0.9) / 2, top[2] + nIn[2] * 0.12];
    const hAlong = 0.32, hIn = 0.1, hy = (0.9 - fl) / 2;
    B.ladders.push({
      id: `ladder:${Math.round(top[0] * 10)},${Math.round(top[2] * 10)}`,
      center: c0, half: p.axis === 'x' ? [hAlong, hy, hIn] : [hIn, hy, hAlong],
      deck: deckPos, pool: poolPos, yawOut: Math.atan2(nIn[0], nIn[2]), yawIn: Math.atan2(-nIn[0], -nIn[2]),
    });
    void base; void rails;
  }

  // ---------------- rope line with floats ----------------
  if (p.rope) {
    const s = p.rope.s;
    const pts = [];
    const n = Math.max(6, Math.round(A / 0.22));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const e = Math.min(t, 1 - t) * A; // distance from the nearest wall
      const y = WATER_Y + 0.012 + Math.max(0, 0.07 - e * 0.25) * 0;
      const [x, , z] = W(s, t, y);
      pts.push(new THREE.Vector3(x, y, z));
    }
    // anchors on the coping
    const a0 = W(s, -0.12 / A, COPING_H + 0.01), a1 = W(s, 1 + 0.12 / A, COPING_H + 0.01);
    const rope = [new THREE.Vector3(...a0), ...pts, new THREE.Vector3(...a1)];
    B.rope.tube(new THREE.CatmullRomCurve3(rope, false, 'centripetal').getPoints(n * 3), 0.009, 6, true);
    for (const a of [a0, a1]) B.chrome.lathe([[0.03, -0.01], [0.03, 0.0], [0.024, 0.012], [0, 0.014]], 12, new THREE.Matrix4().makeTranslation(a[0], a[1] - 0.004, a[2]));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const [x, , z] = W(s, t, WATER_Y + 0.012);
      B.floats.push({ x, y: WATER_Y + 0.012, z, axis: p.axis === 'x' ? 'z' : 'x', c: k % 4 < 2 ? 0 : 1 });
    }
  }
}

// --- helpers ---------------------------------------------------------------
function stripS(M, W, s0, s1, t0, t1, yf, n, A) {
  const nu = Math.max(1, Math.round(A / 0.6));
  M.param(nu, 1, (fu, fv) => {
    const t = t0 + (t1 - t0) * fu, s = s0 + (s1 - s0) * fv;
    const y = yf(s, t);
    const [x, , z] = W(s, t, y);
    return [x, y, z, n[0], n[1], n[2], x, z];
  });
}

function riser(M, W, s, y0, y1, sdir, A) {
  if (y1 - y0 < 1e-4) return;
  const nu = Math.max(1, Math.round(A / 0.6));
  M.param(nu, 1, (fu, fv) => {
    const y = y0 + (y1 - y0) * fv;
    const [x, , z] = W(s, fu, y);
    return [x, y, z, sdir[0], 0, sdir[2], fu * A, y];
  });
}

// axis-aligned box under a tread / flat floor section between s0..s1 (full width)
function stBox(W, s0, s1, yTop, yBot) {
  const a = W(s0, 0, 0), b = W(s1, 1, 0);
  return { min: [Math.min(a[0], b[0]), yBot, Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), yTop, Math.max(a[2], b[2])] };
}

// rotated box following the slope between s=a (height ya) and s=b (height yb)
function slopeBox(p, W, a, b, ya, yb, A, sdir) {
  const th = 0.4;
  const len = Math.hypot(b - a, yb - ya);
  const ang = Math.atan2(yb - ya, b - a); // rise along +s
  const mid = W((a + b) / 2, 0.5, (ya + yb) / 2);
  // centre sits half a thickness below the surface (perpendicular to it)
  const ny = Math.cos(ang), ns = -Math.sin(ang);
  const cx = mid[0] - sdir[0] * ns * th / 2, cz = mid[2] - sdir[2] * ns * th / 2, cy = mid[1] - ny * th / 2;
  const q = new THREE.Quaternion();
  if (p.axis === 'x') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang * p.dir);
  else q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang * p.dir);
  const half = p.axis === 'x' ? [len / 2 + 0.02, th / 2, A / 2] : [A / 2, th / 2, len / 2 + 0.02];
  return { center: [cx, cy, cz], half, q: [q.x, q.y, q.z, q.w] };
}

// local frame on a wall: origin (x,y,z), local +Y = outward normal n (lathe axis)
function frameAt(x, y, z, n) {
  const up = new THREE.Vector3(n[0], n[1], n[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
}

// square drain grate lying on a surface at height y (dark pit + chrome frame + bars)
export function drainGrate(B, x, y, z, h, axis = 'x', recess = false) {
  const vd = B.void;
  if (recess) {
    vd.hface(y - 0.07, 1, x - h, x + h, z - h, z + h);
    vd.vface('x', x - h, 1, z - h, z + h, y - 0.07, y);
    vd.vface('x', x + h, -1, z - h, z + h, y - 0.07, y);
    vd.vface('z', z - h, 1, x - h, x + h, y - 0.07, y);
    vd.vface('z', z + h, -1, x - h, x + h, y - 0.07, y);
  } else vd.hface(y + 0.0015, 1, x - h, x + h, z - h, z + h);
  const C = B.chrome;
  const fw = 0.022, fy0 = y - (recess ? 0.004 : -0.002), fy1 = y + 0.006;
  C.box(_box(x - h - fw, fy0, z - h - fw), _box(x + h + fw, fy1, z - h));
  C.box(_box(x - h - fw, fy0, z + h), _box(x + h + fw, fy1, z + h + fw));
  C.box(_box(x - h - fw, fy0, z - h), _box(x - h, fy1, z + h));
  C.box(_box(x + h, fy0, z - h), _box(x + h + fw, fy1, z + h));
  const nb = 6;
  for (let k = 1; k < nb; k++) {
    const f = -h + (2 * h * k) / nb;
    if (axis === 'x') C.box(_box(x + f - 0.007, fy0, z - h), _box(x + f + 0.007, fy1 - 0.001, z + h));
    else C.box(_box(x - h, fy0, z + f - 0.007), _box(x + h, fy1 - 0.001, z + f + 0.007));
  }
}
function _box(x, y, z) { return new THREE.Vector3(x, y, z); }

// Water-surface geometry for a pool (y = WATER_Y), with aFloorY per vertex
export function poolWaterQuads(Wm, p, ox, oz, infectAt = null) {
  const { X0, Z0, X1, Z1 } = poolRect(p, ox, oz);
  const nx = Math.max(2, Math.round((X1 - X0) / 0.5)), nz = Math.max(2, Math.round((Z1 - Z0) / 0.5));
  const base = Wm.pos.length / 3;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = X0 + ((X1 - X0) * i) / nx, z = Z0 + ((Z1 - Z0) * j) / nz;
      let fy;
      if (p.kind === 'spa') {
        const e = Math.min(x - X0, X1 - x, z - Z0, Z1 - z);
        fy = e < 0.45 ? -0.25 : p.shallowY;
      } else {
        const sOf = p.axis === 'x' ? (p.dir > 0 ? x - X0 : X1 - x) : (p.dir > 0 ? z - Z0 : Z1 - z);
        const t = p.axis === 'x' ? (z - Z0) / (Z1 - Z0) : (x - X0) / (X1 - X0);
        fy = poolFloorAt(p, Math.min(p.L - 1e-3, Math.max(0, sOf)), t);
      }
      Wm.pos.push(x, WATER_Y, z);
      Wm.floor.push(fy);
      Wm.inf?.push(infectAt ? infectAt(x, z) : (p.infected ? 1 : 0));
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    Wm.idx.push(a, c, b, b, c, d);
  }
}
