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
    this.nextEp = 60 + Math.random() * 60;
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
    let base = lobby ? 0.02 : 0.04 + instab * 0.3;
    base += (1 - sanity) * 0.25;

    // episodes (not at HQ, not while dead)
    if (playing && !lobby && !g.local?.dead && (g.day?.day ?? 1) > 1) {
      this.nextEp -= dt * (1 + instab * 1.5);
      if (this.nextEp <= 0 && this.epT <= 0) {
        this.epDur = this.epT = 7 + Math.random() * 6;
        this.nextEp = 90 + Math.random() * 90;
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

    const target = this.forced ?? Math.min(1.0, base + this.episode * 0.6);
    this.level = damp(this.level, target, 1.5, dt);
    LIQUID.value = this.level;
    P.uLiquid.value = this.level * (lobby ? 0.5 : 1);
    // the footage looks a little more damaged while reality is melting
    P.uVHS.value = 0.22 + this.episode * 0.35;
  }
}
