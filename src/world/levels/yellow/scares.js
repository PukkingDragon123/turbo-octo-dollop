// Level 0 scares and unsettling events. Everything here is local to each clone (no networking: every player gets
// their own scares), never harms anyone, and stays quiet on Day 1 until the camp is built, in the camp / pad hall
// and during cutscenes.
//
// Jumpscares (rare: one every 3-5 minutes of eligible time, sharp sting + camera punch):
//   lunge     a gaunt figure sprints across the corridor a few metres ahead
//   vent      a pale face snaps into view behind the grille of a nearby wall vent
//   blackout  every light around trips at once, a shriek in the dark, then the tubes stutter back
//   behind    a broken robot clone (Still Life) stands right behind you; turn around and it is there (for a moment)
// Unsettling events (every 1-2.5 minutes, quiet):
//   phone     a desk phone rings in an empty office; it stops the moment you are close enough to answer
//   lights    the lights go out one by one behind you as you walk down a hall, and come back after a while
//   figure    someone stands at the far end of a long sight line; walk towards it or look away and it is gone
//   facing    (host) chairs and armchairs you are not looking at turn to face you
import * as THREE from 'three';
import { engine } from '../../../core/engine.js';
import { audio } from '../../../audio/audio.js';
import { net } from '../../../net/net.js';
import { CELL } from './layout.js';
import { LightField } from '../../../gfx/bakedlight.js';
import { Q } from '../../../physics/physics.js';
import { buildStillLife } from '../../../entities/optional.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

// --- figures (shared geometry / materials, built once) ---------------------------------------------------------
let G = null;
function geo() {
  if (G) return G;
  G = {
    limb: new THREE.CapsuleGeometry(0.045, 0.75, 3, 6),
    torso: new THREE.CapsuleGeometry(0.13, 0.62, 3, 8),
    head: new THREE.SphereGeometry(0.13, 10, 8),
    body: new THREE.CapsuleGeometry(0.29, 0.5, 4, 10),
    dollHead: new THREE.SphereGeometry(0.26, 14, 10),
    stub: new THREE.CapsuleGeometry(0.09, 0.32, 3, 8),
    face: new THREE.SphereGeometry(0.17, 14, 10),
    eye: new THREE.SphereGeometry(0.035, 8, 6),
    dark: new THREE.MeshStandardMaterial({ color: 0x070605, roughness: 0.95 }),
    pale: new THREE.MeshStandardMaterial({ color: 0xd9ccb5, roughness: 0.55 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe8ddd0, roughness: 0.6, emissive: 0x3a332c, emissiveIntensity: 0.6 }),
    void: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  };
  return G;
}
const mesh = (g, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; return o; };

// tall, too-thin dark figure (front +z): jointed at hips / shoulders so poses stay connected
function joint(parent, x, y, z, rx, rz, len, g, m) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  j.rotation.set(rx, 0, rz);
  j.add(mesh(g, m, 0, -len / 2, 0));
  parent.add(j);
  return j;
}
function silhouette(pose = 'stand') {
  const g = geo(), r = new THREE.Group();
  const run = pose === 'run';
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  r.add(hips);
  const body = new THREE.Group();
  body.rotation.x = run ? 0.38 : 0.04;
  hips.add(body);
  body.add(mesh(g.torso, g.dark, 0, 0.5, 0));
  body.add(mesh(g.head, g.dark, 0, 1.08, 0.04, 0, 0, run ? 0 : 0.28));
  for (const s of [-1, 1]) joint(body, s * 0.19, 0.88, 0, run ? s * 0.95 : 0.05, s * 0.1, 0.84, g.limb, g.dark);
  for (const s of [-1, 1]) joint(hips, s * 0.09, 0, 0, run ? -s * 0.75 : 0, s * 0.03, 0.84, g.limb, g.dark);
  return r;
}
// a pale face with empty eyes and a slack open mouth (front +z)
function face() {
  const g = geo(), r = new THREE.Group();
  const f = mesh(g.face, g.skin, 0, 0, 0);
  f.scale.set(0.85, 1.15, 0.55);
  r.add(f);
  for (const s of [-1, 1]) { const e = mesh(g.eye, g.void, s * 0.055, 0.04, 0.085); e.scale.set(1, 1.3, 0.5); r.add(e); }
  const m = mesh(g.eye, g.void, 0, -0.08, 0.085); m.scale.set(1.2, 2.2, 0.5); r.add(m);
  return r;
}

