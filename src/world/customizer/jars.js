// EYES station: a wooden shelf of glass jars, each holding a pair of glass eyes bobbing in cloudy liquid.
// Hover a jar: it lifts and the eyes inside turn to look at you. Click: the lid unscrews, the eyes are
// fished out (dripping), fly over and pop into the clone's sockets; its old eyes fly home to their jar.
import * as THREE from 'three';
import { profile } from '../../core/profile.js';
import { COSMETICS } from '../../entities/doll/dollcos.js';
import { buildEyeball } from '../../entities/doll/eyes.js';
import { TX, FM, P, ptex, css, shade } from '../../entities/doll/handpaint.js';
import { PI, TAU, clamp, lerp, damp, ease, easeOut, backOut, rnd, V, mesh, rbox, lathe, hitBox } from './kit.js';
import { Flyers, Drops } from './fly.js';
import { sfx, noiseHit } from './sfx.js';
import { registerStation } from './registry.js';

export const SHELF_POS = V(1.12, 0, 0.32);
const _v = V(), _q = new THREE.Quaternion();
const LIQ = [0xd8dca0, 0xc8e0d0, 0xe0d0a8, 0xd0d8e8];

function jarLabel(e, locked) {
  return ptex('cz_jarlabel_' + e.id + (locked ? '_l' : ''), 256, 128, (g, w, h, r) => {
    P.wash(g, w, h, 0xefe2c0, { k: 0.1 });
    P.blotches(g, w, h, 0x8a6a3a, r, { n: 3, r: 0.25, alpha: 0.15 });
    g.strokeStyle = css(0x6a4a2a, 0.7); g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16);
    P.text(g, e.name.toLowerCase(), w / 2, h * 0.52, 46, locked ? 0x8a8070 : 0x2e2418, r, { maxW: w * 0.84 });
    if (locked) { g.strokeStyle = css(0x8a2a20, 0.8); g.lineWidth = 5; g.beginPath(); g.moveTo(20, h - 20); g.lineTo(w - 20, 20); g.stroke(); }
  });
}

