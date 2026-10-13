// Interactive static devices (vending machines, generators, lockers, terminals...).
// A device has a stable id (same on every peer), a visual root, optional static colliders,
// replicated `state`, and handlers:
//   prompt(player)            -> string | null   (shown when looked at)
//   interact(player, kind)    -> local reaction when E is pressed (default: send 'use' to host)
//   hostAction(a, data, from) -> host-side authoritative logic
//   onState(partial)          -> every peer, when state changes
//   update(dt)
import * as THREE from 'three';
import { net } from '../net/net.js';

export class Device {
  constructor(world, id, opts = {}) {
    this.world = world;
    this.id = id;
    this.state = opts.state || {};
    this.root = opts.root || new THREE.Group();
    this.colliders = [];
    this.focusPoint = opts.focusPoint || null; // world point used for prompts / distance
    this.range = opts.range ?? 2.4;
    this.holdTime = 0; // >0: E must be held this long
  }

  // add static colliders from a model collider list at this.root's transform
  addColliders(list, ud = null) {
    this.root.updateMatrixWorld(true);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    this.root.matrixWorld.decompose(pos, quat, scl);
    const res = this.world.physics.addStaticCollidersFromDesc(list, pos, quat, ud || { kind: 'device', device: this });
    this.colliders.push(...res.colliders);
    this.body = res.body;
    return res;
  }

  addBox(center, half, ud = null) {
    const c = this.world.physics.addStaticBox(center.x, center.y, center.z, half.x, half.y, half.z, ud || { kind: 'device', device: this });
    this.colliders.push(c);
    return c;
  }

  prompt() { return null; }
  interact(player, kind = 'use') { this.send(kind); }
  send(a, d = null) { net.toHost('act', { k: 'd', id: this.id, a, d }); }
  hostAction() {}
  setState(partial) {
    if (!net.isHost) return;
    net.toAll('dstate', { id: this.id, s: partial });
  }
  onState() {}
  update() {}
  serialize() { return this.state; }
  dispose() {
    for (const c of this.colliders) this.world.physics.removeCollider(c);
    if (this.body) this.world.physics.removeBody(this.body);
    this.root.removeFromParent();
  }
}
