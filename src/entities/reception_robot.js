// GREET-O-TRON 9000: the R.O.O.M. reception service robot (HQ lobby, beside the reception desk).
// Chunky 1990s office hardware: a beige tower body on a five-star caster base, olive trim, a CRT
// monitor head with a pixel face on a rubber accordion neck, a jointed arm holding a clipboard and
// one holding a rubber stamp, plus a little pull-out keypad. It idles, blinks, tracks the nearest
// clone with its head, stamps forms and types, and greets whoever presses interact on it with a line
// of dry corporate orientation advice (CRT face + wristwatch feed). Slightly wrong: when nobody is
// looking its smile gets too wide; it takes a moment to fix that when you look back.
//
// Geometry is merged per moving part into one vertex-coloured material (+ a label, a glow and the
// CRT screen), so the whole robot costs ~14 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import * as Mat from '../gfx/materials.js';
import { Device } from '../game/devices.js';
import { CrtScreen, text, wrap } from '../ui/crt.js';

const PI = Math.PI;
const BEIGE = 0xbcae86, BEIGE_D = 0xa29571, OLIVE = 0x6a6c45, OLIVE_D = 0x4f5134, DARK = 0x2a2a28, RUBBER = 0x1d1d1c;
const GREY = 0x8d8f8c, WOOD = 0x7a4c2c, INK = 0x9a1c18, BOARD = 0x8a6a44;

// turret-local layout (turret pivot sits on the column at TURRET_Y)
const TURRET_Y = 0.42;
const SHOULDER = { x: 0.33, y: 0.565, z: 0.0 };
const L1 = 0.29, L2 = 0.27;          // shoulder->elbow, elbow->wrist
const STAMP = 0.101;                 // wrist -> rubber face
const BOARD_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0));
const L_WRIST = new THREE.Vector3(-0.17, 0.445, 0.35);   // left wrist (holds the clipboard by its edge)
const BOARD_OFF = new THREE.Vector3(0.125, -0.0205, 0);   // left wrist -> paper centre (wrist frame)
const R_REST = new THREE.Vector3(0.39, 0.3, 0.17);
const KEYPAD = new THREE.Vector3(0.235, 0.305, 0.3);      // keypad top centre
const POLE_R = new THREE.Vector3(1, 0.15, -0.45).normalize();
const POLE_L = new THREE.Vector3(-1, 0.15, -0.45).normalize();
const POLE_REST = new THREE.Vector3(0.45, -0.1, -1).normalize();   // right elbow tucked back while idle

// Orientation lines (rotating): tips first, then the rest of the employee handbook.
export const ROBOT_LINES = [
  'Your locker is in the locker room, past the open office. Cosmetics are the only thing you get to keep. Choose wisely.',
  'The break room is through the office to the east. Snacks are complimentary. Consumption is mandatory.',
  'The dispatch lever is in the bay behind the office. Anything inside the hazard stripes comes with you. Including regrets.',
  'Day 1 is a guaranteed safe probation day. The guarantee is non-binding.',
  'Seven days per dimension. After Day 7, reality is no longer covered by our insurance.',
  'Lost colleagues can be reprinted at the cloning pad for a modest fee. Feelings are not refundable.',
  'The cloning lab is down the hall. Please do not tap on the tubes. They tap back.',
  'Your wristwatch receives all HQ messages. Ignoring them is noted in your file.',
  'For human assistance, please ring the bell. Response times are measured in fiscal quarters.',
  'It is always morning in Sublevel B4. Please adjust your circadian rhythm accordingly.',
  'Clones are a renewable resource. Morale is not. Please smile.',
];
const GREETS = ['GOOD MORNING', 'WELCOME BACK', 'HELLO AGAIN', 'GREETINGS'];
const STAMPS = [['APPROVED', 'good'], ['FILED', 'fg'], ['APPROVED', 'good'], ['NOTED', 'fg'], ['DENIED', 'bad'], ['APPROVED', 'good']];

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _qq = new THREE.Quaternion(), _ee = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// ---------------------------------------------------------------------------------- geometry bins
class Bin {
  constructor() { this.geos = []; }
  add(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _m.compose(_p.set(x, y, z), _qq.setFromEuler(_ee.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
    const pos = g.attributes.position.array;
    // cheap baked grime: slightly darker towards the bottom of each piece
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
    for (let i = 0; i < n; i++) {
      const t = y1 - y0 > 1e-4 ? (pos[i * 3 + 1] - y0) / (y1 - y0) : 1;
      const k = 0.86 + 0.14 * t;
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return this;
  }
  box(w, h, d, hex, x, y, z, rx, ry, rz, r = 0) {
    return this.add(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz);
  }
  cyl(r0, r1, h, hex, x, y, z, rx, ry, rz, seg = 14) { return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), hex, x, y, z, rx, ry, rz); }
  ball(r, hex, x, y, z, sx = 1, sy = 1, sz = 1) { return this.add(new THREE.SphereGeometry(r, 14, 10), hex, x, y, z, 0, 0, 0, sx, sy, sz); }
  mesh(mat, parent, shadow = true) {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
}

let SHARED = null;
function materials() {
  if (SHARED) return SHARED;
  const plastic = Mat.make('plastic_white');
  plastic.color.set(0xffffff);
  plastic.vertexColors = true;
  plastic.roughness = 0.72;
  plastic.name = 'robot_plastic';
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  glow.color.setScalar(2.2);
  glow.name = 'robot_glow';
  const label = new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.7 });
  label.name = 'robot_label';
  SHARED = { plastic, glow, label, chrome: Mat.get('chrome') };
  return SHARED;
}

