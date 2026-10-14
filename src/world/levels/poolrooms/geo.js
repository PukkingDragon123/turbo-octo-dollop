// Geometry toolkit for the Poolrooms: an indexed mesh accumulator with per-vertex tint / wetness
// and the architectural primitives the level is built from (faces with rectangular openings,
// rounded prisms, coves, bullnose edges, round arches, groin vaults, tubes, lathes, profile sweeps).
// UVs are in meters (world-aligned planar for flat surfaces, arc length for curved ones) so the
// tile textures line up across every surface.
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class Mesher {
  constructor(opts = {}) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.tint = [];
    this.wet = opts.wet ? [] : null;
    this.extra = opts.extra ? [] : null; // optional float attribute (e.g. caustic hint)
    this.idx = [];
    this.vcount = 0;
    this.t = [1, 1, 1];
    this.w = 0;
    this.e = 0;
    this.maxSeg = opts.seg ?? 0.75; // subdivision length for lighting resolution
  }

  setTint(r, g, b) { if (Array.isArray(r)) this.t = r; else this.t = [r, g ?? r, b ?? r]; return this; }
  setWet(w) { this.w = w; return this; }
  setExtra(e) { this.e = e; return this; }
  isEmpty() { return this.vcount === 0; }

  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.tint.push(this.t[0], this.t[1], this.t[2]);
    if (this.wet) this.wet.push(this.w);
    if (this.extra) this.extra.push(this.e);
    return this.vcount++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  // generic grid: origin o, axis vectors a (u) and b (v), normal n; uvFn(p, fu, fv) -> [u,v]
  grid(o, a, b, n, nu, nv, uvFn, wetFn = null) {
    const base = this.vcount;
    const p = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        p.copy(o).addScaledVector(a, i / nu).addScaledVector(b, j / nv);
        const uv = uvFn(p, i / nu, j / nv);
        if (wetFn && this.wet) this.w = wetFn(p);
        this.vert(p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1]);
      }
    }
    const cross = _a.crossVectors(a, b);
    const flip = cross.dot(n) < 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k0 = base + j * (nu + 1) + i, k1 = k0 + 1, k2 = k0 + (nu + 1), k3 = k2 + 1;
        if (!flip) this.idx.push(k0, k1, k3, k0, k3, k2);
        else this.idx.push(k0, k3, k1, k0, k2, k3);
      }
    }
  }

  segs(len) { return Math.max(1, Math.round(Math.abs(len) / this.maxSeg)); }

  // Parametric grid with automatic winding: fn(fu, fv) -> [x,y,z, nx,ny,nz, u,v]
  param(nu, nv, fn) {
    const base = this.vcount;
    const P = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const r = fn(i / nu, j / nv);
        P.push(r);
        this.vert(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]);
      }
    }
    // decide winding from the quad with the largest area
    let flip = false, best = -1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = P[j * (nu + 1) + i], b = P[j * (nu + 1) + i + 1], c = P[(j + 1) * (nu + 1) + i];
      _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      _n.crossVectors(_a, _b);
      const ar = _n.length();
      if (ar > best) { best = ar; flip = _n.x * a[3] + _n.y * a[4] + _n.z * a[5] < 0; }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k0 = base + j * (nu + 1) + i, k1 = k0 + 1, k2 = k0 + (nu + 1), k3 = k2 + 1;
        if (!flip) this.idx.push(k0, k1, k3, k0, k3, k2);
        else this.idx.push(k0, k3, k1, k0, k2, k3);
      }
    }
  }

  // single quad with automatic winding (p: 4 points [x,y,z] in order around the quad)
  quad(p, n, uv) {
    const base = this.vcount;
    for (let k = 0; k < 4; k++) this.vert(p[k][0], p[k][1], p[k][2], n[0], n[1], n[2], uv[k][0], uv[k][1]);
    _a.set(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    _b.set(p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]);
    _n.crossVectors(_a, _b);
    if (_n.x * n[0] + _n.y * n[1] + _n.z * n[2] >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  // Vertical face in plane x = d (axis 'x') or z = d (axis 'z'); spans u (z resp. x) in [u0,u1] and y in [y0,y1].
  // side = +1/-1 sign of the normal along the axis. holes: [{u0,u1,y0,y1}] (rectangles cut out).
  vface(axis, d, side, u0, u1, y0, y1, holes = null, uvOff = 0) {
    if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return;
    const us = [u0, u1], ys = [y0, y1];
    if (holes) for (const h of holes) {
      if (h.u0 > u0 && h.u0 < u1) us.push(h.u0);
      if (h.u1 > u0 && h.u1 < u1) us.push(h.u1);
      if (h.y0 > y0 && h.y0 < y1) ys.push(h.y0);
      if (h.y1 > y0 && h.y1 < y1) ys.push(h.y1);
    }
    us.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const n = axis === 'x' ? new THREE.Vector3(side, 0, 0) : new THREE.Vector3(0, 0, side);
    for (let a = 0; a < us.length - 1; a++) {
      const ua = us[a], ub = us[a + 1];
      if (ub - ua < 1e-4) continue;
      for (let b = 0; b < ys.length - 1; b++) {
        const ya = ys[b], yb = ys[b + 1];
        if (yb - ya < 1e-4) continue;
        if (holes && holes.some((h) => ua >= h.u0 - 1e-5 && ub <= h.u1 + 1e-5 && ya >= h.y0 - 1e-5 && yb <= h.y1 + 1e-5)) continue;
        this._vrect(axis, d, n, ua, ub, ya, yb, uvOff);
      }
    }
  }

  _vrect(axis, d, n, ua, ub, ya, yb, uvOff = 0) {
    const nu = this.segs(ub - ua), nv = this.segs(yb - ya);
    let o, A, B;
    if (axis === 'x') { o = new THREE.Vector3(d, ya, ua); A = new THREE.Vector3(0, 0, ub - ua); B = new THREE.Vector3(0, yb - ya, 0); }
    else { o = new THREE.Vector3(ua, ya, d); A = new THREE.Vector3(ub - ua, 0, 0); B = new THREE.Vector3(0, yb - ya, 0); }
    const uvF = axis === 'x' ? (p) => [p.z + uvOff, p.y] : (p) => [p.x + uvOff, p.y];
    this.grid(o, A, B, n, nu, nv, uvF);
  }

  // Horizontal face at height y (normal up if side>0, down if side<0) over [x0,x1]x[z0,z1] minus holes [{x0,x1,z0,z1}]
  hface(y, side, x0, x1, z0, z1, holes = null, wetFn = null) {
    if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) return;
    const xs = [x0, x1], zs = [z0, z1];
    if (holes) for (const h of holes) {
      if (h.x0 > x0 && h.x0 < x1) xs.push(h.x0);
      if (h.x1 > x0 && h.x1 < x1) xs.push(h.x1);
      if (h.z0 > z0 && h.z0 < z1) zs.push(h.z0);
      if (h.z1 > z0 && h.z1 < z1) zs.push(h.z1);
    }
    xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
    const n = new THREE.Vector3(0, side, 0);
    for (let a = 0; a < xs.length - 1; a++) {
      const xa = xs[a], xb = xs[a + 1];
      if (xb - xa < 1e-4) continue;
      for (let b = 0; b < zs.length - 1; b++) {
        const za = zs[b], zb = zs[b + 1];
        if (zb - za < 1e-4) continue;
        if (holes && holes.some((h) => xa >= h.x0 - 1e-5 && xb <= h.x1 + 1e-5 && za >= h.z0 - 1e-5 && zb <= h.z1 + 1e-5)) continue;
        this.grid(new THREE.Vector3(xa, y, za), new THREE.Vector3(xb - xa, 0, 0), new THREE.Vector3(0, 0, zb - za), n, this.segs(xb - xa), this.segs(zb - za), (p) => [p.x, p.z], wetFn);
      }
    }
  }

  // axis aligned box (faces skipped via skip.{px,nx,py,ny,pz,nz})
  box(min, max, skip = {}) {
    if (!skip.pz) this.vface('z', max.z, 1, min.x, max.x, min.y, max.y);
    if (!skip.nz) this.vface('z', min.z, -1, min.x, max.x, min.y, max.y);
    if (!skip.px) this.vface('x', max.x, 1, min.z, max.z, min.y, max.y);
    if (!skip.nx) this.vface('x', min.x, -1, min.z, max.z, min.y, max.y);
    if (!skip.py) this.hface(max.y, 1, min.x, max.x, min.z, max.z);
    if (!skip.ny) this.hface(min.y, -1, min.x, max.x, min.z, max.z);
  }

  // Vertical prism with a rounded-rectangle cross section (pillars, free wall ends).
  // r: corner radius, cs: segments per corner; caps: {top, bottom}
  roundPrism(x0, z0, x1, z1, y0, y1, r = 0.05, cs = 4, caps = { top: false, bottom: false }) {
    r = Math.min(r, (x1 - x0) / 2 - 1e-3, (z1 - z0) / 2 - 1e-3);
    const ring = [];
    const corners = [[x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI], [x1 - r, z0 + r, Math.PI * 1.5]];
    for (const [cx, cz, a0] of corners) {
      for (let k = 0; k <= cs; k++) {
        const a = a0 + (k / cs) * (Math.PI / 2);
        ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
      }
    }
    this._sweepRing(ring, y0, y1, true);
    if (caps.top) this._capRing(ring, y1, 1);
    if (caps.bottom) this._capRing(ring, y0, -1);
  }

  // ring: [[x,z,nx,nz]] counter-clockwise (seen from +y); emits the side wall between y0 and y1
  _sweepRing(ring, y0, y1, closed) {
    const nv = this.segs(y1 - y0);
    let u = 0;
    const us = [0];
    for (let k = 1; k < ring.length; k++) { u += Math.hypot(ring[k][0] - ring[k - 1][0], ring[k][1] - ring[k - 1][1]); us.push(u); }
    if (closed) us.push(u + Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]));
    const n = ring.length + (closed ? 1 : 0);
    const base = this.vcount;
    for (let j = 0; j <= nv; j++) {
      const y = y0 + ((y1 - y0) * j) / nv;
      for (let k = 0; k < n; k++) {
        const p = ring[k % ring.length];
        this.vert(p[0], y, p[1], p[2], 0, p[3], us[k], y);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let k = 0; k < n - 1; k++) {
        const a = base + j * n + k, b = a + 1, c = a + n, d = c + 1;
        // ring is CCW seen from above -> outward faces need (a, c, b) order
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  _capRing(ring, y, side) {
    let cx = 0, cz = 0;
    for (const p of ring) { cx += p[0]; cz += p[1]; }
    cx /= ring.length; cz /= ring.length;
    const c = this.vert(cx, y, cz, 0, side, 0, cx, cz);
    const base = this.vcount;
    for (const p of ring) this.vert(p[0], y, p[1], 0, side, 0, p[0], p[1]);
    for (let k = 0; k < ring.length; k++) {
      const a = base + k, b = base + ((k + 1) % ring.length);
      if (side > 0) this.idx.push(c, b, a); else this.idx.push(c, a, b);
    }
  }

  // Sweep a 2D profile [[d, y]] (d: lateral offset) along a straight segment from P0 to P1 (horizontal).
  // The lateral direction is `lat` (unit, horizontal). Profile must be ordered so that consecutive
  // points form the surface; outward normals are computed from the profile turned toward +lat/+y.
  sweepLine(P0, P1, lat, profile, miter0 = 0, miter1 = 0, flip = false) {
    const dir = _a.subVectors(P1, P0);
    const len = dir.length();
    dir.normalize();
    const L = new THREE.Vector3(lat.x, 0, lat.z).normalize();
    const base = this.vcount;
    const np = profile.length;
    // profile arc length for v
    const vs = [0];
    for (let k = 1; k < np; k++) vs.push(vs[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    const nu = this.segs(len);
    for (let i = 0; i <= nu; i++) {
      const f = i / nu;
      for (let k = 0; k < np; k++) {
        const [d, y] = profile[k];
        // profile normal (2D): perpendicular to the local tangent
        const kp = Math.max(0, k - 1), kn = Math.min(np - 1, k + 1);
        let tx = profile[kn][0] - profile[kp][0], ty = profile[kn][1] - profile[kp][1];
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        let nd = ty, ny = -tx; // rotate tangent by -90deg
        if (flip) { nd = -nd; ny = -ny; }
        // miters: extend the ends by d * tan(miter)
        const ext = (1 - f) * miter0 * d + f * miter1 * d;
        const s = f * len + ext * (f < 0.5 ? -1 : 1) * (f === 0 || f === 1 ? 1 : 0);
        const px = P0.x + dir.x * s + L.x * d, pz = P0.z + dir.z * s + L.z * d;
        this.vert(px, P0.y + y, pz, L.x * nd, ny, L.z * nd, s + (P0.x + P0.z) * 0, vs[k]);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let k = 0; k < np - 1; k++) {
        const a = base + i * np + k, b = a + 1, c = a + np, d = c + 1;
        if (!flip) this.idx.push(a, c, b, b, c, d); else this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  // Sweep a profile around a closed axis-aligned rectangle [x0,x1]x[z0,z1] (miters at the corners).
  // profile [[d, y]]: d = offset outward from the rectangle. Normals point toward +d / +y side.
  sweepRect(x0, z0, x1, z1, y, profile, flip = false) {
    const np = profile.length;
    const vs = [0];
    for (let k = 1; k < np; k++) vs.push(vs[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    const norms = profile.map((p, k) => {
      const kp = Math.max(0, k - 1), kn = Math.min(np - 1, k + 1);
      let tx = profile[kn][0] - profile[kp][0], ty = profile[kn][1] - profile[kp][1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      return flip ? [-ty, tx] : [ty, -tx];
    });
    // four sides: [start corner, end corner, outward dir]
    const sides = [
      [[x0, z0], [x1, z0], [0, -1]], // north side (z0), outward -z
      [[x1, z0], [x1, z1], [1, 0]],  // east
      [[x1, z1], [x0, z1], [0, 1]],  // south
      [[x0, z1], [x0, z0], [-1, 0]], // west
    ];
    for (const [s0, s1, o] of sides) {
      const base = this.vcount;
      const tx = Math.sign(s1[0] - s0[0]), tz = Math.sign(s1[1] - s0[1]);
      const len = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
      const nu = this.segs(len);
      for (let i = 0; i <= nu; i++) {
        const f = i / nu;
        for (let k = 0; k < np; k++) {
          const d = profile[k][0];
          // corner offset: at the ends move along the side by -d / +d (mitered rectangle offset)
          const along = f * len + (i === 0 ? -d : i === nu ? d : 0);
          const ex = (i === 0 || i === nu) ? 0 : 0;
          const px = s0[0] + tx * along + o[0] * d + ex;
          const pz = s0[1] + tz * along + o[1] * d;
          const [nd, ny] = norms[k];
          this.vert(px, y + profile[k][1], pz, o[0] * nd, ny, o[1] * nd, (s0[0] + s0[1]) * 0 + along + (o[0] ? s0[1] : s0[0]) * 0, vs[k]);
        }
      }
      for (let i = 0; i < nu; i++) {
        for (let k = 0; k < np - 1; k++) {
          const a = base + i * np + k, b = a + 1, c = a + np, d2 = c + 1;
          if (!flip) this.idx.push(a, b, c, b, d2, c); else this.idx.push(a, c, b, b, c, d2);
        }
      }
    }
  }

  // Tube along a polyline (radius r, rs radial segments); caps optional; inward = inner surface
  tube(points, r, rs = 10, caps = true, inward = false) {
    const n = points.length;
    if (n < 2) return;
    const T = [], N = [], B = [];
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const pn = points[Math.min(n - 1, i + 1)], pp = points[Math.max(0, i - 1)];
      T.push(new THREE.Vector3().subVectors(pn, pp).normalize());
    }
    // parallel transport frame
    let up = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    let nrm = new THREE.Vector3().crossVectors(T[0], up).normalize();
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
        const sl = axis.length();
        if (sl > 1e-6) {
          axis.divideScalar(sl);
          const ang = Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1));
          nrm = nrm.clone().applyAxisAngle(axis, ang);
        } else nrm = nrm.clone();
      }
      N.push(nrm);
      B.push(new THREE.Vector3().crossVectors(T[i], nrm).normalize());
    }
    const base = this.vcount;
    let len = 0;
    const sg = inward ? -1 : 1;
    for (let i = 0; i < n; i++) {
      if (i > 0) len += points[i].distanceTo(points[i - 1]);
      for (let k = 0; k <= rs; k++) {
        const a = (k / rs) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const nx = N[i].x * c + B[i].x * s, ny = N[i].y * c + B[i].y * s, nz = N[i].z * c + B[i].z * s;
        this.vert(points[i].x + nx * r, points[i].y + ny * r, points[i].z + nz * r, nx * sg, ny * sg, nz * sg, len, (k / rs) * Math.PI * 2 * r);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < rs; k++) {
        const a = base + i * (rs + 1) + k, b = a + 1, c = a + rs + 1, d = c + 1;
        if (!inward) this.idx.push(a, b, c, b, d, c); else this.idx.push(a, c, b, b, c, d);
      }
    }
    if (inward) return;
    if (caps) {
      for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
        const t = T[i];
        const c = this.vert(points[i].x, points[i].y, points[i].z, t.x * sgn, t.y * sgn, t.z * sgn, 0, 0);
        const b0 = this.vcount;
        for (let k = 0; k <= rs; k++) {
          const a = (k / rs) * Math.PI * 2;
          const cs = Math.cos(a), sn = Math.sin(a);
          const nx = N[i].x * cs + B[i].x * sn, ny = N[i].y * cs + B[i].y * sn, nz = N[i].z * cs + B[i].z * sn;
          this.vert(points[i].x + nx * r, points[i].y + ny * r, points[i].z + nz * r, t.x * sgn, t.y * sgn, t.z * sgn, cs * r, sn * r);
        }
        for (let k = 0; k < rs; k++) {
          if (sgn > 0) this.idx.push(c, b0 + k, b0 + k + 1); else this.idx.push(c, b0 + k + 1, b0 + k);
        }
      }
    }
  }

  // Lathe a profile [[r, y]] around the local Y axis, then transform with matrix m
  lathe(profile, segs, m, arc = Math.PI * 2) {
    const base = this.vcount;
    const np = profile.length;
    const vs = [0];
    for (let k = 1; k < np; k++) vs.push(vs[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    _m3.getNormalMatrix(m);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * arc;
      const c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < np; k++) {
        const [r, y] = profile[k];
        const kp = Math.max(0, k - 1), kn = Math.min(np - 1, k + 1);
        let tr = profile[kn][0] - profile[kp][0], ty = profile[kn][1] - profile[kp][1];
        const tl = Math.hypot(tr, ty) || 1; tr /= tl; ty /= tl;
        const nr = ty, ny = -tr;
        _a.set(c * r, y, s * r).applyMatrix4(m);
        _n.set(c * nr, ny, s * nr).applyMatrix3(_m3).normalize();
        this.vert(_a.x, _a.y, _a.z, _n.x, _n.y, _n.z, (i / segs) * arc * Math.max(0.05, r), vs[k]);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < np - 1; k++) {
        const a = base + i * np + k, b = a + 1, c = a + np, d = c + 1;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  // Append a BufferGeometry transformed by m (keeps uv; tint from current state)
  append(geo, m) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    _m3.getNormalMatrix(m);
    const base = this.vcount;
    for (let i = 0; i < pos.count; i++) {
      _a.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (nor) _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize(); else _n.set(0, 1, 0);
      this.vert(_a.x, _a.y, _a.z, _n.x, _n.y, _n.z, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
  }

  // Merge another Mesher into this one
  merge(o) {
    const base = this.vcount;
    this.pos.push(...o.pos); this.nor.push(...o.nor); this.uv.push(...o.uv); this.tint.push(...o.tint);
    if (this.wet) { if (o.wet) this.wet.push(...o.wet); else for (let i = 0; i < o.vcount; i++) this.wet.push(0); }
    if (this.extra) { if (o.extra) this.extra.push(...o.extra); else for (let i = 0; i < o.vcount; i++) this.extra.push(0); }
    for (const k of o.idx) this.idx.push(base + k);
    this.vcount += o.vcount;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 3));
    if (this.wet) g.setAttribute('aWet', new THREE.Float32BufferAttribute(this.wet, 1));
    if (this.extra) g.setAttribute('aExtra', new THREE.Float32BufferAttribute(this.extra, 1));
    g.setIndex(this.vcount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Round arch helpers. An arch opening spans u in [a, b] (along the wall) with springing height ys:
// the opening top follows a semicircle of radius (b-a)/2 above ys.
export function archY(u, a, b, ys) {
  const r = (b - a) / 2, c = (a + b) / 2;
  const d = Math.min(r, Math.abs(u - c));
  return ys + Math.sqrt(Math.max(0, r * r - d * d));
}

// Wall slab along an edge with one round-arch opening. axis 'x': wall along x at z = d (normal ±z);
// 'z': along z at x = d. Spans s in [s0, s1] (world coordinate along the wall), y in [y0, top].
// The opening spans [a, b] with springing ys. th = slab thickness. Emits both faces, the jamb
// reveals and the curved soffit (intrados).
export function archWall(M, axis, d, th, s0, s1, y0, top, a, b, ys, segs = 14) {
  const h = th / 2;
  const r = (b - a) / 2;
  const apex = ys + r;
  const n = (sgn) => (axis === 'x' ? [0, 0, sgn] : [sgn, 0, 0]);
  const P = (s, y, off) => (axis === 'x' ? [s, y, d + off] : [d + off, y, s]);
  // solid side parts (jambs) as plain faces
  for (const sgn of [-1, 1]) {
    M.vface(axis === 'x' ? 'z' : 'x', d + sgn * h, sgn, s0, a, y0, top);
    M.vface(axis === 'x' ? 'z' : 'x', d + sgn * h, sgn, b, s1, y0, top);
    if (top > apex + 1e-3) M.vface(axis === 'x' ? 'z' : 'x', d + sgn * h, sgn, a, b, apex, top);
  }
  // spandrels: strips between the arch curve and the apex line
  for (const sgn of [-1, 1]) {
    const [nx, , nz] = n(sgn);
    const base = M.vcount;
    for (let k = 0; k <= segs; k++) {
      const s = a + ((b - a) * k) / segs;
      const yc = archY(s, a, b, ys);
      const p0 = P(s, yc, sgn * h), p1 = P(s, apex, sgn * h);
      M.vert(p0[0], p0[1], p0[2], nx, 0, nz, s, yc);
      M.vert(p1[0], p1[1], p1[2], nx, 0, nz, s, apex);
    }
    for (let k = 0; k < segs; k++) {
      const i0 = base + k * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
      // orientation depends on face side and axis
      const ccw = (axis === 'x') === (sgn > 0);
      if (ccw) M.idx.push(i0, i2, i1, i1, i2, i3); else M.idx.push(i0, i1, i2, i1, i3, i2);
    }
  }
  // jamb reveals (vertical faces inside the opening, below the springing)
  const jamb = (s, nsgn) => {
    // face at s (plane perpendicular to the wall), normal along +-wall axis
    if (axis === 'x') M.vface('x', s, nsgn, d - h, d + h, y0, ys);
    else M.vface('z', s, nsgn, d - h, d + h, y0, ys);
  };
  jamb(a, 1);
  jamb(b, -1);
  // intrados (soffit): curved surface following the arch, facing into the opening (downward/inward)
  {
    const base = M.vcount;
    let arc = 0;
    let prev = null;
    for (let k = 0; k <= segs; k++) {
      const ang = Math.PI - (k / segs) * Math.PI; // from left springing (pi) to right (0)
      const s = (a + b) / 2 + Math.cos(ang) * r;
      const y = ys + Math.sin(ang) * r;
      if (prev) arc += Math.hypot(s - prev[0], y - prev[1]);
      prev = [s, y];
      // normal points toward the arch centre
      const cs = -Math.cos(ang), sn = -Math.sin(ang);
      const q0 = P(s, y, -h), q1 = P(s, y, h);
      const nx = axis === 'x' ? cs : 0, nz = axis === 'x' ? 0 : cs;
      M.vert(q0[0], q0[1], q0[2], nx, sn, nz, arc, -h);
      M.vert(q1[0], q1[1], q1[2], nx, sn, nz, arc, h);
    }
    for (let k = 0; k < segs; k++) {
      const i0 = base + k * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
      if (axis === 'x') M.idx.push(i0, i2, i1, i1, i2, i3); else M.idx.push(i0, i1, i2, i1, i3, i2);
    }
  }
}

// Groin vault over a square bay centred at (cx, cz), half size R, springing ys (apex ys + R).
// Four cylindrical patches meeting at the diagonals; normals face down/inward.
export function groinVault(M, cx, cz, R, ys, nA = 10, nS = 7) {
  for (let side = 0; side < 4; side++) {
    // local frame: 'v' points from the centre toward the side edge, 'u' along the side
    const vx = [0, 1, 0, -1][side], vz = [-1, 0, 1, 0][side];
    const ux = -vz, uz = vx;
    const base = M.vcount;
    for (let i = 0; i <= nS; i++) {
      const f = i / nS; // 0 = edge, 1 = centre
      const reach = R * (1 - f); // half width of the triangle row
      for (let k = 0; k <= nA; k++) {
        const ang = Math.PI - (k / nA) * Math.PI;
        // u coordinate on the arch profile, limited by the triangle row
        let u = Math.cos(ang) * R;
        u = Math.max(-reach, Math.min(reach, u));
        const v = R * (1 - f);
        const y = ys + Math.sqrt(Math.max(0, R * R - u * u));
        const x = cx + ux * u + vx * v, z = cz + uz * u + vz * v;
        // barrel along v: normal from the profile in the (u, y) plane, pointing down/inward
        const sq = Math.sqrt(Math.max(1e-4, R * R - u * u));
        let nu = -u / sq, ny = -1;
        const nl = Math.hypot(nu, ny); nu /= nl; ny /= nl;
        const arc = R * Math.asin(Math.max(-1, Math.min(1, u / R)));
        M.vert(x, y, z, ux * nu, ny, uz * nu, arc, v);
      }
    }
    const row = nA + 1;
    for (let i = 0; i < nS; i++) {
      for (let k = 0; k < nA; k++) {
        const a = base + i * row + k, b = a + 1, c = a + row, d = c + 1;
        M.idx.push(a, b, c, b, d, c);
      }
    }
  }
}

// Quarter-round convex profile [[d, y]] (bullnose) from (d0,y0) bulging outward with radius r
export function bullnoseProfile(r = 0.04, segs = 5) {
  const out = [];
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * (Math.PI / 2);
    out.push([Math.sin(a) * r - r, Math.cos(a) * r - r]);
  }
  return out;
}
