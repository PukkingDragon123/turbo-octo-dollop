// R.O.O.M. — hats, face gear and trinkets for the clone android: separate detailed models (lathe-turned
// crowns, rolled brims, knitted cuffs, stitched seams) with hand-painted canvas textures (handpaint.js) and
// proper materials (felt / canvas / knit with sheen, chipped painted plastic, brass, glass). Each model
// rides one bone of the rig and may carry springy parts (pom-poms, ears, ties, the propeller).
//
//   buildCosmeticModel(slot, id) -> { object, bone, jig: [{ obj, k, d, gain, limit, mode }], spin, halo } | null
//   slot: 'hat' (bone 'hat' = skull centre, face toward -Z), 'visor' (bone 'head'), 'accessory' (chest / pelvis)
// Ids are the cosmetics ids (dollcos.js); null falls back to the old merged part (robotcos.js).
import * as THREE from 'three';
import { HC, HR, FACE, headPoint, plateOff, eyeLayout, eyeCentre } from './robotshape.js';
import { RY, RD, NECK_Z, HEAD_Z } from './robotrig.js';
import { coverPt, coverNrm } from './robotbody.js';
import { ptex, css, shade, mixHex, P, FM, TX, cachedMat } from './handpaint.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// geometry helpers
function lathe(pts, seg = 48) {
  if (pts[0][1] > pts[pts.length - 1][1]) pts = pts.slice().reverse();
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = L[L.length - 1] || 1, uv = g.attributes.uv, np = pts.length;
  for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - L[k % np] / tot);
  return g;
}
// smooth profile from control points (Catmull-Rom), n samples
function prof(ctrl, n = 24) {
  const c = new THREE.SplineCurve(ctrl.map(([r, y]) => new THREE.Vector2(r, y)));
  return c.getPoints(n).map((p) => [p.x, p.y]);
}
function m(geo, mat, o = {}) {
  const x = new THREE.Mesh(geo, mat);
  if (o.p) x.position.set(...o.p);
  if (o.r) x.rotation.set(...o.r);
  if (o.s) { if (Array.isArray(o.s)) x.scale.set(...o.s); else x.scale.setScalar(o.s); }
  x.castShadow = o.cast !== false; x.receiveShadow = true;
  return x;
}
function displace(g, fn) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); if (v) p.setXYZ(i, v[0], v[1], v[2]); }
  g.computeVertexNormals();
  return g;
}
// fuzzy ball (pom-pom, flower)
function fuzzball(r, amt = 0.3, seed = 1) {
  const g = new THREE.IcosahedronGeometry(r, 3);
  return displace(g, (x, y, z) => {
    const k = 1 + amt * (Math.sin(x * 260 / r * 0.01 + seed) * Math.sin(y * 310 / r * 0.01 + seed * 2) * Math.sin(z * 290 / r * 0.01) + 0.4 * Math.sin((x + y) * 900 + seed));
    return [x * k, y * k, z * k];
  });
}
function tube(pts, r, seg = 32, rad = 8, closed = false) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, r, rad, closed); }
// ring of points round the skull at elevation ph (+ offset), hat-local
function skullRing(ph, off, n = 48, phBack = null) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU - PI;
    const e = phBack == null ? ph : ph + (phBack - ph) * (1 - Math.cos(th)) / 2;
    out.push(headPoint(th, e, off).sub(HC));
  }
  return out;
}

// ---------------------------------------------------------------------------
// textures
const T = {
  canvas(key, base, { rows = [], band = null, stains = 4 } = {}) {
    return ptex('hat_canvas_' + key, 512, 512, (g, w, h, r) => {
      P.wash(g, w, h, base, { k: 0.14, angle: PI / 2 });
      P.weave(g, w, h, base, r, { pitch: 3, alpha: 0.35 });
      P.strokes(g, w, h, base, r, { n: 60, len: 0.3, alpha: 0.13 });
      if (band) { g.fillStyle = css(band[2]); g.fillRect(0, band[0] * h, w, band[1] * h); P.weave(g, w, band[1] * h, band[2], r, { pitch: 2, alpha: 0.2 }); }
      for (const y of rows) P.stitches(g, [[0, y * h], [w, y * h]], r, { col: shade(base, -0.35), len: 7, gap: 4, wid: 2 });
      P.blotches(g, w, h, 0x5a4428, r, { n: stains, r: 0.12, alpha: 0.18 });
      P.edgeWear(g, w, h, r, { amt: 0.4 });
    });
  },
  felt(key, base, k = 0.16) {
    return ptex('hat_felt_' + key, 256, 256, (g, w, h, r) => {
      P.wash(g, w, h, base, { k, angle: PI / 2 });
      P.strokes(g, w, h, base, r, { n: 90, len: 0.12, wid: 0.03, k: 0.12, alpha: 0.12 });
      P.blotches(g, w, h, shade(base, -0.4), r, { n: 5, r: 0.15, alpha: 0.12 });
    });
  },
  knit(key, cols, { stripe = 0.18 } = {}) {
    return ptex('hat_knit_' + key, 256, 512, (g, w, h, r) => {
      const rowH = 10;
      for (let y = 0, row = 0; y < h; y += rowH, row++) {
        const v = y / h, ci = Math.floor(v / stripe) % cols.length;
        const col = cols[ci];
        g.fillStyle = css(col); g.fillRect(0, y, w, rowH);
        for (let x = 0; x < w; x += 8) {
          g.fillStyle = css(shade(col, 0.18), 0.6); g.beginPath(); g.ellipse(x + 2, y + 5, 2.2, 4.4, 0.5, 0, TAU); g.fill();
          g.fillStyle = css(shade(col, -0.2), 0.5); g.beginPath(); g.ellipse(x + 6, y + 5, 2.2, 4.4, -0.5, 0, TAU); g.fill();
        }
      }
      P.blotches(g, w, h, 0x2a2018, r, { n: 4, r: 0.2, alpha: 0.1 });
    }, { repeat: [1, 1] });
  },
  paintedPlastic(key, base, { decal = null, stripes = [] } = {}) {
    return ptex('hat_pp_' + key, 512, 512, (g, w, h, r) => {
      P.wash(g, w, h, base, { k: 0.12 });
      P.strokes(g, w, h, base, r, { n: 50, len: 0.4, wid: 0.06, alpha: 0.14 });
      for (const [y0, hh, c] of stripes) { g.fillStyle = css(c); g.fillRect(0, y0 * h, w, hh * h); P.strokes(g, w, hh * h, c, r, { n: 10, alpha: 0.12 }); }
      if (decal) decal(g, w, h, r);
      P.chips(g, w, h, 0x3a3532, r, { n: 22, s: 0.01 });
      P.chips(g, w, h, shade(base, 0.35), r, { n: 16, s: 0.006 });
      P.blotches(g, w, h, 0x4a3a20, r, { n: 5, r: 0.12, alpha: 0.14 });
    });
  },
};
const brassMat = () => FM.bare('hat_brass', 0xc99a4a, { rough: 0.32 });
const goldMat = () => cachedMat('hat_gold', () => new THREE.MeshPhysicalMaterial({ name: 'hat_gold', color: 0xe8b84a, metalness: 1, roughness: 0.28, clearcoat: 0.3, envMapIntensity: 1.3 }));
const blackRubber = () => FM.plain('hat_rubber', 0x1e1c1a, { rough: 0.6, cc: 0.2 });
const glassMat = (tint = 0xdfeee8, op = 0.2) => FM.glass('hat_' + tint.toString(16) + '_' + op, { tint, opacity: op });

