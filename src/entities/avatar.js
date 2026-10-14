// R.O.O.M. — player avatar (interim: legacy implementation; helpers live in ./doll/).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { labelTexture } from '../gfx/textures.js';
import { RNG, hashString, valueNoise2 } from '../core/rng.js';
import { clamp, lerp, smooth, damp, approach, G, surfaceGrid, ribbon, paint, normGeo, mergeChunks, Rig, Spring, Wobble, cached, canvasTex, mkCanvas } from './doll/kit.js';
import { HEAD, headF, headRphi, headPt, headNormal, frontPhi, featurePt, headGrid, D, SKIN, THREAD, NOSE, BLUSH, EYE, bodyR, bodyPoint, bodyNormal, bodyGrid, surfQ, clothMat, AM, M, glowKey, feltTex, hazardTex, watchTex, MOUTHS, mouthAtlas, setMouthCell, buildFace } from './doll/legacy.js';
export { clamp, lerp, smooth, damp, G, surfaceGrid, ribbon, paint, mergeChunks, Rig, Spring, Wobble, cached } from './doll/kit.js';
export { HEAD, headF, headRphi, headPt, headNormal, frontPhi, featurePt, headGrid, D, SKIN, THREAD, NOSE, BLUSH, EYE, bodyR, bodyPoint, bodyNormal, surfQ, clothMat, AM, feltTex, MOUTHS, mouthAtlas, setMouthCell, buildFace } from './doll/legacy.js';

const PI = Math.PI, TAU = PI * 2;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// ============================================================================
// Cosmetics catalogue
// ============================================================================
export const COSMETICS = {
  suit: [
    { id: 'yellow', name: 'Standard Issue', outfit: 'coverall', color: 0xf2c418, unlock: null },
    { id: 'orange', name: 'Safety Orange', outfit: 'coverall', color: 0xf27b1c, unlock: null },
    { id: 'white', name: 'Cleanroom White', outfit: 'coverall', color: 0xe6e6e0, unlock: null },
    { id: 'blue', name: 'Coolant Blue', outfit: 'coverall', color: 0x3b84d9, unlock: null },
    { id: 'pink', name: 'Bubblegum', outfit: 'coverall', color: 0xf39cc2, unlock: null },
    { id: 'mint', name: 'Mint Condition', outfit: 'coverall', color: 0x86e0bd, unlock: null },
    { id: 'lavender', name: 'Lavender Haze', outfit: 'coverall', color: 0xb39be8, unlock: null },
    { id: 'hawaiian', name: 'Vacation Mode', outfit: 'hawaiian', color: 0xe8709f, unlock: null },
    { id: 'fleece', name: 'Weekend Hiker', outfit: 'fleece', color: 0xc8962c, unlock: null },
    { id: 'orange_hivis', name: 'Hi-Vis Crew', outfit: 'hivis', color: 0xf26a12, unlock: null },
    { id: 'navy_jacket', name: 'Night Shift', outfit: 'navy', color: 0x26324f, unlock: null },
    { id: 'red', name: 'Code Red', outfit: 'coverall', color: 0xd63a2f, unlock: 'medic' },
    { id: 'black', name: 'Disposable', outfit: 'coverall', color: 0x2a2a30, unlock: 'disposable' },
    { id: 'camo', name: 'Survivor Camo', outfit: 'coverall', color: 0x6e7444, pattern: 'camo', unlock: 'survivor7' },
    { id: 'gold', name: 'Golden Employee', outfit: 'coverall', color: 0xe3b23c, gloss: true, unlock: 'quota' },
  ],
  skin: [
    { id: 'tan', name: 'Burlap', color: 0xc9a977, unlock: null },
    { id: 'light', name: 'Canvas', color: 0xe8d6b2, unlock: null },
    { id: 'dark', name: 'Coffee Sack', color: 0x8e6a47, unlock: null },
    { id: 'grey', name: 'Linen Grey', color: 0xa9a59c, unlock: null },
    { id: 'rose', name: 'Dusty Rose', color: 0xd9a798, unlock: 'night_owl' },
  ],
  hat: [
    { id: 'none', name: 'No Hat', unlock: null },
    { id: 'bucket', name: 'Sunny Bucket Hat', color: 0xd8c9a2, unlock: null },
    { id: 'beanie', name: 'Pom-Pom Beanie', color: 0x2f4d34, color2: 0x7da66b, unlock: null },
    { id: 'hardhat', name: 'Hazard Hard Hat', color: 0xf2c418, color2: 0x1d1d1f, unlock: null },
    { id: 'party', name: 'Party Hat', color: 0x46b6e8, color2: 0xf6d24a, unlock: null },
    { id: 'cone', name: 'Traffic Cone', color: 0xf26a1b, unlock: null },
    { id: 'propeller', name: 'Propeller Cap', unlock: null },
    { id: 'chef', name: 'Chef Toque', color: 0xf8f6f0, unlock: null },
    { id: 'sprout', name: 'Little Sprout', unlock: null },
    { id: 'headlamp', name: 'Headlamp', unlock: null },
    { id: 'tophat', name: 'Top Hat', color: 0x1d1c22, unlock: 'collector' },
    { id: 'bunny', name: 'Bunny Ears', color: 0xf3ece2, unlock: 'bullseye' },
    { id: 'halo', name: 'Halo', unlock: 'revived' },
    { id: 'crown', name: 'Crown', unlock: 'escape' },
  ],
  // face gear (kept under the 'visor' key for API compatibility)
  visor: [
    { id: 'none', name: 'Nothing', unlock: null },
    { id: 'goggles', name: 'Climbing Goggles', unlock: null },
    { id: 'face_shield', name: 'Face Shield', unlock: null },
    { id: 'gas_mask_up', name: 'Respirator', unlock: null },
    { id: 'glasses', name: 'Round Glasses', unlock: null },
    { id: 'sunglasses', name: 'Shades', unlock: 'lost' },
  ],
  face: [
    { id: 'dots', name: 'Classic', unlock: null },
    { id: 'happy', name: 'Sunny', unlock: null, mouth: 'grin', eyeSY: 0.62, brow: 0.008, browRot: -0.12 },
    { id: 'sleepy', name: 'Drowsy', unlock: null, mouth: 'o', eyeSY: 0.35, brow: -0.006 },
    { id: 'grumpy', name: 'Overtime', unlock: null, mouth: 'grumpy', eyeSY: 0.7, browRot: 0.45, brow: -0.008 },
    { id: 'shy', name: 'Bashful', unlock: null, mouth: 'shy', blush: 1.7, browRot: -0.35 },
    { id: 'cat', name: 'Kitty', unlock: null, mouth: 'cat', whiskers: true },
    { id: 'freckles', name: 'Freckles', unlock: null, mouth: 'gap', freckles: true },
    { id: 'button', name: 'Button Eyes', unlock: 'collector', eyes: 'button' },
    { id: 'cyclops', name: 'Cyclops', unlock: 'stilllife', eyes: 'cyclops' },
    { id: 'stitched', name: 'Patched Up', unlock: 'revived', eyes: 'mismatch', scar: true, mouth: 'flat' },
  ],
  backpack: [
    { id: 'tank', name: 'Air Tank', unlock: null },
    { id: 'satchel', name: 'Satchel', unlock: null },
    { id: 'jet', name: 'Jet Pack', unlock: null },
    { id: 'bear', name: 'Teddy Pack', unlock: 'night_owl' },
    { id: 'turtle', name: 'Turtle Shell', unlock: 'survivor7' },
    { id: 'none', name: 'Nothing', unlock: null },
  ],
  accessory: [
    { id: 'none', name: 'None', unlock: null },
    { id: 'scarf', name: 'Checkered Scarf', color: 0x2f5fa8, color2: 0x15171c, unlock: null },
    { id: 'fannypack', name: 'Fanny Pack', color: 0x2c2f35, color2: 0x15161a, unlock: null },
    { id: 'tie', name: 'Office Tie', color: 0x2f4f8f, color2: 0xc94a3a, unlock: null },
    { id: 'bowtie', name: 'Bow Tie', color: 0xd23c4a, unlock: null },
    { id: 'lei', name: 'Flower Lei', unlock: null },
    { id: 'bandana', name: 'Bandana', color: 0xc8302a, unlock: null },
    { id: 'headphones', name: 'Neck Phones', unlock: null },
    { id: 'bell', name: 'Kitty Bell', unlock: 'bullseye' },
    { id: 'badge', name: 'Employee of the Month', unlock: 'quota' },
  ],
};
export const DEFAULT_COSMETICS = { suit: 'yellow', skin: 'tan', hat: 'none', visor: 'none', face: 'dots', backpack: 'tank', accessory: 'none' };

export function cosmeticEntry(slot, id) {
  const list = COSMETICS[slot];
  return list.find((e) => e.id === id) || list.find((e) => e.id === DEFAULT_COSMETICS[slot]) || list[0];
}
export function randomCosmetics(seed = 1, allowLocked = true) {
  const r = new RNG(typeof seed === 'string' ? hashString(seed) : seed);
  const out = {};
  for (const slot in COSMETICS) out[slot] = r.pick(COSMETICS[slot].filter((e) => allowLocked || !e.unlock)).id;
  return out;
}
export function resolveCos(c) {
  const out = { ...DEFAULT_COSMETICS, ...(c || {}) };
  out.suitEntry = cosmeticEntry('suit', out.suit);
  out.skinEntry = cosmeticEntry('skin', out.skin);
  out.hatEntry = cosmeticEntry('hat', out.hat);
  out.visorEntry = cosmeticEntry('visor', out.visor);
  out.faceEntry = cosmeticEntry('face', out.face);
  out.packEntry = cosmeticEntry('backpack', out.backpack);
  out.accEntry = cosmeticEntry('accessory', out.accessory);
  return out;
}


// ============================================================================
// Skeleton
// ============================================================================
function makeAvatarRig() {
  const R = new Rig();
  R.bone('pelvis', null, [0, D.pelvisY, 0], null, 'ZXY');
  R.bone('body', 'pelvis', [0, 0, 0]);
  R.bone('chest', 'pelvis', [0, D.chestY, 0], null, 'ZXY');
  R.bone('head', 'chest', [0, D.headY, 0], null, 'YXZ');
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    R.bone('sh' + S, 'chest', [s * D.shX, D.shY, 0], null, 'ZXY');
    R.bone('el' + S, 'sh' + S, [0, -D.upper, 0], null, 'XYZ');
    R.bone('wr' + S, 'el' + S, [0, -D.fore, 0], null, 'XYZ');
    R.bone('fi' + S, 'wr' + S, [-s * 0.012, -0.058, -0.028], null, 'XYZ');
    R.bone('hip' + S, 'pelvis', [s * D.hipX, 0, 0], null, 'ZXY');
    R.bone('kn' + S, 'hip' + S, [0, -D.thigh, 0], null, 'XYZ');
    R.bone('an' + S, 'kn' + S, [0, -D.shin, 0], null, 'ZXY');
  }
  R.bone('pack', 'chest', [0, -0.05, 0.215]);
  R.bone('packA', 'pack'); R.bone('packB', 'pack');
  R.bone('hat', 'head', [0, HEAD.cy, 0]);
  R.bone('hatA', 'hat'); R.bone('hatB', 'hat');
  R.bone('accA', 'chest'); R.bone('accB', 'chest');
  R.bone('acc', 'body');
  R.bone('nose', 'head');
  for (const S of ['L', 'R']) {
    R.bone('eye' + S, 'head');
    R.bone('brow' + S, 'head');
    R.bone('blush' + S, 'head');
    R.bone('x' + S, 'head');
  }
  return R;
}
const AUX_REST = { pack: [0, -0.05, 0.215], hat: [0, HEAD.cy, 0], fiL: [0.012, -0.058, -0.028], fiR: [-0.012, -0.058, -0.028] };
const AUX = ['pack', 'packA', 'packB', 'hat', 'hatA', 'hatB', 'accA', 'accB', 'acc', 'nose', 'eyeL', 'eyeR', 'browL', 'browR', 'blushL', 'blushR', 'xL', 'xR', 'fiL', 'fiR'];

// ============================================================================
// Outfits
// ============================================================================
function outfitSpec(e) {
  const shirt = { top: M('hawaii', 0xffffff), bottom: M('twill', 0xbfa676), sleeve: M('hawaii', 0xffffff), short: true, legs: 'shorts', belt: 0x17171a, buttons: true, shirtCollar: true, boots: 0x6d4b33, sole: 0xc9b89a, low: true, badge: [PI + 0.42, 0.37, 0.004] };
  switch (e.outfit) {
    case 'hawaiian': return shirt;
    case 'fleece': return { ...shirt, jacket: M('fleece', 0xffffff), sleeve: M('fleece', 0xffffff), short: false, badge: [PI + 0.95, 0.33, 0.03] };
    case 'hivis': { const t = M('nylon', 0xf26a12); return { top: t, bottom: M('twill', 0x46494f), sleeve: t, legs: 'pants', stripes: 'hivis', collar: true, zipper: true, boots: 0x2a2725, sole: 0x55504a, badge: [PI + 0.42, 0.37, 0.004] }; }
    case 'navy': { const t = M('puffer', 0x2a3758); return { top: t, bottom: M('denim', 0xffffff), sleeve: t, legs: 'pants', collar: true, zipper: true, puffy: true, boots: 0x5d3f2a, sole: 0x2a2420, badge: [PI + 0.42, 0.37, 0.012] }; }
    default: {
      const fab = e.pattern === 'camo' ? 'camo' : e.gloss ? 'satin' : 'nylon';
      const t = M(fab, e.pattern === 'camo' ? 0xffffff : e.color);
      return { top: t, bottom: t, sleeve: t, legs: 'pants', stripes: 'coverall', collar: true, zipper: true, cuffs: true, boots: 0x2e2a27, sole: 0x5a544c, badge: [PI + 0.42, 0.37, 0.004] };
    }
  }
}

function band(y0, y1, off, puff, nu = 32) { return bodyGrid(y0, y1, off, nu, 3, puff); }

