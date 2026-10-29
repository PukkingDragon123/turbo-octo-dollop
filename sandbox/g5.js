// scratch viewer (model quality pass): /sandbox/?m=g5&s=crusher|kiosks|camp|bio
import * as THREE from 'three';
import { Crusher } from '../src/game/crusher.js';
import { ShopKiosk, QuestKiosk } from '../src/game/terminals.js';
import { buildModel } from '../src/entities/catalog.js';

export default async function (ctx) {
  const { scene, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  const s = q.get('s') || 'crusher';
  const phys = { addStaticCollidersFromDesc: () => ({ colliders: [], body: null }), addStaticBox: () => null, removeCollider() {}, removeBody() {} };
  const world = { physics: phys, group: scene, game: { local: { pos: new THREE.Vector3() }, terminal: {} }, props: { query() {} }, registerDynamic() {} };
  const mission = { econ: null, padsOnline: true };
  const ups = [];
  const t0 = performance.now();
  if (s === 'crusher') {
    const c = new Crusher(world, mission, 0, 0, -2.5, 0); scene.add(c.root); ups.push(c);
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2); sun.position.set(4, 7, 6); scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xfff4d0, 0x40382a, 1.2));
  } else if (s === 'repair') {
    const { RepairGame } = await import('../src/game/repairgame.js');
    const rg = new RepairGame({ local: {}, ui: {}, state: 'playing', world: {} });
    rg.open({ seed: 1979 });
    ups.push({ update: (dt) => rg.update(dt) });
  } else if (s === 'kiosks') {
    const a = new ShopKiosk(world, mission, -0.9, 0, -1, 0); scene.add(a.root);
    const b = new QuestKiosk(world, mission, 0.9, 0, -1, 0); scene.add(b.root);
  } else {
    const names = (q.get('n') || (s === 'camp' ? 'camp_kit,camp_pole,camp_canvas,camp_stakes,camp_lamp' : 'camp_stove,supply_box,board,sleeping_bag')).split(',');
    let x = -((names.length - 1) * 0.8) / 2;
    for (const n of names) {
      const m = buildModel(n, { seed: 1 });
      m.object.position.set(x, m.halfHeight ?? 0, 0);
      if (n === 'camp_pole') m.object.rotation.y = 0.5;
      m.object.userData.setLit?.(true);
      scene.add(m.object);
      x += 0.8 + (n === 'camp_kit' ? 0.4 : 0);
    }
  }
  console.log('build ms', (performance.now() - t0).toFixed(0));
  scene.traverse((o) => { const st = o.userData?.stats; if (st && o.userData.device) console.log('stats', o.name, JSON.stringify({ tris: st.tris, draws: st.draws, build: st.buildMs, ao: st.aoMs, pack: st.packMs, atlas: st.atlas, prof: (st.prof || []).slice(0, 14) })); });
  if (!q.has('cam')) { camera.position.set(2.2, 2.2, 3.6); controls.target.set(0, 1.4, -1.8); controls.update(); }
  return { update(dt) { for (const u of ups) { try { if (u.update && !u.root) u.update(dt); else u.t = (u.t || 0) + dt; } catch (e) { console.warn(String(e)); } } } };
}
