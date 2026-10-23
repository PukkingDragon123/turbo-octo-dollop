// The local clone: first-person controller, camera feel, physics grabbing, interaction,
// inventory & item use, flashlight, sleeping, death & spectating, pose replication.
// Controls: RMB = interact (tap) / grab with the hands and drag (hold; the pull gets stronger the longer it is held),
// Shift while carrying = throw far, LMB = punch (hold to wind up) / use the right-hand item / the drawn
// multitool ([Q]; hold to charge power), E = interact, G = drop (hold: drop everything).
// Carried items live in the hands (game/hands.js), vitals on the mechanical heart + brain (ui/vitals3d.js),
// fists / knock-outs / gore in game/combat.js, quick-time events in game/qte.js (game.qte).
import * as THREE from 'three';
import { engine } from '../core/engine.js';
import { input } from '../core/input.js';
import { net } from '../net/net.js';
import { RAPIER, GROUPS, G, groups, Q } from '../physics/physics.js';
import { audio } from '../audio/audio.js';
import { Survival } from './survival.js';
import { Inventory } from './inventory.js';
import { itemDef, itemName } from './itemdefs.js';
import { Avatar, buildFirstPersonArms, DEFAULT_COSMETICS } from '../entities/avatar.js';
import { clamp, damp } from '../core/rng.js';
import { profile } from '../core/profile.js';
import { Hands } from './hands.js';
import { Combat, COMBAT } from './combat.js';
import { QTE } from './qte.js';
import { VitalsHUD } from '../ui/vitals3d.js';
import { juice } from '../gfx/juice.js';
import { floatText } from '../ui/floattext.js';
import { Inspector } from './inspect.js';

