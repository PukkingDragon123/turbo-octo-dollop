// R.O.O.M. — Level 0 field-camp kit models (picked up by catalog.js through the models_*.js glob).
//
// Physics props (origin = centre of the visual bounds, front +Z, meters):
//   camp_kit     long wooden TENT KIT crate. parts.lid (hinge at the back top edge; rotation.x < 0 opens)
//   camp_pole    aluminium A-frame tent pole (legs in the XY plane, apex up)
//   camp_canvas  rolled tent canvas bundle (long axis X) with straps
//   camp_stakes  bundle of tent stakes tied with cord (long axis X)
//   camp_lamp    stake post with a hanging hurricane lantern. userData.setLit(bool), parts.mantle
// The finished tent, the teleport pads and the ghost markers are built in src/game/campdevices.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as Mat from '../gfx/materials.js';

const PI = Math.PI;

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
const rbox = (w, h, d, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.99);
const cyl = (r0, r1, h, seg = 12) => new THREE.CylinderGeometry(r0, r1, h, seg);

// a rod between two points
function rod(a, b, r, mat, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(cyl(r, r, len, seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

// stencil decal (canvas texture on a plane)
const decalCache = new Map();
function stencil(key, w, h, draw) {
  let tex = decalCache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = Math.round(512 * (h / w));
    const ctx = c.getContext('2d');
    draw(ctx, c.width, c.height);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    decalCache.set(key, tex);
  }
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.userData.noShadow = true;
  return m;
}

function kitStencil(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(25,20,14,0.86)';
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(h * 0.3)}px "IBM Plex Mono", monospace`;
  ctx.fillText('FIELD CAMP KIT', w / 2, h * 0.4);
  ctx.font = `${Math.round(h * 0.16)}px "IBM Plex Mono", monospace`;
  ctx.fillText('R.O.O.M. · TENT MODEL 4B · 1 SET', w / 2, h * 0.68);
  ctx.fillText('▲ THIS SIDE UP ▲', w / 2, h * 0.9);
  // weathering: knock out specks so it reads as spray paint
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.7})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
function campKit() {
  const L = 1.3, H = 0.5, D = 0.6;
  const o = new THREE.Group();
  const wood = Mat.get('plank');
  const dark = Mat.get('wood_dark');
  const metal = Mat.get('metal_dark');
  // body: floor + walls (open top) so the lid can swing open onto an empty crate
  const t = 0.04;
  o.add(mesh(rbox(L, t, D, 0.01), wood, 0, -H / 2 + t / 2, 0));
  o.add(mesh(rbox(L, H - t, t, 0.01), wood, 0, t / 2, D / 2 - t / 2));
  o.add(mesh(rbox(L, H - t, t, 0.01), wood, 0, t / 2, -D / 2 + t / 2));
  o.add(mesh(rbox(t, H - t, D - 2 * t, 0.01), wood, L / 2 - t / 2, t / 2, 0));
  o.add(mesh(rbox(t, H - t, D - 2 * t, 0.01), wood, -L / 2 + t / 2, t / 2, 0));
  // battens + corner brackets + rope handles
  for (const z of [D / 2 + 0.012, -D / 2 - 0.012]) {
    for (const x of [-L / 2 + 0.08, L / 2 - 0.08]) o.add(mesh(rbox(0.07, H - 0.02, 0.025, 0.006), dark, x, 0, z));
    o.add(mesh(rbox(L - 0.1, 0.06, 0.025, 0.006), dark, 0, -H / 2 + 0.06, z));
    for (const x of [-L / 2 + 0.02, L / 2 - 0.02]) for (const y of [-H / 2 + 0.03, H / 2 - 0.03]) o.add(mesh(rbox(0.07, 0.07, 0.03, 0.004), metal, x, y, z));
  }
  for (const sx of [-1, 1]) o.add(mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14, PI), Mat.get('fabric_brown'), sx * (L / 2 + 0.02), 0.05, 0, 0, sx * PI / 2, 0));
  // stencils on both long sides
  const s1 = stencil('kit', 0.9, 0.3, kitStencil);
  s1.position.set(0, 0.04, D / 2 + 0.026);
  o.add(s1);
  const s2 = s1.clone();
  s2.position.set(0, 0.04, -D / 2 - 0.026);
  s2.rotation.y = PI;
  o.add(s2);
  // lid on a hinge at the back top edge
  const lid = new THREE.Group();
  lid.position.set(0, H / 2, -D / 2);
  lid.add(mesh(rbox(L + 0.02, 0.045, D + 0.02, 0.01), wood, 0, 0.02, D / 2));
  for (const x of [-0.4, 0, 0.4]) lid.add(mesh(rbox(0.06, 0.02, D - 0.04, 0.005), dark, x, 0.052, D / 2));
  lid.add(mesh(rbox(0.12, 0.03, 0.03, 0.006), metal, 0, 0.0, D + 0.01)); // latch
  o.add(lid);
  // stuff inside (visible when open): a rolled canvas and pole ends
  o.add(mesh(cyl(0.12, 0.12, L - 0.2, 12), Mat.get('fabric_green'), 0, -H / 2 + 0.16, 0.1, 0, 0, PI / 2));
  for (const z of [-0.12, -0.18]) o.add(mesh(cyl(0.02, 0.02, L - 0.15, 8), Mat.get('metal'), 0, -H / 2 + 0.1, z, 0, 0, PI / 2));
  return {
    object: o,
    colliders: [{ type: 'box', size: [L, H, D], pos: [0, 0, 0] }],
    mass: 30, material: 'wood', halfHeight: H / 2,
    parts: { lid }, anchors: {}, params: { lidOpenSign: -1 },
  };
}

// A-frame: legs from (±W, -H/2) to (0, H/2) with a spreader bar and foot pads
export const POLE_W = 0.78, POLE_H = 1.36;
function campPole() {
  const o = new THREE.Group();
  const al = Mat.get('metal_green');
  const steel = Mat.get('metal');
  const rub = Mat.get('rubber');
  const r = 0.022;
  for (const sx of [-1, 1]) {
    o.add(rod([sx * POLE_W, -POLE_H / 2, 0], [0, POLE_H / 2 - 0.02, 0], r, al));
    o.add(mesh(cyl(0.04, 0.045, 0.03, 10), rub, sx * POLE_W, -POLE_H / 2 + 0.012, 0));
  }
  o.add(rod([-POLE_W * 0.62, -POLE_H / 2 + POLE_H * 0.38, 0], [POLE_W * 0.62, -POLE_H / 2 + POLE_H * 0.38, 0], 0.014, steel));
  o.add(mesh(new THREE.SphereGeometry(0.045, 12, 8), steel, 0, POLE_H / 2 - 0.02, 0)); // apex coupler
  o.add(mesh(cyl(0.03, 0.03, 0.12, 10), steel, 0, POLE_H / 2 - 0.02, 0, PI / 2, 0, 0)); // ridge socket
  const tilt = Math.atan2(POLE_W, POLE_H);
  const half = Math.hypot(POLE_W, POLE_H) / 2;
  return {
    object: o,
    colliders: [
      { type: 'capsule', radius: 0.035, halfHeight: half - 0.035, pos: [-POLE_W / 2, 0, 0], rot: [0, 0, -tilt] },
      { type: 'capsule', radius: 0.035, halfHeight: half - 0.035, pos: [POLE_W / 2, 0, 0], rot: [0, 0, tilt] },
    ],
    mass: 3.5, material: 'metal', halfHeight: POLE_H / 2,
    parts: {}, anchors: {},
  };
}

function campCanvas() {
  const o = new THREE.Group();
  const cloth = Mat.get('fabric_green');
  const strap = Mat.get('fabric_brown');
  const len = 1.0, r = 0.17;
  o.add(mesh(cyl(r, r, len, 18), cloth, 0, 0, 0, 0, 0, PI / 2));
  // rolled-end spirals
  for (const sx of [-1, 1]) o.add(mesh(new THREE.TorusGeometry(r * 0.55, 0.02, 6, 18), cloth, sx * (len / 2 + 0.005), 0, 0, 0, PI / 2, 0));
  for (const x of [-0.3, 0.3]) o.add(mesh(new THREE.TorusGeometry(r + 0.008, 0.016, 6, 20), strap, x, 0, 0, 0, PI / 2, 0));
  o.add(mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 14, PI), strap, 0, r + 0.005, 0, 0, 0, 0)); // carry handle
  return {
    object: o,
    colliders: [{ type: 'cylinder', radius: r, height: len, pos: [0, 0, 0], rot: [0, 0, PI / 2] }],
    mass: 6, material: 'fabric', halfHeight: r,
    parts: {}, anchors: {},
  };
}

function campStakes() {
  const o = new THREE.Group();
  const wood = Mat.get('wood_light');
  const cord = Mat.get('fabric_red');
  const len = 0.5;
  const offs = [[0, 0], [0.045, 0.03], [-0.045, 0.03], [0.025, -0.04], [-0.025, -0.04]];
  for (const [y, z] of offs) {
    o.add(mesh(cyl(0.018, 0.018, len - 0.08, 6), wood, 0.04, y, z, 0, 0, PI / 2));
    o.add(mesh(new THREE.ConeGeometry(0.018, 0.08, 6), wood, -len / 2 + 0.04 + 0.0, y, z, 0, 0, PI / 2));
  }
  for (const x of [-0.1, 0.12]) o.add(mesh(new THREE.TorusGeometry(0.075, 0.01, 5, 14), cord, x, 0, 0, 0, PI / 2, 0));
  // a little mallet tied on
  o.add(mesh(rbox(0.07, 0.07, 0.12, 0.01), Mat.get('rubber'), 0.2, 0.08, 0));
  o.add(mesh(cyl(0.012, 0.012, 0.22, 6), Mat.get('wood_dark'), 0.1, 0.08, 0, 0, 0, PI / 2));
  return {
    object: o,
    colliders: [{ type: 'box', size: [len, 0.18, 0.16], pos: [0, 0.01, 0] }],
    mass: 2.2, material: 'wood', halfHeight: 0.08,
    parts: {}, anchors: {},
  };
}

// post (bottom spike) + gallows arm + hurricane lantern. Lit: warm mantle + glow
export const LAMP_H = 1.2;
function campLamp() {
  const o = new THREE.Group();
  const wood = Mat.get('wood_dark');
  const brass = Mat.get('brass');
  const H = LAMP_H;
  o.add(mesh(rbox(0.055, H - 0.12, 0.055, 0.008), wood, 0, 0.06, 0));
  o.add(mesh(new THREE.ConeGeometry(0.04, 0.12, 4), wood, 0, -H / 2 + 0.06, 0, PI, PI / 4, 0));
  o.add(mesh(rbox(0.3, 0.04, 0.04, 0.006), wood, 0.12, H / 2 - 0.04, 0));
  o.add(rod([0.0, H / 2 - 0.2, 0], [0.18, H / 2 - 0.05, 0], 0.01, wood, 6));
  // lantern hanging from the arm tip
  const lan = new THREE.Group();
  lan.position.set(0.24, H / 2 - 0.2, 0);
  lan.add(mesh(new THREE.TorusGeometry(0.03, 0.004, 5, 12), brass, 0, 0.17, 0));
  lan.add(mesh(cyl(0.05, 0.075, 0.04, 14), brass, 0, 0.12, 0));
  lan.add(mesh(cyl(0.075, 0.075, 0.03, 14), brass, 0, -0.1, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    lan.add(rod([Math.cos(a) * 0.07, -0.09, Math.sin(a) * 0.07], [Math.cos(a) * 0.05, 0.1, Math.sin(a) * 0.05], 0.004, brass, 5));
  }
  const glass = new THREE.MeshStandardMaterial({ color: 0xfff2d8, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  glass.userData.noProbe = true;
  lan.add(mesh(new THREE.SphereGeometry(0.068, 16, 12), glass, 0, 0.0, 0));
  const mantleMat = new THREE.MeshStandardMaterial({ color: 0x40301a, emissive: 0xffb050, emissiveIntensity: 0.0, roughness: 0.8 });
  const mantle = mesh(new THREE.SphereGeometry(0.028, 10, 8), mantleMat, 0, -0.01, 0);
  lan.add(mantle);
  o.add(lan);
  o.userData.setLit = (on) => { mantleMat.emissiveIntensity = on ? 5 : 0; mantleMat.color.setHex(on ? 0xffe0a0 : 0x40301a); };
  return {
    object: o,
    colliders: [
      { type: 'box', size: [0.07, H, 0.07], pos: [0, 0, 0] },
      { type: 'box', size: [0.18, 0.3, 0.16], pos: [0.24, H / 2 - 0.2, 0] },
    ],
    mass: 3, material: 'wood', halfHeight: H / 2,
    parts: { mantle, lantern: lan }, anchors: {},
  };
}

export const ITEMS = {
  camp_kit: campKit,
  camp_pole: campPole,
  camp_canvas: campCanvas,
  camp_stakes: campStakes,
  camp_lamp: campLamp,
};
