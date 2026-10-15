// New creature viewer: Hound, Partygoer (sculpted still-life pipeline) and the Smiler.
//   /sandbox/?m=creatures&v=hound&mode=chase&move=1&speed=5&adv=2
//   v=hound|partygoer|smiler|all   mode=<AI state label>   move=1 (runs a circle)   attack=1   dark=1 (lights off)
//   i=<0..1> intensity (smiler grin)   frozen=1
import { buildStillLife } from '../src/entities/stilllife_model.js';
import { buildSmiler } from '../src/entities/monsters/smiler.js';

export default async function (ctx) {
  const { THREE, scene, engine, camera, controls, room } = ctx;
  const q = new URLSearchParams(location.search);
  engine.post.params.uGrain.value = 0.01; engine.post.params.uVignette.value = 0.2; engine.post.params.uAberration && (engine.post.params.uAberration.value = 0);
  engine.renderer.toneMappingExposure = +(q.get('exp') ?? 0.75);
  if (q.get('dark') === '1') {
    room.traverse((o) => { if (o.isLight) o.intensity *= 0.04; });
    scene.traverse((o) => { if (o.isLight && !o.parent?.isScene === false) o.intensity *= 0.2; });
  }
  window.__cam = (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); };
  const v = q.get('v') || 'all';
  const list = v === 'all' ? ['hound', 'partygoer', 'smiler'] : v === 'still' ? ['watcher', 'crawler', 'twin', 'mass', 'tall'] : v.split(',');
  const mons = [];
  const target = new THREE.Object3D(); target.position.set(0, 1.4, 4); scene.add(target);
  list.forEach((name, i) => {
    const m = name === 'smiler' ? buildSmiler(1 + i) : buildStillLife(name, 1 + i);
    const x = (i - (list.length - 1) / 2) * +(q.get('gap') ?? 1.8);
    m.root.position.set(x, 0, 0);
    m.root.rotation.y = Math.PI * (q.get('turn') ? +q.get('turn') : 1);
    scene.add(m.root);
    mons.push({ m, name, x, i });
  });
  const speed = +(q.get('speed') ?? 3);
  window.__state = { mode: q.get('mode') || (v === 'hound' ? 'prowl' : v === 'smiler' ? 'lurk' : 'pose'), attacking: +(q.get('attack') ?? 0), moving: q.get('move') === '1', speed, intensity: +(q.get('i') ?? 0.4), frozen: q.get('frozen') === '1', alert: 0.6 };
  let tt = 0, atk = 0;
  const step = (dt) => {
    tt += dt;
    const S = window.__state;
    if (S.attackLoop) { atk = (atk + dt / 0.6) % 1.6; }
    for (const o of mons) {
      let sp = 0;
      if (S.moving) {
        const R = 1.6, w = S.speed / R, a = tt * w + o.i;
        o.m.root.position.set(o.x + Math.cos(a) * R, 0, Math.sin(a) * R);
        o.m.root.rotation.y = -a + Math.PI;
        sp = S.speed;
      }
      const st = { ...S, speed: sp, moving: sp > 0.1, lookTarget: target.position, state: S.mode, attacking: S.attackLoop ? Math.min(1, atk) : S.attacking };
      o.m.update(dt, st);
    }
  };
  window.__advance = (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); };
  window.__advance(+(q.get('adv') ?? 1));
  window.__mons = mons;
  return { update(dt) { if (q.get('pause') !== '1') step(dt); } };
}
