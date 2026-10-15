// Geometry kit for Level 0's weird rooms: floor pits, playground slides (straight chutes and spiral flumes swept
// along a path), steel stairs, pipe railings and the ball-pit fill. Everything writes into EnvGeo builders (merged,
// baked by the room's GridBaker) and returns static collider descriptors ({type:'box', size, pos, rot}) that the
// caller adds to one static body. Slides also return their walking segments for the slide physics
// (level.waterMotion pushes clones down them).
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// rotated box collider from a centre and a right-handed orthonormal basis (u: x, v: y, w: z = u x v) with half sizes
export function boxCol(c, u, v, w, hu, hv, hw) {
  _m.makeBasis(_a.set(u[0], u[1], u[2]), _b.set(v[0], v[1], v[2]), _c.set(w[0], w[1], w[2]));
  _q.setFromRotationMatrix(_m);
  _e.setFromQuaternion(_q, 'XYZ');
  return { type: 'box', size: [hu * 2, hv * 2, hw * 2], pos: [c[0], c[1], c[2]], rot: [_e.x, _e.y, _e.z] };
}
export const aabbCol = (x0, y0, z0, x1, y1, z1) => ({ type: 'box', size: [x1 - x0, y1 - y0, z1 - z0], pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] });

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// frames along a path: tangent t, side s (horizontal, to the right of travel), up n = s x t (towards the opening)
export function pathFrames(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = norm(sub(b, a));
    let s = norm(cross(t, [0, 1, 0]));
    if (!isFinite(s[0])) s = [1, 0, 0];
    const n = norm(cross(s, t));
    out.push({ p: pts[i], t, s, n });
  }
  return out;
}

// sweep a 2D profile [[u, v], ...] (u along s, v along n) along framed points; outward normals of the
// polyline are taken towards `inside` = false (the trough's inner face is the front for the slide bed)
// uvLen: texture metres along the path
export function sweep(g, frames, profile, flip = false) {
  const n = profile.length;
  let len = 0;
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) len += Math.hypot(...sub(frames[i].p, frames[i - 1].p));
    const F = frames[i];
    const cx = F.p[0], cy = F.p[1], cz = F.p[2];
    g.autoCell(cx, cz, 0, 0);
    for (let k = 0; k < n; k++) {
      const [u, v] = profile[k];
      // 2D normal of the profile segment around vertex k (perpendicular in (u, v))
      const a = profile[Math.max(0, k - 1)], c = profile[Math.min(n - 1, k + 1)];
      let du = c[0] - a[0], dv = c[1] - a[1];
      const l = Math.hypot(du, dv) || 1; du /= l; dv /= l;
      let nu = dv, nv = -du;
      if (flip) { nu = -nu; nv = -nv; }
      const x = cx + F.s[0] * u + F.n[0] * v, y = cy + F.s[1] * u + F.n[1] * v, z = cz + F.s[2] * u + F.n[2] * v;
      const nx = F.s[0] * nu + F.n[0] * nv, ny = F.s[1] * nu + F.n[1] * nv, nz = F.s[2] * nu + F.n[2] * nv;
      g.v(x, y, z, nx, ny, nz, len, k / (n - 1) * 1.2);
    }
  }
  const base = g.vc - frames.length * n;
  for (let i = 0; i < frames.length - 1; i++) for (let k = 0; k < n - 1; k++) {
    const a = base + i * n + k, b = a + 1, c = a + n, d = c + 1;
    if (!flip) { g.tri(a, c, d); g.tri(a, d, b); } else { g.tri(a, d, c); g.tri(a, b, d); }
  }
}

// open slide trough cross-section: bed + side walls with rolled lips (u: across, v: up from the bed surface)
export function troughProfile(w = 0.62, wall = 0.32, r = 0.05) {
  const hw = w / 2, pts = [];
  // outer lip (right) -> right wall -> bed -> left wall -> left lip, inner surface; a second pass is the outside
  pts.push([hw + 0.03, wall], [hw + 0.03, wall - 0.03], [hw, wall - 0.02]);
  for (let k = 0; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; pts.push([hw - r + Math.cos(a) * r, r - Math.sin(a) * r]); }
  for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 + (k / 4) * Math.PI / 2; pts.push([-hw + r + Math.cos(a) * r, r - Math.sin(a) * r]); }
  pts.push([-hw, wall - 0.02], [-hw - 0.03, wall - 0.03], [-hw - 0.03, wall]);
  return pts;
}
// the underside / outside of the trough (same outline pushed out by the shell thickness)
export function troughShell(w = 0.62, wall = 0.32, t = 0.035) {
  const hw = w / 2 + t;
  return [[hw, wall], [hw, -t + 0.04], [hw - 0.04, -t], [-hw + 0.04, -t], [-hw, -t + 0.04], [-hw, wall]];
}

