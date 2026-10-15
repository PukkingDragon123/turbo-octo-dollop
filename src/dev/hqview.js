// TEMPORARY dev viewer for the HQ receptionist / elevator / ride art (deleted before hand-off).
//   hqview.html?what=rec|car|ride&dim=yellow&cam=x,y,z&look=x,y,z&fov=40&t=2
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import * as Tex from '../gfx/textures.js';
import { ReceptionistBot } from '../entities/receptionist.js';
import { ElevatorCar } from '../entities/elevator.js';
const P = new URLSearchParams(location.search);
const v3 = (s, d) => (s ? new THREE.Vector3(...s.split(',').map(Number)) : d);
async function main() {
  engine.init(document.body, P.get('q') || 'low');
  await Tex.preload();
  const scene = engine.scene, cam = engine.camera;
  scene.background = new THREE.Color(0x202020);
  scene.environmentIntensity = 0.3;
  const what = P.get('what') || 'rec';
  const fakeWorld = { physics: { addStaticBox: () => ({ setEnabled() {} }) }, game: { local: { pos: v3(P.get('player'), new THREE.Vector3(0.3, 0, 1.9)), yaw: 0, pitch: 0, name: 'TESTER', world: 1 }, remotes: new Map(), ui: {} }, time: 0 };
  let upd = () => {};
  if (what === 'rec') {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 4), new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.9 }));
    wall.position.set(0, 2, -3); scene.add(wall);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.7), new THREE.MeshStandardMaterial({ color: 0x8f8670 }));
    desk.position.set(0, 0.73, 0.55); scene.add(desk);
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.15), new THREE.MeshStandardMaterial({ color: 0xcfc4a6 }));
    kb.position.set(0.1, 0.765, 0.33); scene.add(kb);
    const lights = [{ pos: new THREE.Vector3(0.8, 2.76, 0.7), color: new THREE.Color(0xfff0d8), intensity: 2.7 }, { pos: new THREE.Vector3(-1.6, 2.76, 2.2), color: new THREE.Color(0xfff0d8), intensity: 2.7 }];
    const r = new ReceptionistBot(fakeWorld, 'rx', { lights, ambient: new THREE.Color(0.1, 0.095, 0.09) });
    scene.add(r.root);
    window.__rec = r;
    const lookT = v3(P.get('lookat'), null);
    upd = (dt) => {
      if (P.get('talk')) r.say = r.say || { id: 'intro1', text: 'x', vfd: ['GOOD MORNING', 'TESTER'], t: 0, dur: 99 };
      if (P.get('stare')) { r._obs = false; r.unwatchedT = 5; }
      r.update(dt);
      if (lookT) r.anim.update(0, { look: lookT, snap: true, attend: 1, talking: 0 });
    };
  } else if (what === 'car') {
    const car = new ElevatorCar({ exterior: !!P.get('ext') });
    scene.add(car.root);
    car.syncLights();
    car.gate.set(+(P.get('gate') || 0));
    window.__car = car;
    upd = (dt) => car.update(dt);
  } else if (what === 'ride') {
    const { prepareRide, ElevatorRide } = await import('../world/elevator_ride.js');
    const S = prepareRide();
    S.root.position.set(0, 0, 0);
    scene.add(S.root);
    window.__S = S;
    const game = { local: { yaw: Math.PI, pitch: 0, pos: new THREE.Vector3(), world: null }, remotes: new Map(), world: null, loading: true, state: 'playing' };
    const ride = new ElevatorRide(game, { riders: [], me: { x: 0, z: 0.3, yaw: 0 }, car: null });
    ride.switched = true; ride.yaw = +(P.get('yaw') || 0); ride.pitch = +(P.get('pitch') || 0);
    ride.rel.set(+(P.get('rx') || 0), 0, +(P.get('rz') || 0.3));
    scene.add(S.root);
    ride.t = +(P.get('t') || 3);
    ride.worldKey = 'x';
    window.__ride = ride;
    const t0 = ride.t;
    for (let i = 0; i < 40; i++) ride.update(0.02);
    ride.t = t0; ride.fired = new Set(); ride.blackout = 0;
    upd = (dt) => { ride.update(dt * 0.0001); };
  }
  const fov = +(P.get('fov') || 50);
  let frames = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    upd(dt);
    if (P.get('cam') && what !== 'ride') { cam.position.copy(v3(P.get('cam'))); cam.lookAt(v3(P.get('look'), new THREE.Vector3(0, 1.2, 0))); cam.fov = fov; cam.updateProjectionMatrix(); }
    engine.render(dt);
    if (++frames > +(P.get('frames') || 6)) window.__done = true;
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { console.error(e); document.body.innerHTML = '<pre style="color:red">' + e.stack + '</pre>'; window.__done = true; });
