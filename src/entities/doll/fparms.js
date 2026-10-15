// R.O.O.M. — first-person viewmodel arms: the clone android's bare ABS forearms (clamshell seams,
// screws, a part number), rubber wrist bellows and articulated plastic hands with rubber palm pads,
// plus the chunky corporate wrist terminal strapped to the left forearm (its 4:3 'watchScreen' plane
// receives the watch UI canvas). Camera space: forearms point along -Z.
//
// buildFirstPersonArms(cosmetics, opts) -> { root, rightHand, leftHand, watchScreen, update(dt, st), dispose }
import * as THREE from 'three';
import { clamp, lerp, smooth, damp, Spring } from './kit.js';
import { labelTexture } from '../../gfx/textures.js';
import { valueNoise2 } from '../../core/rng.js';
import { resolveCos, DEFAULT_COSMETICS } from './dollcos.js';
import { robotMaterial } from './robotmat.js';
import { handParts, HAND } from './robotbody.js';
import { vcol, region, frameAt, screwGeo } from './robothead.js';
import { grid, displace, tint, ensureOutward, gridArcUV, pillow, gauss, ss } from './geom.js';
import { decalQuad, toRegion as toRegionFP } from './gear.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V();
const nz = (x, y, s) => valueNoise2(x, y, s) - 0.5;

// tiny skinned builder for the viewmodel bones
class FPBuilder {
  constructor(bones) { this.bones = bones; this.lists = new Map(); this.rest = new Map(); }
  restM(name) {
    if (!this.rest.has(name)) { const b = this.bones[name]; b.updateMatrixWorld(true); this.rest.set(name, b.matrixWorld.clone()); }
    return this.rest.get(name);
  }
  add(mat, geo, weightFn, color = 0xffffff, local = null) {
    const g = geo.index ? geo : geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count, c = new THREE.Color(color);
    if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const col = g.attributes.color.array; for (let i = 0; i < n; i++) { col[i * 3] *= c.r; col[i * 3 + 1] *= c.g; col[i * 3 + 2] *= c.b; }
    if (local) g.applyMatrix4(this.restM(local));
    const P = g.attributes.position, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const w = weightFn(P.getX(i), P.getY(i), P.getZ(i));
      let tot = 0; for (const [, ww] of w) tot += ww;
      w.slice(0, 4).forEach(([bn, ww], k) => { si[i * 4 + k] = this.bones[bn].userData.i; sw[i * 4 + k] = ww / tot; });
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
  }
}

