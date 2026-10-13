// Proximity voice chat over WebRTC media calls (PeerJS mesh). Each remote voice is routed
// through an HRTF panner at the speaker's head, muffled through walls; the living can't hear
// the dead (the dead hear everyone). Talking is also NOISE that monsters can hear.
import * as THREE from 'three';
import { net } from './net.js';
import { input } from '../core/input.js';
import { audio } from '../audio/audio.js';
import { engine } from '../core/engine.js';

export class Voice {
  constructor(game) {
    this.game = game;
    this.mode = 'open';
    this.stream = null;
    this.calls = new Map(); // peerId -> {call, el, src, analyser, spatial, gain}
    this.transmitting = false;
    this.level = 0;
    this.analyser = null;
    this.requesting = false;
    this.noiseT = 0;
    net.on('call', (call) => this._answer(call));
  }

  setMode(m) {
    this.mode = m;
    if (m === 'off') this._stopMic();
    else if (net.isOnline) this._ensureMic();
  }

  async _ensureMic() {
    if (this.stream || this.requesting || this.mode === 'off') return this.stream;
    if (!navigator.mediaDevices?.getUserMedia) return null;
    this.requesting = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      await audio.init();
      const src = audio.ctx.createMediaStreamSource(this.stream);
      this.analyser = audio.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      // swap the mic into calls that were set up with the silent placeholder (no renegotiation needed);
      // calls without an audio sender are closed, and the calling side re-dials them with real audio
      const track = this.stream.getAudioTracks()[0];
      for (const [id, c] of this.calls) {
        const sender = c.call.peerConnection?.getSenders?.().find((x) => x.track?.kind === 'audio');
        const redial = () => { this.remove(id); this._redial(id); };
        if (sender && track) sender.replaceTrack(track).catch(redial);
        else redial();
      }
      this.syncPeers([...this.game.roster.keys()]);
    } catch (e) {
      console.warn('[voice] microphone unavailable', e?.name || e);
      this.game.ui.toast('Microphone unavailable — voice chat is listen-only', 'warn');
    }
    this.requesting = false;
    return this.stream;
  }

  _stopMic() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.analyser = null;
  }

  _silentStream() {
    if (!audio.ctx) return null;
    if (!this._silent) {
      const dst = audio.ctx.createMediaStreamDestination();
      this._silent = dst.stream;
    }
    return this._silent;
  }

  syncPeers(ids) {
    if (!net.isOnline || !net.peer) return;
    if (this.mode !== 'off' && !this.stream && !this.requesting) { this._ensureMic(); }
    for (const id of ids) {
      if (id === net.selfId || this.calls.has(id)) continue;
      // deterministic caller to avoid double calls
      if (net.selfId < id) {
        const stream = this.stream || this._silentStream();
        if (!stream) continue;
        try {
          const call = net.peer.call(id, stream, { metadata: { voice: 1 } });
          if (call) this._setup(id, call);
        } catch (e) { /* peer not ready */ }
      }
    }
    for (const id of [...this.calls.keys()]) if (!ids.includes(id)) this.remove(id);
  }

  _answer(call) {
    const stream = this.stream || this._silentStream();
    try { call.answer(stream || undefined); } catch (e) { return; }
    this._setup(call.peer, call);
  }

  _setup(id, call) {
    const rec = { call, el: null, spatial: null, analyser: null, buf: null };
    this.calls.set(id, rec);
    call.on('stream', async (remote) => {
      this.retries?.delete(id);
      await audio.init();
      // Chrome needs the stream attached to a (muted) media element to flow into WebAudio
      const el = new Audio();
      el.muted = true;
      el.srcObject = remote;
      el.play().catch(() => {});
      rec.el = el;
      const src = audio.ctx.createMediaStreamSource(remote);
      rec.spatial = audio.makeSpatialInput({ refDistance: 1.5, maxDistance: 30, rolloff: 1.4 });
      rec.gain = audio.ctx.createGain();
      src.connect(rec.gain);
      rec.gain.connect(rec.spatial.input);
      rec.analyser = audio.ctx.createAnalyser();
      rec.analyser.fftSize = 256;
      src.connect(rec.analyser);
      rec.buf = new Float32Array(rec.analyser.fftSize);
    });
    const lost = () => {
      if (this.calls.get(id)?.call !== call) return;
      this.remove(id);
      this._redial(id);
    };
    call.on('close', lost);
    call.on('error', lost);
  }

  // the deterministic caller re-dials a dropped call while that teammate is still on the shift
  _redial(id) {
    if (!(net.selfId < id) || !this.game.roster.has(id) || this.mode === 'off') return;
    this.retries = this.retries || new Map();
    const n = (this.retries.get(id) || 0) + 1;
    if (n > 5) return;
    this.retries.set(id, n);
    setTimeout(() => { if (this.game.roster.has(id) && !this.calls.has(id)) this.syncPeers([...this.game.roster.keys()]); }, 800 * n);
  }

  remove(id) {
    const rec = this.calls.get(id);
    if (!rec) return;
    this.calls.delete(id); // first, so the call's own close event doesn't treat this as a drop
    try { rec.call.close(); } catch (e) { /* */ }
    rec.spatial?.dispose();
    if (rec.el) { rec.el.srcObject = null; }
  }

  _rms(an, buf) {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  update(dt) {
    const g = this.game;
    const l = g.local;
    // local mic level & gating
    let lvl = 0;
    if (this.stream && this.analyser) {
      const rms = this._rms(this.analyser, this.buf);
      lvl = Math.min(1, Math.max(0, (rms - 0.012) * 14));
      const ptt = this.mode === 'ptt';
      const allow = ptt ? input.down('talk') : this.mode === 'open';
      for (const t of this.stream.getAudioTracks()) t.enabled = allow;
      this.transmitting = allow && (ptt || lvl > 0.08);
      if (!allow) lvl = 0;
    } else this.transmitting = false;
    this.level += (lvl - this.level) * Math.min(1, dt * 12);
    l.talking = this.level;
    // talking is noise (monsters hear the living)
    this.noiseT -= dt;
    if (g.world && !l.dead && this.level > 0.25 && this.noiseT <= 0) {
      this.noiseT = 0.5;
      if (net.isHost) g.world.noise.emit(l.pos, 4 + this.level * 10, 'voice');
    }
    // remote voices
    for (const [id, rec] of this.calls) {
      if (!rec.spatial) continue;
      const r = g.remotes.get(id);
      if (!r) continue;
      const head = r.pos.clone().setY(r.pos.y + 1.1);
      rec.spatial.setPosition(head);
      // living can't hear the dead; the dead hear everyone
      const audible = l.dead || !r.dead;
      rec.gain.gain.setTargetAtTime(audible ? 1 : 0, audio.ctx.currentTime, 0.1);
      // walls muffle
      let occ = 0;
      if (g.world && !l.dead) occ = g.world.physics.lineOfSight(engine.camera.position, head) ? 0 : 0.75;
      rec.spatial.setOcclusion(occ);
      r.voiceLevel = audible ? Math.min(1, Math.max(0, (this._rms(rec.analyser, rec.buf) - 0.01) * 14)) : 0;
    }
  }
}

export { THREE };
