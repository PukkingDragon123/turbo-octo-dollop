// PAINT station: a small articulated spray robot on a lift column, a trolley of spray cans, a rag tin,
// and the control box (UNDO button, nozzle dial, STRIP lever).
//
// The pointer steers the robot: dragging over the clone places the nozzle a hand's width off the
// surface (along the surface normal, leaning toward the camera); the arm follows on springs and the paint
// lands where the nozzle actually points (a ray from the nozzle into the clone), so strokes are smooth,
// physical curves. Paint goes into the avatar's PaintLayer (entities/doll/paint.js): soft spray falloff,
// build-up on repeated passes, fine overspray speckle at the edges. Mist particles, a live hiss.
import * as THREE from 'three';
import { PI, TAU, clamp, lerp, damp, ease, rnd, V, Spring1, Spring3, mesh, rbox, cyl, lathe, tube, hitBox } from './kit.js';
import { TX, FM, P, ptex, css, shade, mixHex } from '../../entities/doll/handpaint.js';
import { PAINT_COLORS, paintHit } from '../../entities/doll/paint.js';
import { sfx, rattle, noiseHit, Hiss } from './sfx.js';

const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
const UP = V(0, 1, 0);

export const BOT_BASE = V(-0.62, 0, -0.62);
const TROLLEY = V(-1.3, 0, -0.86);
const L1 = 0.5, L2 = 0.46, REACH = L1 + L2 + 0.04;
const CAN_H = 0.19, CAN_R = 0.032;
const NOZZLE_L = V(0, CAN_H / 2 + 0.016, 0.06 + 0.013);   // hand space: can centre at z 0.06
const RAG_L = V(0, 0.0, 0.1);
const NOZZLE = { fine: { r: 0.012, rate: 10, off: 0.11 }, wide: { r: 0.03, rate: 7, off: 0.17 } };

// ---------------------------------------------------------------------------
// spray can model (origin = can centre, axis +Y, nozzle hole facing +Z)
const CAN_GEO = {};
function canGeos() {
  if (CAN_GEO.body) return CAN_GEO;
  const h = CAN_H / 2;
  CAN_GEO.body = lathe([[0, -h], [CAN_R - 0.004, -h], [CAN_R, -h + 0.004], [CAN_R, h - 0.012], [CAN_R - 0.006, h - 0.002], [CAN_R - 0.018, h + 0.004], [0.013, h + 0.006], [0, h + 0.006]], 40);
  CAN_GEO.ring = lathe([[CAN_R + 0.0008, -h + 0.006], [CAN_R + 0.0012, -h + 0.01], [CAN_R + 0.0008, -h + 0.014]], 40);
  CAN_GEO.valve = lathe([[0, h + 0.004], [0.0125, h + 0.004], [0.0132, h + 0.008], [0.0118, h + 0.009], [0, h + 0.009]], 24);
  CAN_GEO.cap = lathe([[0, h + 0.009], [0.0098, h + 0.009], [0.0102, h + 0.011], [0.0096, h + 0.02], [0.0086, h + 0.022], [0, h + 0.022]], 24);
  CAN_GEO.hole = new THREE.CircleGeometry(0.0022, 12);
  return CAN_GEO;
}
function canLabel(c) {
  return ptex('cz_can_' + c.id, 256, 256, (g, w, h, r) => {
    const base = c.hex;
    P.wash(g, w, h, base, { k: 0.16, angle: PI / 2 });
    P.strokes(g, w, h, base, r, { n: 40, len: 0.5, wid: 0.05, k: 0.1, alpha: 0.18, angle: PI / 2, jitter: 0.2 });
    // printed cream label band with the hand-lettered colour name
    const y0 = h * 0.36, y1 = h * 0.7;
    g.fillStyle = css(0xf1e6cc, 0.95); g.fillRect(0, y0, w, y1 - y0);
    g.fillStyle = css(shade(base, -0.2), 0.9); g.fillRect(0, y0 + 4, w, 5); g.fillRect(0, y1 - 9, w, 5);
    P.text(g, c.name.toUpperCase(), w * 0.25, (y0 + y1) / 2 + 2, 34, shade(base, -0.35), r, { maxW: w * 0.46 });
    P.text(g, 'R.O.O.M.', w * 0.75, (y0 + y1) / 2, 24, 0x5a4a38, r, { maxW: w * 0.4 });
    P.blotches(g, w, h, 0x3a2a1a, r, { n: 3, r: 0.12, alpha: 0.12 });
    // runs of its own paint from the top
    P.drips(g, w, h, shade(base, 0.05), r, { n: 5, y0: 0, maxLen: 0.3, wid: 0.018 });
    P.chips(g, w, h, 0xc8c4bc, r, { n: 10, s: 0.008 });
    P.edgeWear(g, w, h, r, { amt: 0.6 });
  });
}
export function buildCan(c) {
  const G = canGeos();
  const g = new THREE.Group(); g.name = 'can_' + c.id;
  const body = new THREE.MeshPhysicalMaterial({ map: canLabel(c), roughness: 0.42, metalness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.35 });
  g.add(mesh(G.body, body));
  g.add(mesh(G.ring, FM.bare('cz_tin', 0xc9c6bd, { rough: 0.35 })));
  g.add(mesh(G.valve, FM.bare('cz_tin', 0xc9c6bd, { rough: 0.35 })));
  const capMat = FM.plain('cz_cap_' + c.id, c.hex, { rough: 0.45, cc: 0.4 });
  g.add(mesh(G.cap, capMat));
  g.add(mesh(G.hole, FM.plain('cz_hole', 0x111111), { y: CAN_H / 2 + 0.016, z: 0.0101, cast: false }));
  g.userData.color = c;
  return g;
}

