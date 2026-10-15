// Reality liquefaction director. One value drives both the liquid walls (baked materials: flowing wallpaper,
// rippling glossy highlights, swelling geometry) and the screen-space warp of the final post pass.
// A low baseline keeps the Backrooms quietly "breathing"; it rises with day instability and lost sanity, and
// every minute or so an episode surges in: the walls turn to liquid for a few seconds, then set again.
import { engine } from '../core/engine.js';
import { audio } from '../audio/audio.js';
import { LIQUID } from './bakedlight.js';
import { damp } from '../core/rng.js';

export class Distortion {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.episode = 0;      // current episode strength 0..1
    this.epT = 0;          // time left in the current episode
    this.epDur = 0;
    this.nextEp = 25 + Math.random() * 25;
    this.forced = null;    // debug / test override: ?liquid=0..1
    const q = new URLSearchParams(location.search).get('liquid');
    if (q !== null) this.forced = Math.max(0, Math.min(1.5, +q || 0));
  }

  update(dt) {
    const g = this.game;
    const P = engine.post.params;
    const lobby = !g.world || g.world.type === 'lobby' || g.isLobby;
    const playing = g.state === 'playing' && !!g.world;
    const sanity = playing ? (g.local?.survival?.sanity ?? 100) / 100 : 1;
    const instab = playing && !lobby ? (g.day?.instability?.() || 0) : 0;
    let base = lobby ? 0.06 : 0.16 + instab * 0.5;
    base += (1 - sanity) * 0.5;

    // episodes (not at HQ, not while dead)
    if (playing && !lobby && !g.local?.dead) {
      this.nextEp -= dt * (1 + instab * 1.5);
      if (this.nextEp <= 0 && this.epT <= 0) {
        this.epDur = this.epT = 7 + Math.random() * 6;
        this.nextEp = 45 + Math.random() * 50;
        if (audio.ready) {
          audio.play('collapse_rumble', { volume: 0.35 });
          audio.play('whisper', { volume: 0.25 });
        }
      }
    }
    if (this.epT > 0) {
      this.epT -= dt;
      const e = this.epDur - this.epT; // time into the episode
      const k = Math.min(1, e / 2.2) * Math.min(1, Math.max(0, this.epT) / 2.5);
      this.episode = k * k * (3 - 2 * k);
    } else this.episode = 0;

    const target = this.forced ?? Math.min(1.3, base + this.episode * 0.95);
    this.level = damp(this.level, target, 1.5, dt);
    LIQUID.value = this.level;
    P.uLiquid.value = this.level * (lobby ? 0.5 : 1);
    // the footage looks a little more damaged while reality is melting
    P.uVHS.value = 0.5 + this.episode * 0.5;
  }
}
