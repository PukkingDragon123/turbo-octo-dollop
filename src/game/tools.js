// Tool actions: welding (real fixed physics joints), the built-in multitool (attach / detach / dismantle,
// camp-part snapping), sample collection and melee swings. Client side produces hold actions; the host
// owns the physical results.
//
// Built-in multitool (drawn with [Q], or the old multitool item; hold LMB). Holding charges POWER (the beam
// thickens, the whine rises): actions finish faster, heavy furniture needs power to dismantle, and releasing
// at full charge fires a damaging ZAP (monsters, teammates, props). Power drains the battery
// (player.tool.battery, shown on the gadget's LED bar; Healthity / batteries recharge it); empty, it sputters.
// Attaching a caster WHEEL to a prop makes a real revolute axle (DIY carts).
//   * camp part near its ghost marker -> ATTACH it to the camp (CampMission.hostCampAttach)
//   * welded prop                      -> DETACH (remove its joints)
//   * mode 'attach' (default)          -> ATTACH: fixed joint to whatever it touches (prop or world)
//   * mode 'dismantle' ([R] toggles)   -> DISMANTLE into materials
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { RAPIER, Q } from '../physics/physics.js';
import { audio } from '../audio/audio.js';
import { itemDef, itemName, SAMPLES, sellValue } from './itemdefs.js';
import { profile } from '../core/profile.js';
import { juice } from '../gfx/juice.js';

const MT_RANGE = 2.6;
export const MT = { chargeTime: 1.4, drainIdle: 0.01, drainPower: 0.045, zapCost: 0.15, zapRange: 6, zapDamage: 32, heavyMass: 40, reserve: 0.25 };
const MT_COLORS = { attach: 0x6fe0ff, camp: 0x8dffa6, detach: 0xffa040, dismantle: 0xff7a30 };

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

export class Tools {
  constructor(game) {
    this.game = game;
    this.weldProgress = new Map(); // host: playerId -> {id, t, last}
    this.beads = []; // visual weld beads {mesh, t}
    this._bound = false;
    this.weldLoop = null;
    this.beam = null; // multitool zap beam (local visual)
    this.bindHost();
  }

  bindHost() {
    // (re)bound every world because world.dispose clears handlers by name
    net.onHost('weldTick', (d, from) => this._hostWeldTick(d, from));
    net.onHost('dismantle', (d, from) => this._hostDismantle(d, from));
    net.onHost('hit', (d, from) => this._hostHit(d, from));
    net.onHost('mt', (d, from) => this._hostMultitool(d, from));
    net.onClient('welded', (d) => this._showBead(d));
    net.onClient('mtMsg', (d) => { this.game.ui.toast(d.text, d.kind || 'warn'); if (d.kind !== 'good') audio.play('ui_error', { volume: 0.35, bus: 'ui' }); });
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
      case 'test': return this.world.level?.toolAction?.('test', item, player) ?? null;
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
    // a caster wheel on a prop spins on a revolute axle through its hub (local X) instead of a rigid weld
    const wheel = other && prop.def.wheel !== other.def.wheel ? (prop.def.wheel ? prop : other) : null;
    let joint;
    if (wheel) {
      const wb = wheel.body, base = wheel === prop ? other : prop, bb = base.body;
      const tw = wb.translation(), rw = wb.rotation(), tb = bb.translation(), rb = bb.rotation();
      const qw = new THREE.Quaternion(rw.x, rw.y, rw.z, rw.w), qb = new THREE.Quaternion(rb.x, rb.y, rb.z, rb.w);
      const axleW = new THREE.Vector3(1, 0, 0).applyQuaternion(qw);
      const hubB = new THREE.Vector3(tw.x, tw.y, tw.z).sub(new THREE.Vector3(tb.x, tb.y, tb.z)).applyQuaternion(qb.clone().invert());
      const axleB = axleW.clone().applyQuaternion(qb.clone().invert()).normalize();
      const jd = RAPIER.JointData.revoluteWithAxes({ x: 0, y: 0, z: 0 }, { x: hubB.x, y: hubB.y, z: hubB.z }, { x: 1, y: 0, z: 0 }, { x: axleB.x, y: axleB.y, z: axleB.z });
      joint = phys.world.createImpulseJoint(jd, wb, bb, true);
      joint.setContactsEnabled?.(false);
      try { joint.configureMotorVelocity?.(0, 0.02); } catch (e) { /* rolling friction is optional */ }
      wb.setAngularDamping?.(0.05);
      w.fxAll({ k: 'snd', n: 'bolt_turn', p: point.toArray(), v: 0.9 });
    } else {
      // frames: keep current relative orientation
      const f1 = new THREE.Quaternion();
      const f2 = q2.clone().invert().multiply(q1);
      const jd = RAPIER.JointData.fixed(
        { x: a1.x, y: a1.y, z: a1.z }, { x: f1.x, y: f1.y, z: f1.z, w: f1.w },
        { x: a2.x, y: a2.y, z: a2.z }, { x: f2.x, y: f2.y, z: f2.z, w: f2.w },
      );
      joint = phys.world.createImpulseJoint(jd, b1, b2, true);
    }
    const rec = { joint, a: prop.id, b: other ? other.id : null, anchor: other ? null : b2, axle: !!wheel };
    prop.welds = prop.welds || [];
    prop.welds.push(rec);
    if (other) { other.welds = other.welds || []; other.welds.push(rec); }
    prop.hp = Math.max(prop.hp, 140);
    prop.touched = true;
    // replicate "is attached" so every peer's multitool knows to offer DETACH
    w.props.setState(prop.id, { welded: prop.welds.length });
    if (other) w.props.setState(other.id, { welded: other.welds.length });
    net.toAll('welded', { a: prop.id, lp: a1.toArray() });
    w.fxAll({ k: 'snd', n: 'spark', p: point.toArray(), v: 0.8 });
  }

