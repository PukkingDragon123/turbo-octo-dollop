// The chassis plate on the turntable base: four bakelite dials that click through the body plan (frame,
// build, head shape) and the backpack. Each click turns the knob a notch (with overshoot), the plate's
// little card shows the setting, and the clone's body changes with a pop.
import * as THREE from 'three';
import { profile } from '../../core/profile.js';
import { COSMETICS } from '../../entities/doll/dollcos.js';
import { FM, P, css, mkCanvas } from '../../entities/doll/handpaint.js';
import { PI, TAU, V, mesh, rbox, cyl, lathe, hitBox, Spring1 } from './kit.js';
import { sfx } from './sfx.js';

const DIALS = [['frame', 'frame'], ['build', 'build'], ['skull', 'head'], ['backpack', 'pack']];

export class ChassisDials {
  constructor(cz) {
    this.cz = cz;
    const g = (this.group = new THREE.Group()); g.name = 'cz_dials';
    // a sloped plate standing on the floor in front of the turntable
    g.position.set(0.0, 0, -0.62); g.rotation.y = 0.0;
    cz.scene.add(g);
    const steel = FM.plain('cz_dialplate', 0x3f6b66, { rough: 0.6, metal: 0.3 });
    // tilted plate: card on top, knobs below, everything on its front face (local -Z)
    const pl = (this.plate = new THREE.Group()); pl.position.set(0, 0.09, 0); pl.rotation.x = -0.45; g.add(pl);
    pl.add(mesh(rbox(0.52, 0.17, 0.04, 0.012), steel));
    g.add(mesh(rbox(0.04, 0.09, 0.04, 0.01), steel, { y: 0.03, z: 0.02 }));
    this.c = mkCanvas(1024, 160);
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    pl.add(mesh(new THREE.PlaneGeometry(0.48, 0.075), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.85 }), { y: 0.038, z: -0.0205, ry: PI, cast: false }));
    this.knobs = [];
    const bak = FM.plain('cz_bakelite2', 0x2a2420, { rough: 0.35, cc: 0.6 });
    const cream = FM.plain('cz_dialmark', 0xf1e6cc, { rough: 0.5 });
    DIALS.forEach(([slot], i) => {
      const k = new THREE.Group();
      k.position.set(-0.18 + i * 0.12, -0.04, -0.02);
      k.rotation.x = -PI / 2;
      pl.add(k);
      const knob = new THREE.Group(); k.add(knob);
      knob.add(mesh(lathe([[0, 0], [0.024, 0], [0.026, 0.004], [0.022, 0.024], [0.018, 0.028], [0, 0.028]], 24), bak));
      for (let r = 0; r < 12; r++) { const a = (r / 12) * TAU; knob.add(mesh(rbox(0.004, 0.02, 0.004, 0.0015), bak, { x: Math.cos(a) * 0.024, y: 0.012, z: Math.sin(a) * 0.024, ry: -a })); }
      knob.add(mesh(rbox(0.004, 0.003, 0.016, 0.001), cream, { y: 0.029, z: -0.008 }));
      const hb = hitBox(0.07, 0.07, 0.07); k.add(hb);
      cz.hits.add(hb, { type: 'dial', i, click: () => this.turn(i), hover: () => { this.hov = i; } });
      this.knobs.push({ k, knob, s: new Spring1(0, 220, 0.35), notch: 0 });
    });
    this._draw();
  }
  _opts(slot) { return COSMETICS[slot].filter((o) => !o.unlock || profile.has(o.unlock)); }
  turn(i) {
    const [slot] = DIALS[i];
    const opts = this._opts(slot);
    const cur = opts.findIndex((o) => o.id === this.cz.cos[slot]);
    const nx = opts[(cur + 1) % opts.length];
    this.knobs[i].notch += 1;
    sfx('knob_tick', { volume: 0.6 }); sfx('robo_clunk', { volume: 0.18, pitch: 1.6 });
    this.cz.setCos({ [slot]: nx.id });
    this.cz.pop(0.7);
    this._draw();
  }
  _draw() {
    const g = this.c.getContext('2d'), w = this.c.width, h = this.c.height;
    const r = { s: 7, next() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; } };
    P.wash(g, w, h, 0xe9dcb6, { k: 0.08 });
    DIALS.forEach(([slot, label], i) => {
      const e = COSMETICS[slot].find((o) => o.id === this.cz.cos[slot]) || COSMETICS[slot][0];
      const x = (i + 0.5) * (w / 4);
      P.text(g, label, x, h * 0.3, 52, 0x6a5a48, r);
      P.text(g, e.name.toLowerCase(), x, h * 0.72, 46, 0x2e2418, r, { maxW: w / 4 - 16 });
      if (i) { g.fillStyle = css(0x8a7a60, 0.5); g.fillRect(i * (w / 4) - 1, 12, 2, h - 24); }
    });
    this.tex.needsUpdate = true;
  }
  update(dt) {
    this.knobs.forEach((K, i) => {
      K.knob.rotation.y = -K.s.step(K.notch * (TAU / 12), dt);
      K.k.position.z = -0.02 - (this.hov === i ? 0.004 : 0);
    });
    this.hov = -1;
  }
}
void V; void cyl;
