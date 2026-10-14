// Geometry accumulation for merged static environment meshes (one per material per chunk).
// Everything is written straight into growable typed arrays: positions, normals, UVs in meters,
// plus the per-vertex data the baked-light shader needs:
//   aCell  (vec2)  the 3 m cell whose fixtures light this primitive (auto: cell in front of the face)
//   aEdge  (vec2)  packed edge / corner-post info of that cell (floors & ceilings: analytic contact AO)
//   aWet   (float) wetness (floors / walls in flooded areas)
//   aAO    (float) geometric pre-occlusion (recesses, undersides) multiplied into the baked AO
//   color  (vec3)  vertex tint (fixtures, trims)
import * as THREE from 'three';

class Buf {
  constructor(type, n) { this.T = type; this.a = new type(n); this.n = 0; }
  grow(k) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new this.T(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  // trimmed array: a view when little capacity is wasted, else a compact copy
  view() { return this.n > this.a.length * 0.7 ? this.a.subarray(0, this.n) : this.a.slice(0, this.n); }
}

export class EnvGeo {
  constructor(o = {}) {
    const cap = o.cap || 1024;
    this.cellSize = o.cellSize || 3;
    this.P = new Buf(Float32Array, cap * 3);
    this.N = new Buf(Float32Array, cap * 3);
    this.U = new Buf(Float32Array, cap * 2);
    this.C = new Buf(Float32Array, cap * 2);
    this.A = new Buf(Float32Array, cap);
    this.E = o.edge ? new Buf(Float32Array, cap * 2) : null;
    this.Wt = o.wet ? new Buf(Float32Array, cap) : null;
    this.Col = o.color ? new Buf(Float32Array, cap * 3) : null;
    this.R = o.room ? new Buf(Float32Array, cap) : null;
    this.I = new Buf(Uint32Array, cap * 3);
    this.vc = 0;
    // current vertex state
    this.cell = null;       // [i, j] fixed origin cell, or null = auto per primitive
    this._ci = 0; this._cj = 0;
    this.edge0 = 0; this.edge1 = 0;
    this.wet = 0;
    this.ao = 1;
    this.room = 0;
    this.cr = 1; this.cg = 1; this.cb = 1;
    this.wetFn = null;      // optional (x, y, z) -> wetness
    this.bmin = [Infinity, Infinity, Infinity];
    this.bmax = [-Infinity, -Infinity, -Infinity];
  }

  isEmpty() { return this.vc === 0; }
  setColor(hex) { const c = new THREE.Color(hex); this.cr = c.r; this.cg = c.g; this.cb = c.b; return this; }
  setRGB(r, g, b) { this.cr = r; this.cg = g; this.cb = b; return this; }

  // choose the origin cell for the next primitive: cell in front of point p along normal n
  autoCell(x, z, nx = 0, nz = 0) {
    if (this.cell) { this._ci = this.cell[0]; this._cj = this.cell[1]; return; }
    const s = this.cellSize;
    this._ci = Math.floor((x + nx * 0.06) / s);
    this._cj = Math.floor((z + nz * 0.06) / s);
  }

  v(x, y, z, nx, ny, nz, u, w) {
    const P = this.P, N = this.N, U = this.U, C = this.C, A = this.A;
    P.grow(3); N.grow(3); U.grow(2); C.grow(2); A.grow(1);
    P.a[P.n++] = x; P.a[P.n++] = y; P.a[P.n++] = z;
    const bn = this.bmin, bx = this.bmax;
    if (x < bn[0]) bn[0] = x; if (x > bx[0]) bx[0] = x;
    if (y < bn[1]) bn[1] = y; if (y > bx[1]) bx[1] = y;
    if (z < bn[2]) bn[2] = z; if (z > bx[2]) bx[2] = z;
    N.a[N.n++] = nx; N.a[N.n++] = ny; N.a[N.n++] = nz;
    U.a[U.n++] = u; U.a[U.n++] = w;
    C.a[C.n++] = this._ci; C.a[C.n++] = this._cj;
    A.a[A.n++] = this.ao;
    if (this.E) { this.E.grow(2); this.E.a[this.E.n++] = this.edge0; this.E.a[this.E.n++] = this.edge1; }
    if (this.Wt) { this.Wt.grow(1); this.Wt.a[this.Wt.n++] = this.wetFn ? this.wetFn(x, y, z) : this.wet; }
    if (this.Col) { this.Col.grow(3); this.Col.a[this.Col.n++] = this.cr; this.Col.a[this.Col.n++] = this.cg; this.Col.a[this.Col.n++] = this.cb; }
    if (this.R) { this.R.grow(1); this.R.a[this.R.n++] = this.room; }
    return this.vc++;
  }