// one small canvas: clipboard form (left) + chassis badge (right)
const LBL = { W: 512, H: 256, paper: [0, 0, 200, 256], badge: [208, 0, 512, 80] };
function labelTexture() {
  const c = document.createElement('canvas');
  c.width = LBL.W; c.height = LBL.H;
  const x = c.getContext('2d');
  x.fillStyle = '#2b2c1d'; x.fillRect(0, 0, LBL.W, LBL.H);
  // visitor intake form, stamped many times already
  x.fillStyle = '#ece6d4'; x.fillRect(0, 0, 200, 256);
  x.fillStyle = '#26241e'; x.font = 'bold 15px "IBM Plex Mono", monospace'; x.textAlign = 'center';
  x.fillText('FORM 27-B/6', 100, 22);
  x.font = '10px "IBM Plex Mono", monospace';
  x.fillText('VISITOR / CLONE INTAKE', 100, 36);
  x.fillStyle = '#8f8a7c';
  for (let i = 0; i < 13; i++) x.fillRect(14, 50 + i * 15, 172, 1);
  x.fillStyle = '#3a3a52'; x.font = 'italic 11px serif'; x.textAlign = 'left';
  ['name: ________', 'dept: FIELD', 'blood type: ?', 'next of kin: N/A', 'clone no.: ###'].forEach((s, i) => x.fillText(s, 18, 62 + i * 30));
  const stamp = (cx, cy, rot, word, a) => {
    x.save(); x.translate(cx, cy); x.rotate(rot); x.globalAlpha = a;
    x.strokeStyle = '#a3201b'; x.lineWidth = 3; x.strokeRect(-58, -15, 116, 30);
    x.fillStyle = '#a3201b'; x.font = 'bold 19px "Arial Black", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(word, 0, 1); x.restore();
  };
  stamp(110, 140, -0.25, 'APPROVED', 0.8);
  stamp(90, 200, 0.12, 'APPROVED', 0.55);
  stamp(120, 95, 0.3, 'FILED', 0.35);
  // chassis badge
  const [bx, by, bx1, by1] = LBL.badge;
  x.fillStyle = '#c9c0a0'; x.fillRect(bx, by, bx1 - bx, by1 - by);
  x.fillStyle = '#2b2c1d'; x.fillRect(bx + 4, by + 4, bx1 - bx - 8, by1 - by - 8);
  x.fillStyle = '#e8d9a8'; x.font = 'bold 30px "Arial Black", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('GREET-O-TRON 9000', (bx + bx1) / 2, by + 32);
  x.fillStyle = '#b8a873'; x.font = 'bold 14px "IBM Plex Mono", monospace';
  x.fillText('R.O.O.M. FACILITIES  ·  DO NOT FEED', (bx + bx1) / 2, by + 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function labelPlane(w, h, region) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const [x0, y0, x1, y1] = region;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / LBL.W, 1 - (y1 - uv.getY(i) * (y1 - y0)) / LBL.H);
  }
  return g;
}