const STAND_HH = 0.38, CROUCH_HH = 0.12, RADIUS = 0.3;
const EYE_STAND = 1.36, EYE_CROUCH = 0.8; // matches the robot clone's eyes (doll/robotrig.js)
const WALK = 2.9, SPRINT = 5.1, CROUCH_SPEED = 1.45;
const GRAVITY = 15.5, JUMP_V = 4.9;
const REACH = 2.7;
// physics grabbing is done with the arms (no beam): reach out to ARM_REACH, the object is pulled in on a spring
// to the hold distance (by its size; the wheel adjusts it), the grip slips past GRIP_BREAK
const GRAB_REACH = 2.1, HOLD_MIN = 0.7, HOLD_MAX = 1.5, GRIP_BREAK = 2.6;
const holdDist = (p) => clamp(0.72 + (p.radius || 0.2) * 1.1, HOLD_MIN, 1.25); // small things close, furniture at full reach
export const CONTROLS = { tapTime: 0.22, pullStart: 0.5, pullMax: 1.7, pullRamp: 0.8, dropAllTime: 0.6, mtReserve: 0.25, mtTrickle: 0.002 };
const PATCH_TIME = { bandage: 2.6, medkit: 3.4, plasma_syringe: 2.4 };

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
    this.mtMode = 'attach'; // built-in multitool: 'attach' | 'dismantle' ([R] with an empty hand)
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
    this.hands = new Hands(this);
    this.combat = new Combat(this);
    this.vitals = new VitalsHUD();
    this.qte = game.qte = new QTE(game);
    this.toolOut = false; // built-in multitool drawn ([Q])
    const self = this;
    // the built-in multitool's battery: hold-to-charge power drains it; Healthity (or a battery item) charges it
    this.tool = {
      battery: 1, power: 0, sputter: 0,
      get mode() { return self.mtMode; },
      set mode(v) { self.mtMode = v === 'dismantle' ? 'dismantle' : 'attach'; },
      charge(amount = 1) { this.battery = clamp(this.battery + amount, 0, 1); return this.battery; },
    };
    this.grabPower = CONTROLS.pullStart;
    this.rmbPending = null;
    this.dropHold = 0;

    // viewmodel lighting follows the local light level
    this.vmHemi = new THREE.HemisphereLight(0xfff2d0, 0x3a3020, 0.6);
    this.vmDir = new THREE.DirectionalLight(0xfff0d8, 0.5);
    this.vmDir.position.set(0.5, 1, 0.3);
    // flashlight bounce off whatever the beam hits, lighting the hands from the front
    this.vmFlash = new THREE.PointLight(0xfff4e0, 0, 4, 2);
    this.vmFlash.position.set(0, 0.05, -1.1);
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

    this.strain = 0; // physics-grab effort (0..1): heavy things drag, the arms shake
    this.inspect = new Inspector(this);
  }

  get id() { return net.selfId; }
  get alive() { return !this.dead; }

  setCosmetics(c) {
    this.cosmetics = { ...this.cosmetics, ...c };
    this.avatar.setCosmetics(this.cosmetics);
    engine.vmScene.remove(this.arms.root);
    this.arms = buildFirstPersonArms(this.cosmetics);
    engine.vmScene.add(this.arms.root);
    this.hands?.reattach();
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
    if (net.isHost) this.combat.hostTick();
    if (this.dead) {
      this.qte.update(dt);
      this._updateSpectate(dt);
      this._updateViewmodel(dt);
      this._sendPose(dt);
      return;
    }
    // knocked out: the camera hangs over the ragdoll until the clone gets back up
    if (this.combat.ko) {
      this.combat.updateKO(dt);
      this._updateSurvival(dt);
      this._updateViewmodel(dt);
      this._updateAvatar(dt);
      this._sendPose(dt);
      return;
    }
    this.qte.update(dt);
    const canControl = !this.terminal && !ui.menuOpen && !this.game.cutscene && !ui.customizing;
    const qteLock = this.qte.locking;
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
    // notices make the clone glance at the wrist (no screen HUD)
    const glance = !this.watchOpen && this.game.watch?.peeking && !this.grab && !this.useAction ? 0.62 : 0;
    this.watchRaised = damp(this.watchRaised, this.watchOpen ? 1 : glance, this.watchOpen || glance ? 10 : 7, dt);

    // sleeping
    if (s.sleeping) {
      this.sleepT += dt;
      if ((canControl && (input.hit('jump') || input.hit('interact') || input.mouseHit(0))) || s.rest >= 100 || s.stress > 0.5) this.wake();
    }

    this._updateMovement(dt, canControl && !s.sleeping && !qteLock);
    this._updateCamera(dt);
    this._updateSurvival(dt);
    if (this.dead) return;
    this.combat.updateKO(dt); // daze decay / get-up
    if (canControl && !s.sleeping && !qteLock) {
      this._updateInteraction(dt);
      this._updateGrab(dt);
      this._updateItems(dt);
      this._updateEmotes(dt);
    } else {
      if (this.grab && !this.terminal) this.releaseGrab(false);
      if (qteLock) { this._endHold(); this.combat.cancel(); }
      this.focus = null;
      this.inspect.update(dt, null, null, false);
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
      // analog stick (touch): direction and magnitude, so a half-pushed stick walks slowly
      const ax = input.moveAxis;
      if (ax && Math.hypot(ax.x, ax.y) > 0.08) { ix = ax.x; iz = ax.y; }
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
    if (len > 1) { ix /= len; iz /= len; }
    this.moving = len > 0.05;
    const canSprint = !s.fracture && s.stamina > 1 && !this.crouching && iz < 0.2;
    // (Shift is the far throw while carrying a prop, so no sprinting with one)
    this.sprinting = canControl && input.down('sprint') && this.moving && canSprint && (this.sprinting || s.stamina > 6) && !(this.grab && !this.grab.remote);
    let speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;
    if (s.fracture) speed *= 0.62;
    if (s.rest < 15) speed *= 0.85;
    if (s.blood < 3000) speed *= 0.85;
    this.waterDepth = level?.waterDepth?.(this.pos.x, this.pos.z) ?? 0;
    if (this.waterDepth > 0.05) speed *= 0.78;
    // level water physics (Poolrooms: treading / swimming in deep water); may set vel.y, returns a speed factor
    const wm = level?.waterMotion?.(this, dt, canControl);
    if (wm !== undefined) speed *= wm;
    // carrying heavy things slows you down
    if (this.grab) {
      const p = this.world.props.get(this.grab.id);
      if (p) speed *= clamp(1.15 - p.mass / 70, 0.45, 1) * (1 - this.strain * 0.3); // dragging with effort
    }
    if (this.watchOpen) speed *= 0.75;
    speed *= this.hands.speedFactor; // an armful of stuff is heavy

    // wish direction in world
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = _v.set(0, 0, 0).addScaledVector(_fwd, -iz).addScaledVector(_right, ix).multiplyScalar(speed);
    const accel = this.grounded ? (this.moving ? 16 : 13) : this.swimming ? 4 : 2.5;
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
        this.vel.y = JUMP_V * (this.hands.layout.armful ? 0.72 : 1);
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
    const eye = (EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouch) * (1 - this.combat.getUp * 0.9);
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
    const fovTarget = 72 + (this.sprinting ? 7 : 0);
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
        if (!pr && p.def.pocket && (!p.frozen || p.type === 'dart')) pr = `[RMB] Pick up ${itemName(p.type)}${this.hands.layout.n >= 2 ? ' (armful)' : ''}`;
        if (!pr && p.def.sleep && this.survival.advanced) pr = this.survival.insomnia ? 'Can\'t sleep... something is watching' : `[${input.keyName('interact')}] Sleep`;
        if (!pr && p.def.use === 'drink' && !p.def.pocket) pr = `[${input.keyName('interact')}] Drink from ${itemName(p.type)}`;
        if (pr) focus = { kind: 'prop', target: p, prompt: pr, hit };
        else focus = { kind: 'propinfo', target: p, prompt: null, hit };
      } else if (ud.kind === 'remote' && ud.remote) {
        focus = { kind: 'remote', target: ud.remote, prompt: ud.remote.dead ? null : ud.remote.name, hit };
      } else if (ud.kind === 'healthity') {
        focus = { kind: 'healthity', target: ud.bot, prompt: this.game.healthity?.promptText?.() || `[${input.keyName('interact')}] Pat Healthity`, hit };
      }
    }
    // Healthity has no collider: simple ray-sphere test
    const bot = this.game.healthity?.bot;
    if (!focus && bot) {
      const c = bot.root.position;
      const oc = _v.subVectors(c, origin);
      const tca = oc.dot(_fwd);
      if (tca > 0 && tca < 2.2 && oc.lengthSq() - tca * tca < 0.05) focus = { kind: 'healthity', target: bot, prompt: this.game.healthity?.promptText?.() || `[${input.keyName('interact')}] Pat Healthity`, hit: null };
    }
    // furniture shows its name, pad value and what the built-in multitool would do
    {
      if (focus && focus.kind === 'propinfo') focus.prompt = this.game.tools.mtPrompt(focus.target, this);
      else if (!focus || !focus.prompt) {
        const part = this.game.tools._campPartNearRay(hit ? hit.dist : REACH); // thin tent parts are easy to miss
        if (part) focus = { kind: 'propinfo', target: part, prompt: this.game.tools.mtPrompt(part, this), hit: null };
      }
    }
    this.focus = focus;
    this.lookHit = hit;
    this.inspect.update(dt, focus, hit); // floating name on hover, a line of flavour text on [E] / tap / click

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
          floatText.notice("Can't carry any more — [G] drop something", { duration: 1.6, color: '#ffb040' });
          audio.play('ui_error', { volume: 0.4, bus: 'ui' });
          return;
        }
        net.toHost('pickup', { id: t.id });
      } else if (t.def.sleep && this.survival.advanced) {
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
    // the hand that ends up holding it reaches down, snatches it and pulls it in
    const L = this.hands.compute();
    this.arms.gesture?.(L.armful ? 'snatch' : 'pickup', L.armful ? 'both' : L.left === slot ? 'L' : 'R');
    this.game.healthity?.onPickup(item.type, itemName(item.type));
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

  // ---------------- physics grab (RMB) ----------------
  // RMB tap on something usable = interact (pick up, search, press); RMB hold = grab and pull. The pull
  // power ramps up while the button stays down; Shift throws far, LMB throws.
  _updateGrab(dt) {
    const armful = this.hands.layout.armful;
    if (!this.grab && !this.rmbPending && input.mouseHit(2) && !this.watchOpen) {
      const f = this.focus;
      if (f && f.prompt && (f.kind === 'device' || f.kind === 'prop' || f.kind === 'healthity')) {
        const p = f.kind === 'prop' ? f.target : null;
        const draggable = p && p.body && !p.frozen && !p.def.static && !armful;
        if (draggable) this.rmbPending = { t: 0, focus: f }; // tap = use it, hold = drag it
        else this._interact(f);
      } else if (armful) this._armsFull();
      else this._startGrab();
    }
    if (this.rmbPending) {
      const pd = this.rmbPending;
      pd.t += dt;
      if (!input.mouseDown(2)) { this.rmbPending = null; if (pd.t < CONTROLS.tapTime + 0.1) this._interact(pd.focus); }
      else if (pd.t >= CONTROLS.tapTime) { this.rmbPending = null; this._startGrab(); }
    }
    // hold-RMB devices (cranks) work like holding E
    const fo = this.focus;
    if (!this.grab && fo && fo.kind === 'device' && input.mouseDown(2) && fo.target.holdTime > 0 && !this.watchOpen) fo.target.interactHold?.(this, dt);
    if (!this.grab) { this.grabPower = CONTROLS.pullStart; return; }
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.grab.t += dt;
    // hold to pull harder
    const was = this.grabPower;
    this.grabPower = Math.min(CONTROLS.pullMax, CONTROLS.pullStart + this.grab.t * CONTROLS.pullRamp);
    if (was < 1.2 && this.grabPower >= 1.2) audio.play('android_servo', { volume: 0.3 });
    if (input.hit('throw')) { this.releaseGrab(true, true); return; }
    if (!input.mouseDown(2)) { this.releaseGrab(false); return; }
    const w = input.consumeWheel();
    if (w) this.grab.hold = clamp(this.grab.hold - w * 0.15, HOLD_MIN, HOLD_MAX);
    // the hands draw what they caught in to arm's length (a spring, not a tractor beam)
    this.grab.dist = damp(this.grab.dist, this.grab.hold, 5, dt);
    const target = _v.copy(cam.position).addScaledVector(_fwd, this.grab.dist);
    this.grab.target = target.clone();
    if (this.grab.remote) {
      // pulling a teammate: a yank toward the target, harder the longer it is held
      const r = this.game.remotes.get(this.grab.remote);
      if (!r || r.dead) { this.grab = null; return; }
      this.grab.sendT -= dt;
      if (this.grab.sendT <= 0) {
        this.grab.sendT = 0.1;
        const chest = r.pos.clone().add(_v2.set(0, 0.7, 0));
        const gp = this.grabPower;
        const pull = target.clone().sub(chest).multiplyScalar(2.2 * gp);
        if (pull.length() > 4 * gp) pull.setLength(4 * gp);
        net.toHost('yank', { to: r.id, v: [pull.x, pull.y * 0.6, pull.z] });
      }
      return;
    }
    const g = this.grab;
    const p = this.world.props.get(this.grab.id);
    if (!p || p.dead || p.frozen) { this.grab = null; return; }
    // stop if the object is far away from where we're pulling (stuck / too heavy)
    const gp = this.grab.lp.clone().applyQuaternion(p.root.quaternion).add(p.root.position);
    this.grab.point = gp;
    // effort: how far the grip lags behind where the hands pull, weighted by mass (heavy furniture drags)
    const lagD = g.target ? gp.distanceTo(g.target) : 0;
    this.strain = damp(this.strain, clamp((lagD - 0.12) / 0.55, 0, 1) * clamp(0.35 + p.mass / 30, 0.35, 1), 6, dt);
    if (gp.distanceTo(cam.position) > GRIP_BREAK + (this.grabPower - 1) * 0.3) {
      floatText.notice('Lost your grip', { duration: 1.1, color: '#ffb040' });
      this.releaseGrab(false);
      return;
    }
    this.grab.sendT -= dt;
    if (this.grab.sendT <= 0 || this._rotDelta) {
      this.grab.sendT = net.isHost ? 0 : 1 / 30;
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const rot = this._rotDelta ? [this._rotDelta[0], this._rotDelta[1], _right.x, _right.z] : null;
      this._rotDelta = null;
      net.toHost('grab', { id: this.grab.id, lp: this.grab.lp.toArray(), tp: target.toArray(), r: rot, f: +this.grabPower.toFixed(2) });
    }
  }

  _startGrab() {
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let hit = this.world.physics.raycast(cam.position, _fwd, REACH + 0.5, Q.grab, null, (c) => c !== this.collider);
    if (hit && hit.dist > GRAB_REACH) {
      // the arms only reach so far
      if (hit.ud?.kind === 'prop' && hit.ud.prop?.body && engine.time - (this._farT || -9) > 1.2) { this._farT = engine.time; floatText.notice('Out of reach — step closer', { duration: 1.1 }); }
      hit = null;
    }
    if (hit && hit.ud) {
      if (hit.ud.kind === 'prop' && hit.ud.prop.body && !hit.ud.prop.frozen && !hit.ud.prop.def.static) {
        const p = hit.ud.prop;
        const inv = p.root.quaternion.clone().invert();
        const lp = hit.point.clone().sub(p.root.position).applyQuaternion(inv);
        this.grab = { id: p.id, lp, dist: clamp(hit.dist, 0.6, GRAB_REACH), hold: holdDist(p), sendT: 0, t: 0 };
        audio.play('grab', { volume: 0.4, pos: hit.point });
      } else if (hit.ud.kind === 'remote' && hit.ud.remote && !hit.ud.remote.dead) {
        this.grab = { remote: hit.ud.remote.id, dist: clamp(hit.dist, 0.8, GRAB_REACH), hold: 1.0, sendT: 0, t: 0 };
        audio.play('grab', { volume: 0.4, pos: hit.point });
      }
    }
    if (!this.grab) {
      // thin tent parts are easy to miss: grab one the ray passes close to by its centre
      const part = this.game.tools._campPartNearRay(hit ? hit.dist : GRAB_REACH);
      if (part?.body) {
        this.grab = { id: part.id, lp: new THREE.Vector3(), dist: clamp(part.root.position.distanceTo(cam.position), 0.6, GRAB_REACH), hold: holdDist(part), sendT: 0, t: 0 };
        audio.play('grab', { volume: 0.4, pos: part.root.position });
      }
    }
    if (this.grab) {
      this.grabPower = CONTROLS.pullStart; this.strain = 0; this.combat.cancel();
      const sides = this._grabHands();
      this.arms.gesture?.('grab', sides.two ? 'both' : sides.R ? 'R' : 'L');
    }
  }

  releaseGrab(doThrow, far = false) {
    if (!this.grab) return;
    const hs = this._grabHands();
    if (!doThrow) this.arms.gesture?.('release', hs.two ? 'both' : hs.R ? 'R' : 'L');
    this.strain = 0;
    if (this.grab.remote) {
      if (doThrow) {
        _fwd.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
        const k = far ? 10 : 6;
        net.toHost('yank', { to: this.grab.remote, v: [_fwd.x * k, far ? 4.5 : 3, _fwd.z * k] });
        audio.play('throw_whoosh', { volume: 0.6 });
        this.arms.throwKick = 1;
      }
      this.grab = null;
      return;
    }
    let thr = null;
    if (doThrow) {
      _fwd.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
      thr = [_fwd.x, _fwd.y + (far ? 0.2 : 0.12), _fwd.z];
      this.stats.thrown++;
      audio.play('throw_whoosh', { volume: far ? 0.8 : 0.5, intensity: far ? 1 : 0.5 });
      this.arms.throwKick = 1;
      if (far) { juice.punch(0.03); juice.shake(0.12); }
    } else audio.play('release', { volume: 0.25 });
    if (this.world) net.toHost('grab', { release: true, id: this.grab.id, throw: thr, far: far ? 1 : 0, f: +this.grabPower.toFixed(2) });
    this.grab = null;
  }

  // which hands take hold: big / heavy things get both, otherwise the free hand (right first)
  _grabHands() {
    const g = this.grab;
    const H = this.hands;
    const freeR = !H.R.type, freeL = !H.L.type;
    let two = false, size = 0.35;
    if (g && g.id != null && this.world) {
      const p = this.world.props.get(g.id);
      if (p) { two = (p.radius || 0.2) > 0.24 || (p.mass || 1) > 9; size = clamp(((p.radius || 0.2) - 0.05) / 0.45, 0, 1); }
    } else if (g?.remote) { two = true; size = 0.6; }
    if (two) return { R: true, L: true, two: true, size };
    if (freeR || !freeL) return { R: true, L: false, two: false, size };
    return { R: false, L: true, two: false, size };
  }

  // camera-space wrist targets for the grab: each grip point is projected through the world camera and placed
  // at the same screen spot in the viewmodel, at a depth that grows with how far the hand has to reach
  _toVM(world, out, side) {
    const cam = engine.camera, vm = engine.vmCamera;
    _v2.copy(world).applyMatrix4(cam.matrixWorldInverse);
    const dist = Math.max(0.25, -_v2.z);
    const tm = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), tv = Math.tan(THREE.MathUtils.degToRad(vm.fov / 2));
    let nx = _v2.x / (dist * tm * cam.aspect), ny = _v2.y / (dist * tm);
    if (_v2.z > -0.1) { nx = Math.sign(nx || side) * 0.8; ny = -0.6; }
    nx = side > 0 ? clamp(nx, -0.3, 0.85) : clamp(nx, -0.85, 0.3);
    ny = clamp(ny, -0.95, 0.02); // never above the crosshair: the forearms would sweep across the view
    const z = 0.4 + 0.22 * clamp((dist - 0.45) / 1.3, 0, 1);
    return out.set(nx * z * tv * vm.aspect, ny * z * tv, -z).multiplyScalar((z - 0.06) / z);
  }

  _updateReach() {
    const g = this.grab;
    const R = this._reachOut || (this._reachOut = { R: new THREE.Vector3(), L: new THREE.Vector3(), c: new THREE.Vector3() });
    if (!g || this.dead || !this.world) return null;
    const hs = this._grabHands();
    let grip = null, center = null, half = 0;
    if (g.remote) {
      const r = this.game.remotes.get(g.remote);
      if (!r) return null;
      center = grip = R.c.copy(r.pos).add(_v.set(0, 0.95, 0));
      half = 0.2;
    } else {
      const p = this.world.props.get(g.id);
      if (!p || !g.point) return null;
      grip = g.point;
      if (hs.two) {
        // hug it: both palms on the sides facing us, near the top edge (bounds measured once per grab)
        if (!g.bounds) {
          const b = new THREE.Box3().setFromObject(p.root), sz = b.getSize(new THREE.Vector3());
          g.bounds = { hx: sz.x / 2, hz: sz.z / 2, cy: b.getCenter(new THREE.Vector3()).y - p.root.position.y, top: b.max.y - p.root.position.y };
        }
        const B = g.bounds, cam = engine.camera;
        _right.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
        _v2.subVectors(cam.position, p.root.position).setY(0).normalize();
        half = clamp(Math.abs(_right.x) * B.hx + Math.abs(_right.z) * B.hz, 0.12, 0.42);
        const front = Math.abs(_v2.x) * B.hx + Math.abs(_v2.z) * B.hz;
        center = R.c.copy(p.root.position).addScaledVector(_v2, front * 0.5);
        center.y += B.cy + (B.top - B.cy) * 0.55;
      } else center = R.c.copy(grip);
    }
    const out = { reachR: null, reachL: null, twoHanded: hs.two, gripSize: hs.size, strain: this.strain };
    if (hs.two) {
      if (g.remote) _right.set(1, 0, 0).applyQuaternion(engine.camera.quaternion);
      out.reachR = this._toVM(_v.copy(center).addScaledVector(_right, half), R.R, 1);
      out.reachL = this._toVM(_v.copy(center).addScaledVector(_right, -half), R.L, -1);
      if (out.reachR.x - out.reachL.x < 0.1) { const m = (out.reachR.x + out.reachL.x) / 2; out.reachR.x = m + 0.05; out.reachL.x = m - 0.05; }
    } else if (hs.R) out.reachR = this._toVM(grip, R.R, 1);
    else out.reachL = this._toVM(grip, R.L, -1);
    return out;
  }

  // ---------------- hands, items & tools ----------------
  _updateItems(dt) {
    const inv = this.inv, H = this.hands;
    let L = H.compute();
    for (let i = 0; i < 5; i++) if (input.hit('slot' + (i + 1))) this._selectSlot(i);
    if (!this.grab && !this.watchOpen) {
      const w = input.consumeWheel();
      if (w) this._cycleHands(w > 0 ? 1 : -1);
    }
    if (input.hit('flashlight')) this.toggleFlashlight();
    if (input.hit('tool') && !this.watchOpen) this.toggleTool();
    this._updateDrop(dt);
    L = H.compute();
    // two items: both hands are full, so the right hand always holds one; the drawn multitool needs a free hand
    if (L.n >= 2 && !inv.current) { const i = inv.slots.findIndex(Boolean); if (i >= 0) inv.select(i); }
    if (this.toolOut && (L.n >= 2)) { this.toolOut = false; this._endHold(); }
    if (this.toolOut && L.n === 1 && inv.current) { const f = inv.firstFree(); if (f >= 0) inv.select(f); }
    if (!this.toolOut && !this.holdAction?.multitool) {
      // a little trickle keeps an emergency reserve in the battery (camp building never soft-locks)
      if (this.tool.battery < CONTROLS.mtReserve) this.tool.charge(dt * CONTROLS.mtTrickle);
    }
    if (this.game.isLobby) this.tool.charge(dt * 0.05);
    this.tool.sputter = Math.max(0, this.tool.sputter - dt);
    this.tool.drainMul = this._upgrade('battery') ? 0.5 : 1; // shop upgrade (game/economy.js)
    // use action in progress (eat / drink / heal)
    if (this.useAction) {
      this.useAction.t += dt;
      if (this.useAction.t >= this.useAction.dur) this._finishUse();
      return;
    }
    if (this.vitals.busy) return;
    L = H.compute();
    const cur = H.rightItem();
    const def = cur ? itemDef(cur.type) : null;
    // an armful: no punching, no using
    if (L.armful) {
      this._endHold(); this.combat.cancel();
      if (input.mouseHit(0) && !this.grab) this._armsFull();
      if (this.grab && input.mouseHit(0)) this.releaseGrab(true);
      return;
    }
    if (this.grab) {
      // carrying a camp part: LMB attaches it with the multitool; anything else: LMB throws it
      if (this._mtOwnsLmb()) { this._updateMultitool(dt); return; }
      this._endHold();
      this.combat.cancel();
      if (input.mouseHit(0)) this.releaseGrab(true);
      return;
    }
    if (this.toolOut || def?.use === 'multitool') { this._updateMultitool(dt); return; }
    if (cur && def.use && def.use !== 'swing') {
      if (input.mouseHit(0) && !this.holdAction) this._startUse(cur, def);
      if (this.holdAction) {
        if (!input.mouseDown(0)) this._endHold();
        else this.holdAction.tick(dt);
      }
      return;
    }
    // fists, or a swing weapon in the right hand (not while reading the watch)
    if (this.watchOpen) { this.combat.cancel(); return; }
    // ranged weapons (nail gun) fire through the economy's weapon attack (tools._swing, stats + quest counters)
    if (def?.weapon?.ranged) { if (input.mouseHit(0)) this.game.tools._swing(cur, this); return; }
    this.combat.input(dt, { weapon: def?.use === 'swing' ? cur : null, sides: { R: !cur, L: !H.leftItem() } });
  }

  _armsFull() {
    if (engine.time - (this._fullT || -9) < 1.6) return;
    this._fullT = engine.time;
    floatText.notice(`ARMS FULL — [${input.keyName('drop')}] drop`, { duration: 1.4, color: '#ffb040' });
    audio.play('suit_rustle', { volume: 0.5 });
  }

  // [1-5]: hold that item in the right hand (an empty slot frees the right hand when carrying one item)
  _selectSlot(i) {
    const inv = this.inv, L = this.hands.compute();
    if (inv.slots[i]) { inv.select(i); if (this.toolOut) this.toolOut = false; }
    else if (L.n <= 1) inv.select(i);
    else return;
    this._cancelUse();
    audio.play('ui_blip', { volume: 0.2, bus: 'ui' });
  }

  // wheel / NEXT: swap hands (one item: right <-> left; two: swap; armful: shuffle the pile)
  _cycleHands(d) {
    const inv = this.inv, L = this.hands.compute();
    if (!L.n) return;
    const occ = inv.slots.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (L.n === 1) {
      const it = occ[0];
      if (inv.selected === it) { const f = inv.firstFree(); if (f >= 0) inv.select(f); } else { inv.select(it); this.toolOut = false; }
    } else {
      const k = occ.indexOf(inv.selected);
      inv.select(occ[(k + (d > 0 ? 1 : -1) + occ.length) % occ.length]);
    }
    this._cancelUse();
    audio.play('ui_blip', { volume: 0.2, bus: 'ui' });
  }

  // [G]: tap drops one item (right hand, else left, else the top of the armful); hold drops everything
  _updateDrop(dt) {
    if (this.useAction) { this.dropHold = 0; return; }
    if (input.down('drop')) {
      this.dropHold += dt;
      if (this.dropHold >= CONTROLS.dropAllTime && !this._droppedAll) {
        this._droppedAll = true;
        let k = 0;
        for (let i = 0; i < this.inv.slots.length; i++) if (this.inv.slots[i]) this.dropItem(this.inv.remove(i), false, k++);
        if (k) { audio.play('suit_rustle', { volume: 0.6 }); this.arms.gesture?.('drop', 'both'); }
      }
      return;
    }
    if (this.dropHold > 0 && !this._droppedAll) {
      const L = this.hands.compute();
      const i = L.armful ? L.pile[L.pile.length - 1] : L.right >= 0 ? L.right : L.left;
      if (i >= 0 && i != null) {
        this.arms.gesture?.('drop', L.armful ? 'both' : i === L.left ? 'L' : 'R');
        this.dropItem(this.inv.remove(i), false);
      }
    }
    this.dropHold = 0;
    this._droppedAll = false;
  }

  // [Q]: draw / holster the built-in multitool (needs a free right hand)
  toggleTool() {
    if (this.toolOut) { this.toolOut = false; this._endHold(); audio.play('ui_back', { volume: 0.35, bus: 'ui' }); return; }
    const L = this.hands.compute();
    if (L.armful || L.n >= 2) { floatText.notice('Hands full', { duration: 1.2, color: '#ffb040' }); audio.play('ui_error', { volume: 0.35, bus: 'ui' }); return; }
    if (L.n === 1 && this.inv.current) { const f = this.inv.firstFree(); if (f >= 0) this.inv.select(f); }
    this.toolOut = true;
    this.combat.cancel();
    audio.play('android_servo', { volume: 0.4 });
  }

  // the selected item's use (null = the hand is free); kept for touch / other systems
  _handItemUse() {
    const cur = this.hands.rightItem();
    return cur ? itemDef(cur.type).use || null : null;
  }

  // the old multitool item in the right hand works like the built-in one
  _mtItem() { return this._handItemUse() === 'multitool'; }

  // LMB belongs to the multitool while carrying a camp part (attach it instead of throwing it)
  _mtOwnsLmb() {
    if (!this.grab || this.grab.id == null || !this.world) return false;
    return !!this.world.props.get(this.grab.id)?.def.camp;
  }
  _mtOwnsRmb() { return this._mtOwnsLmb(); } // legacy name (touch controls)

  _endHold() {
    if (!this.holdAction) return;
    this.holdAction.end?.();
    this.holdAction = null;
  }

  toggleMultitoolMode() {
    this.mtMode = this.mtMode === 'attach' ? 'dismantle' : 'attach';
    floatText.notice(`MULTITOOL: ${this.mtMode === 'attach' ? 'ATTACH' : 'DISMANTLE'}`, { duration: 1.2, color: this.mtMode === 'attach' ? '#6fe0ff' : '#ff9a50' });
    audio.play('ui_select', { volume: 0.5, bus: 'ui' });
  }

  // hold LMB: charge + attach / detach / dismantle what is aimed at (or the carried camp part); [R] mode
  _updateMultitool(dt) {
    const tools = this.game.tools;
    if (!this.grab && input.hit('rotate')) this.toggleMultitoolMode();
    if (this.grab) {
      const p = this.world.props.get(this.grab.id);
      const pr = p && tools.mtPrompt(p, this);
      if (pr) this.focus = { kind: 'mt', target: p, prompt: pr.replace(/^.*· /, ''), hit: null };
    }
    if (input.mouseHit(0) && !this.holdAction) this.holdAction = tools.begin('multitool', null, this);
    if (this.holdAction) {
      if (!input.mouseDown(0)) this._endHold();
      else this.holdAction.tick(dt);
    }
  }

  _startUse(item, def) {
    switch (def.use) {
      case 'eat':
      case 'drink':
      case 'heal': {
        const patch = PATCH_TIME[item.type];
        const dur = patch || (item.type === 'splint' ? 2.4 : 1.3);
        this.useAction = { type: item.type, t: 0, dur, slot: this.inv.slots.indexOf(item), def, patch: !!patch };
        // patching the mechanical heart: pull it out of the chest, tape / inject it, push it back
        if (patch) this.vitals.startPatch(item.type, dur);
        const snd = def.use === 'eat' ? 'eat' : def.use === 'drink' ? 'drink' : 'bandage';
        audio.play(snd, { volume: 0.7 });
        this.world.noise.emit(this.pos, 3, 'use');
        break;
      }
      case 'flashlight': this.toggleFlashlight(); break;
      case 'battery': {
        // charges the flashlight, or (no flashlight / it is full) the multitool
        const fi = this.inv.find('flashlight');
        const fl = fi >= 0 ? this.inv.slots[fi].state : null;
        if (fl && (fl.charge ?? 1) < 0.95) { fl.charge = 1; floatText.notice('Flashlight recharged', { duration: 1.4 }); } else { this.tool.charge(0.6); floatText.notice(`Multitool charged ${Math.round(this.tool.battery * 100)}%`, { duration: 1.4, color: '#6fe0ff' }); }
        this.inv.remove(this.inv.slots.indexOf(item));
        audio.play('fuse_insert', { volume: 0.6 });
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
        const it = this.inv.remove(this.inv.slots.indexOf(item));
        this.dropItem(it, true);
        this.arms.throwKick = 1;
        audio.play('dart_throw', { volume: 0.6 });
        break;
      }
      case 'weld':
      case 'multitool':
      case 'sample':
      case 'swing':
      case 'test':
        this.holdAction = this.game.tools.begin(def.use, item, this);
        break;
      default:
        if (def.material) floatText.notice('Scrap — sell it in the crusher', { duration: 1.4 });
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
    if (ua.type === 'bandage' || ua.type === 'medkit' || ua.type === 'plasma_syringe') this.game.healthity?.say('bandaged');
    if (ua.type === 'splint') this.game.healthity?.say('splinted');
  }

  _cancelUse() {
    if (this.useAction?.patch) this.vitals.cancelPatch();
    this.useAction = null;
    this._endHold();
    this.combat?.cancel();
  }

  dropItem(item, thrown, k = 0) {
    if (!item || !this.world) return;
    const cam = engine.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const pos = cam.position.clone().addScaledVector(_fwd, 0.6);
    pos.y = Math.max(pos.y - 0.25, this.pos.y + 0.3);
    if (k) { _right.set(1, 0, 0).applyQuaternion(cam.quaternion); pos.addScaledVector(_right, ((k % 3) - 1) * 0.2).add(_v2.set(0, Math.floor(k / 3) * 0.16, 0)); }
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
    // never hidden (a light-count change recompiles every material); skip its shadow pass while off, but make
    // sure the map exists, or the shadow sampler gets bound to a plain placeholder texture
    const sh = this.flashlight.shadow;
    sh.autoUpdate = inten > 0;
    if (!sh.map && this.flashlight.castShadow && engine.renderer.shadowMap.enabled) {
      // create it now: the water reflection pass renders before the main pass (with shadow updates off)
      sh.needsUpdate = true;
      this.flashlight.updateMatrixWorld(true);
      engine.renderer.shadowMap.render([this.flashlight], engine.scene, engine.camera);
    }
    let bounce = 0;
    if (inten > 0 && this.world) {
      this._bounceT = (this._bounceT || 0) - dt;
      if (this._bounceT <= 0) {
        this._bounceT = 0.12;
        const cam = engine.camera;
        const hit = this.world.physics.raycast(cam.position, _v.set(0, 0, -1).applyQuaternion(cam.quaternion), 6, Q.world);
        this._bounceD = hit ? hit.dist : 6;
      }
      bounce = (inten / 36) * 0.45 / Math.max(0.7, this._bounceD);
    }
    this.vmFlash.intensity = damp(this.vmFlash.intensity, bounce, 10, dt);
    const held = this.hands.R.type === 'flashlight' || this.hands.L.type === 'flashlight';
    // pocketed flashlight sits on the chest: wider, dimmer
    this.flashlight.angle = held ? 0.5 : 0.62;
    if (!held) this.flashlight.intensity *= 0.65;
  }

  _refreshHeld(force = false) { if (force) this.hands.reattach(); }

  // ---------------- viewmodel ----------------
  _updateViewmodel(dt) {
    const s = this.survival;
    const ua = this.useAction;
    // eat / drink / heal progress drives the hand-to-mouth animation (patching the heart is the vitals' cradle)
    const useT = ua && !ua.patch ? Math.min(1, ua.t / ua.dur) : -1;
    const useKind = ua?.def?.use === 'drink' ? 'drink' : ua?.def?.use === 'heal' ? 'heal' : 'eat';
    this.arms.throwKick = damp(this.arms.throwKick || 0, 0, 8, dt);
    const H = this.hands, V = this.vitals, ko = !!this.combat.ko;
    H.hidden = V.busy;
    const cs = this.combat.armState();
    const sway = new THREE.Vector2(this.lookDelta?.x || 0, this.lookDelta?.y || 0);
    // camera-local acceleration (the hands lag behind when the clone speeds up, swing on when it stops)
    const aim = this.vel;
    const acc = { x: (aim.x - (this._pvx || 0)) / Math.max(dt, 1e-3), z: (aim.z - (this._pvz || 0)) / Math.max(dt, 1e-3) };
    this._pvx = aim.x; this._pvz = aim.z;
    _v.set(acc.x, 0, acc.z).applyAxisAngle(_v2.set(0, 1, 0), -this.yaw);
    const accel = { x: clamp(_v.x, -30, 30), z: clamp(_v.z, -30, 30) };
    const reach = this._updateReach();
    const st = {
      bob: this.bob, speed: this.realSpeed || 0, sprint: this.sprinting,
      watchRaised: V.busy ? 0 : this.watchRaised,
      grab: this.grab ? 1 : 0, useT, useKind, throwCharge: this.arms.throwKick,
      gripR: H.grip('R'), gripL: H.grip('L'), accel,
      punchT: cs.punchT, punchSide: cs.punchSide, punchPow: cs.punchPow, impactId: cs.impactId,
      reachR: reach?.reachR || null, reachL: reach?.reachL || null, twoHanded: !!reach?.twoHanded, gripSize: reach?.gripSize ?? 0.4, strain: reach ? this.strain : 0,
      holdingItem: !!H.R.type, holdL: !!H.L.type, armful: H.layout.armful ? 1 : 0,
      cradle: V.patchCradle, reach: V.patchReach,
      windR: cs.windR, jabR: cs.jabR, windL: cs.windL, jabL: cs.jabL,
      tremble: this.qte.active ? this.qte.intensity : 0,
      grabPower: this.grab ? clamp((this.grabPower - 0.9) / 0.8, 0, 1) : (this.arms.mtPower || 0) * 0.6,
      sway, landing: this.landKick, phase: this.stepPhase,
    };
    const armsOn = !this.dead && !ko && !this.thirdPerson && !s.sleeping && !this.terminal && !this.game.ui.customizing;
    this.arms.root.visible = armsOn;
    this.arms.update(dt, st);
    H.update(dt, { bob: this.bob, phase: this.stepPhase, sway, landing: this.landKick, visible: armsOn });
    const ui = this.game.ui;
    V.update(dt, {
      survival: s, dead: this.dead, insaneT: s.insaneT, sway, accel,
      visible: !this.dead && !s.sleeping && !this.terminal && !ui.customizing && !ui.menuOpen && !!this.world && this.game.state === 'playing',
    });
    // viewmodel lighting
    const lc = this.lightColor || new THREE.Color(0.6, 0.55, 0.45);
    this.vmHemi.color.copy(lc).multiplyScalar(1.1);
    this.vmHemi.intensity = 0.15 + Math.min(1.0, this.lightLevel * 0.8);
    this.vmDir.intensity = 0.1 + Math.min(0.8, this.lightLevel * 0.6);
  }

  _updateAvatar(dt) {
    const a = this.avatar;
    a.root.position.copy(this.pos);
    a.root.rotation.y = this.yaw;
    const show = (this.thirdPerson || !!this.game.ui.customizing) && !(this.combat.ko?.rag);
    a.root.visible = show;
    if (this._fpHidden !== !show) { this._fpHidden = !show; a.setVisibleFirstPerson?.(!show); }
    const lv = _v.set(this.vel.x, 0, this.vel.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const sp = Math.hypot(lv.x, lv.z);
    a.update(dt, {
      speed: this.realSpeed || 0,
      moveDir: new THREE.Vector2(sp > 0.01 ? lv.x / sp : 0, sp > 0.01 ? -lv.z / sp : 0),
      grounded: this.grounded, vy: this.vel.y, crouch: this.crouch, sprint: this.sprinting,
      pitch: this.pitch, talking: this.talking, holding: this.grab ? 1 : 0, holdTarget: this.grab?.target || null,
      emote: this.survival.sleeping ? 'sleep' : this.combat.swing ? 'point' : this.emote, expression: this._expression(), limp: this.survival.fracture, dead: this.dead || !!this.combat.ko,
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

  // ---------------- survival tick ----------------
  _updateSurvival(dt) {
    const s = this.survival;
    const mm = this.world.monsters;
    let near = 0;
    for (const r of this.game.remotes.values()) if (!r.dead && r.inWorld && r.pos.distanceTo(this.pos) < 8) near++;
    const lobby = this.world.type === 'lobby';
    s.update(dt, {
      sprinting: this.sprinting, moving: this.moving,
      light: Math.max(this.lightLevel ?? 1, this.flashOn ? 0.35 : 0),
      teammatesNear: near,
      monsterVisible: !!mm?.localVisible, monsterNear: mm?.localNear || 0, chased: !!mm?.localChased,
      inWater: (this.waterDepth || 0) > 0.05,
      lobby,
      dayPressure: lobby ? 0 : this.game.day?.instability?.() || 0,
      safeDay: !lobby && this.game.day?.active && this.game.day.day <= 1,
      sanityDrainMul: this._upgrade('sanity') ? 0.3 : 1, // psycho-acoustic field upgrade (game/economy.js)
    });
    if (s.dead && !this.dead) { this.onDeath(s.deathCause || 'injuries'); return; }
    // the stomach growls when hunger crosses a threshold (the old sleeve patch did this)
    if (!lobby && s.needsActive !== false) {
      this._growlCool = (this._growlCool || 0) - dt;
      const h = s.hunger, lh = this._lastHunger ?? h;
      if (([50, 30, 15].some((th) => lh > th && h <= th) || (h < 20 && this._growlCool <= 0)) && this._growlCool <= 0) {
        this._growlCool = 22;
        audio.play('_gurgle', { volume: 0.5, pitch: 0.5 });
      }
      this._lastHunger = h;
    }
    // losing it: on top of the level's own hallucinations, very low sanity makes them come thick and fast
    if (!lobby && s.sanity < 22 && !(this.game.day?.day <= 1)) {
      this._halluT = (this._halluT ?? 4) - dt;
      if (this._halluT <= 0) {
        this._halluT = 4 + Math.random() * 5 * (s.sanity / 22 + 0.3);
        this.world.level?.anomalies?._hallucinate?.(1 - s.sanity / 100);
      }
    }
    if (s.insaneT > 0) {
      const P = engine.post?.params;
      if (P) P.uGlitch.value = Math.max(P.uGlitch.value, Math.min(0.6, s.insaneT * 0.07));
      if (Math.random() < dt * 2) juice.shake(0.15);
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
    // torn apart: a huge killing blow breaks the clone into robot parts (host snaps the ragdoll apart)
    const lh = this.survival.lastHit;
    if (lh && lh.amount >= COMBAT.goreDamage && this.survival.time - lh.time < 0.6) {
      net.toHost('gore', { p: this.pos.toArray(), v: this.vel.toArray(), n: Math.min(2, lh.amount / 45) });
    }
    if ((this.survival.deathCause || cause) === 'insanity') { audio.play('scare_shriek', { volume: 0.8 }); juice.flash(0.5); }
    this.combat.cancel();
    if (this.combat.ko) { net.toHost('koEnd', {}); this.combat.ko = null; }
    this.toolOut = false;
    if (this.collider) this.collider.setEnabled(false);
    this.game.onLocalDeath?.(cause);
  }

  revive(spawn) {
    this.dead = false;
    this.survival.reset();
    this.combat.ko = null;
    this.combat.getUp = 0.6;
    this.vitals.patch = null;
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
      tk: +this.talking.toFixed(2), em: s.sleeping ? 'sleep' : this.combat.swing ? 'point' : this.emote, ex: this._expression(),
      fl: this.flashOn ? 1 : 0, it: this.hands.R.type || this._pileItem(-1), il: this.hands.L.type || this._pileItem(-2), d: this.dead ? 1 : 0,
      ko: this.combat.poseFlag || 0,
      hs: s.summary(), lp: s.fracture ? 1 : 0,
    });
  }

  // team upgrades bought in the shop (game/economy.js): 'battery' | 'carry' | 'sanity' | 'plasma'
  _upgrade(k) {
    const e = this.game.world?.level?.mission?.econ;
    try { return !!(e && !e.disposed && e.has?.('up:' + k)); } catch (err) { return false; }
  }

  // teammates see the top of an armful in the clone's hands
  _pileItem(k) {
    const L = this.hands.layout;
    return L.armful ? this.inv.slots[L.pile[L.pile.length + k]]?.type || null : null;
  }

  // a teammate is pulling us (physics grab)
  applyYank(v) {
    if (this.dead || this.combat.ko) return;
    this.yank.set(v[0], v[1], v[2]);
    if (v[1] > 0.5) this.grounded = false;
  }

  dispose() {
    this.detachWorld();
    this.arms.root.removeFromParent();
    this.inspect.dispose();
    this.hands.dispose();
    this.vitals.dispose();
  }
}
