// The three mission generators, each with its own physical repair mechanic:
//   DIESEL     — pour fuel from a carried fuel can, then hold-and-release the recoil cord with timing
//   ELECTRIC   — open the panel, re-wire four colour-coded terminals, insert a fuse, throw the breaker
//   MECHANICAL — weld three cracks in the pressure pipe, tighten four bolts, then crank it up (co-op speeds it up)
// Every step is loud; running generators keep emitting noise that draws monsters in.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { Device } from './devices.js';
import { buildModel } from '../entities/catalog.js';
import { CrtScreen, text, bar } from '../ui/crt.js';

const _v = new THREE.Vector3();
const COLORS = ['red', 'blue', 'green', 'yellow'];
const HEX = { red: 0xd02020, blue: 0x2050e0, green: 0x20b040, yellow: 0xf0c020 };
const LETTER = { diesel: 'A', electric: 'B', mech: 'C' };

class GeneratorBase extends Device {
  constructor(world, id, kind, mission) {
    super(world, id, { state: { running: 0, linked: 0, link: 0 } });
    this.kind = kind;
    this.mission = mission;
    this.label = `GENERATOR ${LETTER[kind]}`;
    this.noiseT = 0;
    this.runLoop = null;
    this.shake = 0;
    this.smokeT = 0;
  }

  buildModel(key) {
    const m = buildModel(key, { seed: 3 });
    this.model = m;
    this.root.add(m.object);
    this.addColliders(m.colliders);
    if (m.screens?.main?.mesh) {
      this.screen = new CrtScreen(256, 192, 'green');
      this.screen.fps = 6;
      this.screen.attach(m.screens.main.mesh, 1.3);
    }
    this.lamp = m.parts.lamp;
    if (this.lamp?.material) this.lamp.material = this.lamp.material.clone();
  }

  anchorWorld(name, idx = null, out = new THREE.Vector3()) {
    let a = this.model.anchors[name];
    if (idx !== null && Array.isArray(a)) a = a[idx];
    if (!a) return this.root.getWorldPosition(out);
    this.root.updateMatrixWorld(true);
    return out.copy(a.isVector3 ? a : new THREE.Vector3(a.x, a.y, a.z)).applyMatrix4(this.root.matrixWorld);
  }

  get running() { return !!this.state.running; }

  statusText() { return this.running ? (this.state.linked ? 'ONLINE / UPLINKED' : 'ONLINE') : 'OFFLINE'; }

  startRunning() {
    if (!net.isHost || this.running) return;
    this.setState({ running: 1 });
    this.world.fxAll({ k: 'snd', n: 'generator_start', p: this.root.position.toArray(), v: 1 });
    this.world.noise.emit(this.root.position, 32, 'generator');
    this.mission.onGeneratorRepaired(this);
  }

  onState(s) {
    if (s.running !== undefined) {
      if (this.running && !this.runLoop) this.runLoop = audio.loop('generator_run', { pos: this.root.position.clone().setY(0.8), volume: 1 });
      if (this.runLoop) this.runLoop.setParam('type', this.kind === 'diesel' ? 0 : this.kind === 'electric' ? 1 : 2);
      if (!this.running && this.runLoop) { this.runLoop.stop(0.5); this.runLoop = null; }
    }
  }

  update(dt) {
    const t = this.world.time;
    if (this.lamp?.material) {
      const on = this.running;
      this.lamp.material.emissive?.setHex(on ? 0x30ff60 : (Math.floor(t * 2) % 2 ? 0xff3010 : 0x200000));
      this.lamp.material.emissiveIntensity = on ? 3 : 2;
    }
    if (this.running) {
      // engine vibration
      this.shake = Math.sin(t * 70) * 0.004 + Math.sin(t * 43) * 0.003;
      if (this.model.object) this.model.object.position.set(this.shake, Math.abs(this.shake) * 0.5, -this.shake * 0.6);
      this.smokeT -= dt;
      if (this.smokeT <= 0 && this.kind !== 'electric') {
        this.smokeT = 0.18;
        this.world.fx.smoke(this.anchorWorld('exhaust', null, _v), 1, [0.18, 0.18, 0.17], 0.8);
      }
      if (net.isHost) {
        this.noiseT -= dt;
        if (this.noiseT <= 0) {
          this.noiseT = 2.5;
          this.world.noise.emit(this.root.position, 22, 'generator', this.id);
        }
      }
    }
    if (this.screen) {
      this.screen.draw(dt, (ctx, w, h, pal) => {
        text(ctx, this.label, 10, 6, 28, pal.hi);
        text(ctx, this.statusText(), 10, 40, 24, this.running ? pal.good : pal.bad);
        this.drawStatus(ctx, w, h, pal);
      });
    }
  }