export function buildFirstPersonArms(cosmetics = DEFAULT_COSMETICS, opts = {}) {
  const cos = resolveCos(cosmetics);
  const L = 0.34, AR = 0.064, HS = 1.22;   // forearm length, terminal cuff base radius, hand scale
  const root = new THREE.Group(); root.name = 'FPArms';
  // bones
  const bones = {}, list = [];
  const mk = (name, parent, p) => { const b = new THREE.Bone(); b.name = name; b.position.set(...p); b.userData.i = list.length; list.push(b); bones[name] = b; if (parent) bones[parent].add(b); return b; };
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    mk('fore' + S, null, [s * 0.3, -0.4, -0.1]);
    mk('wr' + S, 'fore' + S, [0, 0, -L]);
    mk('fing' + S, 'wr' + S, [0, 0, -HAND.fi[1] * -HS]);
    mk('fingT' + S, 'fing' + S, [0, 0, HAND.fj[1] * HS]);
    mk('ix' + S, 'wr' + S, [s * HAND.ix[2] * HS, 0, HAND.ix[1] * HS]);
    mk('thumb' + S, 'wr' + S, [-s * 0.03 * HS, -0.012 * HS, -0.03 * HS]);
    root.add(bones['fore' + S]);
  }
  root.updateMatrixWorld(true);
  const B = new FPBuilder(bones);
  const restMs = list.map((b) => { b.updateMatrixWorld(true); return b.matrixWorld.clone(); });

  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const fore = 'fore' + S, wr = 'wr' + S, fing = 'fing' + S;
    const Mf = restMs[bones[fore].userData.i];
    // ABS forearm: elliptical clamshell along -Z, seams on both sides, tapering to the wrist
    const prof = (z) => { const t = clamp((0.12 - z) / (0.12 + L - 0.03), 0, 1); return lerp(0.058, 0.045, ss(0.1, 0.95, t)) * (z < -L + 0.05 ? 1 - 0.35 * ss(-L + 0.05, -L + 0.022, z) : 1); };
    const zs = (j) => lerp(0.12, -L + 0.024, j / 40);
    const fa = grid(36, 41, (i, j, p) => {
      const a = (i / 36) * TAU, z = j > 40 ? -L + 0.018 : zs(j), r = j > 40 ? 0 : prof(z);
      p.set(Math.cos(a) * r, Math.sin(a) * r * 0.88, z);
    }, { closedU: true, poleTop: true });
    ensureOutward(fa, V(0, 0, -0.1));
    vcol(fa, (x, y, z) => {
      const seam = gauss(y, 0, 0.0016) * ss(0.03, 0.04, Math.abs(x));
      const scuff = Math.max(0, nz(x * 70 + z * 40, y * 70 + s, 4) * 2 - 0.6) * 0.18;
      return (1 - 0.55 * seam - scuff) * (0.95 + nz(x * 50, z * 50 + 3, 2) * 0.06);
    });
    fa.applyMatrix4(Mf);
    B.add('shell', fa, () => [[fore, 1]]);
    // screws + part number on the inner (medial) side, a panel line near the elbow
    for (const z of [-0.06, -0.27]) {
      const r = prof(z), pp = V(-s * r * 0.98, 0, z), nn = V(-s, 0, 0);
      for (const g of screwGeo(pp, nn, 0.0032)) B.add('metal', g.applyMatrix4(Mf), () => [[fore, 1]], 0xb4b0a6);
    }
    {
      const lab = region(new THREE.PlaneGeometry(0.075, 0.0095), 'serial').rotateY(-s * PI / 2).translate(-s * prof(-0.17) * 0.99, -0.012, -0.17);
      B.add('decal', vcol(lab, 1).applyMatrix4(Mf), () => [[fore, 1]]);
    }
    // wrist: steel collar + rubber bellows (bends with the hand)
    const Mw = restMs[bones[wr].userData.i], winv = Mw.clone().invert();
    B.add('metal', vcol(new THREE.CylinderGeometry(0.036, 0.04, 0.012, 22).rotateX(PI / 2).translate(0, 0, -L + 0.026), 0.35).applyMatrix4(Mf), () => [[fore, 1]]);
    {
      const N = 6, pr = [];
      for (let i = 0; i <= N; i++) pr.push(new THREE.Vector2(i % 2 ? 0.032 : 0.028, 0.02 - (i / N) * 0.036));
      const bel = new THREE.LatheGeometry(pr, 22).rotateX(-PI / 2);
      bel.applyMatrix4(Mw);
      B.add('rubber', vcol(bel, 0.14), (x, y, z) => { const lz = _v3.set(x, y, z).applyMatrix4(winv).z; const k = ss(0.012, -0.012, lz); return [[fore, 1 - k + 1e-4], [wr, k]]; });
    }
    // articulated hand: the third-person android hand remapped (fingers along -Z, palm down, thumb medial)
    const Mg = new THREE.Matrix4().set(0, 0, s, 0, s, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1).multiply(new THREE.Matrix4().makeScale(HS, HS, HS));
    const boneOf = { wr: wr, fi: 'fing' + S, fj: 'fingT' + S, ix: 'ix' + S, th: 'thumb' + S };
    for (const part of handParts(S)) {
      const bn = boneOf[part.bone];
      const g = part.geo.applyMatrix4(Mg).applyMatrix4(restMs[bones[bn].userData.i]);
      B.add(part.mat, g, () => [[bn, 1]]);
    }
  }
  // wrist terminal on the left forearm (top, +Y): a chunky retro Pip-Boy-style
  // unit. Olive-drab housing clamped round the sleeve by a ribbed cuff, a thick rounded bezel
  // around the recessed CRT (watchScreen) under a domed glass, a knurled tuning dial + selector
  // knob and status lamp on the wrist side, push buttons and the name plate on the elbow side.
  const WZ = -L + 0.118, WY = AR + 0.017, OLIVE = 0x596043, OLIVE_D = 0x3c4130, TRIM = 0x26272a;
  const Mf = restMs[bones.foreL.userData.i];
  const addL = (mat, g, col) => B.add(mat, g.applyMatrix4(Mf), () => [['foreL', 1]], col);
  // clamp cuff round the sleeve (ribbed at both ends)
  const cuff = grid(48, 10, (i, j, p) => {
    const a = (i / 48) * TAU, v = j / 10, z = WZ + (v - 0.5) * 0.12;
    const r = AR + 0.0135 + 0.0035 * (ss(0.12, 0.0, v) + ss(0.88, 1.0, v)) + 0.002 * Math.sin(PI * v);
    p.set(Math.cos(a) * r, Math.sin(a) * r, z);
  }, { closedU: true });
  ensureOutward(cuff, V(0, 0, WZ));
  tint(cuff, (x, y, z) => 0.92 + 0.08 * Math.cos((z - WZ) * 160));
  addL('plastic', cuff, OLIVE_D);
  for (const e of [-1, 1]) addL('metal', new THREE.TorusGeometry(AR + 0.0175, 0.0022, 6, 40).translate(0, 0, WZ + e * 0.061), 0x8a8e84);
  // the unit is made for a fatter wrist: rubber packing rings wedge it onto the android's forearm
  for (const e of [-1, 1]) {
    const ring = new THREE.RingGeometry(0.044, AR + 0.0145, 36, 1).translate(0, 0, WZ + e * 0.0605);
    if (e > 0) ring.rotateY(PI).translate(0, 0, 2 * (WZ + 0.0605));
    addL('rubber', vcol(ring, 0.1), 0xffffff);
    addL('rubber', vcol(new THREE.TorusGeometry(0.047, 0.004, 6, 30).translate(0, 0, WZ + e * 0.058), 0.12), 0xffffff);
  }
  // main housing on top + side cheeks
  const body = pillow(0.096, 0.036, 0.138); body.translate(0, WY - 0.007, WZ);
  addL('plastic', body, OLIVE);
  for (const e of [-1, 1]) addL('plastic', pillow(0.016, 0.03, 0.12).translate(e * 0.05, WY - 0.014, WZ), OLIVE_D);
  // corner screws
  for (const [x, z] of [[-0.04, -0.06], [0.04, -0.06], [-0.04, 0.06], [0.04, 0.06]]) addL('metal', new THREE.CylinderGeometry(0.003, 0.003, 0.003, 8).translate(x, WY + 0.0125, WZ + z), 0xb8bcb4);
  // thick rounded bezel around the screen (screen 0.045 across x 0.06 along z, recessed)
  {
    const rr = (sh, w, h, r) => { const x = -w / 2, y = -h / 2; sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h); sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y); return sh; };
    const shape = rr(new THREE.Shape(), 0.066, 0.082, 0.011);
    shape.holes.push(rr(new THREE.Path(), 0.052, 0.067, 0.006));
    const bz = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.0022, bevelSegments: 2, curveSegments: 4 });
    bz.rotateX(-PI / 2).translate(0, WY + 0.0115, WZ);
    addL('plastic', bz, TRIM);
    // dark CRT surround inside the bezel
    addL('plastic', new THREE.BoxGeometry(0.054, 0.004, 0.069).translate(0, WY + 0.0105, WZ), 0x0c0d0c);
  }
  // knurled tuning dial (wrist side) with a ticked face, small selector knob, status lamp
  {
    const dz = WZ - 0.052, dx = 0.017, R = 0.0125, H = 0.012;
    const knob = new THREE.CylinderGeometry(R, R * 1.06, H, 32, 1);
    const P = knob.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), r = Math.hypot(x, z); if (r > R * 0.9) { const a = Math.atan2(z, x), k = 1 + 0.06 * (Math.cos(a * 16) > 0 ? 1 : -1); P.setX(i, x * k); P.setZ(i, z * k); } }
    knob.computeVertexNormals();
    addL('plastic', knob.translate(dx, WY + 0.013 + H / 2, dz), 0x2c2d2a);
    addL('metal', new THREE.CylinderGeometry(R * 1.2, R * 1.25, 0.003, 28).translate(dx, WY + 0.0135, dz), 0x9a9e94);
    const face = new THREE.CircleGeometry(R * 0.86, 24); toRegionFP(face, 'bezel'); face.rotateX(-PI / 2).rotateY(PI / 2).translate(dx, WY + 0.0132 + H + 0.0004, dz);
    addL('decal', face, 0xffffff);
    const sel = new THREE.CylinderGeometry(0.0075, 0.008, 0.009, 6); sel.translate(-0.02, WY + 0.0175, dz);
    addL('plastic', sel, 0x2c2d2a);
    addL('plastic', new THREE.BoxGeometry(0.0025, 0.003, 0.009).translate(-0.02, WY + 0.0225, dz), 0xd8d2c0);
    const lamp = new THREE.SphereGeometry(0.0042, 12, 8, 0, TAU, 0, PI / 2); toRegionFP(lamp, 'glow'); lamp.translate(-0.002, WY + 0.0128, dz + 0.004);
    addL('decal', lamp, 0xffb040);
    addL('metal', new THREE.TorusGeometry(0.0048, 0.0013, 6, 14).rotateX(PI / 2).translate(-0.002, WY + 0.013, dz + 0.004), 0xa8aca4);
  }
  // push buttons + name plate (elbow side)
  for (const [k, col] of [[-1, 0xb8322a], [0, 0xd8a432], [1, 0x8a8c84]]) {
    const b = pillow(0.011, 0.007, 0.008); b.translate(k * 0.016 - 0.008, WY + 0.0145, WZ + 0.055);
    addL('rubber', b, col);
  }
  addL('plastic', pillow(0.0115, 0.004, 0.046).translate(-0.0415, WY + 0.0118, WZ + 0.004), 0x111111);
  addL('decal', decalQuad(0.042, 0.0092, 'name').rotateX(-PI / 2).rotateY(PI / 2).translate(-0.0415, WY + 0.0141, WZ + 0.004), 0xffffff);
  // side tuning knob (outer edge) + a short antenna stub toward the elbow
  addL('plastic', new THREE.CylinderGeometry(0.011, 0.011, 0.012, 20).rotateZ(PI / 2).translate(-0.06, WY - 0.004, WZ - 0.02), 0x2c2d2a);
  addL('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.006, 14).rotateZ(PI / 2).translate(-0.0525, WY - 0.004, WZ - 0.02), 0x9a9e94);
  addL('metal', new THREE.CylinderGeometry(0.0022, 0.0022, 0.03, 8).rotateX(PI / 2).translate(-0.04, WY + 0.008, WZ + 0.08), 0x8a8e88);
  addL('plastic', new THREE.SphereGeometry(0.0038, 10, 8).translate(-0.04, WY + 0.008, WZ + 0.095), 0x1a1a1a);
  // build meshes
  const skeleton = new THREE.Skeleton(list, restMs.map((m) => m.clone().invert()));
  const meshes = [];
  for (const [key, glist] of B.lists) {
    const geo = glist.length === 1 ? glist[0] : mergeSimpleSkinned(glist);
    const mesh = new THREE.SkinnedMesh(geo, robotMaterial(key, cos));
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.name = 'fp_' + key;
    meshes.push(mesh); root.add(mesh);
  }
  const screenTex = labelTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#0c1a10'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#62ff8e'; ctx.font = "96px 'VT323', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('03:33', w / 2, h / 2 + 6);
  });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.0, roughness: 0.25 });
  const watchScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.045), screenMat);
  watchScreen.name = 'watchScreen';
  watchScreen.position.set(0, WY + 0.0134, WZ);
  watchScreen.rotation.set(-PI / 2, 0, PI / 2);
  bones.foreL.add(watchScreen);
  // raised CRT glass: a convex dome over the recessed screen (same plane frame as the screen)
  const glassGeo = new THREE.PlaneGeometry(0.0635, 0.0485, 16, 12);
  { const P = glassGeo.attributes.position; for (let i = 0; i < P.count; i++) { const u = P.getX(i) / 0.03175, v = P.getY(i) / 0.02425; P.setZ(i, 0.0055 * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v) ** 0.8); } glassGeo.computeVertexNormals(); }
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({ color: 0x9ab09a, transparent: true, opacity: 0.08, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6, depthWrite: false }));
  glass.position.set(0, WY + 0.0142, WZ); glass.rotation.copy(watchScreen.rotation);
  bones.foreL.add(glass);
  const rightHand = new THREE.Object3D(); rightHand.name = 'rightHand';
  const leftHand = new THREE.Object3D(); leftHand.name = 'leftHand';
  bones.wrR.add(rightHand); bones.wrL.add(leftHand);
  if (opts.light) {
    root.add(new THREE.HemisphereLight(0xfff4dc, 0x40382a, 1.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(0.5, 1, 0.6); root.add(dl);
  }

  // pose library (camera space): h = wrist, d = forearm direction, u = forearm top (watch side)
  const POSE = {
    R: { h: V(0.205, -0.215, -0.39), d: V(-0.25, 0.42, -0.87), u: V(-0.45, 0.85, 0.3) },
    L: { h: V(-0.215, -0.225, -0.39), d: V(0.25, 0.42, -0.87), u: V(0.45, 0.85, 0.3) },
    hold: { h: V(0.17, -0.19, -0.4), d: V(-0.15, 0.35, -0.92), u: V(-0.3, 0.9, 0.3) },
    grab: { h: V(0.1, -0.12, -0.5), d: V(-0.12, 0.22, -0.97), u: V(-0.15, 0.95, 0.2) },
    use: { h: V(0.06, -0.1, -0.19), d: V(-0.65, 0.6, -0.45), u: V(-0.3, 0.3, 0.9) },
    throw: { h: V(0.2, 0.0, -0.3), d: V(0.12, 0.85, 0.45), u: V(-0.2, -0.45, 0.85) },
    release: { h: V(0.06, -0.15, -0.58), d: V(-0.15, 0.1, -0.98), u: V(0, 1, 0) },
    lowR: { h: V(0.24, -0.38, -0.32), d: V(-0.1, 0.4, -0.9), u: V(-0.3, 0.9, 0.3) },
  };
  const Wc = V(-0.005, -0.014, -0.13);
  const wd = V(1, 0.12, 0.08).normalize(), wu = V(0, 0.08, 1).normalize();
  POSE.watch = { h: Wc.clone().addScaledVector(wd, L + WZ).sub(wu.clone().multiplyScalar(WY + 0.0134)), d: wd, u: wu };
  const _B = new THREE.Matrix4();
  function placeArm(S, h, d, u) {
    const fore = bones['fore' + S];
    const dn = _v1.copy(d).normalize();
    const zl = _v2.copy(dn).negate();
    const xl = _v3.crossVectors(u, zl).normalize();
    const yl = _v4.crossVectors(zl, xl);
    _B.makeBasis(xl, yl, zl);
    fore.quaternion.setFromRotationMatrix(_B);
    fore.position.copy(h).addScaledVector(dn, -L);
  }
  placeArm('R', POSE.hold.h, POSE.hold.d, POSE.hold.u);
  root.updateMatrixWorld(true);
  {
    const wq = bones.wrR.getWorldQuaternion(new THREE.Quaternion());
    rightHand.quaternion.copy(wq).invert(); rightHand.position.set(0, -0.012, -0.045);
    leftHand.quaternion.copy(rightHand.quaternion); leftHand.position.set(0, -0.012, -0.045);
  }
  const st = {
    phase: 0, t: 0, prevCharge: 0, release: 0,
    sR: { x: POSE.R.h.clone(), v: V(0, 0, 0) }, sL: { x: POSE.L.h.clone(), v: V(0, 0, 0) },
    sway: V(0, 0, 0), swayV: V(0, 0, 0), land: new Spring(160, 9, 0), curl: 0, bob: 0,
    w: { watch: 0, grab: 0, use: 0, thr: 0, hold: 0 },
  };
  const tmp = { h: V(0, 0, 0), d: V(0, 0, 0), u: V(0, 0, 0) };
  const blendPose = (out, bP, w) => { out.h.lerp(bP.h, w); out.d.lerp(bP.d, w); out.u.lerp(bP.u, w); };
  const stepSpring = (sp, target, dt, k, z) => {
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), hh = dt / n, d = 2 * z * Math.sqrt(k);
    for (let i = 0; i < n; i++) { _v1.subVectors(target, sp.x).multiplyScalar(k).addScaledVector(sp.v, -d); sp.v.addScaledVector(_v1, hh); sp.x.addScaledVector(sp.v, hh); }
    if (sp.x.distanceToSquared(target) > 0.25) { sp.x.copy(target); sp.v.set(0, 0, 0); }
    return sp.x;
  };
  function update(dt, s = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    const w = st.w;
    w.watch = damp(w.watch, clamp(s.watchRaised || 0, 0, 1), 10, dt);
    w.grab = damp(w.grab, clamp(s.grab || 0, 0, 1), 12, dt);
    w.use = damp(w.use, clamp(s.use || 0, 0, 1), 9, dt);
    w.thr = damp(w.thr, clamp(s.throwCharge || 0, 0, 1), 12, dt);
    w.hold = damp(w.hold, s.holdingItem ? 1 : 0, 10, dt);
    const charge = s.throwCharge || 0;
    if (st.prevCharge > 0.25 && charge < 0.05) st.release = 1;
    st.prevCharge = charge;
    st.release = Math.max(0, st.release - dt * 3.2);
    const speed = s.speed || 0, sprint = s.sprint ? 1 : 0;
    st.bob = damp(st.bob, clamp(s.bob ?? clamp(speed / 3, 0, 1), 0, 1), 8, dt);
    st.phase += dt * (speed > 0.1 ? lerp(1.6, 2.4, sprint) * clamp(0.6 + speed / 4, 0.6, 1.4) : 0.5);
    const ph = st.phase * TAU;
    if (s.landing) st.land.v -= s.landing * 2.6;
    const land = st.land.step(dt, 0);
    const sw = s.sway || { x: 0, y: 0 };
    _v1.set(-clamp(sw.x, -40, 40) * 0.0012, clamp(sw.y, -40, 40) * 0.0012, 0);
    st.swayV.addScaledVector(_v1.sub(st.sway).multiplyScalar(110).addScaledVector(st.swayV, -12), dt);
    st.sway.addScaledVector(st.swayV, dt).clampLength(0, 0.06);
    const bobX = Math.sin(ph) * 0.014 * st.bob, bobY = -Math.abs(Math.cos(ph)) * 0.02 * st.bob;
    const run = sprint * st.bob;
    tmp.h.copy(POSE.R.h); tmp.d.copy(POSE.R.d); tmp.u.copy(POSE.R.u);
    blendPose(tmp, POSE.hold, w.hold);
    blendPose(tmp, POSE.lowR, w.watch * 0.8 * (1 - w.grab) * (1 - w.use));
    blendPose(tmp, POSE.grab, w.grab);
    blendPose(tmp, POSE.use, w.use);
    blendPose(tmp, POSE.throw, w.thr);
    if (st.release > 0) blendPose(tmp, POSE.release, Math.sin(st.release * PI));
    const tremble = w.thr > 0.85 ? (Math.random() - 0.5) * 0.004 : 0;
    tmp.h.x += bobX + st.sway.x + tremble; tmp.h.y += bobY + st.sway.y - land * 0.05 + Math.sin(ph) * 0.035 * run + Math.sin(st.t * 1.6) * 0.004;
    tmp.h.z += Math.cos(ph) * 0.05 * run;
    if (w.use > 0.5) tmp.h.y += Math.sin(st.t * 9) * 0.008 * w.use;
    placeArm('R', stepSpring(st.sR, tmp.h, dt, 140, 0.45), tmp.d, tmp.u);
    tmp.h.copy(POSE.L.h); tmp.d.copy(POSE.L.d); tmp.u.copy(POSE.L.u);
    blendPose(tmp, POSE.watch, smooth(w.watch));
    const ww = 1 - w.watch * 0.85;
    tmp.h.x += (bobX + st.sway.x) * ww; tmp.h.y += (bobY + st.sway.y - land * 0.05) * ww + Math.sin(st.t * 1.6 + 1) * 0.004 * ww - Math.sin(ph) * 0.035 * run * ww;
    tmp.h.z -= Math.cos(ph) * 0.05 * run * ww;
    tmp.h.y -= (w.thr * 0.08 + w.use * 0.06) * (1 - w.watch);
    placeArm('L', stepSpring(st.sL, tmp.h, dt, lerp(140, 260, w.watch), lerp(0.45, 0.8, w.watch)), tmp.d, tmp.u);
    const curl = clamp(w.hold * 0.9 + w.use * 0.5 - w.grab * 0.6 + w.thr * 0.6, -0.5, 1);
    st.curl = damp(st.curl, curl, 12, dt);
    bones.fingR.rotation.x = -0.15 - st.curl * 1.1; bones.fingTR.rotation.x = -0.12 - st.curl * 1.0; bones.ixR.rotation.x = -0.1 - st.curl * 1.15;
    bones.thumbR.rotation.z = (w.grab * 0.5) - st.curl * 0.2;
    bones.fingL.rotation.x = -0.3 - w.watch * 0.1; bones.fingTL.rotation.x = -0.28; bones.ixL.rotation.x = -0.22 - w.watch * 0.08;
    bones.wrR.rotation.set(-0.15 * w.grab + 0.1 * w.hold, 0, 0);
    bones.wrL.rotation.set(-0.1 * w.watch, 0, 0);
  }
  update(0, {});
  return {
    root, rightHand, leftHand, watchScreen, update,
    dispose() { for (const m of meshes) m.geometry.dispose(); skeleton.dispose(); screenTex.dispose(); screenMat.dispose(); },
  };
}

function mergeSimpleSkinned(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const A = { position: [3, Float32Array], normal: [3, Float32Array], uv: [2, Float32Array], color: [3, Float32Array], skinIndex: [4, Uint16Array], skinWeight: [4, Float32Array] };
  const arr = {}; for (const [k, [n, T]] of Object.entries(A)) arr[k] = new T(nv * n);
  const idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    for (const [k, [n]] of Object.entries(A)) arr[k].set(g.attributes[k].array, ov * n);
    const I = g.index.array; for (let k = 0; k < I.length; k++) idx[oi + k] = I[k] + ov;
    ov += g.attributes.position.count; oi += I.length;
  }
  const g = new THREE.BufferGeometry();
  for (const [k, [n]] of Object.entries(A)) g.setAttribute(k, k === 'skinIndex' ? new THREE.Uint16BufferAttribute(arr[k], n) : new THREE.BufferAttribute(arr[k], n));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
