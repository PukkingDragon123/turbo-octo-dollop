// A teammate seen through the network: interpolated avatar, flashlight, collision capsule.
import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { Avatar } from '../entities/avatar.js';
import { buildModel } from '../entities/catalog.js';
import { audio } from '../audio/audio.js';
import { net } from '../net/net.js';

const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class RemotePlayer {
  constructor(game, info) {
    this.game = game;
    this.id = info.id;
    this.name = info.name || 'Clone';
    this.cosmetics = info.cosmetics || {};
    this.avatar = new Avatar(this.cosmetics);
    this.pos = new THREE.Vector3(0, -100, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.buffer = [];
    this.pose = null;
    this.dead = !!info.dead;
    this.inWorld = false;
    this.world = null;
    this.collider = null;
    this.time = 0;
    this.stepDist = 0;
    this.heldType = null;
    this.heldModel = null;
    // the flashlight lives in the world group (not the avatar, which hides while out of the world) so the
    // scene's light count only changes when a teammate's world attaches
    this.flash = new THREE.SpotLight(0xfff1dc, 0, 22, 0.55, 0.6, 1.6);
    this.flash.castShadow = false;
    this.flashTarget = new THREE.Object3D();
    this.flash.target = this.flashTarget;
    this.voiceLevel = 0;
    this.hs = { h: 100 };
  }

  attachWorld(world) {
    this.detachWorld();
    this.world = world;
    world.group.add(this.avatar.root, this.flash, this.flashTarget);
    world.registerDynamic(this.avatar.root);
    const desc = RAPIER.ColliderDesc.capsule(0.38, 0.3).setCollisionGroups(GROUPS.remote).setTranslation(this.pos.x, this.pos.y + 0.68, this.pos.z);
    this.collider = world.physics.world.createCollider(desc);
    world.physics.setUserData(this.collider, { kind: 'remote', remote: this });
    this.buffer.length = 0;
  }

  detachWorld() {
    if (!this.world) return;
    try { this.world.physics.removeCollider(this.collider); } catch (e) { /* freed */ }
    this.world.unregisterDynamic(this.avatar.root);
    this.avatar.root.removeFromParent();
    this.flash.removeFromParent();
    this.flashTarget.removeFromParent();
    this.flash.intensity = 0;
    this.collider = null;
    this.world = null;
    this.inWorld = false;
  }

  setCosmetics(c) {
    this.cosmetics = c;
    this.avatar.setCosmetics(c);
  }

  pushPose(p, t) {
    // first pose (or a teleport): snap instead of interpolating from far away
    if (!this.pose || Math.hypot(p.p[0] - this.pos.x, p.p[1] - this.pos.y, p.p[2] - this.pos.z) > 8) {
      this.buffer.length = 0;
      this.pos.fromArray(p.p);
    }
    this.buffer.push({ t, p });
    if (this.buffer.length > 10) this.buffer.shift();
    this.pose = p;
    this.dead = !!p.d;
    if (p.hs) this.hs = p.hs;
  }

  update(dt) {
    this.time = this.game.time; // same clock as pushPose timestamps
    if (!this.world || !this.pose) return;
    const rt = this.time - 0.12;
    const buf = this.buffer;
    let a = null, b = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= rt) { a = buf[i]; b = buf[i + 1] || null; break; }
    }
    if (!a) a = buf[0];
    if (!a) return;
    const pa = a.p;
    const prev = this.pos.clone();
    if (b) {
      const k = THREE.MathUtils.clamp((rt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
      const pb = b.p;
      this.pos.set(pa.p[0] + (pb.p[0] - pa.p[0]) * k, pa.p[1] + (pb.p[1] - pa.p[1]) * k, pa.p[2] + (pb.p[2] - pa.p[2]) * k);
      let dy = pb.y - pa.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw = pa.y + dy * k;
      this.pitch = pa.pi + (pb.pi - pa.pi) * k;
    } else {
      this.pos.lerp(_v.fromArray(pa.p), 0.3);
      this.yaw = pa.y;
      this.pitch = pa.pi;
    }
    // teleports (level change / respawn): snap
    if (prev.distanceTo(this.pos) > 6) { /* snapped */ }
    while (buf.length > 3 && buf[1].t < rt) buf.shift();
    this.inWorld = this.pos.y > -50;
    const p = this.pose;
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.root.visible = this.inWorld;
    this.vel.fromArray(p.v);
    const lv = _v.set(this.vel.x, 0, this.vel.z).applyAxisAngle(UP, -this.yaw);
    const sp = Math.hypot(lv.x, lv.z);
    this.avatar.update(dt, {
      speed: sp, moveDir: new THREE.Vector2(sp > 0.05 ? lv.x / sp : 0, sp > 0.05 ? -lv.z / sp : 0),
      grounded: !!p.g, vy: this.vel.y, crouch: p.c || 0, sprint: !!p.sp, pitch: this.pitch,
      talking: Math.max(p.tk || 0, this.voiceLevel), holding: p.h ? 1 : 0,
      holdTarget: p.ht ? new THREE.Vector3().fromArray(p.ht) : null,
      emote: p.em || null, expression: p.ex || 'neutral', limp: !!p.lp, dead: !!p.d,
    });
    if (this.collider) {
      this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + 0.68 - (p.c || 0) * 0.26, z: this.pos.z });
      this.collider.setEnabled(!p.d && this.inWorld);
    }
    // flashlight
    this.flash.intensity = p.fl && !p.d && this.inWorld ? 26 : 0; // never hidden: keeps the light count stable
    const root = this.avatar.root;
    root.updateMatrix();
    this.flash.position.set(0.15, 1.0, -0.2).applyMatrix4(root.matrix);
    this.flashTarget.position.set(0, 1.0 + Math.sin(this.pitch) * 5, -5 * Math.cos(this.pitch)).applyMatrix4(root.matrix);
    // held item
    if (p.it !== this.heldType) {
      if (this.heldModel) this.heldModel.removeFromParent();
      this.heldModel = null;
      this.heldType = p.it;
      if (p.it) {
        const m = buildModel(p.it, { seed: 1 });
        this.heldModel = m.object;
        const anchor = this.avatar.getHandAnchor('right');
        if (anchor) {
          if (m.hold) { m.object.position.fromArray(m.hold.pos); m.object.rotation.set(...m.hold.rot); }
          anchor.add(m.object);
        }
      }
    }
    // talking is noise for the host's monsters
    if (net.isHost && (p.tk || 0) > 0.3 && !p.d) {
      this.talkNoiseT = (this.talkNoiseT || 0) - dt;
      if (this.talkNoiseT <= 0) { this.talkNoiseT = 0.5; this.world.noise.emit(this.pos, 4 + p.tk * 10, 'voice', this.id); }
    }
    // footsteps
    if (p.g && sp > 0.5 && !p.d) {
      this.stepDist += sp * dt;
      const stride = p.sp ? 1.25 : 0.85;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const lvl = this.world.level;
        const surf = (lvl?.waterDepth?.(this.pos.x, this.pos.z) ?? 0) > 0.05 ? 'water' : lvl?.surfaceAt?.(this.pos.x, this.pos.z) || 'carpet';
        audio.play('step_' + surf, { pos: this.pos, intensity: p.sp ? 1 : 0.5, volume: p.sp ? 0.8 : 0.5 });
        // the host's monsters hear teammates' footsteps too
        if (net.isHost) this.world.noise.emit(this.pos, (p.c || 0) > 0.5 ? 2 : p.sp ? 13 : 6, 'step', this.id);
      }
    }
  }

  dispose() {
    this.detachWorld();
    this.avatar.dispose?.();
  }
}