function buildOutfit(B) {
  const { add } = B;
  const o = B.outfit;
  const W = 0xffffff, SEAM = 0xa8a8a8;
  const waist = 0.05;
  // --- torso
  if (o.top === o.bottom) add('body', o.top, bodyGrid(-0.2, 0.6, 0, 32, 24), W);
  else {
    add('body', o.bottom, bodyGrid(-0.2, waist + 0.012, 0, 32, 8), W);
    add('body', o.top, bodyGrid(waist, 0.6, 0, 32, 18), W);
  }
  // side seams
  for (const s of [-1, 1]) {
    const pts = []; for (let y = -0.06; y <= 0.44; y += 0.04) pts.push(bodyPoint(PI / 2 * (2 - s), y, 0.002));
    add('body', o.top, G.tube(pts, 0.0045, 16, 4), SEAM);
  }
  if (o.zipper) {
    const pts = []; for (let y = 0.5; y >= -0.02; y -= 0.03) pts.push(bodyPoint(PI, y, 0.003));
    add('body', 'trim', G.tube(pts, 0.0065, 24, 5), 0x2c2c30);
    const pts2 = []; for (let y = 0.5; y >= -0.02; y -= 0.03) pts2.push(bodyPoint(PI - 0.075, y, 0.002));
    add('body', o.top, G.tube(pts2, 0.0065, 24, 5), 0xd0d0d0);
    const top = bodyPoint(PI, 0.44, 0.012);
    add('body', 'metal', G.xf(G.rbox(0.016, 0.034, 0.006, 0.003), [top.x, top.y - 0.014, top.z], [0.5, 0, 0]), 0xd8d8d8);
  }
  if (o.top !== o.bottom) {
    // shirt hem over the waistband + belt
    add('body', o.top, band(waist + 0.0, waist + 0.032, 0.004, 0.006), 0xe8e8e8);
    if (o.belt) {
      add('body', 'trim', band(waist - 0.03, waist + 0.002, 0.004, 0.006, 40), o.belt);
      const bp = bodyPoint(PI, waist - 0.014, 0.012);
      add('body', 'metal', G.xf(G.rbox(0.05, 0.036, 0.01, 0.005), [bp.x, bp.y, bp.z], [0.1, 0, 0]), 0xc8c0a8);
      add('body', 'trim', G.xf(G.box(0.03, 0.018, 0.012), [bp.x, bp.y, bp.z - 0.002], [0.1, 0, 0]), o.belt);
    }
  } else {
    add('body', o.top, band(0.035, 0.05, 0.002, 0.003), SEAM);
  }
  if (o.buttons) {
    const pts = []; for (let y = 0.47; y >= waist + 0.02; y -= 0.04) pts.push(bodyPoint(PI + 0.02, y, 0.002));
    add('body', o.top, G.tube(pts, 0.004, 16, 4), 0xcfcfcf);
    for (let y = 0.4; y > waist + 0.03; y -= 0.075) {
      const p = bodyPoint(PI + 0.04, y, 0.004), n = bodyNormal(PI + 0.04, y);
      const g = G.xf(G.cyl(0.0085, 0.0085, 0.004, 10), null, [PI / 2, 0, 0]); g.applyQuaternion(surfQ(n)); g.translate(p.x, p.y, p.z);
      add('body', 'gloss', g, 0xf3eee2);
    }
  }
  if (o.shirtCollar) {
    for (const s of [-1, 1]) {
      const p = bodyPoint(PI + s * 0.32, 0.455, 0.012);
      add('body', o.top, G.xf(G.rbox(0.075, 0.05, 0.008, 0.008), [p.x, p.y, p.z], [-0.75, s * 0.5, s * 0.55]), 0xf0f0f0);
    }
  }
  // stripes
  if (o.stripes === 'coverall') add('body', 'reflect', band(0.255, 0.29, 0.003, 0.004, 36), W);
  if (o.stripes === 'hivis') {
    add('body', 'reflect', band(0.12, 0.155, 0.003, 0.004, 36), W);
    add('body', 'reflect', band(0.27, 0.305, 0.003, 0.004, 36), W);
    for (const s of [-1, 1]) {
      const xs = 0.105 * s, pts = [], nrm = [];
      const yTop = (() => { let y = 0.3; while (y < 0.51 && bodyR(y) > Math.abs(xs) + 0.004) y += 0.002; return y; })();
      for (let i = 0; i <= 12; i++) { const y = lerp(0.29, yTop - 0.004, Math.sin((i / 12) * PI / 2)); const phi = PI - Math.asin(clamp(xs / bodyR(y), -1, 1)); pts.push(bodyPoint(phi, y, 0.003)); nrm.push(bodyNormal(phi, y)); }
      for (let i = 12; i >= 0; i--) { const y = lerp(0.29, yTop - 0.004, Math.sin((i / 12) * PI / 2)); const phi = Math.asin(clamp(xs / bodyR(y), -1, 1)); pts.push(bodyPoint(phi, y, 0.003)); nrm.push(bodyNormal(phi, y)); }
      add('body', 'reflect', ribbon(pts, nrm, 0.034, 0.004), W);
    }
  }
  // jacket layer (open front)
  if (o.jacket) {
    const y0 = -0.035, y1 = 0.47;
    const open = (y) => lerp(0.62, 0.36, clamp((y - y0) / (y1 - y0), 0, 1));
    const g = surfaceGrid(28, 16, (u, v, p) => {
      const y = lerp(y0, y1, v), op = open(y);
      bodyPoint(lerp(PI + op, 3 * PI - op, u), y, 0.018 + 0.008 * Math.sin(PI * v), p);
    });
    add('body', o.jacket, G.uv(g, 1.5, 0.55), W);
    for (const s of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 10; i++) { const y = lerp(y0, y1, i / 10); pts.push(bodyPoint(PI - s * open(y), y, 0.024)); }
      add('body', o.jacket, G.uv(G.tube(pts, 0.017, 20, 8), 0.1, 0.6), 0xe0e0e0);
    }
    const hem = []; for (let i = 0; i <= 24; i++) hem.push(bodyPoint(lerp(PI + open(y0), 3 * PI - open(y0), i / 24), y0, 0.022));
    add('body', o.jacket, G.uv(G.tube(hem, 0.015, 40, 6), 1.5, 0.1), 0xe0e0e0);
    // big floppy collar
    add('chest', o.jacket, G.uv(G.xf(G.torus(0.165, 0.035, 10, 30, TAU - 0.9), [0, 0.09, 0], [PI / 2, 0, PI / 2 + 0.45 + PI]), 1.1, 0.25), 0xe8e8e8);
    // zip pull dangling on one side
    const zp = bodyPoint(PI - open(0.2), 0.2, 0.03);
    add('body', 'metal', G.xf(G.rbox(0.012, 0.03, 0.005, 0.002), [zp.x, zp.y, zp.z]), 0xcfcfcf);
  }
  if (o.collar) {
    const prof = [[0.118, 0.06], [0.16, 0.065], [0.172, 0.09], [0.168, 0.125], [0.152, 0.135], [0.132, 0.11]];
    add('chest', o.top, G.uv(G.lathe(prof, 30), 1.0, 0.2), 0xe6e6e6);
  }
  // badge / name tag
  {
    const [phi, y, off] = o.badge;
    const p = bodyPoint(phi, y, 0.005 + off), n = bodyNormal(phi, y);
    const q = surfQ(n);
    const plate = G.rbox(0.084, 0.06, 0.007, 0.006); plate.applyQuaternion(q); plate.translate(p.x, p.y, p.z);
    add('body', 'gloss', plate, 0xdedbd2);
    const clip = G.box(0.026, 0.02, 0.005); clip.applyQuaternion(q); clip.translate(p.x + n.x * 0.004, p.y + 0.032, p.z + n.z * 0.004);
    add('body', 'metal', clip, 0xbfbfbf);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.052), B.badgeMat);
    mesh.position.copy(p).addScaledVector(n, 0.0042);
    mesh.quaternion.copy(q);
    mesh.castShadow = false; mesh.name = 'badge';
    B.attach('body', mesh);
  }
  // --- arms
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    if (o.short) {
      add('sh' + S, o.sleeve, G.uv(G.capY(0.066, 0, -0.085, 4, 14), 0.42, 0.2), W);
      add('sh' + S, o.sleeve, G.xf(G.torus(0.062, 0.008, 6, 18), [0, -0.095, 0], [PI / 2, 0, 0]), 0xe8e8e8);
      add('sh' + S, 'skin', G.uv(G.capY(0.047, -0.07, -D.upper, 4, 12), 0.3, 0.12), W);
      add('el' + S, 'skin', G.uv(G.capY(0.046, 0, -D.fore + 0.01, 4, 12), 0.3, 0.14), W);
    } else {
      const r = o.jacket ? 0.064 : o.puffy ? 0.065 : 0.06;
      add('sh' + S, o.sleeve, G.uv(G.capY(r, 0, -D.upper, 4, 14), 0.4, 0.25), W);
      add('el' + S, o.sleeve, G.uv(G.capY(r * 0.93, 0, -D.fore + 0.01, 4, 14), 0.38, 0.2), W);
      add('el' + S, o.sleeve, G.lathe([[r * 0.85, 0.0], [r * 1.0, -0.004], [r * 1.02, -0.026], [r * 0.85, -0.03]], 18).translate(0, -D.fore + 0.02, 0), 0xc8c8c8);
      if (o.stripes) {
        const band2 = (rr, y) => G.xf(G.lathe([[rr - 0.002, -0.012], [rr + 0.0035, -0.009], [rr + 0.0035, 0.009], [rr - 0.002, 0.012]], 18), [0, y, 0]);
        add('sh' + S, 'reflect', band2(r, -0.07), W);
        add('el' + S, 'reflect', band2(r * 0.93, -0.05), W);
      }
    }
    // mitten (sack)
    const mit = G.ell(0.05, 0.062, 0.044, 16, 11); mit.translate(0, -0.052, 0.002);
    add('wr' + S, 'skin', G.uv(mit, 0.3, 0.12), W);
    add('wr' + S, 'skin', G.uv(G.between([s * -0.03, -0.03, -0.02], [s * -0.042, -0.06, -0.042], 0.019, 4, 10), 0.1, 0.06), W);
    add('wr' + S, 'felt', G.xf(G.torus(0.045, 0.003, 4, 20), [0, -0.004, 0.002], [PI / 2, 0, 0]), THREAD);
    add('fi' + S, 'skin', G.uv(G.capY(0.016, 0, -0.045, 4, 10), 0.1, 0.06), W);
    // --- legs
    if (o.legs === 'shorts') {
      add('hip' + S, o.bottom, G.uv(G.capY(0.076, 0.0, -D.thigh + 0.012, 4, 14), 0.48, 0.2), W);
      add('hip' + S, o.bottom, G.xf(G.torus(0.072, 0.009, 6, 18), [0, -D.thigh + 0.016, 0], [PI / 2, 0, 0]), 0xd8d8d8);
      const sock = G.capY(0.054, 0.02, -D.shin + 0.01, 4, 14);
      paint(sock, (x, y) => { const k = Math.floor((y + 0.2) / 0.016) % 3; return k === 0 ? 0xc8322e : k === 1 ? 0xf1ece0 : 0x2f8a8a; });
      add('kn' + S, 'knit', G.uv(sock, 0.34, 0.14), W);
    } else {
      const r = o.puffy ? 0.072 : 0.07;
      add('hip' + S, o.bottom, G.uv(G.capY(r, 0, -D.thigh, 4, 14), 0.44, 0.2), W);
      add('kn' + S, o.bottom, G.uv(G.capY(r * 0.96, 0, -D.shin + 0.02, 4, 14), 0.42, 0.2), W);
      if (o.stripes) add('kn' + S, 'reflect', G.xf(G.lathe([[r * 0.96 - 0.002, -0.012], [r * 0.96 + 0.0035, -0.009], [r * 0.96 + 0.0035, 0.009], [r * 0.96 - 0.002, 0.012]], 18), [0, -0.035, 0]), W);
    }
    // felt boots
    const A = D.ankleH, top = o.low ? 0.03 : 0.065;
    add('an' + S, 'felt', G.lathe([[0.064, top], [0.072, top - 0.008], [0.076, 0.0], [0.078, -0.05], [0.066, -0.06]], 18), o.boots);
    add('an' + S, 'felt', G.xf(G.torus(0.067, 0.011, 6, 20), [0, top - 0.004, 0], [PI / 2, 0, 0]), o.boots);
    const toe = G.ell(0.076, 0.058, 0.104, 18, 12); toe.translate(0, -A + 0.056, -0.036);
    add('an' + S, 'felt', toe, o.boots);
    const sole = G.lathe([[0, 0], [0.86, 0], [0.98, 0.15], [1.0, 0.5], [0.97, 0.85], [0.9, 1], [0, 1]], 20);
    sole.scale(0.084, 0.026, 0.124); sole.translate(0, -A, -0.032);
    add('an' + S, 'rubber', sole, o.sole);
    // stitched toe seam
    const sp = []; for (let i = 0; i <= 8; i++) { const a = lerp(-1.1, 1.1, i / 8); sp.push(new THREE.Vector3(Math.sin(a) * 0.072, -A + 0.075, -0.036 - Math.cos(a) * 0.088)); }
    add('an' + S, 'felt', G.tube(sp, 0.0028, 12, 3), 0x1d1712);
  }
  // wristwatch on the left wrist (outer side, -X)
  {
    const r = o.short ? 0.047 : (o.jacket ? 0.06 : 0.057);
    add('elL', 'trim', G.xf(G.torus(r + 0.003, 0.009, 6, 22), [0, -0.08, 0], [PI / 2, 0, 0]), 0x232326);
    const cx = -(r + 0.014);
    add('elL', 'trim', G.xf(G.rbox(0.022, 0.046, 0.052, 0.007), [cx, -0.08, 0]), 0x26262a);
    add('elL', 'metal', G.xf(G.box(0.006, 0.048, 0.055), [cx - 0.0085, -0.08, 0]), 0xb8bcc2);
    add('elL', 'metal', G.xf(G.cyl(0.0045, 0.0045, 0.008, 8), [cx, -0.08, -0.03], [PI / 2, 0, 0]), 0xd0d0d0);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.026), cached('watchMat3p', () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveMap: watchTex(), map: watchTex(), emissiveIntensity: 1.2, roughness: 0.25 })));
    scr.position.set(cx - 0.0116, -0.08, 0); scr.rotation.set(0, -PI / 2, 0); scr.name = 'watchScreen';
    B.attach('elL', scr);
    B.watchAnchor = new THREE.Object3D();
    B.watchAnchor.position.set(cx - 0.012, -0.08, 0); B.watchAnchor.rotation.set(0, -PI / 2, 0);
  }
}

// ============================================================================
// Head + face
// ============================================================================
function sackSeam(add, bone, H, off = 0.002) {
  // up the right side, over the top, down the left side (plane z = 0)
  const path = [];
  const ys = []; for (let i = 0; i <= 10; i++) ys.push(lerp(H.y0 + 0.08, H.y1 - 0.004, Math.sin((i / 10) * PI / 2)));
  for (const y of ys) path.push(headPt(PI / 2, y, off, new THREE.Vector3(), H));
  for (let i = ys.length - 2; i >= 0; i--) path.push(headPt(-PI / 2, ys[i], off, new THREE.Vector3(), H));
  add(bone, 'skin', G.uv(G.tube(path, 0.006, 40, 5), 0.05, 1.2), 0x9a9a9a);
  // slanted running stitches across the seam (front-to-back)
  const curve = new THREE.CatmullRomCurve3(path);
  const L = curve.getLength(), n = Math.floor(L / 0.03);
  for (let i = 1; i < n; i++) {
    const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const nn = new THREE.Vector3(p.x, Math.max(0, p.y - H.cy) * 0.6, 0).normalize();
    const a = p.clone().addScaledVector(nn, 0.0045).add(new THREE.Vector3(0, 0, 0.011)).addScaledVector(tg, 0.004);
    const b = p.clone().addScaledVector(nn, 0.0045).add(new THREE.Vector3(0, 0, -0.011)).addScaledVector(tg, -0.004);
    add(bone, 'felt', G.between(a, b, 0.0024, 2, 4), THREAD);
  }
}

function buildHead(B) {
  const { add } = B;
  const g = headGrid(HEAD, 36, 26, 1, null, 3);
  // grime / tone variation (multiplies the burlap tint)
  paint(g, (x, y, z) => { const n = valueNoise2(x * 9 + 3, y * 9 + z * 5, 7); const k = 0.9 + n * 0.16 - Math.max(0, 0.06 - y) * 1.2; return _c1.setRGB(k, k * 0.985, k * 0.96).clone(); });
  add('head', 'skin', G.uv(g, 1.3, 0.75), 0xffffff);
  sackSeam(add, 'head', HEAD);
  B.headAnchor = new THREE.Object3D();
  const ep = featurePt(0, 0.3, 0.03).p;
  B.headAnchor.position.set(0, ep.y, ep.z);
  buildFace(B, B.cos.faceEntry);
}


