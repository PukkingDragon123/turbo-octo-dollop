// Reality anomalies that scale with the 7-day clock.
// Host: furniture that moves when nobody is watching, furniture sinking into the carpet,
//       day-7 shifting corridors (unseen chunks regenerate), light failures.
// Local: sanity hallucinations (whispers, fake footsteps, shadow figures, fake warnings),
//        the endless hallway, day-change announcements.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { net } from '../net/net.js';
import { audio } from '../audio/audio.js';
import { RNG } from '../core/rng.js';
import { CELL, CHUNK, CHUNK_M, HEIGHT } from '../world/levels/yellow/layout.js';

const _v = new THREE.Vector3();

export class Anomalies {
  constructor(level) {
    this.level = level;
    this.world = level.world;
    this.game = level.game;
    this.rng = new RNG(level.seed ^ 0x51f7);
    this.moveT = 20;
    this.sinkT = 40;
    this.shiftT = 45;
    this.halluT = 15;
    this.shadow = null;
    this.endless = { loops: 0, cool: 0 };
    this.sinking = new Set();
    this.variantCounter = 1;
    net.onClient('shift', (d) => this.level.shiftChunk(d.cx, d.cz, d.v));
  }

  observed(pos, dotMin = 0.55) {
    const mons = this.level.monsters;
    return mons.alivePlayers().some((p) => mons.isWatchedBy(p, pos, dotMin));
  }

  update(dt) {
    const day = this.game.day.day;
    const inst = this.game.day.instability();
    if (net.isHost) {
      // --- moving furniture (day 2+) ---
      this.moveT -= dt * (0.4 + inst * 2.4);
      if (this.moveT <= 0 && day >= 2) {
        this.moveT = 8 + this.rng.range(0, 10);
        this._moveSomething(inst);
      }
      // --- sinking furniture (day 2+) ---
      this.sinkT -= dt * (0.3 + inst * 2);
      if (this.sinkT <= 0 && day >= 2) {
        this.sinkT = 25 + this.rng.range(0, 25);
        this._sinkSomething();
      }
      this._updateSinking(dt);
      // --- day 7: shifting corridors ---
      if (day >= 7) {
        this.shiftT -= dt;
        if (this.shiftT <= 0) {
          this.shiftT = 25 + this.rng.range(0, 25);
          this._shiftChunk();
        }
      }
    }
    this._updateLocal(dt);
  }

