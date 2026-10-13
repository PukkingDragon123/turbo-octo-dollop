// Resolves character/creature builders from their modules via import.meta.glob, with simple
// fallbacks so the game still runs if a model module fails to load.
import * as THREE from 'three';

const mods = import.meta.glob(['./stilllife_model.js', './healthity_model.js', './clone_models.js', './critter_models.js'], { eager: true });
const all = Object.assign({}, ...Object.values(mods));

function blob(color, h = 1.2, r = 0.3) {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h - r * 2, 6, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.y = h / 2;
  m.castShadow = true;
  root.add(m);
  return root;
}

export const buildStillLife = all.buildStillLife || ((variant) => {
  const root = blob(0xc8a878, variant === 'tall' ? 2.3 : 1.2);
  return { root, update() {}, height: variant === 'tall' ? 2.3 : 1.2, radius: 0.3 };
});
export const STILL_LIFE_VARIANTS = all.STILL_LIFE_VARIANTS || ['watcher', 'crawler', 'twin', 'mass', 'tall'];

export const buildHealthity = all.buildHealthity || (() => {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe8fff4, roughness: 0.3 }));
  root.add(m);
  return { root, setFace() {}, setTalking() {}, update() {} };
});

export const buildUnfinishedClone = all.buildUnfinishedClone || ((stage) => ({ root: blob(0xd8b090, 1.1, 0.25 + stage * 0.02), update() {} }));
export const buildReceptionist = all.buildReceptionist || (() => ({ root: blob(0xd8c0a0, 1.2), update() {} }));

export const buildRat = all.buildRat || (() => {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a4a3a }));
  m.scale.set(1, 0.8, 2);
  m.position.y = 0.05;
  root.add(m);
  return { root, update() {} };
});
export const buildCockroach = all.buildCockroach || (() => {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a2010 }));
  m.scale.set(1, 0.5, 2);
  m.position.y = 0.01;
  root.add(m);
  return { root, update() {} };
});
export const buildFish = all.buildFish || ((kind) => {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: kind === 'goldfish' ? 0xff8a20 : 0x3a8aff }));
  m.scale.set(0.5, 1, 1.6);
  root.add(m);
  return { root, update() {} };
});