class JarShelf {
  constructor(cz) {
    this.cz = cz;
    this.group = new THREE.Group(); this.group.name = 'cz_jars';
    this.group.position.copy(SHELF_POS); this.group.rotation.y = 0.45;
    cz.scene.add(this.group);
    this.fly = new Flyers(cz.scene);
    this.drops = new Drops(cz.scene, 90, 0xdfe6b8);
    this._build();
    this.job = null;
  }
  _build() {
    const g = this.group;
    const wood = FM.paintedMetal('cz_shelfwood', TX.wood(0x8a5a34, 11), { metal: 0, rough: 0.8 });
    const W = 1.02;
    for (const y of [0.78, 1.16, 1.54]) g.add(mesh(rbox(W, 0.024, 0.2, 0.006), wood, { y }));
    for (const s of [-1, 1]) g.add(mesh(rbox(0.026, 1.6, 0.21, 0.006), wood, { x: s * (W / 2 + 0.013), y: 0.8 }));
    g.add(mesh(rbox(W + 0.05, 1.6, 0.012, 0.004), wood, { y: 0.8, z: 0.105 }));
    // a hand-lettered sign on top
    const sign = ptex('cz_eyesign', 512, 128, (c, w, h, r) => { P.wash(c, w, h, 0x3f6b66, { k: 0.15 }); P.strokes(c, w, h, 0x3f6b66, r, { n: 30, alpha: 0.15 }); P.text(c, 'spare eyes', w / 2, h / 2 + 4, 84, 0xf1e6cc, r, { slot: 'sign' }); P.edgeWear(c, w, h, r); });
    g.add(mesh(new THREE.PlaneGeometry(0.62, 0.155), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }), { y: 1.66, z: -0.03, ry: PI, cast: false }));
    const list = COSMETICS.eyes;
    this.jars = [];
    const glass = FM.glass('cz_jar', { tint: 0xc8d8d0, opacity: 0.05 });
    const jarGeo = lathe([[0, 0], [0.046, 0], [0.052, 0.008], [0.054, 0.02], [0.054, 0.118], [0.048, 0.128], [0.044, 0.132], [0.044, 0.142]], 32);
    const liqGeo = lathe([[0, 0.006], [0.048, 0.006], [0.0505, 0.02], [0.0505, 0.1], [0, 0.1]], 28);
    list.forEach((e, i) => {
      const row = i < 7 ? 0 : 1, col = i % 7;
      const J = new THREE.Group(); J.name = 'jar_' + e.id;
      J.position.set(-W / 2 + 0.075 + col * ((W - 0.15) / 6), row === 0 ? 1.172 : 0.792, -0.01);
      J.rotation.y = PI + rnd(-0.2, 0.2);
      g.add(J);
      const locked = !!e.unlock && !profile.has(e.unlock);
      const liq = new THREE.MeshPhysicalMaterial({ color: LIQ[i % 4], transparent: true, opacity: 0.16, roughness: 0.15, transmission: 0, depthWrite: false, clearcoat: 1 });
      const inner = new THREE.Group(); J.add(inner);
      const lq = mesh(liqGeo, liq, { cast: false }); lq.renderOrder = 3; inner.add(lq);
      const surf = mesh(new THREE.CircleGeometry(0.05, 28), new THREE.MeshPhysicalMaterial({ color: shade(LIQ[i % 4], 0.2), transparent: true, opacity: 0.3, roughness: 0.05, clearcoat: 1, depthWrite: false }), { y: 0.1, rx: -PI / 2, cast: false });
      surf.renderOrder = 3; inner.add(surf);
      const gl = mesh(jarGeo, glass, { cast: false }); gl.renderOrder = 4; J.add(gl);
      // lid: painted tin, knurled rim
      const lidCol = [0xc4572a, 0x3f8c8a, 0xf0bf4a, 0x6e3f6e, 0x8ea67a][i % 5];
      const lid = new THREE.Group(); lid.position.y = 0.142; J.add(lid);
      const lidMat = FM.paintedMetal('cz_lid' + (i % 5), TX.paintedSteel(lidCol, 20 + (i % 5)), { metal: 0.4 });
      lid.add(mesh(lathe([[0, 0.022], [0.04, 0.022], [0.047, 0.018], [0.048, 0.0], [0.045, -0.004], [0.044, 0.0]], 32), lidMat));
      if (locked) { lid.add(mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 16, PI), FM.bare('cz_padlock', 0xb08a40, { rough: 0.35 }), { y: 0.04 })); lid.add(mesh(rbox(0.026, 0.02, 0.012, 0.003), FM.bare('cz_padlock', 0xb08a40, { rough: 0.35 }), { y: 0.03 })); }
      // label
      const lab = mesh(new THREE.CylinderGeometry(0.0545, 0.0545, 0.04, 16, 1, true, -0.55, 1.1), new THREE.MeshStandardMaterial({ map: jarLabel(e, locked), roughness: 0.9, side: THREE.DoubleSide }), { y: 0.05, ry: PI, cast: false });
      lab.scale.x = -1;   // keep the lettering readable from outside
      J.add(lab);
      // the pair of eyes
      const eyes = [];
      for (const s of [-1, 1]) {
        const eb = buildEyeball(e.id, s < 0 ? 'L' : 'R', 0.0125 * (e.s || 1));
        eb.scale.setScalar(1.35);
        eb.position.set(s * 0.018, 0.05, 0);
        inner.add(eb);
        eyes.push({ obj: eb, ph: rnd(0, TAU), home: eb.position.clone(), look: 0, s });
      }
      const hb = hitBox(0.11, 0.17, 0.11); hb.position.y = 0.075; J.add(hb);
      this.cz.hits.add(hb, { st: 'eyes', type: 'jar', i, hover: () => { this.hoverI = i; } });
      this.jars.push({ e, J, inner, lid, eyes, locked, lift: 0, wob: 0, wobV: 0, open: 0, liqMat: liq, surf });
    });
  }
  jarOf(id) { return this.jars.find((j) => j.e.id === id); }

  click(act) {
    if (act.type !== 'jar') return;
    const jar = this.jars[act.i];
    jar.wobV += 6;
    if (jar.locked) { sfx('buzzer', { volume: 0.25 }); noiseHit({ freq: 3200, q: 8, dur: 0.06, vol: 0.2 }); return; }
    if (this.job) return;
    if (this.cz.cos.eyes === jar.e.id) { sfx('impact_glass', { volume: 0.25, pitch: 1.4 }); this.cz.pop(0.3); return; }
    this._fish(jar);
  }

  // where the clone's sockets are (world)
  _socket(S) { const b = this.cz.avatar.bones['eye' + S]; return b.getWorldPosition(V()); }
  _fish(jar) {
    const cz = this.cz;
    const old = this.jarOf(cz.cos.eyes) || null;
    this.job = { t: 0, jar, old, phase: 0 };
    sfx('bolt_turn', { volume: 0.4, pitch: 1.3 });
    sfx('squeak', { volume: 0.15, pitch: 1.6, delay: 0.1 });
  }
  update(dt, active) {
    const cz = this.cz, t = cz.t;
    this.fly.update(dt);
    this.drops.update(dt);
    const camP = cz.camera.position;
    for (let i = 0; i < this.jars.length; i++) {
      const J = this.jars[i];
      const hov = active && this.hoverI === i && !this.job;
      J.lift = damp(J.lift, hov ? 1 : J === this.job?.jar ? 1 : 0, 10, dt);
      J.wobV += (-120 * J.wob - 6 * J.wobV) * dt; J.wob += J.wobV * dt;
      J.J.position.y = (i < 7 ? 1.172 : 0.792) + J.lift * 0.025;
      J.J.position.z = -0.01 - J.lift * 0.03;
      J.J.rotation.z = J.wob * 0.05;
      J.surf.rotation.x = -PI / 2 + J.wob * 0.08 + Math.sin(t * 1.3 + i) * 0.01;
      // eyes bob in the liquid; while hovered they turn to look at the camera
      for (const E of J.eyes) {
        if (E.obj.parent !== J.inner) continue;
        E.look = damp(E.look, hov ? 1 : 0, 6, dt);
        E.obj.position.copy(E.home);
        E.obj.position.y += Math.sin(t * 1.1 + E.ph) * 0.008 + J.wob * 0.004;
        E.obj.position.x += Math.sin(t * 0.7 + E.ph * 2) * 0.003;
        // drifting rotation, blended toward a look at the camera
        const drift = _q.setFromEuler(new THREE.Euler(Math.sin(t * 0.4 + E.ph) * 0.8, t * 0.3 + E.ph, Math.cos(t * 0.33 + E.ph) * 0.4));
        E.obj.quaternion.copy(drift);
        if (E.look > 0.01) {
          E.obj.updateWorldMatrix(true, false);
          const wp = E.obj.getWorldPosition(V());
          const m = new THREE.Matrix4().lookAt(wp, camP, V(0, 1, 0));   // -Z (iris) toward the camera
          const wq = new THREE.Quaternion().setFromRotationMatrix(m);
          const pq = E.obj.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
          E.obj.quaternion.slerp(pq.multiply(wq), E.look);
        }
      }
    }
    this.hoverI = -1;
    if (this.job) this._job(dt);
  }
  _job(dt) {
    const cz = this.cz, j = this.job, J = j.jar;
    j.t += dt;
    // lid unscrews (0 .. 0.45), lifts off and tips aside
    const lidOpen = j.phase < 3 ? ease(clamp(j.t / 0.45, 0, 1)) : 1 - ease(clamp((j.t - j.closeT) / 0.4, 0, 1));
    J.lid.rotation.y = -lidOpen * TAU * 1.5;
    J.lid.position.set(lidOpen * 0.03, 0.142 + lidOpen * 0.045, 0);
    J.lid.rotation.z = -lidOpen * 0.6;
    if (j.phase === 0 && j.t > 0.45) {
      j.phase = 1;
      sfx('water_glug', { volume: 0.25, pitch: 1.4 });
      // fish the eyes out: rise out of the liquid, dripping
      j.fish = J.eyes.map((E) => ({ E, p0: E.obj.position.clone() }));
    }
    if (j.phase === 1) {
      const u = clamp((j.t - 0.45) / 0.45, 0, 1);
      for (const F of j.fish) {
        F.E.obj.position.copy(F.p0).lerp(V(F.E.s * 0.02, 0.2, 0), easeOut(u));
        if (Math.random() < 0.5) this.drops.emit(F.E.obj.getWorldPosition(V()).add(V(0, -0.012, 0)), 1, 0.05);
      }
      if (u >= 1) {
        j.phase = 2;
        sfx('throw_whoosh', { volume: 0.3, pitch: 1.5 });
        // the clone's old eyes pop out and fly home
        j.pop = 0;
        this._oldOut(j);
        for (const F of j.fish) {
          const S = F.E.s < 0 ? 'L' : 'R';
          this.fly.add(F.E.obj, {
            to: () => this._socket(S), dur: 0.62, arc: 0.18, spin: 6,
            toQ: () => this.cz.avatar.bones['eye' + S].getWorldQuaternion(new THREE.Quaternion()),
            scaleTo: 1 / 1.35 * 0.86,
            onArrive: () => { F.E.arrived = true; },
          });
        }
      }
    }
    if (j.phase === 2 && j.fish.every((F) => F.E.arrived)) {
      // pop! the new eyes are in
      j.phase = 3; j.closeT = j.t;
      for (const F of j.fish) { F.E.obj.visible = false; }
      cz.setCos({ eyes: J.e.id });
      cz.eyePop = 1;
      cz.avState.expression = 'shocked'; setTimeout(() => { cz.avState.expression = 'neutral'; }, 650);
      sfx('bubble', { volume: 0.5, pitch: 1.6 });
      sfx('impact_soft', { volume: 0.3, pitch: 1.8 });
      cz.pop(0.6);
      // put the jar's display eyes back (refilled from stock) after a beat
      setTimeout(() => { for (const F of j.fish) { J.inner.add(F.E.obj); F.E.obj.visible = true; F.E.obj.scale.setScalar(1.35); F.E.obj.position.copy(F.E.home); F.E.arrived = false; } }, 900);
    }
    if (j.phase === 3 && j.t - j.closeT > 0.45) {
      sfx('bolt_turn', { volume: 0.3, pitch: 1.5 });
      J.lid.position.set(0, 0.142, 0); J.lid.rotation.set(0, 0, 0);
      this.job = null;
    }
  }
  // the old eyes leave the sockets and plop into their jar (if it is on the shelf)
  _oldOut(j) {
    const cz = this.cz, old = j.old;
    cz.eyeOut = 1;
    if (!old) return;
    for (const S of ['L', 'R']) {
      const eb = buildEyeball(old.e.id, S, 0.0125 * (old.e.s || 1));
      cz.scene.add(eb);
      this.cz.avatar.bones['eye' + S].getWorldPosition(eb.position);
      eb.scale.setScalar(0.86);
      this.fly.add(eb, {
        to: () => old.inner.localToWorld(V(S === 'L' ? -0.018 : 0.018, 0.06, 0)), dur: 0.7, arc: 0.22, spin: -5, scaleTo: 1.35 / 0.86 * 0.86,
        onArrive: () => { eb.removeFromParent(); old.wobV += 5; sfx('splash', { volume: 0.18, pitch: 1.8 }); this.drops.emit(old.inner.localToWorld(V(0, 0.1, 0)), 6, 0.25); },
      });
    }
  }
  dispose() { }
}

registerStation('eyes', (cz) => new JarShelf(cz));
void lerp; void backOut;