  drawStatus() {}
  serialize() { return this.state; }
}

// ---------------------------------------------------------------------------
export class DieselGenerator extends GeneratorBase {
  constructor(world, id, mission) {
    super(world, id, 'diesel', mission);
    Object.assign(this.state, { fuel: 0, catches: 0 });
    this.buildModel('generator_diesel');
    this.holdTime = 0.01;
    this.charge = 0;
    this.charging = false;
    this.pourT = 0;
    this.cordAnim = 0;
  }

  prompt(player) {
    if (this.running) return `${this.label} — running${this.state.linked ? ' (uplinked)' : ' — bring the radio here'}`;
    if (this.state.fuel < 1) return `${this.label} — tank ${Math.round(this.state.fuel * 100)}%. Hold a FUEL CAN at the filler cap`;
    return `[Hold ${input.keyName('interact')}] Pull the start cord — release in the green`;
  }

  interact() { /* handled via hold */ }

  interactHold(player, dt) {
    if (this.running || this.state.fuel < 1) return;
    this.charging = true;
    this.charge = Math.min(1.4, this.charge + dt);
    this.mission.game.ui.timing(this.charge / 1.4, 0.45, 0.62, 'PULL');
  }

  update(dt) {
    super.update(dt);
    // release of the hold -> pull attempt
    if (this.charging && !input.down('interact')) {
      const c = this.charge / 1.4;
      this.charging = false;
      this.charge = 0;
      this.mission.game.ui.timing(null);
      this.send('pull', { q: +c.toFixed(3) });
    }
    if (this.charging && this.mission.game.local.focus?.target !== this) {
      this.charging = false;
      this.charge = 0;
      this.mission.game.ui.timing(null);
    }
    // cord handle animation
    this.cordAnim = Math.max(0, this.cordAnim - dt * 3);
    const h = this.model.parts.cordHandle;
    if (h) {
      if (!h.userData.rest) h.userData.rest = h.position.clone();
      const pull = Math.sin(Math.min(1, this.cordAnim) * Math.PI) * 0.45;
      h.position.copy(h.userData.rest).add(_v.set(pull * 0.7, pull * 0.2, pull * 0.6));
    }
    // needles
    for (const [i, n] of (this.model.parts.needles || []).entries()) {
      const target = this.running ? 0.6 + Math.sin(this.world.time * 9 + i) * 0.1 : i === 0 ? this.state.fuel * 1.2 - 0.6 : -0.6;
      n.rotation.z += (-target - n.rotation.z) * Math.min(1, dt * 6);
    }
    // host: fuel pouring from a held fuel can near the cap
    if (net.isHost && !this.running && this.state.fuel < 1) {
      this.pourT -= dt;
      if (this.pourT <= 0) {
        this.pourT = 0.25;
        const cap = this.anchorWorld('fuelCap', null, new THREE.Vector3());
        let can = null;
        this.world.props.query(cap, 1.1, (p) => { if (p.type === 'fuel_can' && (p.state.fuel ?? 1) > 0 && p.isHeld()) can = p; });
        if (can) {
          const add = 0.25 / 3.5;
          const nf = Math.min(1, this.state.fuel + add);
          this.setState({ fuel: +nf.toFixed(3) });
          this.world.props.setState(can.id, { fuel: Math.max(0, (can.state.fuel ?? 1) - add) });
          this.world.fxAll({ k: 'snd', n: 'water_glug', p: cap.toArray(), v: 0.6, pi: 0.6 });
          this.world.noise.emit(cap, 6, 'pour');
          if (nf >= 1) net.toAll('hq', { text: `${this.label}: tank full. Pull the start cord.`, from: 'DIAGNOSTICS' });
        }
      }
    }
  }

