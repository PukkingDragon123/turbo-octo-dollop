// Poolrooms water creatures.
//  * The goldfish (host-authoritative AI, 15 Hz snapshots, interpolated views on every peer): lives in
//    the canal, circles deep under the team, follows them down the waterway, surfaces to stare with
//    its crowd of eyes, then lunges — at swimmers (bites and drags them under), at clones standing
//    at the water's edge, at the raft (rams it, snatches riders near the side).
//  * Leeches (local, per client like the rats): wriggle through the water toward a wading or swimming
//    clone, latch on (bleeding, infection), can be pulled off with E — and eaten.
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { net } from '../../../net/net.js';
import { audio } from '../../../audio/audio.js';
import { buildGoldfish } from './goldfish.js';
import { CANAL_Z0, CANAL_Z1, CANAL_Y, CANAL_X0, WATER_Y } from './layout.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _look = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function angLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ===========================================================================
// Host AI
class GoldfishAI {
  constructor(mgr, id, pos) {
    this.mgr = mgr;
    this.id = id;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.state = 'lurk';
    this.t = 0;
    this.target = null;
    this.goal = new THREE.Vector3();
    this.cool = 12;           // seconds until it may attack
    this.hunger = 0;          // grows with time near the team
    this.mouth = 0.15;
    this.reach = 0;
    this.surge = 0;
    this.bit = false;
    this.orbitA = Math.random() * Math.PI * 2;
    this.stunT = 0;
  }

  bounds(p) {
    const lvl = this.mgr.level;
    p.x = Math.max(CANAL_X0 + 7, p.x);
    p.z = clamp(p.z, CANAL_Z0 + 0.9, CANAL_Z1 - 0.9);
    p.y = clamp(p.y, CANAL_Y + 0.7, (lvl.waterLevel ?? WATER_Y) - 0.45);
    return p;
  }

  // the most exposed player: swimmers first, then clones by the edge / on the raft
  pickTarget(players) {
    const lvl = this.mgr.level;
    let best = null, bs = -1;
    for (const pl of players) {
      const dx = pl.pos.x - this.pos.x;
      if (Math.abs(dx) > 40) continue;
      const inCanal = pl.pos.z > CANAL_Z0 - 1.6 && pl.pos.z < CANAL_Z1 + 1.6;
      if (!inCanal) continue;
      const depth = lvl.waterDepth(pl.pos.x, pl.pos.z);
      const swimming = depth > 1.0 && pl.pos.y < lvl.waterLevel - 0.4;
      const onRaft = lvl.raft?.isOn(pl.pos, 0.2);
      const edge = !swimming && !onRaft && (Math.abs(pl.pos.z - CANAL_Z0) < 1.3 || Math.abs(pl.pos.z - CANAL_Z1) < 1.3) && pl.pos.y > -0.3;
      let sc = swimming ? 3 : onRaft ? 1.2 : edge ? 0.7 : 0;
      if (!sc) continue;
      sc *= 1 / (1 + Math.abs(dx) * 0.05);
      if (sc > bs) { bs = sc; best = { pl, swimming, onRaft, edge }; }
    }
    return best;
  }

