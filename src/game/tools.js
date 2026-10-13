// Tool actions: welding (real fixed physics joints), multitool dismantling, sample collection
// and melee swings. Client side produces hold actions; the host owns the physical results.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { RAPIER, Q } from '../physics/physics.js';
import { audio } from '../audio/audio.js';
import { itemDef, SAMPLES } from './itemdefs.js';
import { profile } from '../core/profile.js';

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Tools {
  constructor(game) {
    this.game = game;
    this.weldProgress = new Map(); // host: playerId -> {id, t, last}
    this.beads = []; // visual weld beads {mesh, t}
    this._bound = false;
    this.weldLoop = null;
    this.bindHost();
  }

  bindHost() {
    // (re)bound every world because world.dispose clears handlers by name
    net.onHost('weldTick', (d, from) => this._hostWeldTick(d, from));
    net.onHost('dismantle', (d, from) => this._hostDismantle(d, from));
    net.onHost('hit', (d, from) => this._hostHit(d, from));
    net.onClient('welded', (d) => this._showBead(d));
  }

  get world() { return this.game.world; }

  _aim(range) {
    const cam = engine.camera;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const local = this.game.local;
    return this.world.physics.raycast(cam.position, _f, range, Q.all, null, (c) => c !== local.collider && !local._isGrabbedCollider(c));
  }

  begin(kind, item, player) {
    switch (kind) {
      case 'weld': return this._weldAction(item, player);
      case 'multitool': return this._multitoolAction(item, player);
      case 'sample': return this._sampleAction(item, player);
      case 'swing': this._swing(item, player); return null;
      default: return null;
    }
  }

  // ---------------- welding ----------------
  _weldAction(item) {
    if (item.state.fuel === undefined) item.state.fuel = 1;
    let sendT = 0, sparkT = 0;
    const act = {
      tick: (dt) => {
        if (item.state.fuel <= 0) {
          if (!act.warned) { this.game.ui.toast('Welder out of gas'); act.warned = true; }
          this._stopWeldLoop();
          return;
        }
        const hit = this._aim(1.7);
        if (!hit) { this._stopWeldLoop(); return; }
        item.state.fuel = Math.max(0, item.state.fuel - dt / 75);
        if (!this.weldLoop) this.weldLoop = audio.loop('weld', { pos: hit.point, volume: 0.8 });
        else this.weldLoop.setPosition(hit.point);
        sparkT -= dt;
        if (sparkT <= 0) {
          sparkT = 0.05;
          this.world.fx.weldSparks(hit.point, hit.normal);
        }
        sendT -= dt;
        if (sendT <= 0) {
          sendT = 0.1;
          const id = hit.ud?.kind === 'prop' ? hit.ud.prop.id : null;
          net.toHost('weldTick', { id, p: hit.point.toArray(), n: hit.normal.toArray() });
        }
        engine.post.params.uFlash.value = Math.max(engine.post.params.uFlash.value, 0.06 + Math.random() * 0.05);
      },
      end: () => this._stopWeldLoop(),
    };
    return act;
  }

  _stopWeldLoop() {
    if (this.weldLoop) { this.weldLoop.stop(0.15); this.weldLoop = null; }
  }

  _hostWeldTick(d, from) {
    const w = this.world;
    if (!w) return;
    const p = new THREE.Vector3().fromArray(d.p);
    w.noise.emit(p, 20, 'weld');
    // others see sparks
    net.toOthers('fx', { k: 'weld', p: d.p, nrm: d.n }, from);
    if (from !== net.selfId) w.playFx({ k: 'weld', p: d.p, nrm: d.n });
    if (w.level?.mission?.weldTick?.(p)) return;
    if (d.id == null) return;
    const prop = w.props.get(d.id);
    if (!prop || !prop.body) return;
    let st = this.weldProgress.get(from);
    const now = w.time;
    if (!st || st.id !== d.id || now - st.last > 0.4) st = { id: d.id, t: 0, last: now };
    st.t += now - st.last;
    st.last = now;
    this.weldProgress.set(from, st);
    if (st.t < 0.9) return;
    this.weldProgress.delete(from);
    // find what the weld point touches besides this prop
    let other = null, otherStatic = false;
    w.physics.overlapSphere(p, 0.16, Q.solid, (c, ud) => {
      if (ud?.kind === 'prop' && ud.prop.id !== prop.id && ud.prop.body) other = ud.prop;
      else if (ud?.kind === 'static' || ud?.kind === 'device') otherStatic = true;
    });
    if (!other && !otherStatic) {
      net.toPeer(from, 'hq', { text: 'Nothing to weld it to. Weld where two things touch.', from: 'WELDER' });
      return;
    }
    this.weld(prop, other, p);
    if (from === net.selfId) profile.unlock('welder');
    else net.toPeer(from, 'ach', 'welder');
  }

  // create a fixed joint between prop and other prop (or the world)
  weld(prop, other, point) {
    const w = this.world;
    const phys = w.physics;
    const b1 = prop.body;
    let b2;
    if (other) b2 = other.body;
    else {
      b2 = phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(point.x, point.y, point.z));
    }
    const t1 = b1.translation(), r1 = b1.rotation();
    const t2 = b2.translation(), r2 = b2.rotation();
    const q1 = new THREE.Quaternion(r1.x, r1.y, r1.z, r1.w);
    const q2 = new THREE.Quaternion(r2.x, r2.y, r2.z, r2.w);
    const a1 = point.clone().sub(new THREE.Vector3(t1.x, t1.y, t1.z)).applyQuaternion(q1.clone().invert());
    const a2 = point.clone().sub(new THREE.Vector3(t2.x, t2.y, t2.z)).applyQuaternion(q2.clone().invert());
    // frames: keep current relative orientation
    const f1 = new THREE.Quaternion();
    const f2 = q2.clone().invert().multiply(q1);
    const jd = RAPIER.JointData.fixed(
      { x: a1.x, y: a1.y, z: a1.z }, { x: f1.x, y: f1.y, z: f1.z, w: f1.w },
      { x: a2.x, y: a2.y, z: a2.z }, { x: f2.x, y: f2.y, z: f2.z, w: f2.w },
    );
    const joint = phys.world.createImpulseJoint(jd, b1, b2, true);
    const rec = { joint, a: prop.id, b: other ? other.id : null, anchor: other ? null : b2 };
    prop.welds = prop.welds || [];
    prop.welds.push(rec);
    if (other) { other.welds = other.welds || []; other.welds.push(rec); }
    prop.hp = Math.max(prop.hp, 140);
    prop.touched = true;
    net.toAll('welded', { a: prop.id, lp: a1.toArray() });
    w.fxAll({ k: 'snd', n: 'spark', p: point.toArray(), v: 0.8 });
  }

  unweld(prop) {
    const w = this.world;
    if (!prop.welds) return;
    for (const rec of prop.welds) {
      try { w.physics.world.removeImpulseJoint(rec.joint, true); } catch (e) { /* gone */ }
      if (rec.anchor) w.physics.removeBody(rec.anchor);
      const other = rec.b != null ? w.props.get(rec.a === prop.id ? rec.b : rec.a) : null;
      if (other?.welds) other.welds = other.welds.filter((x) => x !== rec);
    }
    prop.welds = [];
  }

  _showBead(d) {
    const p = this.world?.props.get(d.a);
    if (!p) return;
    const geo = new THREE.SphereGeometry(0.035, 8, 6);
    geo.scale(1.6, 0.6, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0xff7a20, emissiveIntensity: 3, roughness: 0.6, metalness: 0.8 });
    const m = new THREE.Mesh(geo, mat);
    m.position.fromArray(d.lp);
    p.root.add(m);
    this.beads.push({ mesh: m, t: 0 });
  }

  // ---------------- multitool ----------------
  _multitoolAction() {
    let t = 0, target = null, soundT = 0;
    return {
      tick: (dt) => {
        const hit = this._aim(2.0);
        const prop = hit?.ud?.kind === 'prop' ? hit.ud.prop : null;
        // devices can consume multitool use (generator bolts etc.)
        if (hit?.ud?.kind === 'device' && hit.ud.device.toolUse) {
          hit.ud.device.toolUse('multitool', this.game.local, dt, hit);
          return;
        }
        if (!prop || (!itemDef(prop.type).dismantle && !prop.welds?.length && !prop.def.breakF)) {
          t = 0;
          target = null;
          this.game.ui.progress(null);
          return;
        }
        if (target !== prop.id) { target = prop.id; t = 0; }
        t += dt;
        soundT -= dt;
        if (soundT <= 0) { soundT = 0.28; audio.play('multitool', { pos: hit.point, volume: 0.6 }); }
        this.game.ui.progress(t / 2.2, 'DISMANTLING');
        if (t >= 2.2) {
          t = 0;
          target = null;
          this.game.ui.progress(null);
          net.toHost('dismantle', { id: prop.id });
          audio.play('dismantle', { pos: hit.point });
        }
      },
      end: () => this.game.ui.progress(null),
    };
  }

  _hostDismantle(d) {
    const w = this.world;
    const prop = w?.props.get(d.id);
    if (!prop || prop.dead) return;
    const def = itemDef(prop.type);
    const pos = prop.root.position.clone();
    this.unweld(prop);
    w.grab.releaseAllFor(prop.id);
    w.props.despawn(prop.id, { k: 'break', m: prop.material, p: pos.toArray() });
    w.noise.emit(pos, 10, 'dismantle');
    const yields = def.dismantle || def.into || [];
    yields.forEach((t, i) => {
      const off = new THREE.Vector3(Math.cos(i * 2.1) * 0.25, 0.2 + i * 0.08, Math.sin(i * 2.1) * 0.25);
      w.props.spawn(t, pos.clone().add(off), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i, 0)), { vel: off.clone().multiplyScalar(2) });
    });
  }

  // ---------------- samples ----------------
  _sampleAction(item) {
    let t = 0;
    return {
      tick: (dt) => {
        if (item.state.kind) {
          if (!this._warned) { this.game.ui.toast(`Jar already holds: ${SAMPLES[item.state.kind]?.name}`); this._warned = true; }
          return;
        }
        const hit = this._aim(2.2);
        const kind = hit ? this.world.level?.sampleKindAt?.(hit) : null;
        if (!kind) { t = 0; this.game.ui.progress(null); return; }
        t += dt;
        this.game.ui.progress(t / 1.6, `COLLECTING ${SAMPLES[kind]?.name?.toUpperCase() || 'SAMPLE'}`);
        if (t >= 1.6) {
          item.state.kind = kind;
          this.game.local.inv.version++;
          this.game.ui.progress(null);
          this.game.ui.toast(`Collected: ${SAMPLES[kind]?.name}`, 'good');
          audio.play('ui_select', { volume: 0.6 });
          this.world.level?.onSampleTaken?.(kind, hit);
          if (kind === 'rat') profile.unlock('ratcatcher');
        }
      },
      end: () => { this.game.ui.progress(null); this._warned = false; },
    };
  }

  // ---------------- melee ----------------
  _swing() {
    const hit = this._aim(1.8);
    audio.play('throw_whoosh', { volume: 0.5 });
    this.game.local.arms.throwKick = 1;
    if (!hit) return;
    _f.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
    if (hit.ud?.kind === 'prop') net.toHost('hit', { id: hit.ud.prop.id, p: hit.point.toArray(), d: _f.toArray() });
    else if (hit.ud?.kind === 'monster') net.toHost('hit', { mon: hit.ud.monster.id, p: hit.point.toArray(), d: _f.toArray() });
    else audio.play('impact_metal', { pos: hit.point, intensity: 0.7 });
  }

  _hostHit(d, from) {
    const w = this.world;
    if (!w) return;
    const p = new THREE.Vector3().fromArray(d.p);
    const dir = new THREE.Vector3().fromArray(d.d);
    w.noise.emit(p, 12, 'hit');
    if (d.id != null) {
      const prop = w.props.get(d.id);
      if (prop?.body) {
        prop.body.applyImpulseAtPoint(dir.multiplyScalar(Math.min(25, prop.body.mass() * 4 + 4)), p, true);
        w.fxAll({ k: 'impact', m: prop.material, p: d.p, i: 0.8 });
      }
    } else if (d.mon != null) {
      w.monsters?.hit(d.mon, dir, from);
      w.fxAll({ k: 'impact', m: 'flesh', p: d.p, i: 0.9 });
    }
  }

  update(dt) {
    for (let i = this.beads.length - 1; i >= 0; i--) {
      const b = this.beads[i];
      b.t += dt;
      b.mesh.material.emissiveIntensity = Math.max(0, 3 - b.t * 1.2);
      if (b.t > 3) this.beads.splice(i, 1);
    }
  }
}

export { _q, _v };
