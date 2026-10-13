// The local clone: first-person controller, camera feel, physics grabbing, interaction,
// inventory & item use, flashlight, sleeping, death & spectating, pose replication.
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { RAPIER, GROUPS, G, groups, Q } from '../physics/physics.js';
import { audio } from '../audio/audio.js';
import { Survival } from './survival.js';
import { Inventory } from './inventory.js';
import { itemDef, itemName } from './itemdefs.js';
import { buildModel } from '../entities/catalog.js';
import { applyItemVisual } from './itemfx.js';
import { Avatar, buildFirstPersonArms, DEFAULT_COSMETICS } from '../entities/avatar.js';
import { clamp, damp } from '../core/rng.js';
import { profile } from '../core/profile.js';

const STAND_HH = 0.38, CROUCH_HH = 0.12, RADIUS = 0.3;
const EYE_STAND = 1.16, EYE_CROUCH = 0.72;
const WALK = 2.9, SPRINT = 5.1, CROUCH_SPEED = 1.45;
const GRAVITY = 15.5, JUMP_V = 4.9;
const REACH = 2.7, GRAB_REACH = 3.4;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export class LocalPlayer {
  constructor(game) {
    this.game = game;
    this.name = 'Clone';
    this.cosmetics = { ...DEFAULT_COSMETICS };
    this.survival = new Survival();
    this.inv = new Inventory();
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = true;
    this.crouch = 0;
    this.crouching = false;
    this.sprinting = false;
    this.moving = false;
    this.airTime = 0;
    this.fallSpeed = 0;
    this.stepPhase = 0;
    this.stepDist = 0;
    this.bob = 0;
    this.landKick = 0;
    this.shake = 0;
    this.fovKick = 0;
    this.dead = false;
    this.thirdPerson = false;
    this.world = null;
    this.collider = null;
    this.controller = null;
    this.grab = null; // {id, lp:Vector3, dist, sendT}
    this.useAction = null; // {type, t, dur, slot}
    this.holdAction = null; // hold-RMB tool actions
    this.holdE = null;
    this.focus = null; // current interaction focus {kind, target, prompt}
    this.flashOn = false;
    this.talking = 0;
    this.emote = null;
    this.emoteT = 0;
    this.expression = 'neutral';
    this.sleepT = 0;
    this.watchRaised = 0;
    this.watchOpen = false;
    this.spectateIdx = 0;
    this.spectateYaw = 0;
    this.spectatePitch = -0.3;
    this.poseTimer = 0;
    this.terminal = null; // active terminal UI (locks movement)
    this.arrivalGrace = 0;
    this.yank = new THREE.Vector3();
    this.stats = { steps: 0, jumps: 0, thrown: 0, eaten: 0, drank: 0, photos: 0 };
    this.waterDepth = 0;
    this.lightLevel = 1;
    this.sanityFx = 0;

    // visuals
    this.avatar = new Avatar(this.cosmetics, { firstPersonHidden: true });
    this.avatar.root.visible = false;
    this.arms = buildFirstPersonArms(this.cosmetics);
    engine.vmScene.add(this.arms.root);
    this.heldModel = null;
    this.heldType = null;

    // viewmodel lighting follows the local light level
    this.vmHemi = new THREE.HemisphereLight(0xfff2d0, 0x3a3020, 0.6);
    this.vmDir = new THREE.DirectionalLight(0xfff0d8, 0.5);
    this.vmDir.position.set(0.5, 1, 0.3);
    this.vmFlash = new THREE.PointLight(0xfff4e0, 0, 2.5, 2);
    this.vmFlash.position.set(0.2, -0.1, -0.3);
    engine.vmScene.add(this.vmHemi, this.vmDir, this.vmFlash);

    // flashlight (world)
    this.flashlight = new THREE.SpotLight(0xfff1dc, 0, 28, 0.52, 0.55, 1.6);
    this.flashlight.castShadow = engine.quality.shadows;
    this.flashlight.shadow.mapSize.set(engine.quality.shadowSize, engine.quality.shadowSize);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 28;
    this.flashlight.shadow.bias = -0.0006;
    this.flashlight.shadow.normalBias = 0.02;
    this.flashlight.position.set(0.18, -0.15, 0.05);
    this.flashTarget = new THREE.Object3D();
    this.flashTarget.position.set(0.1, -0.2, -6);
    engine.camera.add(this.flashlight, this.flashTarget);
    this.flashlight.target = this.flashTarget;
    this.flashFlicker = 0;

    // grab beam
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.beamGlow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beamGlow.visible = false;
    engine.scene.add(this.beam, this.beamGlow);
  }

  get id() { return net.selfId; }
  get alive() { return !this.dead; }

  setCosmetics(c) {
    this.cosmetics = { ...this.cosmetics, ...c };
    this.avatar.setCosmetics(this.cosmetics);
    engine.vmScene.remove(this.arms.root);
    const oldHeld = this.heldType;
    this.arms = buildFirstPersonArms(this.cosmetics);
    engine.vmScene.add(this.arms.root);
    this.heldType = null;
    if (oldHeld) this._refreshHeld(true);
    this.game.watch?.attach(this.arms);
  }

  // ---------------- world attachment ----------------
  attachWorld(world, spawn) {
    this.detachWorld();
    this.world = world;
    const phys = world.physics;
    const desc = RAPIER.ColliderDesc.capsule(STAND_HH, RADIUS)
      .setCollisionGroups(GROUPS.player)
      .setTranslation(spawn.pos.x, spawn.pos.y + STAND_HH + RADIUS, spawn.pos.z);
    this.collider = phys.world.createCollider(desc);
    phys.setUserData(this.collider, { kind: 'player', player: this, local: true });
    this.controller = phys.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.32, 0.18, false);
    this.controller.enableSnapToGround(0.25);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(net.isHost);
    this.controller.setCharacterMass(55);
    this.pos.copy(spawn.pos);
    this.vel.set(0, spawn.vy || 0, 0);
    this.yaw = spawn.yaw || 0;
    this.pitch = 0;
    this.grab = null;
    this.arrivalGrace = spawn.arrival ? 3 : 0.5;
    world.group.add(this.avatar.root);
    world.registerDynamic(this.avatar.root);
    this.avatar.root.visible = this.thirdPerson;
  }

  detachWorld() {
    if (!this.world) return;
    this.releaseGrab(false);
    try {
      if (this.controller) this.world.physics.world.removeCharacterController(this.controller);
      if (this.collider) this.world.physics.removeCollider(this.collider);
    } catch (e) { /* world freed */ }
    this.world.unregisterDynamic(this.avatar.root);
    this.avatar.root.removeFromParent();
    this.collider = null;
    this.controller = null;
    this.world = null;
  }

  teleport(pos, yaw = null) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    if (yaw !== null) this.yaw = yaw;
    if (this.collider) this.collider.setTranslation({ x: pos.x, y: pos.y + this._hh() + RADIUS, z: pos.z });
  }

  _hh() { return STAND_HH + (CROUCH_HH - STAND_HH) * this.crouch; }

  // ---------------- main update ----------------
  update(dt) {
    if (!this.world) return;
    const ui = this.game.ui;
    const s = this.survival;
    if (this.dead) {
      this._updateSpectate(dt);
      this._updateViewmodel(dt);
      this._sendPose(dt);
      return;
    }
    const canControl = !this.terminal && !ui.menuOpen && !this.game.cutscene && !ui.customizing;
    input.enabled = true;

    // look
    if (canControl && input.locked) {
      const lk = input.look();
      const rotating = this.grab && input.down('rotate');
      if (!rotating && !s.sleeping) {
        this.yaw -= lk.x;
        this.pitch = clamp(this.pitch - lk.y, -1.52, 1.52);
      } else if (rotating) {
        this._rotDelta = [lk.x * 3, lk.y * 3];
      }
      this.lookDelta = lk;
    } else this.lookDelta = { x: 0, y: 0 };

    // watch toggle
    if (canControl && input.hit('watch')) {
      this.watchOpen = !this.watchOpen;
      audio.play(this.watchOpen ? 'watch_beep' : 'ui_back', { volume: 0.5, bus: 'ui' });
    }
    this.watchRaised = damp(this.watchRaised, this.watchOpen ? 1 : 0, 10, dt);

    // sleeping
    if (s.sleeping) {
      this.sleepT += dt;
      if ((canControl && (input.hit('jump') || input.hit('interact') || input.mouseHit(0))) || s.rest >= 100 || s.stress > 0.5) this.wake();
    }

    this._updateMovement(dt, canControl && !s.sleeping);
    this._updateCamera(dt);
    if (canControl && !s.sleeping) {
      this._updateInteraction(dt);
      this._updateGrab(dt);
      this._updateItems(dt);
      this._updateEmotes(dt);
    } else {
      if (this.grab && !this.terminal) this.releaseGrab(false);
      this.focus = null;
    }
    this._updateFlashlight(dt);
    this._updateViewmodel(dt);
    this._updateAvatar(dt);
    this._sendPose(dt);
  }

  // ---------------- movement ----------------
  _updateMovement(dt, canControl) {
    const s = this.survival;
    const level = this.world.level;
    let ix = 0, iz = 0;
    if (canControl) {
      if (input.down('forward')) iz -= 1;
      if (input.down('back')) iz += 1;
      if (input.down('left')) ix -= 1;
      if (input.down('right')) ix += 1;
    }
    const wantCrouch = canControl && input.down('crouch');
    // un-crouch only if there is headroom
    if (!wantCrouch && this.crouching) {
      const head = this.world.physics.raycast(_v.set(this.pos.x, this.pos.y + 0.8, this.pos.z), _v2.set(0, 1, 0), 0.65, Q.solid, null, (c) => c !== this.collider && !this._isGrabbedCollider(c));
      if (!head) this.crouching = false;
    } else this.crouching = wantCrouch;
    this.crouch = damp(this.crouch, this.crouching ? 1 : 0, 12, dt);
    if (this.collider) this.collider.setHalfHeight(this._hh());

    const len = Math.hypot(ix, iz);
    if (len > 0) { ix /= len; iz /= len; }
    this.moving = len > 0;
    const canSprint = !s.fracture && s.stamina > 1 && !this.crouching && iz < 0.2;
    this.sprinting = canControl && input.down('sprint') && this.moving && canSprint && (this.sprinting || s.stamina > 6);
    let speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;
    if (s.fracture) speed *= 0.62;
    if (s.rest < 15) speed *= 0.85;
    if (s.blood < 3000) speed *= 0.85;
    this.waterDepth = level?.waterDepth?.(this.pos.x, this.pos.z) ?? 0;
    if (this.waterDepth > 0.05) speed *= 0.78;
    // carrying heavy things slows you down
    if (this.grab) {
      const p = this.world.props.get(this.grab.id);
      if (p) speed *= clamp(1.15 - p.mass / 70, 0.45, 1);
    }
    if (this.watchOpen) speed *= 0.75;

    // wish direction in world
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = _v.set(0, 0, 0).addScaledVector(_fwd, -iz).addScaledVector(_right, ix).multiplyScalar(speed);
    const accel = this.grounded ? (this.moving ? 16 : 13) : 2.5;
    this.vel.x = damp(this.vel.x, wish.x, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z, accel, dt);
    // knockback / yank from others
    if (this.yank.lengthSq() > 0.0001) {
      this.vel.add(this.yank);
      this.yank.set(0, 0, 0);
    }

    // jump
    if (this.grounded) {
      this.airTime = 0;
      if (canControl && input.hit('jump') && !s.fracture && s.stamina > 3 && !this.crouching) {
        this.vel.y = JUMP_V;
        this.grounded = false;
        s.stamina -= 4;
        this.stats.jumps++;
        audio.play('jump', { volume: 0.5 });
        this.world.noise.emit(this.pos, 5, 'jump');
      }
    } else this.airTime += dt;

    // character controller in fixed 60 Hz substeps (Rapier's KCC is unstable with big steps
    // and purely vertical motion, so a tiny horizontal epsilon is always added)
    const hh = this._hh();
    const filter = groups(G.PLAYER, G.STATIC | G.PROP | G.MONSTER | G.REMOTE);
    const pred = (c) => !this._isGrabbedCollider(c);
    const wasGrounded = this.grounded;
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 60) - 0.01)));
    const sdt = dt / steps;
    let preLandVy = this.vel.y;
    let mvx = 0, mvz = 0;
    for (let k = 0; k < steps; k++) {
      this.vel.y = Math.max(-30, this.vel.y - GRAVITY * sdt);
      preLandVy = this.vel.y;
      const desired = { x: this.vel.x * sdt + 1e-4, y: this.vel.y * sdt, z: this.vel.z * sdt + 7e-5 };
      this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + hh + RADIUS, z: this.pos.z });
      this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter, pred);
      const mv = this.controller.computedMovement();
      this.grounded = this.controller.computedGrounded();
      if (this.vel.y > 0 && mv.y < desired.y * 0.5) this.vel.y = 0; // bonk
      this.pos.x += mv.x; this.pos.y += mv.y; this.pos.z += mv.z;
      mvx += mv.x; mvz += mv.z;
      if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    }
    // ground correction: never let the feet sink into the floor
    const gr = this.world.physics.raycast(_v.set(this.pos.x, this.pos.y + 0.45, this.pos.z), _v2.set(0, -1, 0), 0.5, Q.solid, null, (c) => c !== this.collider && !this._isGrabbedCollider(c));
    if (gr && gr.normal.y > 0.7 && gr.point.y > this.pos.y + 0.002 && gr.point.y - this.pos.y < 0.35) {
      this.pos.y = gr.point.y + 0.001;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    }
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + hh + RADIUS, z: this.pos.z });
    // real horizontal velocity (for animation)
    this.realSpeed = Math.hypot(mvx, mvz) / Math.max(dt, 1e-4);
    this.fallSpeed = Math.min(this.fallSpeed, preLandVy);

    // landing
    if (!wasGrounded && this.grounded) {
      const impact = -this.fallSpeed;
      this.fallSpeed = 0;
      this.landKick = Math.min(1, impact / 9);
      if (impact > 3) {
        audio.play('land', { intensity: Math.min(1, impact / 10), volume: 0.6 });
        this.world.noise.emit(this.pos, 4 + impact, 'land');
        if (this.waterDepth > 0.05) this.world.fxAll?.({ k: 'splash', p: [this.pos.x, 0.12, this.pos.z], n: 20 });
      }
      if (impact > 8.5 && this.arrivalGrace <= 0) {
        const dmg = (impact - 8.5) * 14;
        const died = s.damage(dmg, 'fall', { fracture: impact > 10.5, cause: 'a fall' });
        this.shake = 1;
        audio.play('hurt', { volume: 0.8 });
        if (died) this.onDeath('fall');
      }
    }
    if (this.grounded) this.fallSpeed = 0;
    if (this.arrivalGrace > 0 && this.grounded) this.arrivalGrace -= dt;
    // safety: fell out of the world
    if (this.pos.y < -15) {
      const sp = this.world.level?.spawnPoint?.(0, true);
      if (sp) this.teleport(sp.pos, sp.yaw);
    }

    // footsteps
    if (this.grounded && this.realSpeed > 0.4) {
      this.stepDist += this.realSpeed * dt;
      this.stepPhase += this.realSpeed * dt * (this.sprinting ? 1.6 : 1.9);
      const stride = this.sprinting ? 1.25 : this.crouching ? 0.6 : 0.85;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.stats.steps++;
        const surf = this.waterDepth > 0.05 ? 'water' : level?.surfaceAt?.(this.pos.x, this.pos.z) || 'carpet';
        const loud = this.crouching ? 0.25 : this.sprinting ? 1 : 0.55;
        audio.play('step_' + surf, { intensity: loud, volume: 0.35 + loud * 0.4 });
        this.world.noise.emit(this.pos, this.crouching ? 2 : this.sprinting ? 13 : 6, 'step');
        if (surf === 'water' && Math.random() < 0.5) this.world.fx.splash(_v2.set(this.pos.x, 0.11, this.pos.z), 5, 0.1);
      }
    }
  }

  _isGrabbedCollider(c) {
    if (!this.grab) return false;
    const ud = this.world.physics.getUserData(c);
    return ud && ud.kind === 'prop' && ud.prop.id === this.grab.id;
  }

  // ---------------- camera ----------------
  _updateCamera(dt) {
    const cam = engine.camera;
    const s = this.survival;
    const eye = EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouch;
    const moveAmt = this.grounded ? clamp(this.realSpeed / SPRINT, 0, 1) : 0;
    this.bob = damp(this.bob, moveAmt, 8, dt);
    const bobY = Math.abs(Math.sin(this.stepPhase * Math.PI)) * 0.045 * this.bob;
    const bobX = Math.sin(this.stepPhase * Math.PI) * 0.03 * this.bob;
    this.landKick = damp(this.landKick, 0, 6, dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * 0.04 + s.pain * 0.004;
    let sleepDrop = 0;
    if (s.sleeping) sleepDrop = Math.min(1, this.sleepT * 1.5) * 0.7;
    cam.position.set(
      this.pos.x + _right.x * bobX + (Math.random() - 0.5) * sh,
      this.pos.y + eye + bobY - this.landKick * 0.12 - sleepDrop + (Math.random() - 0.5) * sh,
      this.pos.z + _right.z * bobX + (Math.random() - 0.5) * sh,
    );
    // sanity sway + strafe roll
    const t = engine.time;
    const insane = 1 - s.sanity / 100;
    const sway = insane * insane * 0.06;
    const strafe = (this.vel.x * _right.x + this.vel.z * _right.z) / SPRINT;
    this.roll = damp(this.roll || 0, -strafe * 0.025 + Math.sin(t * 0.7) * sway, 6, dt);
    _e.set(this.pitch + Math.sin(t * 0.53) * sway * 0.5, this.yaw, this.roll + (s.sleeping ? sleepDrop * 0.9 : 0));
    cam.quaternion.setFromEuler(_e);
    const fovTarget = 72 + (this.sprinting ? 7 : 0) + (this.watchOpen && this.game.watch?.tab === 'camera' ? -22 : 0);
    cam.fov = damp(cam.fov, fovTarget, 6, dt);
    cam.updateProjectionMatrix();

    if (this.thirdPerson) {
      _v.set(0, 0, 1).applyQuaternion(cam.quaternion);
      const back = this.world.physics.raycast(cam.position, _v, 2.6, Q.world);
      const d = back ? Math.max(0.3, back.dist - 0.2) : 2.6;
      cam.position.addScaledVector(_v, d);
    }
    audio.setListener(cam.position, cam.quaternion);
  }

  // ---------------- interaction ----------------
  _updateInteraction(dt) {
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const origin = cam.position;
    const hit = this.world.physics.raycast(origin, _fwd, REACH, Q.all & ~groups(0, G.PLAYER), null, (c) => c !== this.collider && !this._isGrabbedCollider(c));
    let focus = null;
    if (hit && hit.ud) {
      const ud = hit.ud;
      if (ud.kind === 'device' && ud.device) {
        const pr = ud.device.prompt(this, hit);
        if (pr) focus = { kind: 'device', target: ud.device, prompt: pr, hit };
      } else if (ud.kind === 'prop' && ud.prop && !ud.prop.dead) {
        const p = ud.prop;
        let pr = p.custom?.prompt?.(this, hit) ?? null;
        if (!pr && p.def.pocket && (!p.frozen || p.type === 'dart')) pr = `[${input.keyName('interact')}] Pick up ${itemName(p.type)}`;
        if (!pr && p.def.sleep) pr = this.survival.insomnia ? 'Can\'t sleep... something is watching' : `[${input.keyName('interact')}] Sleep`;
        if (!pr && p.def.use === 'drink' && !p.def.pocket) pr = `[${input.keyName('interact')}] Drink from ${itemName(p.type)}`;
        if (pr) focus = { kind: 'prop', target: p, prompt: pr, hit };
        else focus = { kind: 'propinfo', target: p, prompt: null, hit };
      } else if (ud.kind === 'remote' && ud.remote) {
        focus = { kind: 'remote', target: ud.remote, prompt: ud.remote.dead ? null : ud.remote.name, hit };
      } else if (ud.kind === 'healthity') {
        focus = { kind: 'healthity', target: ud.bot, prompt: `[${input.keyName('interact')}] Pat Healthity`, hit };
      }
    }
    // Healthity has no collider: simple ray-sphere test
    const bot = this.game.healthity?.bot;
    if (!focus && bot) {
      const c = bot.root.position;
      const oc = _v.subVectors(c, origin);
      const tca = oc.dot(_fwd);
      if (tca > 0 && tca < 2.2 && oc.lengthSq() - tca * tca < 0.05) focus = { kind: 'healthity', target: bot, prompt: `[${input.keyName('interact')}] Pat Healthity`, hit: null };
    }
    this.focus = focus;
    this.lookHit = hit;

    // hold-E devices (e.g. cranks)
    if (focus && input.hit('interact') && !this.watchOpen) {
      this._interact(focus);
    }
    if (focus && focus.kind === 'device' && input.down('interact') && focus.target.holdTime > 0 && !this.watchOpen) {
      focus.target.interactHold?.(this, dt);
    }
  }

  _interact(focus) {
    const t = focus.target;
    if (focus.kind === 'device') {
      t.interact(this, 'use', focus.hit);
    } else if (focus.kind === 'prop') {
      if (t.custom?.interact && t.custom.prompt?.(this, focus.hit)) {
        t.custom.interact(this, focus.hit);
      } else if (t.def.pocket) {
        if (!this.inv.hasFree()) {
          this.game.ui.toast('Inventory full', 'warn');
          audio.play('ui_error', { volume: 0.4, bus: 'ui' });
          return;
        }
        net.toHost('pickup', { id: t.id });
      } else if (t.def.sleep) {
        if (this.survival.insomnia) {
          this.game.healthity?.say('insomnia');
          return;
        }
        this.sleep(t);
      } else if (t.def.use === 'drink') {
        this.survival.applyFx(t.def.fx);
        audio.play('drink', { volume: 0.7 });
      }
    } else if (focus.kind === 'healthity') {
      this.game.healthity?.pet();
    }
  }

  // host confirmed a pickup
  receiveItem(item) {
    const slot = this.inv.add(item);
    if (slot < 0) {
      // no room: drop it right back
      this.dropItem(item, false);
      return;
    }
    audio.play('grab', { volume: 0.5 });
    this.game.ui.toast(`+ ${itemName(item.type)}`);
    this.game.onItemPicked?.(item);
  }

  sleep(prop) {
    const s = this.survival;
    if (s.rest > 85) {
      this.game.ui.toast("You're not tired.");
      return;
    }
    s.sleeping = true;
    this.sleepT = 0;
    this.sleepProp = prop?.id ?? null;
    audio.play('yawn', { volume: 0.6 });
    this.game.ui.toast('Sleeping... (any key to wake)');
  }

  wake() {
    if (!this.survival.sleeping) return;
    if (this.sleepT > 20 && !this.game.isLobby) { profile.unlock('night_owl'); profile.unlock('sleepy'); }
    this.survival.sleeping = false;
    this.sleepT = 0;
  }

  // ---------------- physics grab ----------------
  _updateGrab(dt) {
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (!this.grab && input.mouseHit(0) && !(this.watchOpen && this.game.watch?.tab === 'camera')) {
      const hit = this.world.physics.raycast(cam.position, _fwd, GRAB_REACH, Q.grab, null, (c) => c !== this.collider);
      if (hit && hit.ud) {
        if (hit.ud.kind === 'prop' && hit.ud.prop.body && !hit.ud.prop.frozen && !hit.ud.prop.def.static) {
          const p = hit.ud.prop;
          const inv = p.root.quaternion.clone().invert();
          const lp = hit.point.clone().sub(p.root.position).applyQuaternion(inv);
          this.grab = { id: p.id, lp, dist: clamp(hit.dist, 0.9, GRAB_REACH), sendT: 0, t: 0 };
          audio.play('grab', { volume: 0.4, pos: hit.point });
        } else if (hit.ud.kind === 'remote' && hit.ud.remote && !hit.ud.remote.dead) {
          this.grab = { remote: hit.ud.remote.id, dist: clamp(hit.dist, 1.0, 2.5), sendT: 0, t: 0 };
          audio.play('grab', { volume: 0.4, pos: hit.point });
        }
      }
    }
    if (!this.grab) return;
    this.grab.t += dt;
    if (!input.mouseDown(0)) {
      this.releaseGrab(false);
      return;
    }
    if (input.mouseHit(2)) {
      this.releaseGrab(true);
      return;
    }
    const w = input.consumeWheel();
    if (w) this.grab.dist = clamp(this.grab.dist - w * 0.25, 0.8, GRAB_REACH);
    const target = _v.copy(cam.position).addScaledVector(_fwd, this.grab.dist);
    this.grab.target = target.clone();
    if (this.grab.remote) {
      // pulling a teammate: send a gentle yank toward the target
      const r = this.game.remotes.get(this.grab.remote);
      if (!r) { this.grab = null; return; }
      this.grab.sendT -= dt;
      if (this.grab.sendT <= 0) {
        this.grab.sendT = 0.1;
        const chest = r.pos.clone().add(_v2.set(0, 0.7, 0));
        const pull = target.clone().sub(chest).multiplyScalar(2.2);
        if (pull.length() > 4) pull.setLength(4);
        net.toHost('yank', { to: r.id, v: [pull.x, pull.y * 0.6, pull.z] });
      }
      return;
    }
    const p = this.world.props.get(this.grab.id);
    if (!p || p.dead || p.frozen) { this.grab = null; return; }
    // stop if the object is far away from where we're pulling (stuck / too heavy)
    const gp = this.grab.lp.clone().applyQuaternion(p.root.quaternion).add(p.root.position);
    this.grab.point = gp;
    if (gp.distanceTo(cam.position) > GRAB_REACH + 1.6) {
      this.releaseGrab(false);
      return;
    }
    this.grab.sendT -= dt;
    if (this.grab.sendT <= 0 || this._rotDelta) {
      this.grab.sendT = net.isHost ? 0 : 1 / 30;
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const rot = this._rotDelta ? [this._rotDelta[0], this._rotDelta[1], _right.x, _right.z] : null;
      this._rotDelta = null;
      net.toHost('grab', { id: this.grab.id, lp: this.grab.lp.toArray(), tp: target.toArray(), r: rot });
    }
  }

  releaseGrab(doThrow) {
    if (!this.grab) return;
    if (this.grab.remote) {
      if (doThrow) {
        _fwd.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
        net.toHost('yank', { to: this.grab.remote, v: [_fwd.x * 6, 3, _fwd.z * 6] });
      }
      this.grab = null;
      return;
    }
    let thr = null;
    if (doThrow) {
      _fwd.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
      thr = [_fwd.x, _fwd.y + 0.12, _fwd.z];
      this.stats.thrown++;
      audio.play('throw_whoosh', { volume: 0.5 });
      this.arms.throwKick = 1;
    } else audio.play('release', { volume: 0.25 });
    if (this.world) net.toHost('grab', { release: true, id: this.grab.id, throw: thr });
    this.grab = null;
  }

  _updateBeam() {
    const g = this.grab;
    const show = !!(g && (g.point || g.remote) && !this.dead);
    this.beam.visible = show;
    this.beamGlow.visible = show;
    if (!show) return;
    const cam = engine.camera;
    const start = _v.set(0.22, -0.2, -0.45).applyQuaternion(cam.quaternion).add(cam.position);
    let end;
    if (g.remote) {
      const r = this.game.remotes.get(g.remote);
      end = r ? r.pos.clone().add(_v2.set(0, 0.7, 0)) : start.clone();
    } else end = g.point;
    const mid = g.target ? g.target.clone().lerp(start, 0.3) : start.clone().lerp(end, 0.5);
    const arr = this.beam.geometry.attributes.position.array;
    const t0 = engine.time;
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      const wob = Math.sin(t * Math.PI) * 0.012 * Math.sin(t0 * 40 + i);
      arr[i * 3] = start.x * a + mid.x * b + end.x * c + wob;
      arr[i * 3 + 1] = start.y * a + mid.y * b + end.y * c + wob;
      arr[i * 3 + 2] = start.z * a + mid.z * b + end.z * c;
    }
    this.beam.geometry.attributes.position.needsUpdate = true;
    this.beamGlow.position.copy(end);
    this.beamGlow.scale.setScalar(0.8 + Math.sin(t0 * 30) * 0.2);
  }

  // ---------------- inventory & items ----------------
  _updateItems(dt) {
    const inv = this.inv;
    for (let i = 0; i < 5; i++) if (input.hit('slot' + (i + 1))) { inv.select(i); this._cancelUse(); }
    if (!this.grab && !this.watchOpen) {
      const w = input.consumeWheel();
      if (w) { inv.cycle(w > 0 ? 1 : -1); this._cancelUse(); audio.play('ui_blip', { volume: 0.2, bus: 'ui' }); }
    }
    if (input.hit('flashlight')) this.toggleFlashlight();
    if (input.hit('drop') && inv.current && !this.useAction) {
      const it = inv.remove();
      this.dropItem(it, false);
    }
    this._refreshHeld();
    const cur = inv.current;
    // use action in progress
    if (this.useAction) {
      this.useAction.t += dt;
      if (this.useAction.t >= this.useAction.dur) this._finishUse();
      return;
    }
    if (!cur || this.grab) {
      this.holdAction = null;
      return;
    }
    const def = itemDef(cur.type);
    const watchCam = this.watchOpen && this.game.watch?.tab === 'camera';
    if (watchCam) return;
    if (input.mouseHit(2)) this._startUse(cur, def);
    if (this.holdAction) {
      if (!input.mouseDown(2)) { this.holdAction.end?.(); this.holdAction = null; }
      else this.holdAction.tick(dt);
    }
  }

  _startUse(item, def) {
    switch (def.use) {
      case 'eat':
      case 'drink':
      case 'heal': {
        const dur = item.type === 'bandage' || item.type === 'splint' ? 2.4 : item.type === 'medkit' ? 3.2 : 1.3;
        this.useAction = { type: item.type, t: 0, dur, slot: this.inv.selected, def };
        const snd = def.use === 'eat' ? 'eat' : def.use === 'drink' ? 'drink' : 'bandage';
        audio.play(snd, { volume: 0.7 });
        this.world.noise.emit(this.pos, 3, 'use');
        break;
      }
      case 'flashlight': this.toggleFlashlight(); break;
      case 'battery': {
        const fi = this.inv.find('flashlight');
        if (fi < 0) { this.game.ui.toast('No flashlight to charge'); break; }
        this.inv.slots[fi].state.charge = 1;
        this.inv.remove(this.inv.selected);
        audio.play('fuse_insert', { volume: 0.6 });
        this.game.ui.toast('Flashlight recharged');
        break;
      }
      case 'glowstick':
      case 'flare': {
        if (item.state.lit) { this.game.ui.toast('Already lit — drop it [G]'); break; }
        item.state.lit = 1;
        item.state.litAt = Date.now();
        audio.play(def.use === 'flare' ? 'spark' : 'ui_type', { volume: 0.7 });
        this.game.ui.toast(def.use === 'flare' ? 'Flare lit! Throw it [G]' : 'Glowstick cracked');
        this.inv.version++;
        break;
      }
      case 'arm': {
        item.state.armed = 1;
        item.state.armedAt = Date.now();
        audio.play('ui_select', { volume: 0.6 });
        this.game.ui.toast('Noise maker armed — throw it! [G]');
        break;
      }
      case 'throw': {
        const it = this.inv.remove();
        this.dropItem(it, true);
        audio.play('dart_throw', { volume: 0.6 });
        break;
      }
      case 'weld':
      case 'multitool':
      case 'sample':
      case 'swing':
        this.holdAction = this.game.tools.begin(def.use, item, this);
        break;
      default:
        if (def.material) this.game.ui.toast('Crafting material — use a workbench');
        break;
    }
  }

  _finishUse() {
    const ua = this.useAction;
    this.useAction = null;
    const slot = this.inv.slots[ua.slot];
    if (!slot || slot.type !== ua.type) return;
    this.inv.remove(ua.slot);
    const wasBleeding = this.survival.bleed > 0;
    this.survival.applyFx(ua.def.fx);
    if (ua.def.use === 'eat') this.stats.eaten++;
    if (ua.def.use === 'drink') this.stats.drank++;
    this.game.onItemUsed?.(ua.type, wasBleeding);
    if (ua.type === 'bandage' || ua.type === 'medkit') this.game.healthity?.say('bandaged');
    if (ua.type === 'splint') this.game.healthity?.say('splinted');
  }

  _cancelUse() {
    this.useAction = null;
    if (this.holdAction) { this.holdAction.end?.(); this.holdAction = null; }
  }

  dropItem(item, thrown) {
    if (!item) return;
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const pos = cam.position.clone().addScaledVector(_fwd, 0.6);
    pos.y = Math.max(pos.y - 0.25, this.pos.y + 0.3);
    // don't drop into walls
    const hit = this.world.physics.raycast(cam.position, _fwd, 0.8, Q.world);
    if (hit) pos.copy(cam.position).addScaledVector(_fwd, Math.max(0.1, hit.dist - 0.25));
    const vel = _fwd.clone().multiplyScalar(thrown ? 14 : 2.2).add(this.vel.clone().multiplyScalar(0.6));
    if (!thrown) vel.y += 1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(thrown ? this.pitch : 0, this.yaw, 0, 'YXZ'));
    net.toHost('drop', { type: item.type, state: item.state, p: pos.toArray(), q: q.toArray(), v: vel.toArray() });
    audio.play('throw_whoosh', { volume: thrown ? 0.5 : 0.2 });
    if (item.type === 'flashlight' && this.flashOn && this.inv.find('flashlight') < 0) this.flashOn = false;
  }

  toggleFlashlight() {
    const fi = this.inv.find('flashlight');
    if (fi < 0) {
      if (this.flashOn) this.flashOn = false;
      else this.game.ui.toast('No flashlight');
      return;
    }
    const st = this.inv.slots[fi].state;
    if (st.charge === undefined) st.charge = 1;
    if (st.charge <= 0.01 && !this.flashOn) {
      audio.play('flashlight_click', { volume: 0.5 });
      this.game.ui.toast('Flashlight battery dead');
      return;
    }
    this.flashOn = !this.flashOn;
    audio.play('flashlight_click', { volume: 0.6 });
  }

  _updateFlashlight(dt) {
    const fi = this.inv.find('flashlight');
    if (fi < 0) this.flashOn = false;
    let charge = 0;
    if (fi >= 0) {
      const st = this.inv.slots[fi].state;
      if (st.charge === undefined) st.charge = 1;
      if (this.flashOn) st.charge = Math.max(0, st.charge - dt / (9 * 60));
      charge = st.charge;
      if (charge <= 0) this.flashOn = false;
    }
    this.flashCharge = charge;
    let inten = 0;
    if (this.flashOn && !this.dead) {
      inten = 36 * (0.55 + Math.min(1, charge * 3) * 0.45);
      if (charge < 0.15) {
        this.flashFlicker -= dt;
        if (this.flashFlicker < 0) this.flashFlicker = Math.random() * 0.4;
        if (this.flashFlicker < 0.08) inten *= 0.2;
      }
    }
    this.flashlight.intensity = inten;
    this.flashlight.visible = inten > 0;
    this.vmFlash.intensity = inten > 0 ? 0.4 : 0;
    const held = this.inv.current?.type === 'flashlight';
    // pocketed flashlight sits on the chest: wider, dimmer
    this.flashlight.angle = held ? 0.5 : 0.62;
    if (!held) this.flashlight.intensity *= 0.65;
  }

  _refreshHeld(force = false) {
    const cur = this.inv.current;
    const type = cur ? cur.type : null;
    if (type === this.heldType && !force) {
      if (cur && this.heldBuilt && this._heldVer !== this.inv.version) {
        this._heldVer = this.inv.version;
        applyItemVisual(cur.type, cur.state, this.heldBuilt);
      }
      if (type === 'flashlight') this.heldModel?.userData.setOn?.(this.flashOn);
      return;
    }
    if (this.heldModel) this.heldModel.removeFromParent();
    this.heldModel = null;
    this.heldType = type;
    if (!type) return;
    const m = buildModel(type, { seed: 1 });
    const o = m.object;
    if (m.hold) {
      o.position.fromArray(m.hold.pos);
      o.rotation.set(...m.hold.rot);
    }
    o.traverse((c) => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
    this.heldModel = o;
    this.heldParts = m.parts;
    this.heldBuilt = m;
    applyItemVisual(type, cur.state, m);
    this.arms.rightHand.add(o);
  }

  // ---------------- viewmodel ----------------
  _updateViewmodel(dt) {
    const s = this.survival;
    const ua = this.useAction;
    let use = 0;
    if (ua) use = Math.sin(Math.min(1, ua.t / ua.dur) * Math.PI);
    this.arms.throwKick = damp(this.arms.throwKick || 0, 0, 8, dt);
    const st = {
      bob: this.bob, speed: this.realSpeed || 0, sprint: this.sprinting,
      watchRaised: this.watchRaised,
      grab: this.grab ? 1 : 0, use, throwCharge: this.arms.throwKick,
      holdingItem: !!this.inv.current,
      sway: new THREE.Vector2(this.lookDelta?.x || 0, this.lookDelta?.y || 0),
      landing: this.landKick, phase: this.stepPhase,
    };
    this.arms.root.visible = !this.dead && !this.thirdPerson && !s.sleeping && !this.terminal && !this.game.ui.customizing;
    this.arms.update(dt, st);
    // viewmodel lighting
    const lc = this.lightColor || new THREE.Color(0.6, 0.55, 0.45);
    this.vmHemi.color.copy(lc).multiplyScalar(1.1);
    this.vmHemi.intensity = 0.15 + Math.min(1.0, this.lightLevel * 0.8);
    this.vmDir.intensity = 0.1 + Math.min(0.8, this.lightLevel * 0.6);
    this._updateBeam();
  }

  _updateAvatar(dt) {
    const a = this.avatar;
    a.root.position.copy(this.pos);
    a.root.rotation.y = this.yaw;
    const show = this.thirdPerson || !!this.game.ui.customizing;
    a.root.visible = show;
    if (this._fpHidden !== !show) { this._fpHidden = !show; a.setVisibleFirstPerson?.(!show); }
    const lv = _v.set(this.vel.x, 0, this.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const sp = Math.hypot(lv.x, lv.z);
    a.update(dt, {
      speed: this.realSpeed || 0,
      moveDir: new THREE.Vector2(sp > 0.01 ? lv.x / sp : 0, sp > 0.01 ? -lv.z / sp : 0),
      grounded: this.grounded, vy: this.vel.y, crouch: this.crouch, sprint: this.sprinting,
      pitch: this.pitch, talking: this.talking, holding: this.grab ? 1 : 0, holdTarget: this.grab?.target || null,
      emote: this.survival.sleeping ? 'sleep' : this.emote, expression: this._expression(), limp: this.survival.fracture, dead: this.dead,
    });
  }

  _expression() {
    const s = this.survival;
    if (this.dead) return 'dead';
    if (s.sleeping) return 'sleepy';
    if (s.stress > 0.5) return 'scared';
    if (s.damageFlash > 0.3) return 'hurt';
    if (s.rest < 25) return 'sleepy';
    if (this.emote === 'dance' || this.emote === 'wave') return 'happy';
    return 'neutral';
  }

  _updateEmotes(dt) {
    if (input.hit('emoteWave')) { this.emote = 'wave'; this.emoteT = 2.2; }
    if (input.hit('emoteDance')) { this.emote = this.emote === 'dance' ? null : 'dance'; this.emoteT = 30; }
    if (input.hit('emotePoint')) { this.emote = 'point'; this.emoteT = 1.6; }
    if (input.hit('thirdPerson')) this.thirdPerson = !this.thirdPerson;
    if (this.emote) {
      this.emoteT -= dt;
      if (this.emoteT <= 0 || (this.emote === 'dance' && this.moving)) this.emote = null;
    }
  }

  // ---------------- death & spectating ----------------
  onDeath(cause) {
    if (this.dead) return;
    this.dead = true;
    this.survival.die(cause);
    this.releaseGrab(false);
    this._cancelUse();
    this.flashOn = false;
    this.watchOpen = false;
    this.survival.sleeping = false;
    audio.play('death', { volume: 0.9 });
    // drop everything where we died
    const items = this.inv.serialize().filter(Boolean);
    this.inv.clear();
    net.toHost('died', {
      cause: this.survival.deathCause || cause,
      p: this.pos.toArray(), yaw: this.yaw,
      v: this.vel.toArray(), items,
    });
    if (this.collider) this.collider.setEnabled(false);
    this.game.onLocalDeath?.(cause);
  }

  revive(spawn) {
    this.dead = false;
    this.survival.reset();
    if (this.collider) this.collider.setEnabled(true);
    this.teleport(spawn.pos, spawn.yaw);
    this.arrivalGrace = 1;
  }

  _updateSpectate(dt) {
    const cam = engine.camera;
    const living = [...this.game.remotes.values()].filter((r) => !r.dead && r.inWorld);
    if (input.mouseHit(0)) this.spectateIdx++;
    if (input.mouseHit(2)) this.spectateIdx--;
    const lk = input.locked ? input.look() : { x: 0, y: 0 };
    this.spectateYaw -= lk.x;
    this.spectatePitch = clamp(this.spectatePitch - lk.y, -1.2, 0.6);
    let center;
    if (living.length) {
      const r = living[((this.spectateIdx % living.length) + living.length) % living.length];
      center = r.pos.clone().add(_v2.set(0, 1.0, 0));
      this.spectating = r;
    } else {
      center = this.pos.clone().add(_v2.set(0, 1.0, 0));
      this.spectating = null;
    }
    _e.set(this.spectatePitch, this.spectateYaw, 0);
    cam.quaternion.setFromEuler(_e);
    _v.set(0, 0, 1).applyQuaternion(cam.quaternion);
    const hit = this.world.physics.raycast(center, _v, 3.2, Q.world);
    const d = hit ? Math.max(0.3, hit.dist - 0.25) : 3.2;
    cam.position.copy(center).addScaledVector(_v, d);
    cam.fov = damp(cam.fov, 70, 4, dt);
    cam.updateProjectionMatrix();
    audio.setListener(cam.position, cam.quaternion);
  }

  // ---------------- networking ----------------
  _sendPose(dt) {
    this.poseTimer -= dt;
    if (this.poseTimer > 0) return;
    this.poseTimer = 1 / 20;
    const s = this.survival;
    net.toHost('pose', {
      p: [+this.pos.x.toFixed(3), +this.pos.y.toFixed(3), +this.pos.z.toFixed(3)],
      y: +this.yaw.toFixed(3), pi: +this.pitch.toFixed(3),
      v: [+this.vel.x.toFixed(2), +this.vel.y.toFixed(2), +this.vel.z.toFixed(2)],
      g: this.grounded ? 1 : 0, c: +this.crouch.toFixed(2), sp: this.sprinting ? 1 : 0,
      h: this.grab ? 1 : 0, ht: this.grab?.target ? this.grab.target.toArray().map((x) => +x.toFixed(2)) : null,
      tk: +this.talking.toFixed(2), em: s.sleeping ? 'sleep' : this.emote, ex: this._expression(),
      fl: this.flashOn ? 1 : 0, it: this.inv.current?.type || null, d: this.dead ? 1 : 0,
      hs: s.summary(), lp: s.fracture ? 1 : 0,
    });
  }

  // a teammate is pulling us (physics grab)
  applyYank(v) {
    if (this.dead) return;
    this.yank.set(v[0], v[1], v[2]);
    if (v[1] > 0.5) this.grounded = false;
  }

  dispose() {
    this.detachWorld();
    this.arms.root.removeFromParent();
    this.beam.removeFromParent();
    this.beamGlow.removeFromParent();
  }
}
