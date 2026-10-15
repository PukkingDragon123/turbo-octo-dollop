// Crafting by scavenging. Dismantle furniture with the multitool -> planks / scrap / screws / cloth /
// wire -> build things at a workbench (the ones standing in the level and the camp's field bench).
// Materials count when they lie ON or right BY the bench, or sit in the crafter's pockets.
// Big builds (trolley, distorter, barricade) are put down on the floor in front of the bench, small
// ones on its top. Host authoritative: the client only reports which pocket items it spent.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { profile } from '../core/profile.js';
import { text, wrap } from '../ui/crt.js';
import { itemName } from './itemdefs.js';
import { Workbench, DEVICE_FACTORIES } from './devicekinds.js';
import { modelHalfHeight } from '../entities/catalog.js';
import { Q } from '../physics/physics.js';

export const CRAFT_RECIPES = [
  { id: 'trolley', name: 'Wheel Trolley', needs: { plank: 2, metal_scrap: 2, screws: 1 }, big: true, desc: 'Flat cart on four wheels. Grab the handle and push; load furniture on the deck and roll it to the pads.' },
  { id: 'distorter', name: 'Distorter', needs: { wire_spool: 2, metal_scrap: 2, screws: 1 }, big: true, desc: 'Set it down upright: a 7 m field no monster can enter. Feed it batteries or wire.' },
  { id: 'barricade_panel', name: 'Barricade Panel', needs: { plank: 3, screws: 1 }, big: true, desc: 'Heavy boarded panel. Weld it across a doorway.' },
  { id: 'spike_trap', name: 'Spike Trap', needs: { plank: 1, metal_scrap: 1, screws: 1 }, desc: 'Nails up. Hurts and stops whatever steps on it.' },
  { id: 'flare', name: 'Flare Torch', needs: { plank: 1, fabric_scrap: 1 }, desc: 'Strike it [RMB] and throw it: burns red for 90 s. Monsters back away from it.' },
  { id: 'noise_maker', name: 'Noise Maker', needs: { metal_scrap: 1, wire_spool: 1 }, desc: 'Arm it, throw it, run: lures things away for a while.' },
  { id: 'bandage', name: 'Bandage', needs: { fabric_scrap: 2 }, desc: 'Stops light bleeding.' },
];
const BY_ID = Object.fromEntries(CRAFT_RECIPES.map((r) => [r.id, r]));
const SHORT = { plank: 'Plank', metal_scrap: 'Scrap metal', screws: 'Screws', fabric_scrap: 'Cloth', wire_spool: 'Wire', pipe_short: 'Pipe', gear: 'Gear' };

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export function recipeOk(r, have) {
  for (const k in r.needs) if ((have[k] || 0) < r.needs[k]) return false;
  return true;
}

// ---------------------------------------------------------------------------
export class CraftStation {
  // o: { root: Object3D, top: Vector3 (local bench-top centre), reach (m), front (m, local +Z), title, send(a, d) }
  constructor(world, o) {
    this.world = world;
    this.o = o;
    this._list = [];
    this._bench = {};
    this._have = {};
    this._idleT = 0;
  }

  get game() { return this.world.game; }

  topWorld(out = new THREE.Vector3()) {
    this.o.root.updateMatrixWorld(true);
    return out.copy(this.o.top).applyMatrix4(this.o.root.matrixWorld);
  }

  // material props lying on / right by the bench
  materials() {
    const out = this._list;
    out.length = 0;
    const c = this.topWorld(_v);
    const reach = this.o.reach ?? 1.7;
    this.world.props.query(c, reach + 1.2, (p) => {
      if (p.dead || !p.def.material) return;
      const dx = p.root.position.x - c.x, dz = p.root.position.z - c.z;
      if (dx * dx + dz * dz > reach * reach) return;
      if (p.root.position.y > c.y + 1.2) return;
      out.push(p);
    });
    return out;
  }

  benchCounts() {
    const c = this._bench;
    for (const k in c) c[k] = 0;
    for (const p of this.materials()) c[p.type] = (c[p.type] || 0) + 1;
    return c;
  }

  // bench + local pockets
  haveCounts() {
    const bench = this.benchCounts();
    const h = this._have;
    for (const k in h) h[k] = 0;
    for (const k in bench) h[k] = bench[k];
    for (const it of this.game.local.inv.slots) if (it) h[it.type] = (h[it.type] || 0) + 1;
    return h;
  }

  // ---------------- client UI ----------------
  open(spec) {
    const self = this;
    const g = this.game;
    // small CRTs: show the screen as a big readable panel beside the bench (like the vending machines)
    this.o.root.updateMatrixWorld(true);
    g.terminal.open({
      overlay: true,
      target: this.topWorld(new THREE.Vector3()).add(_v.set(0, 0.25, 0)),
      distance: 1.6,
      anchorNormal: new THREE.Vector3(0, 0, 1).applyQuaternion(this.o.root.getWorldQuaternion(_q)),
      ...spec,
      view() {
        const have = self.haveCounts();
        return {
          title: self.o.title || 'FABRICATION BENCH',
          items: CRAFT_RECIPES.map((r) => ({ label: r.name, disabled: !recipeOk(r, have), r })),
          have,
        };
      },
      draw(ctx, w, h, pal, t, view) { self.drawMenu(ctx, w, h, pal, t, view); },
      select(it) { self.craft(it.r); },
    });
  }