  hostAction(a, d) {
    if (a !== 'pull' || this.running || this.state.fuel < 1) return;
    const q = d?.q ?? 0;
    const good = q >= 0.45 && q <= 0.62;
    const chance = good ? 0.55 + this.state.catches * 0.2 : 0.06;
    this.world.fxAll({ k: 'gen', id: this.id, a: 'pull' });
    this.world.noise.emit(this.root.position, 18, 'generator');
    if (Math.random() < chance) {
      const catches = this.state.catches + 1;
      if (catches >= 2) { this.setState({ catches }); this.startRunning(); }
      else {
        this.setState({ catches });
        this.world.fxAll({ k: 'snd', n: 'generator_fail', p: this.root.position.toArray(), v: 0.9 });
        net.toAll('hq', { text: `${this.label}: engine caught for a second! Again!`, from: 'DIAGNOSTICS' });
      }
    } else {
      this.world.fxAll({ k: 'snd', n: 'generator_fail', p: this.root.position.toArray(), v: 0.7, pi: 1.1 });
    }
  }

  playFx(m) {
    if (m.a === 'pull') {
      this.cordAnim = 1;
      audio.play('pull_cord', { pos: this.root.position });
    }
  }

  drawStatus(ctx, w, h, pal) {
    text(ctx, 'FUEL', 10, 76, 22, pal.fg);
    bar(ctx, 70, 78, w - 84, 20, this.state.fuel, pal.fg, pal.dim);
    text(ctx, `IGNITION ${'●'.repeat(this.state.catches)}${'○'.repeat(Math.max(0, 2 - this.state.catches))}`, 10, 110, 22, pal.fg);
    if (this.running) text(ctx, 'RPM 1800  OK', 10, 140, 22, pal.good);
  }
}

// ---------------------------------------------------------------------------
export class ElectricGenerator extends GeneratorBase {
  constructor(world, id, mission, seed) {
    super(world, id, 'electric', mission);
    // socket order is scrambled deterministically
    const order = [0, 1, 2, 3];
    let s = seed >>> 0;
    for (let i = 3; i > 0; i--) { s = (s * 1103515245 + 12345) >>> 0; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    Object.assign(this.state, { door: 0, wires: [0, 0, 0, 0], fuse: 0, breaker: 0, order });
    this.buildModel('generator_electric');
    this.wireMeshes = [];
    this.pick = -1; // locally selected wire colour (0..3) awaiting a socket
    this.doorAnim = 0;
  }

  prompt(player) {
    const k = input.keyName('interact');
    if (this.running) return `${this.label} — running${this.state.linked ? ' (uplinked)' : ' — bring the radio here'}`;
    if (!this.state.door) return `[${k}] Open the maintenance panel`;
    const wiresDone = this.state.wires.every(Boolean);
    if (!wiresDone) return `[${k}] Re-wire terminals (${this.state.wires.filter(Boolean).length}/4)`;
    if (!this.state.fuse) return player.inv.current?.type === 'fuse' ? `[${k}] Insert fuse` : `${this.label} — fuse socket empty. Find an INDUSTRIAL FUSE`;
    return `[${k}] Throw the breaker`;
  }

  interact(player) {
    if (this.running) return;
    if (!this.state.door) { this.send('door'); return; }
    if (!this.state.wires.every(Boolean)) { this._openWiring(); return; }
    if (!this.state.fuse) {
      if (player.inv.current?.type === 'fuse') {
        player.inv.remove();
        this.send('fuse');
      } else this.mission.game.ui.toast('You need an industrial fuse in your hand');
      return;
    }
    this.send('breaker');
  }

  _openWiring() {
    const game = this.mission.game;
    const self = this;
    const scr = new CrtScreen(512, 384, 'green');
    game.terminal.open({
      device: this,
      screen: scr,
      mesh: this.model.parts.door || this.model.screens?.main?.mesh,
      distance: 1.1,
      anchorNormal: new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion),
      view() {
        const st = self.state;
        const items = [];
        if (self.pick < 0) {
          COLORS.forEach((c, i) => items.push({ label: `WIRE ${c.toUpperCase()}`, hint: st.wires[i] ? 'CONNECTED' : 'LOOSE', disabled: !!st.wires[i], act: 'pick', i }));
        } else {
          ['A', 'B', 'C', 'D'].forEach((L, s) => items.push({ label: `SOCKET ${L}`, hint: `[${COLORS[st.order[s]].toUpperCase().slice(0, 1)}]`, act: 'socket', s }));
          items.push({ label: 'CANCEL', act: 'cancel' });
        }
        return {
          title: `${self.label} — WIRING`,
          subtitle: 'MAINT. PANEL',
          lines: [
            self.pick < 0 ? 'Select a loose wire.' : `Route ${COLORS[self.pick].toUpperCase()} wire to the socket marked with its colour code.`,
            { t: 'Wrong socket = electric shock. R.O.O.M. is not liable.', c: 'dim', s: 20 },
          ],
          items,
          footer: '[W/S] SELECT  [E] CONFIRM  [TAB] LEAVE',
        };
      },
      select(it) {
        if (it.act === 'pick') self.pick = it.i;
        else if (it.act === 'cancel') self.pick = -1;
        else if (it.act === 'socket') {
          self.send('wire', { w: self.pick, s: it.s });
          self.pick = -1;
          if (self.state.wires.filter(Boolean).length >= 3) setTimeout(() => game.terminal.close(), 400);
        }
      },
      back() { if (self.pick >= 0) { self.pick = -1; return true; } return false; },
    });
  }