// ---------------------------------------------------------------------------------- model
export function buildReceptionRobot() {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'ReceptionRobot';

  // --- five-star caster base + chrome column (static)
  const base = new Bin();
  base.cyl(0.075, 0.09, 0.09, DARK, 0, 0.115, 0, 0, 0, 0, 18);
  base.cyl(0.05, 0.075, 0.03, DARK, 0, 0.175, 0, 0, 0, 0, 18);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
    base.box(0.27, 0.035, 0.05, DARK, ca * 0.165, 0.1, -sa * 0.165, 0, a, -0.06, 0.012);
    base.cyl(0.012, 0.012, 0.03, GREY, ca * 0.29, 0.07, -sa * 0.29, 0, 0, 0, 8);
    base.box(0.035, 0.03, 0.045, RUBBER, ca * 0.29, 0.05, -sa * 0.29, 0, a + 1.2, 0, 0.008);
    base.cyl(0.026, 0.026, 0.03, RUBBER, ca * 0.29, 0.026, -sa * 0.29, PI / 2, a + 1.2, 0, 14);
  }
  base.mesh(M.plastic, root);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.26, 16), M.chrome);
  col.position.y = 0.315;
  col.castShadow = true;
  root.add(col);

  // --- turret: tower body, olive yoke, keypad tray, badge, LEDs
  const turret = new THREE.Group();
  turret.position.y = TURRET_Y;
  root.add(turret);
  const tb = new Bin();
  tb.cyl(0.07, 0.085, 0.04, OLIVE_D, 0, -0.005, 0, 0, 0, 0, 18);                  // swivel collar
  tb.box(0.4, 0.52, 0.32, BEIGE, 0, 0.27, 0, 0, 0, 0, 0.025);                      // tower
  tb.box(0.406, 0.065, 0.326, OLIVE, 0, 0.455, 0, 0, 0, 0, 0.012);                 // trim band
  tb.box(0.34, 0.22, 0.012, BEIGE_D, 0, 0.215, 0.158, 0, 0, 0, 0.004);             // front panel
  tb.box(0.15, 0.014, 0.008, DARK, -0.03, 0.375, 0.163);                           // floppy slot
  tb.box(0.03, 0.014, 0.008, BEIGE_D, 0.085, 0.375, 0.163);                        // eject button
  for (let i = 0; i < 6; i++) tb.box(0.27, 0.008, 0.006, DARK, 0, 0.13 + i * 0.03, 0.164);   // vent slats
  tb.box(0.62, 0.075, 0.22, OLIVE, 0, 0.565, 0, 0, 0, 0, 0.02);                    // shoulder yoke
  for (const s of [-1, 1]) tb.cyl(0.05, 0.05, 0.05, OLIVE_D, s * SHOULDER.x, SHOULDER.y, 0, 0, 0, PI / 2, 16);
  tb.cyl(0.085, 0.085, 0.02, OLIVE_D, 0, 0.61, 0, 0, 0, 0, 18);                   // neck flange
  // pull-out keypad tray on the right
  tb.box(0.03, 0.025, 0.16, BEIGE_D, 0.17, 0.27, 0.2);
  tb.box(0.2, 0.022, 0.15, BEIGE, KEYPAD.x, KEYPAD.y - 0.016, KEYPAD.z, 0, 0, 0, 0.006);
  for (let i = 0; i < 12; i++) tb.box(0.028, 0.012, 0.024, i === 11 ? 0xb8402a : 0xe2dbc4, KEYPAD.x - 0.05 + (i % 4) * 0.034, KEYPAD.y - 0.002, KEYPAD.z - 0.04 + Math.floor(i / 4) * 0.035, 0, 0, 0, 0.003);
  // power cable from the back of the tower down into the base
  const cable = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.1, 0.06, -0.16), V(0.12, -0.02, -0.21), V(0.09, -0.14, -0.2), V(0.04, -0.24, -0.08)]), 16, 0.009, 6);
  tb.add(cable, RUBBER);
  tb.mesh(M.plastic, turret);
  const tg = new Bin();
  tg.box(0.014, 0.01, 0.006, 0x40ff70, 0.13, 0.375, 0.164);
  tg.box(0.014, 0.01, 0.006, 0xffa020, 0.155, 0.375, 0.164);
  tg.box(0.012, 0.008, 0.006, 0x40ff70, KEYPAD.x + 0.08, KEYPAD.y - 0.004, KEYPAD.z + 0.07);
  tg.mesh(M.glow, turret, false);
  const badge = new THREE.Mesh(labelPlane(0.2, 0.052, LBL.badge), M.label);
  badge.position.set(0, 0.455, 0.1645);
  turret.add(badge);

  // --- rubber accordion neck + CRT head
  const neck = new THREE.Group();
  neck.position.y = 0.62;
  turret.add(neck);
  const folds = [];
  const NF = 7, NH = 0.17;
  for (let i = 0; i <= NF * 2; i++) folds.push(new THREE.Vector2(i % 2 ? 0.074 : 0.056, (i / (NF * 2)) * NH));
  const nb = new Bin();
  nb.add(new THREE.LatheGeometry(folds, 18), RUBBER);
  nb.mesh(M.plastic, neck);
  const head = new THREE.Group();
  head.position.y = NH;
  neck.add(head);
  const hb = new Bin();
  hb.box(0.2, 0.03, 0.16, OLIVE_D, 0, 0.012, -0.01, 0, 0, 0, 0.01);               // neck mount
  hb.box(0.46, 0.37, 0.07, BEIGE, 0, 0.21, 0.095, 0, 0, 0, 0.024);                // bezel
  hb.box(0.42, 0.33, 0.2, BEIGE_D, 0, 0.205, -0.03, 0, 0, 0, 0.03);               // case
  hb.box(0.3, 0.23, 0.15, BEIGE_D, 0, 0.2, -0.19, 0, 0, 0, 0.035);                // tube housing
  for (let i = 0; i < 5; i++) hb.box(0.24, 0.006, 0.012, OLIVE_D, 0, 0.371, -0.1 + i * 0.028);                // top vents
  hb.box(0.37, 0.28, 0.01, RUBBER, 0, 0.225, 0.128);                              // screen surround
  for (const s of [-1, 1]) {
    hb.cyl(0.036, 0.036, 0.03, OLIVE, s * 0.225, 0.21, 0.0, 0, 0, PI / 2, 16);   // ear bolts
    hb.cyl(0.016, 0.016, 0.02, GREY, s * 0.245, 0.21, 0.0, 0, 0, PI / 2, 10);
  }
  hb.cyl(0.011, 0.011, 0.016, DARK, -0.16, 0.05, 0.135, PI / 2, 0, 0, 12);        // knobs
  hb.cyl(0.011, 0.011, 0.016, DARK, -0.125, 0.05, 0.135, PI / 2, 0, 0, 12);
  hb.cyl(0.005, 0.005, 0.15, GREY, 0.14, 0.44, -0.07, 0, 0, -0.25, 6);            // antenna
  hb.mesh(M.plastic, head);
  const hg = new Bin();
  hg.ball(0.02, 0xffb030, 0.14 + Math.sin(0.25) * 0.075, 0.44 + Math.cos(0.25) * 0.075, -0.07);
  hg.cyl(0.008, 0.008, 0.008, 0xff4020, 0.17, 0.05, 0.132, PI / 2, 0, 0, 10);       // power LED
  const lamp = hg.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'robot_lamp' }), head, false);
  lamp.material.color.setScalar(2.2);
  // CRT face: gently bulged 4:3 glass
  const sg = new THREE.PlaneGeometry(0.33, 0.2475, 8, 6);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i) / 0.165, y = sp.getY(i) / 0.124; sp.setZ(i, 0.008 * (1 - x * x) * (1 - y * y)); }
  sg.computeVertexNormals();
  const screen = new THREE.Mesh(sg, M.plastic);
  screen.position.set(0, 0.225, 0.1335);
  head.add(screen);

  // --- arms
  const arm = (side) => {
    const sh = new THREE.Group();
    sh.position.set(side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    turret.add(sh);
    const ub = new Bin();
    ub.ball(0.045, DARK, 0, 0, 0);
    ub.cyl(0.03, 0.03, L1 - 0.06, OLIVE, 0, -L1 / 2, 0);
    for (const y of [-0.06, -L1 + 0.05]) ub.cyl(0.036, 0.036, 0.025, OLIVE_D, 0, y, 0);
    ub.mesh(M.plastic, sh);
    const el = new THREE.Group();
    el.position.y = -L1;
    sh.add(el);
    const fb = new Bin();
    fb.ball(0.04, DARK, 0, 0, 0);
    fb.cyl(0.026, 0.03, L2 - 0.05, BEIGE, 0, -L2 / 2, 0);
    fb.cyl(0.034, 0.034, 0.02, OLIVE_D, 0, -L2 + 0.035, 0);
    fb.mesh(M.plastic, el);
    const wr = new THREE.Group();
    wr.position.y = -L2;
    el.add(wr);
    return { sh, el, wr, side };
  };
  const armL = arm(-1), armR = arm(1);
  // right hand: two-finger gripper around a wooden rubber stamp
  const rb = new Bin();
  rb.ball(0.028, DARK, 0, 0, 0);
  rb.box(0.06, 0.02, 0.04, OLIVE_D, 0, -0.018, 0, 0, 0, 0, 0.006);
  for (const s of [-1, 1]) rb.box(0.012, 0.05, 0.026, DARK, s * 0.028, -0.045, 0, 0, 0, -s * 0.12, 0.004);
  rb.ball(0.024, WOOD, 0, -0.036, 0, 1, 0.85, 1);
  rb.cyl(0.011, 0.014, 0.04, WOOD, 0, -0.062, 0, 0, 0, 0, 10);
  rb.box(0.075, 0.022, 0.052, WOOD, 0, -0.084, 0, 0, 0, 0, 0.004);
  rb.box(0.07, 0.006, 0.047, INK, 0, -STAMP + 0.003, 0);
  rb.mesh(M.plastic, armR.wr);
  // left hand: gripper pinching the clipboard by its left edge
  const lb = new Bin();
  lb.ball(0.028, DARK, 0, 0, 0);
  lb.box(0.04, 0.02, 0.05, OLIVE_D, 0.012, -0.018, 0, 0, 0, 0, 0.006);
  for (const s of [-1, 1]) lb.box(0.04, 0.008, 0.03, DARK, 0.028, BOARD_OFF.y + s * 0.01 - 0.0045, 0, 0, 0, 0, 0.003);
  lb.box(0.23, 0.008, 0.31, BOARD, BOARD_OFF.x, BOARD_OFF.y - 0.0045, 0, 0, 0, 0, 0.0035);
  lb.box(0.085, 0.014, 0.035, GREY, BOARD_OFF.x, BOARD_OFF.y + 0.003, 0.135, 0, 0, 0, 0.004);
  lb.cyl(0.008, 0.008, 0.07, GREY, BOARD_OFF.x, BOARD_OFF.y + 0.011, 0.148, 0, 0, PI / 2, 8);
  lb.mesh(M.plastic, armL.wr);
  const paper = new THREE.Mesh(labelPlane(0.2, 0.256, LBL.paper), M.label);
  paper.rotation.x = -PI / 2;
  paper.position.set(BOARD_OFF.x, BOARD_OFF.y + 0.0005, -0.012);
  paper.receiveShadow = true;
  armL.wr.add(paper);

  return { root, turret, neck, head, screen, lamp, armL, armR };
}
function V(x, y, z) { return new THREE.Vector3(x, y, z); }