// ---------------------------------------------------------------------------
// Face gear (COSMETICS.visor)
// ---------------------------------------------------------------------------
function headBand(y0, y1, off, puff = 0.004, H = HEAD) {
  return surfaceGrid(40, 3, (u, v, p) => headPt(u * TAU, lerp(y0, y1, v), off + puff * Math.sin(PI * v), p, H), { closedU: true });
}
const GEAR = {
  none() { },
  goggles(B) {
    const { add } = B;
    add('head', 'trim', headBand(0.39, 0.422, 0.006), 0x2b2622);
    for (const s of [-1, 1]) {
      const F = featurePt(s * 0.07, 0.408, 0.0);
      const q = F.q;
      const cup = G.lathe([[0.04, 0], [0.044, -0.008], [0.042, -0.03], [0.034, -0.034]], 18).rotateX(-PI / 2);
      cup.applyQuaternion(q).translate(F.p.x, F.p.y, F.p.z); add('head', 'rubber', cup, 0x3a3532);
      const lens = G.xf(G.cyl(0.033, 0.033, 0.004, 18), [0, 0, 0.03], [PI / 2, 0, 0]); lens.applyQuaternion(q).translate(F.p.x, F.p.y, F.p.z);
      add('head', 'gloss', lens, 0x5fb3c4);
      const rim = G.xf(G.torus(0.035, 0.005, 6, 20), [0, 0, 0.031]); rim.applyQuaternion(q).translate(F.p.x, F.p.y, F.p.z);
      add('head', 'metal', rim, 0xc0a060);
    }
    add('head', 'rubber', G.between(featurePt(-0.03, 0.408, 0.018).p, featurePt(0.03, 0.408, 0.018).p, 0.007, 3, 6), 0x3a3532);
  },
  face_shield(B) {
    const { add } = B;
    add('head', 'gloss', headBand(0.385, 0.412, 0.008, 0.004), 0x4a4f58);
    const g = surfaceGrid(20, 8, (u, v, p) => {
      const a = lerp(-1.15, 1.15, u), y = lerp(0.06, 0.41, v);
      const r = 0.255 - (y - 0.41) * -0.06;
      p.set(-Math.sin(a) * r, y, -Math.cos(a) * r * 0.95 + 0.0);
    });
    add('head', 'glass', g, 0xffffff);
    const edge = []; for (let i = 0; i <= 20; i++) { const a = lerp(-1.15, 1.15, i / 20); edge.push(new THREE.Vector3(-Math.sin(a) * 0.276, 0.06, -Math.cos(a) * 0.276 * 0.95)); }
    add('head', 'gloss', G.tube(edge, 0.005, 30, 5), 0x3a6fb8);
    for (const s of [-1, 1]) add('head', 'gloss', G.xf(G.cyl(0.018, 0.018, 0.012, 12), [s * 0.21, 0.398, -0.02], [0, 0, PI / 2]), 0x4a4f58);
  },
  gas_mask_up(B) {
    const { add } = B;
    const g = surfaceGrid(16, 8, (u, v, p) => {
      const phi = lerp(PI - 1.05, PI + 1.05, u), y = lerp(0.055, 0.205, v);
      const bump = Math.sin(PI * u) * Math.sin(PI * v);
      headPt(phi, y, 0.006 + 0.03 * Math.pow(bump, 0.7), p);
    }, { flip: false });
    add('head', 'rubber', g, 0x3c3f45);
    for (const s of [-1, 1]) {
      const F = featurePt(s * 0.085, 0.12, 0.03);
      const can = G.xf(G.cyl(0.03, 0.032, 0.036, 16), [0, 0, 0.012], [PI / 2, 0, 0]);
      const q = F.q.clone().multiply(_q1.setFromEuler(_e1.set(-0.3, s * 0.5, 0)));
      can.applyQuaternion(q).translate(F.p.x, F.p.y, F.p.z); add('head', 'gloss', can, 0xd84a8a);
      const cap = G.xf(G.torus(0.028, 0.004, 4, 16), [0, 0, 0.031]); cap.applyQuaternion(q).translate(F.p.x, F.p.y, F.p.z);
      add('head', 'rubber', cap, 0x2a2c30);
      if (s > 0) { B.maskHose = new THREE.Vector3(0, 0, 0.035).applyQuaternion(q).add(F.p); B.maskHoseDir = new THREE.Vector3(0.3, -0.6, 1).applyQuaternion(q).normalize(); }
    }
    const vF = featurePt(0, 0.085, 0.03);
    const valve = G.xf(G.cyl(0.02, 0.022, 0.02, 12), [0, 0, 0.008], [PI / 2, 0, 0]); valve.applyQuaternion(vF.q).translate(vF.p.x, vF.p.y, vF.p.z);
    add('head', 'rubber', valve, 0x2a2c30);
    add('head', 'trim', headBand(0.13, 0.15, 0.004, 0.003), 0x2a2622);
  },
  glasses(B) {
    const { add } = B;
    for (const s of [-1, 1]) {
      const F = featurePt(s * 0.098, 0.3, 0.016);
      const rim = G.torus(0.033, 0.0038, 6, 22); rim.applyQuaternion(F.q).translate(F.p.x, F.p.y, F.p.z);
      add('head', 'gloss', rim, 0x5a3a24);
      const lens = G.xf(G.cyl(0.031, 0.031, 0.002, 18), null, [PI / 2, 0, 0]); lens.applyQuaternion(F.q).translate(F.p.x, F.p.y, F.p.z);
      add('head', 'glass', lens, 0xffffff);
      const side = featurePt(s * 0.14, 0.305, 0.008).p;
      add('head', 'gloss', G.tube([side, headPt(PI / 2 * (2 - s) + s * 0.3, 0.31, 0.006), headPt(PI / 2 * (2 - s) - s * 0.15, 0.285, 0.004)], 0.0032, 10, 4), 0x5a3a24);
    }
    add('head', 'gloss', G.tube([featurePt(-0.066, 0.307, 0.02).p, featurePt(0, 0.315, 0.03).p, featurePt(0.066, 0.307, 0.02).p], 0.0034, 8, 4), 0x5a3a24);
  },
  sunglasses(B) {
    const { add } = B;
    for (const s of [-1, 1]) {
      const F = featurePt(s * 0.096, 0.296, 0.02);
      const lens = G.xf(G.ell(0.042, 0.032, 0.006, 18, 8), null, null); lens.applyQuaternion(F.q).translate(F.p.x, F.p.y, F.p.z);
      add('head', 'gloss', lens, 0x0d0e12);
      const side = featurePt(s * 0.14, 0.31, 0.01).p;
      add('head', 'gloss', G.tube([side, headPt(PI / 2 * (2 - s) + s * 0.3, 0.315, 0.006), headPt(PI / 2 * (2 - s) - s * 0.15, 0.295, 0.004)], 0.0036, 10, 4), 0x16161a);
    }
    add('head', 'gloss', G.tube([featurePt(-0.06, 0.315, 0.026).p, featurePt(0, 0.32, 0.034).p, featurePt(0.06, 0.315, 0.026).p], 0.004, 8, 4), 0x16161a);
  },
};

// --- straps from the pack over the shoulders to a chest strap
function addStraps(B, col = 0x34343a) {
  const add = B.add;
  for (const s of [-1, 1]) {
    const xs = 0.14 * s;
    const yTop = (() => { let y = 0.3; while (y < 0.51 && bodyR(y) > Math.abs(xs) + 0.004) y += 0.002; return y; })();
    const pts = [], nrm = [];
    const off = B.outfit.jacket ? 0.03 : B.outfit.puffy ? 0.012 : 0.005;
    const push = (phi, y) => { pts.push(bodyPoint(phi, y, off)); nrm.push(bodyNormal(phi, y)); };
    for (let i = 0; i <= 14; i++) { const y = lerp(0.2, yTop - 0.004, Math.sin((i / 14) * PI / 2)); push(PI - Math.asin(clamp(xs / bodyR(y), -1, 1)), y); }
    for (let i = 14; i >= 0; i--) { const y = lerp(0.28, yTop - 0.004, Math.sin((i / 14) * PI / 2)); push(Math.asin(clamp(xs / bodyR(y), -1, 1)), y); }
    add('body', 'trim', ribbon(pts, nrm, 0.04, 0.007), col);
    const phi = PI - Math.asin(xs / bodyR(0.24));
    const bp = bodyPoint(phi, 0.24, off + 0.008), q = surfQ(bodyNormal(phi, 0.24));
    const bk = G.rbox(0.048, 0.02, 0.008, 0.004); bk.applyQuaternion(q); bk.translate(bp.x, bp.y, bp.z);
    add('body', 'metal', bk, 0xb0b0b0);
    if (s > 0) B.strapR = { phi: PI - Math.asin(xs / bodyR(0.37)), y: 0.37, off };
  }
  const pts = [], nrm = [];
  const off = B.outfit.jacket ? 0.034 : B.outfit.puffy ? 0.016 : 0.009;
  for (let i = 0; i <= 12; i++) { const phi = PI - 0.6 + (i / 12) * 1.2; pts.push(bodyPoint(phi, 0.29, off)); nrm.push(bodyNormal(phi, 0.29)); }
  add('body', 'trim', ribbon(pts, nrm, 0.022, 0.006), col);
  const bp = bodyPoint(PI, 0.29, off + 0.008);
  add('body', 'gloss', G.xf(G.rbox(0.05, 0.03, 0.012, 0.006), [bp.x, bp.y, bp.z]), 0x1f1f22);
}

// ---------------------------------------------------------------------------
// Backpacks (pack bone sits on the upper back)
// ---------------------------------------------------------------------------
const PACKS = {
  none() { },
  tank(B) {
    const { add } = B;
    addStraps(B);
    add('pack', 'trim', G.xf(G.rbox(0.23, 0.29, 0.035, 0.014), [0, -0.02, 0.018]), 0x3b3b40);
    const tz = 0.125;
    const prof = [[0, -0.2], [0.05, -0.196], [0.085, -0.178], [0.098, -0.15], [0.1, -0.1], [0.1, 0.1], [0.098, 0.13], [0.085, 0.158], [0.05, 0.176], [0, 0.18]];
    add('pack', 'gloss', G.xf(G.lathe(prof, 24), [0, -0.02, tz]), 0xe9e7e0);
    for (const y of [-0.12, 0.08]) add('pack', 'metal', G.xf(G.torus(0.102, 0.008, 6, 24), [0, y - 0.02, tz], [PI / 2, 0, 0]), 0x9ea2a8);
    const bandM = new THREE.Mesh(new THREE.CylinderGeometry(0.1015, 0.1015, 0.075, 24, 1, true), cached('tankDecal', () => new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.45 })));
    bandM.position.set(0, -0.035, tz); bandM.rotation.y = PI; bandM.castShadow = false; bandM.name = 'tankDecal';
    B.attach('pack', bandM);
    add('pack', 'metal', G.xf(G.cyl(0.024, 0.03, 0.04, 12), [0, 0.175, tz]), 0xc7c9cc);
    add('pack', 'gloss', G.xf(G.torus(0.028, 0.008, 6, 16), [0, 0.2, tz], [PI / 2, 0, 0]), 0xd23a2c);
    add('pack', 'gloss', G.xf(G.cyl(0.008, 0.008, 0.02, 8), [0, 0.2, tz]), 0xd23a2c);
    add('pack', 'metal', G.xf(G.cyl(0.012, 0.012, 0.045, 10), [0.03, 0.188, tz], [0, 0, -PI / 2]), 0xc7c9cc);
    add('pack', 'metal', G.xf(G.cyl(0.026, 0.026, 0.014, 16), [-0.045, 0.17, tz + 0.03], [PI / 2 - 0.4, 0, 0]), 0xb0b0b0);
    add('pack', 'gloss', G.xf(G.cyl(0.021, 0.021, 0.004, 16), [-0.045, 0.177, tz + 0.034], [PI / 2 - 0.4, 0, 0]), 0xf8f6ee);
    add('pack', 'gloss', G.xf(G.box(0.003, 0.016, 0.003), [-0.04, 0.181, tz + 0.039], [PI / 2 - 0.4, 0, -0.6]), 0xd02020);
    B.hoseStart = { bone: 'pack', pos: new THREE.Vector3(0.055, 0.188, tz), dir: new THREE.Vector3(1, 0.6, 0.2).normalize() };
    B.springs.pack = { k: 60, d: 5, gain: 0.014, mode: 'stand', limit: 0.3 };
  },
  satchel(B) {
    const { add, R } = B;
    addStraps(B, 0x5a3a22);
    add('pack', 'matte', G.xf(G.rbox(0.29, 0.26, 0.13, 0.04, 2), [0, -0.05, 0.075]), 0x9a6238);
    add('pack', 'matte', G.xf(G.rbox(0.27, 0.06, 0.02, 0.01), [0, -0.16, 0.145]), 0x7e4d2a);
    R.setRest('packA', [0, 0.075, 0.14]);
    add('packA', 'matte', G.xf(G.rbox(0.3, 0.16, 0.022, 0.012, 2), [0, -0.07, 0.006], [0.08, 0, 0]), 0x7e4d2a);
    for (const s of [-1, 1]) {
      add('packA', 'trim', G.xf(G.box(0.025, 0.09, 0.008), [s * 0.08, -0.12, 0.016]), 0x4a2f1c);
      add('packA', 'metal', G.xf(G.rbox(0.032, 0.022, 0.008, 0.003), [s * 0.08, -0.15, 0.02]), 0xd8b45a);
    }
    add('pack', 'trim', G.xf(G.torus(0.04, 0.008, 6, 16, PI), [0, 0.085, 0.07]), 0x4a2f1c);
    B.springs.pack = { k: 50, d: 4.5, gain: 0.018, mode: 'stand', limit: 0.35 };
    B.springs.packA = { k: 60, d: 4, gain: 0.03, mode: 'hang', limit: 0.6 };
  },
  jet(B) {
    const { add, R } = B;
    addStraps(B, 0x2b2b30);
    add('pack', 'metal', G.xf(G.rbox(0.25, 0.28, 0.04, 0.012), [0, -0.03, 0.02]), 0x6e737a);
    for (const s of [-1, 1]) {
      const prof = [[0, -0.16], [0.04, -0.157], [0.066, -0.14], [0.072, -0.11], [0.072, 0.1], [0.06, 0.135], [0.034, 0.152], [0, 0.156]];
      add('pack', 'gloss', G.xf(G.lathe(prof, 20), [s * 0.075, -0.02, 0.105]), 0xd6372b);
      add('pack', 'metal', G.xf(G.torus(0.073, 0.007, 6, 20), [s * 0.075, 0.06, 0.105], [PI / 2, 0, 0]), 0xd0d0d0);
      add('pack', 'metal', G.xf(G.lathe([[0.03, 0], [0.034, -0.02], [0.046, -0.06], [0.04, -0.062], [0.026, -0.024], [0, -0.02]], 16), [s * 0.075, -0.17, 0.105]), 0x3a3c40);
    }
    add('pack', 'metal', G.xf(G.cyl(0.02, 0.02, 0.16, 10), [0, 0.13, 0.105], [0, 0, PI / 2]), 0xb8b8b8);
    R.setRest('packA', [0, -0.235, 0.105]);
    for (const s of [-1, 1]) {
      add('packA', glowKey(0xff8a1c), G.xf(G.cyl(0.033, 0.004, 0.12, 12), [s * 0.075, -0.06, 0], [PI, 0, 0]), 0xffffff);
      add('packA', glowKey(0xfff0a0), G.xf(G.cyl(0.018, 0.002, 0.07, 10), [s * 0.075, -0.035, 0], [PI, 0, 0]), 0xffffff);
    }
    B.flames = 'packA';
    B.springs.pack = { k: 60, d: 5, gain: 0.014, mode: 'stand', limit: 0.3 };
  },
  bear(B) {
    const { add, R } = B;
    addStraps(B, 0x8a5a3a);
    const fur = 0xb07a4c, light = 0xe8c9a2;
    add('pack', 'matte', G.xf(G.ell(0.15, 0.17, 0.1, 20, 14), [0, -0.07, 0.09]), fur);
    add('pack', 'matte', G.xf(G.ell(0.09, 0.1, 0.03, 14, 10), [0, -0.09, 0.17]), light);
    for (const s of [-1, 1]) {
      add('pack', 'matte', G.xf(G.ell(0.05, 0.065, 0.05, 12, 10), [s * 0.11, -0.2, 0.12]), fur);
      add('pack', 'matte', G.between([s * 0.12, 0.0, 0.1], [s * 0.2, 0.09, 0.01], 0.04, 5, 10), fur);
    }
    R.setRest('packA', [0, 0.08, 0.1]);
    add('packA', 'matte', G.xf(G.sphere(0.11, 20, 14), [0, 0.08, 0.0]), fur);
    for (const s of [-1, 1]) {
      add('packA', 'matte', G.xf(G.sphere(0.04, 12, 10), [s * 0.08, 0.17, 0.0]), fur);
      add('packA', 'matte', G.xf(G.ell(0.024, 0.024, 0.012, 10, 8), [s * 0.08, 0.17, 0.03]), light);
      add('packA', 'eyes', G.xf(G.sphere(0.013, 10, 8), [s * 0.04, 0.1, 0.1]), EYE);
    }
    add('packA', 'matte', G.xf(G.ell(0.045, 0.035, 0.03, 14, 10), [0, 0.06, 0.1]), light);
    add('packA', 'felt', G.xf(G.fuzzball(0.018, 0.05, 3, 4, 10, 8), [0, 0.07, 0.13]), NOSE);
    B.springs.pack = { k: 50, d: 4.5, gain: 0.016, mode: 'stand', limit: 0.3 };
    B.springs.packA = { k: 45, d: 3.5, gain: 0.028, mode: 'stand', limit: 0.5 };
  },
  turtle(B) {
    const { add } = B;
    addStraps(B, 0x4a3a28);
    const shell = G.ell(0.21, 0.25, 0.13, 30, 18);
    paint(shell, (x, y) => {
      const a = Math.atan2(y, x) * 3 / PI, rr = Math.hypot(x / 0.21, y / 0.25);
      const cell = Math.abs(((a % 1) + 1) % 1 - 0.5);
      const edge = rr < 0.42 ? Math.max(0, 1 - Math.abs(rr - 0.42) * 30) : Math.max(Math.max(0, 1 - Math.abs(rr - 0.42) * 30), Math.max(0, 1 - cell * 14));
      if (rr > 0.86) return 0xd8c48a;
      return _c2.set(0x4c8a3a).lerp(_c1.set(0x2f5a24), edge).clone();
    });
    add('pack', 'gloss', G.xf(shell, [0, -0.05, 0.08]), 0xffffff);
    add('pack', 'gloss', G.xf(G.torus(0.2, 0.018, 8, 32), [0, -0.05, 0.08], [0, 0, 0], [1, 1.2, 1]), 0xd8c48a);
    B.springs.pack = { k: 70, d: 6, gain: 0.01, mode: 'stand', limit: 0.2 };
  },
};

