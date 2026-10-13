// Avatar lineup: different cosmetics + animation states.
// URL extras: &set=lineup|cos|states  &grain=0  &freeze=seconds (advance time then stop)
import { Avatar, COSMETICS, buildRagdoll } from '../src/entities/avatar.js';

export default async function (ctx) {
  const { THREE, scene, engine, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  window.__ctx = ctx;
  window.__cam = (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); };
  window.__chunkStats = (i = 0) => { const R = window.__avatars[i].a.R; const m = {}; for (const c of R.chunks) { const g = c.geo; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; const k = (typeof c.bone === 'string' ? c.bone : c.bone.name) + ':' + c.mat; m[k] = (m[k] || 0) + n; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + '=' + Math.round(v)).join(' '); };
  window.__stats = () => window.__avatars.map(({ a }) => { let calls = 0, tris = 0; a.root.traverse((o) => { if (o.isMesh && o.visible) { calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return [calls, Math.round(tris)]; });
  const set = q.get('set') || 'lineup';
  engine.post.params.uGrain.value = +(q.get('grain') ?? 0.015);
  engine.post.params.uVignette.value = 0.2;
  engine.post.params.uAberration.value = 0;
  engine.renderer.toneMappingExposure = +(q.get('exp') ?? 0.75);
  const avatars = [];
  const add = (cos, state, x, z = 0, yaw = Math.PI) => {
    const a = new Avatar(cos);
    a.root.position.set(x, 0, z);
    a.root.rotation.y = yaw;
    scene.add(a.root);
    avatars.push({ a, state });
    return a;
  };
  const V2 = THREE.Vector2;
  if (set === 'lineup') {
    add({ suit: 'yellow' }, { expression: 'neutral' }, 0);
    add({ suit: 'fleece', hat: 'bucket', accessory: 'fannypack', backpack: 'none' }, { speed: 1.4, moveDir: new V2(0, 1), expression: 'happy' }, -0.95);
    add({ suit: 'orange_hivis', hat: 'beanie', accessory: 'scarf', backpack: 'satchel' }, { emote: 'wave', expression: 'happy' }, 0.95);
    add({ suit: 'hawaiian', hat: 'party', visor: 'sunglasses', backpack: 'bear', skin: 'light' }, { emote: 'dance' }, -1.9);
    add({ suit: 'yellow', hat: 'hardhat', visor: 'gas_mask_up', skin: 'dark' }, { crouch: 1, speed: 0.6, moveDir: new V2(0, 1) }, 1.9);
    add({ suit: 'navy_jacket', hat: 'none', visor: 'goggles', face: 'freckles', backpack: 'jet', skin: 'grey' }, { speed: 5, sprint: true, moveDir: new V2(0, 1) }, -2.85);
    add({ suit: 'pink', hat: 'bunny', visor: 'glasses', face: 'shy', accessory: 'bowtie', backpack: 'turtle' }, { emote: 'point' }, 2.85);
  } else if (set === 'cos') {
    const n = +(q.get('n') || 0);
    const hats = COSMETICS.hat.map((h) => h.id);
    for (let i = 0; i < 7; i++) {
      const k = n * 7 + i;
      add({ suit: COSMETICS.suit[k % COSMETICS.suit.length].id, hat: hats[k % hats.length], face: COSMETICS.face[k % COSMETICS.face.length].id, backpack: COSMETICS.backpack[k % COSMETICS.backpack.length].id, accessory: COSMETICS.accessory[k % COSMETICS.accessory.length].id, visor: COSMETICS.visor[k % COSMETICS.visor.length].id }, { expression: 'neutral', talking: i % 2 ? 0.5 : 0 }, (i - 3) * 0.95);
    }
  } else if (set === 'states') {
    const exprs = ['neutral', 'happy', 'scared', 'hurt', 'sleepy', 'dead', 'shocked'];
    exprs.forEach((e, i) => add({ suit: 'yellow' }, { expression: e, dead: e === 'dead' }, (i - 3) * 0.95));
  } else if (set === 'anim') {
    add({ suit: 'yellow', hat: 'party' }, { emote: 'sit', expression: 'happy' }, -2.85);
    add({ suit: 'orange' }, { emote: 'sleep' }, -1.9);
    add({ suit: 'blue', hat: 'propeller' }, { grounded: false, vy: 2 }, -0.95);
    add({ suit: 'pink' }, { holding: 1, expression: 'neutral' }, 0);
    add({ suit: 'mint', hat: 'halo' }, { dead: true }, 0.95);
    add({ suit: 'lavender', hat: 'headlamp' }, { speed: 1.2, limp: true, moveDir: new V2(0, 1), expression: 'hurt' }, 1.9);
    add({ suit: 'camo', hat: 'crown', accessory: 'badge' }, { talking: 0.7, pitch: 0.4 }, 2.85);
  } else if (set === 'gear') {
    const gear = ['goggles', 'face_shield', 'gas_mask_up', 'glasses', 'sunglasses'];
    const faces = ['dots', 'happy', 'cat', 'button', 'cyclops'];
    gear.forEach((v, i) => add({ suit: ['yellow', 'orange_hivis', 'navy_jacket', 'hawaiian', 'fleece'][i], visor: v, face: faces[i], hat: ['none', 'hardhat', 'none', 'propeller', 'sprout'][i], skin: ['tan', 'light', 'dark', 'grey', 'rose'][i] }, { expression: 'neutral' }, (i - 2) * 0.62));
  } else if (set === 'ragdoll') {
    // parts at their rest pose + joint anchors (red = anchorA on torso, green = anchorB on limb)
    for (const [i, cos] of [[0, { suit: 'yellow', hat: 'beanie' }], [1, { suit: 'fleece', hat: 'bucket', backpack: 'none' }]]) {
      const rd = buildRagdoll(cos);
      const g = new THREE.Group(); g.position.x = (i - 0.5) * 1.2 + (i ? 0.3 : 0); g.rotation.y = Math.PI; scene.add(g);
      for (const [k, part] of Object.entries(rd.parts)) {
        const m = part.mesh; m.position.fromArray(rd.pose[k]);
        if (i === 1) m.position.multiplyScalar(1).add(new THREE.Vector3(0, 0, 0)), m.rotation.set(0, 0, 0);
        g.add(m);
      }
      for (const j of rd.joints) {
        const a = new THREE.Mesh(new THREE.SphereGeometry(0.018), new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false }));
        a.position.fromArray(rd.pose[j.a]).add(new THREE.Vector3(...j.anchorA)); g.add(a);
        const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.012), new THREE.MeshBasicMaterial({ color: 0x20ff20, depthTest: false }));
        b2.position.fromArray(rd.pose[j.b]).add(new THREE.Vector3(...j.anchorB)); g.add(b2);
      }
      window.__rd = rd;
    }
  } else if (set === 'one') {
    const st = JSON.parse(q.get('state') || '{}');
    if (st.moveDir) st.moveDir = new V2(...st.moveDir);
    add(JSON.parse(q.get('cos') || '{}'), st, 0, 0, +(q.get('yaw') ?? Math.PI));
  }
  window.__avatars = avatars;
  let tt = 0;
  const step = (dt) => {
    tt += dt;
      for (const { a, state } of avatars) {
        const s = { ...state };
        if (s.grounded === false) { s.vy = Math.sin(tt * 2) * 4; s.grounded = Math.sin(tt * 2) < -0.9; }
        a.update(dt, s);
      }
  };
  window.__advance = (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); };
  window.__advance(+(q.get('adv') ?? 1.5));
  return { update(dt) { step(dt); } };
}