// Two-bone IK with a pole vector, all in turret space. Sets shoulder / elbow quaternions so the wrist
// lands on `target`, and the wrist so the hand keeps orientation `handQ` (turret space).
export function solveArm(a, target, pole, handQ) {
  const S = _v.set(a.side * SHOULDER.x, SHOULDER.y, SHOULDER.z);
  const T = _v2.copy(target).sub(S);
  let d = T.length();
  d = Math.min(Math.max(d, Math.abs(L1 - L2) + 0.02), L1 + L2 - 0.002);
  const u = T.normalize();
  const ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), a1 = Math.acos(Math.min(1, Math.max(-1, ca)));
  const w = _v3.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
  const E = new THREE.Vector3().copy(u).multiplyScalar(Math.cos(a1) * L1).addScaledVector(w, Math.sin(a1) * L1); // elbow, shoulder-relative
  const W = u.clone().multiplyScalar(d);                                                                     // wrist, shoulder-relative
  a.sh.quaternion.setFromUnitVectors(DOWN, E.clone().normalize());
  const fore = W.sub(E).normalize().applyQuaternion(_q.copy(a.sh.quaternion).invert());
  a.el.quaternion.setFromUnitVectors(DOWN, fore);
  _q2.copy(a.sh.quaternion).multiply(a.el.quaternion).invert();
  a.wr.quaternion.copy(_q2).multiply(handQ);
  return E.add(S); // elbow in turret space (debug / tests)
}