// ---------------------------------------------------------------------------
// Hats (hat bone = head centre (0, HEAD.cy, 0) in head space)
// ---------------------------------------------------------------------------
const toHat = (g) => g.translate(0, -HEAD.cy, 0);
const HTOP = HEAD.y1 - HEAD.cy;                    // top of the head in hat space
// ring brim around the head shell at head-space height y, scaled, with width(phi) and droop
function brim(y, scale, width, droop, thick = 0.008) {
  const c = new THREE.Vector3(0, HEAD.cy, 0);
  const inner = (phi, p) => { headPt(phi, y, 0, p); p.sub(c).multiplyScalar(scale).add(c); return p; };
  const mk = (flip, dy) => surfaceGrid(40, 3, (u, v, p) => {
    const phi = u * TAU; inner(phi, p);
    const w = typeof width === 'function' ? width(phi) : width;
    const rad = _v1.set(p.x, 0, p.z).normalize();
    p.addScaledVector(rad, w * v); p.y += -droop * v * v + dy;
  }, { closedU: true, flip });
  const top = mk(false, 0), bot = mk(true, -thick);
  const g = mergeGeometries([normGeo(top), normGeo(bot)]);
  return toHat(g);
}
const HATS = {
  none() { },
  bucket(B, e) {
    const { add } = B;
    const crown = headGrid(HEAD, 32, 9, 1.12, 0.33, 0);
    crown.attributes.position.array.forEach((v, i, a) => { if (i % 3 === 1 && v > 0.5) a[i] = 0.5 + (v - 0.5) * 0.4; });
    crown.computeVertexNormals();
    add('hat', 'matte', G.uv(toHat(crown), 1.4, 0.4), e.color);
    add('hat', 'matte', G.uv(brim(0.335, 1.12, 0.1, 0.05, 0.008), 1.6, 0.2), e.color);
    add('hat', 'matte', toHat(G.uv(headBand(0.335, 0.37, 0.025, 0.003), 1.4, 0.1)), 0x9c8a62);
    // sun patch (front-left) + blue patch (front-right)
    const sp = featurePt(-0.085, 0.385, 0.026);
    const sun = new THREE.CylinderGeometry(0.026, 0.026, 0.005, 16).rotateX(PI / 2);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; const ray = G.xf(G.cyl(0.0001, 0.008, 0.016, 4), [Math.cos(a) * 0.034, Math.sin(a) * 0.034, 0], [0, 0, a - PI / 2]); ray.applyQuaternion(sp.q).translate(sp.p.x, sp.p.y, sp.p.z); add('hat', 'felt', toHat(ray), 0xf07e1e); }
    sun.applyQuaternion(sp.q).translate(sp.p.x, sp.p.y, sp.p.z); add('hat', 'felt', toHat(sun), 0xf3a21e);
    const bp = featurePt(0.08, 0.378, 0.026);
    const patch = G.rbox(0.05, 0.036, 0.005, 0.008); patch.applyQuaternion(bp.q.clone().multiply(_q1.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2))).translate(bp.p.x, bp.p.y, bp.p.z);
    add('hat', 'felt', toHat(patch), 0x3768c0);
    B.springs.hat = { k: 100, d: 7, gain: 0.006, limit: 0.15 };
  },
  beanie(B, e) {
    const { add, R } = B;
    const cap = headGrid(HEAD, 32, 10, 1.07, 0.285, 0);
    paint(cap, (x, y, z) => _c2.set(e.color).multiplyScalar(0.9 + 0.1 * Math.sin(Math.atan2(x, z) * 30)).clone());
    add('hat', 'knit', G.uv(toHat(cap), 1.3, 0.4), 0xffffff);
    const cuff = surfaceGrid(40, 5, (u, v, p) => headPt(u * TAU, lerp(0.265, 0.34, v), 0.018 + 0.012 * Math.sin(PI * v), p), { closedU: true });
    paint(cuff, (x, y, z) => _c2.set(e.color).multiplyScalar(0.82 + 0.18 * Math.sin(Math.atan2(x, z) * 40)).clone());
    add('hat', 'knit', G.uv(toHat(cuff), 1.4, 0.08), 0xffffff);
    R.setRest('hatA', [0, HTOP + 0.012, 0]);
    const pom = G.fuzzball(0.078, 0.09, 3, 3.5, 28, 20);
    paint(pom, (x, y, z) => (valueNoise2(x * 90 + z * 30, y * 90, 3) > 0.6 ? e.color2 : e.color));
    add('hatA', 'knit', G.uv(G.xf(pom, [0, 0.06, 0]), 0.3, 0.3), 0xffffff);
    B.springs.hat = { k: 120, d: 8, gain: 0.004, limit: 0.12 };
    B.springs.hatA = { k: 55, d: 3.6, gain: 0.035, limit: 0.75 };
  },
  hardhat(B, e) {
    const { add } = B;
    const dome = headGrid(HEAD, 36, 10, 1.13, 0.33, 0);
    add('hat', 'hazardhat', toHat(dome), 0xffffff);
    const b = brim(0.335, 1.13, (phi) => 0.022 + 0.07 * Math.pow(Math.max(0, -Math.cos(phi)), 2), 0.018, 0.008);
    add('hat', 'gloss', b, e.color);
    { const c = new THREE.Vector3(0, HEAD.cy, 0), pts = [];
      for (let i = 0; i <= 10; i++) { const a = lerp(-1.0, 1.0, i / 10); const p = headPt(a > 0 ? PI : 0, HEAD.cy + Math.cos(a) * (HEAD.y1 - HEAD.cy), 0); p.sub(c).multiplyScalar(1.13).add(c); p.y += 0.008; pts.push(p); }
      add('hat', 'gloss', toHat(G.tube(pts, 0.015, 20, 8)), e.color); }
    B.springs.hat = { k: 140, d: 9, gain: 0.004, limit: 0.15 };
  },
  party(B, e) {
    const { add, R } = B;
    const cone = G.cyl(0.006, 0.1, 0.26, 24, true, 8);
    paint(cone, (x, y, z) => { const a = Math.atan2(x, z) / TAU + y * 5; return ((Math.floor(a * 6) % 2) + 2) % 2 ? e.color : e.color2; });
    const rot = [-0.12, 0, 0.32];
    const base = new THREE.Vector3(0, HTOP - 0.03, 0);
    const M4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot));
    add('hat', 'gloss', G.xf(cone, [0, 0.13, 0]).applyMatrix4(M4).translate(base.x, base.y, base.z), 0xffffff);
    add('hat', 'gloss', G.xf(G.torus(0.098, 0.012, 6, 24), [0, 0.005, 0], [PI / 2, 0, 0]).applyMatrix4(M4).translate(base.x, base.y, base.z), 0xf25a8a);
    const tip = new THREE.Vector3(0, 0.26, 0).applyEuler(new THREE.Euler(...rot)).add(base);
    R.setRest('hatA', tip.toArray(), rot);
    add('hatA', 'felt', G.xf(G.fuzzball(0.034, 0.16, 7, 8, 14, 10), [0, 0.022, 0]), 0xf25a8a);
    B.springs.hat = { k: 120, d: 8, gain: 0.005, limit: 0.2 };
    B.springs.hatA = { k: 80, d: 4, gain: 0.02, limit: 0.6 };
  },
  cone(B, e) {
    const { add } = B;
    const rot = [-0.08, 0, -0.12];
    const g = G.cyl(0.022, 0.1, 0.3, 24, false, 10);
    paint(g, (x, y) => (Math.abs(y - 0.03) < 0.028 || Math.abs(y + 0.06) < 0.02 ? 0xf2f2ee : e.color));
    add('hat', 'gloss', G.xf(g, [0, HTOP + 0.15, 0], rot), 0xffffff);
    add('hat', 'gloss', G.xf(G.rbox(0.24, 0.026, 0.24, 0.01), [0, HTOP + 0.0, 0], rot), 0xd9561a);
    B.springs.hat = { k: 80, d: 5, gain: 0.008, limit: 0.25 };
  },
  propeller(B) {
    const { add, R } = B;
    const cap = headGrid(HEAD, 32, 9, 1.07, 0.36, 0);
    const cols = [0xe23b3b, 0xf6c41e, 0x2f7fe0, 0x3cb44a];
    paint(cap, (x, y, z) => cols[Math.floor(((Math.atan2(x, z) + PI) / TAU) * 4) % 4]);
    add('hat', 'gloss', toHat(cap), 0xffffff);
    add('hat', 'gloss', brim(0.37, 1.07, (phi) => 0.085 * Math.pow(Math.max(0, -Math.cos(phi)), 3), 0.02, 0.007), 0xe23b3b);
    add('hat', 'metal', G.xf(G.cyl(0.008, 0.008, 0.05, 8), [0, HTOP + 0.035, 0]), 0xcccccc);
    R.setRest('hatA', [0, HTOP + 0.062, 0]);
    add('hatA', 'gloss', G.xf(G.sphere(0.014, 10, 8), [0, 0.004, 0]), 0xf6c41e);
    for (const s of [-1, 1]) add('hatA', 'gloss', G.xf(G.ell(0.085, 0.006, 0.022, 12, 6), [s * 0.08, 0, 0], [0, 0, s * 0.18]), s > 0 ? 0xe23b3b : 0x2f7fe0);
    B.springs.hat = { k: 120, d: 8, gain: 0.004, limit: 0.12 };
    B.spin = 'hatA';
  },
  chef(B, e) {
    const { add } = B;
    const bandG = surfaceGrid(36, 3, (u, v, p) => headPt(u * TAU, lerp(0.32, 0.45, v), 0.022, p), { closedU: true });
    add('hat', 'matte', G.uv(toHat(bandG), 1.4, 0.15), e.color);
    const puffs = [[0, 0.3, 0, 0.13], [0.11, 0.27, 0.02, 0.1], [-0.11, 0.27, 0.02, 0.1], [0.04, 0.27, -0.1, 0.1], [-0.05, 0.27, 0.1, 0.1], [0.08, 0.28, 0.09, 0.09], [-0.08, 0.28, -0.09, 0.09]];
    for (const [x, y, z, r] of puffs) add('hat', 'matte', G.xf(G.sphere(r, 16, 10), [x, y, z]), e.color);
    B.springs.hat = { k: 70, d: 5, gain: 0.009, limit: 0.25 };
  },
  sprout(B) {
    const { add, R } = B;
    R.setRest('hatA', [0.02, HTOP - 0.008, 0.0]);
    add('hatA', 'gloss', G.tube([[0, 0, 0], [0.005, 0.04, 0], [-0.004, 0.08, 0], [0.004, 0.11, 0]], 0.0065, 10, 6), 0x4fae3a);
    for (const s of [-1, 1]) {
      add('hatA', 'gloss', G.xf(G.ell(0.045, 0.006, 0.026, 12, 6), [s * 0.042, 0.118, 0], [0, s * 0.2, s * -0.45]), 0x6cc84a);
      add('hatA', 'gloss', G.xf(G.capY(0.0025, 0, 0.04, 2, 4), [s * 0.022, 0.115, 0], [0, 0, s * -1.2]), 0x3f8a2e);
    }
    B.springs.hatA = { k: 40, d: 2.5, gain: 0.04, limit: 0.8 };
  },
  headlamp(B) {
    const { add } = B;
    add('hat', 'trim', toHat(headBand(0.355, 0.388, 0.006, 0.004)), 0x2b2b30);
    const F = featurePt(0, 0.375, 0.025);
    const box = G.rbox(0.07, 0.048, 0.045, 0.012); box.applyQuaternion(F.q).translate(F.p.x, F.p.y, F.p.z);
    add('hat', 'gloss', toHat(box), 0x2f3236);
    const L = featurePt(0, 0.375, 0.05);
    const rim = G.torus(0.02, 0.005, 6, 16); rim.applyQuaternion(L.q).translate(L.p.x, L.p.y, L.p.z);
    add('hat', 'metal', toHat(rim), 0xd0d0d0);
    const lens = G.xf(G.cyl(0.019, 0.019, 0.006, 16), null, [PI / 2, 0, 0]); lens.applyQuaternion(L.q).translate(L.p.x, L.p.y, L.p.z);
    add('hat', glowKey(0xfff2c0), toHat(lens), 0xffffff);
  },
  tophat(B, e) {
    const { add } = B;
    const M4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.1, 0, -0.14));
    const y = HTOP - 0.03;
    add('hat', 'matte', G.xf(G.lathe([[0.1, 0], [0.112, 0.0], [0.12, 0.2], [0.125, 0.22], [0, 0.222]], 28), [0, y, 0]).applyMatrix4(M4), e.color);
    add('hat', 'matte', G.xf(G.lathe([[0.11, 0.012], [0.19, 0.02], [0.195, 0.008], [0.185, 0.0], [0.11, 0.0]], 28), [0, y, 0]).applyMatrix4(M4), e.color);
    add('hat', 'matte', G.xf(G.lathe([[0.1135, 0.02], [0.117, 0.022], [0.119, 0.06], [0.1155, 0.062]], 28), [0, y, 0]).applyMatrix4(M4), 0xb5222c);
    B.springs.hat = { k: 90, d: 6, gain: 0.008, limit: 0.25 };
  },
  bunny(B, e) {
    const { add, R } = B;
    for (const [S, s] of [['A', -1], ['B', 1]]) {
      R.setRest('hat' + S, [s * 0.09, HTOP - 0.03, 0.01], [0, 0, -s * 0.25]);
      add('hat' + S, 'matte', G.xf(G.ell(0.048, 0.13, 0.025, 16, 10), [0, 0.12, 0]), e.color);
      add('hat' + S, 'felt', G.xf(G.ell(0.028, 0.094, 0.01, 12, 8), [0, 0.12, -0.017]), 0xf2a0b2);
    }
    B.springs.hatA = { k: 35, d: 2.6, gain: 0.035, limit: 0.9 };
    B.springs.hatB = { k: 38, d: 2.6, gain: 0.035, limit: 0.9 };
  },
  halo(B) {
    const { add, R } = B;
    R.setRest('hatA', [0, HTOP + 0.09, 0.02]);
    add('hatA', glowKey(0xffd54a), G.xf(G.torus(0.13, 0.013, 8, 32), null, [PI / 2 + 0.15, 0, 0]), 0xffffff);
    B.halo = 'hatA';
    B.springs.hatA = { k: 25, d: 3, gain: 0.02, limit: 0.4 };
  },
  crown(B) {
    const { add } = B;
    const M4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.12, 0, 0.2));
    const yb = HTOP - 0.04;
    add('hat', 'metal', G.lathe([[0.11, yb], [0.115, yb], [0.117, yb + 0.05], [0.11, yb + 0.05]], 28).applyMatrix4(M4), 0xffc43a);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      add('hat', 'metal', G.xf(G.cyl(0.0001, 0.03, 0.055, 4), [Math.sin(a) * 0.112, yb + 0.075, Math.cos(a) * 0.112], [0, a + PI / 4, 0]).applyMatrix4(M4), 0xffc43a);
      add('hat', 'gloss', G.xf(G.sphere(0.01, 8, 6), [Math.sin(a) * 0.115, yb + 0.105, Math.cos(a) * 0.115]).applyMatrix4(M4), [0xe0303a, 0x2f6fe0, 0x3ac060][i % 3]);
    }
    add('hat', 'matte', G.xf(new THREE.SphereGeometry(0.105, 18, 8, 0, TAU, 0, PI / 2), [0, yb + 0.01, 0], null, [1, 0.5, 1]).applyMatrix4(M4), 0xb02040);
    B.springs.hat = { k: 90, d: 6, gain: 0.008, limit: 0.25 };
  },
};

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------
const NECK_Y = 0.095; // chest-space height of the neck line
const ACCS = {
  none() { },
  scarf(B, e) {
    const { add, R } = B;
    const wrap = G.torus(0.158, 0.042, 12, 36);
    paint(wrap, (x, y, z, nx, ny, nz, u, v) => ((Math.floor(u * 28) + Math.floor(v * 6)) % 2 ? e.color : e.color2));
    add('chest', 'knit', G.uv(G.xf(wrap, [0, NECK_Y + 0.02, -0.005], [PI / 2 + 0.06, 0, 0], [1, 1, 0.9]), 1.1, 0.25), 0xffffff);
    const tail = (S, x, rz) => {
      R.setRest('acc' + S, [x, NECK_Y + 0.0, -0.15], [0.15, 0, rz]);
      const g = G.rbox(0.068, 0.22, 0.022, 0.01, 2);
      g.translate(0, -0.1, 0);
      paint(g, (px, py) => ((Math.floor((px + 0.1) / 0.017) + Math.floor((-py) / 0.017)) % 2 ? e.color : e.color2));
      add('acc' + S, 'knit', G.uv(g, 0.12, 0.25), 0xffffff);
      for (let i = 0; i < 5; i++) add('acc' + S, 'knit', G.capY(0.005, -0.208, -0.24, 2, 4).translate(-0.027 + i * 0.0135, 0, 0), i % 2 ? e.color : e.color2);
    };
    tail('A', -0.075, 0.14); tail('B', -0.03, -0.05);
    B.springs.accA = { k: 30, d: 3, gain: 0.04, mode: 'hang', grav: 0.5, limit: 0.8 };
    B.springs.accB = { k: 34, d: 3, gain: 0.04, mode: 'hang', grav: 0.5, limit: 0.8 };
  },
  fannypack(B, e) {
    const { add } = B;
    const phi = PI - 0.3, y = 0.0;
    const p = bodyPoint(phi, y, 0.05), n = bodyNormal(phi, y);
    const q = surfQ(n.clone().setY(0).normalize());
    const g = G.rbox(0.19, 0.095, 0.07, 0.035, 2); g.applyQuaternion(q); g.translate(p.x, p.y, p.z);
    add('body', 'matte', g, e.color);
    const z = G.box(0.17, 0.007, 0.01); z.translate(0, 0.022, -0.035); z.applyQuaternion(q); z.translate(p.x, p.y, p.z);
    add('body', 'trim', z, 0x111111);
    const pull = G.box(0.012, 0.024, 0.004); pull.translate(0.06, 0.008, -0.04); pull.applyQuaternion(q); pull.translate(p.x, p.y, p.z);
    add('body', 'metal', pull, 0xd0d0d0);
    add('body', 'trim', band(-0.008, 0.012, 0.012, 0.004, 40), e.color2);
  },
  tie(B, e) {
    const { add, R } = B;
    const p = bodyPoint(PI, 0.45, 0.01);
    add('body', 'matte', G.xf(G.rbox(0.032, 0.03, 0.018, 0.008), [p.x, p.y + 0.01, p.z]), e.color);
    R.setRest('acc', [p.x, p.y - 0.002, p.z - 0.006], [-0.14, 0, 0]);
    const sh = new THREE.Shape();
    sh.moveTo(-0.013, 0); sh.lineTo(0.013, 0); sh.lineTo(0.03, -0.19); sh.lineTo(0, -0.222); sh.lineTo(-0.03, -0.19); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
    g.translate(0, 0, -0.003);
    paint(g, (x, y) => (Math.floor((x * 0.7 - y) / 0.03) % 3 === 0 ? e.color2 : e.color));
    add('acc', 'matte', g, 0xffffff);
    B.springs.acc = { k: 50, d: 4, gain: 0.02, mode: 'hang', limit: 0.35 };
  },
  bowtie(B, e) {
    const { add } = B;
    const p = bodyPoint(PI, 0.47, 0.02);
    for (const s of [-1, 1]) add('body', 'matte', G.xf(G.cyl(0.026, 0.008, 0.05, 10), [p.x + s * 0.028, p.y, p.z - 0.008], [0, 0, s * PI / 2], [1, 1, 0.55]), e.color);
    add('body', 'matte', G.xf(G.sphere(0.013, 10, 8), [p.x, p.y, p.z - 0.014]), 0xa32334);
  },
  lei(B) {
    const { add, R } = B;
    R.setRest('accA', [0, NECK_Y, 0]);
    const cols = [0xf25a8a, 0xf6d24a, 0xf8f4f0, 0xb88af0, 0xf2843a];
    const petal = G.ell(0.018, 0.006, 0.012, 6, 3);
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * TAU, front = Math.max(0, -Math.cos(a));
      const p = new THREE.Vector3(Math.sin(a) * 0.18, -0.02 - front * 0.1, Math.cos(a) * 0.16 - front * 0.05);
      const n = new THREE.Vector3(Math.sin(a), 0.6 - front * 0.4, Math.cos(a) - front * 0.4).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
      for (let k = 0; k < 5; k++) {
        const pa = (k / 5) * TAU;
        add('accA', 'felt', G.xf(petal.clone(), [Math.cos(pa) * 0.015, 0, Math.sin(pa) * 0.015], [0, -pa, 0]).applyQuaternion(q).translate(p.x, p.y, p.z), cols[i % cols.length]);
      }
      add('accA', 'felt', G.sphere(0.008, 6, 4).applyQuaternion(q).translate(p.x + n.x * 0.004, p.y + n.y * 0.004, p.z + n.z * 0.004), 0xf6c41e);
    }
    B.springs.accA = { k: 60, d: 5, gain: 0.012, mode: 'hang', limit: 0.25 };
  },
  bandana(B, e) {
    const { add } = B;
    add('chest', 'matte', G.xf(G.torus(0.15, 0.028, 10, 36), [0, NECK_Y + 0.02, 0], [PI / 2 + 0.1, 0, 0], [1, 1, 0.92]), e.color);
    const tri = G.cyl(0.0001, 0.11, 0.012, 3);
    paint(tri, (x, y, z) => (Math.hypot(((x * 60) % 1 + 1) % 1 - 0.5, ((z * 60) % 1 + 1) % 1 - 0.5) < 0.22 ? 0xf8f4ee : e.color));
    add('chest', 'matte', G.xf(tri, [0, NECK_Y - 0.01, -0.16], [PI / 2 - 0.5, 0, PI], [1.2, 1, 1]), 0xffffff);
  },
  headphones(B) {
    const { add } = B;
    add('chest', 'gloss', G.xf(G.torus(0.17, 0.012, 8, 28, PI), [0, NECK_Y + 0.01, 0.03], [PI / 2 + 0.35, 0, PI]), 0x2a2a30);
    for (const s of [-1, 1]) {
      add('chest', 'gloss', G.xf(G.cyl(0.05, 0.05, 0.035, 18), [s * 0.175, NECK_Y - 0.01, -0.04], [0, 0, PI / 2 + s * 0.3]), 0xf25a8a);
      add('chest', 'matte', G.xf(G.cyl(0.042, 0.042, 0.012, 18), [s * 0.152, NECK_Y - 0.004, -0.04], [0, 0, PI / 2 + s * 0.3]), 0x222226);
    }
  },
  bell(B) {
    const { add, R } = B;
    add('chest', 'matte', G.xf(G.torus(0.152, 0.016, 8, 36), [0, NECK_Y + 0.02, -0.005], [PI / 2 + 0.1, 0, 0]), 0xd8303a);
    R.setRest('accA', [0, NECK_Y, -0.16]);
    add('accA', 'metal', G.xf(G.sphere(0.028, 14, 10), [0, -0.03, 0]), 0xffc83a);
    add('accA', 'metal', G.xf(G.torus(0.028, 0.004, 6, 16), [0, -0.03, 0], [PI / 2, 0, 0]), 0xd8a02a);
    add('accA', 'trim', G.xf(G.box(0.004, 0.016, 0.004), [0, -0.042, -0.026]), 0x222222);
    B.springs.accA = { k: 40, d: 2.5, gain: 0.03, mode: 'hang', limit: 0.6 };
  },
  badge(B) {
    const { add, R } = B;
    const phi = PI - 0.45, y = 0.34;
    const p = bodyPoint(phi, y, 0.008 + (B.outfit.jacket ? 0.025 : 0)), n = bodyNormal(phi, y);
    R.setRest('acc', p.toArray(), surfQ(n));
    add('acc', 'matte', G.xf(G.rbox(0.03, 0.05, 0.004, 0.002), [-0.012, 0.0, -0.002], [0, 0, 0.2]), 0x2f5fd0);
    add('acc', 'matte', G.xf(G.rbox(0.03, 0.05, 0.004, 0.002), [0.012, 0.0, -0.002], [0, 0, -0.2]), 0xd03040);
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + PI / 2, r = i % 2 ? 0.014 : 0.032; if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const star = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
    add('acc', 'metal', G.xf(star, [0, -0.04, -0.012], [0, PI, 0]), 0xffc43a);
    B.springs.acc = { k: 60, d: 4, gain: 0.012, mode: 'hang', limit: 0.3 };
  },
};