// ---------------------------------------------------------------------------
// HATS (bone 'hat', origin = skull centre; skull radii x .079, y .105, z .1; face toward -Z)
const OVAL = [0.86, 1, 1.0];
const HATS = {
  bucket(e) {
    const g = new THREE.Group();
    const tex = T.canvas('bucket', e.color ?? 0xdccdaa, { rows: [0.06, 0.12, 0.18, 0.24, 0.62, 0.7], band: [0.42, 0.08, 0x5a4a36] });
    const mat = FM.fabric('hat_bucket', tex, { sheen: 0.5, side: THREE.DoubleSide });
    const crown = prof([[0.0, 0.122], [0.05, 0.12], [0.085, 0.112], [0.1, 0.09], [0.106, 0.05], [0.112, 0.022]], 16);
    const brim = [[0.112, 0.022], [0.13, 0.008], [0.155, -0.012], [0.172, -0.026], [0.176, -0.03], [0.174, -0.034], [0.15, -0.018], [0.112, 0.016]];
    g.add(m(lathe([...crown, ...brim.slice(1)], 56), mat, { s: OVAL }));
    // brim edge roll + band
    g.add(m(new THREE.TorusGeometry(0.175, 0.004, 6, 56), mat, { p: [0, -0.031, 0], r: [PI / 2, 0, 0], s: OVAL }));
    g.add(m(lathe([[0.108, 0.026], [0.109, 0.04], [0.106, 0.05]], 56), FM.fabric('hat_bucket_band', T.felt('band', 0x5a4a36), { sheen: 0.4 }), { s: [OVAL[0] * 1.01, 1, 1.01] }));
    // an eyelet each side
    for (const s of [-1, 1]) g.add(m(new THREE.TorusGeometry(0.006, 0.0016, 6, 14), brassMat(), { p: [s * 0.088, 0.075, 0.02], r: [0, PI / 2, 0] }));
    g.rotation.x = -0.14; g.position.set(0, 0.04, 0.008); g.scale.setScalar(0.9);
    return { object: g, jig: [{ obj: g, k: 110, d: 7, gain: 0.004, limit: 0.1 }] };
  },
  beanie(e) {
    const g = new THREE.Group();
    const c1 = e.color ?? 0x2f4d34, c2 = e.color2 ?? 0x7da66b;
    const tex = T.knit('beanie' + c1, [c1, c1, c2, c1, 0xf1e6cc], { stripe: 0.1 });
    const mat = FM.fabric('hat_beanie' + c1, tex, { sheen: 0.95, rough: 1 });
    const cap = prof([[0, 0.128], [0.055, 0.124], [0.088, 0.106], [0.104, 0.07], [0.108, 0.03], [0.106, 0.006]], 18);
    const geo = displace(lathe(cap, 64), (x, y, z) => { const a = Math.atan2(x, z), k = 1 + 0.012 * Math.sin(a * 36) * clamp(1 - y / 0.12, 0, 1); return [x * k, y, z * k]; });
    g.add(m(geo, mat, { s: OVAL }));
    const cuffTex = T.knit('beaniecuff' + c1, [c2, c1], { stripe: 0.5 });
    const cuff = displace(lathe([[0.104, -0.006], [0.116, -0.002], [0.118, 0.02], [0.114, 0.038], [0.104, 0.042]], 64), (x, y, z) => { const a = Math.atan2(x, z), k = 1 + 0.025 * Math.max(0, Math.sin(a * 28)); return [x * k, y, z * k]; });
    g.add(m(cuff, FM.fabric('hat_beaniecuff' + c1, cuffTex, { sheen: 0.9, rough: 1 }), { s: OVAL }));
    // leather patch on the cuff with stitches
    const patchTex = ptex('hat_patch', 128, 96, (c, w, h, r) => { P.wash(c, w, h, 0x8a5a34, { k: 0.2 }); P.stitches(c, [[6, 6], [w - 6, 6], [w - 6, h - 6], [6, h - 6], [6, 6]], r, { col: 0xf1e6cc, len: 6, gap: 4 }); P.text(c, 'R.O.O.M.', w / 2, h / 2, 26, 0xf1e6cc, r); });
    const pm = cachedMat('hat_patchmat', () => new THREE.MeshPhysicalMaterial({ map: patchTex, roughness: 0.6, sheen: 0.3, side: THREE.DoubleSide }));
    g.add(m(new THREE.CylinderGeometry(0.1195, 0.1195, 0.026, 12, 1, true, PI - 0.32, 0.64), pm, { p: [0, 0.019, 0], s: OVAL }));
    // pom-pom on a spring
    const pivot = new THREE.Group(); pivot.position.set(0, 0.126, 0.004); g.add(pivot);
    const pomTex = T.knit('pom' + c2, [c2, 0xf1e6cc, c2], { stripe: 0.33 });
    pivot.add(m(fuzzball(0.03, 0.22, 3), FM.fabric('hat_pom' + c2, pomTex, { sheen: 1, rough: 1 }), { p: [0, 0.026, 0] }));
    g.rotation.x = -0.26; g.position.set(0, 0.034, 0.012); g.scale.setScalar(0.92);
    return { object: g, jig: [{ obj: pivot, k: 55, d: 3.6, gain: 0.03, limit: 0.7 }] };
  },
  hardhat(e) {
    const g = new THREE.Group();
    const tex = T.paintedPlastic('hardhat', e.color ?? 0xf2c418, { decal: (c, w, h, r) => { c.fillStyle = css(0x1d1d1f, 0.85); c.fillRect(w * 0.42, h * 0.36, w * 0.16, h * 0.1); P.text(c, 'R.O.O.M.', w * 0.5, h * 0.41, 30, 0xf2c418, r, { maxW: w * 0.15 }); c.fillStyle = css(0x3e8a3e); c.beginPath(); c.arc(w * 0.82, h * 0.4, 16, 0, TAU); c.fill(); P.text(c, '+', w * 0.82, h * 0.4, 30, 0xffffff, r); } });
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.32, side: THREE.DoubleSide });
    const dome = prof([[0, 0.142], [0.06, 0.137], [0.1, 0.112], [0.118, 0.07], [0.122, 0.03]], 18);
    g.add(m(lathe([...dome, [0.123, 0.026], [0.118, 0.026]], 56), mat, { s: OVAL }));
    // ridge
    g.add(m(new THREE.TorusGeometry(0.135, 0.008, 8, 40, PI * 0.72), mat, { p: [0, 0.0, 0], r: [0, PI / 2, PI * 0.14], s: [1, 1.02, 0.95] }));
    // brim: a ring pushed out into a peak at the front
    const brim = displace(lathe([[0.12, 0.03], [0.14, 0.024], [0.152, 0.016], [0.154, 0.011], [0.12, 0.022]], 64), (x, y, z) => { const a = Math.atan2(x, -z), f = Math.max(0, Math.cos(a)) ** 2; const k = 1 + f * 0.32; return [x * (1 + f * 0.08), y - f * 0.012 * ((Math.hypot(x, z) - 0.12) / 0.034), z * k]; });
    g.add(m(brim, mat, { s: OVAL }));
    // suspension straps inside
    g.add(m(new THREE.TorusGeometry(0.1, 0.004, 6, 40), blackRubber(), { p: [0, 0.03, 0], r: [PI / 2, 0, 0], s: OVAL }));
    g.rotation.x = -0.12; g.position.set(0, 0.03, 0.006); g.scale.setScalar(0.9);
    return { object: g, jig: [{ obj: g, k: 140, d: 9, gain: 0.003, limit: 0.08 }] };
  },
  party(e) {
    const g = new THREE.Group();
    const c1 = e.color ?? 0x46b6e8, c2 = e.color2 ?? 0xf6d24a;
    const tex = ptex('hat_party', 512, 512, (c, w, h, r) => {
      P.wash(c, w, h, c1, { k: 0.1 });
      for (let i = -4; i < 12; i++) { c.fillStyle = css(c2, 0.95); c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64 + 22, 0); c.lineTo(i * 64 + 22 + 200, h); c.lineTo(i * 64 + 200, h); c.fill(); }
      for (let i = 0; i < 70; i++) { c.fillStyle = css([0xd23c4a, 0xf1e6cc, 0x3f8c8a][i % 3], 0.9); c.beginPath(); c.arc(r.next() * w, r.next() * h, 4 + r.next() * 5, 0, TAU); c.fill(); }
      P.strokes(c, w, h, c1, r, { n: 30, alpha: 0.1 });
      P.edgeWear(c, w, h, r, { amt: 0.5 });
    });
    const mat = FM.glazed('hat_party', tex, { rough: 0.5, cc: 0.4 });
    const cone = new THREE.ConeGeometry(0.06, 0.2, 40, 6, true);
    g.add(m(cone, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, clearcoat: 0.4, side: THREE.DoubleSide }), { p: [0, 0.2, 0] }));
    // crinkled foil tuft on top
    const piv = new THREE.Group(); piv.position.set(0, 0.3, 0); g.add(piv);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; piv.add(m(new THREE.PlaneGeometry(0.008, 0.04), FM.plain('hat_foil', 0xe8c050, { rough: 0.25, metal: 0.9 }), { p: [Math.cos(a) * 0.006, 0.016, Math.sin(a) * 0.006], r: [Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5] })); }
    // elastic under the chin
    const el = tube([V(-0.058, 0.1, 0.0), V(-0.075, 0.0, -0.01), V(-0.05, -0.1, -0.04), V(0, -0.125, -0.06), V(0.05, -0.1, -0.04), V(0.075, 0.0, -0.01), V(0.058, 0.1, 0.0)], 0.0012, 40, 4);
    g.add(m(el, FM.plain('hat_elastic', 0xf1e6cc, { rough: 0.7 }), { cast: false }));
    g.rotation.set(-0.15, 0, 0.18); g.position.set(-0.012, -0.004, 0.01);
    return { object: g, jig: [{ obj: g, k: 70, d: 4, gain: 0.012, limit: 0.25 }, { obj: piv, k: 60, d: 3, gain: 0.03, limit: 0.6 }] };
  },
  cone(e) {
    const g = new THREE.Group();
    const tex = T.paintedPlastic('cone', e.color ?? 0xf26a1b, { stripes: [[0.3, 0.12, 0xecebe4], [0.56, 0.08, 0xecebe4]] });
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, clearcoat: 0.3 });
    g.add(m(lathe([[0.012, 0.31], [0.016, 0.312], [0.024, 0.3], [0.098, 0.05], [0.104, 0.04], [0.1, 0.035]], 40), mat));
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.014, 0.2), mat);
    base.position.y = 0.032; g.add(base);
    g.position.set(0, 0.05, 0.008); g.rotation.x = -0.12; g.scale.setScalar(0.78);
    return { object: g, jig: [{ obj: g, k: 120, d: 6, gain: 0.006, limit: 0.15 }] };
  },
  propeller() {
    const g = new THREE.Group();
    const cols = [0xd23c4a, 0xf2c418, 0x2f6fd0, 0x3e8a3e];
    const tex = ptex('hat_propcap', 512, 256, (c, w, h, r) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = css(cols[i % 4]); c.fillRect((i / 8) * w, 0, w / 8 + 1, h); }
      for (let i = 0; i <= 8; i++) P.stitches(c, [[(i / 8) * w, 0], [(i / 8) * w, h]], r, { col: 0xf1e6cc, len: 6, gap: 4, wid: 2 });
      P.weave(c, w, h, 0x808080, r, { pitch: 3, alpha: 0.12 });
      P.blotches(c, w, h, 0x2a2018, r, { n: 4, r: 0.15, alpha: 0.12 });
    });
    const mat = FM.fabric('hat_propcap', tex, { sheen: 0.6, side: THREE.DoubleSide });
    g.add(m(lathe(prof([[0, 0.122], [0.05, 0.118], [0.088, 0.1], [0.104, 0.065], [0.108, 0.025]], 16), 64), mat, { s: OVAL }));
    // visor
    const vis = displace(new THREE.CylinderGeometry(0.11, 0.11, 0.004, 40, 1, false, PI * 0.72, PI * 0.56), (x, y, z) => { const d = Math.hypot(x, z), k = d > 0.05 ? 1 : 1; return [x * k, y - Math.max(0, -z - 0.06) * 0.15, z * (z < 0 ? 1.55 : 1) * k]; });
    g.add(m(vis, FM.plain('hat_visorred', 0xd23c4a, { rough: 0.55, sheen: 0.3 }), { p: [0, 0.026, 0], s: [0.95, 1, 1] }));
    const piv = new THREE.Group(); piv.position.set(0, 0.124, 0); g.add(piv);
    piv.add(m(new THREE.CylinderGeometry(0.004, 0.005, 0.022, 10), brassMat(), { p: [0, 0.01, 0] }));
    const rot = new THREE.Group(); rot.position.y = 0.022; piv.add(rot);
    for (const s of [-1, 1]) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.002, 0.016), FM.plain(s > 0 ? 'hat_blade1' : 'hat_blade2', s > 0 ? 0xf2c418 : 0x2f6fd0, { rough: 0.4, cc: 0.6 }));
      bl.position.x = s * 0.04; bl.rotation.x = s * 0.25; bl.castShadow = true; rot.add(bl);
    }
    rot.add(m(new THREE.SphereGeometry(0.007, 12, 8), FM.plain('hat_hubred', 0xd23c4a, { rough: 0.3, cc: 0.7 })));
    g.rotation.x = -0.14; g.position.set(0, 0.006, 0.008);
    return { object: g, spin: rot, jig: [{ obj: piv, k: 80, d: 4, gain: 0.015, limit: 0.4 }] };
  },
  chef(e) {
    const g = new THREE.Group();
    const tex = T.felt('chef', e.color ?? 0xf8f6f0, 0.08);
    const mat = FM.fabric('hat_chef', tex, { sheen: 0.4, rough: 0.9, side: THREE.DoubleSide });
    const puff = displace(lathe(prof([[0.104, 0.03], [0.108, 0.1], [0.13, 0.16], [0.14, 0.2], [0.12, 0.235], [0.05, 0.25], [0, 0.248]], 26), 64), (x, y, z) => { const a = Math.atan2(x, z), k = 1 + 0.05 * Math.sin(a * 14) * clamp((y - 0.06) / 0.1, 0, 1); return [x * k, y + 0.006 * Math.sin(a * 14) * clamp((y - 0.18) / 0.06, 0, 1), z * k]; });
    g.add(m(puff, mat, { s: OVAL }));
    g.add(m(lathe([[0.106, 0.0], [0.11, 0.004], [0.11, 0.05], [0.106, 0.054]], 64), mat, { s: OVAL }));
    g.rotation.x = -0.14; g.position.set(0, 0.036, 0.01); g.scale.setScalar(0.8);
    return { object: g, jig: [{ obj: g, k: 70, d: 5, gain: 0.01, limit: 0.2 }] };
  },
  sprout() {
    const g = new THREE.Group();
    const piv = new THREE.Group(); piv.position.set(0.02, 0.1, 0.004); piv.rotation.z = -0.2; g.add(piv);
    // a clump of soil stuck to the head, a curly stem, two leaves with painted veins
    piv.add(m(displace(new THREE.SphereGeometry(0.016, 14, 8, 0, TAU, 0, PI / 2), (x, y, z) => [x * (1 + 0.2 * Math.sin(z * 300)), y * 0.6, z]), FM.plain('hat_soil', 0x4a3420, { rough: 1 })));
    const stem = tube([V(0, 0, 0), V(0.004, 0.03, 0), V(-0.006, 0.055, 0.002), V(0.0, 0.075, 0)], 0.0026, 20, 6);
    piv.add(m(stem, FM.plain('hat_stem', 0x5a8a3a, { rough: 0.6, sheen: 0.3 })));
    const leafTex = ptex('hat_leaf', 128, 128, (c, w, h, r) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = css(0x6aa84a); c.beginPath(); c.moveTo(w / 2, h - 4); c.quadraticCurveTo(w - 4, h * 0.5, w / 2, 4); c.quadraticCurveTo(4, h * 0.5, w / 2, h - 4); c.fill();
      P.blotches(c, w, h, 0x8ac860, r, { n: 4, r: 0.2, alpha: 0.4 });
      c.strokeStyle = css(0xb8e090, 0.8); c.lineWidth = 2; c.beginPath(); c.moveTo(w / 2, h - 6); c.lineTo(w / 2, 10); c.stroke();
      for (let i = 1; i < 5; i++) { c.beginPath(); c.moveTo(w / 2, h - i * 22); c.lineTo(w / 2 + 22, h - i * 22 - 14); c.moveTo(w / 2, h - i * 22); c.lineTo(w / 2 - 22, h - i * 22 - 14); c.stroke(); }
    });
    const leafMat = cachedMat('hat_leafm', () => new THREE.MeshPhysicalMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xc8f0a0) }));
    for (const s of [-1, 1]) {
      const lf = new THREE.PlaneGeometry(0.034, 0.05, 2, 3); lf.translate(0, 0.025, 0);
      displace(lf, (x, y, z) => [x, y, z - Math.abs(x) * 0.3 + y * y * 2]);
      piv.add(m(lf, leafMat, { p: [0, 0.074, 0], r: [0.2, s * 0.9, s * 1.0] }));
    }
    return { object: g, jig: [{ obj: piv, k: 45, d: 3, gain: 0.03, limit: 0.6 }] };
  },
  headlamp() {
    const g = new THREE.Group();
    const strapTex = ptex('hat_strap', 512, 64, (c, w, h, r) => { P.wash(c, w, h, 0x2a3a4a); for (let x = 0; x < w; x += 12) { c.fillStyle = css(0xf1e6cc, 0.5); c.fillRect(x, h * 0.45, 6, 4); } P.weave(c, w, h, 0x2a3a4a, r, { pitch: 2, alpha: 0.3 }); });
    const strapMat = FM.fabric('hat_strapm', strapTex, { sheen: 0.4, side: THREE.DoubleSide });
    g.add(m(new THREE.CylinderGeometry(0.105, 0.108, 0.024, 56, 1, true), strapMat, { p: [0, 0.035, 0.002], s: OVAL, r: [-0.12, 0, 0] }));
    const lamp = new THREE.Group(); lamp.position.set(0, 0.04, -0.104); g.add(lamp);
    const body = new THREE.MeshPhysicalMaterial({ map: T.paintedPlastic('lamp', 0xd8a830), roughness: 0.45, clearcoat: 0.5 });
    lamp.add(m(new THREE.BoxGeometry(0.05, 0.034, 0.024), body, { p: [0, 0, -0.008] }));
    lamp.add(m(new THREE.CylinderGeometry(0.014, 0.016, 0.014, 24), body, { p: [0, 0, -0.024], r: [PI / 2, 0, 0] }));
    lamp.add(m(new THREE.CircleGeometry(0.012, 24), FM.plain('hat_lens', 0xfff4d0, { emissive: 0xfff0c8, ei: 2.2, rough: 0.1 }), { p: [0, 0, -0.0315], r: [0, PI, 0], cast: false }));
    lamp.add(m(new THREE.TorusGeometry(0.0145, 0.0022, 8, 24), FM.bare('hat_chrome', 0xd0d0cc, { rough: 0.2 }), { p: [0, 0, -0.031] }));
    g.add(m(new THREE.BoxGeometry(0.05, 0.03, 0.02), body, { p: [0, 0.04, 0.104] }));
    g.position.set(0, 0, 0.0);
    return { object: g, jig: [], lamp };
  },
  tophat(e) {
    const g = new THREE.Group();
    const base = e.color ?? 0x1d1c22;
    const tex = T.felt('tophat', base, 0.2);
    const mat = FM.fabric('hat_tophat', tex, { sheen: 0.9, rough: 0.8, side: THREE.DoubleSide });
    g.add(m(lathe([[0, 0.25], [0.08, 0.25], [0.086, 0.246], [0.09, 0.2], [0.088, 0.12], [0.092, 0.062], [0.098, 0.056]], 48), mat, { s: OVAL }));
    const band = ptex('hat_topband', 256, 64, (c, w, h, r) => { P.wash(c, w, h, 0x7a1e2a, { k: 0.2 }); P.weave(c, w, h, 0x7a1e2a, r, { pitch: 2, alpha: 0.3 }); });
    g.add(m(new THREE.CylinderGeometry(0.0905, 0.092, 0.03, 48, 1, true), FM.fabric('hat_topbandm', band, { sheen: 1 }), { p: [0, 0.078, 0], s: OVAL }));
    // brim curled up at the sides
    const brim = displace(lathe([[0.098, 0.058], [0.12, 0.056], [0.142, 0.054], [0.146, 0.058], [0.142, 0.052], [0.098, 0.052]], 64), (x, y, z) => { const a = Math.atan2(x, z), d = Math.hypot(x, z); return [x, y + Math.sin(a) ** 2 * Math.max(0, d - 0.1) * 0.6, z]; });
    g.add(m(brim, mat, { s: OVAL }));
    g.rotation.set(-0.1, 0, 0.06); g.position.set(0, 0.004, 0.008);
    return { object: g, jig: [{ obj: g, k: 90, d: 6, gain: 0.008, limit: 0.15 }] };
  },
  bunny(e) {
    const g = new THREE.Group();
    const fur = T.felt('bunny', e.color ?? 0xf3ece2, 0.1);
    const furMat = FM.fabric('hat_bunny', fur, { sheen: 1, rough: 1 });
    g.add(m(new THREE.TorusGeometry(0.084, 0.0055, 8, 48, PI), FM.plain('hat_bandpink', 0xe8a0b0, { rough: 0.4, cc: 0.4 }), { p: [0, 0.006, 0.012], r: [0, PI / 2, 0], s: [1, 1.2, 0.96] }));
    const jig = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.set(s * 0.04, 0.094, 0.016); piv.rotation.set(-0.15, 0, -s * 0.3); g.add(piv);
      const ear = new THREE.SphereGeometry(0.026, 20, 14); ear.scale(1, 3.2, 0.42); ear.translate(0, 0.075, 0);
      piv.add(m(ear, furMat));
      const inner = new THREE.SphereGeometry(0.018, 16, 10); inner.scale(1, 3.0, 0.3); inner.translate(0, 0.075, -0.0085);
      piv.add(m(inner, FM.fabric('hat_bunnyin', T.felt('bunnyin', 0xe8a0b0, 0.1), { sheen: 0.8 })));
      jig.push({ obj: piv, k: 50, d: 3, gain: 0.025, limit: 0.6 });
    }
    return { object: g, jig };
  },
  halo() {
    const g = new THREE.Group();
    const piv = new THREE.Group(); piv.position.set(0, 0.16, 0.005); g.add(piv);
    piv.add(m(new THREE.TorusGeometry(0.07, 0.007, 12, 48), cachedMat('hat_halo', () => new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd878, emissiveIntensity: 2.4, roughness: 0.3 })), { r: [PI / 2, 0, 0], cast: false }));
    return { object: g, jig: [], halo: piv };
  },
  crown() {
    const g = new THREE.Group();
    const gold = goldMat();
    // band with five points (a shape extruded round a ring)
    const n = 120, pts = [], I = [];
    const pos = [], uv = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU, R = 0.096, h = 0.035 + 0.04 * Math.max(0, Math.cos(a * 5)) ** 3;
      pos.push(Math.sin(a) * R, 0, Math.cos(a) * R, Math.sin(a) * R, h, Math.cos(a) * R);
      uv.push(i / n, 0, i / n, 1);
      if (i < n) I.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const band = new THREE.BufferGeometry(); band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); band.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); band.setIndex(I); band.computeVertexNormals();
    const gm = gold.clone(); gm.side = THREE.DoubleSide;
    g.add(m(band, gm, { s: OVAL }));
    g.add(m(new THREE.TorusGeometry(0.097, 0.004, 8, 64), gold, { r: [PI / 2, 0, 0], s: OVAL }));
    const gems = [0xb8202a, 0x2a5ab8, 0x2a9a4a];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      g.add(m(new THREE.SphereGeometry(0.0055, 12, 8), gold, { p: [Math.sin(a) * 0.096 * OVAL[0], 0.077, Math.cos(a) * 0.096] }));
      g.add(m(new THREE.OctahedronGeometry(0.008, 1), FM.plain('hat_gem' + k, gems[k % 3], { rough: 0.1, cc: 1 }), { p: [Math.sin(a) * 0.099 * OVAL[0], 0.018, Math.cos(a) * 0.099], s: [1, 1.2, 0.6], r: [0, a, 0] }));
    }
    const vel = T.felt('crownvel', 0x8a1e2a, 0.2);
    g.add(m(lathe(prof([[0.094, 0.01], [0.09, 0.05], [0.06, 0.09], [0, 0.1]], 10), 40), FM.fabric('hat_velvet', vel, { sheen: 1 }), { s: OVAL }));
    g.rotation.x = -0.12; g.position.set(0, 0.04, 0.006);
    return { object: g, jig: [{ obj: g, k: 120, d: 8, gain: 0.004, limit: 0.1 }] };
  },
};