// sample a centre line: fn(t) -> [x, y, z], n segments
export function samplePath(fn, n) { const out = []; for (let i = 0; i <= n; i++) out.push(fn(i / n)); return out; }

// Build a slide along a centre line (points at the bed surface). gBed: bright plastic, gShell: same or darker.
// Returns { cols: [...], segs: [{ax, ay, az, bx, by, bz, hw, last?}] }
export function slide(gBed, gShell, pts, o = {}) {
  const w = o.w ?? 0.62, wall = o.wall ?? 0.32;
  const frames = pathFrames(pts);
  sweep(gBed, frames, troughProfile(w, wall), false);
  sweep(gShell, frames, troughShell(w, wall), true);
  const cols = [], segs = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const A = frames[i], B = frames[i + 1];
    const d = sub(B.p, A.p), L = Math.hypot(...d);
    const t = norm(d), s = norm(cross(t, [0, 1, 0])), n = norm(cross(s, t));
    const tb = [-t[0], -t[1], -t[2]]; // (s, n, -t) is right-handed
    const mid = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2, (A.p[2] + B.p[2]) / 2];
    // bed slab under the surface + the two walls
    const bc = [mid[0] - n[0] * 0.06, mid[1] - n[1] * 0.06, mid[2] - n[2] * 0.06];
    cols.push(boxCol(bc, s, n, tb, w / 2 + 0.04, 0.06, L / 2 + 0.02));
    for (const sg of [-1, 1]) {
      const wc = [mid[0] + s[0] * sg * (w / 2 + 0.02) + n[0] * wall / 2, mid[1] + s[1] * sg * (w / 2 + 0.02) + n[1] * wall / 2, mid[2] + s[2] * sg * (w / 2 + 0.02) + n[2] * wall / 2];
      cols.push(boxCol(wc, s, n, tb, 0.025, wall / 2 + 0.04, L / 2 + 0.02));
    }
    segs.push({ ax: A.p[0], ay: A.p[1], az: A.p[2], bx: B.p[0], by: B.p[1], bz: B.p[2], hw: w / 2 });
  }
  // the run-out: the push continues a little past the chute's end so clones launch off it instead of stopping on the lip
  if (segs.length) segs[segs.length - 1].last = true;
  return { cols, segs };
}

// Pit: inward walls from -depth to 0 around a world rect, the floor, a rounded coping around the rim.
// gWall / gFloor / gRim builders; returns colliders (walls + floor slab at floorCol).
export function pit(gWall, gFloor, gRim, r, depth, floorCol = -depth) {
  const { x0, z0, x1, z1 } = r, y0 = -depth;
  gWall.ao = 0.85;
  gWall.rectOriented([[x0, y0, z0], [x1, y0, z0], [x1, 0, z0], [x0, 0, z0]], [0, 0, 1], (x, y) => [x, y]);
  gWall.rectOriented([[x0, y0, z1], [x1, y0, z1], [x1, 0, z1], [x0, 0, z1]], [0, 0, -1], (x, y) => [x, y]);
  gWall.rectOriented([[x0, y0, z0], [x0, y0, z1], [x0, 0, z1], [x0, 0, z0]], [1, 0, 0], (x, y, z) => [z, y]);
  gWall.rectOriented([[x1, y0, z0], [x1, y0, z1], [x1, 0, z1], [x1, 0, z0]], [-1, 0, 0], (x, y, z) => [z, y]);
  gWall.ao = 1;
  if (gFloor) {
    gFloor.ao = 0.8;
    gFloor.grid([x0, y0, z1], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)], [0, 1, 0], [0, 0.5, 1], [0, 0.5, 1], (x, y, z) => [x, z]);
    gFloor.ao = 1;
  }
  if (gRim) {
    const e = 0.05, h = 0.02;
    gRim.ao = 1;
    gRim.box(x0 - e, 0, z0 - e, x1 + e, h, z0 + e, { ny: true });
    gRim.box(x0 - e, 0, z1 - e, x1 + e, h, z1 + e, { ny: true });
    gRim.box(x0 - e, 0, z0 + e, x0 + e, h, z1 - e, { ny: true, pz: true, nz: true });
    gRim.box(x1 - e, 0, z0 + e, x1 + e, h, z1 - e, { ny: true, pz: true, nz: true });
  }
  const t = 0.3, cols = [];
  cols.push(aabbCol(x0 - t, y0 - 0.5, z0 - t, x0, 0, z1 + t));
  cols.push(aabbCol(x1, y0 - 0.5, z0 - t, x1 + t, 0, z1 + t));
  cols.push(aabbCol(x0, y0 - 0.5, z0 - t, x1, 0, z0));
  cols.push(aabbCol(x0, y0 - 0.5, z1, x1, 0, z1 + t));
  cols.push(aabbCol(x0, floorCol - 0.5, z0, x1, floorCol, z1));
  return cols;
}