// ---------------------------------------------------------------------------------- device
export class ReceptionRobot extends Device {
  constructor(world, id, opts = {}) {
    super(world, id, opts);
    this.range = 2.6;
    this.state = { say: null };
    const m = buildReceptionRobot();
    this.m = m;
    this.root.add(m.root);
    this.scr = new CrtScreen(256, 192, 'amber');
    this.scr.fps = 14;
    this.scr.attach(m.screen, 1.35);
    this.t = Math.random() * 10;
    this.lineIdx = 0;
    this.greetIdx = 0;
    this.say = null;            // { greet, name, body, t }
    this.flash = null;          // stamp result { word, col, t }
    this.act = null;            // { kind, t, dur, ... }
    this.nextAct = 2.5;
    this.blinkT = 2;
    this.blink = 0;
    this.sacc = { x: 0, y: 0, t: 1 };
    this.watchedT = 0; this.unwatchedT = 0; this.obsT = 0;
    this.stare = 0;
    this.cool = 0;
    this.tYaw = 0; this.nYaw = 0; this.hPitch = 0;
    this.rWrist = R_REST.clone();
    this.lWrist = L_WRIST.clone();
    this.poleR = POLE_REST.clone();
    this._tgt = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._handQ = BOARD_Q.clone();
    this._pose();
  }

  build() {
    // two static boxes (body+arms, head) carry the interaction prompt and block players
    this.root.updateMatrixWorld(true);
    const ud = { kind: 'device', device: this };
    const ry = this.root.rotation.y;
    for (const [x, y, z, hx, hy, hz] of [[0.0, 0.5, 0.08, 0.3, 0.5, 0.3], [0, 1.39, 0.02, 0.25, 0.21, 0.25]]) {
      const c = this.root.localToWorld(new THREE.Vector3(x, y, z));
      this.colliders.push(this.world.physics.addStaticBox(c.x, c.y, c.z, hx, hy, hz, ud, ry));
    }
  }

  prompt() { return `[${input.keyName('interact')}] Talk to GREET-O-TRON 9000`; }

  interact(player) {
    if (this.cool > 0) return;
    this.cool = 1.1;
    const name = (player?.name || this.world.game?.local?.name || 'EMPLOYEE').toString();
    const i = this.lineIdx++ % ROBOT_LINES.length;
    const gi = this.greetIdx++ % GREETS.length;
    this._speak(name, i, gi, true);
    this.send('greet', { n: name.slice(0, 24), i, g: gi });
  }

  hostAction(a, d, from) {
    if (a !== 'greet' || !d) return;
    this.setState({ say: { n: String(d.n || 'EMPLOYEE').slice(0, 24), i: d.i | 0, g: d.g | 0, from, k: (this.state.say?.k || 0) + 1 } });
  }

  onState(s) {
    // other clones' greetings: show on the face and play the voice, no wristwatch spam
    if (s.say && s.say.from !== net.selfId) this._speak(s.say.n, s.say.i, s.say.g, false);
  }

