// Sandbox for The Bacteria: drives the creature around a loop with a state timeline.
// URL params:
//   state=<name>     lock a state (idle|wander|investigate|listen|stalk|chase|attack|stunned|hurt|despawn)
//   speed=<m/s>      override speed for the locked state
//   t0=<s>           pre-simulate this many seconds before the first frame (deterministic poses)
//   pause=1          stop simulation after t0 (static pose for screenshots)
//   dim=1            dim Backrooms lights + flashlight from the camera
//   fpv=1            first-person camera at 1.15 m looking at the creature
//   follow=1         orbit target follows the creature
//   ceil=<y>         ceiling height passed to the body (default 2.9)
//   dissolve=<0..1>  fixed dissolve amount
//   intensity=<0..1> override aggression
//   at=x,z           place the creature here (locked state only) ; yaw=<rad>
//   seed=<n>, chop=<0..1> stop-motion choppiness, attackT=<0..1> fixed attack progress
import { BacteriaBody } from '../src/entities/monsters/bacteria_body.js';

const TIMELINE = [
  ['wander', 5, 1.2, 0.3],
  ['investigate', 3, 0.6, 0.45],
  ['stalk', 5, 0.85, 0.8],
  ['chase', 5, 7.0, 1.0],
  ['attack', 1.1, 0, 1.0],
  ['idle', 3, 0, 0.5],
  ['listen', 3, 0, 0.6],
  ['stunned', 3, 0, 0.7],
  ['hurt', 0.5, 0, 0.9],
  ['chase', 3, 4.5, 1.0],
  ['attack', 1.1, 0, 1.0],
];

