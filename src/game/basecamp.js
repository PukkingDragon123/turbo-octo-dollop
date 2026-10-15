// Camp systems shared by every dimension that has monsters:
//  - SAFE ZONES: world.safeZones = [{pos, r}] (+ world.isSafe(pos)). Distorters register their field
//    here; every creature treats a field as a wall (creatures/agent.js), can't hear or see through it,
//    and can't hurt anyone standing inside. Clones inside slowly calm down.
//  - DISTORTER prop: set it down upright and still -> spins up (2 s) -> 7 m field with a warped-air dome.
//    Runs on charge (12 min, minus a bit every time it throws a creature back); a battery or a wire
//    spool tops it up. Picking it up / knocking it over drops the field.
//  - WHEEL TROLLEY prop: one rigid body that only turns about Y, frictionless ball "wheels", grippy deck,
//    sideways damping like fixed casters, wheels kept on the floor while someone pushes it, and loads on
//    the deck dragged along with it (with the reaction pushed back into the cart).
//  - FIELD WORKBENCH prop: the camp's crafting bench (same station as the level's workbenches); one is
//    put down at the team's camp automatically if the camp has none.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { RAPIER, Q } from '../physics/physics.js';
import { CrtScreen } from '../ui/crt.js';
import { zoneAt } from './creatures/agent.js';
import { CraftStation } from './crafting.js';
import { modelHalfHeight } from '../entities/catalog.js';

export const SAFE_R = 7;
const CHARGE_LIFE = 12 * 60;      // seconds of field on a full charge
const REPEL_COST = 0.015;         // charge lost per creature thrown back
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export function isSafe(world, pos, margin = 0) { return !!zoneAt(world, pos, margin); }

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ---------------------------------------------------------------------------
// warped-air dome: additive fresnel shell with crawling interference bands, a pulse rising from the
// floor, a ring marking the edge on the floor, and a bright splash where a creature hits it
let _domeGeo = null, _ringGeo = null;
const DOME_VS = /* glsl */`
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vL;
  uniform float uT;
  void main() {
    vec3 p = position;
    // the air shivers: slow wobble of the shell
    float w = sin(p.y * 9.0 + uT * 2.3) * sin(atan(p.z, p.x) * 7.0 - uT * 1.7);
    p += normal * w * 0.012;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vW = wp.xyz;
    vL = position;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const DOME_FS = /* glsl */`
  uniform float uT;
  uniform float uVis;
  uniform vec3 uCol;
  uniform vec4 uZap;
  uniform float uFlicker;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vL;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    vec3 N = normalize(vN);
    float facing = abs(dot(N, V));
    float fres = pow(1.0 - facing, 2.2);
    vec3 p = normalize(vL);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);
    float n = vnoise(p * 7.0 + vec3(0.0, -uT * 0.6, uT * 0.2));
    float n2 = vnoise(p * 23.0 + vec3(uT * 0.9, 0.0, 0.0));
    // interference bands crawling upward, broken up by noise
    float bands = pow(0.5 + 0.5 * sin(lat * 46.0 - uT * 2.6 + n * 5.0), 10.0);
    // a pulse ring rising from the floor every 2.4 s
    float ph = fract(uT / 2.4);
    float ring = smoothstep(0.07, 0.0, abs(p.y - ph * 0.98)) * (1.0 - ph);
    // where a creature hit the field: bright crackling splash
    float zap = 0.0;
    if (uZap.w < 1.0) {
      float d = 1.0 - dot(p, normalize(uZap.xyz));
      zap = smoothstep(0.35, 0.0, d) * (1.0 - uZap.w) * (0.55 + 0.45 * sin(lon * 40.0 + lat * 30.0 + uT * 50.0)) * 2.5;
    }
    float base = smoothstep(0.0, 0.08, p.y);   // meet the floor softly
    float a = (fres * 0.5 + bands * 0.1 * (0.3 + fres) + ring * 0.3 + (n2 - 0.5) * 0.06 + n * 0.035) * base;
    a = a * uVis * uFlicker + zap * uVis;
    // fade with distance like the haze (additive: scale, don't fog-mix)
    float dist = length(cameraPosition - vW);
    a *= exp(-dist * dist * 0.0009);
    vec3 col = mix(uCol, vec3(1.0, 0.95, 1.0), clamp(zap * 0.6 + ring * 0.3, 0.0, 1.0));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.5));
  }`;
const RING_FS = /* glsl */`
  uniform float uT;
  uniform float uVis;
  uniform vec3 uCol;
  uniform float uFlicker;
  varying vec3 vW;
  varying vec3 vL;
  void main() {
    float r = length(vL.xy);
    float edge = smoothstep(0.93, 0.995, r) * smoothstep(1.0, 0.995, r);
    float inner = smoothstep(0.6, 1.0, r) * 0.06;
    float ang = atan(vL.y, vL.x);
    float dash = 0.6 + 0.4 * step(0.0, sin(ang * 60.0 - uT * 3.0));
    float a = (edge * dash * 0.9 + inner) * uVis * uFlicker;
    float dist = length(cameraPosition - vW);
    a *= exp(-dist * dist * 0.0009);
    gl_FragColor = vec4(uCol, a);
  }`;
const RING_VS = /* glsl */`
  varying vec3 vW;
  varying vec3 vL;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vL = position;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

