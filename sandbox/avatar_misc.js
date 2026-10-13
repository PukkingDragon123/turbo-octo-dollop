// Healthity faces, unfinished clones (in mock tubes) and the receptionist.
// URL: &set=healthity|clones|reception
import { buildHealthity, HEALTHITY_FACES } from '../src/entities/healthity_model.js';
import { buildUnfinishedClone, buildReceptionist, RECEPTIONIST } from '../src/entities/clone_models.js';

export default async function (ctx) {
  const { THREE, scene, engine, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  const set = q.get('set') || 'healthity';
  engine.post.params.uGrain.value = 0.015; engine.post.params.uVignette.value = 0.25; engine.post.params.uAberration.value = 0;
  engine.renderer.toneMappingExposure = +(q.get('exp') ?? 0.7);
  window.__cam = (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); };
  const ups = [];
  if (set === 'healthity') {
    const faces = (q.get('faces') || HEALTHITY_FACES.join(',')).split(',');
    faces.forEach((f, i) => {
      const h = buildHealthity();
      const col = i % 5, row = Math.floor(i / 5);
      h.root.position.set((col - 2) * 0.42, 1.45 - row * 0.45, 0);
      h.root.rotation.y = Math.PI;
      h.setFace(f);
      if (f === 'neutral') h.setTalking(true);
      scene.add(h.root);
      ups.push((dt) => h.update(dt));
    });
  } else if (set === 'clones') {
    for (let s = 0; s < 4; s++) {
      const c = buildUnfinishedClone(s, s + 1);
      const x = (s - 1.5) * 1.0;
      c.root.position.set(x, 0.25, 0); c.root.rotation.y = Math.PI;
      scene.add(c.root);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.2, 32, 1, true), new THREE.MeshPhysicalMaterial({ color: 0x9fe8d0, transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
      tube.position.set(x, 1.2, 0); scene.add(tube);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.8, roughness: 0.4 }));
      base.position.set(x, 0.1, 0); scene.add(base);
      let t = 0; ups.push((dt) => { t += dt; c.update(dt, t); });
    }
  } else if (set === 'reception') {
    const r = buildReceptionist();
    r.root.rotation.y = Math.PI;
    scene.add(r.root);
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a3f5a }));
    chair.position.set(0, RECEPTIONIST.seatHeight - 0.03, 0); scene.add(chair);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: 0xb89a70 }));
    desk.position.set(0, RECEPTIONIST.deskHeight - 0.02, -(RECEPTIONIST.deskFrontZ - 0.3)); scene.add(desk);
    const target = new THREE.Vector3(1.5, 1.2, 2);
    window.__look = (x, y, z, snap) => { target.set(x, y, z); r.update(0.016, { lookTarget: target, snap }); };
    ups.push((dt) => r.update(dt, { lookTarget: target }));
  }
  const step = (dt) => { for (const u of ups) u(dt); };
  window.__advance = (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); };
  window.__advance(+(q.get('adv') ?? 1));
  return { update(dt) { step(dt); } };
}