  hostAction(a, d, from) {
    if (this.running) return;
    const w = this.world;
    if (a === 'door') {
      this.setState({ door: 1 });
      w.fxAll({ k: 'snd', n: 'locker_open', p: this.root.position.toArray(), v: 0.8, pi: 0.7 });
      w.noise.emit(this.root.position, 8, 'door');
    } else if (a === 'wire') {
      const correct = this.state.order[d.s] === d.w;
      const p = this.anchorWorld('terminals', d.w * 2, new THREE.Vector3());
      if (correct) {
        const wires = this.state.wires.slice();
        wires[d.w] = 1;
        this.setState({ wires });
        w.fxAll({ k: 'snd', n: 'wire_connect', p: p.toArray(), v: 0.8 });
        w.fxAll({ k: 'sparks', p: p.toArray(), n: 8, s: 2 });
      } else {
        w.fxAll({ k: 'sparks', p: p.toArray(), n: 30, s: 4 });
        w.fxAll({ k: 'snd', n: 'spark', p: p.toArray(), v: 1 });
        net.toPeer(from, 'shock', { dmg: 6 });
      }
      w.noise.emit(p, 10, 'spark');
    } else if (a === 'fuse') {
      this.setState({ fuse: 1 });
      w.fxAll({ k: 'snd', n: 'fuse_insert', p: this.root.position.toArray(), v: 1 });
    } else if (a === 'breaker') {
      w.fxAll({ k: 'snd', n: 'lever', p: this.root.position.toArray(), v: 1 });
      if (this.state.wires.every(Boolean) && this.state.fuse) {
        this.setState({ breaker: 1 });
        w.fxAll({ k: 'sparks', p: this.root.position.clone().setY(1.2).toArray(), n: 40, s: 5 });
        this.startRunning();
      } else {
        w.fxAll({ k: 'sparks', p: this.root.position.clone().setY(1.2).toArray(), n: 20, s: 3 });
        net.toPeer(from, 'shock', { dmg: 5 });
      }
    }
  }

  onState(s) {
    super.onState(s);
    if (s.wires) this._rebuildWires();
  }

