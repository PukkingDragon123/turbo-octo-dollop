// Device library viewer.
// /sandbox/?m=devices                      -> every device laid out in the room
// /sandbox/?m=devices&d=vending_snack      -> single device close-up (comma list allowed)
//   &anim=1      animate parts (doors, coils, flaps, needles, beacons, ...)
//   &pose=0.8    freeze the animation at phase 0..1 (for screenshots)
//   &uvtest=1    put a UV test pattern on every screen
//   &view=front|side|back|top|close   preset camera when no cam= is given
//   &opts={"count":5}  JSON opts passed to the builder
import * as THREE from 'three';
import { DEVICES, DEVICE_NAMES, buildDevice, scoreDart } from '../src/entities/models_devices.js';

const WALL = new Set(['dart_board', 'employee_of_month', 'wall_clock', 'poster', 'mirror', 'wall_vent', 'fuse_box', 'fire_alarm', 'exit_sign', 'hazard_sign']);
const WALL_Y = { wall_vent: 0.25, fire_alarm: 1.25, exit_sign: 2.3, dart_board: 1.73, wall_clock: 2.1, poster: 1.5, employee_of_month: 1.55, mirror: 1.5, fuse_box: 1.5, hazard_sign: 1.6 };
const CEIL = new Set(['ceiling_vent']);
const WALLFLOOR = new Set(['pipe_cluster']);
const PROP = new Set(['radio', 'supply_crate', 'starter_box']);
const TABLETOP = new Set(['crt_terminal', 'service_bell', 'coffee_machine']);

function countTris(obj) {
  let t = 0, meshes = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    meshes++;
    const g = o.geometry;
    t += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { tris: Math.round(t), meshes };
}

