// Sandbox for ambient critters: rats, cockroaches and an aquarium with every fish kind.
// URL params: focus=rat|roach|fish|all (camera presets), t0=<s> pre-simulate, pause=1,
//             dim=1 (low light + flashlight)
import { buildRat, buildCockroach, buildFish, FISH_KINDS } from '../src/entities/critter_models.js';

export default async function (ctx) {
  const { THREE, scene, camera, controls, Mat } = ctx;
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
  const agents = [];

  // ---- rats: one sniffing in place, one running loops, one trotting slowly
  const ratPaths = [
    { c: [-0.4, 0.25], r: 0, speed: 0, yaw: 0.6 },
    { c: [0.35, -0.2], r: 0.55, speed: 1.1 },
    { c: [0.2, 0.55], r: 0.3, speed: 0.25 },
  ];
  ratPaths.forEach((p, i) => {
    const rat = buildRat(i + 1);
    scene.add(rat.root);
    agents.push({ kind: 'rat', obj: rat, ...p, a: i * 2.1, dir: i % 2 ? -1 : 1 });
  });
  // ---- cockroaches near the wall
  for (let i = 0; i < 6; i++) {
    const r = buildCockroach(i + 7);
    scene.add(r.root);
    agents.push({ kind: 'roach', obj: r, c: [1.6 + (i % 3) * 0.12, 0.2 + Math.floor(i / 3) * 0.15], r: i < 4 ? 0.08 + i * 0.03 : 0, speed: i < 4 ? 0.25 + i * 0.08 : 0, a: i, dir: i % 2 ? 1 : -1, yaw: i });
  }
  // ---- aquarium
  const tank = new THREE.Group();
  tank.position.set(-1.6, 0.75, -1.2);
  scene.add(tank);
  const TW = 0.9, TH = 0.45, TD = 0.42;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(TW + 0.05, 0.75, TD + 0.05), Mat.get('wood_dark'));
  stand.position.y = -0.375 - 0.01;
  tank.add(stand);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(TW, TH, TD), Mat.get('glass'));
  glass.position.y = TH / 2;
  glass.renderOrder = 2;
  tank.add(glass);
  const water = new THREE.Mesh(new THREE.BoxGeometry(TW - 0.01, TH * 0.9, TD - 0.01), new THREE.MeshPhysicalMaterial({ color: 0x6fb8c8, transparent: true, opacity: 0.12, roughness: 0.1, depthWrite: false }));
  water.position.y = TH * 0.45;
  water.renderOrder = 1;
  tank.add(water);
  const gravel = new THREE.Mesh(new THREE.BoxGeometry(TW - 0.01, 0.03, TD - 0.01), Mat.make('concrete', { color: 0x8a7a5c }));
  gravel.position.y = 0.015;
  tank.add(gravel);
  const tankLight = new THREE.PointLight(0xdff4ff, 0.6, 1.5, 1.5);
  tankLight.position.set(0, TH + 0.05, 0);
  tank.add(tankLight);
  FISH_KINDS.forEach((k, i) => {
    for (let n = 0; n < (k === 'neon' || k === 'guppy' ? 2 : 1); n++) {
      const f = buildFish(k, i * 10 + n + 1);
      tank.add(f.root);
      agents.push({ kind: 'fish', obj: f, c: [0, 0], r: 0.12 + ((i * 3 + n) % 5) * 0.035, speed: 0.05 + ((i + n) % 3) * 0.035, a: i * 1.3 + n * 2.5, dir: (i + n) % 2 ? 1 : -1, y: 0.1 + ((i * 2 + n) % 5) * 0.06, fishKind: k });
    }
  });

  if (q.get('fishline') === '1') {
    // all fish kinds side by side in open air for close inspection
    FISH_KINDS.forEach((k, i) => {
      const f = buildFish(k, 3);
      f.root.position.set((i - 2) * 0.13, 1.0, 0);
      f.root.rotation.y = Math.PI / 2 * (q.has('fy') ? num('fy', 1) : 1);
      scene.add(f.root);
      agents.push({ kind: 'fishStatic', obj: f, c: [0, 0], r: 0, speed: num('fspeed', 0.1), a: 0, dir: 1 });
    });
    camera.position.set(0, 1.03, 0.42);
    controls.target.set(0, 1.0, 0);
    controls.update();
  }
  if (q.get('dim') === '1') {
    scene.traverse((o) => { if (o.isPointLight && o !== tankLight) o.intensity *= 0.1; if (o.isSpotLight) o.intensity *= 0.05; if (o.isHemisphereLight) o.intensity *= 0.15; });
    const fl = new THREE.SpotLight(0xfff2dd, 25, 15, 0.45, 0.45, 1.6);
    camera.add(fl); camera.add(fl.target); fl.target.position.set(0, -0.1, -2);
  }

  const presets = {
    rat: [[0.25, 0.22, 0.75], [0.0, 0.05, 0.15]],
    roach: [[1.72, 0.12, 0.55], [1.72, 0.0, 0.3]],
    fish: [[-1.45, 1.0, -0.45], [-1.6, 0.95, -1.2]],
    all: [[1.2, 1.4, 2.2], [-0.3, 0.3, -0.3]],
  };
  const pr = presets[q.get('focus') || 'all'];
  if (pr && !q.has('cam')) {
    camera.position.fromArray(pr[0]);
    controls.target.fromArray(pr[1]);
    controls.update();
  }

  let t = 0;
  function sim(dt) {
    t += dt;
    for (const ag of agents) {
      let speed = ag.speed, turning = 0;
      if (ag.kind === 'rat' && ag.r > 0) speed = ag.speed * (0.6 + 0.4 * Math.max(0, Math.sin(t * 0.7 + ag.a))); // stop-and-go
      if (ag.kind === 'roach' && ag.r > 0) speed = ag.speed * (Math.sin(t * 1.3 + ag.a) > -0.3 ? 1 : 0);
      if (ag.r > 0 && speed > 0) {
        ag.a += ((speed / ag.r) * dt) * ag.dir;
        turning = ag.dir * (speed / ag.r);
      }
      const x = ag.c[0] + Math.cos(ag.a) * ag.r, z = ag.c[1] + Math.sin(ag.a) * ag.r;
      const o = ag.obj.root;
      if (ag.kind === 'fishStatic') { ag.obj.update(dt, { speed: ag.speed }); continue; }
      if (ag.kind === 'fish') {
        o.position.set(x, ag.y + 0.015 * Math.sin(t * 0.8 + ag.a), z * 0.8);
        // tangent of circle -> facing (forward is -Z)
        const tx = -Math.sin(ag.a) * ag.dir, tz = Math.cos(ag.a) * ag.dir * 0.8;
        o.rotation.y = Math.atan2(-tx, -tz);
      } else {
        o.position.set(x, 0, z);
        if (ag.r > 0) { const tx = -Math.sin(ag.a) * ag.dir, tz = Math.cos(ag.a) * ag.dir; o.rotation.y = Math.atan2(-tx, -tz); }
        else o.rotation.y = ag.yaw || 0;
      }
      ag.obj.update(dt, { speed, turning });
    }
  }
  const t0 = num('t0', 0);
  for (let i = 0; i < t0 * 60; i++) sim(1 / 60);
  const paused = q.get('pause') === '1';
  window.__critters = agents;
  return { update(dt) { if (!paused) sim(dt); } };
}
