// The HQ elevator (reception, Sublevel B4). The receptionist opens it: the landing doors part, the brass
// scissor gate clatters open and a countdown runs on the floor dial above the doors (and as wristwatch
// notices). When it hits zero the gate slams shut: every clone inside the car rides the elevator to the
// next dimension (see world/elevator_ride.js), props inside the car travel too, and anyone left outside
// can talk to her again for the next car. Returning clones step out of this car.
//
// Host-authoritative state: { ph: 'arrive' | 'idle' | 'board' | 'depart', dur, k, n, riders }. Every peer
// times phases from the moment it receives them (world clocks differ per peer).
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { engine } from '../core/engine.js';
import { Device } from '../game/devices.js';
import { ElevatorCar, LandingDoors, Dial, GBin, T, CAR, carMaterials } from '../entities/elevator.js';
import { VLRig } from '../entities/vlights.js';
import { ElevatorRide, prepareRide } from './elevator_ride.js';

export const BOARD_TIME = 15;     // seconds the gate stays open after the receptionist opens it
export const DEPART_DISPATCH = 1.6; // gate closed -> world change (host)
const ARRIVE_TIME = 7;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class HQElevator extends Device {
  // root: at the room-side face of the wall, centred on the opening; local +Z = into the room
  constructor(world, id, lobby, opts = {}) {
    super(world, id, opts);
    this.lobby = lobby;
    this.range = 2.6;
    this.state = { ph: 'arrive', dur: ARRIVE_TIME, k: 0, n: '', riders: null };
    this.phT = 0;                 // local seconds since the phase began
    this.gateF = 0; this.doorF = 0;
    this.car = new ElevatorCar();
    this.car.root.position.set(0, 0, -(0.21 + CAR.GATE_Z));
    this.root.add(this.car.root);
    // landing: doors in the wall, steel + brass architrave, the big floor dial, call station
    this.rig = new VLRig();
    this.mats = carMaterials(this.rig);
    this.doors = new LandingDoors(this.mats, { w: CAR.GW, h: CAR.GH, track: false });
    this.doors.group.position.set(0, 0, -0.06);
    this.root.add(this.doors.group);
    this._frame();
    this.dial = new Dial(0.24, { brass: this.mats.brass, paint: this.mats.paint, rig: this.rig }, { glow: 0.35 });
    this.dial.group.position.set(0, 2.47, 0.03);
    this.root.add(this.dial.group);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.probeOK) o.userData.noProbe = true; });
    this.lastTick = -1;
    this.notified = new Set();
  }

  _frame() {
    const steel = new GBin(), brass = new GBin(), glow = new GBin(), paint = new GBin();
    const gw = CAR.GW / 2, gh = CAR.GH;
    // brushed-steel architrave with a brass inner bead
    for (const s of [-1, 1]) {
      steel.span(s > 0 ? gw : -gw - 0.14, 0, 0, s > 0 ? gw + 0.14 : -gw, gh + 0.16, 0.035, 0xe0e0e0, { metric: 1 });
      steel.span(s > 0 ? gw : -gw - 0.012, 0, -0.18, s > 0 ? gw + 0.012 : -gw, gh, 0.0, 0xb0b0b0, { metric: 2 }); // jamb return through the wall
      brass.span(s > 0 ? gw + 0.004 : -gw - 0.016, 0, 0.035, s > 0 ? gw + 0.016 : -gw - 0.004, gh + 0.012, 0.045, 0xffffff);
    }
    steel.span(-gw - 0.14, gh, 0, gw + 0.14, gh + 0.16, 0.035, 0xe0e0e0, { metric: 1 });
    steel.span(-gw, gh - 0.012, -0.18, gw, gh, 0, 0xb0b0b0);
    brass.span(-gw - 0.016, gh, 0.035, gw + 0.016, gh + 0.012, 0.045, 0xffffff);
    // sill
    steel.span(-gw - 0.05, 0, -0.2, gw + 0.05, 0.006, 0.08, 0xc8c8c8, { metric: 3 });
    for (let i = 0; i < 4; i++) steel.span(-gw - 0.04, 0.006, -0.17 + i * 0.06, gw + 0.04, 0.009, -0.16 + i * 0.06, 0x6a6a6a);
    // call station (right of the doors, seen from the room): plate, one lamp button, "SEE RECEPTION"
    const cx = gw + 0.42;
    steel.span(cx - 0.07, 1.0, 0, cx + 0.07, 1.36, 0.012, 0xffffff, { metric: 3 });
    brass.cyl(0.026, 0.028, 0.012, 0xffffff, T(cx, 1.22, 0.016, Math.PI / 2, 0, 0), { seg: 20 });
    this.callLamp = glow.cyl(0.018, 0.018, 0.004, 0xffffff, T(cx, 1.22, 0.023, Math.PI / 2, 0, 0), { seg: 18 });
    paint.span(cx - 0.05, 1.07, 0.012, cx + 0.05, 1.12, 0.014, 0x1a1a1a);
    this.frameMeshes = [steel.mesh(this.mats.steel, this.root), brass.mesh(this.mats.brass, this.root), paint.mesh(this.mats.paint, this.root)];
    this.callGlow = glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), this.root);
    this.callGlow.material.color.setRGB(1.6, 0.9, 0.3);
    // lobby-side light for the landing pieces (dim key from the reception troffers)
    this.lobbyLightsSet = false;
  }

  // lobby room lights for the frame / dial / doors (set by the lobby once its lights exist)
  setRoomLights(list, ambient) {
    list.slice(0, 3).forEach((l, i) => this.rig.set(i, l.pos, l.color, l.intensity, 10));
    if (ambient) this.rig.ambient(ambient.r, ambient.g, ambient.b);
  }

  build() {
    this.root.updateMatrixWorld(true);
    const ud = { kind: 'device', device: this };
    const phys = this.world.physics;
    const ry = this.root.rotation.y;
    const box = (x0, y0, z0, x1, y1, z1, u) => {
      const c = this.root.localToWorld(_v.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
      const col = phys.addStaticBox(c.x, c.y, c.z, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, u || { kind: 'static', surface: 'metal' }, ry);
      this.colliders.push(col);
      return col;
    };
    const gw = CAR.GW / 2;
    this.doorCol = box(-gw, 0, -0.1, gw, CAR.GH, -0.02);
    // call station + architrave carry the "see reception" prompt
    box(gw + 0.33, 1.0, 0, gw + 0.51, 1.36, 0.03, ud);
    box(-gw, CAR.GH, -0.1, gw, CAR.GH + 0.5, 0.05, ud);
    // car: walls, ceiling, gate; the car floor continues the lobby floor
    this.carCols = this.car.addColliders(phys);
    this.colliders.push(...this.carCols);
  }

  prompt() {
    const k = input.keyName('interact');
    if (this.state.ph === 'board') return `Departs in ${this.secondsLeft()} s — step inside`;
    return `[${k}] Call the elevator`;
  }
  interact() {
    if (this.state.ph === 'board') return;
    audio.play('button_press', { pos: this.root.getWorldPosition(_v).setY(1.2), volume: 0.6 });
    this.world.game?.ui?.toast?.('The gate is operated by reception. Please talk to the receptionist.', 'info');
  }

  secondsLeft() { return this.state.ph === 'board' ? Math.max(0, Math.ceil((this.state.dur || 0) - this.phT)) : 0; }

  // ------------------------------------------------------------------ host
  hostBoard(name) {
    if (!net.isHost) return false;
    if (this.state.ph === 'board' || this.state.ph === 'depart') return false;
    this._set({ ph: 'board', dur: BOARD_TIME, n: name, riders: null });
    net.toAll('hq', { text: `ELEVATOR DEPARTS IN ${BOARD_TIME} SECONDS. Everyone inside the car goes. Requested by ${name}.`, from: 'RECEPTION' });
    return true;
  }
  _set(s) {
    this.setState({ ...s, k: (this.state.k || 0) + 1 });
  }
  serialize() { return { ...this.state, left: Math.max(0, (this.state.dur || 0) - this.phT) }; }

  // positions of every clone (host view): [{ id, pos, yaw }]
  _clones() {
    const g = this.world.game, out = [];
    for (const r of g.roster.values()) {
      if (r.id === net.selfId) { if (g.local.world && !g.local.dead) out.push({ id: r.id, pos: g.local.pos.clone(), yaw: g.local.yaw }); continue; }
      if (r.dead || !r.pose?.p) continue;
      out.push({ id: r.id, pos: new THREE.Vector3().fromArray(r.pose.p), yaw: r.pose.y || 0 });
    }
    return out;
  }
  _carYaw() { this.car.root.getWorldQuaternion(_q); return new THREE.Euler().setFromQuaternion(_q, 'YXZ').y; }
  inCar(pos, margin = 0) { return this.car.containsLocal(this.car.root.worldToLocal(_v.copy(pos)), margin); }
  // in the car or standing in the doorway
  _inZone(pos) {
    const l = this.car.root.worldToLocal(_v.copy(pos));
    return Math.abs(l.x) < CAR.W / 2 + 0.1 && l.z > -CAR.D / 2 && l.z < CAR.FRONT + 0.6;
  }

  _hostUpdate() {
    const ph = this.state.ph;
    if (ph === 'arrive' && this.phT > this.state.dur) {
      if (!this._clones().some((c) => this._inZone(c.pos))) this._set({ ph: 'idle', dur: 0, riders: null });
    } else if (ph === 'idle') {
      // someone got shut in (late join, glitch): let them out
      if ((this._idleCheck = (this._idleCheck || 0) + 1) % 30 === 0 && this._clones().some((c) => this.inCar(c.pos, 0.15))) this._set({ ph: 'arrive', dur: 4, riders: null });
    } else if (ph === 'board' && this.phT >= this.state.dur) {
      const carYaw = this._carYaw();
      const riders = [];
      for (const c of this._clones()) {
        if (!this.inCar(c.pos, 0.02)) continue;
        const l = this.car.root.worldToLocal(_v.copy(c.pos));
        riders.push({ id: c.id, x: +l.x.toFixed(3), z: +l.z.toFixed(3), yaw: +(c.yaw - carYaw).toFixed(3) });
      }
      if (!riders.length) {
        this._set({ ph: 'idle', dur: 0, riders: null });
        this.lobby.receptionist?.hostSay('missed');
        return;
      }
      // props inside the car travel along (car-relative pose)
      const carry = [];
      const cq = this.car.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const p of this.world.props.props.values()) {
        if (p.dead || p.type === 'fish' || !this.inCar(p.root.position, -0.05)) continue;
        const l = this.car.root.worldToLocal(p.root.position.clone());
        const q = cq.clone().multiply(p.root.quaternion);
        carry.push({ type: p.type, state: p.state, q: p.root.quaternion.toArray(), rp: [l.x, Math.max(0.05, l.y), l.z].map((v) => +v.toFixed(3)), rq: q.toArray().map((v) => +v.toFixed(4)) });
      }
      this.departCarry = carry.slice(0, 24);
      this._set({ ph: 'depart', dur: DEPART_DISPATCH, riders });
    } else if (ph === 'depart' && this.phT >= this.state.dur && !this.dispatched) {
      this.dispatched = true;
      this.world.game.hostDispatch(this.departCarry || [], undefined, { elevator: { riders: this.state.riders || [] } });
    }
  }

  // ------------------------------------------------------------------ every peer
  onState(s, fullSync) {
    this.phT = fullSync && s.left !== undefined ? Math.max(0, (s.dur || 0) - s.left) : 0;
    this.lastTick = -1;
    this.notified.clear();
    const head = this.root.localToWorld(_v.set(0, 2.2, 0.3)).clone();
    const ui = this.world.game?.ui;
    if (s.ph === 'board') {
      if (!fullSync) {
        audio.play('elevator_ding', { pos: head, volume: 0.9 });
        audio.play('elev_doors', { pos: head, volume: 0.9, delay: 0.15 });
        audio.play('elev_gate', { pos: head, volume: 1, delay: 0.75 });
      }
      prepareRide();
    } else if (s.ph === 'arrive') {
      if (!fullSync) { audio.play('elevator_ding', { pos: head, volume: 0.9 }); audio.play('elev_doors', { pos: head, volume: 0.8, delay: 0.25 }); audio.play('elev_gate', { pos: head, volume: 0.9, delay: 0.8 }); }
    } else if (s.ph === 'idle') {
      if (!fullSync && (this.gateF > 0.05 || this.doorF > 0.05)) { audio.play('elev_gate', { pos: head, volume: 0.9 }); audio.play('elev_doors', { pos: head, volume: 0.8, delay: 0.55 }); }
    } else if (s.ph === 'depart') {
      if (fullSync) return;
      audio.play('elev_gate', { pos: head, volume: 1.1 });
      audio.play('elev_doors', { pos: head, volume: 0.9, delay: 0.4 });
      const g = this.world.game;
      const me = (s.riders || []).find((r) => r.id === net.selfId);
      if (me && g.local.world && !g.local.dead) {
        g.ride?.dispose?.();
        g.ride = new ElevatorRide(g, { riders: s.riders, me, car: this.car, elevator: this });
      } else if (g.local.world && !g.local.dead) {
        // left behind: step clear of the closing doors
        if (this._inZone(g.local.pos)) {
          const out = this.root.localToWorld(_v.set(g.local.pos.x > this.root.position.x ? 0.4 : -0.4, 0, 0.9));
          g.local.teleport(out.clone().setY(0.02));
        }
        ui?.toast?.('You missed the elevator. The next car leaves with you.', 'warn');
      }
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.phT += dt;
    const ph = this.state.ph, t = this.phT;
    if (net.isHost) this._hostUpdate();
    // open fractions: doors first, then the gate; closing in reverse
    let door = 0, gate = 0;
    if (ph === 'board' || ph === 'arrive') {
      door = clamp01((t - 0.15) / 0.75);
      gate = clamp01((t - 0.75) / 0.55);
    } else if (ph === 'depart') {
      gate = 1 - clamp01(t / 0.4);
      door = 1 - clamp01((t - 0.4) / 0.65);
      if (this.gateF < 0.01) gate = 0;
      if (this.doorF < 0.01) door = 0;
      gate = Math.min(gate, this.gateF); door = Math.min(door, this.doorF);
    } else {
      gate = Math.max(0, this.gateF - dt * 2.4);
      door = this.gateF < 0.05 ? Math.max(0, this.doorF - dt * 1.5) : this.doorF;
    }
    this.gateF = gate; this.doorF = door;
    this.car.gate.set(gate);
    this.doors.set(door);
    this.doorCol?.setEnabled(door < 0.7);
    this.car.gateCollider?.setEnabled(gate < 0.6);
    // floor dial: needle on B4; countdown on the LED + needle sweeping down the arc
    const left = this.secondsLeft();
    if (ph === 'board') {
      this.dial.setLed(String(left).padStart(2, '0'), left <= 5 ? '#ff4a2a' : '#ffae3a');
      this.dial.setNeedle(Math.PI * 0.85 - (1 - (this.state.dur - t) / this.state.dur) * Math.PI * 0.7);
      this.car.dial.setLed(String(left).padStart(2, '0'), left <= 5 ? '#ff4a2a' : '#ffae3a');
      if (left !== this.lastTick) {
        this.lastTick = left;
        const p = this.root.localToWorld(_v.set(0, 2.4, 0.2));
        audio.play(left <= 3 ? 'elevator_ding' : 'countdown_tick', { pos: p, volume: left <= 3 ? 0.35 : 0.7, pitch: left <= 3 ? 1.5 : 1 });
        const g = this.world.game;
        if ([10, 5, 3, 2, 1].includes(left) && !this.notified.has(left) && g?.local?.world) {
          this.notified.add(left);
          g.ui?.toast?.(`ELEVATOR DEPARTS IN ${left}`, left <= 3 ? 'bad' : 'warn');
        }
      }
    } else {
      this.dial.setLed(ph === 'depart' ? '▼' : 'B4', ph === 'depart' ? '#ff4a2a' : '#ffae3a');
      this.dial.setNeedle(Math.PI * 0.85 - (5 / 9) * Math.PI * 0.7 - (ph === 'depart' ? 0.2 : 0));
      this.car.dial.setLed('B4');
    }
    this.dial.update(dt, 2.5);
    this.car.update(dt);
    // call lamp: amber while idle, green while boarding
    const blink = ph === 'board' ? (Math.floor(t * 3) % 2 ? 1.8 : 0.4) : 1;
    if (ph === 'board') this.callGlow.material.color.setRGB(0.3 * blink, 1.8 * blink, 0.5 * blink);
    else this.callGlow.material.color.setRGB(1.6, 0.9, 0.3);
    // the car light hums a little
    this.car.setLight(0.94 + Math.sin(engine.time * 31) * 0.01 + (Math.random() < 0.004 ? -0.4 : 0));
  }

  dispose() {
    super.dispose();
    this.car.dispose();
    this.dial.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.callGlow.material.dispose();
  }
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