function badgeTexture(num) {
  return labelTexture(256, 180, (ctx, w, h) => {
    ctx.fillStyle = '#f7f5ee'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2c418'; ctx.fillRect(0, 0, w, 56);
    ctx.fillStyle = '#151515';
    for (let x = -60; x < w; x += 22) { ctx.beginPath(); ctx.moveTo(x, 56); ctx.lineTo(x + 11, 56); ctx.lineTo(x + 19, 48); ctx.lineTo(x + 8, 48); ctx.closePath(); ctx.fill(); }
    ctx.font = "bold 40px 'IBM Plex Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('R.O.O.M.', w / 2, 26);
    ctx.fillStyle = '#d9d4c4'; ctx.fillRect(14, 68, 74, 90);
    ctx.fillStyle = '#c9a977'; ctx.beginPath(); ctx.roundRect(30, 80, 42, 56, 16); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(42, 102, 3, 0, TAU); ctx.arc(60, 102, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d52f2a'; ctx.beginPath(); ctx.arc(51, 113, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2c418'; ctx.fillRect(22, 136, 58, 22);
    ctx.fillStyle = '#151515'; ctx.textAlign = 'left';
    ctx.font = "bold 17px 'IBM Plex Mono', monospace"; ctx.fillText('CLONE', 100, 80);
    ctx.font = "bold 40px 'IBM Plex Mono', monospace"; ctx.fillText('#' + num, 98, 114);
    for (let i = 0, x = 100; x < w - 12; i++) { const bw = 1 + ((num.charCodeAt(i % num.length) + i * 7) % 3); ctx.fillRect(x, 140, bw, 26); x += bw + 2 + (i % 2); }
  });
}

function buildAvatarParts(R, cos, extra = {}) {
  R.chunks = []; R.extras = [];
  for (const n of AUX) R.setRest(n, AUX_REST[n] || [0, 0, 0]);
  const B = {
    R, cos, springs: {}, dead: !!extra.dead, badgeMat: extra.badgeMat, outfit: outfitSpec(cos.suitEntry),
    add: (bone, mat, geo, color) => R.add(bone, mat, geo, color),
    attach: (bone, obj) => R.attach(bone, obj),
  };
  buildOutfit(B);
  buildHead(B);
  (GEAR[cos.visorEntry.id] || GEAR.none)(B);
  (PACKS[cos.packEntry.id] || PACKS.none)(B);
  (HATS[cos.hatEntry.id] || HATS.none)(B, cos.hatEntry);
  (ACCS[cos.accEntry.id] || ACCS.none)(B, cos.accEntry);
  // hose target: respirator filter if worn, otherwise a regulator clipped to the right strap
  if (B.hoseStart) {
    if (B.maskHose) B.hoseEnd = { bone: 'head', pos: B.maskHose, dir: B.maskHoseDir };
    else if (B.strapR) {
      const { phi, y, off } = B.strapR;
      const p = bodyPoint(phi, y, off + 0.02), n = bodyNormal(phi, y);
      const reg = G.rbox(0.04, 0.05, 0.028, 0.01); reg.applyQuaternion(surfQ(n)); reg.translate(p.x, p.y, p.z);
      R.add('body', 'gloss', reg, 0x2a2b2f);
      R.add('body', 'gloss', G.xf(G.cyl(0.012, 0.012, 0.01, 10), [p.x + n.x * 0.016, p.y - 0.006, p.z + n.z * 0.016], [PI / 2, 0, 0]).applyQuaternion(new THREE.Quaternion()), 0xd8d8d8);
      B.hoseEnd = { bone: 'body', pos: p.clone().add(new THREE.Vector3(0, 0.028, 0)), dir: new THREE.Vector3(0, 1, 0.3).normalize() };
    }
  }
  return B;
}

// ============================================================================
// Hose (dynamic tube)
// ============================================================================
class Hose {
  constructor(segs = 20, rad = 7, r = 0.014) {
    this.segs = segs; this.rad = rad; this.r = r;
    const n = (segs + 1) * (rad + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2), idx = [];
    for (let i = 0; i <= segs; i++) for (let j = 0; j <= rad; j++) { const k = i * (rad + 1) + j; uv[k * 2] = j / rad; uv[k * 2 + 1] = i / segs; }
    for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, AM.hose());
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.name = 'hose';
    this.pts = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
    this.mid = new THREE.Vector3(); this.midV = new THREE.Vector3(); this.has = false;
    this.N = new THREE.Vector3(); this.T = new THREE.Vector3(); this.Bv = new THREE.Vector3();
  }
  update(dt, p0, t0, p3, t3) {
    const L = p0.distanceTo(p3);
    const P1 = _v1.copy(p0).addScaledVector(t0, L * 0.5);
    const P2 = _v2.copy(p3).addScaledVector(t3, L * 0.45);
    const target = _v3.copy(P1).add(P2).multiplyScalar(0.5); target.y -= 0.05;
    if (!this.has) { this.mid.copy(target); this.midV.set(0, 0, 0); this.has = true; }
    const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
    for (let i = 0; i < n; i++) {
      _v4.subVectors(target, this.mid).multiplyScalar(150).addScaledVector(this.midV, -10);
      this.midV.addScaledVector(_v4, h); this.mid.addScaledVector(this.midV, h);
    }
    if (this.mid.distanceToSquared(target) > 0.04) { this.mid.copy(target); this.midV.set(0, 0, 0); }
    const off = _v4.subVectors(this.mid, target);
    for (let i = 0; i <= this.segs; i++) {
      const t = i / this.segs, it = 1 - t;
      this.pts[i].set(0, 0, 0).addScaledVector(p0, it * it * it).addScaledVector(P1, 3 * it * it * t).addScaledVector(P2, 3 * it * t * t).addScaledVector(p3, t * t * t).addScaledVector(off, Math.sin(t * PI) * 1.2);
    }
    const pos = this.mesh.geometry.attributes.position, nor = this.mesh.geometry.attributes.normal;
    const T = this.T, N = this.N.set(0, 0, 1), Bv = this.Bv;
    for (let i = 0; i <= this.segs; i++) {
      T.subVectors(this.pts[Math.min(this.segs, i + 1)], this.pts[Math.max(0, i - 1)]).normalize();
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize(); Bv.crossVectors(T, N);
      const p = this.pts[i];
      for (let j = 0; j <= this.rad; j++) {
        const a = (j / this.rad) * TAU, c = Math.cos(a), s = Math.sin(a);
        const nx = N.x * c + Bv.x * s, ny = N.y * c + Bv.y * s, nz = N.z * c + Bv.z * s, k = i * (this.rad + 1) + j;
        pos.setXYZ(k, p.x + nx * this.r, p.y + ny * this.r, p.z + nz * this.r); nor.setXYZ(k, nx, ny, nz);
      }
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
  }
}

// ============================================================================
// Pose channels (Euler angles per bone). Targets are blended linearly, then most
// channels are driven through damped springs (+ acceleration forcing) so the doll
// flops, lags and overshoots.
// ============================================================================
const CH = { pelvisPos: 0, pelvis: 3, squash: 6, chest: 7, head: 10, shL: 13, elL: 16, wrL: 19, shR: 22, elR: 25, wrR: 28, hipL: 31, knL: 34, anL: 37, hipR: 40, knR: 43, anR: 46, fiL: 49, fiR: 50, N: 51 };
const set3 = (p, i, x, y, z) => { p[i] = x; p[i + 1] = y; p[i + 2] = z; };
const mix3 = (p, i, x, y, z, w) => { p[i] += (x - p[i]) * w; p[i + 1] += (y - p[i + 1]) * w; p[i + 2] += (z - p[i + 2]) * w; };
const add3 = (p, i, x, y, z) => { p[i] += x; p[i + 1] += y; p[i + 2] += z; };
const SPRING_GROUPS = [
  [CH.pelvis, 3, 260, 0.62], [CH.chest, 3, 190, 0.5], [CH.head, 3, 120, 0.38],
  [CH.shL, 3, 70, 0.33], [CH.shR, 3, 70, 0.33], [CH.elL, 3, 60, 0.3], [CH.elR, 3, 60, 0.3],
  [CH.wrL, 3, 80, 0.36], [CH.wrR, 3, 80, 0.36],
];
const SK = new Float32Array(CH.N), SD = new Float32Array(CH.N);
for (const [i0, n, k, z] of SPRING_GROUPS) for (let i = i0; i < i0 + n; i++) { SK[i] = k; SD[i] = 2 * z * Math.sqrt(k); }

// Two-bone IK in the limb's parent space. rel = target - joint (limb rest points -Y).
// Returns [pitchX, rollZ, bend] for 'ZXY' order. knee=true -> knee bends forward.
function ik2(rel, a, b, knee, out) {
  const d0 = rel.length();
  const d = clamp(d0, Math.abs(a - b) + 0.01, a + b - 0.0005);
  const t = d0 > 1e-6 ? _v4.copy(rel).divideScalar(d0) : _v4.set(0, -1, 0);
  const pitch = Math.asin(clamp(-t.z, -1, 1));
  const roll = Math.atan2(t.x, -t.y);
  const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const gamma = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  if (knee) { out[0] = pitch + alpha; out[2] = -(PI - gamma); } else { out[0] = pitch - alpha; out[2] = PI - gamma; }
  out[1] = Math.abs(t.y) < 0.15 && Math.abs(t.x) < 0.15 ? roll * Math.abs(t.y) / 0.15 : roll;
  return out;
}

// world-space point tracker -> smoothed acceleration
class Tracker {
  constructor() { this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.a = new THREE.Vector3(); this.has = 0; }
  update(wp, dt) {
    if (dt <= 1e-4) return;
    if (this.has === 0 || wp.distanceToSquared(this.p) > 1) { this.p.copy(wp); this.v.set(0, 0, 0); this.a.set(0, 0, 0); this.has = 1; return; }
    _v4.subVectors(wp, this.p).divideScalar(dt);
    if (this.has === 1) { this.v.copy(_v4); this.p.copy(wp); this.has = 2; return; }
    _v3.subVectors(_v4, this.v).divideScalar(dt).clampLength(0, 40);
    const k = 1 - Math.exp(-28 * dt);
    this.a.lerp(_v3, k);
    this.v.copy(_v4); this.p.copy(wp);
  }
}

// ============================================================================
// Avatar
// ============================================================================
let _avatarCount = 0;
export class Avatar {
  constructor(cosmetics = DEFAULT_COSMETICS, opts = { firstPersonHidden: false }) {
    this.root = new THREE.Group();
    this.root.name = 'Avatar';
    this.rigRoot = new THREE.Group();
    this.root.add(this.rigRoot);
    this.R = makeAvatarRig();
    this.rigRoot.add(this.R.b.pelvis);
    this.bones = this.R.b;
    this.name = '';
    this._seed = ++_avatarCount * 7919;
    this.empNo = String(1000 + (this._seed % 8999)).padStart(4, '0');
    this.badgeTex = badgeTexture(this.empNo);
    this.badgeMat = new THREE.MeshStandardMaterial({ map: this.badgeTex, roughness: 0.5 });
    this.anchors = { right: new THREE.Object3D(), left: new THREE.Object3D(), head: new THREE.Object3D(), watch: new THREE.Object3D() };
    for (const [k, o] of Object.entries(this.anchors)) o.name = 'anchor_' + k;
    // hand anchors: palm centre, -Z along the hand's pointing direction
    this.anchors.right.position.set(0, -0.055, 0); this.anchors.right.rotation.set(-PI / 2, 0, 0);
    this.anchors.left.position.set(0, -0.055, 0); this.anchors.left.rotation.set(-PI / 2, 0, 0);
    this.R.b.wrR.add(this.anchors.right); this.R.b.wrL.add(this.anchors.left);
    this.R.b.head.add(this.anchors.head); this.R.b.elL.add(this.anchors.watch);
    this.hose = new Hose();
    this.rigRoot.add(this.hose.mesh);
    this.hoseStart = new THREE.Object3D(); this.hoseEnd = new THREE.Object3D();
    this.fpHidden = !!opts?.firstPersonHidden;
    this.pose = new Float32Array(CH.N);
    this.sx = new Float32Array(CH.N); this.sv = new Float32Array(CH.N); this.F = new Float32Array(CH.N); this._springInit = false;
    this.trk = { pelvis: new Tracker(), chest: new Tracker(), shL: new Tracker(), shR: new Tracker() };
    this.t = Math.random() * 10;
    this.st = {
      speed: 0, mx: 0, my: 1, crouch: 0, sprint: 0, hold: 0, holdT: 0, talk: 0, pitch: 0, air: 0, dead: 0, limp: 0,
      phase: 0, squash: new Spring(260, 9, 1), headSq: new Spring(220, 8, 1), jig: new Spring(170, 5, 0), land: 0,
      emote: { wave: 0, dance: 0, point: 0, sit: 0, sleep: 0 },
      face: { eyeL: 1, eyeR: 1, eyeS: 1, brow: 0, browRot: 0, blush: 1, x: 0, tilt: 0, nod: 0 },
      blinkT: 1 + Math.random() * 3, blink: 0, blinkDur: 0, mouthCell: 'smile', tremble: 0,
      finger: new Spring(300, 18, 0), wasGrounded: true, lastVy: 0, spin: 0,
      yaw: 0, yawRate: 0, yawAcc: 0, yawHas: false,
    };
    this._ik = [0, 0, 0];
    this.setCosmetics(cosmetics);
    this.update(0, {});
  }

  setCosmetics(c) {
    const cos = resolveCos(c);
    this.cos = cos;
    this.cosmetics = { suit: cos.suit, skin: cos.skin, hat: cos.hat, visor: cos.visor, face: cos.face, backpack: cos.backpack, accessory: cos.accessory };
    this._disposeParts();
    const B = buildAvatarParts(this.R, cos, { badgeMat: this.badgeMat });
    this.B = B;
    const built = this.R.build((key) => AM.get(key, cos), { shadow: true });
    this.meshes = built.meshes; this.skeleton = built.skeleton;
    for (const m of this.meshes) this.rigRoot.add(m);
    for (const ex of this.R.extras) (typeof ex.bone === 'string' ? this.R.b[ex.bone] : ex.bone).add(ex.obj);
    this.mouth = B.mouth;
    this.anchors.head.position.copy(B.headAnchor.position);
    this.anchors.watch.position.copy(B.watchAnchor.position); this.anchors.watch.quaternion.copy(B.watchAnchor.quaternion);
    this.hoseStart.removeFromParent(); this.hoseEnd.removeFromParent();
    if (B.hoseStart && B.hoseEnd) {
      this.R.b[B.hoseStart.bone].add(this.hoseStart); this.hoseStart.position.copy(B.hoseStart.pos); this.hoseStartDir = B.hoseStart.dir;
      this.R.b[B.hoseEnd.bone].add(this.hoseEnd); this.hoseEnd.position.copy(B.hoseEnd.pos); this.hoseEndDir = B.hoseEnd.dir; this.hoseEndBone = this.R.b[B.hoseEnd.bone];
    }
    this.hasHose = !!(B.hoseStart && B.hoseEnd);
    this.hose.has = false;
    this._updateHoseVis();
    this.wobbles = [];
    for (const [bone, cfg] of Object.entries(B.springs)) this.wobbles.push(new Wobble(this.R.b[bone], cfg));
    this.spinBone = B.spin ? this.R.b[B.spin] : null;
    this.haloBone = B.halo ? this.R.b[B.halo] : null;
    this.flameBone = B.flames ? this.R.b[B.flames] : null;
    this.faceEntry = cos.faceEntry;
    this.st.mouthCell = '';
  }
  _updateHoseVis() { this.hose.mesh.visible = this.hasHose && !(this.fpHidden && this.hoseEndBone === this.R.b.head); }
  _disposeParts() {
    if (this.meshes) for (const m of this.meshes) { m.removeFromParent(); m.geometry.dispose(); }
    if (this.skeleton) this.skeleton.dispose();
    if (this.R.extras) for (const ex of this.R.extras) {
      ex.obj.removeFromParent(); ex.obj.geometry?.dispose();
      if (ex.obj.name === 'mouth') { ex.obj.material.map.dispose(); ex.obj.material.dispose(); }
    }
    this.meshes = null; this.skeleton = null;
  }
  setName(str) {
    this.name = String(str ?? '');
    const num = String(1000 + (hashString(this.name || String(this._seed)) % 8999)).padStart(4, '0');
    if (num !== this.empNo) {
      this.empNo = num;
      const old = this.badgeTex;
      this.badgeTex = badgeTexture(num);
      this.badgeMat.map = this.badgeTex; this.badgeMat.needsUpdate = true;
      old.dispose();
    }
  }
  setVisibleFirstPerson(hidden) { this.fpHidden = !!hidden; this._updateHoseVis(); }
  getHandAnchor(side = 'right') { return side === 'left' ? this.anchors.left : this.anchors.right; }
  getHeadAnchor() { return this.anchors.head; }
  getWatchAnchor() { return this.anchors.watch; }
  dispose() {
    this._disposeParts();
    this.hose.mesh.geometry.dispose();
    this.badgeTex.dispose(); this.badgeMat.dispose();
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------------------
  update(dt, s = {}) {
    dt = clamp(dt || 0, 0, 0.1);
    const st = this.st, b = this.bones, p = this.pose;
    this.t += dt;
    const t = this.t;
    this.root.updateWorldMatrix(true, false);

    // ---- measure motion of the previous pose (for secondary motion)
    const tk = this.trk;
    tk.pelvis.update(b.pelvis.getWorldPosition(_v1), dt);
    tk.chest.update(b.chest.getWorldPosition(_v1), dt);
    tk.shL.update(b.shL.getWorldPosition(_v1), dt);
    tk.shR.update(b.shR.getWorldPosition(_v1), dt);
    const cq = b.chest.getWorldQuaternion(_q2).invert();
    const aC = this._aC || (this._aC = new THREE.Vector3()), aL = this._aL || (this._aL = new THREE.Vector3()), aR = this._aR || (this._aR = new THREE.Vector3());
    aC.copy(tk.chest.a).applyQuaternion(cq); aL.copy(tk.shL.a).applyQuaternion(cq); aR.copy(tk.shR.a).applyQuaternion(cq);
    {
      this.root.getWorldQuaternion(_q1);
      _v2.set(0, 0, -1).applyQuaternion(_q1);
      const yaw = Math.atan2(-_v2.x, -_v2.z);
      if (st.yawHas && dt > 1e-4) {
        let d = yaw - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        const rate = clamp(d / dt, -20, 20);
        st.yawAcc = damp(st.yawAcc, clamp((rate - st.yawRate) / dt, -200, 200), 20, dt);
        st.yawRate = rate;
      }
      st.yaw = yaw; st.yawHas = true;
    }

    // ---- inputs
    const dead = !!s.dead;
    const grounded = s.grounded !== false;
    const vy = s.vy || 0;
    const md = s.moveDir;
    let mx = st.mx, my = st.my;
    if (md && (Math.abs(md.x) + Math.abs(md.y)) > 0.01) { const l = Math.hypot(md.x, md.y); mx = md.x / l; my = md.y / l; }
    st.mx = damp(st.mx, mx, 10, dt); st.my = damp(st.my, my, 10, dt);
    st.speed = damp(st.speed, clamp(s.speed || 0, 0, 8), 9, dt);
    st.crouch = damp(st.crouch, clamp(s.crouch || 0, 0, 1), 10, dt);
    st.sprint = damp(st.sprint, s.sprint && (s.speed || 0) > 0.5 ? 1 : 0, 5, dt);
    st.hold = damp(st.hold, clamp(s.holding || 0, 0, 1), 9, dt);
    st.holdT = damp(st.holdT, s.holdTarget ? 1 : 0, 9, dt);
    st.talk = damp(st.talk, clamp(s.talking || 0, 0, 1), 20, dt);
    st.pitch = damp(st.pitch, clamp(s.pitch || 0, -1.3, 1.3), 14, dt);
    st.air = damp(st.air, grounded ? 0 : 1, grounded ? 16 : 7, dt);
    st.limp = damp(st.limp, s.limp ? 1 : 0, 4, dt);
    st.dead = approach(st.dead, dead ? 1 : 0, dt * (dead ? 1.8 : 1.2));
    for (const k in st.emote) st.emote[k] = approach(st.emote[k], !dead && s.emote === k ? 1 : 0, dt * 3.5);
    if (grounded && !st.wasGrounded && dt > 0) {
      const imp = clamp(-st.lastVy / 6, 0.2, 1.5);
      st.squash.v -= imp * 6.5;
      st.headSq.v -= imp * 3;
      st.land = Math.max(st.land, imp);
    }
    if (!grounded && st.wasGrounded && vy > 0.5) { st.squash.v += 2.5; }
    st.wasGrounded = grounded; st.lastVy = vy;
    st.land = Math.max(0, st.land - dt * 3);

    // ---- face targets (expression may tilt the head)
    this._faceTargets(dt, s, st, t);

    // ---- gait
    const walk = smooth(clamp(st.speed / 0.5, 0, 1)) * (1 - st.air);
    const strideLen = lerp(0.46, 0.95, st.sprint) * lerp(1, 0.75, st.crouch);
    let freq = clamp(st.speed / strideLen, 0, lerp(3.2, 3.8, st.sprint));
    if (st.emote.dance > 0.01) freq = lerp(freq, 1.05, st.emote.dance);
    let rate = 1;
    if (st.limp > 0.01) { const pp = st.phase % 1; rate = lerp(1, pp < 0.5 ? 1.7 : 0.72, st.limp); }
    st.phase = (st.phase + freq * rate * dt) % 1;
    const ph = st.phase * TAU;
    const breath = Math.sin(t * 2.1);
    const sp = st.sprint * walk;
    const idle = (1 - walk) * (1 - st.air);

    // ---- locomotion targets
    p.fill(0);
    const bob = walk * (0.022 + 0.022 * sp) * (0.5 - 0.5 * Math.cos(2 * ph));
    let py = D.pelvisY - st.crouch * 0.115 + bob - walk * 0.012 + breath * 0.003 * idle;
    py -= st.limp * walk * 0.035 * Math.max(0, Math.sin(ph));
    set3(p, CH.pelvisPos, 0, py, 0);
    const roll = walk * (0.13 * (1 - 0.5 * sp)) * Math.sin(ph) + st.limp * walk * 0.08 * Math.max(0, Math.sin(ph));
    set3(p, CH.pelvis, -(0.05 * walk + 0.26 * sp) - st.crouch * 0.2 + st.air * (vy > 0 ? -0.08 : 0.12), walk * 0.12 * Math.cos(ph), roll);
    let sq = 1 + breath * 0.016 * (0.4 + idle) - walk * 0.05 * (0.5 + 0.5 * Math.cos(2 * ph)) - st.crouch * 0.06;
    if (!grounded) sq += vy > 0 ? 0.2 * clamp(vy / 5, 0, 1) : 0.05;
    p[CH.squash] = sq;
    const wob = Math.sin(t * 0.83) * 0.5 + Math.sin(t * 1.37 + 2) * 0.5;
    set3(p, CH.chest, -0.06 * sp + st.pitch * 0.15 + st.crouch * 0.1, -p[CH.pelvis + 1] * 0.9, -roll * 0.45 + wob * 0.015 * idle);
    set3(p, CH.head,
      st.pitch * 0.65 + 0.08 * sp + st.crouch * 0.12 + walk * 0.05 * Math.cos(2 * ph) + st.face.nod,
      wob * 0.05 * idle,
      -roll * 0.6 + st.face.tilt + wob * 0.035 * idle);
    // arms: floppy swing (springs add the lag)
    const swing = walk * (0.5 + 0.6 * sp) * lerp(1, 0.5, st.crouch);
    const c = Math.cos(ph);
    const splay = 0.42 + st.air * (0.9 + 0.3 * Math.sin(t * 9)) + st.crouch * 0.1 + Math.abs(st.yawRate) * 0.04;
    set3(p, CH.shL, -swing * c + st.crouch * 0.3, 0, -splay - wob * 0.03 * idle);
    set3(p, CH.shR, swing * c + st.crouch * 0.3, 0, splay + wob * 0.03 * idle);
    set3(p, CH.elL, 0.15 + sp * 1.0 + Math.max(0, -c) * swing * 0.5 + st.air * 0.4, 0, -0.1);
    set3(p, CH.elR, 0.15 + sp * 1.0 + Math.max(0, c) * swing * 0.5 + st.air * 0.4, 0, 0.1);
    this._legs(p, st, walk, strideLen, grounded, vy, t);

    // ---- emotes / dead
    const E = st.emote;
    if (E.wave > 0.001) this._emoteWave(p, E.wave, t);
    if (E.dance > 0.001) this._emoteDance(p, E.dance, t);
    if (E.point > 0.001) this._emotePoint(p, E.point, t);
    const sitW = Math.max(E.sit, E.sleep);
    if (sitW > 0.001) this._emoteSit(p, sitW, E.sleep, t);
    if (st.dead > 0.001) this._poseDead(p, st.dead, t);

    // ---- holding / reaching (IK targets in chest space)
    const holdW = Math.max(st.hold, st.holdT) * (1 - st.dead) * (1 - sitW * 0.5);
    if (holdW > 0.001) {
      b.chest.updateWorldMatrix(true, false);
      const tR = _v1.set(0.11, -0.1, -0.29);
      if (s.holdTarget && st.holdT > 0.001) { _v2.copy(s.holdTarget); b.chest.worldToLocal(_v2); tR.lerp(_v2, st.holdT); }
      tR.y += Math.sin(ph * 2) * 0.012 * walk;
      this._armIK('R', tR, holdW, p);
      const tL = _v1.set(-0.11, -0.1, -0.29 + (s.holdTarget ? 0.08 : 0));
      tL.y += Math.sin(ph * 2 + 1) * 0.012 * walk;
      this._armIK('L', tL, st.hold * (1 - st.dead) * (1 - sitW * 0.5), p);
    }

    // ---- springs (+ acceleration forcing)
    const F = this.F; F.fill(0);
    const gA = 0.017, gV = 0.012, gE = 0.012, gH = 0.006, gC = 0.0025;
    const deadK = 1 - st.dead * 0.7;
    F[CH.shL] = SK[CH.shL] * gA * aL.z; F[CH.shR] = SK[CH.shR] * gA * aR.z;
    F[CH.shL + 2] = SK[CH.shL] * (-gA * aL.x + gV * aL.y); F[CH.shR + 2] = SK[CH.shR] * (-gA * aR.x - gV * aR.y);
    F[CH.elL] = SK[CH.elL] * gE * aL.z; F[CH.elR] = SK[CH.elR] * gE * aR.z;
    F[CH.head] = -SK[CH.head] * gH * aC.z; F[CH.head + 2] = SK[CH.head] * gH * aC.x; F[CH.head + 1] = -SK[CH.head] * 0.012 * st.yawAcc;
    F[CH.chest] = -SK[CH.chest] * gC * aC.z; F[CH.chest + 2] = SK[CH.chest] * gC * aC.x;
    const X = this.sx, Vv = this.sv;
    if (!this._springInit) { X.set(p); Vv.fill(0); this._springInit = true; }
    const nSub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / nSub;
    for (let k = 0; k < nSub; k++) {
      for (let i = 0; i < CH.N; i++) {
        if (SK[i] === 0) continue;
        const kk = SK[i] * deadK + (1 - deadK) * 300;
        Vv[i] += (kk * (p[i] - X[i]) - SD[i] * Vv[i] + F[i] * deadK) * h;
        X[i] += Vv[i] * h;
      }
    }
    for (let i = 0; i < CH.N; i++) if (SK[i] === 0) X[i] = p[i];
    // whole-body squash, head squash and belly jiggle
    const sy = st.squash.step(dt, p[CH.squash], -SK[CH.chest] * 0.0012 * tk.pelvis.a.y * (1 - st.dead));
    st.squash.x = clamp(st.squash.x, 0.55, 1.45);
    const hsq = clamp(st.headSq.step(dt, 1, -220 * 0.0016 * aC.y * (1 - st.dead)), 0.75, 1.25);
    const jig = clamp(st.jig.step(dt, 0, 170 * 0.0028 * Math.hypot(aC.x, aC.z) * Math.sign(aC.z || 1)), -0.12, 0.12);

    // ---- apply to bones
    this.R.reset();
    b.pelvis.position.set(X[CH.pelvisPos], X[CH.pelvisPos + 1], X[CH.pelvisPos + 2]);
    b.pelvis.rotation.set(X[CH.pelvis], X[CH.pelvis + 1], X[CH.pelvis + 2]);
    const sxz = 1 / Math.sqrt(Math.max(0.5, st.squash.x));
    b.body.scale.set(sxz * (1 + jig * 0.5), st.squash.x, sxz * (1 - jig));
    b.chest.position.y = D.chestY * st.squash.x;
    b.chest.rotation.set(X[CH.chest], X[CH.chest + 1], X[CH.chest + 2]);
    b.head.rotation.set(X[CH.head], X[CH.head + 1], X[CH.head + 2]);
    const hxz = 1 / Math.sqrt(hsq);
    b.head.scale.set(hxz, hsq, hxz);
    b.head.position.y = D.headY + (st.squash.x - 1) * 0.06;
    for (const S of ['L', 'R']) {
      for (const n of ['hip', 'kn', 'an', 'sh', 'el', 'wr']) { const i = CH[n + S]; b[n + S].rotation.set(X[i], X[i + 1], X[i + 2]); }
    }
    const fing = st.finger.step(dt, E.point > 0.5 ? 1 : 0);
    b.fiR.scale.setScalar(clamp(fing, 0.001, 1.25));
    b.fiL.scale.setScalar(0.001);

    this._faceApply(dt, st, t);
    if (this.fpHidden) b.head.scale.setScalar(0.0001);

    if (this.spinBone) { st.spin += dt * (4 + st.speed * 9 + st.air * 20); this.spinBone.rotation.y = st.spin; }
    if (this.haloBone) { this.haloBone.position.y += Math.sin(t * 2.2) * 0.012; this.haloBone.rotation.y = t * 0.6; }
    if (this.flameBone) { const f = (0.35 + st.air * 0.9 + st.sprint * 0.3) * (1 - st.dead) * (0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31)); this.flameBone.scale.set(1, Math.max(0.001, f), 1); }

    this.rigRoot.updateMatrixWorld(true);
    for (const w of this.wobbles) w.update(dt);

    if (this.hose.mesh.visible) {
      this.hoseStart.parent.updateMatrixWorld(true);
      this.hoseEnd.parent.updateMatrixWorld(true);
      const p0 = this.hoseStart.getWorldPosition(new THREE.Vector3()), p3 = this.hoseEnd.getWorldPosition(new THREE.Vector3());
      const t0 = this.hoseStartDir.clone().transformDirection(this.hoseStart.parent.matrixWorld);
      const t3 = this.hoseEndDir.clone().transformDirection(this.hoseEnd.parent.matrixWorld);
      this.rigRoot.worldToLocal(p0); this.rigRoot.worldToLocal(p3);
      _m1.copy(this.rigRoot.matrixWorld).invert();
      t0.transformDirection(_m1); t3.transformDirection(_m1);
      this.hose.update(dt, p0, t0, p3, t3);
    }
  }

  _legs(p, st, walk, strideLen, grounded, vy, t) {
    const inv = _q2.setFromEuler(_e1.set(p[CH.pelvis], p[CH.pelvis + 1], p[CH.pelvis + 2], 'ZXY')).invert();
    const half = strideLen * 0.5;
    const dance = st.emote.dance;
    for (const [S, side, off] of [['L', -1, 0], ['R', 1, 0.5]]) {
      const pp = (st.phase + off) % 1;
      let f, lift;
      if (pp < 0.5) { f = lerp(0.5, -0.5, pp / 0.5); lift = 0; } else { const u = (pp - 0.5) / 0.5; f = lerp(-0.5, 0.5, smooth(u)); lift = Math.sin(u * PI); }
      const lim = S === 'L' ? 1 - st.limp * 0.5 : 1;
      const travel = f * half * walk * lim;
      const stepLift = Math.max(walk, dance) * lift * (0.055 + 0.04 * st.sprint) * (S === 'L' ? 1 - st.limp * 0.6 : 1);
      const fx = side * D.hipX * (1 + st.crouch * 0.25) + st.mx * travel;
      let fz = -st.my * travel, fy = D.ankleH + stepLift;
      if (st.air > 0.001) { fy += st.air * (0.075 + 0.025 * Math.sin(t * 9 + off * 6)); fz -= st.air * 0.03; }
      _v1.set(fx - p[CH.pelvisPos], fy - p[CH.pelvisPos + 1], fz - p[CH.pelvisPos + 2]).applyQuaternion(inv);
      _v1.x -= side * D.hipX;
      const r = ik2(_v1, D.thigh, D.shin, true, this._ik);
      set3(p, CH['hip' + S], r[0], 0, r[1]);
      set3(p, CH['kn' + S], r[2], 0, 0);
      const toe = lift * 0.35 * walk - (pp < 0.5 ? smooth(clamp((pp - 0.3) / 0.2, 0, 1)) * 0.25 * walk : 0);
      set3(p, CH['an' + S], -(r[0] + r[2]) - p[CH.pelvis] + toe + st.air * 0.3, 0, -r[1] - p[CH.pelvis + 2]);
    }
  }
  _armIK(S, target, w, p) {
    const s = S === 'L' ? -1 : 1;
    _v3.copy(target).sub(_v2.set(s * D.shX, D.shY, 0));
    const r = ik2(_v3, D.upper, D.fore + D.handLen, false, this._ik);
    mix3(p, CH['sh' + S], r[0], 0, r[1], w);
    mix3(p, CH['el' + S], r[2], 0, 0, w);
    mix3(p, CH['wr' + S], 0.1, 0, 0, w);
  }
  _emoteWave(p, w, t) {
    mix3(p, CH.shR, 0.15, 0, 2.6 + Math.sin(t * 2.5) * 0.08, w);
    mix3(p, CH.elR, 0.25, 0, 0.6 * Math.sin(t * 9), w);
    mix3(p, CH.wrR, 0, 0, 0.3 * Math.sin(t * 9 - 0.8), w);
    add3(p, CH.head, 0.06 * w, -0.12 * w, -0.2 * w);
    add3(p, CH.chest, 0, -0.08 * w, -0.06 * w + Math.sin(t * 4.5) * 0.03 * w);
    mix3(p, CH.shL, 0.05, 0, -0.5, w);
  }
  _emoteDance(p, w, t) {
    const beat = t * TAU * 1.05, bounce = Math.abs(Math.sin(beat));
    p[CH.pelvisPos + 1] += (bounce * 0.04 - 0.02) * w;
    add3(p, CH.pelvis, 0, Math.sin(beat * 0.5) * 0.4 * w, Math.sin(beat) * 0.14 * w);
    p[CH.squash] += (bounce - 0.5) * 0.09 * w;
    const up = Math.sin(beat * 0.5);
    mix3(p, CH.shL, 0.3, 0, -(1.4 + up * 1.2), w);
    mix3(p, CH.shR, 0.3, 0, 1.4 - up * 1.2, w);
    mix3(p, CH.elL, 0.2, 0, -0.6 - up * 0.3, w);
    mix3(p, CH.elR, 0.2, 0, 0.6 - up * 0.3, w);
    add3(p, CH.head, Math.sin(beat) * 0.12 * w, Math.sin(beat * 0.5) * 0.25 * w, Math.sin(beat * 0.5 + 1) * 0.22 * w);
    add3(p, CH.chest, 0, -Math.sin(beat * 0.5) * 0.18 * w, 0);
  }
  _emotePoint(p, w) {
    mix3(p, CH.shR, 1.45 + this.st.pitch * 0.7, 0, 0.12, w);
    mix3(p, CH.elR, 0.05, 0, 0, w);
    mix3(p, CH.wrR, 0, 0, 0, w);
    add3(p, CH.chest, 0, -0.18 * w, 0);
    add3(p, CH.head, 0, 0.1 * w, 0);
    mix3(p, CH.shL, -0.1, 0, -0.45, w);
  }
  _emoteSit(p, w, sleep, t) {
    const br = Math.sin(t * (sleep > 0.5 ? 1.2 : 2.2));
    mix3(p, CH.pelvisPos, 0, 0.11, 0.02, w);
    mix3(p, CH.pelvis, 0.12 + sleep * 0.05, 0, 0, w);
    p[CH.squash] = lerp(p[CH.squash], 0.96 + br * (sleep > 0.5 ? 0.035 : 0.015), w);
    for (const [S, s] of [['L', -1], ['R', 1]]) {
      mix3(p, CH['hip' + S], 1.5, 0, s * 0.25, w);
      mix3(p, CH['kn' + S], -0.12, 0, 0, w);
      mix3(p, CH['an' + S], -1.15 - 0.15 * sleep, 0, -s * 0.15, w);
      mix3(p, CH['sh' + S], 0.35 - sleep * 0.2, 0, s * 0.62, w);
      mix3(p, CH['el' + S], 0.25, 0, s * 0.1, w);
    }
    mix3(p, CH.chest, -0.05 - sleep * 0.22, 0, 0, w);
    if (sleep > 0.001) mix3(p, CH.head, -0.42 + br * 0.04, 0.1, 0.34, sleep);
  }
  _poseDead(p, w) {
    const k = 1 - Math.pow(1 - w, 3);
    mix3(p, CH.pelvisPos, 0.12, 0.27, 0.0, k);
    mix3(p, CH.pelvis, 0.1, 0.3, -1.52, k);
    p[CH.squash] = lerp(p[CH.squash], 1, k);
    mix3(p, CH.chest, 0.15, 0, 0.1, k);
    mix3(p, CH.head, 0.2, 0.3, -0.35, k);
    mix3(p, CH.shL, 0.4, 0, -1.9, k); mix3(p, CH.elL, 0.6, 0, -0.2, k);
    mix3(p, CH.shR, -0.3, 0, 0.35, k); mix3(p, CH.elR, 0.4, 0, 0.1, k);
    mix3(p, CH.hipL, 0.55, 0, -0.25, k); mix3(p, CH.knL, -0.7, 0, 0, k); mix3(p, CH.anL, 0.2, 0, 0, k);
    mix3(p, CH.hipR, -0.15, 0, 0.1, k); mix3(p, CH.knR, -0.25, 0, 0, k); mix3(p, CH.anR, 0.1, 0, 0, k);
  }

  _faceTargets(dt, s, st, t) {
    const f = this.faceEntry, T = st.face;
    const dead = st.dead > 0.3;
    let expr = dead ? 'dead' : (s.expression || 'neutral');
    if (!dead && st.emote.sleep > 0.5) expr = 'sleepy';
    let eL = f.eyeSY ?? 1, eR = f.eyeSY ?? 1, eS = 1, brow = f.brow ?? 0, browRot = f.browRot ?? 0, blush = f.blush ?? 1, x = 0, tremble = 0, tilt = 0, nod = 0;
    let mouth = f.mouth || 'smile';
    switch (expr) {
      case 'happy': mouth = f.mouth === 'cat' ? 'cat' : f.mouth === 'gap' ? 'gap' : 'grin'; eL = eR = 0.5; brow = 0.009; browRot = -0.18; blush *= 1.3; tilt = Math.sin(t * 3.2) * 0.08; break;
      case 'scared': mouth = 'wobble'; eL = eR = 1.12; eS = 0.8; brow = 0.013; browRot = -0.55; tremble = 1; nod = -0.12; break;
      case 'hurt': mouth = 'grit'; eL = 0.2; eR = 0.8; brow = 0.004; browRot = -0.45; tremble = 0.35; tilt = 0.14; break;
      case 'sleepy': mouth = 'o'; eL = eR = 0.16; brow = -0.006; browRot = -0.05; nod = -0.12; tilt = 0.12; break;
      case 'dead': mouth = 'tongue'; x = 1; break;
      case 'shocked': mouth = 'O'; eL = eR = 1.15; eS = 1.4; brow = 0.022; browRot = -0.1; nod = 0.12; break;
    }
    if ((st.emote.dance > 0.5 || st.emote.wave > 0.5) && expr === 'neutral') { mouth = f.mouth === 'cat' ? 'cat' : 'grin'; eL = eR = 0.6; }
    if (!dead && expr !== 'sleepy' && st.talk > 0.08) {
      const lv = st.talk; mouth = lv < 0.3 ? 'talk1' : lv < 0.6 ? 'talk2' : 'talk3';
      nod += Math.sin(t * 13) * 0.04 * lv;
    }
    st.blinkT -= dt;
    if (st.blinkT <= 0 && !dead) {
      st.blinkDur = expr === 'sleepy' ? 0.35 : 0.13;
      st.blink = st.blinkDur;
      st.blinkT = (expr === 'sleepy' ? 1.6 : 2.0) + Math.random() * 3.4;
      if (Math.random() < 0.18) st.blinkT = 0.25;
    }
    let bl = 0;
    if (st.blink > 0) { st.blink -= dt; const u = 1 - st.blink / st.blinkDur; bl = clamp(u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6, 0, 1); }
    const k = 16;
    T.eyeL = damp(T.eyeL, eL, k, dt); T.eyeR = damp(T.eyeR, eR, k, dt); T.eyeS = damp(T.eyeS, eS, 18, dt);
    T.brow = damp(T.brow, brow, k, dt); T.browRot = damp(T.browRot, browRot, k, dt);
    T.blush = damp(T.blush, blush, 6, dt); T.x = damp(T.x, x, 10, dt);
    T.tilt = damp(T.tilt, tilt, 6, dt); T.nod = damp(T.nod, nod, 8, dt);
    T.bl = bl; T.mouth = mouth;
    st.tremble = damp(st.tremble, tremble, 6, dt);
  }
  _faceApply(dt, st, t) {
    const b = this.bones, T = st.face;
    const tr = st.tremble * 0.006;
    if (tr) { b.head.rotation.x += (Math.random() - 0.5) * tr * 3; b.head.rotation.z += (Math.random() - 0.5) * tr * 3; }
    const vis = T.x > 0.5 ? 0.0001 : 1;
    for (const [S, sgn] of [['L', -1], ['R', 1]]) {
      const sy = Math.max(0.06, (S === 'L' ? T.eyeL : T.eyeR) * (1 - 0.94 * T.bl));
      const es = T.eyeS * vis;
      b['eye' + S].scale.set(es * (1 + (1 - sy) * 0.15), es * sy, es);
      b['x' + S].scale.setScalar(T.x > 0.5 ? 1 : 0.0001);
      b['brow' + S].position.y += T.brow + st.tremble * 0.002 * Math.sin(t * 40);
      b['brow' + S].quaternion.multiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), -sgn * T.browRot));
      b['blush' + S].scale.setScalar(T.blush);
    }
    if (this.mouth && T.mouth !== st.mouthCell) { st.mouthCell = T.mouth; setMouthCell(this.mouth.material.map, T.mouth); }
  }
}