// ---------------------------------------------------------------------------
// FACE GEAR (bone 'head'; head space: neck pivot origin, face toward -Z; eyes from robotshape)
function eyeSpots() {
  const L = eyeLayout('normal');
  return L.map((e) => { const n = V(); const c = eyeCentre(e, 'normal', V(), n); return { c, n, side: e.side }; });
}
const GEAR = {
  goggles() {
    const g = new THREE.Group();
    const strapTex = ptex('gear_gstrap', 512, 64, (c, w, h, r) => { P.wash(c, w, h, 0x6a4a2a, { k: 0.2 }); P.weave(c, w, h, 0x6a4a2a, r, { pitch: 2, alpha: 0.3 }); P.stitches(c, [[0, 8], [w, 8]], r, { col: 0xf1e6cc, len: 6, gap: 4 }); P.stitches(c, [[0, h - 8], [w, h - 8]], r, { col: 0xf1e6cc, len: 6, gap: 4 }); });
    const eyes = eyeSpots();
    const y = eyes[0].c.y, zf = eyes[0].c.z;
    g.add(m(new THREE.CylinderGeometry(0.088, 0.088, 0.02, 56, 1, true), FM.fabric('gear_gstrapm', strapTex, { sheen: 0.4, side: THREE.DoubleSide }), { p: [0, y + 0.004, HC.z + 0.004], s: [0.98, 1, 1.12] }));
    const brass = brassMat();
    for (const E of eyes) {
      const cup = new THREE.Group(); cup.position.set(E.c.x * 1.08, y, zf - 0.018); g.add(cup);
      cup.add(m(lathe([[0.019, 0.0], [0.021, 0.004], [0.021, 0.016], [0.019, 0.019], [0.017, 0.019]], 32), brass, { r: [-PI / 2, 0, 0] }));
      cup.add(m(new THREE.CircleGeometry(0.0175, 32), glassMat(0x9ad0c8, 0.3), { p: [0, 0, -0.019], r: [0, PI, 0], cast: false }));
      cup.add(m(new THREE.TorusGeometry(0.019, 0.0022, 8, 32), brass, { p: [0, 0, -0.019] }));
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; cup.add(m(new THREE.SphereGeometry(0.0014, 6, 4), brass, { p: [Math.cos(a) * 0.0205, Math.sin(a) * 0.0205, -0.012] })); }
    }
    g.add(m(tube([V(-0.012, y, zf - 0.03), V(0, y + 0.004, zf - 0.034), V(0.012, y, zf - 0.03)], 0.0025, 8, 6), brass));
    return { object: g, jig: [] };
  },
  glasses(dark = false) {
    const g = new THREE.Group();
    const eyes = eyeSpots();
    const frame = dark ? FM.plain('gear_shadesframe', 0x1d1b19, { rough: 0.3, cc: 0.8 }) : brassMat();
    const lens = dark ? cachedMat('gear_shadelens', () => new THREE.MeshPhysicalMaterial({ color: 0x1a1612, roughness: 0.05, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.88, envMapIntensity: 2 })) : glassMat(0xeaf4f0, 0.12);
    const rr = dark ? 0.021 : 0.019;
    for (const E of eyes) {
      const p = E.c.clone().addScaledVector(E.n, 0.019);
      const ring = dark ? new THREE.TorusGeometry(rr, 0.0032, 8, 32) : new THREE.TorusGeometry(rr, 0.0013, 8, 32);
      if (dark) ring.scale(1.12, 0.86, 1);
      g.add(m(ring, frame, { p: p.toArray() }));
      const L = new THREE.CircleGeometry(rr, 32); if (dark) L.scale(1.12, 0.86, 1);
      g.add(m(L, lens, { p: [p.x, p.y, p.z - 0.0005], r: [0, PI, 0], cast: false }));
      // temple arm back to the ear
      const s = E.side === 'L' ? -1 : 1;
      g.add(m(tube([V(p.x + s * rr * 1.05, p.y + 0.004, p.z), V(s * 0.082, p.y + 0.008, p.z + 0.04), V(s * 0.085, p.y + 0.004, HC.z + 0.02), V(s * 0.078, p.y - 0.016, HC.z + 0.045)], dark ? 0.0022 : 0.0011, 16, 5), frame));
    }
    const a = eyes[0].c.clone().addScaledVector(eyes[0].n, 0.019), b = eyes[1].c.clone().addScaledVector(eyes[1].n, 0.019);
    g.add(m(tube([V(a.x + Math.sign(b.x - a.x) * rr, a.y + 0.002, a.z), V((a.x + b.x) / 2, a.y + 0.008, a.z - 0.006), V(b.x - Math.sign(b.x - a.x) * rr, b.y + 0.002, b.z)], dark ? 0.0026 : 0.0012, 10, 5), frame));
    return { object: g, jig: [] };
  },
  face_shield() {
    const g = new THREE.Group();
    const y = HC.y + 0.035;
    const band = new THREE.MeshPhysicalMaterial({ map: T.paintedPlastic('shieldband', 0x3a3a3c), roughness: 0.5, clearcoat: 0.3 });
    g.add(m(new THREE.CylinderGeometry(0.094, 0.094, 0.02, 48, 1, true), band, { p: [0, y + 0.02, HC.z], s: [0.9, 1, 1.1] }));
    const vis = new THREE.CylinderGeometry(0.13, 0.13, 0.17, 40, 1, true, PI * 0.62, PI * 0.76);
    g.add(m(vis, glassMat(0xd8ecf0, 0.1), { p: [0, y - 0.065, HC.z + 0.01], s: [0.85, 1, 1.0], cast: false }));
    g.add(m(new THREE.TorusGeometry(0.13, 0.0025, 6, 40, PI * 0.76), band, { p: [0, y + 0.02, HC.z + 0.01], r: [PI / 2, 0, PI * 0.62 - PI / 2 + PI], s: [0.85, 1, 1] }));
    for (const s of [-1, 1]) g.add(m(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 16), FM.plain('gear_knob', 0x1d1b19, { rough: 0.4 }), { p: [s * 0.088, y + 0.02, HC.z + 0.0], r: [0, 0, PI / 2] }));
    return { object: g, jig: [] };
  },
  gas_mask_up() {
    const g = new THREE.Group();
    const rub = new THREE.MeshPhysicalMaterial({ map: T.paintedPlastic('mask', 0x3a4440), roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.5 });
    const cy = HC.y - 0.05, cz = HC.z - 0.085;
    const shell = new THREE.SphereGeometry(0.05, 32, 20, 0, TAU, 0, PI * 0.52); shell.rotateX(-PI / 2); shell.scale(1.0, 0.92, 0.78);
    g.add(m(shell, rub, { p: [0, cy + 0.004, HC.z - 0.084] }));
    const filt = new THREE.MeshPhysicalMaterial({ map: T.paintedPlastic('filter', 0x6a6e3a, { stripes: [[0.3, 0.12, 0xf1e6cc]] }), roughness: 0.5, clearcoat: 0.4 });
    for (const s of [-1, 1]) {
      const f = m(lathe([[0, 0], [0.019, 0], [0.021, 0.004], [0.021, 0.024], [0.016, 0.03], [0, 0.03]], 28), filt, { p: [s * 0.032, cy - 0.012, cz - 0.004], r: [-PI / 2 + 0.35, 0, -s * 0.6] });
      g.add(f);
    }
    g.add(m(new THREE.CylinderGeometry(0.012, 0.014, 0.012, 20), FM.bare('gear_valve', 0x8a8a84, { rough: 0.35 }), { p: [0, cy - 0.02, cz - 0.02], r: [PI / 2 - 0.3, 0, 0] }));
    g.add(m(new THREE.CylinderGeometry(0.086, 0.086, 0.012, 48, 1, true, -1.9, 3.8), blackRubber(), { p: [0, cy + 0.012, HC.z + 0.004], s: [0.98, 1, 1.12] }));
    return { object: g, jig: [] };
  },
};
GEAR.sunglasses = () => GEAR.glasses(true);