// crumpled rag ball (the wipe tool)
function buildRag() {
  const geo = new THREE.IcosahedronGeometry(0.045, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.28 * Math.sin(x * 70 + y * 33) * Math.sin(z * 55 - x * 20) + 0.12 * Math.sin(y * 140 + z * 90);
    p.setXYZ(i, x * k * 1.1, y * k * 0.8, z * k);
  }
  geo.computeVertexNormals();
  const tex = ptex('cz_ragtex', 256, 256, (g, w, h, r) => {
    P.wash(g, w, h, 0xd8c8a4); P.weave(g, w, h, 0xd8c8a4, r, { pitch: 3, alpha: 0.5 });
    for (const c of [0xc4572a, 0x3f8c8a, 0x6e3f6e, 0x8ea67a, 0xf0bf4a]) P.blotches(g, w, h, c, r, { n: 3, r: 0.12, alpha: 0.55 });
    P.blotches(g, w, h, 0x3a2a1a, r, { n: 5, r: 0.2, alpha: 0.2 });
  });
  const m = mesh(geo, FM.fabric('cz_rag', tex, { sheen: 0.8 }));
  const g = new THREE.Group(); g.add(m); g.name = 'rag';
  return g;
}

// ---------------------------------------------------------------------------
// mist: soft coloured droplets (Points with a round soft sprite)
class Mist {
  constructor(n = 260) {
    this.n = n; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.a = new Float32Array(n); this.s = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.stop = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1));
    g.setAttribute('size', new THREE.BufferAttribute(this.s, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { uScale: { value: 700 } },
      vertexShader: `attribute float alpha; attribute float size; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; float a = vA * exp(-r * 3.0) * (1.0 - smoothstep(0.7, 1.0, r)); if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.geo = g;
  }
  emit(p, dir, hex, count, dist, spread) {
    const c = new THREE.Color(hex);
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const sp = rnd(1.2, 2.2);
      _v4.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(spread).add(dir).normalize().multiplyScalar(sp);
      this.vel[i * 3] = _v4.x; this.vel[i * 3 + 1] = _v4.y; this.vel[i * 3 + 2] = _v4.z;
      this.life[i] = 0; this.max[i] = rnd(0.35, 0.8); this.stop[i] = dist / sp;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.s[i] = rnd(0.004, 0.008); this.a[i] = 0;
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] >= this.max[i]) { this.a[i] = 0; continue; }
      this.life[i] += dt;
      const t = this.life[i], hit = t > this.stop[i];
      const drag = hit ? 9 : 1.2;
      const k = Math.exp(-drag * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - 0.15 * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.s[i] += dt * (hit ? 0.05 : 0.03);
      const u = t / this.max[i];
      this.a[i] = 0.32 * Math.min(1, t * 20) * (1 - u) * (1 - u);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
export class SprayStation {
  constructor(cz) {
    this.cz = cz;
    this.group = new THREE.Group(); this.group.name = 'cz_paint';
    this.colorIdx = 4; this.tool = 'can'; this.nozzle = 'wide';
    this.job = null; this.spraying = false; this.aim = null; this.press = 0;
    this.hiss = new Hiss();
    this.mist = new Mist();
    cz.scene.add(this.mist.points);
    this._buildBot();
    this._buildTrolley();
    this.group.add(this.bot);
    cz.scene.add(this.group);
    // start holding the honey can
    this._grabInstant(this.colorIdx);
    this.lastHit = null; this.lastActual = null; this.scrub = 0; this.rustleT = 0;
  }

  // ---------------------------------------------------------------- the robot
  _buildBot() {
    const bot = (this.bot = new THREE.Group()); bot.name = 'spraybot';
    bot.position.copy(BOT_BASE);
    const teal = FM.paintedMetal('cz_teal', TX.paintedSteel(0x3f6b66, 5));
    const rust = FM.paintedMetal('cz_rust', TX.paintedSteel(0xc4572a, 6));
    const cream = FM.paintedMetal('cz_cream', TX.paintedSteel(0xe6d6b0, 7));
    const steel = FM.bare('cz_steel', 0xb8b4aa, { rough: 0.32 });
    const dark = FM.plain('cz_rubber', 0x24221f, { rough: 0.7 });
    this.mats = { teal, rust, cream, steel, dark };
    // cast foot + column
    bot.add(mesh(lathe([[0, 0], [0.19, 0], [0.2, 0.012], [0.17, 0.05], [0.07, 0.07], [0.045, 0.1], [0, 0.1]], 40), teal));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.3; bot.add(mesh(cyl(0.011, 0.012, 8), steel, { x: Math.cos(a) * 0.15, y: 0.03, z: Math.sin(a) * 0.15 })); }
    bot.add(mesh(cyl(0.024, 1.72, 20), steel, { y: 0.1 + 0.86 }));
    bot.add(mesh(rbox(0.012, 1.6, 0.014, 0.003), dark, { y: 0.92, x: 0, z: 0.027 }));   // toothed rack
    bot.add(mesh(lathe([[0, 0], [0.034, 0], [0.036, 0.02], [0.02, 0.04], [0, 0.042]], 20), rust, { y: 1.82 }));
    // carriage (slides on the column)
    const car = (this.car = new THREE.Group()); bot.add(car);
    car.add(mesh(rbox(0.1, 0.16, 0.1, 0.018), rust));
    car.add(mesh(cyl(0.032, 0.06, 18), cream, { x: -0.06, y: 0.02, rz: PI / 2 }));   // motor
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; car.add(mesh(rbox(0.004, 0.06, 0.01, 0.002), dark, { x: -0.06, y: 0.02 + Math.cos(a) * 0.032, z: Math.sin(a) * 0.032, rx: a })); }
    const crank = new THREE.Group(); crank.position.set(-0.095, 0.02, 0); car.add(crank); this.crank = crank;
    crank.add(mesh(new THREE.TorusGeometry(0.03, 0.005, 8, 24), steel, { ry: PI / 2 }));
    crank.add(mesh(cyl(0.004, 0.06, 8), steel, { rz: 0 }));
    crank.add(mesh(cyl(0.007, 0.025, 10), FM.plain('cz_knobred', 0xa83228, { rough: 0.5 }), { x: -0.012, y: 0.03, rz: PI / 2 }));
    // shoulder turret
    const tur = (this.tur = new THREE.Group()); tur.position.set(0, 0.03, 0); car.add(tur);
    tur.add(mesh(cyl(0.045, 0.03, 24), cream, { y: 0.085 }));
    const sh = (this.sh = new THREE.Group()); sh.position.set(0.075, 0.1, 0); tur.add(sh);
    sh.add(mesh(cyl(0.034, 0.075, 24), rust, { rx: PI / 2 }));
    for (const s of [-1, 1]) sh.add(mesh(cyl(0.012, 0.006, 12), steel, { z: s * 0.04, rx: PI / 2 }));
    // upper arm: a soft box beam with a piston
    const up = new THREE.Group(); sh.add(up); this.up = up;
    up.add(mesh(rbox(L1, 0.05, 0.045, 0.016), cream, { x: L1 / 2 }));
    up.add(mesh(rbox(L1 * 0.7, 0.012, 0.047, 0.004), rust, { x: L1 / 2, y: 0.021 }));
    this.piston = mesh(cyl(0.009, 0.16, 12), steel, { rz: PI / 2 });
    this.pistonBody = mesh(cyl(0.014, 0.12, 14), dark, { rz: PI / 2 });
    up.add(this.piston, this.pistonBody);
    const el = (this.el = new THREE.Group()); el.position.set(L1, 0, 0); up.add(el);
    el.add(mesh(cyl(0.03, 0.065, 22), rust, { rx: PI / 2 }));
    for (const s of [-1, 1]) el.add(mesh(cyl(0.01, 0.006, 12), steel, { z: s * 0.035, rx: PI / 2 }));
    el.add(mesh(rbox(L2, 0.042, 0.038, 0.014), cream, { x: L2 / 2 }));
    el.add(mesh(rbox(L2 * 0.5, 0.01, 0.04, 0.003), teal, { x: L2 * 0.55, y: -0.018 }));
    el.add(mesh(new THREE.SphereGeometry(0.026, 18, 12), rust, { x: L2 }));   // wrist ball
    // hand (world-oriented each frame): palm, two curved fingers, the thumb lever over the cap
    const hand = (this.hand = new THREE.Group()); hand.name = 'bot_hand'; bot.add(hand);
    hand.add(mesh(rbox(0.05, 0.07, 0.03, 0.01), rust, { z: 0.012 }));
    const fingers = (this.fingers = []);
    for (const s of [-1, 1]) {
      const f = new THREE.Group(); f.position.set(s * 0.02, 0, 0.02); hand.add(f); fingers.push(f);
      const arc = new THREE.TorusGeometry(CAN_R + 0.007, 0.0055, 8, 16, PI * 0.62);
      f.add(mesh(arc, cream, { x: -s * 0.02, z: 0.04, ry: s > 0 ? -PI * 0.05 : PI * 1.05 + PI * 0.62, rx: PI / 2, y: 0.02 }));
      f.add(mesh(arc, cream, { x: -s * 0.02, z: 0.04, ry: s > 0 ? -PI * 0.05 : PI * 1.05 + PI * 0.62, rx: PI / 2, y: -0.03 }));
    }
    const thumb = (this.thumb = new THREE.Group()); thumb.position.set(0, 0.04, 0.01); hand.add(thumb);
    thumb.add(mesh(rbox(0.012, 0.075, 0.012, 0.004), steel, { y: 0.035 }));
    thumb.add(mesh(rbox(0.016, 0.01, 0.07, 0.004), rust, { y: 0.075, z: 0.03 }));
    thumb.add(mesh(rbox(0.014, 0.014, 0.01, 0.004), dark, { y: 0.069, z: 0.058 }));
    // hose from the carriage to the hand
    this.hoseMat = FM.plain('cz_hose', 0x2c2a26, { rough: 0.6 });
    this.hose = mesh(new THREE.BufferGeometry(), this.hoseMat);
    bot.add(this.hose);
    // spring state (bot-local)
    this.carY = new Spring1(1.0, 60, 0.75);
    this.wristS = new Spring3(V(0.35, 1.0, 0.25), 150, 0.62);
    this.handQ = new THREE.Quaternion();
    this.grip = 1; this.gripT = 1; this.thumbP = 0;
    this.rest = V(0.34, 1.02, 0.28);
  }

  _buildTrolley() {
    const tr = (this.trolley = new THREE.Group()); tr.position.copy(TROLLEY); tr.rotation.y = 0.35;
    this.group.add(tr);
    const wood = FM.paintedMetal('cz_trolleywood', TX.wood(0x9a6b40, 4), { metal: 0, rough: 0.8 });
    const teal = this.mats.teal, steel = this.mats.steel, dark = this.mats.dark;
    for (const [x, z] of [[-0.24, -0.13], [0.24, -0.13], [-0.24, 0.13], [0.24, 0.13]]) {
      tr.add(mesh(cyl(0.012, 0.66, 10), teal, { x, y: 0.37, z }));
      tr.add(mesh(new THREE.TorusGeometry(0.025, 0.01, 8, 16), dark, { x, y: 0.035, z, ry: PI / 2 }));
    }
    tr.add(mesh(rbox(0.56, 0.025, 0.32, 0.006), wood, { y: 0.66 }));
    tr.add(mesh(rbox(0.56, 0.025, 0.32, 0.006), wood, { y: 0.24 }));
    tr.add(mesh(rbox(0.56, 0.05, 0.012, 0.004), wood, { y: 0.69, z: -0.155 }));
    tr.add(mesh(rbox(0.56, 0.05, 0.012, 0.004), wood, { y: 0.69, z: 0.155 }));
    // the can slots: two rows of six on the top shelf
    this.slots = [];
    this.cans = [];
    PAINT_COLORS.forEach((c, i) => {
      const row = i < 6 ? 0 : 1, col = i % 6;
      const slot = new THREE.Group();
      slot.position.set(-0.2 + col * 0.08, 0.6725 + CAN_H / 2, row === 0 ? -0.07 : 0.07);
      tr.add(slot);
      const can = buildCan(c);
      can.rotation.y = rnd(-0.4, 0.4) + PI;
      slot.add(can);
      const hb = hitBox(0.075, CAN_H + 0.03, 0.075);
      slot.add(hb);
      this.cz.hits.add(hb, { st: 'paint', type: 'can', i, hover: () => this._hoverCan(i) });
      this.slots.push(slot); this.cans.push(can);
      can.userData.lift = 0;
    });
    // rag tin on the lower shelf
    const tin = new THREE.Group(); tin.position.set(0.12, 0.25, 0); tr.add(tin);
    tin.add(mesh(lathe([[0, 0], [0.075, 0], [0.078, 0.004], [0.078, 0.07], [0.082, 0.074], [0.076, 0.076], [0.07, 0.006], [0, 0.006]], 32), FM.paintedMetal('cz_tin2', TX.paintedSteel(0xa83228, 9), { metal: 0.4 })));
    this.ragHome = new THREE.Group(); this.ragHome.position.set(0, 0.06, 0); tin.add(this.ragHome);
    this.rag = buildRag(); this.ragHome.add(this.rag);
    const hbr = hitBox(0.18, 0.16, 0.18); hbr.position.y = 0.05; tin.add(hbr);
    this.cz.hits.add(hbr, { st: 'paint', type: 'rag' });
    // control box on the trolley front: UNDO button, nozzle dial, STRIP lever, with a painted plate
    const box = new THREE.Group(); box.position.set(-0.16, 0.45, -0.165); box.rotation.x = -0.25; tr.add(box);
    box.add(mesh(rbox(0.26, 0.16, 0.06, 0.012), teal, { z: 0.02 }));
    const plateTex = ptex('cz_ctlplate', 512, 320, (g, w, h, r) => {
      P.wash(g, w, h, 0xe9dcb6, { k: 0.08 }); P.strokes(g, w, h, 0xe9dcb6, r, { n: 20, alpha: 0.12 });
      P.text(g, 'undo', w * 0.2, h * 0.86, 56, 0x3a2a1a, r);
      P.text(g, 'nozzle', w * 0.52, h * 0.86, 50, 0x3a2a1a, r);
      P.text(g, 'fine', w * 0.44, h * 0.12, 38, 0x5a4a38, r);
      P.text(g, 'wide', w * 0.62, h * 0.12, 38, 0x5a4a38, r);
      P.text(g, 'strip', w * 0.84, h * 0.86, 52, 0x8a2a20, r);
      P.edgeWear(g, w, h, r, { amt: 0.7 });
      P.blotches(g, w, h, 0x4a3a20, r, { n: 4, r: 0.18, alpha: 0.12 });
    });
    box.add(mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.85 }), { z: -0.0105, ry: PI, cast: false }));
    // undo: a fat red mushroom button
    const btn = (this.undoBtn = new THREE.Group()); btn.position.set(0.075, 0.012, -0.012); box.add(btn);
    btn.add(mesh(cyl(0.024, 0.012, 20), steel, { rx: PI / 2 }));
    this.undoCap = mesh(lathe([[0, 0], [0.021, 0], [0.023, 0.006], [0.02, 0.016], [0, 0.019]], 24), FM.plain('cz_red', 0xb8352a, { rough: 0.35, cc: 0.6 }), { rx: -PI / 2, z: -0.006 });
    btn.add(this.undoCap);
    const hbu = hitBox(0.06, 0.06, 0.05); btn.add(hbu);
    this.cz.hits.add(hbu, { st: 'paint', type: 'undo' });
    // nozzle dial
    const dial = (this.dial = new THREE.Group()); dial.position.set(-0.005, 0.015, -0.012); box.add(dial);
    dial.add(mesh(cyl(0.022, 0.016, 24), FM.plain('cz_bakelite', 0x2a2420, { rough: 0.4, cc: 0.5 }), { rx: PI / 2 }));
    dial.add(mesh(rbox(0.006, 0.02, 0.006, 0.002), FM.plain('cz_cream2', 0xf1e6cc), { y: 0.012, z: -0.008 }));
    this.dialA = new Spring1(0.5, 140, 0.45);
    const hbd = hitBox(0.06, 0.06, 0.05); dial.add(hbd);
    this.cz.hits.add(hbd, { st: 'paint', type: 'nozzle' });
    // strip lever
    const lev = (this.lever = new THREE.Group()); lev.position.set(-0.085, -0.02, -0.012); box.add(lev);
    lev.add(mesh(cyl(0.012, 0.02, 14), steel, { rx: PI / 2 }));
    const arm = new THREE.Group(); lev.add(arm); this.leverArm = arm;
    arm.add(mesh(cyl(0.005, 0.07, 10), steel, { y: 0.035 }));
    arm.add(mesh(new THREE.SphereGeometry(0.012, 14, 10), FM.plain('cz_knobblk', 0x1d1b19, { rough: 0.3, cc: 0.7 }), { y: 0.072 }));
    this.leverS = new Spring1(0, 160, 0.4);
    const hbl = hitBox(0.05, 0.1, 0.05); hbl.position.y = 0.04; lev.add(hbl);
    this.cz.hits.add(hbl, { st: 'paint', type: 'strip' });
    this.undoS = new Spring1(0, 300, 0.4);
  }

  _hoverCan(i) { const c = this.cans[i]; if (c.parent === this.slots[i]) c.userData.lift = 1; }

  // ---------------------------------------------------------------- tools
  _grabInstant(i) {
    const can = this.cans[i];
    this.hand.add(can);
    can.position.set(0, 0, 0.06); can.rotation.set(0, 0, 0);
    this.held = can; this.heldIdx = i; this.tool = 'can';
  }
  get color() { return PAINT_COLORS[this.colorIdx]; }
  select(i) {
    if (this.job) { this.queued = i; return; }
    if (this.tool === 'can' && i === this.heldIdx) { this.job = { kind: 'shake', t: 0 }; rattle(7); return; }
    this.colorIdx = i;
    this.job = { kind: 'swap', to: i, t: 0, phase: 0 };
    sfx('robo_whir', { volume: 0.25, pitch: 1.5 });
  }
  takeRag() {
    if (this.job || this.tool === 'rag') return;
    this.job = { kind: 'swap', to: 'rag', t: 0, phase: 0 };
    sfx('robo_whir', { volume: 0.25, pitch: 1.4 });
  }
  undo() {
    this.undoS.v -= 2.5;
    const ok = this.cz.paint?.undo();
    sfx(ok ? 'button_press' : 'ui_error', { volume: ok ? 0.5 : 0.25 });
    if (ok) { noiseHit({ freq: 1800, q: 2, dur: 0.18, vol: 0.12 }); this.cz.pop(0.4); }
  }
  toggleNozzle() {
    this.nozzle = this.nozzle === 'wide' ? 'fine' : 'wide';
    sfx('knob_tick', { volume: 0.5 }); sfx('toggle_clack', { volume: 0.3, pitch: 1.3 });
  }
  strip() {
    const L = this.cz.paint;
    this.leverS.v += 14;
    sfx('lever', { volume: 0.5 });
    if (!L || L.empty) return;
    L.checkpoint();
    this.stripT = 0.0001;
    noiseHit({ freq: 2500, q: 0.8, dur: 0.6, vol: 0.18 });
  }

  // a job's hand target in bot space: { p, q } ; returns null when the job leaves the hand to the aim
  _slotTarget(slotIdx, above) {
    const slot = slotIdx === 'rag' ? this.ragHome : this.slots[slotIdx];
    slot.getWorldPosition(_v1);
    this.bot.worldToLocal(_v1);
    // the hand holds things from behind (hand -Z), can centre at hand z 0.06
    const toward = _v2.set(-_v1.x, 0, -_v1.z).normalize();
    const p = _v1.clone().addScaledVector(toward, 0.06);
    p.y += above + (slotIdx === 'rag' ? 0.03 : 0);
    _m1.lookAt(V(0, 0, 0), toward, UP);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m1);
    return { p, q };
  }

  // ---------------------------------------------------------------- per frame
  // aim: null or { point (world), normal (world) } from the pointer; down: pointer held on the clone
  update(dt, aim, down) {
    const cz = this.cz, L = cz.paint;
    let target = null, tq = null, spray = false;
    // ---- jobs (tool swaps / shaking)
    const J = this.job;
    if (J) {
      J.t += dt;
      if (J.kind === 'shake') {
        const T = this._idleTarget();
        target = T.p; tq = T.q;
        target.y += Math.sin(J.t * 38) * 0.035 * Math.max(0, 1 - J.t / 0.7);
        if (J.t > 0.75) this.job = null;
      } else if (J.kind === 'swap') {
        const holding = this.tool === 'can' ? this.heldIdx : 'rag';
        // phase 0: carry the held thing above its home; 1: lower + let go; 2: over the new one; 3: lower + grip; 4: lift + shake
        const homeIdx = J.phase < 2 ? holding : J.to;
        const above = J.phase === 0 || J.phase === 2 ? 0.16 : J.phase === 4 ? 0.22 : 0.0;
        const T = this._slotTarget(homeIdx, above);
        target = T.p; tq = T.q;
        const near = this.wristS.x.distanceTo(target) < 0.025;
        if (J.phase === 0 && (near || J.t > 1.2)) { J.phase = 1; J.t = 0; }
        else if (J.phase === 1 && (near || J.t > 0.7)) {
          // let go
          this.gripT = 0;
          if (this.held) {
            const home = holding === 'rag' ? this.ragHome : this.slots[holding];
            home.attach(this.held);
            this.held.userData.settle = 1;
            sfx(holding === 'rag' ? 'suit_rustle' : 'impact_metal', { volume: holding === 'rag' ? 0.4 : 0.25, pitch: 1.6 });
          }
          this.held = null;
          J.phase = 2; J.t = 0;
        } else if (J.phase === 2 && (near || J.t > 1.2)) { J.phase = 3; J.t = 0; }
        else if (J.phase === 3 && (near || J.t > 0.7)) {
          const obj = J.to === 'rag' ? this.rag : this.cans[J.to];
          this.hand.attach(obj);
          obj.userData.snap = 1;
          this.held = obj;
          this.gripT = 1;
          if (J.to === 'rag') { this.tool = 'rag'; this.heldIdx = -1; sfx('suit_rustle', { volume: 0.4 }); }
          else { this.tool = 'can'; this.heldIdx = J.to; this.colorIdx = J.to; sfx('grab', { volume: 0.4 }); }
          J.phase = 4; J.t = 0;
          if (this.tool === 'can') rattle(8, 0.075);
        } else if (J.phase === 4) {
          target.y += Math.sin(J.t * 36) * 0.03 * Math.max(0, 1 - J.t / 0.6) * (this.tool === 'can' ? 1 : 0);
          if (J.t > 0.6) { this.job = null; if (this.queued != null) { const q = this.queued; this.queued = null; this.select(q); } }
        }
      }
    }
    // ---- aiming at the clone
    const S = NOZZLE[this.nozzle];
    if (!this.job && aim) {
      const off = this.tool === 'rag' ? 0.0 : S.off;
      // nozzle sits off the surface along the normal, leaning toward the camera so it stays in view
      const camDir = _v3.copy(cz.camera.position).sub(aim.point).normalize();
      const n = _v1.copy(aim.normal).lerp(camDir, 0.35).normalize();
      const nozzleW = _v2.copy(aim.point).addScaledVector(n, off);
      // out of reach: back the nozzle off along the line to the column (it sprays from further away,
      // a wider, fainter cone, but still where you aim)
      const sh = _v4.set(BOT_BASE.x, aim.point.y, BOT_BASE.z);
      if (this.tool !== 'rag' && nozzleW.distanceTo(sh) > REACH) {
        const d = aim.point.distanceTo(sh);
        n.copy(sh).sub(aim.point).normalize();
        nozzleW.copy(aim.point).addScaledVector(n, Math.max(off, d - REACH));
      }
      if (this.tool === 'rag') {
        this.scrub += dt * (down ? 14 : 3);
        const t1 = _v4.set(0, 1, 0).cross(n).normalize();
        nozzleW.addScaledVector(t1, Math.cos(this.scrub) * 0.012).addScaledVector(UP, Math.sin(this.scrub) * 0.01);
        nozzleW.addScaledVector(n, 0.035);
      }
      const dirW = n.clone().negate();
      // hand frame: +Z along the spray, +Y the can axis (as upright as possible)
      let upv = UP.clone().addScaledVector(dirW, -dirW.dot(UP));
      if (upv.lengthSq() < 1e-3) upv.set(0, 0, 1);
      upv.normalize();
      const x = new THREE.Vector3().crossVectors(upv, dirW).normalize();
      _m1.makeBasis(x, upv, dirW);
      tq = new THREE.Quaternion().setFromRotationMatrix(_m1);
      // bot space
      this.bot.getWorldQuaternion(_q2);
      tq.premultiply(_q2.clone().invert());
      const nozL = this.tool === 'rag' ? RAG_L : NOZZLE_L;
      const pBot = this.bot.worldToLocal(nozzleW.clone());
      target = pBot.sub(nozL.clone().applyQuaternion(tq));
      spray = down;
    }
    if (!target) { const T = this._idleTarget(); target = T.p; tq = T.q; }
    this._drive(target, tq, dt);
    // ---- spraying / wiping: paint where the nozzle actually points
    const pressing = spray && !this.job && this.held;
    this.thumbP = damp(this.thumbP, pressing && this.tool === 'can' ? 1 : 0, 30, dt);
    this.thumb.position.y = 0.04 - this.thumbP * 0.006;
    if (pressing && L) {
      this.hand.updateMatrixWorld(true);
      const nozW = (this.tool === 'rag' ? RAG_L : NOZZLE_L).clone().applyMatrix4(this.hand.matrixWorld);
      const dirW = V(0, 0, 1).transformDirection(this.hand.matrixWorld);
      const it = cz.rayBody(nozW, dirW, this.tool === 'rag' ? 0.14 : 2.0);
      const ph = it ? paintHit(it) : null;
      if (ph) {
        if (!this.stroke) { L.checkpoint(); this.stroke = true; }
        const dist = it.distance;
        const wide = this.tool === 'rag' ? 0.036 : S.r * clamp(dist / S.off, 0.5, 2.2);
        const rate = this.tool === 'rag' ? 5 : S.rate * clamp(S.off / Math.max(0.03, dist), 0.4, 1.4);
        const cur = { p: ph.p.clone(), n: ph.n.clone(), reg: ph.reg.slice() };
        const prev = this.lastActual;
        const steps = prev && prev.p.distanceTo(cur.p) < 0.12 ? Math.max(1, Math.ceil(prev.p.distanceTo(cur.p) / (wide * 0.3))) : 1;
        const a = Math.min(0.7, (rate * dt) / Math.sqrt(steps));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const hh = steps === 1 ? cur : { p: prev.p.clone().lerp(cur.p, t), n: prev.n.clone().lerp(cur.n, t).normalize(), reg: cur.reg.map((v, r) => lerp(prev.reg[r], v, t)) };
          L.dab(hh, this.color.hex, wide, a, { wipe: this.tool === 'rag', speckle: this.nozzle === 'wide' ? 1 : 0.5 });
        }
        // dwelling on one spot: the coat gets heavy and runs
        if (prev && prev.p.distanceTo(cur.p) < 0.004) this.dwell = (this.dwell || 0) + dt; else this.dwell = Math.max(0, (this.dwell || 0) - dt * 2);
        if (this.tool === 'can' && this.dwell > 0.7 && Math.random() < dt * 3) {
          L.drip(cur, this.color.hex, 0.025 + Math.random() * 0.05, this.nozzle === 'wide' ? 0.0045 : 0.003);
          this.dwell = 0.4;
          noiseHit({ freq: 700, q: 3, dur: 0.06, vol: 0.06 });
        }
        this.lastActual = cur;
        if (this.tool === 'can') {
          this.mist.emit(nozW, dirW, this.color.hex, Math.ceil(dt * 420), dist, this.nozzle === 'wide' ? 0.28 : 0.12);
          this.cz.avatarPaintKick?.(dt);
        } else {
          this.rustleT -= dt;
          if (this.rustleT <= 0) { this.rustleT = 0.32; sfx('suit_rustle', { volume: 0.25, pitch: rnd(0.9, 1.3) }); }
        }
      } else this.lastActual = null;
      if (this.tool === 'can') this.hiss.set(1, this.nozzle === 'wide' ? 1 : 0, Math.sin(cz.t * 31) * 0.5);
    } else {
      this.lastActual = null;
      this.hiss.set(0);
      if (!spray) this.stroke = false;
    }
    if (!down) this.stroke = false;
    // ---- strip animation (dissolve the whole layer)
    if (this.stripT) {
      this.stripT += dt;
      const g = L.ctx;
      g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, L.size, L.size); g.restore();
      L.dirty = true;
      if (this.stripT > 0.55) { L.clear(); this.stripT = 0; }
    }
    this.mist.update(dt);
    // ---- control box springs
    this.undoCap.position.z = -0.006 + Math.max(-0.008, this.undoS.step(0, dt) * 0.004);
    this.leverArm.rotation.x = this.leverS.step(0, dt) * 0.12;
    this.dial.rotation.z = this.dialA.step(this.nozzle === 'wide' ? -0.7 : 0.7, dt);
    // hovered cans lift a little in their slot; things just let go settle with a wobble
    for (let i = 0; i < this.cans.length; i++) {
      const c = this.cans[i];
      if (c.parent === this.slots[i]) {
        c.userData.liftS = damp(c.userData.liftS || 0, c.userData.lift || 0, 12, dt);
        c.userData.lift = 0;
        const st = c.userData.settle || 0;
        c.position.lerp(_v1.set(0, c.userData.liftS * 0.025, 0), 1 - Math.exp(-14 * dt));
        c.rotation.x = Math.sin(cz.t * 22) * 0.12 * st; c.rotation.z = Math.cos(cz.t * 19) * 0.1 * st;
        c.userData.settle = Math.max(0, st - dt * 2.2);
      } else if (c === this.held) {
        c.position.lerp(_v1.set(0, 0, 0.06), 1 - Math.exp(-18 * dt));
        c.quaternion.slerp(_q1.identity(), 1 - Math.exp(-18 * dt));
      }
    }
    if (this.rag.parent === this.ragHome) { this.rag.position.lerp(_v1.set(0, 0, 0), 1 - Math.exp(-10 * dt)); }
    else if (this.rag === this.held) { this.rag.position.lerp(_v1.set(0, 0, 0.07), 1 - Math.exp(-18 * dt)); }
  }

  _idleTarget() {
    // parked beside the clone, nozzle toward its chest, a slow servo hunt; folded up against the column
    // while the other stations are in use (out of their camera's way)
    const t = this.cz.t;
    const away = this.cz.station !== 'paint';
    this.parkK = damp(this.parkK || 0, away ? 1 : 0, 3, 1 / 60);
    const p = this.rest.clone().lerp(V(0.06, 1.62, -0.16), this.parkK); p.y += Math.sin(t * 0.7) * 0.015; p.x += Math.sin(t * 0.43) * 0.01;
    const toClone = this.bot.worldToLocal(V(0, 0.95, 0)).sub(p).setY(0).normalize();
    _m1.lookAt(V(0, 0, 0), toClone.negate(), UP);
    return { p, q: new THREE.Quaternion().setFromRotationMatrix(_m1) };
  }

  // spring-driven arm: smooth the wrist target, slide the carriage, solve the two links, orient the hand
  _drive(target, tq, dt) {
    const W = this.wristS.step(target, dt);
    const cy = this.carY.step(clamp(W.y + 0.06, 0.2, 1.62), dt);
    this.car.position.y = cy;
    this.crank.rotation.x = cy * 18;
    // turret yaw toward the wrist
    const S0 = _v1.set(0, cy + 0.13, 0);
    const dx = W.x - S0.x, dz = W.z - S0.z;
    const yaw = Math.atan2(-dz, dx);
    this.tur.rotation.y = yaw;
    // shoulder pivot sits 0.075 out from the turret centre
    const sx = Math.cos(yaw) * 0.075, sz = -Math.sin(yaw) * 0.075;
    const r = Math.max(0.02, Math.hypot(W.x - sx, W.z - sz)), h = W.y - S0.y;
    const D = clamp(Math.hypot(r, h), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.002);
    const al = Math.atan2(h, r);
    const a1 = al + Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const a2 = -(PI - Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1)));
    this.up.rotation.z = a1;
    this.el.rotation.z = a2;
    // piston between turret and the upper arm
    this.piston.position.set(0.1, -0.02 + Math.sin(a1) * 0.02, 0); this.pistonBody.position.set(0.04, -0.03, 0);
    // hand: at the wrist ball, oriented (slerped) toward the target frame
    this.el.updateWorldMatrix(true, false);
    const wristW = _v2.set(L2, 0, 0).applyMatrix4(this.el.matrixWorld);
    this.bot.worldToLocal(wristW);
    this.hand.position.copy(wristW);
    if (tq) this.handQ.slerp(tq, 1 - Math.exp(-16 * dt));
    this.hand.quaternion.copy(this.handQ);
    // fingers
    this.grip = damp(this.grip, this.gripT, 14, dt);
    this.fingers[0].rotation.y = -(1 - this.grip) * 0.5; this.fingers[1].rotation.y = (1 - this.grip) * 0.5;
    // hose: carriage -> hand, sagging
    const a = V(-0.04, cy - 0.06, 0.05), b = this.hand.position.clone().add(V(0, -0.03, -0.02).applyQuaternion(this.hand.quaternion));
    const mid = a.clone().lerp(b, 0.5); mid.y -= 0.12 + 0.05 * Math.sin(this.cz.t * 1.3);
    this._hoseT = (this._hoseT || 0) - dt;
    if (this._hoseT <= 0) {
      this._hoseT = 1 / 30;
      this.hose.geometry.dispose();
      this.hose.geometry = tube([a, a.clone().lerp(mid, 0.5).add(V(0, -0.02, 0)), mid, mid.clone().lerp(b, 0.5), b], 0.0055, 24, 6);
    }
  }

  dispose() { this.hiss.stop(); }
}
void ease; void mixHex;