  update(dt) {
    const mgr = this.mgr, lvl = mgr.level;
    const day = mgr.game.day.day;
    this.t += dt;
    this.cool -= dt;
    this.stunT -= dt;
    const players = mgr.alivePlayers();
    const tg = this.pickTarget(players);
    this.hunger = Math.min(1.5, this.hunger + dt * (0.012 + day * 0.004) * (tg ? 1 : 0.3));
    const wl = lvl.waterLevel ?? WATER_Y;
    let speed = 1.2, want = this.goal;
    this.reach += ((this.state === 'lunge' ? 1 : this.state === 'stalk' ? 0.35 : 0) - this.reach) * Math.min(1, dt * 3);
    this.mouth += ((this.state === 'lunge' ? 1 : this.state === 'surface' ? 0.55 : 0.15) - this.mouth) * Math.min(1, dt * 5);
    this.surge = this.state === 'lunge' ? 1 : this.state === 'flee' ? 0.6 : 0;
    // the centre of the team along the waterway (it keeps up with them)
    let cx = this.pos.x;
    if (players.length) { cx = 0; for (const p of players) cx += p.pos.x; cx /= players.length; }
    switch (this.state) {
      case 'lurk': {
        // slow deep orbit somewhere under / ahead of the team
        this.orbitA += dt * 0.11;
        want.set(cx + Math.cos(this.orbitA) * 9, CANAL_Y + 1.0 + Math.sin(this.t * 0.2) * 0.4, (CANAL_Z0 + CANAL_Z1) / 2 + Math.sin(this.orbitA * 1.7) * 3.2);
        speed = 1.4;
        if (tg && this.cool <= 0 && (tg.swimming || this.hunger > 0.35)) { this.target = tg; this.setState(tg.swimming ? 'stalk' : Math.random() < 0.45 ? 'surface' : 'stalk'); }
        else if (this.t > 18 && Math.random() < dt * 0.04) this.setState('surface');
        break;
      }
      case 'surface': {
        // rise beside the raft / the team, hang just under the surface and stare
        const p = this.target?.pl?.pos || _v.set(cx, 0, (CANAL_Z0 + CANAL_Z1) / 2);
        const side = this.pos.z < (CANAL_Z0 + CANAL_Z1) / 2 ? -1 : 1;
        want.set(p.x + 3.2 * Math.sign(this.pos.x - p.x || 1), wl - 0.55, clamp(p.z + side * 2.8, CANAL_Z0 + 1, CANAL_Z1 - 1));
        speed = 1.0;
        if (this.t > 1 && this.t < 1.1 && !this._splashed) { this._splashed = true; mgr.fx('rise', this.pos); }
        if (this.t > 7 + Math.random() * 3) {
          const tgt = this.pickTarget(players);
          if (tgt && this.cool <= 0 && (tgt.swimming || tgt.onRaft || tgt.edge) && Math.random() < 0.7) { this.target = tgt; this.setState('lunge'); }
          else this.setState('dive');
        }
        break;
      }
      case 'stalk': {
        const t = this.target?.pl;
        if (!t || !this.pickTarget(players)) { this.setState('dive'); break; }
        // circle in beneath, closing in
        this.orbitA += dt * 0.6;
        const r = Math.max(1.6, 6 - this.t * 0.7);
        want.set(t.pos.x + Math.cos(this.orbitA) * r, Math.min(wl - 1.1, t.pos.y - 1.6), clamp(t.pos.z + Math.sin(this.orbitA) * r, CANAL_Z0 + 1, CANAL_Z1 - 1));
        speed = 2.4;
        if (this.t > 4 + Math.random() * 2) this.setState('lunge');
        break;
      }
      case 'lunge': {
        const tg2 = this.target;
        const t = tg2?.pl;
        if (!t) { this.setState('dive'); break; }
        const aim = _v.copy(t.pos);
        aim.y = Math.min(wl - 0.3, t.pos.y + 0.6);
        if (tg2.edge) aim.z = clamp(aim.z, CANAL_Z0 + 0.8, CANAL_Z1 - 0.8);
        want.copy(aim);
        speed = 7.5;
        const d = Math.hypot(this.pos.x - t.pos.x, this.pos.z - t.pos.z);
        if (!this.bit && d < 2.6 && Math.abs(this.pos.y - aim.y) < 1.6) {
          this.bit = true;
          this.cool = Math.max(9, 26 - day * 2.5) + Math.random() * 8;
          this.hunger *= 0.3;
          mgr.strike(this, tg2);
        }
        if (this.bit && this.t > 0.9) this.setState('dive');
        if (this.t > 4.5) { this.cool = 6; this.setState('dive'); }
        break;
      }
      case 'dive':
      case 'flee': {
        want.set(this.pos.x + Math.cos(this.yaw + Math.PI / 2) * 3, CANAL_Y + 0.9, this.pos.z);
        speed = this.state === 'flee' ? 4 : 2.2;
        if (this.t > 3.5) this.setState('lurk');
        break;
      }
      default: this.setState('lurk');
    }
    if (this.stunT > 0) speed *= 0.3;
    // steer
    this.bounds(want);
    const dx = want.x - this.pos.x, dy = want.y - this.pos.y, dz = want.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, dt * (this.state === 'lunge' ? 4 : 1.4));
    this.vel.x += ((dx / d) * speed - this.vel.x) * k;
    this.vel.y += ((dy / d) * speed * 0.7 - this.vel.y) * k;
    this.vel.z += ((dz / d) * speed - this.vel.z) * k;
    if (d < 0.6) this.vel.multiplyScalar(Math.exp(-dt * 2));
    this.pos.addScaledVector(this.vel, dt);
    this.bounds(this.pos);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.15) this.yaw = angLerp(this.yaw, Math.atan2(-this.vel.x, -this.vel.z), Math.min(1, dt * (this.state === 'lunge' ? 6 : 2)));
    this.pitch += (clamp(Math.atan2(this.vel.y, Math.max(0.3, hs)), -0.6, 0.6) - this.pitch) * Math.min(1, dt * 3);
  }

  setState(s) {
    this.state = s;
    this.t = 0;
    this.bit = false;
    this._splashed = false;
    if (s === 'lunge') this.mgr.fx('lunge', this.pos);
  }

  snapshot() {
    return [this.id, +this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2), +this.yaw.toFixed(2), +this.pitch.toFixed(2), this.state, +this.mouth.toFixed(2), +this.reach.toFixed(2), +this.surge.toFixed(2)];
  }
}