  tri(a, b, c) { const I = this.I; I.grow(3); I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c; }
  // quad a-b-c-d counter-clockwise when seen from the front
  quad(a, b, c, d) { const I = this.I; I.grow(6); I.a[I.n++] = a; I.a[I.n++] = b; I.a[I.n++] = c; I.a[I.n++] = a; I.a[I.n++] = c; I.a[I.n++] = d; }

  // planar quad grid. o origin, a / b edge vectors ([x,y,z]); us / vs: subdivision fractions (0..1, sorted,
  // including 0 and 1) along a and b; n normal. uvFn(x,y,z) -> [u, v] (default: planar meters by normal).
  // The winding is fixed so that the front faces along n. skip(iu, iv) -> true to leave a cell out.
  grid(o, a, b, n, us, vs, uvFn = null, skip = null) {
    const cx = o[0] + a[0] * 0.5 + b[0] * 0.5, cz = o[2] + a[2] * 0.5 + b[2] * 0.5;
    this.autoCell(cx, cz, n[0], n[2]);
    const base = this.vc;
    const nu = us.length, nv = vs.length;
    for (let j = 0; j < nv; j++) {
      const fv = vs[j];
      for (let i = 0; i < nu; i++) {
        const fu = us[i];
        const x = o[0] + a[0] * fu + b[0] * fv, y = o[1] + a[1] * fu + b[1] * fv, z = o[2] + a[2] * fu + b[2] * fv;
        const uv = uvFn ? uvFn(x, y, z) : planarUV(x, y, z, n);
        this.v(x, y, z, n[0], n[1], n[2], uv[0], uv[1]);
      }
    }
    // winding: (a x b) . n
    const cxp = a[1] * b[2] - a[2] * b[1], cyp = a[2] * b[0] - a[0] * b[2], czp = a[0] * b[1] - a[1] * b[0];
    const flip = cxp * n[0] + cyp * n[1] + czp * n[2] < 0;
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        if (skip && skip(i, j)) continue;
        const k0 = base + j * nu + i, k1 = k0 + 1, k2 = k0 + nu, k3 = k2 + 1;
        if (!flip) { this.tri(k0, k1, k3); this.tri(k0, k3, k2); } else { this.tri(k0, k3, k1); this.tri(k0, k2, k3); }
      }
    }
  }

  // single quad with explicit corners (p0..p3 counter-clockwise seen from the front) and normal
  rect(p0, p1, p2, p3, n, uvFn = null) {
    const cx = (p0[0] + p2[0]) * 0.5, cz = (p0[2] + p2[2]) * 0.5;
    this.autoCell(cx, cz, n[0], n[2]);
    const ps = [p0, p1, p2, p3];
    const base = this.vc;
    for (const p of ps) {
      const uv = uvFn ? uvFn(p[0], p[1], p[2]) : planarUV(p[0], p[1], p[2], n);
      this.v(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
    }
    this.quad(base, base + 1, base + 2, base + 3);
  }

  // axis-aligned box; skip: {px,nx,py,ny,pz,nz}; seg: max face subdivision in meters (0 = none)
  box(x0, y0, z0, x1, y1, z1, skip = {}, seg = 0, uvFn = null) {
    const sub = (l) => (seg > 0 ? fr(Math.max(1, Math.round(l / seg))) : F01);
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    if (!skip.pz) this.grid([x0, y0, z1], [sx, 0, 0], [0, sy, 0], [0, 0, 1], sub(sx), sub(sy), uvFn);
    if (!skip.nz) this.grid([x1, y0, z0], [-sx, 0, 0], [0, sy, 0], [0, 0, -1], sub(sx), sub(sy), uvFn);
    if (!skip.px) this.grid([x1, y0, z1], [0, 0, -sz], [0, sy, 0], [1, 0, 0], sub(sz), sub(sy), uvFn);
    if (!skip.nx) this.grid([x0, y0, z0], [0, 0, sz], [0, sy, 0], [-1, 0, 0], sub(sz), sub(sy), uvFn);
    if (!skip.py) this.grid([x0, y1, z1], [sx, 0, 0], [0, 0, -sz], [0, 1, 0], sub(sx), sub(sz), uvFn);
    if (!skip.ny) this.grid([x0, y0, z0], [sx, 0, 0], [0, 0, sz], [0, -1, 0], sub(sx), sub(sz), uvFn);
  }

  // box with chamfered edges (b = chamfer size); smooth-ish look for trims, fixtures, plates
  bevelBox(x0, y0, z0, x1, y1, z1, b, skip = {}, uvFn = null) {
    b = Math.min(b, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45);
    if (b <= 0.0005) { this.box(x0, y0, z0, x1, y1, z1, skip, 0, uvFn); return; }
    const X = [x0, x0 + b, x1 - b, x1], Y = [y0, y0 + b, y1 - b, y1], Z = [z0, z0 + b, z1 - b, z1];
    // faces (inset)
    if (!skip.pz) this.rect([X[1], Y[1], z1], [X[2], Y[1], z1], [X[2], Y[2], z1], [X[1], Y[2], z1], [0, 0, 1], uvFn);
    if (!skip.nz) this.rect([X[2], Y[1], z0], [X[1], Y[1], z0], [X[1], Y[2], z0], [X[2], Y[2], z0], [0, 0, -1], uvFn);
    if (!skip.px) this.rect([x1, Y[1], Z[2]], [x1, Y[1], Z[1]], [x1, Y[2], Z[1]], [x1, Y[2], Z[2]], [1, 0, 0], uvFn);
    if (!skip.nx) this.rect([x0, Y[1], Z[1]], [x0, Y[1], Z[2]], [x0, Y[2], Z[2]], [x0, Y[2], Z[1]], [-1, 0, 0], uvFn);
    if (!skip.py) this.rect([X[1], y1, Z[2]], [X[2], y1, Z[2]], [X[2], y1, Z[1]], [X[1], y1, Z[1]], [0, 1, 0], uvFn);
    if (!skip.ny) this.rect([X[1], y0, Z[1]], [X[2], y0, Z[1]], [X[2], y0, Z[2]], [X[1], y0, Z[2]], [0, -1, 0], uvFn);
    const s = Math.SQRT1_2;
    // 4 edges along x
    const ex = (yA, yB, zA, zB, ny, nz, sk) => { if (!sk) this.rect([X[1], yA, zA], [X[2], yA, zA], [X[2], yB, zB], [X[1], yB, zB], [0, ny, nz], uvFn); };
    ex(Y[2], y1, z1, Z[2], s, s, skip.py || skip.pz);
    ex(y0, Y[1], Z[2], z1, -s, s, skip.ny || skip.pz);
    ex(y1, Y[2], Z[1], z0, s, -s, skip.py || skip.nz);
    ex(Y[1], y0, z0, Z[1], -s, -s, skip.ny || skip.nz);
    // 4 edges along z
    const ez = (xA, xB, yA, yB, nx, ny, sk) => { if (!sk) this.rect([xA, yA, Z[2]], [xA, yA, Z[1]], [xB, yB, Z[1]], [xB, yB, Z[2]], [nx, ny, 0], uvFn); };
    ez(X[2], x1, y1, Y[2], s, s, skip.py || skip.px);
    ez(x0, X[1], Y[2], y1, -s, s, skip.py || skip.nx);
    ez(x1, X[2], Y[1], y0, s, -s, skip.ny || skip.px);
    ez(X[1], x0, y0, Y[1], -s, -s, skip.ny || skip.nx);
    // 4 edges along y
    const ey = (xA, zA, xB, zB, nx, nz, sk) => { if (!sk) this.rect([xA, Y[1], zA], [xB, Y[1], zB], [xB, Y[2], zB], [xA, Y[2], zA], [nx, 0, nz], uvFn); };
    ey(X[2], z1, x1, Z[2], s, s, skip.px || skip.pz);
    ey(x0, Z[2], X[1], z1, -s, s, skip.nx || skip.pz);
    ey(x1, Z[1], X[2], z0, s, -s, skip.px || skip.nz);
    ey(X[1], z0, x0, Z[1], -s, -s, skip.nx || skip.nz);
    // 8 corner triangles
    const k = 1 / Math.sqrt(3);
    const corner = (cx, cy, cz, sx, sy, sz) => {
      const a = [cx === x1 ? x1 : x0, cy === y1 ? Y[2] : Y[1], cz === z1 ? Z[2] : Z[1]];
      const bb = [cx === x1 ? X[2] : X[1], cy === y1 ? y1 : y0, cz === z1 ? Z[2] : Z[1]];
      const c = [cx === x1 ? X[2] : X[1], cy === y1 ? Y[2] : Y[1], cz === z1 ? z1 : z0];
      const n = [sx * k, sy * k, sz * k];
      this.autoCell((a[0] + bb[0] + c[0]) / 3, (a[2] + bb[2] + c[2]) / 3, n[0], n[2]);
      const base = this.vc;
      for (const p of [a, bb, c]) { const uv = uvFn ? uvFn(p[0], p[1], p[2]) : planarUV(p[0], p[1], p[2], n); this.v(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]); }
      // orient: (b-a)x(c-a) along n
      const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
      if (d >= 0) this.tri(base, base + 1, base + 2); else this.tri(base, base + 2, base + 1);
    };
    for (const cx of [x0, x1]) for (const cy of [y0, y1]) for (const cz of [z0, z1]) {
      const sx = cx === x1 ? 1 : -1, sy = cy === y1 ? 1 : -1, sz = cz === z1 ? 1 : -1;
      if ((sx > 0 && skip.px) || (sx < 0 && skip.nx) || (sy > 0 && skip.py) || (sy < 0 && skip.ny) || (sz > 0 && skip.pz) || (sz < 0 && skip.nz)) continue;
      corner(cx, cy, cz, sx, sy, sz);
    }
  }

  // box whose four edges around ONE face (front: 'px'|'nx'|'py'|'ny'|'pz'|'nz') are chamfered by b;
  // the cheap way to get a soft, light-catching edge on trims, plates and fixtures (~36 vertices)
  chamferBox(x0, y0, z0, x1, y1, z1, b, front, skip = {}, uvFn = null) {
    const ax = front[1], sg = front[0] === 'p' ? 1 : -1;
    // map to a local frame: w = front axis, (u, v) = the other two
    const lo = { x: x0, y: y0, z: z0 }, hi = { x: x1, y: y1, z: z1 };
    const others = ax === 'x' ? ['z', 'y'] : ax === 'y' ? ['x', 'z'] : ['x', 'y'];
    const [ua, va] = others;
    b = Math.min(b, (hi[ua] - lo[ua]) * 0.45, (hi[va] - lo[va]) * 0.45, (hi[ax] - lo[ax]) * 0.9);
    const wF = sg > 0 ? hi[ax] : lo[ax], wB = sg > 0 ? lo[ax] : hi[ax], wC = wF - sg * b;
    const P = (u, v, w) => { const o = {}; o[ua] = u; o[va] = v; o[ax] = w; return [o.x, o.y, o.z]; };
    const nF = P(0, 0, sg);
    const u0 = lo[ua], u1 = hi[ua], v0 = lo[va], v1 = hi[va];
    // front face (inset)
    this.rectOriented([P(u0 + b, v0 + b, wF), P(u1 - b, v0 + b, wF), P(u1 - b, v1 - b, wF), P(u0 + b, v1 - b, wF)], nF, uvFn);
    const s = Math.SQRT1_2;
    // mitred chamfer strips (trapezoids sharing their diagonal edges: no corner gaps)
    this.rectOriented([P(u0, v0, wC), P(u0 + b, v0 + b, wF), P(u0 + b, v1 - b, wF), P(u0, v1, wC)], P(-s, 0, sg * s), uvFn);
    this.rectOriented([P(u1, v0, wC), P(u1 - b, v0 + b, wF), P(u1 - b, v1 - b, wF), P(u1, v1, wC)], P(s, 0, sg * s), uvFn);
    this.rectOriented([P(u0, v0, wC), P(u0 + b, v0 + b, wF), P(u1 - b, v0 + b, wF), P(u1, v0, wC)], P(0, -s, sg * s), uvFn);
    this.rectOriented([P(u0, v1, wC), P(u0 + b, v1 - b, wF), P(u1 - b, v1 - b, wF), P(u1, v1, wC)], P(0, s, sg * s), uvFn);
    // straight sides from the back plane to the chamfer start
    if (!skip['n' + ua]) this.rectOriented([P(u0, v0, wB), P(u0, v1, wB), P(u0, v1, wC), P(u0, v0, wC)], P(-1, 0, 0), uvFn);
    if (!skip['p' + ua]) this.rectOriented([P(u1, v0, wB), P(u1, v1, wB), P(u1, v1, wC), P(u1, v0, wC)], P(1, 0, 0), uvFn);
    if (!skip['n' + va]) this.rectOriented([P(u0, v0, wB), P(u1, v0, wB), P(u1, v0, wC), P(u0, v0, wC)], P(0, -1, 0), uvFn);
    if (!skip['p' + va]) this.rectOriented([P(u0, v1, wB), P(u1, v1, wB), P(u1, v1, wC), P(u0, v1, wC)], P(0, 1, 0), uvFn);
    if (!skip[(sg > 0 ? 'n' : 'p') + ax]) this.rectOriented([P(u0, v0, wB), P(u1, v0, wB), P(u1, v1, wB), P(u0, v1, wB)], P(0, 0, -sg), uvFn);
  }

  // Extrude a 2D profile along a horizontal axis-aligned run.
  // profile: [[o, y], ...] (o = offset outward from the base plane, y = height), listed bottom -> top.
  // axis 'x': runs from s0 to s1 along x at plane z = p, outward = side (+1: +z, -1: -z)
  // axis 'z': runs along z at plane x = p, outward = side (+1: +x, -1: -x)
  // caps: [startCap, endCap]; uOff: texture u offset.
  extrude(profile, axis, p, side, s0, s1, caps = [true, true], yBase = 0) {
    const n = profile.length;
    const toW = (s, o, y) => (axis === 'x' ? [s, yBase + y, p + side * o] : [p + side * o, yBase + y, s]);
    for (let k = 0; k < n - 1; k++) {
      const [oa, ya] = profile[k], [ob, yb] = profile[k + 1];
      // segment normal in (o, y): perpendicular to (ob-oa, yb-ya), pointing outward/up
      let no = yb - ya, ny = -(ob - oa);
      const l = Math.hypot(no, ny) || 1; no /= l; ny /= l;
      if (no < -1e-6 || (Math.abs(no) < 1e-6 && ny < 0)) { no = -no; ny = -ny; }
      const nw = axis === 'x' ? [0, ny, side * no] : [side * no, ny, 0];
      const a0 = toW(s0, oa, ya), a1 = toW(s1, oa, ya), b1 = toW(s1, ob, yb), b0 = toW(s0, ob, yb);
      const uvf = (x, y, z) => (axis === 'x' ? [x, y] : [z, y]);
      this.rectOriented([a0, a1, b1, b0], nw, uvf);
    }
    // end caps (flat polygons in the profile plane)
    const cap = (s, dir) => {
      const pts = [toW(s, 0, profile[0][1])];
      for (const [o, y] of profile) pts.push(toW(s, o, y));
      pts.push(toW(s, 0, profile[n - 1][1]));
      const nrm = axis === 'x' ? [dir, 0, 0] : [0, 0, dir];
      const c = pts.reduce((acc, q) => [acc[0] + q[0] / pts.length, acc[1] + q[1] / pts.length, acc[2] + q[2] / pts.length], [0, 0, 0]);
      this.autoCell(c[0], c[2], nrm[0], nrm[2]);
      const base = this.vc;
      for (const q of pts) { const uv = planarUV(q[0], q[1], q[2], nrm); this.v(q[0], q[1], q[2], nrm[0], nrm[1], nrm[2], uv[0], uv[1]); }
      for (let k = 1; k < pts.length - 1; k++) {
        // fan; fix winding against the cap normal
        const A = pts[0], B = pts[k], C = pts[k + 1];
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
        const d = (uy * vz - uz * vy) * nrm[0] + (uz * vx - ux * vz) * nrm[1] + (ux * vy - uy * vx) * nrm[2];
        if (d >= 0) this.tri(base, base + k, base + k + 1); else this.tri(base, base + k + 1, base + k);
      }
    };
    if (caps[0]) cap(s0, -1);
    if (caps[1]) cap(s1, 1);
  }

  // quad from 4 points with a given normal; winding fixed to face the normal
  rectOriented(pts, n, uvFn = null) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (d >= 0) this.rect(pts[0], pts[1], pts[2], pts[3], n, uvFn);
    else this.rect(pts[3], pts[2], pts[1], pts[0], n, uvFn);
  }

  // cylinder between two points along a principal axis ('x' | 'y' | 'z'); seg radial segments
  // uv: u along the length (m), v around (m). caps: [start, end]
  tube(axis, a0, a1, c0, c1, r, seg = 12, caps = [false, false], uOff = 0) {
    // c0, c1 = the two cross coordinates (for 'x': y,z ; for 'y': x,z ; for 'z': x,y)
    const W = (s, p, q) => (axis === 'x' ? [s, p, q] : axis === 'y' ? [p, s, q] : [p, q, s]);
    const mid = W((a0 + a1) * 0.5, c0, c1);
    this.autoCell(mid[0], mid[2], 0, 0);
    const base = this.vc;
    const t0 = this.I.n;
    for (let e = 0; e < 2; e++) {
      const s = e ? a1 : a0;
      for (let k = 0; k <= seg; k++) {
        const ang = (k / seg) * Math.PI * 2;
        const cp = Math.cos(ang), sp = Math.sin(ang);
        const p = W(s, c0 + cp * r, c1 + sp * r);
        const nn = W(0, cp, sp);
        this.v(p[0], p[1], p[2], nn[0], nn[1], nn[2], s + uOff, ang * r);
      }
    }
    const row = seg + 1;
    for (let k = 0; k < seg; k++) {
      const k0 = base + k, k1 = k0 + 1, k2 = k0 + row, k3 = k2 + 1;
      this.tri(k0, k1, k3); this.tri(k0, k3, k2);
    }
    for (let e = 0; e < 2; e++) {
      if (!caps[e]) continue;
      const s = e ? a1 : a0, dir = e ? 1 : -1;
      const nn = W(dir, 0, 0);
      const cb = this.vc;
      const cpt = W(s, c0, c1);
      this.v(cpt[0], cpt[1], cpt[2], nn[0], nn[1], nn[2], c0, c1);
      for (let k = 0; k <= seg; k++) {
        const ang = (k / seg) * Math.PI * 2;
        const p = W(s, c0 + Math.cos(ang) * r, c1 + Math.sin(ang) * r);
        this.v(p[0], p[1], p[2], nn[0], nn[1], nn[2], p[axis === 'x' ? 2 : 0], p[1]);
      }
      for (let k = 0; k < seg; k++) this.tri(cb, cb + 1 + k, cb + 2 + k);
    }
    this._fixWinding(t0);
  }

  // quarter-torus pipe elbow: centre (cx,cy,cz) of the bend circle in the plane spanned by unit axes
  // d0 (start tangent direction) and d1 (end direction); R bend radius, r pipe radius
  elbow(c, d0, d1, R, r, seg = 10, rings = 6) {
    // start point = c - d1 * R (pipe arrives along d0), end = c + d0 * R? use a parametric circle:
    // p(t) = c + (-d1 * cos(t) + d0 * sin(t)) * R, t in [0, pi/2]; tangent = d1 * sin + d0 * cos
    const axis = cross3(d0, d1);
    this.autoCell(c[0], c[2], 0, 0);
    const base = this.vc;
    const t0 = this.I.n;
    for (let i = 0; i <= rings; i++) {
      const t = (i / rings) * Math.PI * 0.5;
      const ct = Math.cos(t), st = Math.sin(t);
      const ctr = [c[0] + (-d1[0] * ct + d0[0] * st) * R, c[1] + (-d1[1] * ct + d0[1] * st) * R, c[2] + (-d1[2] * ct + d0[2] * st) * R];
      const radial = [-d1[0] * ct + d0[0] * st, -d1[1] * ct + d0[1] * st, -d1[2] * ct + d0[2] * st];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nn = [radial[0] * ca + axis[0] * sa, radial[1] * ca + axis[1] * sa, radial[2] * ca + axis[2] * sa];
        this.v(ctr[0] + nn[0] * r, ctr[1] + nn[1] * r, ctr[2] + nn[2] * r, nn[0], nn[1], nn[2], t * R, a * r);
      }
    }
    const row = seg + 1;
    for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) {
      const k0 = base + i * row + k, k1 = k0 + 1, k2 = k0 + row, k3 = k2 + 1;
      this.tri(k0, k2, k3); this.tri(k0, k3, k1);
    }
    this._fixWinding(t0);
  }

  // flip triangles (index-buffer offset >= t0) whose winding disagrees with their vertex normals
  _fixWinding(t0) {
    const I = this.I.a, P = this.P.a, N = this.N.a;
    for (let t = t0; t < this.I.n; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
      if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0) { I[t + 1] = c; I[t + 2] = b; }
    }
  }

  // flat disc / ring in a horizontal plane (y), facing up (+1) or down (-1)
  ring(cx, y, cz, r0, r1, seg, up = 1) {
    this.autoCell(cx, cz, 0, 0);
    const base = this.vc;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      this.v(cx + ca * r0, y, cz + sa * r0, 0, up, 0, cx + ca * r0, cz + sa * r0);
      this.v(cx + ca * r1, y, cz + sa * r1, 0, up, 0, cx + ca * r1, cz + sa * r1);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
      if (up > 0) { this.tri(a, c, d); this.tri(a, d, b); } else { this.tri(a, d, c); this.tri(a, b, d); }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.view(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.view(), 2));
    g.setAttribute('aCell', new THREE.BufferAttribute(this.C.view(), 2));
    g.setAttribute('aAO', new THREE.BufferAttribute(this.A.view(), 1));
    if (this.E) g.setAttribute('aEdge', new THREE.BufferAttribute(this.E.view(), 2));
    if (this.Wt) g.setAttribute('aWet', new THREE.BufferAttribute(this.Wt.view(), 1));
    if (this.Col) g.setAttribute('color', new THREE.BufferAttribute(this.Col.view(), 3));
    if (this.R) g.setAttribute('aRoom', new THREE.BufferAttribute(this.R.view(), 1));
    const idx = this.vc > 65535 ? this.I.view() : Uint16Array.from(this.I.a.subarray(0, this.I.n));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...this.bmin), new THREE.Vector3(...this.bmax));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }
}

const F01 = [0, 1];
const frCache = new Map();
export function fr(n) {
  let a = frCache.get(n);
  if (!a) { a = []; for (let i = 0; i <= n; i++) a.push(i / n); frCache.set(n, a); }
  return a;
}

// planar UVs in meters chosen by the dominant normal axis
export function planarUV(x, y, z, n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [x, z];
  if (ax >= az) return [z, y];
  return [x, y];
}

function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