  _moveSomething(inst) {
    const players = this.level.monsters.alivePlayers();
    if (!players.length) return;
    const base = players[this.rng.int(0, players.length - 1)].pos;
    const cands = [];
    this.world.props.query(base, 18, (p) => {
      if (p.isHeld() || p.frozen || !p.body || p.mass < 1 || p.def.mission || p.def.device) return;
      const d = p.root.position.distanceTo(base);
      if (d < 5) return;
      if (this.observed(p.root.position)) return;
      cands.push(p);
    });
    if (!cands.length) return;
    const p = cands[this.rng.int(0, cands.length - 1)];
    // a little relocation + turn, or a slow push toward the player
    if (this.rng.chance(0.5)) {
      const q = p.root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng.range(-1.5, 1.5)));
      const off = new THREE.Vector3(this.rng.range(-1, 1), 0, this.rng.range(-1, 1)).multiplyScalar(0.6 + inst);
      const np = p.root.position.clone().add(off);
      // keep inside the same cell to avoid walls
      const ci = Math.floor(p.root.position.x / CELL), cj = Math.floor(p.root.position.z / CELL);
      np.x = THREE.MathUtils.clamp(np.x, ci * CELL + 0.5, (ci + 1) * CELL - 0.5);
      np.z = THREE.MathUtils.clamp(np.z, cj * CELL + 0.5, (cj + 1) * CELL - 0.5);
      this.world.props.teleport(p, np, q);
    } else {
      _v.subVectors(base, p.root.position).setY(0).normalize().multiplyScalar(p.mass * 2.2);
      p.body.applyImpulse(_v, true);
    }
  }

  _sinkSomething() {
    const players = this.level.monsters.alivePlayers();
    if (!players.length) return;
    const base = players[this.rng.int(0, players.length - 1)].pos;
    const cands = [];
    this.world.props.query(base, 14, (p) => {
      if (p.isHeld() || p.frozen || !p.body || p.def.mission || p.def.device || p.def.pocket) return;
      if (p.root.position.distanceTo(base) < 3) return;
      cands.push(p);
    });
    if (!cands.length) return;
    const p = cands[this.rng.int(0, cands.length - 1)];
    this.world.props.setFrozen(p, true);
    p.sinking = { rate: this.rng.range(0.008, 0.02) };
    this.sinking.add(p.id);
  }

  _updateSinking(dt) {
    for (const p of this.world.props.props.values()) {
      if (!p.sinking) continue;
      if (p.isHeld()) {
        // grabbing it pulls it back out
        p.sinking = null;
        this.world.props.setFrozen(p, false);
        continue;
      }
      p.root.position.y -= p.sinking.rate * dt;
      p.root.rotation.x += p.sinking.rate * dt * 0.3;
      p.root.updateMatrix();
      this.world.props.forceSendIds.add(p.id);
      if (p.root.position.y < -1.2) {
        this.world.props.despawn(p.id);
        this.sinking.delete(p.id);
      }
    }
  }

  _shiftChunk() {
    // pick a loaded chunk nobody is in or looking at
    const players = this.level.monsters.alivePlayers();
    const keys = [...this.level.chunks.keys()];
    this.rng.shuffle(keys);
    for (const k of keys) {
      const [cx, cz] = k.split(',').map(Number);
      if (cx === 0 && cz === 0) continue;
      if (this.level.missionChunks.some((m) => m.cx === cx && m.cz === cz)) continue;
      const center = new THREE.Vector3((cx + 0.5) * CHUNK_M, 1.4, (cz + 0.5) * CHUNK_M);
      if (players.some((p) => Math.abs(p.pos.x - center.x) < CHUNK_M * 0.9 && Math.abs(p.pos.z - center.z) < CHUNK_M * 0.9)) continue;
      const v = (this.level.variants.get(k) || 0) + 1;
      net.toAll('shift', { cx, cz, v });
      // props in the chunk get nudged to their cell centres
      this.world.props.query(center, CHUNK_M * 0.75, (p) => {
        if (p.isHeld() || p.def.mission) return;
        const ci = Math.floor(p.root.position.x / CELL), cj = Math.floor(p.root.position.z / CELL);
        this.world.props.teleport(p, new THREE.Vector3((ci + 0.5) * CELL, p.root.position.y + 0.1, (cj + 0.5) * CELL));
      });
      return;
    }
  }

  // ---------------- local (non-networked) effects ----------------
  _updateLocal(dt) {
    const l = this.game.local;
    if (l.dead) return;
    const s = l.survival;
    const insanity = 1 - s.sanity / 100;
    // hallucinations
    this.halluT -= dt * (0.2 + insanity * 2.5);
    if (this.halluT <= 0) {
      this.halluT = 10 + Math.random() * 14;
      if (s.sanity < 55 && this.game.day.day > 1) this._hallucinate(insanity);
    }
    if (this.shadow) {
      this.shadow.t += dt;
      const cam = engine.camera;
      const toS = _v.subVectors(this.shadow.mesh.position, cam.position);
      const d = toS.length();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      if ((fwd.dot(toS.normalize()) > 0.88 && this.shadow.t > 0.4) || this.shadow.t > 6 || d < 3) {
        this.shadow.mesh.removeFromParent();
        this.shadow = null;
      }
    }
    // endless hallway (local teleport during a light blink)
    this._endlessHall(dt);
    // red chair: always faces you when you look away
    // sanity post effect
    engine.post.params.uSanity.value = Math.max(0, s.sanity / 100);
  }

  _hallucinate(insanity) {
    const l = this.game.local;
    const r = Math.random();
    const cam = engine.camera;
    const behind = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion).multiplyScalar(4 + Math.random() * 6).add(cam.position);
    if (r < 0.3) audio.play('whisper', { pos: behind, volume: 0.5 + insanity * 0.4 });
    else if (r < 0.55) audio.play('fake_footsteps', { pos: behind, volume: 0.7 });
    else if (r < 0.7) {
      audio.play(Math.random() < 0.5 ? 'bacteria_click' : 'stilllife_giggle', { pos: behind, volume: 0.5 });
    } else if (r < 0.88 && !this.shadow) {
      // a dark silhouette at the edge of vision that vanishes when looked at
      const side = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * 0.9, 0, -0.6).applyQuaternion(cam.quaternion).setY(0).normalize();
      const pos = l.pos.clone().addScaledVector(side, 7 + Math.random() * 5);
      if (this.world.physics.lineOfSight(cam.position, pos.clone().setY(1.4))) {
        const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.6, 4, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 }));
        mesh.position.copy(pos).setY(1.1);
        this.world.group.add(mesh);
        this.shadow = { mesh, t: 0 };
      }
    } else {
      this.game.healthity?.say('fake');
    }
  }

  _endlessHall(dt) {
    const l = this.game.local;
    const e = this.endless;
    e.cool -= dt;
    const c = this.level.cell(l.pos.x, l.pos.z);
    const room = c?.special;
    if (!room || room.kind !== 'endless_hall') { if (!room) e.loops = 0; return; }
    if (e.cool > 0 || e.loops >= 3) return;
    // corridor spans cells rx..rx+5 along x of its chunk
    const ox = (Math.floor(l.pos.x / CHUNK_M) * CHUNK + room.rx) * CELL;
    const local = l.pos.x - ox;
    const len = room.w * CELL;
    const vx = l.vel.x;
    let jump = 0;
    if (vx > 0.5 && local > len - CELL * 1.3) jump = -CELL * 2;
    else if (vx < -0.5 && local < CELL * 1.3) jump = CELL * 2;
    if (!jump) return;
    e.loops++;
    e.cool = 1.5;
    // blink the lights and slip the clone back two cells
    engine.post.params.uFade.value = 0.92;
    setTimeout(() => { engine.post.params.uFade.value = 0; }, 140);
    audio.play('teleport_whoosh', { volume: 0.25 });
    const keepVel = l.vel.clone();
    l.teleport(new THREE.Vector3(l.pos.x + jump, l.pos.y, l.pos.z));
    l.vel.copy(keepVel);
    if (e.loops === 3) this.game.ui.toast('The hallway lets you go.', 'info');
  }

  dispose() {
    this.shadow?.mesh.removeFromParent();
    net.clientHandlers.delete('shift');
  }
}

export { HEIGHT };