// ===========================================================================
// View (every peer)
class GoldfishView {
  constructor(mgr, s) {
    this.mgr = mgr;
    this.id = s[0];
    this.fish = buildGoldfish(this.id);
    this.root = this.fish.root;
    this.pos = new THREE.Vector3(s[1], s[2], s[3]);
    this.prev = this.pos.clone();
    this.yaw = s[4];
    this.pitch = s[5];
    this.buf = [];
    this.time = 0;
    this.snap = s;
    this.root.position.copy(this.pos);
    mgr.world.group.add(this.root);
    mgr.world.registerDynamic(this.root);
    this.rippleT = 0;
    this.bubbleT = 0;
  }

  push(s) {
    this.buf.push({ t: this.time, s });
    if (this.buf.length > 8) this.buf.shift();
    this.snap = s;
  }

  update(dt) {
    this.time += dt;
    const rt = this.time - 0.14;
    let a = null, b = null;
    for (let i = this.buf.length - 1; i >= 0; i--) if (this.buf[i].t <= rt) { a = this.buf[i]; b = this.buf[i + 1] || null; break; }
    if (!a) a = this.buf[0];
    this.prev.copy(this.pos);
    if (a && b) {
      const k = clamp((rt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
      this.pos.set(a.s[1], a.s[2], a.s[3]).lerp(_v.set(b.s[1], b.s[2], b.s[3]), k);
      this.yaw = angLerp(a.s[4], b.s[4], k);
      this.pitch = a.s[5] + (b.s[5] - a.s[5]) * k;
    } else if (a) {
      this.pos.lerp(_v.set(a.s[1], a.s[2], a.s[3]), Math.min(1, dt * 8));
      this.yaw = angLerp(this.yaw, a.s[4], Math.min(1, dt * 8));
    }
    while (this.buf.length > 3 && this.buf[1].t < rt) this.buf.shift();
    const sp = this.prev.distanceTo(this.pos) / Math.max(dt, 1e-3);
    this.root.position.copy(this.pos);
    this.root.rotation.set(-this.pitch, this.yaw, 0, 'YXZ');
    const s = this.snap;
    const lvl = this.mgr.level;
    const cam = engine.camera.position;
    const dCam = this.pos.distanceTo(cam);
    this.root.visible = dCam < 45;
    if (this.root.visible) this.fish.update(dt, { speed: sp, turn: 0, mouth: s[7], reach: s[8], surge: s[9], lookAt: dCam < 30 ? cam : null });
    // near the surface it pushes the water around
    const wl = lvl.waterLevel;
    const nearTop = this.pos.y > wl - 1.3;
    this.rippleT -= dt;
    if (nearTop && this.rippleT <= 0) {
      this.rippleT = 0.25 + Math.random() * 0.3;
      const f = _v2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      lvl.ripple(this.pos.x + f.x * 1.5, this.pos.z + f.z * 1.5, 0.7 + sp * 0.25);
      lvl.ripple(this.pos.x - f.x * 1.8, this.pos.z - f.z * 1.8, 0.5 + sp * 0.15);
    }
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 0.8 + Math.random() * 2.5;
      if (dCam < 20) {
        const p = _v2.set(this.pos.x + (Math.random() - 0.5), wl + 0.02, this.pos.z + (Math.random() - 0.5));
        lvl.ripple(p.x, p.z, 0.4);
        if (Math.random() < 0.4) audio.play('bubble', { pos: p, volume: nearTop ? 0.7 : 0.35, pitch: 0.6 });
      }
    }
  }

  dispose() {
    this.mgr.world.unregisterDynamic(this.root);
    this.fish.dispose();
  }
}

// ===========================================================================
// Leeches (local)
let _leechGeo = null, _leechMat = null;
function leechGeometry() {
  if (_leechGeo) return _leechGeo;
  // segmented, flattened body along -z (head) .. +z (sucker), 11 cm
  const prof = [];
  const n = 14;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const r = 0.011 + 0.012 * Math.sin(Math.min(1, t * 1.05) * Math.PI) * (0.85 + 0.15 * Math.cos(t * 40));
    prof.push(new THREE.Vector2(Math.max(0.002, r), (t - 0.5) * 0.11));
  }
  const g = new THREE.LatheGeometry(prof, 10);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.55, 1);
  // stripes via vertex colours
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), y = pos.getY(i);
    const stripe = Math.abs(Math.sin(z * 260)) > 0.85 ? 1 : 0;
    const back = y > 0 ? 1 : 0;
    const orange = back && Math.abs(pos.getX(i)) > 0.005 && Math.abs(pos.getX(i)) < 0.009 ? 1 : 0;
    col[i * 3] = 0.05 + stripe * 0.04 + orange * 0.55 + (1 - back) * 0.08;
    col[i * 3 + 1] = 0.06 + stripe * 0.03 + orange * 0.25 + (1 - back) * 0.06;
    col[i * 3 + 2] = 0.035 + (1 - back) * 0.03;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.userData.shared = true;
  _leechGeo = g;
  return g;
}
function leechMaterial() {
  return _leechMat || (_leechMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0, name: 'pool_leech' }));
}
export { leechGeometry, leechMaterial };

