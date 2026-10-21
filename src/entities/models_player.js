// R.O.O.M. — small procedural models for the player & combat systems (auto-registered by catalog.js):
//   wheel           caster wheel (rubber tyre, steel hub, axle along local X): weld it onto a board for a cart
//   plasma_syringe  glass barrel of glowing green plasma for the mechanical heart (points along -Z)
import * as THREE from 'three';

const PI = Math.PI;
const mats = {};
function M(key, o) { return (mats[key] ||= new THREE.MeshStandardMaterial(o)); }

function mesh(geo, mat, parent, pos, rot) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}

function wheel() {
  const object = new THREE.Group();
  const R = 0.11, W = 0.06;
  const rubber = M('wheel_rubber', { color: 0x1d1d1f, roughness: 0.92, metalness: 0 });
  const steel = M('wheel_steel', { color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 });
  const orange = M('wheel_hub', { color: 0xd8701c, roughness: 0.5, metalness: 0.1 });
  // tyre: a lathe profile swept round the X axle (rounded shoulders, tread grooves)
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const a = -PI / 2 + (i / 12) * PI;
    prof.push(new THREE.Vector2(R - 0.026 + Math.cos(a) * 0.026, Math.sin(a) * W * 0.5));
  }
  const tyre = new THREE.LatheGeometry(prof, 32).rotateZ(PI / 2);
  mesh(tyre, rubber, object);
  for (let i = 0; i < 3; i++) mesh(new THREE.TorusGeometry(R + 0.0005, 0.0035, 4, 32).rotateY(PI / 2), rubber, object, [(i - 1) * 0.017, 0, 0]);
  // hub disc, spokes, axle + nuts
  mesh(new THREE.CylinderGeometry(R - 0.03, R - 0.03, W * 0.7, 24).rotateZ(PI / 2), orange, object);
  for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(W * 0.75, 0.012, R * 1.2), steel, object, null, [i * (PI / 5), 0, 0]);
  mesh(new THREE.CylinderGeometry(0.012, 0.012, W * 1.5, 12).rotateZ(PI / 2), steel, object);
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 6).rotateZ(PI / 2), steel, object, [s * W * 0.72, 0, 0]);
  return {
    object, mass: 1.2, material: 'rubber', halfHeight: R, friction: 1.4, restitution: 0.15, angularDamping: 0.05,
    colliders: [{ type: 'cylinder', radius: R, height: W, pos: [0, 0, 0], rot: [0, 0, PI / 2] }],
    hold: { pos: [0, -0.03, -0.07], rot: [0, 0, 0] },
  };
}

function plasmaSyringe() {
  const object = new THREE.Group();
  const glass = M('syr_glass', { color: 0xd8f0e8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
  const plasma = M('syr_plasma', { color: 0x3cff6a, emissive: 0x2dff5a, emissiveIntensity: 1.6, roughness: 0.2 });
  const steel = M('syr_steel', { color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 });
  const brass = M('syr_brass', { color: 0xc8963c, roughness: 0.35, metalness: 0.85 });
  const L = 0.11, r = 0.013;
  mesh(new THREE.CylinderGeometry(r, r, L, 16, 1, true).rotateX(PI / 2), glass, object);
  const liquid = mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, L * 0.8, 14).rotateX(PI / 2), plasma, object, [0, 0, -L * 0.08]);
  liquid.name = 'plasma';
  for (const z of [-L / 2, L / 2]) mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.008, 16).rotateX(PI / 2), brass, object, [0, 0, z]);
  // needle (front, -Z), plunger rod + thumb plate + finger flange (back, +Z)
  mesh(new THREE.CylinderGeometry(0.0016, 0.001, 0.05, 6).rotateX(PI / 2), steel, object, [0, 0, -L / 2 - 0.027]);
  mesh(new THREE.CylinderGeometry(0.005, 0.0035, 0.012, 10).rotateX(PI / 2), brass, object, [0, 0, -L / 2 - 0.008]);
  mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 8).rotateX(PI / 2), steel, object, [0, 0, L / 2 + 0.022]);
  mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.004, 14).rotateX(PI / 2), steel, object, [0, 0, L / 2 + 0.048]);
  mesh(new THREE.BoxGeometry(0.05, 0.006, 0.006), brass, object, [0, 0, L / 2 + 0.004]);
  return {
    object, mass: 0.15, material: 'glass', halfHeight: 0.016,
    colliders: [{ type: 'box', size: [0.05, 0.03, 0.2], pos: [0, 0, 0] }],
    hold: { pos: [0, -0.01, -0.06], rot: [0, 0, 0] },
  };
}

export const ITEMS = { wheel, plasma_syringe: plasmaSyringe };