  drawMenu(ctx, w, h, pal, t, view) {
    const pad = 18, split = 250;
    text(ctx, view.title, pad, 10, 32, pal.hi);
    text(ctx, 'SCRAP-OS 2.1', w - pad, 16, 20, pal.dim, 'right');
    ctx.fillStyle = pal.dim;
    ctx.fillRect(pad, 46, w - pad * 2, 2);
    ctx.fillRect(split, 54, 2, h - 104);
    // recipe list
    let y = 56;
    view.items.forEach((it, i) => {
      const sel = i === view.sel;
      if (sel) { ctx.fillStyle = it.disabled ? pal.dim : pal.fg; ctx.fillRect(pad - 6, y - 1, split - pad, 30); }
      const col = sel ? pal.bg : it.disabled ? pal.dim : pal.fg;
      text(ctx, `${i + 1} ${it.label}`, pad, y, 25, col);
      text(ctx, it.disabled ? '' : 'OK', split - 10, y + 1, 22, sel ? pal.bg : pal.good, 'right');
      y += 33;
    });
    // detail panel for the highlighted recipe
    const it = view.items[view.sel] || view.items[0];
    const r = it.r, x0 = split + 14;
    text(ctx, r.name.toUpperCase(), x0, 56, 26, pal.hi);
    text(ctx, 'PART', x0, 88, 20, pal.dim);
    text(ctx, 'NEED', w - pad - 62, 88, 20, pal.dim, 'right');
    text(ctx, 'HAVE', w - pad, 88, 20, pal.dim, 'right');
    let ry = 110;
    for (const k in r.needs) {
      const n = r.needs[k], hv = view.have[k] || 0;
      const ok = hv >= n;
      text(ctx, SHORT[k] || itemName(k), x0, ry, 23, pal.fg);
      text(ctx, String(n), w - pad - 62, ry, 23, pal.fg, 'right');
      text(ctx, String(hv), w - pad, ry, 23, ok ? pal.good : pal.bad, 'right');
      ry += 25;
    }
    ry += 6;
    for (const ln of wrap(ctx, r.desc, w - x0 - pad, 19).slice(0, 5)) { text(ctx, ln, x0, ry, 19, pal.dim); ry += 19; }
    ctx.fillStyle = pal.dim;
    ctx.fillRect(pad, h - 48, w - pad * 2, 2);
    text(ctx, 'Parts ON/BY the bench + your pockets count.', pad, h - 44, 19, pal.dim);
    text(ctx, it.disabled ? 'MISSING PARTS — dismantle furniture (empty hand + RMB)' : '[E] BUILD   [W/S] SELECT   [TAB] LEAVE', pad, h - 24, 19, it.disabled ? pal.bad : pal.fg);
    if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = pal.fg; ctx.fillRect(w - pad - 10, h - 24, 9, 16); }
  }

  craft(r) {
    const l = this.game.local;
    const bench = this.benchCounts();
    const use = {};
    for (const k in r.needs) {
      const lack = r.needs[k] - (bench[k] || 0);
      if (lack > 0) use[k] = lack;
    }
    for (const k in use) {
      if (l.inv.count(k) < use[k]) {
        this.game.ui.toast(`Missing ${itemName(k)}`, 'warn');
        audio.play('ui_error', { volume: 0.4, bus: 'ui' });
        return;
      }
    }
    for (const k in use) for (let i = 0; i < use[k]; i++) l.inv.remove(l.inv.find(k));
    this.o.send('craft', { id: r.id, inv: use });
    this.game.ui.toast(`Building: ${r.name}…`);
  }

  // idle screen while nobody uses the bench (bench-top materials only)
  drawIdle(scr, dt) {
    this._idleT -= dt;
    if (this._idleT > 0 && scr.lastDraw >= 0) return;
    this._idleT = 0.6;
    const have = this.benchCounts();
    scr.fps = 2;
    scr.draw(dt, (ctx, w, h, pal) => {
      text(ctx, this.o.title || 'FABRICATION BENCH', 20, 14, 32, pal.hi);
      text(ctx, 'Lay scavenged parts on the bench,', 20, 54, 22, pal.fg);
      text(ctx, `then press [${input.keyName('interact')}] to build:`, 20, 76, 22, pal.fg);
      CRAFT_RECIPES.forEach((r, i) => {
        const ok = recipeOk(r, have);
        text(ctx, `${ok ? '*' : '-'} ${r.name}`, 30, 110 + i * 30, 24, ok ? pal.good : pal.dim);
      });
    }, true);
  }

  // ---------------- host ----------------
  hostCraft(d, from) {
    const w = this.world;
    const r = BY_ID[d?.id];
    const inv = {};
    if (r && d.inv) for (const k in r.needs) inv[k] = Math.max(0, Math.min(r.needs[k], d.inv[k] | 0));
    else if (d?.inv) for (const k in d.inv) inv[k] = Math.max(0, Math.min(5, d.inv[k] | 0));
    const top = this.topWorld(new THREE.Vector3());
    const refund = () => {
      let i = 0;
      for (const k in inv) for (let n = 0; n < inv[k]; n++, i++) w.props.spawn(k, top.clone().add(_v.set(Math.cos(i * 2) * 0.2, 0.3 + i * 0.05, Math.sin(i * 2) * 0.15)), new THREE.Quaternion());
    };
    if (!r) { refund(); return; }
    const mats = this.materials().slice();
    const counts = {};
    for (const p of mats) counts[p.type] = (counts[p.type] || 0) + 1;
    for (const k in r.needs) {
      if ((counts[k] || 0) + (inv[k] || 0) < r.needs[k]) {
        refund();
        net.toPeer(from, 'hq', { text: 'Parts went missing from the bench. Try again.', from: 'BENCH' });
        return;
      }
    }
    // consume bench parts nearest to the top first
    mats.sort((a, b) => a.root.position.distanceToSquared(top) - b.root.position.distanceToSquared(top));
    const need = {};
    for (const k in r.needs) need[k] = r.needs[k] - (inv[k] || 0);
    for (const p of mats) {
      if (need[p.type] > 0) { need[p.type]--; w.grab.releaseAllFor(p.id); w.props.despawn(p.id); }
    }
    w.fxAll({ k: 'snd', n: 'craft', p: top.toArray(), v: 1 });
    w.fxAll({ k: 'dust', p: top.toArray(), n: 16 });
    w.noise.emit(top, 14, 'craft');
    const { pos, quat } = this._spawnPose(r);
    setTimeout(() => {
      if (!w.props) return;
      w.props.spawn(r.id, pos, quat, { state: r.id === 'distorter' ? { charge: 1 } : {} });
      w.fxAll({ k: 'snd', n: 'craft', p: pos.toArray(), v: 0.6 });
    }, 900);
    if (from === net.selfId) profile.unlock('craft');
    else net.toPeer(from, 'ach', 'craft');
  }

  _spawnPose(r) {
    const root = this.o.root;
    root.updateMatrixWorld(true);
    const yaw = new THREE.Euler().setFromQuaternion(root.getWorldQuaternion(_q), 'YXZ').y;
    if (!r.big) {
      const p = this.topWorld(new THREE.Vector3());
      p.y += 0.3;
      return { pos: p, quat: new THREE.Quaternion().setFromEuler(_e.set(0, yaw + Math.random() * 0.6, 0)) };
    }
    // floor spot in front of the bench (or beside it) with nothing in the way
    const hh = modelHalfHeight(r.id);
    const floorY = root.getWorldPosition(new THREE.Vector3()).y;
    const front = this.o.front ?? 1.1;
    const cands = [[0, front], [-0.9, front], [0.9, front], [0, front + 0.8], [-1.6, 0.2], [1.6, 0.2]];
    const quat = new THREE.Quaternion().setFromEuler(_e.set(0, yaw + (r.id === 'trolley' ? Math.PI / 2 : 0), 0));
    let best = null;
    for (const [x, z] of cands) {
      const p = new THREE.Vector3(x, 0, z).applyMatrix4(root.matrixWorld);
      p.y = floorY + hh + 0.04;
      let blocked = false;
      this.world.physics.overlapBox(_v.set(p.x, floorY + 0.45, p.z), { x: 0.45, y: 0.35, z: 0.45 }, Q.solid, () => { blocked = true; });
      if (!blocked) { best = p; break; }
      if (!best) best = p;
    }
    return { pos: best, quat };
  }
}

// ---------------------------------------------------------------------------
// The level's workbench devices use the same station (registered over devicekinds' Workbench)
export class CraftBench extends Workbench {
  constructor(world, id, opts) {
    super(world, id, opts);
    this.station = new CraftStation(world, {
      root: this.root,
      top: new THREE.Vector3(-0.1, 0.92, 0.1),
      reach: 1.6,
      front: 1.25,
      title: 'FABRICATION BENCH',
      send: (a, d) => this.send(a, d),
    });
  }
  prompt() { return `[${input.keyName('interact')}] Use workbench — build from scavenged parts`; }
  interact() {
    this.station.open({ device: this, screen: this.scr, mesh: this.model.screens?.main?.mesh });
  }
  hostAction(a, d, from) { if (a === 'craft') this.station.hostCraft(d, from); }
  update(dt) {
    if (this.world.game.terminal.session?.device === this || !this.nearLocal(8)) return;
    this.station.drawIdle(this.scr, dt);
  }
}
DEVICE_FACTORIES.workbench = (world, id, opts) => new CraftBench(world, id, opts);