  _rebuildWires() {
    for (const m of this.wireMeshes) m.removeFromParent();
    this.wireMeshes = [];
    const terms = this.model.anchors.terminals;
    if (!terms || terms.length < 8) return;
    this.state.wires.forEach((on, ci) => {
      if (!on) return;
      // left terminal of colour ci -> right terminal of the socket that expects it
      const s = this.state.order.indexOf(ci);
      const a = terms[ci * 2] || terms[ci];
      const b = terms[s * 2 + 1] || terms[4 + s];
      const av = new THREE.Vector3(a.x, a.y, a.z), bv = new THREE.Vector3(b.x, b.y, b.z);
      const mid = av.clone().lerp(bv, 0.5).add(new THREE.Vector3(0, -0.08, 0.08));
      const curve = new THREE.QuadraticBezierCurve3(av, mid, bv);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.012, 6), new THREE.MeshStandardMaterial({ color: HEX[COLORS[ci]], roughness: 0.5 }));
      this.root.add(tube);
      this.wireMeshes.push(tube);
    });
  }

  update(dt) {
    super.update(dt);
    const door = this.model.parts.door;
    this.doorAnim += ((this.state.door ? 1 : 0) - this.doorAnim) * Math.min(1, dt * 4);
    if (door) door.rotation.y = -this.doorAnim * 1.9;
    const br = this.model.parts.breaker;
    if (br) br.rotation.x = this.state.breaker ? -0.8 : 0.8;
    if (this.model.parts.fuseSlot) this.model.parts.fuseSlot.visible = !!this.state.fuse;
  }

  drawStatus(ctx, w, h, pal) {
    text(ctx, `PANEL   ${this.state.door ? 'OPEN' : 'LOCKED'}`, 10, 76, 22, pal.fg);
    text(ctx, `WIRING  ${this.state.wires.filter(Boolean).length}/4`, 10, 100, 22, this.state.wires.every(Boolean) ? pal.good : pal.fg);
    text(ctx, `FUSE    ${this.state.fuse ? 'OK' : 'MISSING'}`, 10, 124, 22, this.state.fuse ? pal.good : pal.bad);
    text(ctx, `BREAKER ${this.state.breaker ? 'ON' : 'OFF'}`, 10, 148, 22, pal.fg);
  }
}

// ---------------------------------------------------------------------------
export class MechGenerator extends GeneratorBase {
  constructor(world, id, mission) {
    super(world, id, 'mech', mission);
    Object.assign(this.state, { cracks: [0, 0, 0], bolts: [0, 0, 0, 0], crank: 0 });
    this.buildModel('generator_mech');
    this.holdTime = 0.01;
    this.crankSend = 0;
    this.crankAnim = 0;
    this.toolSend = 0;
    this.beads = [];
  }

  get sealed() { return this.state.cracks.every((c) => c >= 1); }
  get bolted() { return this.state.bolts.every((b) => b >= 1); }

  prompt(player) {
    const k = input.keyName('interact');
    if (this.running) return `${this.label} — running${this.state.linked ? ' (uplinked)' : ' — bring the radio here'}`;
    if (!this.sealed) return `${this.label} — pressure pipe cracked (${this.state.cracks.filter((c) => c >= 1).length}/3 sealed). WELD the glowing cracks`;
    if (!this.bolted) return `${this.label} — flange bolts loose (${this.state.bolts.filter((b) => b >= 1).length}/4). Tighten with a MULTITOOL [hold RMB]`;
    return `[Hold ${k}] Crank it up (${Math.round(this.state.crank * 100)}%) — more hands, faster`;
  }

  interact() {}

  interactHold(player, dt) {
    if (this.running || !this.sealed || !this.bolted) return;
    this.crankSend -= dt;
    this.crankAnim += dt * 6;
    if (this.crankSend <= 0) {
      this.crankSend = 0.2;
      this.send('crank');
    }
  }

  // multitool on bolts
  toolUse(tool, player, dt, hit) {
    if (tool !== 'multitool' || this.running) return;
    const bolts = this.model.parts.bolts || [];
    let best = -1, bd = 0.22;
    bolts.forEach((b, i) => {
      const p = b.getWorldPosition(new THREE.Vector3());
      const d = p.distanceTo(hit.point);
      if (d < bd && this.state.bolts[i] < 1) { bd = d; best = i; }
    });
    if (best < 0) return;
    this.toolSend -= dt;
    if (this.toolSend <= 0) {
      this.toolSend = 0.2;
      this.send('bolt', { i: best });
      audio.play('bolt_turn', { pos: hit.point, volume: 0.6 });
    }
    this.mission.game.ui.progress(this.state.bolts[best], `TIGHTENING BOLT ${best + 1}`);
  }