const MAX_LEECH = 10;

class Leeches {
  constructor(mgr) {
    this.mgr = mgr;
    this.list = [];       // swimming: {pos, yaw, ph, speed, state, t}
    this.latched = [];    // {t, off: Vector3, ph}
    this.mesh = new THREE.InstancedMesh(leechGeometry(), leechMaterial(), MAX_LEECH);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    mgr.world.group.add(this.mesh);
    mgr.world.registerDynamic(this.mesh);
    this.spawnT = 3;
    this.drainT = 0;
    this.prompted = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  update(dt) {
    const lvl = this.mgr.level, l = lvl.game.local;
    const wl = lvl.waterLevel;
    const inWater = !l.dead && l.waterDepth > 0.12 && l.pos.y < wl + 0.05 && !l.onRaft;
    const infected = lvl.waterInfected(l.pos.x, l.pos.z);
    // spawn around a clone in the water (more in contaminated, overgrown water)
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = infected ? 2.5 : 5;
      if (inWater && this.list.length < (infected ? 5 : 3) && this.latched.length < 6 && Math.random() < (infected ? 0.75 : 0.4) + lvl.game.day.instability() * 0.2) {
        const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 4;
        const x = l.pos.x + Math.cos(a) * d, z = l.pos.z + Math.sin(a) * d;
        if (lvl.waterDepth(x, z) > 0.15) this.list.push({ pos: new THREE.Vector3(x, Math.max(lvl.floorY(x, z) + 0.05, wl - 0.25 - Math.random() * 0.6), z), yaw: Math.random() * 6.28, ph: Math.random() * 6, speed: 0.3, t: 0 });
      }
    }
    // swim toward the clone, latch on
    const tgt = _v.set(l.pos.x, Math.min(wl - 0.1, l.pos.y + 0.35), l.pos.z);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      e.ph += dt * 9;
      const d = e.pos.distanceTo(tgt);
      if (d > 14 || e.t > 60 || lvl.waterDepth(e.pos.x, e.pos.z) < 0.08) { this.list.splice(i, 1); continue; }
      const chase = inWater && d < 6;
      const want = chase ? Math.atan2(tgt.x - e.pos.x, tgt.z - e.pos.z) : e.yaw + Math.sin(e.t * 0.7 + i) * 0.6;
      e.yaw = angLerp(e.yaw, want, Math.min(1, dt * 3));
      e.speed += ((chase ? 0.75 : 0.18) - e.speed) * Math.min(1, dt * 2);
      const wig = Math.sin(e.ph) * 0.5;
      e.pos.x += Math.sin(e.yaw + wig * 0.4) * e.speed * dt;
      e.pos.z += Math.cos(e.yaw + wig * 0.4) * e.speed * dt;
      if (chase) e.pos.y += (tgt.y - e.pos.y) * Math.min(1, dt * 1.5);
      if (chase && d < 0.45) {
        this.list.splice(i, 1);
        const a = Math.random() * Math.PI * 2;
        this.latched.push({ t: 0, off: new THREE.Vector3(Math.cos(a) * 0.3, 0.15 + Math.random() * 0.75, Math.sin(a) * 0.3), ph: Math.random() * 6 });
        audio.play('_squelch', { volume: 0.7 });
        l.shake = Math.max(l.shake || 0, 0.25);
        l.survival.bleed = Math.max(l.survival.bleed, 1);
        lvl.game.ui.toast(this.latched.length > 1 ? `${this.latched.length} LEECHES ON YOU — [${lvl.keyName()}] pull them off` : `A LEECH LATCHED ON — [${lvl.keyName()}] to pull it off`, 'bad');
        lvl.game.healthity?.say?.('hurt');
      }
    }
    // latched: drain blood, seed infection, gnaw on sanity
    if (this.latched.length && !l.dead) {
      const s = l.survival, n = this.latched.length;
      s.blood = Math.max(0, s.blood - dt * 2.6 * n);
      s.infection = Math.min(100, s.infection + dt * (infected ? 0.09 : 0.04) * n);
      s.sanity = Math.max(0, s.sanity - dt * 0.12 * n);
      s.bleed = Math.max(s.bleed, 1);
      s.bleedTimer = Math.min(s.bleedTimer, 20);
      for (const e of this.latched) e.t += dt;
    }
    if (l.dead) this.latched.length = 0;
    // pull one off: E with nothing else in focus
    const focusFree = !l.focus && !l.dead && !l.watchOpen;
    if (this.latched.length && focusFree) {
      lvl.setPrompt(`[${lvl.keyName()}] Pull off the leech${this.latched.length > 1 ? ` (${this.latched.length})` : ''}`, 'leech');
      if (lvl.interactPressed()) this.pullOff();
    } else lvl.clearPrompt('leech');
    this._draw();
  }

  pullOff() {
    const lvl = this.mgr.level, l = lvl.game.local;
    this.latched.shift();
    const s = l.survival;
    s.damage(2, 'blunt', { cause: 'a leech' });
    s.blood = Math.max(0, s.blood - 40);
    l.shake = Math.max(l.shake || 0, 0.3);
    audio.play('_squelch', { volume: 0.9 });
    audio.play('_tear', { volume: 0.5 });
    lvl.world.fx.blood(_v.copy(l.pos).setY(l.pos.y + 0.8), 6);
    const item = { type: 'leech', state: {} };
    if (l.inv.hasFree()) {
      l.inv.add(item);
      lvl.game.ui.toast('Pulled off a fat, writhing leech. (+ LEECH — edible?)');
    } else {
      l.dropItem(item, true);
      lvl.game.ui.toast('Pulled off a leech and flung it away');
    }
    if (!this.latched.length) lvl.game.healthity?.say?.('bandaged');
  }

  _draw() {
    const lvl = this.mgr.level, l = lvl.game.local;
    let k = 0;
    const m = this._m, q = this._q, sc = this._s;
    const cam = engine.camera.position;
    for (const e of this.list) {
      if (k >= MAX_LEECH) break;
      if (e.pos.distanceToSquared(cam) > 15 * 15) continue;
      const pulse = 1 + Math.sin(e.ph) * 0.18;
      q.setFromEuler(new THREE.Euler(Math.sin(e.ph * 0.5) * 0.2, e.yaw + Math.PI, Math.sin(e.ph) * 0.3));
      sc.set(1 / Math.sqrt(pulse), 1, pulse);
      m.compose(e.pos, q, sc);
      this.mesh.setMatrixAt(k++, m);
    }
    // latched ones cling to the clone (seen in third person / by the wrist when glancing down)
    if (l.thirdPerson || engine.camera.position.y - l.pos.y < 1.3) {
      for (const e of this.latched) {
        if (k >= MAX_LEECH) break;
        const pulse = 1 + Math.sin(e.t * 6 + e.ph) * 0.25;
        _look.set(l.pos.x + e.off.x, l.pos.y + e.off.y, l.pos.z + e.off.z);
        q.setFromEuler(new THREE.Euler(-1.2, Math.atan2(e.off.x, e.off.z), Math.sin(e.t * 3 + e.ph) * 0.3));
        sc.set(1, 1, pulse);
        m.compose(_look, q, sc);
        this.mesh.setMatrixAt(k++, m);
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mgr.world.unregisterDynamic(this.mesh);
    this.mesh.removeFromParent();
  }
}

// ===========================================================================
export class PoolCreatures {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.agents = new Map();
    this.views = new Map();
    this.nextId = 1;
    this.snapT = 0;
    this.spawnT = 6;
    this.leeches = new Leeches(this);
    net.onClient('pfish', (list) => this._onSnap(list));
    net.onClient('pbite', (d) => this._onBite(d));
    net.onClient('pfishfx', (d) => this._onFx(d));
  }

  alivePlayers() { return this.level.monsters?.alivePlayers() || []; }

  fx(kind, pos) { net.toAll('pfishfx', { k: kind, p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)] }); }

  _onFx(d) {
    const lvl = this.level, p = new THREE.Vector3(d.p[0], lvl.waterLevel, d.p[2]);
    if (d.k === 'rise') {
      audio.play('water_glug', { pos: p, volume: 0.9, pitch: 0.55 });
      audio.play('_gurgle', { pos: p, volume: 0.8 });
      lvl.ripple(p.x, p.z, 1.6);
    } else if (d.k === 'lunge') {
      audio.play('bacteria_growl', { pos: p, volume: 1, pitch: 0.42 });
      audio.play('water_splash_big', { pos: p, volume: 0.9 });
      lvl.ripple(p.x, p.z, 1.8);
      this.world.fx.splash(p.setY(lvl.waterLevel + 0.05), 30, lvl.waterLevel);
    } else if (d.k === 'bite') {
      audio.play('bacteria_attack', { pos: p, volume: 1, pitch: 0.5 });
      audio.play('water_splash_big', { pos: p, volume: 1 });
      this.world.fx.splash(p.setY(lvl.waterLevel + 0.05), 50, lvl.waterLevel);
      this.world.fx.blood(p.setY(lvl.waterLevel + 0.3), 18);
      lvl.ripple(p.x, p.z, 2.2);
    }
  }

  // host: the fish reached its target
  strike(a, tg) {
    const lvl = this.level, pl = tg.pl;
    const day = this.game.day.day;
    const dir = _v.set(pl.pos.x - a.pos.x, 0, pl.pos.z - a.pos.z).normalize();
    this.fx('bite', pl.pos);
    this.world.noise.emit(pl.pos.clone(), 30, 'splash');
    if (tg.onRaft && lvl.raft) {
      lvl.raft.ram(dir, 1.1 + day * 0.08);
      // only snaps at riders standing near the side
      const loc = lvl.raft.toLocal(pl.pos, _v2);
      if (Math.abs(loc.z) < 0.85 && Math.abs(loc.x) < 1.2 && Math.random() < 0.7) return;
    }
    const dmg = (tg.swimming ? 26 : 17) + day * 2;
    const d = { dmg, from: a.pos.toArray(), drag: tg.swimming ? 1 : tg.edge ? 0.8 : 0.5, dir: [dir.x, dir.z] };
    if (pl.id === net.selfId) this._onBite(d);
    else net.toPeer(pl.id, 'pbite', d);
  }

  // local: you were bitten
  _onBite(d) {
    const l = this.game.local;
    if (l.dead) return;
    const died = l.survival.damage(d.dmg, 'bite', { cause: 'the goldfish' });
    l.survival.bleed = Math.max(l.survival.bleed, 2);
    l.survival.sanity = Math.max(0, l.survival.sanity - 12);
    l.survival.stamina = Math.max(0, l.survival.stamina - 12);
    l.shake = 1.2;
    audio.play('hurt', { volume: 1 });
    audio.play('gasp', { volume: 0.8 });
    engine.post.params.uFlash && (engine.post.params.uFlash.value = Math.max(engine.post.params.uFlash.value, 0.15));
    // dragged toward the water and under
    const k = 3.5 * (d.drag ?? 1);
    l.applyYank?.([-d.dir[0] * k, d.drag >= 1 ? -2.5 : 1.5, -d.dir[1] * k]);
    if (d.drag >= 1) l.vel.y = -3;
    this.game.healthity?.say?.('hurt');
    this.game.ui.toast('SOMETHING ENORMOUS BIT YOU', 'bad');
    if (died) l.onDeath('the goldfish');
  }

  // a flashlight beam or a flare in its face makes it back off (host)
  hit(id) {
    const a = this.agents.get(id);
    if (!a) return;
    a.stunT = 2;
    a.setState('flee');
  }

  _hostSpawn(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 5;
    const players = this.alivePlayers();
    if (!players.length) return;
    let cx = 0;
    for (const p of players) cx += p.pos.x;
    cx /= players.length;
    const day = this.game.day.day;
    const want = day >= 5 ? 2 : 1;
    // it follows the team: if they got far ahead, it quietly reappears deep beneath them
    for (const a of this.agents.values()) {
      if (Math.abs(a.pos.x - cx) > 55 && a.state === 'lurk') {
        a.pos.set(Math.max(CANAL_X0 + 10, cx - 18), CANAL_Y + 0.8, (CANAL_Z0 + CANAL_Z1) / 2);
      }
    }
    if (this.agents.size < want && cx > 4) {
      const x = Math.max(CANAL_X0 + 12, cx + (this.agents.size ? -20 : 22));
      const a = new GoldfishAI(this, this.nextId++, new THREE.Vector3(x, CANAL_Y + 0.8, (CANAL_Z0 + CANAL_Z1) / 2));
      a.cool = this.agents.size ? 40 : 25;
      this.agents.set(a.id, a);
    }
  }

  update(dt) {
    if (net.isHost && !this.game.isLobby) {
      this._hostSpawn(dt);
      for (const a of this.agents.values()) a.update(Math.min(dt, 0.05));
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / 15;
        net.toAll('pfish', [...this.agents.values()].map((a) => a.snapshot()));
      }
    }
    for (const v of this.views.values()) v.update(dt);
    this.leeches.update(dt);
    // fear: being near the thing (and seeing it) eats at sanity
    const l = this.game.local;
    for (const v of this.views.values()) {
      const d = v.pos.distanceTo(l.pos);
      if (d < 8) l.survival.stress = Math.min(1, l.survival.stress + dt * 0.3 * (1 - d / 8));
    }
  }

  _onSnap(list) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s[0]);
      let v = this.views.get(s[0]);
      if (!v) { v = new GoldfishView(this, s); this.views.set(s[0], v); }
      v.push(s);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
  }

  photoSubjects(camera, consider) {
    for (const v of this.views.values()) {
      const head = _v.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw)).multiplyScalar(1.6).add(v.pos);
      consider(head.clone(), 'THE GOLDFISH (MUTATED)', `fish:${v.id}`, v.pos.y > this.level.waterLevel - 1.2 ? 260 : 120);
    }
    void camera;
  }

  debugSpawn(pos) {
    if (!net.isHost) return null;
    const a = new GoldfishAI(this, this.nextId++, pos);
    a.cool = 0;
    this.agents.set(a.id, a);
    return a;
  }

  dispose() {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.agents.clear();
    this.leeches.dispose();
    for (const t of ['pfish', 'pbite', 'pfishfx']) net.clientHandlers.delete(t);
  }
}
