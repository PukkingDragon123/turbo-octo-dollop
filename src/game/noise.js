// Sound-propagation "noise" events that monsters listen to. Every footstep, impact, generator,
// weld spark, voice and alarm calls world.noise.emit(pos, loudness, kind).
// loudness ~ hearing radius in meters for an average listener.
import * as THREE from 'three';

export class NoiseSystem {
  constructor() {
    this.events = [];
    this.time = 0;
  }
  emit(pos, loudness, kind = 'generic', sourceId = null) {
    if (loudness <= 0) return;
    this.events.push({ pos: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z), loudness, kind, t: this.time, sourceId });
    if (this.events.length > 64) this.events.shift();
  }
  update(dt) {
    this.time += dt;
    // keep 4 seconds of history
    while (this.events.length && this.time - this.events[0].t > 4) this.events.shift();
  }
  // loudest recent event perceived by a listener (accounts for distance & age)
  loudestFor(listenerPos, hearingMul = 1, since = 0) {
    let best = null, bestScore = 0;
    for (const e of this.events) {
      if (e.t < since) continue;
      const d = e.pos.distanceTo(listenerPos);
      const age = this.time - e.t;
      const score = (e.loudness * hearingMul - d) * (1 - age / 4);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best ? { event: best, score: bestScore } : null;
  }
}
