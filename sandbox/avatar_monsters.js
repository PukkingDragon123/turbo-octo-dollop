// Still Life lineup. URL extras: &v=watcher (single) &alert=1 &attack=1 &move=1
import { buildStillLife, STILL_LIFE_VARIANTS } from '../src/entities/stilllife_model.js';

export default async function (ctx) {
  const { THREE, scene, engine, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  engine.post.params.uGrain.value = 0.015; engine.post.params.uVignette.value = 0.25; engine.post.params.uAberration.value = 0;
  engine.renderer.toneMappingExposure = +(q.get('exp') ?? 0.7);
  window.__cam = (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); };
  const list = q.get('v') ? [q.get('v')] : STILL_LIFE_VARIANTS;
  const mons = [];
  const target = new THREE.Object3D(); target.position.set(0, 1.2, 4); scene.add(target);
  list.forEach((v, i) => {
    const m = buildStillLife(v, 1 + i);
    const x = (i - (list.length - 1) / 2) * 1.6;
    m.root.position.set(x, 0, 0); m.root.rotation.y = Math.PI;
    scene.add(m.root);
    mons.push({ m, v, x, i });
  });
  window.__state = { alert: +(q.get('alert') ?? 0), attacking: +(q.get('attack') ?? 0), moving: q.get('move') === '1', speed: 1 };
  let tt = 0;
  const step = (dt) => {
    tt += dt;
    for (const o of mons) {
      const s = { ...window.__state, lookTarget: target.position };
      if (s.moving && (o.v === 'crawler')) { const a = tt * 0.6 + o.i; o.m.root.position.set(o.x + Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); o.m.root.rotation.y = -a + Math.PI; }
      o.m.update(dt, s);
    }
  };
  window.__advance = (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); };
  window.__advance(+(q.get('adv') ?? 1));
  window.__mons = mons;
  return { update(dt) { step(dt); } };
}
