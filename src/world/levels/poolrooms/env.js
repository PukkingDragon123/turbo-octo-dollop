// Image-based lighting for the Poolrooms: a bright white-tiled hall with flush ceiling lights,
// two blown-out skylights and a turquoise pool floor. Gives glazed tiles, chrome and wet decks
// believable reflections. Generated once with PMREM and cached.
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';

let cached = null;

export function poolEnvironment() {
  if (cached) return cached;
  const env = new THREE.Scene();
  const basic = (hex, k, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side });
  // hall shell (walls slightly cyan-white, darker lower band like wet tiles)
  const room = new THREE.Mesh(new THREE.BoxGeometry(18, 4.4, 18), basic(0xe6eff0, 1.05, THREE.BackSide));
  room.position.y = 1.2;
  env.add(room);
  const band = new THREE.Mesh(new THREE.BoxGeometry(17.9, 0.9, 17.9), basic(0xbfd2d4, 0.8, THREE.BackSide));
  band.position.y = -0.55;
  env.add(band);
  // water: turquoise floor with a darker deep end
  const water = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), basic(0x5fb6c2, 0.75));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.98, -1);
  env.add(water);
  const deep = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), basic(0x2f7f98, 0.6));
  deep.rotation.x = -Math.PI / 2;
  deep.position.set(3.5, -0.975, -1);
  env.add(deep);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), basic(0xd9dedb, 0.85));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.99;
  env.add(deck);
  // flush square lights
  const panel = basic(0xf4fbff, 4.2, THREE.DoubleSide);
  const geo = new THREE.PlaneGeometry(0.7, 0.7);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const m = new THREE.Mesh(geo, panel);
    m.rotation.x = Math.PI / 2;
    m.position.set(-6 + i * 3, 3.38, -6 + j * 3);
    env.add(m);
  }
  // overexposed skylights
  const sky = basic(0xf2f8ff, 9.0, THREE.DoubleSide);
  for (const [x, z] of [[-3, 1.5], [3, -1.5]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), sky);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, 3.39, z);
    env.add(m);
  }
  // a couple of glowing portholes on the walls
  const port = basic(0xeef6ff, 5.0, THREE.DoubleSide);
  for (const [x, z, ry] of [[-8.95, -2, Math.PI / 2], [8.95, 3, -Math.PI / 2], [2, -8.95, 0]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), port);
    m.position.set(x, 2.2, z);
    m.rotation.y = ry;
    env.add(m);
  }
  cached = engine.pmrem.fromScene(env, 0.035).texture;
  env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  return cached;
}