export class Scares {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.scareT = 0;
    this.nextScare = rand(200, 300);
    this.eventT = 0;
    this.nextEvent = rand(70, 130);
    this.active = [];
    this.vel = new THREE.Vector3();
    this.prev = null;
    this.punch = 0;
    this.enabled = !/[?&]scares=0/.test(globalThis.location?.search || '');
  }

  allowed() {
    const g = this.game, l = g.local;
    if (!this.enabled || !l || l.dead || g.cutscene || !l.world) return false;
    const m = this.level.mission;
    if ((g.day?.day ?? 1) === 1 && (!m || m.stage === 'camp')) return false;
    const c = this.level.cell(l.pos.x, l.pos.z);
    if (c?.landmark && c.landmark !== 'apron') return false;
    return true;
  }

  update(dt) {
    const l = this.game.local;
    if (!l) return;
    // smoothed walking velocity (for "behind you")
    if (this.prev) {
      _v.subVectors(l.pos, this.prev).divideScalar(Math.max(dt, 1e-3));
      _v.y = 0;
      this.vel.lerp(_v, Math.min(1, dt * 3));
    }
    this.prev = (this.prev || new THREE.Vector3()).copy(l.pos);
    for (let k = this.active.length - 1; k >= 0; k--) {
      const a = this.active[k];
      if (!a.update(dt)) { a.dispose?.(); this.active.splice(k, 1); }
    }
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - dt * 2.2);
      const pp = engine.post.params;
      pp.uGlitch.value = Math.max(pp.uGlitch.value, this.punch * 0.35);
    }
    if (!this.allowed()) return;
    this.scareT += dt;
    this.eventT += dt;
    if (this.scareT > this.nextScare && !this.active.some((a) => a.scare)) {
      const ok = this._startScare();
      if (ok) { this.scareT = 0; this.nextScare = rand(180, 300); } else this.scareT = this.nextScare - 8;
    }
    if (this.eventT > this.nextEvent && this.active.length < 2) {
      const ok = this._startEvent();
      if (ok) { this.eventT = 0; this.nextEvent = rand(60, 150); } else this.eventT = this.nextEvent - 6;
    }
  }

  // ------------------------------------------------------------------ helpers
  _cam() { return engine.camera.position; }
  _fwd() { engine.camera.getWorldDirection(_f); _f.y = 0; return _f.normalize(); }
  _los(x0, z0, x1, z1, min = 0.3) { return this.level.occluder(x0, z0, x1, z1) >= min; }
  // a real (physics) sight line at head height: the grid occluder treats a doorway edge as see-through even
  // when the line actually hits the wall beside the door; static geometry and furniture both block
  _sees(x0, z0, x1, z1, y = 1.5) {
    const ph = this.world.physics;
    if (!ph?.lineOfSight) return true;
    _a.set(x0, y, z0); _b.set(x1, y, z1);
    return ph.lineOfSight(_a, _b, Q.solid);
  }
  _hit(strength = 1) {
    this.punch = Math.max(this.punch, strength);
    const l = this.game.local;
    l.shake = Math.max(l.shake || 0, 0.55 * strength);
    if (l.survival) l.survival.sanity = Math.max(0, (l.survival.sanity ?? 100) - 5 * strength);
  }
  _addFigure(root) {
    this.world.group.add(root);
    root.updateMatrixWorld(true);
    this.world.registerDynamic(root);
    return root;
  }
  _removeFigure(root) {
    this.world.unregisterDynamic(root);
    root.removeFromParent();
  }
  _lightsNear(x, z, r) {
    const out = [], i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL), n = Math.ceil(r / CELL);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      const l = this.level.field.get(LightField.texel(i, j));
      if (!l || l.ci !== i || l.cj !== j || l.mode === 'dead') continue;
      if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z) <= r) out.push(l);
    }
    return out;
  }
  _setDead(l, dead) {
    const field = this.level.field;
    if (dead) { l.scareDead = true; l.mode = 'dead'; l._force = true; field.dirty = true; }
    else { l.scareDead = false; this.level._applyDayToLight(l, this.game.day?.day ?? 1); l._force = true; field.dirty = true; }
  }

  // ------------------------------------------------------------------ jumpscares
  _startScare() {
    const kinds = ['lunge', 'vent', 'blackout', 'behind'].sort(() => Math.random() - 0.5);
    for (const k of kinds) {
      const a = this['_' + k]?.();
      if (a) { a.scare = true; this.active.push(a); return true; }
    }
    return false;
  }

  _lunge() {
    const cam = this._cam(), f = this._fwd();
    const s = new THREE.Vector3(-f.z, 0, f.x);
    for (const d of [5.5, 7, 8.5, 4.5]) {
      const px = cam.x + f.x * d, pz = cam.z + f.z * d;
      if (!this._los(cam.x, cam.z, px, pz, 0.35)) continue;
      const ax = px - s.x * 2.4, az = pz - s.z * 2.4, bx = px + s.x * 2.4, bz = pz + s.z * 2.4;
      if (!this._los(ax, az, bx, bz, 0.35)) continue;
      const c = this.level.cell(px, pz);
      if (!c || c.ceil < 2.2 || c.special?.pit) continue;
      if (!this._sees(cam.x, cam.z, px, pz, Math.min(cam.y, 1.3))) continue;
      const fig = this._addFigure(silhouette('run'));
      const dir = Math.random() < 0.5 ? 1 : -1;
      const A = new THREE.Vector3(dir > 0 ? ax : bx, 0, dir > 0 ? az : bz), B = new THREE.Vector3(dir > 0 ? bx : ax, 0, dir > 0 ? bz : az);
      fig.rotation.y = Math.atan2(B.x - A.x, B.z - A.z);
      let t = 0;
      audio.play('scare_whoosh', { pos: new THREE.Vector3(px, 1.2, pz), volume: 1 });
      audio.play('scare_sting', { volume: 0.9 });
      this._hit(0.8);
      return {
        update: (dt) => {
          t += dt;
          const u = Math.min(1, t / 0.42);
          fig.position.lerpVectors(A, B, u);
          fig.position.y = Math.abs(Math.sin(u * Math.PI * 4)) * 0.06;
          fig.updateMatrixWorld(true);
          return u < 1;
        },
        dispose: () => this._removeFigure(fig),
      };
    }
    return null;
  }

  _vent() {
    const cam = this._cam(), f = this._fwd();
    const vents = this.level.critters?.vents || [];
    let best = null, bd = 1e9;
    for (const v of vents) {
      const p = v.pos || v.mouth || v.p;
      if (!p) continue;
      const dx = p.x - cam.x, dz = p.z - cam.z, d = Math.hypot(dx, dz);
      if (d < 1.8 || d > 7.5) continue;
      if ((dx * f.x + dz * f.z) / d < 0.55) continue;
      if (!this._los(cam.x, cam.z, p.x, p.z, 0.3)) continue;
      if (d < bd) { bd = d; best = { p, v }; }
    }
    if (!best) return null;
    const { p, v } = best;
    // vents sit on wall bases facing into the cell: put the face just behind the grille, looking out
    const inside = v.inside || v.into;
    const fc = this._addFigure(face());
    const out = inside ? new THREE.Vector3(p.x - inside.x, 0, p.z - inside.z).normalize() : new THREE.Vector3(cam.x - p.x, 0, cam.z - p.z).normalize();
    fc.position.set(p.x + out.x * 0.03, 0.17, p.z + out.z * 0.03);
    fc.rotation.y = Math.atan2(out.x, out.z);
    fc.scale.setScalar(0.62);
    fc.updateMatrixWorld(true);
    audio.play('scare_sting', { volume: 0.85 });
    audio.play('scare_shriek', { pos: fc.position, volume: 0.45 });
    this._hit(0.7);
    let t = 0;
    return { update: (dt) => { t += dt; return t < 0.75; }, dispose: () => this._removeFigure(fc) };
  }

  _blackout() {
    const cam = this._cam();
    const lights = this._lightsNear(cam.x, cam.z, 13);
    if (lights.length < 3) return null;
    for (const l of lights) this._setDead(l, true);
    audio.play('lights_out', { volume: 1 });
    let t = 0, shrieked = false;
    const back = new THREE.Vector3();
    return {
      update: (dt) => {
        t += dt;
        if (!shrieked && t > 0.7) {
          shrieked = true;
          const f = this._fwd();
          back.set(cam.x - f.x * 5, 1.4, cam.z - f.z * 5);
          audio.play('scare_shriek', { pos: back, volume: 1 });
          audio.play('scare_sting', { volume: 0.7 });
          this._hit(1);
        }
        // the tubes stutter back one by one
        if (t > 2.2) for (const l of lights) if (l.scareDead && Math.random() < dt * 3) this._setDead(l, false);
        if (t > 3.6) { for (const l of lights) if (l.scareDead) this._setDead(l, false); return false; }
        return true;
      },
      dispose: () => { for (const l of lights) if (l.scareDead) this._setDead(l, false); },
    };
  }

  _behind() {
    const l = this.game.local;
    const f = this._fwd(), pos = l.pos;
    const bx = pos.x - f.x * 1.15, bz = pos.z - f.z * 1.15;
    if (!this._los(pos.x, pos.z, bx, bz, 0.9)) return null;
    const c = this.level.cell(bx, bz);
    if (!c || c.special?.pit || c.ceil < 1.6) return null;
    // one of the broken robot clones (a Still Life watcher) stands at arm's length
    const sl = buildStillLife('watcher', 1 + ((Math.random() * 997) | 0));
    const d = this._addFigure(sl.root);
    d.position.set(bx, (this.level.floorY?.(bx, bz) ?? 0), bz);
    let t = 0, seen = -1;
    audio.play('breath_heavy', { pos: new THREE.Vector3(bx, 1.1, bz), volume: 0.35, delay: 1.2 });
    return {
      update: (dt) => {
        t += dt;
        // keep it at arm's length behind, always facing the clone
        const p = l.pos;
        const dx = p.x - d.position.x, dz = p.z - d.position.z, dist = Math.hypot(dx, dz);
        d.rotation.y = Math.atan2(dx, dz);
        sl.update(dt, {});
        d.updateMatrixWorld(true);
        if (seen < 0) {
          const fw = this._fwd();
          const dot = (-dx * fw.x - dz * fw.z) / Math.max(dist, 1e-3);
          if (dot > 0.6 && dist < 4.5) {
            seen = t;
            audio.play('scare_sting', { volume: 1 });
            audio.play('scare_shriek', { pos: d.position.clone().setY(1.2), volume: 0.6 });
            this._hit(1);
          }
          if (dist > 6 || t > 14) return false;
          return true;
        }
        return t - seen < 0.32;
      },
      dispose: () => this._removeFigure(d),
    };
  }

  // ------------------------------------------------------------------ unsettling events
  _startEvent() {
    const kinds = ['phone', 'lights', 'figure', 'facing'].sort(() => Math.random() - 0.5);
    for (const k of kinds) {
      const a = this['_ev_' + k]?.();
      if (a) { this.active.push(a); return true; }
    }
    return false;
  }

  _ev_phone() {
    const cam = this._cam();
    let best = null, bd = 1e9;
    for (const p of this.world.props.props.values()) {
      if (p.type !== 'desk_phone' || p.dead) continue;
      const d = p.root.position.distanceTo(cam);
      if (d < 6 || d > 18) continue;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    let t = 0, next = 0, rings = 0;
    const max = 4 + Math.floor(Math.random() * 4);
    return {
      update: (dt) => {
        t += dt;
        if (best.dead) return false;
        const d = best.root.position.distanceTo(this._cam());
        if (d < 2.3) {
          // close enough to answer: silence, and something breathing on the line
          audio.play('whisper', { pos: best.root.position, volume: 0.4 });
          return false;
        }
        if (t >= next) {
          if (rings >= max) return false;
          rings++; next = t + 3.0;
          audio.play('phone_ring', { pos: best.root.position, volume: 0.9 });
        }
        return true;
      },
    };
  }

  _ev_lights() {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 1.4) return null;
    const cam = this._cam();
    const dx = -this.vel.x / sp, dz = -this.vel.z / sp;
    const seq = [];
    for (let d = 3; d <= 18; d += 3) {
      const x = cam.x + dx * d, z = cam.z + dz * d;
      const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
      const l = this.level.field.get(LightField.texel(i, j));
      if (l && l.ci === i && l.cj === j && l.mode !== 'dead' && !seq.includes(l)) seq.push(l);
    }
    if (seq.length < 3) return null;
    let t = 0, k = 0;
    const hold = rand(9, 14);
    return {
      update: (dt) => {
        t += dt;
        // furthest first, closing in on you
        while (k < seq.length && t > 0.2 + k * 0.6) {
          const l = seq[seq.length - 1 - k];
          this._setDead(l, true);
          audio.play('lights_out', { pos: new THREE.Vector3(l.x, l.y, l.z), volume: 0.45 });
          k++;
        }
        if (t > hold) { for (const l of seq) if (l.scareDead) this._setDead(l, false); return false; }
        return true;
      },
      dispose: () => { for (const l of seq) if (l.scareDead) this._setDead(l, false); },
    };
  }

  _ev_figure() {
    const cam = this._cam(), f = this._fwd();
    // somewhere far down the view (a little off-centre is fine), with a clear line of sight
    for (const da of [0, 0.12, -0.12, 0.24, -0.24]) for (const d of [26, 22, 18, 15, 13]) {
      const ca = Math.cos(da), sa = Math.sin(da), fx = f.x * ca - f.z * sa, fz = f.x * sa + f.z * ca;
      const px = cam.x + fx * d, pz = cam.z + fz * d;
      if (!this._los(cam.x, cam.z, px, pz, 0.25)) continue;
      const c = this.level.cell(px, pz);
      if (!c || c.ceil < 2.2 || c.special || c.landmark || !this.level.isChunkLoaded(px, pz)) continue;
      if (!this._sees(cam.x, cam.z, px, pz, Math.min(cam.y, 1.5))) continue;
      const fig = this._addFigure(silhouette('stand'));
      fig.position.set(px, 0, pz);
      fig.rotation.y = Math.atan2(cam.x - px, cam.z - pz);
      fig.updateMatrixWorld(true);
      let t = 0, away = 0;
      return {
        update: (dt) => {
          t += dt;
          const cp = this._cam(), fw = this._fwd();
          const vx = px - cp.x, vz = pz - cp.z, dist = Math.hypot(vx, vz);
          const dot = (vx * fw.x + vz * fw.z) / Math.max(dist, 1e-3);
          away = dot < 0.55 ? away + dt : 0;
          return !(dist < 10 || away > 0.6 || t > 28);
        },
        dispose: () => this._removeFigure(fig),
      };
    }
    return null;
  }

  _ev_facing() {
    if (!net.isHost) return null;
    const cam = this._cam(), f = this._fwd();
    const turn = [];
    for (const p of this.world.props.props.values()) {
      if (!/^(chair_|armchair|stool|couch)/.test(p.type) || p.dead || p.isHeld() || p.frozen) continue;
      const q = p.root.position, dx = q.x - cam.x, dz = q.z - cam.z, d = Math.hypot(dx, dz);
      if (d < 3 || d > 14) continue;
      if ((dx * f.x + dz * f.z) / d > -0.2) continue; // only what is behind you
      if (Math.abs(q.y - (this.level.floorY?.(q.x, q.z) ?? 0)) > 1.2) continue;
      turn.push(p);
      if (turn.length >= 7) break;
    }
    if (turn.length < 2) return null;
    const qq = new THREE.Quaternion(), e = new THREE.Euler();
    for (const p of turn) {
      const q = p.root.position;
      qq.setFromEuler(e.set(0, Math.atan2(cam.x - q.x, cam.z - q.z), 0));
      this.world.props.teleport(p, q.clone(), qq.clone());
    }
    audio.play('scrape_short', { pos: turn[0].root.position, volume: 0.35 });
    let t = 0;
    return { update: (dt) => { t += dt; return t < 1; } };
  }

  dispose() {
    for (const a of this.active) a.dispose?.();
    this.active.length = 0;
  }
}