function uvTestTexture(name, aspect) {
  const W = 512, H = Math.round(512 / aspect);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#334' : '#556'; x.fillRect((i * W) / 8, (j * H) / 8, W / 8, H / 8); }
  x.fillStyle = '#f33'; x.fillRect(0, 0, W * 0.2, H * 0.2);
  x.fillStyle = '#fff'; x.font = `bold ${H * 0.16}px monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, W / 2, H / 2);
  x.font = `bold ${H * 0.1}px monospace`; x.fillText('TOP-LEFT=RED', W / 2, H * 0.8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Per-device animation: phase p in 0..1 (ping-pong), t seconds
const ANIM = {
  vending_snack(d, p, t) { d.parts.coils.forEach((c, i) => (c.rotation.z = -t * (1 + (i % 3)))); d.parts.flap.rotation.x = p * 1.1; },
  vending_drink(d, p) { d.parts.buttons.forEach((b, i) => (b.position.z = i === Math.floor(p * 5.99) ? -0.006 : 0)); if (d.parts.flap) d.parts.flap.rotation.x = p * 1.1; },
  water_cooler(d, p, t) { d.parts.water.scale.y = 1 - p * 0.8; d.parts.tapCold.rotation.x = -p * 0.5; },
  aquarium(d, p, t) { d.parts.plants.forEach((pl, i) => (pl.rotation.z = Math.sin(t * 1.3 + i) * 0.08)); d.parts.glass.forEach((g, i) => (g.visible = !(p > 0.9 && i === 0))); },
  locker(d, p) { d.parts.door.rotation.y = -p * 1.9; },
  locker_bank(d, p) { d.parts.doors.forEach((dr, i) => (dr.rotation.y = -p * 1.9 * (i % 2 ? 0.4 : 1))); },
  service_bell(d, p) { d.parts.plunger.position.y = -p * 0.006; },
  wall_clock(d, p, t) { const s = t * 60; d.parts.second.rotation.z = -s * TAU() / 60; d.parts.minute.rotation.z = -s * TAU() / 3600 - 1.2; d.parts.hour.rotation.z = -s * TAU() / 43200 - 0.6; },
  clone_console(d, p, t) { d.parts.button.position.z = -p * 0.01; d.parts.knobs.forEach((k, i) => (k.rotation.z = t * (i + 1) * 0.3)); d.parts.sliders?.forEach((s, i) => (s.position.y = Math.sin(t + i) * d.params.sliderTravel / 2)); },
  clone_tube(d, p) { d.parts.fluid.scale.y = 1 - p * 0.5; },
  clone_pad(d, p, t) { d.parts.ring.material.emissiveIntensity = 1 + Math.sin(t * 4) * 0.8; },
  dispatch_door(d, p, t) { const tr = d.params.travel; d.parts.left.position.x = d.parts.left.userData.x0 - p * tr; d.parts.right.position.x = d.parts.right.userData.x0 + p * tr; d.parts.beacons.forEach((b, i) => (d.parts.beaconReflectors[i].rotation.y = t * 6)); },
  dispatch_lever(d, p) { d.parts.handle.rotation.x = -0.6 + p * 1.2; },
  generator_diesel(d, p, t) { d.parts.needles.forEach((n, i) => (n.rotation.z = Math.sin(t + i) * 1.5)); d.parts.fuelCap.rotation.y = p * 3; d.parts.cordHandle.position.z = d.parts.cordHandle.userData.z0 + p * 0.4; },
  generator_electric(d, p) { d.parts.door.rotation.y = -p * 1.9; d.parts.breaker.rotation.x = -0.6 + p * 1.2; },
  generator_mech(d, p, t) { d.parts.flywheel.rotation.x = t * 3; d.parts.bolts.forEach((b, i) => { b.rotation.z = p * 8; b.position.z = b.userData.z0 + p * 0.05; }); d.parts.crank.rotation.x = t * 3; d.parts.needle.rotation.z = Math.sin(t) * 2; },
  radio(d, p, t) { d.parts.antenna.scale.y = 0.3 + p * 0.7; d.parts.knobs.forEach((k, i) => (k.rotation.z = t * (i + 1) * 0.5)); },
  supply_crate(d, p) { d.parts.lid.rotation.x = -p * 1.9; },
  starter_box(d, p) { d.parts.flaps.forEach((f, i) => (f.rotation.x = p * (2.4 - i * 0.2))); },
  exit_door(d, p) { d.parts.door.rotation.y = p * 1.6; },
  fridge(d, p) { d.parts.door.rotation.y = p * 1.8; if (d.parts.freezerDoor) d.parts.freezerDoor.rotation.y = p * 1.2; },
  server_rack(d, p, t) { d.parts.leds.forEach((l, i) => (l.material.emissiveIntensity = Math.sin(t * (3 + i) + i * 7) > 0 ? 2.5 : 0.1)); },
  photocopier(d, p) { d.parts.lid.rotation.x = -p * 1.2; },
  fuse_box(d, p) { d.parts.door.rotation.y = -p * 1.9; },
  fire_alarm(d, p) { d.parts.handle.rotation.x = p * 0.8; },
  pipe_cluster(d, p, t) { d.parts.valves?.forEach((v, i) => (v.rotation.z = t * (i + 1))); },
  coffee_machine(d, p) {},
};
function TAU() { return Math.PI * 2; }

export default async function (ctx) {
  const { scene, camera, controls, room } = ctx;
  const q = new URLSearchParams(location.search);
  const only = q.get('d');
  const animOn = q.get('anim') === '1';
  const pose = q.has('pose') ? +q.get('pose') : null;
  const opts = q.has('opts') ? JSON.parse(q.get('opts')) : undefined;
  const names = only ? only.split(',') : DEVICE_NAMES;
  const built = [];
  const report = [];

  if (only) {
    // single / few devices side by side; backing wall for wall-mounted ones
    let x = 0;
    const gap = 0.6;
    for (const n of names) {
      const t0 = performance.now();
      const d = buildDevice(n, opts);
      const ms = performance.now() - t0;
      const t1 = performance.now();
      buildDevice(n, opts); // second instance timing (clone path)
      const ms2 = performance.now() - t1;
      const b = new THREE.Box3().setFromObject(d.object);
      const w = b.max.x - b.min.x;
      d.object.position.x = x - b.min.x;
      if (WALL.has(n)) d.object.position.set(x + w / 2, WALL_Y[n] ?? 1.5, -1.5);
      else if (WALLFLOOR.has(n)) d.object.position.set(x + w / 2, 0, -1.5);
      else if (CEIL.has(n)) d.object.position.set(x + w / 2 + 1.5, 2.9, 1.5);
      else if (PROP.has(n)) d.object.position.y = d.halfHeight ?? 0;
      else if (TABLETOP.has(n)) d.object.position.y = 0.75;
      x += w + gap;
      scene.add(d.object);
      built.push({ n, d });
      const tc = countTris(d.object);
      report.push({ n, ...tc, ms: ms.toFixed(1), clone: ms2.toFixed(2), atlas: d.object.userData.atlasFill });
    }
    // center the lineup
    const total = x - gap;
    for (const { n, d } of built) {
      d.object.position.x -= total / 2;
      if (TABLETOP.has(n)) {
        const bw = new THREE.Box3().setFromObject(d.object).getSize(new THREE.Vector3()).x;
        const tb = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.6, bw + 0.3), 0.04, 0.9), ctx.Mat.get('wood'));
        tb.position.set(d.object.position.x, 0.73, d.object.position.z - 0.05);
        tb.receiveShadow = tb.castShadow = true;
        scene.add(tb);
      }
    }
    if (names.some((n) => WALL.has(n) || WALLFLOOR.has(n))) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.max(4, total + 2), 2.9, 0.1), ctx.Mat.get('wallpaper'));
      wall.position.set(0, 1.45, -1.55);
      wall.receiveShadow = true;
      // world UVs
      scene.add(wall);
    }
    // auto camera
    if (!q.has('cam')) {
      const b = new THREE.Box3();
      for (const { d } of built) b.expandByObject(d.object);
      const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      const r = Math.max(s.x, s.y * 1.3, s.z) * 0.5;
      const dist = (r / Math.tan((camera.fov * Math.PI) / 360)) * 1.25 + s.z * 0.5;
      const v = q.get('view') || 'front';
      const dir = { front: [0.35, 0.22, 1], side: [1, 0.2, 0.25], back: [-0.35, 0.3, -1], top: [0.2, 1.2, 0.6], close: [0.15, 0.08, 1], left: [-1, 0.2, 0.3] }[v] || [0.35, 0.22, 1];
      const dv = new THREE.Vector3(...dir).normalize();
      camera.position.copy(c).addScaledVector(dv, v === 'close' ? dist * 0.55 : dist);
      if (camera.position.y > 2.75) camera.position.y = 2.75;
      controls.target.copy(c);
      controls.update();
    }
  } else {
    // full catalogue grid
    room.visible = q.get('room') !== '0' ? room.visible : false;
    let x = -6.2, z = -5.5, rowH = 0;
    for (const n of names) {
      const t0 = performance.now();
      const d = buildDevice(n, opts);
      const ms = performance.now() - t0;
      const b = new THREE.Box3().setFromObject(d.object);
      const w = b.max.x - b.min.x, dz = b.max.z - b.min.z;
      if (x + w > 6.5) { x = -6.2; z += rowH + 0.8; rowH = 0; }
      d.object.position.set(x - b.min.x, 0, z - b.min.z);
      if (WALL.has(n)) d.object.position.y = WALL_Y[n] ?? 1.5;
      if (CEIL.has(n)) d.object.position.y = 2.6;
      if (PROP.has(n)) d.object.position.y = d.halfHeight ?? 0;
      x += w + 0.5;
      rowH = Math.max(rowH, dz);
      scene.add(d.object);
      built.push({ n, d });
      report.push({ n, ...countTris(d.object), ms: ms.toFixed(1) });
    }
  }

  if (q.get('uvtest') === '1') {
    for (const { n, d } of built) for (const [k, s] of Object.entries(d.screens || {})) {
      const t = uvTestTexture(`${n}.${k}`, s.aspect);
      s.mesh.material.map = t; s.mesh.material.emissiveMap = t; s.mesh.material.needsUpdate = true;
    }
  }
  // sanity checks on the contract
  for (const { n, d } of built) {
    const miss = ['object', 'colliders', 'mass', 'material', 'anchors', 'parts'].filter((k) => d[k] === undefined);
    if (miss.length) console.error(`[devices] ${n} missing ${miss.join(',')}`);
    if (d.screens) for (const [k, s] of Object.entries(d.screens)) if (!s.mesh?.isMesh || !s.aspect) console.error(`[devices] ${n}.screens.${k} bad`);
  }
  console.table(report);
  console.log('[devices] ' + report.map((r) => `${r.n}: ${r.tris} tris / ${r.meshes} meshes / ${r.ms}ms / atlas ${r.atlas}${r.clone ? ' (clone ' + r.clone + 'ms)' : ''}`).join('\n'));
  if (names.includes('dart_board')) {
    const tests = [[0, 0], [0, 0.012], [0, 0.103], [0, 0.166], [0.103, 0], [0, -0.13], [-0.166, 0], [0.2, 0.2], [0.05, 0.08]];
    console.log('[devices] scoreDart ' + tests.map(([x, y]) => `(${x},${y})=${scoreDart(x, y).label}`).join(' '));
  }
  window.__devices = built;
  window.__ctx = ctx;

  const apply = (p, t) => { for (const { n, d } of built) ANIM[n]?.(d, p, t); };
  if (pose !== null) apply(pose, pose * 4);
  return {
    update(dt, t) {
      if (!animOn) return;
      const p = 0.5 - 0.5 * Math.cos(t * 1.2);
      apply(p, t);
    },
  };
}