export default async function (ctx) {
  const { THREE, scene, camera, controls } = ctx;
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
  const body = new BacteriaBody(num('seed', 1));
  body.choppiness = num('chop', 1);
  scene.add(body.root);
  window.__bact = body;


  const steps = [];
  body.onStep = (p, loud) => { steps.push([p.x.toFixed(2), p.z.toFixed(2), loud.toFixed(2)]); if (steps.length > 50) steps.shift(); };
  window.__steps = steps;

  if (q.get('dim') === '1') {
    scene.traverse((o) => {
      if (o.isPointLight) o.intensity *= 0.1;
      if (o.isSpotLight) o.intensity *= 0.05;
      if (o.isHemisphereLight) o.intensity *= 0.15;
    });
    scene.environmentIntensity = 0.08;
    const fl = new THREE.SpotLight(0xfff2dd, 40, 25, 0.42, 0.45, 1.6);
    fl.position.set(0.15, -0.15, 0);
    fl.castShadow = true;
    fl.shadow.mapSize.set(1024, 1024);
    camera.add(fl);
    camera.add(fl.target);
    fl.target.position.set(0, -0.1, -2);
  }

  // Filmstrip mode: N bodies in parallel lanes walking toward -Z, each sampled dt later.
  if (q.has('strip')) {
    scene.remove(body.root);
    const N = num('strip', 5), sdt = num('sdt', 0.06), st = q.get('state') || 'chase';
    const speed = num('speed', st === 'chase' ? 7 : st === 'stalk' ? 0.85 : 1.2);
    const T0 = num('t0', 2), gap = num('gap', 1.4);
    const v = new THREE.Vector3(0, 0, -speed);
    for (let i = 0; i < N; i++) {
      const b = i === 0 ? body : new BacteriaBody(num('seed', 1));
      b.choppiness = num('chop', 1);
      scene.add(b.root);
      const T = T0 + i * sdt;
      const x = 0;
      const zEnd = num('zend', 0) - (i - (N - 1) / 2) * gap;
      const z0 = zEnd + (q.has('sts') ? 0 : speed * T);
      const look = new THREE.Vector3();
      const steps = Math.round(T * 120);
      for (let k = 0; k <= steps; k++) {
        const tt = (k / steps) * T;
        b.root.position.set(x, 0, z0 - (q.has('sts') ? 0 : speed * tt));
        if (q.has('sts') && q.get('sts').split(',')[i] === 'despawn') b.setDissolve(Math.min(1, tt / 3));
        b.root.rotation.y = 0;
        look.set(x + num('lookx', 0), num('looky', 1.6), b.root.position.z - 3);
        const atk = q.has('atk') ? (() => { const [a0, a1] = q.get('atk').split(',').map(Number); return a0 + ((a1 - a0) * i) / Math.max(1, N - 1); })() : num('attackT', 0);
        const sts = q.has('sts') ? q.get('sts').split(',')[i] || st : st;
        b.update(k === 0 ? 0 : T / steps, { velocity: q.has('sts') ? new THREE.Vector3() : v, state: sts, lookTarget: look, attackT: atk, ceilingY: num('ceil', 2.9), intensity: num('intensity', 0.8) });
      }
    }
    return {};
  }

  const lockState = q.get('state');
  const ceilY = num('ceil', 2.9);
  const radius = num('r', 3.2);
  let pathA = 0; // angle along circular path
  const pos = new THREE.Vector3(radius, 0, 0);
  if (q.has('at')) { const [x, z] = q.get('at').split(',').map(Number); pos.set(x, 0, z); }
  let yaw = num('yaw', 0);
  const vel = new THREE.Vector3();
  const look = new THREE.Vector3();
  let t = 0, attackT = 0, dissolve = num('dissolve', 0);
  const total = TIMELINE.reduce((a, e) => a + e[1], 0);
  const info = document.createElement('div');
  info.style.cssText = 'position:fixed;left:8px;top:24px;color:#9f9;font:12px monospace;z-index:3;white-space:pre';
  document.body.appendChild(info);

  if (q.get('fpv') === '1') {
    camera.position.set(0, 1.15, 3.2);
    controls.target.set(0, 1.3, 0);
    controls.update();
  }

  function stateAt(time) {
    if (lockState) return [lockState, 1e9, num('speed', lockState === 'chase' ? 7 : lockState === 'wander' ? 1.2 : lockState === 'stalk' ? 0.85 : 0), num('intensity', 0.8), time];
    let tt = time % total;
    for (const e of TIMELINE) { if (tt < e[1]) return [e[0], e[1], e[2], e[3], tt]; tt -= e[1]; }
    return TIMELINE[0].concat([0]);
  }

  function sim(dt) {
    t += dt;
    const [state, dur, speed, inten, tin] = stateAt(t);
    if (speed > 0 && !(lockState && q.has('at'))) {
      pathA += (speed / radius) * dt;
      const nx = Math.cos(pathA) * radius, nz = Math.sin(pathA) * radius;
      vel.set(nx - pos.x, 0, nz - pos.z).divideScalar(Math.max(dt, 1e-6));
      pos.set(nx, 0, nz);
      yaw = Math.atan2(-vel.x, -vel.z);
    } else {
      vel.set(0, 0, 0);
      if (!q.has('yaw')) {
        const tx = camera.position.x - pos.x, tz = camera.position.z - pos.z;
        yaw += ((((Math.atan2(-tx, -tz) - yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 4);
      }
    }
    if (state === 'attack') attackT = q.has('attackT') ? num('attackT', 0.5) : Math.min(1, tin / dur);
    else attackT = 0;
    if (state === 'despawn' && !q.has('dissolve')) dissolve = Math.min(1, tin / 2.5);
    else if (!q.has('dissolve')) dissolve = 0;
    look.copy(camera.position);
    body.root.position.copy(pos);
    body.root.rotation.y = yaw;
    body.setDissolve(dissolve);
    body.update(dt, {
      velocity: vel,
      state,
      lookTarget: q.get('nolook') === '1' ? null : look,
      attackT,
      ceilingY: ceilY,
      groundAt: () => 0,
      intensity: num('intensity', inten),
    });
    info.textContent = `${state}  t=${t.toFixed(2)}  v=${speed}  attackT=${attackT.toFixed(2)}`;
  }

  const t0 = num('t0', 0);
  for (let i = 0; i < t0 * 60; i++) sim(1 / 60);
  const paused = q.get('pause') === '1';

  // Stress test: random dt spikes, state flips and teleports; reports NaNs / explosions.
  window.__stress = (n = 3000) => {
    const states = Object.keys({ idle: 1, wander: 1, investigate: 1, listen: 1, stalk: 1, chase: 1, attack: 1, stunned: 1, hurt: 1, despawn: 1 });
    let bad = 0, maxDist = 0, maxScale = 0, st = 'idle', at = 0;
    const p = new THREE.Vector3(), v = new THREE.Vector3(), lt = new THREE.Vector3();
    let y = 0;
    for (let i = 0; i < n; i++) {
      const dt = Math.random() < 0.1 ? 0.1 : Math.random() * 0.05;
      if (Math.random() < 0.02) st = states[(Math.random() * states.length) | 0];
      const sp = st === 'chase' ? 9 * Math.random() : Math.random() * 2;
      const dir = Math.random() * Math.PI * 2;
      if (Math.random() < 0.01) y += (Math.random() - 0.5) * 2;
      v.set(Math.cos(dir) * sp, 0, Math.sin(dir) * sp);
      p.addScaledVector(v, dt);
      if (Math.random() < 0.003) p.set((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 40);
      p.y = y;
      y += 0; // floor
      lt.set(p.x + Math.random() * 4 - 2, Math.random() * 3, p.z + Math.random() * 4 - 2);
      at = st === 'attack' ? (at + dt) % 1 : 0;
      body.root.position.copy(p);
      body.root.rotation.y = Math.random() < 0.05 ? Math.random() * 10 : body.root.rotation.y;
      body.update(dt, { velocity: v, state: st, lookTarget: Math.random() < 0.1 ? null : lt, attackT: at, ceilingY: y + 1.6 + Math.random() * 2, intensity: Math.random(), groundAt: () => y });
      for (let b = 0; b < body.bones.length; b++) {
        const e = body.bones[b].matrixWorld.elements;
        for (let k = 0; k < 16; k++) if (!Number.isFinite(e[k])) { bad++; break; }
        const dx = e[12] - p.x, dy = e[13] - p.y, dz = e[14] - p.z;
        const dd = Math.hypot(dx, dy, dz);
        if (dd > maxDist) { maxDist = dd; window.__worst = { bone: body.bones[b].name, st, dt, frz: body.freezeT, sp, i }; }
        maxScale = Math.max(maxScale, body.bS[b]);
      }
    }
    return { bad, maxDist: +maxDist.toFixed(3), maxScale: +maxScale.toFixed(3), worst: window.__worst };
  };

  return {
    update(dt) {
      if (!paused) sim(dt);
      if (q.get('follow') === '1') {
        const hp = body.getHeadWorldPosition(new THREE.Vector3());
        controls.target.lerp(new THREE.Vector3(body.root.position.x, Math.min(hp.y, 1.6), body.root.position.z), 0.2);
      }
    },
  };
}