// ============================================================================
// Ragdoll pieces
// ============================================================================
export function buildRagdoll(cosmetics = DEFAULT_COSMETICS) {
  const cos = resolveCos(cosmetics);
  const R = makeAvatarRig();
  const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTexture(String(1000 + Math.floor(Math.random() * 8999))), roughness: 0.5 });
  const B = buildAvatarParts(R, cos, { dead: true, badgeMat });
  R.chunks = R.chunks.filter((c) => !(c.bone === 'fiL' || c.bone === 'fiR'));
  const shY = D.pelvisY + D.chestY + D.shY;
  const neckY = D.pelvisY + D.chestY + D.headY;
  const torsoC = new THREE.Vector3(0, D.pelvisY + 0.2, 0);
  const headC = new THREE.Vector3(0, neckY + HEAD.cy, 0);
  const armLen = D.upper + D.fore + D.handLen + 0.03;
  const armC = (s) => new THREE.Vector3(s * D.shX, shY - armLen / 2 + 0.03, 0);
  const legLen = D.pelvisY;
  const legC = (s) => new THREE.Vector3(s * D.hipX, legLen / 2, 0);
  const centers = { torso: torsoC, head: headC, armL: armC(-1), armR: armC(1), legL: legC(-1), legR: legC(1) };
  const partOf = (name) => {
    let bone = R.b[name];
    while (bone && bone.isBone) {
      const n = bone.name;
      if (n === 'head') return 'head';
      if (n === 'shL') return 'armL'; if (n === 'shR') return 'armR';
      if (n === 'hipL') return 'legL'; if (n === 'hipR') return 'legR';
      bone = bone.parent;
    }
    return 'torso';
  };
  const groups = R.buildStatic((key) => AM.get(key, cos), partOf, centers);
  // static hose stub from the tank
  const armOut = 0.12;
  const pose = {
    torso: torsoC.toArray(), head: headC.toArray(),
    armL: [-D.shX - armOut, centers.armL.y, 0], armR: [D.shX + armOut, centers.armR.y, 0],
    legL: centers.legL.toArray(), legR: centers.legR.toArray(),
  };
  const rel = (name, w) => [w[0] - pose[name][0], w[1] - pose[name][1], w[2] - pose[name][2]];
  const neck = [0, neckY, 0];
  const shL = [-D.shX - 0.04, shY, 0], shR = [D.shX + 0.04, shY, 0];
  const hipL = [-D.hipX, D.pelvisY - 0.04, 0], hipR = [D.hipX, D.pelvisY - 0.04, 0];
  const joints = [
    { a: 'torso', b: 'head', anchorA: rel('torso', neck), anchorB: rel('head', neck) },
    { a: 'torso', b: 'armL', anchorA: rel('torso', shL), anchorB: rel('armL', shL) },
    { a: 'torso', b: 'armR', anchorA: rel('torso', shR), anchorB: rel('armR', shR) },
    { a: 'torso', b: 'legL', anchorA: rel('torso', hipL), anchorB: rel('legL', hipL) },
    { a: 'torso', b: 'legR', anchorA: rel('torso', hipR), anchorB: rel('legR', hipR) },
  ];
  const parts = {
    torso: { mesh: groups.torso, half: [0.29, 0.31, 0.27] },
    head: { mesh: groups.head, radius: 0.235 },
    armL: { mesh: groups.armL, radius: D.armR, halfHeight: Math.max(0.02, armLen / 2 - D.armR) },
    armR: { mesh: groups.armR, radius: D.armR, halfHeight: Math.max(0.02, armLen / 2 - D.armR) },
    legL: { mesh: groups.legL, radius: 0.075, halfHeight: Math.max(0.02, legLen / 2 - 0.075) },
    legR: { mesh: groups.legR, radius: 0.075, halfHeight: Math.max(0.02, legLen / 2 - 0.075) },
  };
  for (const k in parts) parts[k].mesh.name = 'ragdoll_' + k;
  return { parts, joints, pose };
}

