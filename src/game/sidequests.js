// Side-quest content placed in the maze for the camp loop (deterministic from the level seed, so every peer
// plans the same spots):
//   CASE FILES   manila dossiers hidden in office-like special rooms. The host drops one in when its chunk is
//                loaded (tagged as level population, so it hibernates with the chunk). Crushing one counts.
//   GENERATORS   dead mechanical generators against a maze wall: tighten the bolts (multitool), then crank.
//                Reuses game/generators.js MechGenerator with its pipe already welded.
// Pins for both show on the watch MAP while the matching quest is open.
import * as THREE from 'three';
import { net } from '../net/net.js';
import { CELL } from '../world/levels/yellow/layout.js';
import { MechGenerator } from './generators.js';
import { RNG, hash3 } from '../core/rng.js';

const FILE_ROOMS = ['office_room', 'manila_room', 'library', 'cubicle_farm', 'server_room', 'storage', 'break_room', 'bedroom', 'living_room', 'locker_room', 'dead_clone', 'workshop'];

export class SideQuests {
  constructor(mission) {
    this.m = mission;
    this.world = mission.world;
    this.level = mission.level;
    this.files = [];   // [{ x, z }]
    this.gens = [];    // MechGenerator devices
    this._t = 0;
    this._cleared = new Set();
  }

  get econ() { return this.m.econ; }

  // every peer
  build() {
    const lvl = this.level, rules = this.econ.rules;
    const camp = this.m.camp.pos;
    // ---- case files: one per room, spread out, outside the arrival complex
    let rooms = [];
    try { rooms = lvl.findRooms?.(FILE_ROOMS, 3) || []; } catch (e) { rooms = []; }
    for (const r of rooms) {
      if (this.files.length >= rules.files) break;
      if (Math.hypot(r.x - camp.x, r.z - camp.z) < 30) continue;
      if (this.files.some((f) => Math.hypot(f.x - r.x, f.z - r.z) < 16)) continue;
      const rng = new RNG(hash3(lvl.seed, Math.round(r.x), Math.round(r.z)));
      this.files.push({ x: r.x + rng.range(-0.25, 0.25) * Math.min(r.w, 4), z: r.z + rng.range(-0.25, 0.25) * Math.min(r.d, 4), room: r.kind });
    }
    // ---- generators: plain maze cells against a solid north wall, in three directions around the camp
    if (lvl.cell && lvl.passable) {
      const rng = new RNG(hash3(lvl.seed, 41, 7, 3));
      const a0 = rng.next() * Math.PI * 2;
      const ci = Math.floor(camp.x / CELL), cj = Math.floor(camp.z / CELL);
      for (let k = 0; k < rules.gens; k++) {
        const a = a0 + (k * Math.PI * 2) / rules.gens;
        const spot = this._genSpot(ci, cj, a, rng);
        if (!spot) continue;
        const g = new MechGenerator(this.world, `sq_gen_${k}`, this.m);
        g.state.cracks = [1, 1, 1]; // pipe already welded: bolts + crank only
        g.label = `GENERATOR ${'ABC'[k] || k + 1}`;
        g.root.position.set(spot.x, lvl.floorY?.(spot.x, spot.z) ?? 0, spot.z);
        g.root.rotation.y = 0;
        this.world.addDevice(g);
        lvl.prepStatic(g.root, null);
        for (const c of g.colliders) this.world.physics.removeCollider(c);
        if (g.body) this.world.physics.removeBody(g.body);
        g.colliders = [];
        g.addColliders(g.model.colliders);
        this.gens.push(g);
      }
    }
  }

  _genSpot(ci, cj, ang, rng) {
    const lvl = this.level;
    for (let tries = 0; tries < 60; tries++) {
      const r = 8 + rng.next() * 6 + tries * 0.15;
      const a = ang + rng.range(-0.5, 0.5);
      const i = ci + Math.round(Math.cos(a) * r), j = cj + Math.round(Math.sin(a) * r);
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      const c = lvl.cell(x, z);
      if (!c || c.special || c.water || c.hole || c.crawl || c.landmark || c.reserved || c.pit) continue;
      if ((c.ceil ?? 3) < 2.6) continue;
      if (lvl.passable(i, j, 0)) continue; // need a wall to stand against
      if (!lvl.passable(i, j, 2) && !lvl.passable(i, j, 1) && !lvl.passable(i, j, 3)) continue; // and a way in
      if (this.gens.some((g) => Math.hypot(g.root.position.x - x, g.root.position.z - z) < 20)) continue;
      return { x, z: j * CELL + 0.9 };
    }
    return null;
  }

  // host
  hostUpdate(dt) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 1;
    const st = this.m.state;
    st.files ??= this.files.map(() => 0); // 0 = not placed, 1 = placed, 2 = delivered
    let dirty = false;
    this.files.forEach((f, i) => {
      if (st.files[i] || !this.level.isChunkLoaded?.(f.x, f.z)) return;
      const y = (this.level.floorY?.(f.x, f.z) ?? 0) + 1.1;
      const p = this.world.props.spawn('case_file', new THREE.Vector3(f.x, y, f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i * 1.7) % 6.28, 0)), { state: { fi: i } });
      if (p) { p.levelSpawn = true; st.files[i] = 1; dirty = true; }
    });
    // furniture that the chunk dropped onto a generator's footprint gets cleared once
    for (const g of this.gens) {
      if (this._cleared.has(g.id) || !this.level.isChunkLoaded?.(g.root.position.x, g.root.position.z)) continue;
      this._cleared.add(g.id);
      this.world.props.query(g.root.position, 2.2, (p) => {
        if (p.frozen || p.type === 'case_file') return;
        const d = p.root.position;
        if (Math.abs(d.x - g.root.position.x) < 1.3 + (p.radius || 0.3) * 0.5 && Math.abs(d.z - g.root.position.z) < 1.2) this.world.props.despawn(p.id);
      });
    }
    if (dirty) this.m.pushState();
  }

  // host: a case file went through the crusher
  onFileDelivered(state) {
    const st = this.m.state;
    if (state?.fi == null || !st.files) return;
    st.files[state.fi] = 2;
    this.m.pushState();
  }

  markers() {
    const e = this.econ, out = [];
    if (!e) return out;
    const fq = ['r_paper', 'r_dossier'].some((id) => ['active', 'ready'].includes(e.state(e.byId[id])));
    if (fq) this.files.forEach((f, i) => { if ((this.m.state.files?.[i] ?? 0) < 2) out.push({ kind: 'file', pos: new THREE.Vector3(f.x, 0, f.z), label: 'FILE' }); });
    const gq = ['t_power', 't_grid'].some((id) => ['active', 'ready'].includes(e.state(e.byId[id])));
    if (gq) for (const g of this.gens) if (!g.running) out.push({ kind: 'gen', pos: g.root.position.clone(), label: 'GEN' });
    return out;
  }

  dispose() { void net; }
}
