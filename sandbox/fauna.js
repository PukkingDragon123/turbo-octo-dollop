// Level 0 fauna + bio props viewer: mole, moth, damp crawler, fungal; meat / fungi / camp stove / camp gear.
//   /sandbox/?m=fauna&v=mole,moth,dcrawler,fungal&mode=<state>&move=1&speed=2&props=1&dead=1
import { buildFauna } from '../src/entities/monsters/fauna_models.js';
import { buildModel } from '../src/entities/catalog.js';

export default async function (ctx) {
  const { THREE, scene, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  window.__cam = (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); };
  const list = (q.get('v') || 'mole,moth,dcrawler,fungal').split(',').filter(Boolean);
  const mons = list.map((name, i) => {
    const m = buildFauna(name, 1 + i);
    const x = (i - (list.length - 1) / 2) * +(q.get('gap') ?? 1.5);
    m.root.position.set(x, name === 'moth' ? 1.2 : 0, 0);
    m.root.rotation.y = Math.PI * 0.8;
    scene.add(m.root);
    return { m, name, x, i };
  });
  if (q.get('props') === '1') {
    const types = ['mole_meat', 'mole_meat_cooked', 'crawler_meat', 'fungus_black', 'fungus_glow', 'fungus_shelf', 'fungus_puff', 'camp_stove', 'supply_box', 'sleeping_bag', 'tent_ruin', 'trolley_broken', 'board', 'note_scribble'];
    types.forEach((t, i) => {
      const md = buildModel(t, { seed: i });
      md.object.position.set(-3 + (i % 7) * 1.0, md.halfHeight ?? 0.1, 1.6 + Math.floor(i / 7) * 1.6);
      scene.add(md.object);
    });
  }
  const S = { mode: q.get('mode') || 'idle', moving: q.get('move') === '1', speed: +(q.get('speed') ?? 1.5), dead: q.get('dead') === '1', attackT: +(q.get('attack') ?? 0) };
  window.__state = S;
  let tt = 0;
  const step = (dt) => {
    tt += dt;
    for (const o of mons) {
      let sp = 0;
      if (S.moving) {
        const R = 0.9, a = tt * (S.speed / R) + o.i;
        o.m.root.position.x = o.x + Math.cos(a) * R;
        o.m.root.position.z = Math.sin(a) * R;
        o.m.root.rotation.y = -a + Math.PI;
        sp = S.speed;
      }
      o.m.update(dt, { speed: sp, state: S.mode, attackT: S.attackT, dead: S.dead });
    }
  };
  window.__advance = (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); };
  window.__advance(+(q.get('adv') ?? 1));
  return { update(dt) { if (q.get('pause') !== '1') step(dt); } };
}