  // host: welder ticks near cracks
  weldTick(point) {
    if (this.running) return false;
    const cracks = this.model.anchors.cracks || [];
    for (let i = 0; i < cracks.length; i++) {
      if (this.state.cracks[i] >= 1) continue;
      const p = this.anchorWorld('cracks', i, new THREE.Vector3());
      if (p.distanceTo(point) < 0.3) {
        const c = this.state.cracks.slice();
        c[i] = Math.min(1, c[i] + 0.06);
        this.setState({ cracks: c });
        if (c[i] >= 1) this.world.fxAll({ k: 'snd', n: 'pipe_hiss', p: p.toArray(), v: 0.6, pi: 1.3 });
        return true;
      }
    }
    return false;
  }

  hostAction(a, d) {
    if (this.running) return;
    const w = this.world;
    if (a === 'bolt' && this.sealed) {
      const b = this.state.bolts.slice();
      b[d.i] = Math.min(1, b[d.i] + 0.2);
      this.setState({ bolts: b });
      w.noise.emit(this.root.position, 7, 'ratchet');
    } else if (a === 'bolt') {
      w.fxAll({ k: 'snd', n: 'pipe_hiss', p: this.root.position.clone().setY(1).toArray(), v: 0.8 });
    } else if (a === 'crank' && this.sealed && this.bolted) {
      const c = Math.min(1, this.state.crank + 0.018);
      this.setState({ crank: +c.toFixed(3) });
      w.noise.emit(this.root.position, 9, 'crank');
      if (Math.random() < 0.3) w.fxAll({ k: 'snd', n: 'crank', p: this.root.position.toArray(), v: 0.7 });
      if (c >= 1) this.startRunning();
    }
  }

  update(dt) {
    super.update(dt);
    const P = this.model.parts;
    if (P.flywheel) P.flywheel.rotation.x += dt * (this.running ? 14 : this.crankAnim > 0 ? 3 : 0);
    if (P.crank) P.crank.rotation.x = this.running ? this.world.time * 4 : this.state.crank * 25 + this.crankAnim;
    if (P.needle) {
      const target = this.running ? 1.1 + Math.sin(this.world.time * 7) * 0.05 : this.state.crank * 1.2 - 0.8;
      P.needle.rotation.z += (-target - P.needle.rotation.z) * Math.min(1, dt * 5);
    }
    (P.bolts || []).forEach((b, i) => {
      if (!b.userData.rest) b.userData.rest = { p: b.position.clone(), r: b.rotation.clone() };
      const f = this.state.bolts[i] ?? 0;
      b.rotation.z = b.userData.rest.r.z + f * 12;
      b.position.copy(b.userData.rest.p);
    });
    // glowing cracks (unsealed) / cooling beads (sealed)
    const cracks = this.model.anchors.cracks || [];
    if (this.beads.length !== cracks.length) {
      for (const c of cracks) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff4400, emissiveIntensity: 2 }));
        m.scale.set(1.6, 0.6, 0.8);
        m.position.set(c.x, c.y, c.z);
        this.root.add(m);
        this.beads.push(m);
      }
    }
    this.beads.forEach((m, i) => {
      const s = this.state.cracks[i] ?? 0;
      const t = this.world.time;
      if (s < 1) {
        m.material.color.setHex(0x331100);
        m.material.emissive.setHex(0xff4400);
        m.material.emissiveIntensity = 1 + Math.sin(t * 4 + i) * 0.8 + s * 2;
      } else {
        m.material.emissiveIntensity = Math.max(0, m.material.emissiveIntensity - dt * 0.6);
        m.material.color.setHex(0x555555);
      }
    });
    this.crankAnim = Math.max(0, this.crankAnim - dt);
  }

  drawStatus(ctx, w, h, pal) {
    text(ctx, `CRACKS  ${this.state.cracks.filter((c) => c >= 1).length}/3 SEALED`, 10, 76, 22, this.sealed ? pal.good : pal.bad);
    text(ctx, `BOLTS   ${this.state.bolts.filter((b) => b >= 1).length}/4`, 10, 100, 22, this.bolted ? pal.good : pal.fg);
    text(ctx, 'PRESSURE', 10, 126, 22, pal.fg);
    bar(ctx, 110, 128, w - 124, 18, this.state.crank, pal.fg, pal.dim);
  }
}