  _speak(name, i, gi, local) {
    const body = ROBOT_LINES[((i % ROBOT_LINES.length) + ROBOT_LINES.length) % ROBOT_LINES.length];
    const greet = GREETS[((gi % GREETS.length) + GREETS.length) % GREETS.length];
    this.say = { greet: `${greet}, ${name.toUpperCase()}.`, body, t: 0, dur: 4.5 + body.length * 0.045 };
    this.flash = null;
    this.act = { kind: 'wave', t: 0, dur: 2.1 };
    this.stare = 0;
    if (local) this.world.game?.ui?.feed?.(`${greet.charAt(0) + greet.slice(1).toLowerCase()}, ${name}. ${body}`, 'hq', 'RECEPTION');
    const p = this.m.head.getWorldPosition(this._tmp);
    audio.play('ui_blip', { pos: p, volume: 0.5, pitch: 0.8 });
    audio.play('healthity_talk', { pos: p, volume: 0.7, len: Math.min(3.2, 0.9 + body.length * 0.018), pitch: 0.62 });
  }

  // nearest living clone (feet position) within reach of its attention
  _nearest() {
    const g = this.world.game;
    if (!g) return null;
    let best = null, bd = 7.5;
    const me = this.root.position;
    const consider = (p) => { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < bd) { bd = d; best = p; } };
    if (g.local && !g.local.dead) consider(g.local.pos);
    for (const r of g.remotes?.values?.() || []) if (r.inWorld && !r.dead) consider(r.pos);
    return best;
  }

  _observed() {
    const g = this.world.game;
    if (!g) return false;
    const p = this.m.head.getWorldPosition(this._tmp);
    const list = [];
    if (g.local && !g.local.dead) list.push(g.local);
    for (const r of g.remotes?.values?.() || []) if (r.inWorld && !r.dead) list.push(r);
    for (const pl of list) {
      const ex = pl.pos.x, ey = pl.pos.y + 1.15, ez = pl.pos.z;
      let dx = p.x - ex, dy = p.y - ey, dz = p.z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > 25 || d < 1e-3) continue;
      dx /= d; dy /= d; dz /= d;
      const cp = Math.cos(pl.pitch || 0);
      const fx = -Math.sin(pl.yaw) * cp, fy = Math.sin(pl.pitch || 0), fz = -Math.cos(pl.yaw) * cp;
      if (fx * dx + fy * dy + fz * dz > 0.35) return true;
    }
    return false;
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    this.cool = Math.max(0, this.cool - dt);
    // ---- attention: turret + neck servo towards the nearest clone's eyes
    const tgt = this._nearest();
    let yawWant, pitchWant = 0;
    if (tgt) {
      this.root.updateMatrixWorld(true);
      const l = this.root.worldToLocal(this._tgt.set(tgt.x, tgt.y + 1.2, tgt.z));
      yawWant = Math.atan2(l.x, l.z);
      const hy = TURRET_Y + 0.62 + 0.17 + 0.2;
      pitchWant = -Math.atan2(l.y - hy, Math.max(0.3, Math.hypot(l.x, l.z)));
    } else {
      yawWant = Math.sin(t * 0.23) * 0.6 + Math.sin(t * 0.07) * 0.3; // idle scan
    }
    const servo = (cur, want, speed) => cur + Math.max(-speed * dt, Math.min(speed * dt, want - cur));
    const busy = this.act && this.act.kind !== 'wave';
    const tWant = Math.max(-0.95, Math.min(0.95, yawWant * (busy ? 0.25 : 0.65)));
    this.tYaw = servo(this.tYaw, tWant, 1.1);
    this.nYaw = servo(this.nYaw, Math.max(-0.75, Math.min(0.75, yawWant - this.tYaw)), 2.6);
    this.hPitch = servo(this.hPitch, Math.max(-0.4, Math.min(0.35, busy ? 0.32 : pitchWant)), 1.6);
    // ---- uncanny: the smile drifts wider while nobody watches, and lingers a moment when caught
    this.obsT -= dt;
    if (this.obsT <= 0) { this.obsT = 0.3; this._obs = this._observed(); }
    if (this._obs) { this.watchedT += dt; this.unwatchedT = 0; } else { this.unwatchedT += dt; this.watchedT = 0; }
    if (!this._obs && this.unwatchedT > 5 && !this.say) this.stare = 1;
    if (this._obs && this.watchedT > 0.45) this.stare = 0;
    // ---- idle actions: stamp forms, type on the keypad
    this.nextAct -= dt;
    if (!this.act && this.nextAct <= 0 && !this.say) {
      this.act = Math.random() < 0.55 ? { kind: 'stamp', t: 0, dur: 1.6, hit: false, dx: (Math.random() - 0.5) * 0.08, dz: (Math.random() - 0.5) * 0.1 } : { kind: 'type', t: 0, dur: 2.4, taps: 0, key: 0 };
      this.nextAct = 4 + Math.random() * 5;
    }
    this._animate(dt);
    this._pose();
    // ---- blink + saccades
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.14; this.blinkT = Math.random() < 0.2 ? 0.25 : 2.2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    this.sacc.t -= dt;
    if (this.sacc.t <= 0) { this.sacc.t = 0.8 + Math.random() * 2.2; this.sacc.x = Math.round((Math.random() - 0.5) * 2); this.sacc.y = Math.random() < 0.3 ? 1 : 0; }
    // antenna lamp: slow pulse, fast while talking
    const lp = this.say ? 0.6 + 0.4 * (Math.sin(t * 18) > 0 ? 1 : 0) : 0.35 + 0.3 * (Math.sin(t * 2.2) * 0.5 + 0.5);
    this.m.lamp.material.color.setScalar(0.4 + lp * 2.2);
    if (this.say) { this.say.t += dt; if (this.say.t > this.say.dur) this.say = null; }
    if (this.flash) { this.flash.t += dt; if (this.flash.t > 0.9) this.flash = null; }
    // ---- CRT face (only redrawn near the local clone)
    const lp2 = this.world.game?.local?.pos;
    if (!lp2 || lp2.distanceTo(this.root.position) < 16) this.scr.draw(dt, (ctx, w, h, pal, tt) => this._face(ctx, w, h, pal, tt));
  }

  _animate(dt) {
    const a = this.act;
    const t = this.t;
    const k = (r) => 1 - Math.exp(-dt * r);
    const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    // left arm: holds the clipboard, gentle bob, dips when stamped
    const lT = this._tmp.copy(L_WRIST);
    lT.y += Math.sin(t * 1.3) * 0.006;
    if (a?.kind === 'stamp' && a.hit && a.t - a.hitT < 0.25) lT.y -= 0.012 * (1 - (a.t - a.hitT) / 0.25);
    this.lWrist.lerp(lT, k(10));
    // right arm target
    const R = this._tgt.copy(R_REST);
    R.y += Math.sin(t * 1.1 + 1) * 0.008;
    let rate = 7;
    if (a) {
      a.t += dt;
      const u = a.t;
      if (a.kind === 'stamp') {
        const P = this._paperPoint(a.dx, a.dz, this._v ||= new THREE.Vector3());
        const above = _v3.copy(P); above.y += 0.17;
        if (u < 0.45) R.lerpVectors(R_REST, above, ease(u / 0.45));
        else if (u < 0.62) { R.copy(above); R.x += Math.sin(u * 40) * 0.004; }
        else if (u < 0.72) { R.lerpVectors(above, P, ease((u - 0.62) / 0.1) ** 2); rate = 40; }
        else if (u < 0.95) { R.copy(P); rate = 40; }
        else if (u < 1.15) R.lerpVectors(P, above, ease((u - 0.95) / 0.2));
        else R.lerpVectors(above, R_REST, ease((u - 1.15) / 0.45));
        if (!a.hit && u >= 0.72) {
          a.hit = true; a.hitT = u;
          const p = this.m.armR.wr.getWorldPosition(_v3);
          audio.play('thunk', { pos: p, volume: 0.35, pitch: 1.5 });
          const s = STAMPS[Math.floor(Math.random() * STAMPS.length)];
          this.flash = { word: s[0], col: s[1], t: 0 };
        }
      } else if (a.kind === 'type') {
        const keyPos = (i, out) => out.set(KEYPAD.x - 0.05 + (i % 4) * 0.034, KEYPAD.y + 0.005 + STAMP, KEYPAD.z - 0.04 + Math.floor(i / 4) * 0.035);
        const K = keyPos(a.key, _v3);
        if (u < 0.35) R.lerpVectors(R_REST, K.setY(K.y + 0.06), ease(u / 0.35));
        else if (u < a.dur - 0.4) {
          const ph = (u - 0.35) / 0.17, n = Math.floor(ph);
          if (n !== a.taps) { a.taps = n; a.key = Math.floor(Math.random() * 12); keyPos(a.key, K); audio.play('ui_type', { pos: this.m.armR.wr.getWorldPosition(this._tmp2 ||= new THREE.Vector3()), volume: 0.22 }); }
          R.copy(K); R.y += 0.035 * Math.abs(Math.sin((ph % 1) * PI + PI / 2));
          rate = 30;
        } else R.lerpVectors(K.setY(K.y + 0.06), R_REST, ease((u - (a.dur - 0.4)) / 0.4));
      } else if (a.kind === 'wave') {
        const up = _v3.set(0.5, 0.86, 0.22);
        const e = u < 0.35 ? ease(u / 0.35) : u > a.dur - 0.4 ? 1 - ease((u - (a.dur - 0.4)) / 0.4) : 1;
        R.lerpVectors(R_REST, up, e);
        R.x += Math.sin(u * 15) * 0.06 * e;
        rate = 16;
      }
      if (a.t >= a.dur) this.act = null;
    }
    this.rWrist.lerp(R, k(rate));
    this.poleR.lerp(a ? POLE_R : POLE_REST, k(6)).normalize();
  }

  // paper point (turret space) on the clipboard currently held by the left wrist; dx/dz offset on the sheet
  _paperPoint(dx, dz, out) {
    out.set(BOARD_OFF.x + dx, BOARD_OFF.y + 0.001, dz).applyQuaternion(BOARD_Q).add(this.lWrist);
    // stamp face hangs STAMP below the wrist along the hand's down axis
    return out.add(_v2.set(0, STAMP, 0).applyQuaternion(BOARD_Q));
  }

  _pose() {
    const m = this.m;
    m.turret.rotation.y = this.tYaw;
    m.neck.rotation.y = this.nYaw;
    const talk = this.say ? Math.sin(this.t * 9) * 0.03 : 0;
    m.neck.scale.y = 1 + Math.sin(this.t * 1.7) * 0.035;
    m.head.rotation.set(this.hPitch + talk, 0, Math.sin(this.t * 0.9) * 0.035 + (this.stare ? 0.09 : 0));
    solveArm(m.armL, this.lWrist, POLE_L, BOARD_Q);
    solveArm(m.armR, this.rWrist, this.poleR, BOARD_Q);
  }

  // ---------------------------------------------------------------------------------- CRT face
  _face(ctx, w, h, pal, tt) {
    if (this.flash) {
      const f = this.flash;
      const col = pal[f.col] || pal.fg;
      ctx.strokeStyle = col; ctx.lineWidth = 6;
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.08);
      ctx.strokeRect(-104, -34, 208, 68);
      text(ctx, f.word, 0, -26, 50, col, 'center');
      ctx.restore();
      return;
    }
    if (this.say) {
      this._pixFace(ctx, 80, 2, 3, pal, tt, true);
      const s = this.say;
      const shown = Math.floor(Math.max(0, s.t - 0.25) * 34);
      text(ctx, s.greet, 10, 74, 22, pal.hi);
      const lines = wrap(ctx, s.body, w - 20, 20);
      let left = shown;
      const out = [];
      for (const ln of lines) { if (left <= 0) break; out.push(ln.slice(0, left)); left -= ln.length + 1; }
      const vis = out.slice(-5);
      vis.forEach((ln, i) => text(ctx, ln, 10, 98 + i * 18, 20, pal.fg));
      if (Math.floor(tt * 3) % 2 === 0 && shown < s.body.length + 5) {
        const last = vis[vis.length - 1] || '';
        ctx.font = `20px "VT323", "IBM Plex Mono", monospace`;
        ctx.fillStyle = pal.fg;
        ctx.fillRect(12 + ctx.measureText(last).width, 98 + Math.max(0, vis.length - 1) * 18 + 2, 8, 16);
      }
      return;
    }
    this._pixFace(ctx, 0, 0, 8, pal, tt, false);
    if (!this.stare && Math.floor(tt) % 23 === 0) text(ctx, 'HOW MAY I HELP', w / 2, h - 22, 18, pal.dim, 'center');
  }

  // 32 x 24 pixel-matrix face, `c` px per cell, top-left at ox, oy
  _pixFace(ctx, ox, oy, c, pal, tt, talking) {
    const g = c > 4 ? c - 1 : c;
    const block = (gx, gy, bw, bh, col) => {
      ctx.fillStyle = col;
      for (let i = 0; i < bw; i++) for (let j = 0; j < bh; j++) ctx.fillRect(ox + (gx + i) * c, oy + (gy + j) * c, g, g);
    };
    const hole = (gx, gy, bw, bh) => {
      ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = pal.bg;
      ctx.fillRect(ox + gx * c - 0.5, oy + gy * c - 0.5, bw * c + 1, bh * c + 1);
      ctx.restore();
    };
    const stare = this.stare && !talking;
    const blink = this.blink > 0 && !stare;
    const sx = Math.max(-1, Math.min(1, this.sacc.x + Math.round(-this.nYaw * 1.5)));
    const sy = this.sacc.y;
    for (const ex of [8, 19]) {
      if (blink) { block(ex, 10, 5, 1, pal.fg); continue; }
      if (stare) {
        block(ex - 1, 4, 7, 8, pal.fg);
        hole(ex + 2 + sx, 7 + sy, 1, 1);
      } else {
        block(ex, 6, 5, 6, pal.fg);
        hole(ex + 1 + sx + 1, 8 + sy, 2, 2);
        block(ex, 4, 5, 1, pal.dim); // brows
      }
    }
    // cheeks
    if (!stare) { block(5, 14, 2, 1, pal.dim); block(25, 14, 2, 1, pal.dim); }
    // mouth
    if (talking) {
      const open = Math.sin(tt * 23) + Math.sin(tt * 37) > 0.2;
      if (open) { block(12, 15, 8, 1, pal.fg); block(12, 18, 8, 1, pal.fg); block(11, 16, 1, 2, pal.fg); block(20, 16, 1, 2, pal.fg); }
      else { block(11, 16, 10, 1, pal.fg); block(10, 15, 1, 1, pal.fg); block(21, 15, 1, 1, pal.fg); }
    } else if (stare) {
      block(6, 18, 20, 1, pal.fg); block(5, 17, 1, 1, pal.fg); block(26, 17, 1, 1, pal.fg); block(4, 16, 1, 1, pal.fg); block(27, 16, 1, 1, pal.fg);
      for (let i = 0; i < 9; i++) block(7 + i * 2, 17, 1, 1, pal.dim); // teeth
    } else {
      block(11, 17, 10, 1, pal.fg); block(10, 16, 1, 1, pal.fg); block(21, 16, 1, 1, pal.fg);
    }
  }

  dispose() {
    super.dispose();
    this.scr.texture.dispose();
  }
}