  unweld(prop) {
    const w = this.world;
    if (!prop.welds?.length) return;
    for (const rec of prop.welds) {
      try { w.physics.world.removeImpulseJoint(rec.joint, true); } catch (e) { /* gone */ }
      if (rec.anchor) w.physics.removeBody(rec.anchor);
      const other = rec.b != null ? w.props.get(rec.a === prop.id ? rec.b : rec.a) : null;
      if (other?.welds) {
        other.welds = other.welds.filter((x) => x !== rec);
        if (!other.dead) w.props.setState(other.id, { welded: other.welds.length });
      }
    }
    prop.welds = [];
    prop.body?.wakeUp();
    if (!prop.dead) w.props.setState(prop.id, { welded: 0 });
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

  // ---------------- built-in multitool ----------------
  // What the multitool would do to this prop: { act, label, dur, prompt } | { blocked: text } | null
  mtVerdict(prop, player = this.game.local) {
    if (!prop || prop.dead || !this.world) return null;
    const m = this.world.level?.mission;
    const name = itemName(prop.type);
    if (prop.def.camp) {
      const c = m?.campAttachCheck?.(prop);
      if (!c) return null;
      return c.ok ? { act: 'camp', label: 'ATTACHING', dur: 0.45, prompt: `[LMB] ATTACH ${name.toUpperCase()}` } : { blocked: c.text, prompt: `${name} — ${c.text}` };
    }
    if (prop.frozen || prop.def.static) return null;
    if (prop.state.welded > 0) return { act: 'detach', label: 'DETACHING', dur: 0.7, prompt: '[LMB] DETACH' };
    if ((player.mtMode || 'attach') === 'dismantle') {
      const def = itemDef(prop.type);
      if (!def.dismantle && !def.into?.length && !def.breakF) return { blocked: `Can't take the ${name.toLowerCase()} apart`, prompt: `[LMB] Dismantle — not possible  [${input.keyName('rotate')}] Mode` };
      return { act: 'dismantle', label: 'DISMANTLING', dur: 2.2, heavy: prop.mass > MT.heavyMass, prompt: `[LMB] DISMANTLE${prop.mass > MT.heavyMass ? ' (hold: needs power)' : ''}  [${input.keyName('rotate')}] Mode` };
    }
    return { act: 'attach', label: prop.def.wheel ? 'MOUNTING WHEEL' : 'ATTACHING', dur: 0.7, prompt: `[LMB] ${prop.def.wheel ? 'MOUNT WHEEL' : 'ATTACH'}  [${input.keyName('rotate')}] Mode` };
  }

  // interaction prompt for a prop the empty-handed clone is looking at (name, pad value, multitool action)
  mtPrompt(prop, player = this.game.local) {
    const v = this.mtVerdict(prop, player);
    if (!v) return null;
    const tool = player.toolOut || player._mtItem?.();
    if (prop.def.camp) return tool || player.grab?.id === prop.id || v.blocked ? v.prompt : `${itemName(prop.type)} · [RMB] Drag it to its marker`;
    const m = this.world.level?.mission;
    const val = m?.showValues ? sellValue(prop.type, prop.mass, prop.state) : 0;
    return `${itemName(prop.type)}${val ? ` $${val}` : ''} · [RMB] Drag · ${tool ? v.prompt : `[${input.keyName('tool')}] Multitool`}`;
  }

  // the hold-RMB action (item = the old multitool item, or null for the built-in one)
  _multitoolAction(item, player = this.game.local) {
    let t = 0, target = null, act = null, soundT = 0, sparkT = 0, finished = false, warned = false, aimPoint = null;
    const ui = this.game.ui;
    const tool = player.tool || { battery: 1, power: 0 };
    tool.power = 0;
    const reset = () => { t = 0; target = null; act = null; ui.progress(null); this._beamOff(); };
    const stopLoop = () => { if (this.mtLoop) { this.mtLoop.stop(0.15); this.mtLoop = null; } };
    return {
      multitool: true,
      tick: (dt) => {
        if (finished) { this._beamOff(); return; } // one action per press
        // charge power while held; power drains the battery, an empty one sputters
        const dry = tool.battery <= 0.001;
        if (!dry) {
          tool.power = Math.min(1, tool.power + dt / MT.chargeTime);
          tool.battery = Math.max(0, tool.battery - dt * (MT.drainIdle + MT.drainPower * tool.power));
        } else {
          tool.power = Math.max(0, tool.power - dt * 3);
          tool.sputter = 0.3;
          if (!warned) { warned = true; ui.toast?.('MULTITOOL BATTERY EMPTY — ask Healthity to charge it', 'warn'); audio.play('ui_error', { volume: 0.4, bus: 'ui' }); }
        }
        if (!this.mtLoop && !dry) this.mtLoop = audio.loop('weld', { volume: 0.25, pitch: 0.6 });
        if (this.mtLoop) { this.mtLoop.setPitch(0.6 + tool.power * 0.9); this.mtLoop.setVolume(dry ? 0 : 0.18 + tool.power * 0.4); }
        if (player.arms) player.arms.mtPower = tool.power;
        let prop = null, point = null, normal = null;
        if (player.grab && player.grab.id != null) {
          prop = this.world.props.get(player.grab.id) || null;
          point = player.grab.point || prop?.root.position;
        } else {
          const hit = this._aim(MT_RANGE);
          aimPoint = hit ? hit.point.clone() : null;
          if (dry) {
            // sputter: a weak flickering arc, no work done
            if (hit && Math.random() < 0.25) { this._beamTo(hit.point, 'detach', dt, 0); this.world.fx.sparks(hit.point, 2, hit.normal, [1, 0.5, 0.2], 1.5); if (Math.random() < 0.2) audio.play('spark', { pos: hit.point, volume: 0.3 }); } else this._beamOff();
            return;
          }
          // devices can consume multitool use (generator bolts etc.)
          if (hit?.ud?.kind === 'device' && hit.ud.device.toolUse) {
            hit.ud.device.toolUse('multitool', player, dt * (0.6 + tool.power * 1.2), hit);
            this._beamTo(hit.point, 'attach', dt, tool.power);
            return;
          }
          if (hit?.ud?.kind === 'prop') { prop = hit.ud.prop; point = hit.point; normal = hit.normal; }
          else {
            // aim assist for camp parts: thin poles are easy to miss (the ray slips between the legs)
            const near = this._campPartNearRay(hit ? hit.dist : MT_RANGE);
            if (near) { prop = near; point = near.root.position.clone(); }
          }
        }
        const v = prop ? this.mtVerdict(prop, player) : null;
        if (!v || v.blocked) {
          if (v?.blocked && !warned) { warned = true; ui.toast(v.blocked, 'warn'); audio.play('ui_error', { volume: 0.35, bus: 'ui' }); }
          reset();
          // nothing to work on: the charge builds into a zap (released at full power)
          if (aimPoint && tool.power > 0.05) this._beamTo(aimPoint, 'zap', dt, tool.power);
          return;
        }
        if (target !== prop.id || act !== v.act) { target = prop.id; act = v.act; t = 0; }
        // power makes the work go faster; heavy furniture won't come apart on a weak beam
        const rate = v.heavy && tool.power < 0.6 ? 0.08 : 0.5 + tool.power * 1.5;
        t += dt * rate;
        this._beamTo(point, act, dt, tool.power);
        sparkT -= dt;
        if (sparkT <= 0) {
          sparkT = 0.07;
          if (act === 'dismantle' || act === 'detach') this.world.fx.sparks(point, 3, normal, [1, 0.6, 0.25], 2.5);
          else this.world.fx.sparks(point, 3, normal, act === 'camp' ? [0.5, 1, 0.6] : [0.45, 0.85, 1], 2);
        }
        soundT -= dt;
        if (soundT <= 0) { soundT = 0.28; audio.play(act === 'dismantle' ? 'multitool' : 'weld_crackle', { pos: point, volume: 0.45 }); }
        ui.progress(t / v.dur, v.label);
        if (t >= v.dur) {
          finished = true;
          net.toHost('mt', { id: prop.id, a: act, p: point.toArray() });
          if (act === 'dismantle') audio.play('dismantle', { pos: point });
          else {
            audio.play('bolt_turn', { pos: point, volume: 0.9 });
            audio.play('spark', { pos: point, volume: 0.7 });
          }
          this.world.fx.weldSparks(point, normal);
          this.world.fx.flashLight(point, MT_COLORS[act], 8, 0.15, 4);
          if (player.arms) player.arms.throwKick = 0.35;
          tool.power = 0;
          reset();
        }
      },
      end: () => {
        stopLoop();
        if (!finished && tool.power >= 0.98 && tool.battery > 0.02) this.zap(player);
        tool.power = 0;
        if (player.arms) player.arms.mtPower = 0;
        reset();
      },
    };
  }

  // fully charged discharge along the view ray: hurts monsters, shocks teammates, blasts props
  zap(player = this.game.local) {
    const w = this.world;
    if (!w) return;
    const tool = player.tool;
    if (tool) tool.battery = Math.max(0, tool.battery - MT.zapCost);
    const cam = engine.camera;
    const dir = _f.set(0, 0, -1).applyQuaternion(cam.quaternion).clone();
    const origin = cam.position.clone();
    let end = origin.clone().addScaledVector(dir, MT.zapRange);
    let res = null;
    try { res = w.monsters?.applyHit?.({ origin, dir: dir.clone(), range: MT.zapRange, damage: MT.zapDamage, from: net.selfId, kind: 'tool', power: 1 }); } catch (e) { console.error('[tools] applyHit', e); }
    const hit = this._aim(MT.zapRange);
    if (res?.point) end = res.point.isVector3 ? res.point.clone() : new THREE.Vector3().fromArray(res.point);
    else if (hit) {
      end = hit.point.clone();
      const ud = hit.ud;
      if (ud?.kind === 'remote' && ud.remote && !ud.remote.dead) net.toHost('punch', { to: ud.remote.id, d: dir.toArray(), f: 1, w: 1, zap: 1, p: end.toArray() });
      else if (ud?.kind === 'prop') net.toHost('hit', { id: ud.prop.id, p: end.toArray(), d: dir.toArray(), f: 1.6, zap: 1 });
      else if (ud?.kind === 'monster' && !w.monsters?.applyHit) net.toHost('hit', { mon: ud.monster.id, p: end.toArray(), d: dir.toArray(), f: 1 });
    }
    this._beamTo(end, 'zap', 0.016, 1.6);
    this._zapFlash = 0.12;
    w.fx.sparks(end, 30, hit?.normal || null, [0.6, 0.9, 1], 6);
    w.fx.flashLight(end, 0x9fe8ff, 14, 0.2, 7);
    audio.play('mt_zap', { pos: end, volume: 1 });
    juice.shake(0.35); juice.hitstop(50); juice.flash(0.15);
    w.noise.emit(end, 14, 'zap');
    if (player.arms) player.arms.throwKick = 0.8;
  }

  // a loose camp part within ~0.45 m of the view ray (closer than maxDist), or null
  _campPartNearRay(maxDist) {
    const cam = engine.camera;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bd = 0.45;
    for (const p of this.world.props.props.values()) {
      if (!p.def.camp || p.frozen || p.dead) continue;
      _v.subVectors(p.root.position, cam.position);
      const along = _v.dot(_f);
      if (along < 0.3 || along > maxDist + 0.4) continue;
      const off = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      if (off < bd) { bd = off; best = p; }
    }
    return best;
  }

  // jagged zap beam from the wrist emitter to the target point (local visual)
  _beamTo(point, act, dt, power = 0.4) {
    if (!point) return;
    if (!this.beam) {
      const n = 14;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.frustumCulled = false;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      // soft glowing tube around the zap so it reads at any distance (a GL line is only one pixel wide)
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      line.frustumCulled = tube.frustumCulled = false;
      engine.scene.add(line, glow, tube);
      this.beam = { line, glow, tube, n, t: 0 };
    }
    const b = this.beam;
    b.t += dt || 0.016;
    const col = act === 'zap' ? (power > 1 ? 0xffffff : 0x9fe8ff) : MT_COLORS[act] ?? MT_COLORS.attach;
    b.line.material.color.setHex(col);
    b.glow.material.color.setHex(col);
    b.tube.material.color.setHex(col);
    const cam = engine.camera;
    const start = _v.set(0.2, -0.22, -0.45).applyQuaternion(cam.quaternion).add(cam.position);
    const arr = b.line.geometry.attributes.position.array;
    const len = start.distanceTo(point);
    for (let i = 0; i < b.n; i++) {
      const k = i / (b.n - 1);
      const jit = i === 0 || i === b.n - 1 ? 0 : Math.sin(k * Math.PI) * (0.03 + power * 0.06) * Math.min(1, len);
      arr[i * 3] = start.x + (point.x - start.x) * k + (Math.random() - 0.5) * jit;
      arr[i * 3 + 1] = start.y + (point.y - start.y) * k + (Math.random() - 0.5) * jit;
      arr[i * 3 + 2] = start.z + (point.z - start.z) * k + (Math.random() - 0.5) * jit;
    }
    b.line.geometry.attributes.position.needsUpdate = true;
    const r = (0.008 + power * 0.03) * (0.75 + Math.random() * 0.5);
    b.tube.position.copy(start).add(point).multiplyScalar(0.5);
    b.tube.quaternion.setFromUnitVectors(_up, _f.subVectors(point, start).normalize());
    b.tube.scale.set(r, len, r);
    b.tube.material.opacity = Math.min(0.9, 0.22 + power * 0.35 + Math.random() * 0.2);
    b.line.visible = true;
    b.glow.visible = true;
    b.tube.visible = true;
    b.glow.position.copy(point);
    b.glow.scale.setScalar((0.5 + power * 1.2) * (0.7 + Math.random() * 0.6));
  }

  _beamOff() {
    if (!this.beam) return;
    this.beam.line.visible = false;
    this.beam.glow.visible = false;
    this.beam.tube.visible = false;
  }

  // host: carry out a finished multitool action
  _hostMultitool(d, from) {
    const w = this.world;
    const prop = w?.props.get(d.id);
    if (!prop || prop.dead) return;
    const p = d.p ? new THREE.Vector3().fromArray(d.p) : prop.root.position.clone();
    const say = (text, kind = 'warn') => net.toPeer(from, 'mtMsg', { text, kind });
    w.noise.emit(p, 9, 'multitool');
    if (d.a === 'camp') {
      const m = w.level?.mission;
      if (m?.hostCampAttach) m.hostCampAttach(prop, from);
      else say('Nothing to attach it to here.');
    } else if (d.a === 'detach') {
      if (!prop.welds?.length) { w.props.setState(prop.id, { welded: 0 }); return; }
      this.unweld(prop);
      w.fxAll({ k: 'sparks', p: p.toArray(), n: 14 });
      w.fxAll({ k: 'snd', n: 'wire_connect', p: p.toArray(), v: 0.8, pi: 0.8 });
    } else if (d.a === 'dismantle') {
      this._hostDismantle({ id: prop.id });
    } else if (d.a === 'attach') {
      if (!prop.body || prop.frozen) return;
      const other = this._touching(prop, p);
      if (!other) { say('Nothing to attach it to. Push it against something first.'); return; }
      if (other === 'world' && prop.welds?.some((r) => r.anchor)) { say('Already attached there.'); return; }
      w.grab.releaseAllFor(prop.id);
      this.weld(prop, other === 'world' ? null : other, p);
      w.fxAll({ k: 'sparks', p: p.toArray(), n: 18 });
      w.fxAll({ k: 'snd', n: 'fuse_insert', p: p.toArray(), v: 0.9 });
      if (from === net.selfId) profile.unlock('welder'); else net.toPeer(from, 'ach', 'welder');
    }
  }

  // host: what a prop is touching (the prop closest to point wins over static geometry): Prop | 'world' | null
  _touching(prop, point) {
    const w = this.world;
    const phys = w.physics;
    let best = null, bd = Infinity, stat = false;
    const n = prop.body.numColliders();
    for (let i = 0; i < n; i++) {
      const col = prop.body.collider(i);
      phys.world.contactPairsWith(col, (other) => {
        let touching = false;
        phys.world.contactPair(col, other, (manifold) => { if (manifold.numContacts() > 0) touching = true; });
        if (!touching) return;
        const ud = phys.getUserData(other);
        if (ud?.kind === 'prop' && ud.prop !== prop && ud.prop.body && !ud.prop.dead) {
          const dd = ud.prop.root.position.distanceToSquared(point);
          if (dd < bd) { bd = dd; best = ud.prop; }
        } else if (ud?.kind === 'static' || ud?.kind === 'device' || !ud) stat = true;
      });
    }
    if (best) return best;
    if (stat) return 'world';
    // resting contacts can be missing (sleeping pairs): fall back to a probe around the aimed point
    phys.overlapSphere(point, 0.2, Q.solid, (c, ud) => {
      if (ud?.kind === 'prop' && ud.prop !== prop && ud.prop.body && !best) best = ud.prop;
      else if (ud?.kind === 'static' || ud?.kind === 'device') stat = true;
    });
    return best || (stat ? 'world' : null);
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
    const yields = [...(def.dismantle || def.into || [])];
    // anything that rolled on casters gives its wheels back (office chairs, trolleys, carts)
    for (const t of prop.model?.breakInto || []) if (t === 'wheel') yields.push('wheel');
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
        const f = Math.max(0.3, Math.min(1.8, d.f ?? 1)) * (d.w ? 1.4 : 1);
        prop.body.applyImpulseAtPoint(dir.multiplyScalar(Math.min(25 * f, prop.body.mass() * 4 * f + 4)), p, true);
        prop.touched = true;
        w.fxAll({ k: 'impact', m: prop.material, p: d.p, i: Math.min(1, 0.5 + f * 0.3) });
        if (d.zap) w.fxAll({ k: 'sparks', p: d.p, n: 16 });
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