// ---------------------------------------------------------------------------
// ACCESSORIES (rest space -> bone local)
const CHEST_Y = RY.chest, PELVIS_Y = RY.pelvis, NECK_REST = RY.neck;
const ACC = {
  tie(e) {
    const g = new THREE.Group();
    const tex = ptex('acc_tie', 128, 512, (c, w, h, r) => {
      P.wash(c, w, h, e.color ?? 0x2f4f8f, { k: 0.12, angle: PI / 2 });
      for (let y = -w; y < h; y += 42) { c.strokeStyle = css(e.color2 ?? 0xc94a3a, 0.9); c.lineWidth = 9; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + w * 0.7); c.stroke(); }
      P.weave(c, w, h, 0x808080, r, { pitch: 2, alpha: 0.1 });
      P.blotches(c, w, h, 0x2a2018, r, { n: 4, r: 0.3, alpha: 0.15 });
    });
    const mat = FM.fabric('acc_tie', tex, { sheen: 0.8, side: THREE.DoubleSide });
    const p = coverPt(0, 1.43, 0.01, V());
    const knot = new THREE.Group(); knot.position.set(p.x, p.y - CHEST_Y, p.z); g.add(knot);
    const k = new THREE.SphereGeometry(0.014, 16, 10); k.scale(1, 1.1, 0.6);
    knot.add(m(k, mat));
    const piv = new THREE.Group(); piv.position.y = -0.012; knot.add(piv);
    const blade = new THREE.Shape(); blade.moveTo(-0.012, 0); blade.lineTo(0.012, 0); blade.lineTo(0.026, -0.28); blade.lineTo(0, -0.31); blade.lineTo(-0.026, -0.28); blade.closePath();
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.003, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2 });
    const uvs = bg.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 4 + 0.5, uvs.getY(i) * 3 + 1);
    piv.add(m(bg, mat, { p: [0, 0, -0.004] }));
    piv.rotation.x = 0.12;
    return { object: g, bone: 'chest', jig: [{ obj: piv, k: 45, d: 3, gain: 0.02, limit: 0.5, mode: 'hang' }] };
  },
  bowtie(e) {
    const g = new THREE.Group();
    const tex = ptex('acc_bow', 256, 128, (c, w, h, r) => { P.wash(c, w, h, e.color ?? 0xd23c4a, { k: 0.15 }); for (let i = 0; i < 40; i++) { c.fillStyle = css(0xf1e6cc, 0.85); c.beginPath(); c.arc(r.next() * w, r.next() * h, 4, 0, TAU); c.fill(); } P.weave(c, w, h, 0x808080, r, { pitch: 2, alpha: 0.12 }); });
    const mat = FM.fabric('acc_bowm', tex, { sheen: 0.8 });
    const p = coverPt(0, 1.445, 0.012, V());
    const b = new THREE.Group(); b.position.set(p.x, p.y - CHEST_Y, p.z - 0.004); g.add(b);
    for (const s of [-1, 1]) { const w = new THREE.SphereGeometry(0.02, 16, 10); w.scale(1.4, 0.9, 0.45); w.translate(s * 0.024, 0, 0); displace(w, (x, y, z) => [x, y * (1 + Math.abs(x) * 12), z]); b.add(m(w, mat)); }
    b.add(m(new THREE.SphereGeometry(0.009, 12, 8), mat, { s: [1, 1.1, 0.8] }));
    return { object: g, bone: 'chest', jig: [] };
  },
  lei() {
    const g = new THREE.Group();
    const cols = [0xf25a8a, 0xf2c418, 0xf1e6cc, 0xe8743a, 0xb06ad0];
    const petal = ptex('acc_petal', 128, 128, (c, w, h, r) => { c.clearRect(0, 0, w, h); for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; c.fillStyle = css(0xffffff); c.beginPath(); c.ellipse(w / 2 + Math.cos(a) * 26, h / 2 + Math.sin(a) * 26, 26, 17, a, 0, TAU); c.fill(); } c.fillStyle = css(0xf2c418); c.beginPath(); c.arc(w / 2, h / 2, 12, 0, TAU); c.fill(); P.blotches(c, w, h, 0xd8c8a0, r, { n: 3, r: 0.2, alpha: 0.3 }); });
    const N = 30;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, droop = Math.max(0, Math.cos(a)) * 0.07;
      const p = coverPt(a, 1.43 - droop, 0.016, V()), n = coverNrm(a, 1.43 - droop, V());
      const mat = cachedMat('acc_flower' + (i % 5), () => new THREE.MeshPhysicalMaterial({ map: petal, color: cols[i % 5], alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, sheen: 0.6, sheenColor: new THREE.Color(cols[i % 5]) }));
      const f = m(new THREE.PlaneGeometry(0.034, 0.034), mat, { p: [p.x, p.y - CHEST_Y, p.z] });
      f.lookAt(f.position.clone().add(n)); f.rotateZ(i * 1.7);
      g.add(f);
    }
    return { object: g, bone: 'chest', jig: [] };
  },
  headphones() {
    const g = new THREE.Group();
    const shell = new THREE.MeshPhysicalMaterial({ map: T.paintedPlastic('phones', 0xd8d0c0, { stripes: [[0.45, 0.1, 0xc4572a]] }), roughness: 0.4, clearcoat: 0.5 });
    const y = 1.44 - CHEST_Y + 0.0;
    g.add(m(new THREE.TorusGeometry(0.1, 0.007, 8, 40, PI), shell, { p: [0, y + 0.02, 0.03], r: [-1.2, 0, 0], s: [1, 1, 1] }));
    for (const s of [-1, 1]) {
      const cup = new THREE.Group(); cup.position.set(s * 0.1, y, -0.01); cup.rotation.set(0.6, s * 0.4, 0); g.add(cup);
      cup.add(m(lathe([[0, 0], [0.034, 0], [0.036, 0.008], [0.034, 0.022], [0, 0.024]], 28), shell, { r: [0, 0, s * PI / 2] }));
      cup.add(m(new THREE.TorusGeometry(0.03, 0.009, 10, 28), FM.plain('acc_pad', 0x2a2420, { rough: 0.8, sheen: 0.4 }), { r: [0, PI / 2, 0], p: [-s * 0.004, 0, 0] }));
    }
    g.add(m(tube([V(0.1, y - 0.02, -0.01), V(0.11, y - 0.08, -0.06), V(0.09, y - 0.18, -0.11), V(0.07, y - 0.24, -0.11)], 0.0018, 20, 5), blackRubber()));
    return { object: g, bone: 'chest', jig: [] };
  },
  bell() {
    const g = new THREE.Group();
    const p = coverPt(0, 1.445, 0.008, V());
    g.add(m(new THREE.TorusGeometry(0.075, 0.006, 8, 48), FM.fabric('acc_collar', T.felt('collar', 0xc8302a, 0.2), { sheen: 0.6 }), { p: [0, 1.445 - CHEST_Y, 0.006], r: [PI / 2 + 0.1, 0, 0], s: [1.05, 1.0, 1] }));
    const piv = new THREE.Group(); piv.position.set(p.x, p.y - CHEST_Y - 0.006, p.z - 0.004); g.add(piv);
    const gold = goldMat();
    piv.add(m(new THREE.SphereGeometry(0.016, 20, 14), gold, { p: [0, -0.018, 0] }));
    piv.add(m(new THREE.TorusGeometry(0.004, 0.0015, 6, 12), gold, { p: [0, -0.002, 0] }));
    piv.add(m(new THREE.BoxGeometry(0.02, 0.002, 0.01), FM.plain('acc_slit', 0x2a1a0a), { p: [0, -0.024, -0.012] }));
    return { object: g, bone: 'chest', jig: [{ obj: piv, k: 40, d: 2.6, gain: 0.03, limit: 0.7, mode: 'hang' }] };
  },
  badge() {
    const g = new THREE.Group();
    const tex = ptex('acc_badge', 256, 256, (c, w, h, r) => {
      c.fillStyle = css(0xe8b84a); c.beginPath(); c.arc(w / 2, h / 2, w * 0.48, 0, TAU); c.fill();
      c.fillStyle = css(0x2a3a6a); c.beginPath(); c.arc(w / 2, h / 2, w * 0.4, 0, TAU); c.fill();
      P.text(c, 'EMPLOYEE', w / 2, h * 0.34, 36, 0xf1e6cc, r, { maxW: w * 0.66 }); P.text(c, 'of the', w / 2, h * 0.5, 30, 0xf1e6cc, r); P.text(c, 'MONTH', w / 2, h * 0.66, 44, 0xe8b84a, r);
      P.chips(c, w, h, 0x8a6a2a, r, { n: 8, s: 0.01 });
    });
    const p = coverPt(-0.32, 1.3, 0.01, V());
    const disc = new THREE.CylinderGeometry(0.026, 0.026, 0.005, 32); disc.rotateX(PI / 2);
    const mat = cachedMat('acc_badgem', () => new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, metalness: 0.3, clearcoat: 1 }));
    const bm = m(disc, [FM.bare('acc_badgerim', 0xe8b84a, { rough: 0.3 }), mat, mat], { p: [p.x, p.y - CHEST_Y, p.z] });
    bm.rotation.y = PI - 0.3;
    g.add(bm);
    const rib = new THREE.Shape(); rib.moveTo(-0.012, 0); rib.lineTo(0.012, 0); rib.lineTo(0.012, -0.04); rib.lineTo(0, -0.032); rib.lineTo(-0.012, -0.04); rib.closePath();
    for (const s of [-1, 1]) { const rg = new THREE.ShapeGeometry(rib); const r2 = m(rg, FM.plain('acc_ribbon' + s, s > 0 ? 0x2a5ab8 : 0xc4302a, { rough: 0.6, sheen: 0.5 }), { p: [p.x + s * 0.008, p.y - CHEST_Y - 0.012, p.z - 0.004], r: [0, PI - 0.3, s * 0.15] }); r2.material.side = THREE.DoubleSide; g.add(r2); }
    return { object: g, bone: 'chest', jig: [] };
  },
  fannypack(e) {
    const g = new THREE.Group();
    const tex = T.canvas('fanny', e.color ?? 0x2c2f35, { rows: [0.2, 0.8], band: [0.46, 0.06, 0xc4572a], stains: 3 });
    const mat = FM.fabric('acc_fanny', tex, { sheen: 0.4 });
    const p = coverPt(0, 0.93, 0.03, V());
    const pouch = new THREE.SphereGeometry(0.06, 24, 16); pouch.scale(1.6, 0.85, 0.6);
    g.add(m(pouch, mat, { p: [p.x, p.y - PELVIS_Y, p.z - 0.008] }));
    g.add(m(tube([V(-0.09, 0.0, -0.02), V(0, 0.026, -0.05), V(0.09, 0.0, -0.02)].map((v) => v.add(V(p.x, p.y - PELVIS_Y, p.z))), 0.0018, 16, 5), FM.bare('acc_zip', 0xb8b4aa, { rough: 0.3 })));
    const strap = new THREE.CylinderGeometry(0.17, 0.17, 0.022, 48, 1, true);
    g.add(m(strap, FM.fabric('acc_fstrap', T.canvas('fstrap', 0x1d1e21, { stains: 1 }), { sheen: 0.3, side: THREE.DoubleSide }), { p: [0, 0.94 - PELVIS_Y, 0.006], s: [1.0, 1, 0.64] }));
    g.add(m(new THREE.BoxGeometry(0.03, 0.03, 0.008), FM.plain('acc_buckle', 0x1d1b19, { rough: 0.4 }), { p: [0.16, 0.94 - PELVIS_Y, -0.03] }));
    return { object: g, bone: 'pelvis', jig: [] };
  },
};

// ---------------------------------------------------------------------------
const BONE_OF = { hat: 'hat', visor: 'head' };
export function buildCosmeticModel(slot, entry) {
  const id = typeof entry === 'string' ? entry : entry?.id;
  if (!id || id === 'none') return null;
  const e = typeof entry === 'string' ? { id } : entry;
  const tbl = slot === 'hat' ? HATS : slot === 'visor' ? GEAR : slot === 'accessory' ? ACC : null;
  const f = tbl?.[id];
  if (!f) return null;
  const r = f(e);
  r.bone = r.bone || BONE_OF[slot];
  r.object.name = slot + '_' + id;
  for (const J of r.jig || []) J.obj.userData.baseRot = J.obj.rotation.clone();
  return r;
}
export const hasCosmeticModel = (slot, id) => !!(slot === 'hat' ? HATS : slot === 'visor' ? GEAR : ACC)[id];
void HR; void FACE; void plateOff; void RD; void NECK_Z; void HEAD_Z; void TX; void mixHex; void NECK_REST;