function makeDome() {
  if (!_domeGeo) {
    _domeGeo = new THREE.SphereGeometry(1, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    _domeGeo.userData.shared = true;
    _ringGeo = new THREE.CircleGeometry(1, 64);
    _ringGeo.userData.shared = true;
  }
  const uniforms = {
    uT: { value: 0 }, uVis: { value: 0 }, uCol: { value: new THREE.Color(0.55, 0.7, 1.0) },
    uZap: { value: new THREE.Vector4(1, 0, 0, 1) }, uFlicker: { value: 1 },
  };
  const common = { uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
  const dome = new THREE.Mesh(_domeGeo, new THREE.ShaderMaterial({ ...common, side: THREE.DoubleSide, vertexShader: DOME_VS, fragmentShader: DOME_FS }));
  const ring = new THREE.Mesh(_ringGeo, new THREE.ShaderMaterial({ ...common, vertexShader: RING_VS, fragmentShader: RING_FS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  ring.rotation.x = -Math.PI / 2;
  for (const m of [dome, ring]) { m.frustumCulled = true; m.renderOrder = 5; m.userData.noProbe = true; m.visible = false; }
  dome.name = 'distorter_dome';
  return { dome, ring, uniforms };
}

// ---------------------------------------------------------------------------
class DistorterBehaviour {
  constructor(p, sys) {
    this.p = p;
    this.sys = sys;
    this.world = sys.world;
    this.zone = { pos: new THREE.Vector3(), r: SAFE_R, id: p.id, src: this };
    this.restT = 0;
    this.vis = 0;
    this.spin = 0;
    this.t = Math.random() * 10;
    this.local = p.state.charge ?? 1;   // host: drained charge (sent when it moved enough)
    this.sent = this.local;
    this.pulseT = 0;
    this.zapAge = 1;
    this.hum = null;
    this.parts = p.model.parts || {};
    const d = makeDome();
    this.dome = d;
    this.world.group.add(d.dome, d.ring);
    sys.distorters.add(this);
  }

  get charge() { return this.p.state.charge ?? 1; }

  update(dt) {
    const p = this.p, st = p.state;
    this.t += dt;
    if (net.isHost && p.body) this._host(dt);
    // zone registry from replicated state + position (identical rule on every peer)
    const zones = this.world.safeZones;
    const i = zones.indexOf(this.zone);
    if (st.on) {
      this.zone.pos.copy(p.root.position);
      this.zone.r = SAFE_R * (0.8 + 0.2 * Math.min(1, this.charge * 5));
      if (i < 0) zones.push(this.zone);
    } else if (i >= 0) zones.splice(i, 1);
    // ---- visuals ----
    const on = st.on ? 1 : 0;
    this.vis = damp(this.vis, on, on ? 1.6 : 4, dt);
    const low = this.charge < 0.15;
    const flicker = low ? 0.55 + 0.45 * (Math.sin(this.t * 31) > -0.2 ? 1 : 0) : 1;
    this.spin += dt * (0.4 + this.vis * 16);
    const P = this.parts;
    if (P.coil) P.coil.rotation.y = this.spin;
    if (P.lamp?.material) P.lamp.material.emissiveIntensity = st.on ? (Math.sin(this.t * 6) > 0 ? 6 : 0.4) : (this.charge > 0 ? 0.25 : 0);
    if (P.tube?.material) P.tube.material.emissiveIntensity = 0.2 + this.vis * 3.5 * flicker * (0.85 + 0.15 * Math.sin(this.t * 23));
    if (P.needle) P.needle.rotation.z = 1.1 - Math.min(1, this.charge) * 2.2 + Math.sin(this.t * 13) * 0.02 * this.vis;
    const D = this.dome;
    D.uniforms.uT.value = this.t;
    D.uniforms.uVis.value = this.vis;
    D.uniforms.uFlicker.value = flicker;
    this.zapAge = Math.min(1, this.zapAge + dt * 1.6);
    D.uniforms.uZap.value.w = this.zapAge;
    const vis = this.vis > 0.01;
    D.dome.visible = D.ring.visible = vis;
    if (vis) {
      const r = this.zone.r * (0.55 + 0.45 * Math.min(1, this.vis * 1.3));
      const fy = p.root.position.y - (p.model.halfHeight ?? 0.2);
      D.dome.position.set(p.root.position.x, fy, p.root.position.z);
      D.dome.scale.set(r, r * 0.62, r);
      D.ring.position.set(p.root.position.x, fy + 0.012, p.root.position.z);
      D.ring.scale.setScalar(r);
    }
    // ---- sound: hum + a pulse with every ring ----
    const near = this.world.game.local.pos.distanceTo(p.root.position) < 26;
    if (this.vis > 0.05 && near) {
      if (!this.hum) this.hum = audio.loop('vending_hum', { pos: p.root.position.clone(), volume: 0.7, pitch: 0.55 });
      this.hum.setPosition(p.root.position);
      this.hum.setVolume(0.7 * this.vis);
      this.pulseT -= dt;
      if (this.pulseT <= 0) { this.pulseT = 2.4; audio.play('distorter_pulse', { pos: p.root.position, volume: 0.55 * this.vis }); }
    } else if (this.hum) { this.hum.stop(0.4); this.hum = null; }
  }

  _host(dt) {
    const p = this.p, st = p.state;
    const q = p.root.quaternion;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const held = p.isHeld();
    if (st.on) {
      this.local = Math.max(0, this.local - dt / CHARGE_LIFE);
      const ok = !held && p.speed < 0.9 && upY > 0.6 && !st.off && this.local > 0;
      if (!ok) {
        this.sent = this.local;
        this.world.props.setState(p.id, { on: 0, charge: +this.local.toFixed(3) });
        this.world.fxAll({ k: 'snd', n: 'distorter_off', p: p.root.position.toArray(), v: 1 });
        this.restT = 0;
      } else if (Math.abs(this.local - this.sent) > 0.01) {
        this.sent = this.local;
        this.world.props.setState(p.id, { charge: +this.local.toFixed(3) });
      }
    } else {
      const resting = !held && p.speed < 0.15 && upY > 0.85;
      if (resting && !st.off && this.local > 0.001) {
        this.restT += dt;
        if (this.restT > 2.2) {
          this.world.props.setState(p.id, { on: 1, charge: +this.local.toFixed(3) });
          this.world.fxAll({ k: 'snd', n: 'distorter_on', p: p.root.position.toArray(), v: 1 });
          this.world.noise.emit(p.root.position, 8, 'device');
        }
      } else this.restT = 0;
    }
  }

  // a creature was thrown back: costs a little charge
  drain(k = REPEL_COST) {
    if (!net.isHost) return;
    this.local = Math.max(0, this.local - k);
  }

  zap(edge) {
    const P = this.p.root.position;
    this.dome.uniforms.uZap.value.set(edge[0] - P.x, Math.max(0.15, (edge[1] - P.y) / Math.max(1, this.zone.r * 0.62)), edge[2] - P.z, 0);
    this.zapAge = 0;
    audio.play('distorter_zap', { pos: _v.fromArray(edge), volume: 1 });
  }

  prompt(player) {
    const pct = Math.round(this.charge * 100);
    const feed = this.charge < 0.9 ? this._feedItem(player) : null;
    const key = input.keyName('interact');
    if (feed) return `[${key}] Feed the distorter a ${feed === 'battery' ? 'battery' : 'wire spool'} (${pct}%)`;
    if (this.charge <= 0.001) return `Distorter flat — it needs a battery or wire spool`;
    if (this.p.state.on) return `[${key}] Switch the distorter off — field up, ${pct}%`;
    if (this.p.state.off) return `[${key}] Switch the distorter on (${pct}%)`;
    return `Distorter ${pct}% — set it down upright and leave it to power up`;
  }

  _feedItem(player) {
    const inv = player?.inv;
    if (!inv) return null;
    if (inv.find('battery') >= 0) return 'battery';
    if (inv.find('wire_spool') >= 0) return 'wire_spool';
    return null;
  }

  interact(player) {
    const feed = this.charge < 0.9 ? this._feedItem(player) : null;
    if (feed) {
      player.inv.remove(player.inv.find(feed));
      net.toHost('act', { k: 'p', id: this.p.id, a: 'feed', d: { t: feed } });
      audio.play('fuse_insert', { volume: 0.7 });
      return;
    }
    if (this.charge <= 0.001) return;
    net.toHost('act', { k: 'p', id: this.p.id, a: 'toggle' });
  }

  hostAction(a, d) {
    const st = this.p.state;
    if (a === 'feed') {
      this.local = Math.min(1, this.local + (d?.t === 'battery' ? 0.5 : 0.25));
      this.sent = this.local;
      this.world.props.setState(this.p.id, { charge: +this.local.toFixed(3) });
      this.world.fxAll({ k: 'sparks', p: this.p.root.position.toArray(), n: 8 });
    } else if (a === 'toggle') {
      if (st.on) {
        this.world.props.setState(this.p.id, { off: 1, on: 0, charge: +this.local.toFixed(3) });
        this.world.fxAll({ k: 'snd', n: 'distorter_off', p: this.p.root.position.toArray(), v: 1 });
      } else this.world.props.setState(this.p.id, { off: 0 });
    }
  }

  onGrabbed() { this.restT = 0; }

  dispose() {
    const zones = this.world.safeZones;
    const i = zones ? zones.indexOf(this.zone) : -1;
    if (i >= 0) zones.splice(i, 1);
    this.hum?.stop(0.2);
    this.hum = null;
    this.dome.dome.removeFromParent();
    this.dome.ring.removeFromParent();
    this.dome.dome.material.dispose();
    this.dome.ring.material.dispose();
    this.sys.distorters.delete(this);
  }
}

// ---------------------------------------------------------------------------
class TrolleyBehaviour {
  constructor(p, sys) {
    this.p = p;
    this.sys = sys;
    this.world = sys.world;
    const P = p.model.parts || {};
    this.wheels = ['w0', 'w1', 'w2', 'w3'].map((k) => P[k]).filter(Boolean);
    this.wheelR = p.model.anchors?.wheel?.y > 0 ? p.model.anchors.wheel.y : 0.075;
    this.spin = 0;
    this.prev = p.root.position.clone();
    const a = p.model.anchors || {};
    this.halfW = a.deckMax ? Math.abs(a.deckMax.x) : 0.36;
    this.halfL = a.deckMax ? Math.abs(a.deckMax.z) : 0.6;
    this.deckY = a.deckMax ? a.deckMax.y : 0.12;
    this.cargo = [];
    this.cargoT = 0;
    this.rollT = 0;
    this.load = 0;
    if (net.isHost && p.body) this._setup();
    sys.trolleys.add(this);
  }

  _setup() {
    const b = this.p.body;
    b.setEnabledRotations(false, true, false, true);
    b.setAngularDamping(3.5);
    b.setLinearDamping(0.35);
    for (let i = 0; i < b.numColliders(); i++) {
      const c = b.collider(i);
      if (c.shapeType() === RAPIER.ShapeType.Ball) {
        // wheels: no friction at all (rolling is the linear damping)
        c.setFriction(0);
        c.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
        c.setRestitution(0);
      } else {
        // deck / rails: grippy so loads stay put
        c.setFriction(1.2);
        c.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
      }
    }
  }

  // host, before every physics step
  step(dt) {
    const p = this.p, b = p.body;
    if (!b || p.dead || p.frozen || b.isSleeping()) return;
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _right.set(1, 0, 0).applyQuaternion(_q);
    const lv = b.linvel();
    const t = b.translation();
    // fixed casters: kill most sideways slip, keep rolling
    const vlat = lv.x * _right.x + lv.z * _right.z;
    const k = Math.min(1, 7 * dt);
    let vx = lv.x - _right.x * vlat * k, vy = lv.y, vz = lv.z - _right.z * vlat * k;
    // while someone pushes it, the wheels stay on the floor (a grab can't lift the cart into the air)
    if (p.isHeld()) {
      const hit = this.world.physics.raycast(_v.set(t.x, t.y + 0.1, t.z), _down, 1.6, Q.world);
      if (hit) {
        const want = hit.point.y + (p.model.halfHeight ?? 0.1);
        if (t.y > want + 0.015) vy = Math.min(vy, (want - t.y) * 14);
      }
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    // loads on the deck travel with it
    this.cargoT -= dt;
    if (this.cargoT <= 0) { this.cargoT = 0.2; this._findCargo(t); }
    if (!this.cargo.length) return;
    const av = b.angvel();
    const k2 = Math.min(1, 10 * dt);
    for (const c of this.cargo) {
      const cb = c.body;
      if (c.dead || !cb || c.isHeld() || c.frozen) continue;
      const ct = cb.translation(), cv = cb.linvel();
      const rx = ct.x - t.x, rz = ct.z - t.z;
      // deck velocity under the load: v + w x r (yaw only)
      const dvx = vx + av.y * rz - cv.x, dvz = vz - av.y * rx - cv.z;
      if (dvx * dvx + dvz * dvz < 4e-4) continue;
      if (cb.isSleeping()) cb.wakeUp();
      const m = cb.mass();
      cb.setLinvel({ x: cv.x + dvx * k2, y: cv.y, z: cv.z + dvz * k2 }, true);
      // ...and the cart pays for moving it (pushing a loaded trolley feels heavy)
      b.applyImpulse({ x: -dvx * k2 * m * 0.8, y: 0, z: -dvz * k2 * m * 0.8 }, true);
    }
  }

  _findCargo(t) {
    const out = this.cargo;
    out.length = 0;
    this.load = 0;
    _qi.copy(_q).invert();
    this.world.props.query(_v2.set(t.x, t.y, t.z), 2.2, (c) => {
      if (c === this.p || c.dead || !c.body || c.isHeld() || c.frozen || c.type === 'trolley') return;
      const lp = _v.copy(c.root.position).sub(_v2).applyQuaternion(_qi);
      if (Math.abs(lp.x) > this.halfW + 0.2 || Math.abs(lp.z) > this.halfL + 0.2) return;
      if (lp.y < this.deckY - 0.08 || lp.y > this.deckY + 1.9) return;
      out.push(c);
      this.load += c.body.mass();
    });
  }

  // every peer: wheel spin from the cart's travel, caster rattle
  update(dt) {
    const p = this.p;
    const pos = p.root.position;
    _right.set(0, 0, 1).applyQuaternion(p.root.quaternion);
    const d = (pos.x - this.prev.x) * _right.x + (pos.z - this.prev.z) * _right.z;
    const moved = Math.hypot(pos.x - this.prev.x, pos.z - this.prev.z);
    this.prev.copy(pos);
    if (moved > 1) return; // teleport
    this.spin += d / this.wheelR;
    for (const w of this.wheels) w.rotation.x = this.spin;
    const sp = moved / Math.max(dt, 1e-3);
    if (sp > 0.5) {
      this.rollT -= dt * Math.min(3, sp);
      if (this.rollT <= 0) {
        this.rollT = 0.9;
        if (pos.distanceTo(this.world.game.local.pos) < 18) audio.play('trolley_roll', { pos, volume: Math.min(0.9, 0.25 + sp * 0.18), intensity: Math.min(1, sp / 4) });
      }
    }
  }

  prompt() { return 'Wheel Trolley — grab the handle [hold LMB] to push; load furniture on the deck'; }

  dispose() { this.sys.trolleys.delete(this); }
}

// ---------------------------------------------------------------------------
class FieldBenchBehaviour {
  constructor(p, sys) {
    this.p = p;
    this.sys = sys;
    this.scr = new CrtScreen(512, 384, 'amber');
    this.scr.fps = 2;
    const sm = p.model.parts?.screen;
    if (sm) this.scr.attach(sm, 1.4);
    const top = p.model.anchors?.top ? p.model.anchors.top.clone() : new THREE.Vector3(0, 0.45, 0);
    this.station = new CraftStation(sys.world, {
      root: p.root, top, reach: 1.7, front: 1.15, title: 'FIELD WORKBENCH',
      send: (a, d) => net.toHost('act', { k: 'p', id: p.id, a, d }),
    });
  }
  prompt() { return `[${input.keyName('interact')}] Use field workbench — build from scavenged parts`; }
  interact() { this.station.open({ prop: this.p, screen: this.scr, mesh: this.p.model.parts?.screen }); }
  hostAction(a, d, from) { if (a === 'craft') this.station.hostCraft(d, from); }
  update(dt) {
    const g = this.sys.game;
    if (g.terminal.session?.prop === this.p) return;
    if (this.p.root.position.distanceTo(g.local.pos) > 9) return;
    this.station.drawIdle(this.scr, dt);
  }
  dispose() {
    this.scr.texture.dispose();
    this.scr.material?.dispose();
  }
}

// ---------------------------------------------------------------------------
export class BaseSystems {
  constructor(mgr) {
    this.mgr = mgr;
    this.world = mgr.world;
    this.level = mgr.level;
    this.game = mgr.game;
    this.world.safeZones = this.world.safeZones || [];
    this.world.isSafe = (pos, margin = 0) => isSafe(this.world, pos, margin);
    this.world.base = this;
    this.trolleys = new Set();
    this.distorters = new Set();
    this.benchCamps = new WeakSet();
    this.campT = 1;
    this.calmMsgT = 0;
    this.wasSafe = false;
    const props = this.world.props;
    props.registerBehaviour('distorter', (p) => new DistorterBehaviour(p, this));
    props.registerBehaviour('trolley', (p) => new TrolleyBehaviour(p, this));
    props.registerBehaviour('field_bench', (p) => new FieldBenchBehaviour(p, this));
    this._step = (dt) => { if (net.isHost) for (const t of this.trolleys) t.step(dt); };
    this.world.physics.beforeStep.push(this._step);
    net.onClient('dzap', (d) => this._zap(d));
  }

  isSafe(pos, margin = 0) { return isSafe(this.world, pos, margin); }

  // host: a creature bounced off a field
  onRepelled(z, edge, a) {
    void a;
    z.src?.drain?.();
    net.toAll('dzap', { id: z.id, p: [+edge.x.toFixed(2), +edge.y.toFixed(2), +edge.z.toFixed(2)] });
  }

  _zap(d) {
    const p = this.world.props.get(d.id);
    p?.custom?.zap?.(d.p);
  }

  playFx() {}

  update(dt) {
    // calm inside a field
    const l = this.game.local;
    if (l && !l.dead && l.survival) {
      const safe = this.world.safeZones.length && isSafe(this.world, l.pos);
      if (safe) {
        const s = l.survival;
        s.sanity = Math.min(100, s.sanity + dt * 0.6);
        s.stress = Math.max(0, (s.stress || 0) - dt * 0.25);
        if (!this.wasSafe && this.calmMsgT <= 0) {
          this.calmMsgT = 90;
          this.game.ui?.toast?.('Inside the distorter field. The air hums. You feel calmer.', 'good');
        }
      }
      this.wasSafe = !!safe;
      this.calmMsgT -= dt;
    }
    if (net.isHost) {
      this.campT -= dt;
      if (this.campT <= 0) { this.campT = 2; this._campBench(); }
    }
  }

  // host: make sure the team's camp has a workbench
  _campBench() {
    const camp = this.mgr.camp();
    if (!camp || this.benchCamps.has(camp) || camp.built === false) return;
    if (!this.level.isChunkLoaded?.(camp.pos.x, camp.pos.z)) return;
    let found = false;
    this.world.props.query(camp.pos, (camp.radius || 6) + 4, (p) => { if (p.type === 'field_bench') found = true; });
    for (const d of this.world.devices.values()) if (d.key === 'workbench' && d.root.position.distanceTo(camp.pos) < (camp.radius || 6) + 4) found = true;
    this.benchCamps.add(camp);
    if (found) return;
    const R = Math.min(3.4, Math.max(2.2, (camp.radius || 6) * 0.55));
    const hh = modelHalfHeight('field_bench');
    let best = null;
    for (let i = 0; i < 12; i++) {
      const a = 0.6 + (i / 12) * Math.PI * 2;
      const x = camp.pos.x + Math.cos(a) * R, z = camp.pos.z + Math.sin(a) * R;
      let blocked = false;
      this.world.physics.overlapBox(_v.set(x, 0.5, z), { x: 0.85, y: 0.4, z: 0.55 }, Q.solid, () => { blocked = true; });
      if (blocked) continue;
      best = [x, z];
      break;
    }
    if (!best) return;
    const yaw = Math.atan2(camp.pos.x - best[0], camp.pos.z - best[1]);
    this.world.props.spawn('field_bench', new THREE.Vector3(best[0], (camp.pos.y || 0) + hh + 0.02, best[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), { sleep: true });
  }

  // ---------------- console helpers (host) ----------------
  // pretend the team has a camp right here (until the real mission.camp exists)
  fakeCamp(radius = 6) {
    const l = this.game.local;
    this.mgr.fakeCamp = { pos: new THREE.Vector3(l.pos.x, 0, l.pos.z), radius, built: true };
    this.mgr.raidT = Math.min(this.mgr.raidT, 30);
    return this.mgr.fakeCamp;
  }

  // drop a prop `dist` m in front of the local player
  give(type = 'distorter', dist = 1.6, state = null) {
    const l = this.game.local;
    const hh = modelHalfHeight(type);
    const p = new THREE.Vector3(l.pos.x - Math.sin(l.yaw) * dist, l.pos.y + hh + 0.05, l.pos.z - Math.cos(l.yaw) * dist);
    return this.world.props.spawn(type, p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, l.yaw, 0)), { state: state || (type === 'distorter' ? { charge: 1 } : {}) });
  }

  // a pile of scavenged parts in front of the player
  parts(list = ['plank', 'plank', 'plank', 'metal_scrap', 'metal_scrap', 'screws', 'screws', 'wire_spool', 'wire_spool', 'fabric_scrap']) {
    list.forEach((t, i) => this.give(t, 1.2 + (i % 3) * 0.3));
  }

  dispose() {
    const i = this.world.physics.beforeStep.indexOf(this._step);
    if (i >= 0) this.world.physics.beforeStep.splice(i, 1);
    for (const d of [...this.distorters]) d.dispose();
    this.world.safeZones.length = 0;
    net.clientHandlers.delete('dzap');
    void engine;
  }
}