// ============================================================================
// First-person viewmodel arms
// ============================================================================
export function buildFirstPersonArms(cosmetics = DEFAULT_COSMETICS, opts = {}) {
  const cos = resolveCos(cosmetics);
  const o = outfitSpec(cos.suitEntry);
  const R = new Rig();
  const L = 0.34, AR = o.short ? 0.05 : (o.jacket ? 0.064 : 0.058);
  const root = new THREE.Group(); root.name = 'FPArms';
  const W = 0xffffff;
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    R.bone('fore' + S, null, [s * 0.3, -0.4, -0.1]);
    R.bone('wr' + S, 'fore' + S, [0, 0, -L]);
    R.bone('fing' + S, 'wr' + S, [0, 0.006, -0.045]);
    R.bone('thumb' + S, 'wr' + S, [-s * 0.044, 0.006, -0.02]);
    const along = (g) => G.xf(g, null, [PI / 2, 0, 0]);
    if (o.short) {
      R.add('fore' + S, 'skin', G.uv(along(G.capY(AR, 0.1, -L + 0.012, 5, 18)), 0.32, 0.45), W);
      R.add('fore' + S, o.sleeve, G.uv(along(G.capY(0.066, 0.16, -0.03, 4, 18)), 0.45, 0.2), W);
      R.add('fore' + S, o.sleeve, G.xf(G.torus(0.064, 0.009, 6, 20), [0, 0, -0.035]), 0xe8e8e8);
    } else {
      R.add('fore' + S, o.sleeve, G.uv(along(G.capY(AR, 0.1, -L + 0.015, 5, 20)), 0.4, 0.45), W);
      R.add('fore' + S, o.sleeve, G.xf(G.torus(AR - 0.002, 0.006, 6, 22), [0, 0, -L * 0.45]), 0xb8b8b8);
      R.add('fore' + S, o.sleeve, G.xf(G.lathe([[AR * 0.86, 0.0], [AR * 1.03, -0.004], [AR * 1.05, -0.03], [AR * 0.86, -0.034]], 20), [0, 0, -L + 0.034], [PI / 2, 0, 0]), 0xc8c8c8);
      if (o.stripes) R.add('fore' + S, 'reflect', G.xf(G.lathe([[AR - 0.002, -0.013], [AR + 0.004, -0.01], [AR + 0.004, 0.01], [AR - 0.002, 0.013]], 22), [0, 0, -L + 0.12], [PI / 2, 0, 0]), W);
    }
    // mitten (sack)
    // mitten body (poles along the hand axis so the burlap UVs don't pinch on the back of the hand)
    R.add('wr' + S, 'skin', G.uv(G.xf(G.ell(0.052, 0.05, 0.036, 18, 12), [0, -0.003, -0.036], [PI / 2, 0, 0]), 0.3, 0.15), W);
    R.add('fing' + S, 'skin', G.uv(G.xf(G.ell(0.05, 0.048, 0.031, 18, 12), [0, -0.004, -0.03], [PI / 2, 0, 0]), 0.3, 0.12), W);
    R.add('thumb' + S, 'skin', G.uv(G.xf(G.capY(0.019, 0, -0.04, 4, 12), [0, 0, 0], [PI / 2 - 0.3, 0, s * 0.6]), 0.12, 0.06), W);
  }
  // watch on the left forearm (top side, +Y)
  const WZ = -L + 0.075, WY = AR + 0.016;
  R.add('foreL', 'trim', G.xf(G.torus(AR + 0.003, 0.011, 6, 26), [0, 0, WZ]), 0x232326);
  R.add('foreL', 'trim', G.xf(G.rbox(0.078, 0.026, 0.066, 0.01), [0, WY - 0.004, WZ]), 0x26262a);
  R.add('foreL', 'metal', G.xf(G.rbox(0.082, 0.008, 0.07, 0.004), [0, WY + 0.008, WZ]), 0x8e9298);
  for (const z of [-0.022, 0.022]) R.add('foreL', 'metal', G.xf(G.cyl(0.005, 0.005, 0.012, 8), [0.043, WY - 0.002, WZ + z], [0, 0, PI / 2]), 0xd0d0d0);
  R.add('foreL', 'gloss', G.xf(G.box(0.07, 0.004, 0.006), [0, WY + 0.0125, WZ - 0.03]), 0x111111);
  const screenTex = labelTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#0c1a10'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#62ff8e'; ctx.font = "96px 'VT323', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('03:33', w / 2, h / 2 + 6);
  });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, map: screenTex, emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.0, roughness: 0.25 });
  const watchScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.045), screenMat);
  watchScreen.name = 'watchScreen';
  watchScreen.position.set(0, WY + 0.0126, WZ);
  watchScreen.rotation.set(-PI / 2, 0, PI / 2);
  R.attach('foreL', watchScreen);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.047), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, roughness: 0.08, clearcoat: 0.6, envMapIntensity: 0.8, depthWrite: false }));
  glass.position.set(0, WY + 0.0135, WZ); glass.rotation.copy(watchScreen.rotation);
  R.attach('foreL', glass);
  const built = R.build((key) => AM.get(key, cos), { shadow: false, bounds: new THREE.Sphere(new THREE.Vector3(0, -0.2, -0.3), 1.5) });
  for (const m of built.meshes) { m.frustumCulled = false; root.add(m); }
  for (const bn of ['foreL', 'foreR']) root.add(R.b[bn]);
  for (const ex of R.extras) R.b[ex.bone].add(ex.obj);
  const rightHand = new THREE.Object3D(); rightHand.name = 'rightHand';
  const leftHand = new THREE.Object3D(); leftHand.name = 'leftHand';
  R.b.wrR.add(rightHand); R.b.wrL.add(leftHand);
  if (opts.light) {
    root.add(new THREE.HemisphereLight(0xfff4dc, 0x40382a, 1.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(0.5, 1, 0.6); root.add(dl);
  }

  // pose library (camera space): h = wrist, d = forearm direction, u = forearm top (watch side)
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
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
  POSE.watch = { h: Wc.clone().addScaledVector(wd, L + WZ).sub(wu.clone().multiplyScalar(WY + 0.0126)), d: wd, u: wu };
  const _B = new THREE.Matrix4();
  function placeArm(S, h, d, u) {
    const fore = R.b['fore' + S];
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
    const wq = R.b.wrR.getWorldQuaternion(new THREE.Quaternion());
    rightHand.quaternion.copy(wq).invert(); rightHand.position.set(0, -0.012, -0.045);
    leftHand.quaternion.copy(rightHand.quaternion); leftHand.position.set(0, -0.012, -0.045);
  }
  // floppy lag: each wrist position follows its pose target through a 3D spring
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
    // right
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
    // left
    tmp.h.copy(POSE.L.h); tmp.d.copy(POSE.L.d); tmp.u.copy(POSE.L.u);
    blendPose(tmp, POSE.watch, smooth(w.watch));
    const ww = 1 - w.watch * 0.85;
    tmp.h.x += (bobX + st.sway.x) * ww; tmp.h.y += (bobY + st.sway.y - land * 0.05) * ww + Math.sin(st.t * 1.6 + 1) * 0.004 * ww - Math.sin(ph) * 0.035 * run * ww;
    tmp.h.z -= Math.cos(ph) * 0.05 * run * ww;
    tmp.h.y -= (w.thr * 0.08 + w.use * 0.06) * (1 - w.watch);
    placeArm('L', stepSpring(st.sL, tmp.h, dt, lerp(140, 260, w.watch), lerp(0.45, 0.8, w.watch)), tmp.d, tmp.u);
    const curl = clamp(w.hold * 0.9 + w.use * 0.5 - w.grab * 0.6 + w.thr * 0.6, -0.5, 1);
    st.curl = damp(st.curl, curl, 12, dt);
    R.b.fingR.rotation.x = -st.curl * 1.3;
    R.b.thumbR.rotation.z = (w.grab * 0.5) - st.curl * 0.2;
    R.b.fingL.rotation.x = -0.25 - w.watch * 0.1;
    R.b.wrR.rotation.set(-0.15 * w.grab + 0.1 * w.hold, 0, 0);
    R.b.wrL.rotation.set(-0.1 * w.watch, 0, 0);
  }
  update(0, {});
  return { root, rightHand, leftHand, watchScreen, update, dispose() { for (const m of built.meshes) m.geometry.dispose(); built.skeleton.dispose(); screenTex.dispose(); screenMat.dispose(); } };
}