// steel stair along +dir (unit [dx, dz]) from a bottom point (x, z, yBottom) rising `rise` in n steps; width w.
export function stair(gTread, gFrame, x, z, yB, rise, n, dir, w = 0.9, run = 0.3) {
  const cols = [];
  const [dx, dz] = dir, sx = -dz, sz = dx; // side vector
  const h = rise / n;
  for (let k = 0; k < n; k++) {
    const y = yB + (k + 1) * h;
    const c0 = [x + dx * k * run, z + dz * k * run], c1 = [x + dx * (k + 1) * run, z + dz * (k + 1) * run];
    const ax = Math.min(c0[0], c1[0], c0[0] + sx * w, c1[0] + sx * w), bx = Math.max(c0[0], c1[0], c0[0] + sx * w, c1[0] + sx * w);
    const az = Math.min(c0[1], c1[1], c0[1] + sz * w, c1[1] + sz * w), bz = Math.max(c0[1], c1[1], c0[1] + sz * w, c1[1] + sz * w);
    gTread.ao = 1;
    gTread.box(ax, y - 0.03, az, bx, y, bz, {}, 0);
    cols.push(aabbCol(ax, y - h, az, bx, y, bz));
  }
  // stringers: two sloped plates
  const L = run * n;
  for (const off of [0, w]) {
    const bx = x + sx * off, bz = z + sz * off;
    const A = [bx, yB, bz], B = [bx + dx * L, yB + rise, bz + dz * L];
    const t = norm(sub(B, A)), s = [sx, 0, sz], nn = norm(cross(s, t));
    const c = [(A[0] + B[0]) / 2 - nn[0] * 0.08, (A[1] + B[1]) / 2 - nn[1] * 0.08, (A[2] + B[2]) / 2 - nn[2] * 0.08];
    gFrame.orientedBox(c, t, nn, s, Math.hypot(...sub(B, A)) / 2 + 0.05, 0.12, 0.012);
  }
  return cols;
}

// pipe railing along a polyline (posts every ~1 m, top rail at h, mid rail at h/2). Returns colliders.
export function railing(g, pts, h = 1.0, r = 0.022) {
  const cols = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const n = Math.max(1, Math.round(L / 1.0));
    for (let k = 0; k <= n; k++) {
      if (k === n && i < pts.length - 2) continue;
      const x = A[0] + (B[0] - A[0]) * k / n, z = A[2] + (B[2] - A[2]) * k / n;
      g.tube('y', A[1], A[1] + h, x, z, r, 8);
    }
    for (const y of [h, h * 0.5]) g.tubePath([[A[0], A[1] + y, A[2]], [B[0], B[1] + y, B[2]]], r * (y === h ? 1.15 : 0.8), 8);
    const x0 = Math.min(A[0], B[0]) - 0.03, x1 = Math.max(A[0], B[0]) + 0.03, z0 = Math.min(A[2], B[2]) - 0.03, z1 = Math.max(A[2], B[2]) + 0.03;
    cols.push(aabbCol(x0, A[1], z0, x1, A[1] + h + 0.03, z1));
  }
  return cols;
}

// ball-pit fill texture: packed glossy plastic balls, seen from above (tileable)
let _ballTex = null;
export function ballTexture() {
  if (_ballTex) return _ballTex;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1414'; g.fillRect(0, 0, S, S);
  const cols = ['#d8322a', '#2a62c8', '#f2c21a', '#2fa84a', '#e86ab0', '#f07a1a'];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const R = 22;
  for (let k = 0; k < 900; k++) {
    const x = rnd() * S, y = rnd() * S, r = R * (0.85 + rnd() * 0.3);
    const col = cols[Math.floor(rnd() * cols.length)];
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const cx = x + ox, cy = y + oy;
      if (cx < -r || cx > S + r || cy < -r || cy > S + r) continue;
      const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, col); gr.addColorStop(0.85, col); gr.addColorStop(1, '#0e0a0a');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
  }
  _ballTex = new THREE.CanvasTexture(c);
  _ballTex.colorSpace = THREE.SRGBColorSpace;
  _ballTex.wrapS = _ballTex.wrapT = THREE.RepeatWrapping;
  _ballTex.anisotropy = 4;
  return _ballTex;
}
