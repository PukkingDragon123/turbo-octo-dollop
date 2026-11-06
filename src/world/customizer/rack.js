// RAGS station: two washing lines strung across the back of the workshop with the cloth garments pegged
// on them (each one a little hanging cloth simulation that sways and swings when touched). Click a rag:
// the pegs pop, it flies over and drops onto the clone, where the real garment cloth falls and drapes
// (one per torso / neck / head / waist; the old one goes back on the line). Click a worn rag on the
// clone to take it off.
import * as THREE from 'three';
import { RAGS, buildRagPreview, parseRags, LEGACY_RAG } from '../../entities/doll/cloth.js';
import { TX, FM, P, ptex, css } from '../../entities/doll/handpaint.js';
import { PI, TAU, clamp, damp, rnd, V, mesh, rbox, cyl, tube, hitBox } from './kit.js';
import { Flyers } from './fly.js';
import { sfx, noiseHit } from './sfx.js';
import { registerStation } from './registry.js';

const LINES = [
  { y: 1.88, z: 1.62, x0: -2.35, x1: -0.3, zones: ['torso', 'waist'] },
  { y: 1.3, z: 1.32, x0: -2.2, x1: -0.45, zones: ['neck', 'head'] },
];
const _v = V();

class RagLine {
  constructor(cz) {
    this.cz = cz;
    this.group = new THREE.Group(); this.group.name = 'cz_rags';
    cz.scene.add(this.group);
    this.fly = new Flyers(cz.scene);
    this.items = [];
    this._build();
    this.active = false;
  }
  _build() {
    const wood = FM.paintedMetal('cz_postwood', TX.wood(0x7a5030, 13), { metal: 0, rough: 0.85 });
    const rope = FM.fabric('cz_rope', TX.cloth(0xd8c8a4, 3, { pitch: 3 }), { sheen: 0.6 });
    const pegMat = FM.paintedMetal('cz_peg', TX.wood(0xc8a070, 14), { metal: 0, rough: 0.7 });
    for (const L of LINES) {
      for (const x of [L.x0 - 0.08, L.x1 + 0.08]) {
        this.group.add(mesh(cyl(0.022, L.y + 0.08, 12), wood, { x, y: (L.y + 0.08) / 2, z: L.z }));
        this.group.add(mesh(lathe0(), wood, { x, y: 0, z: L.z }));
      }
      const pts = [];
      for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push(V(L.x0 - 0.08 + (L.x1 - L.x0 + 0.16) * u, L.y - Math.sin(u * PI) * 0.05, L.z)); }
      this.group.add(mesh(tube(pts, 0.004, 48, 6), rope));
      L.sag = (x) => L.y - Math.sin(clamp((x - L.x0 + 0.08) / (L.x1 - L.x0 + 0.16), 0, 1) * PI) * 0.05;
      const list = RAGS.filter((r) => L.zones.includes(r.zone));
      list.forEach((r, k) => {
        const x = L.x0 + 0.14 + k * ((L.x1 - L.x0 - 0.28) / Math.max(1, list.length - 1));
        const prev = buildRagPreview(r.id);
        if (!prev) return;
        const holder = new THREE.Group();
        holder.position.set(x, L.sag(x) - 0.004, L.z);
        holder.rotation.y = PI + rnd(-0.12, 0.12);
        this.group.add(holder);
        const sc = r.type === 'scarf' || r.type === 'headwrap' ? 0.62 : r.type === 'bandana' ? 0.9 : 0.72;
        prev.object.scale.setScalar(sc);
        holder.add(prev.object);
        // two wooden clothes pegs
        const pegs = [];
        for (const s of [-1, 1]) {
          const W = r.type === 'scarf' || r.type === 'headwrap' ? 0.03 : r.type === 'bandana' ? 0.13 : 0.16;
          const pg = new THREE.Group(); pg.position.set(s * W * sc, 0.006, -0.006); holder.add(pg);
          pg.add(mesh(rbox(0.009, 0.05, 0.005, 0.002), pegMat, { z: -0.003 }));
          pg.add(mesh(rbox(0.009, 0.05, 0.005, 0.002), pegMat, { z: 0.003 }));
          pg.add(mesh(new THREE.TorusGeometry(0.004, 0.0012, 6, 10), FM.bare('cz_spring', 0xb8b4aa, { rough: 0.3 }), { y: 0.004, ry: PI / 2 }));
          pegs.push(pg);
        }
        const hb = hitBox(0.3 * sc / 0.72, 0.5 * sc / 0.72, 0.06); hb.position.y = -0.22 * sc / 0.72;
        if (r.type === 'scarf' || r.type === 'headwrap') { hb.scale.set(0.35, 1.1, 1); hb.position.y = -0.28; }
        holder.add(hb);
        this.cz.hits.add(hb, { st: 'rags', type: 'rag', id: r.id, hover: () => { this.hoverId = r.id; } });
        this.items.push({ r, prev, holder, pegs, hb, home: holder.position.clone(), out: false, swing: 0 });
      });
    }
  }
  item(id) { return this.items.find((i) => i.r.id === id); }
  worn() { return parseRags([this.cz.cos.rags, LEGACY_RAG[this.cz.cos.accessory]].filter(Boolean).join(',')).map((e) => e.id); }

  click(act) {
    if (act.type !== 'rag' || this.fly.busy) return;
    const it = this.item(act.id);
    if (!it || it.out) { this._takeOff(act.id); return; }
    const cz = this.cz;
    const worn = this.worn();
    const same = worn.find((id) => this.item(id)?.r.zone === it.r.zone);
    // pegs pop off, the rag flies over and drops onto the clone
    sfx('pull_cord', { volume: 0.35, pitch: 1.6 });
    noiseHit({ freq: 2200, q: 6, dur: 0.05, vol: 0.2 });
    for (const pg of it.pegs) pg.userData.popV = rnd(3, 5);
    it.out = true;
    const target = () => {
      const b = cz.avatar.bones[it.r.zone === 'head' ? 'head' : it.r.zone === 'neck' ? 'neck' : it.r.zone === 'waist' ? 'pelvis' : 'chest'];
      return b.getWorldPosition(V()).add(V(0, 0.32, 0));
    };
    sfx('throw_whoosh', { volume: 0.3, pitch: 1.2 });
    this.fly.add(it.holder, {
      to: target, dur: 0.7, arc: 0.35, spin: 1.5, scaleTo: 0.4,
      onArrive: () => {
        it.holder.visible = false;
        const keep = worn.filter((id) => id !== same && (this.item(id)?.r.zone !== it.r.zone));
        const patch = { rags: [...keep, it.r.id].join(',') };
        if (LEGACY_RAG[cz.cos.accessory]) patch.accessory = 'none';
        cz.setCos(patch);
        cz.avatar.cloth?.dropIn(it.r.id, 0.4);
        sfx('suit_rustle', { volume: 0.55, pitch: 0.9 });
        cz.pop(0.35);
        if (same) this._returnHome(same);
      },
    });
  }
  _takeOff(id) {
    const cz = this.cz;
    const worn = this.worn();
    if (!worn.includes(id)) return;
    const patch = { rags: worn.filter((x) => x !== id).join(',') };
    if (LEGACY_RAG[cz.cos.accessory] === id) patch.accessory = 'none';
    cz.setCos(patch);
    sfx('suit_rustle', { volume: 0.5, pitch: 1.2 });
    this._returnHome(id, true);
  }
  // a garment flies back from the clone onto its peg spot
  _returnHome(id, fromBody = true) {
    const it = this.item(id);
    if (!it) return;
    const cz = this.cz;
    this.group.attach(it.holder);
    it.holder.visible = true;
    if (fromBody) cz.avatar.bones.chest.getWorldPosition(_v).add(V(0, 0.2, 0)); else it.holder.getWorldPosition(_v);
    this.group.worldToLocal(_v);
    it.holder.position.copy(_v);
    it.holder.scale.setScalar(0.4);
    this.fly.add(it.holder, {
      to: () => this.group.localToWorld(it.home.clone()), dur: 0.75, arc: 0.3, spin: -1.5, scaleTo: 1 / 0.4,
      onArrive: () => {
        this.group.attach(it.holder); it.holder.position.copy(it.home); it.holder.scale.setScalar(1); it.holder.rotation.set(0, PI + rnd(-0.12, 0.12), 0);
        it.out = false; for (const pg of it.pegs) { pg.position.y = 0.006; pg.userData.popV = 0; pg.rotation.z = 0; }
        it.prev.kick(V(rnd(-0.6, 0.6), 0, 1.2));
        sfx('pull_cord', { volume: 0.25, pitch: 2 });
      },
    });
  }
  // a click on the clone: is it on a worn rag?  (the customizer calls this before spinning the turntable)
  dragStart(P0) {
    const meshes = (this.cz.avatar.cloth?.list || []).map((G) => G.mesh);
    if (!meshes.length) return false;
    const rc = new THREE.Raycaster(); rc.setFromCamera(P0.ndc, this.cz.camera);
    const h = rc.intersectObjects(meshes, false)[0];
    if (!h) return false;
    P0.ragHit = h.object.name.replace('rag_', '');
    return true;
  }
  dragMove() {}
  dragEnd(P0) { if (P0.moved < 18 && P0.ragHit) this._takeOff(P0.ragHit); }

  update(dt, active) {
    this.fly.update(dt);
    const t = this.cz.t;
    for (const it of this.items) {
      if (it.holder.visible && (active || this.fly.busy || this.cz.camT < 1)) {
        const hov = active && this.hoverId === it.r.id;
        if (hov && !it.hov) { it.prev.kick(V(rnd(-0.4, 0.4), 0, 0.6)); noiseHit({ freq: 900, q: 1, dur: 0.15, vol: 0.05 }); }
        it.hov = hov;
        it.prev.update(dt);
      }
      for (const pg of it.pegs) {
        if (pg.userData.popV) { pg.userData.popV -= dt * 12; pg.position.y += pg.userData.popV * dt * 0.1; pg.rotation.z += dt * 8; }
      }
      void t;
    }
    this.hoverId = null;
  }
  dispose() {}
}
function lathe0() {
  const g = new THREE.CylinderGeometry(0.06, 0.08, 0.04, 16);
  g.translate(0, 0.02, 0);
  return g;
}

registerStation('rags', (cz) => new RagLine(cz));
void TAU; void damp; void P; void ptex; void css;
