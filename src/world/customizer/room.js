// The customizer set: a warm little workshop corner in the Backrooms (yellow wallpaper, damp carpet, one
// fluorescent panel humming over a turntable), lit like a miniature diorama: warm key, cool olive fill,
// honey rim, soft haze.
import * as THREE from 'three';
import * as Mat from '../../gfx/materials.js';
import { engine } from '../../core/engine.js';
import { mesh, rbox, cyl, lathe, metreUV, V, PI, TAU } from './kit.js';
import { TX, FM, P, ptex, css, shade } from '../../entities/doll/handpaint.js';

export const ROOM = { w: 6.4, d: 5.6, h: 2.9, back: 2.3, front: -3.3 };

export function buildRoom(scene) {
  const g = new THREE.Group(); g.name = 'cz_room';
  const lowQ = engine.qualityName === 'low';
  // floor / walls / ceiling
  const floor = mesh(metreUV(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ROOM.w, ROOM.d), Mat.get('carpet'), { rx: -PI / 2, z: (ROOM.back + ROOM.front) / 2, cast: false });
  g.add(floor);
  const wall = (w, x, z, ry) => g.add(mesh(metreUV(new THREE.PlaneGeometry(w, ROOM.h), w, ROOM.h), Mat.get('wallpaper'), { x, y: ROOM.h / 2, z, ry, cast: false }));
  wall(ROOM.w, 0, ROOM.back, PI);
  wall(ROOM.d, ROOM.w / 2, (ROOM.back + ROOM.front) / 2, -PI / 2);
  wall(ROOM.d, -ROOM.w / 2, (ROOM.back + ROOM.front) / 2, PI / 2);
  const ceil = mesh(metreUV(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ROOM.w, ROOM.d), Mat.get('ceiling'), { rx: PI / 2, y: ROOM.h, z: (ROOM.back + ROOM.front) / 2, cast: false });
  g.add(ceil);
  // baseboards
  const trim = Mat.get('trim');
  for (const [w, x, z, ry] of [[ROOM.w, 0, ROOM.back - 0.012, 0], [ROOM.d, ROOM.w / 2 - 0.012, (ROOM.back + ROOM.front) / 2, PI / 2], [ROOM.d, -ROOM.w / 2 + 0.012, (ROOM.back + ROOM.front) / 2, PI / 2]]) {
    g.add(mesh(rbox(w, 0.11, 0.025, 0.006), trim, { x, y: 0.055, z, ry }));
  }
  // fluorescent panels (emissive) with a warm-white glow
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 2.2, roughness: 0.6 });
  for (const [x, z] of [[0, -0.2], [1.6, 1.2], [-1.6, 1.2]]) {
    g.add(mesh(new THREE.BoxGeometry(1.2, 0.02, 0.6), panelMat, { x, y: ROOM.h - 0.012, z, cast: false }));
    g.add(mesh(rbox(1.26, 0.03, 0.66, 0.008), Mat.get('trim'), { x, y: ROOM.h - 0.006, z, cast: false }));
  }
  // damp stains on the wall: painted decals
  const stain = ptex('cz_stain', 256, 256, (c, w, h, r) => { P.blotches(c, w, h, 0x6a5228, r, { n: 9, r: 0.22, alpha: 0.16 }); P.drips(c, w, h, 0x6a5228, r, { n: 5, y0: h * 0.35, maxLen: 0.5, wid: 0.01 }); });
  const stainMat = new THREE.MeshStandardMaterial({ map: stain, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  g.add(mesh(new THREE.PlaneGeometry(1.6, 1.4), stainMat, { x: -0.6, y: 2.1, z: ROOM.back - 0.01, ry: PI, cast: false }));
  g.add(mesh(new THREE.PlaneGeometry(1.2, 1.2), stainMat, { x: ROOM.w / 2 - 0.01, y: 1.9, z: 0.6, ry: -PI / 2, cast: false }));

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xffe7c0, 0x5a4a32, 0.42);
  g.add(hemi);
  const key = new THREE.SpotLight(0xffe0b0, 13, 9, 0.62, 0.75, 1.4);
  key.position.set(1.3, 2.75, -1.9);
  key.target.position.set(0, 0.8, 0);
  key.castShadow = !lowQ && engine.quality.shadows;
  key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  g.add(key, key.target);
  const fill = new THREE.DirectionalLight(0x9fb4a8, 0.35);
  fill.position.set(-2.5, 1.6, -1.5);
  g.add(fill);
  const rim = new THREE.SpotLight(0xffcf86, 7, 7, 0.7, 0.8, 1.5);
  rim.position.set(-1.2, 2.4, 2.0); rim.target.position.set(0, 1.0, 0);
  g.add(rim, rim.target);
  const bounce = new THREE.PointLight(0xffb870, 0.5, 3.5, 1.6);   // warm bounce off the carpet
  bounce.position.set(0, 0.25, -0.8);
  g.add(bounce);
  scene.add(g);
  return { group: g, key, rim, fill, hemi, panelMat };
}

// the turntable the clone stands on: a low wooden drum with brass studs and a painted arrow
export function buildTurntable() {
  const g = new THREE.Group(); g.name = 'cz_turntable';
  const top = new THREE.Group(); g.add(top);
  const woodTex = TX.wood(0x8a5a34, 3);
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTex, roughness: 0.78, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const base = mesh(lathe([[0, 0], [0.5, 0], [0.52, 0.012], [0.52, 0.035], [0.48, 0.045], [0, 0.045]], 48), FM.paintedMetal('cz_ttbase', TX.paintedSteel(0x3f6b66, 2)));
  g.add(base);
  const drum = mesh(lathe([[0, 0.045], [0.455, 0.045], [0.47, 0.055], [0.47, 0.095], [0.46, 0.104], [0, 0.104]], 64), wood);
  top.add(drum);
  // painted rings + arrow on the top (a texture on a disc)
  const deco = ptex('cz_ttdeco', 512, 512, (c, w, h, r) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = css(0xf1e6cc, 0.55); c.lineWidth = 6;
    c.beginPath(); c.arc(w / 2, h / 2, w * 0.44, 0, TAU); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.arc(w / 2, h / 2, w * 0.405, 0, TAU); c.stroke();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; c.lineWidth = i % 6 === 0 ? 6 : 3; c.beginPath(); c.moveTo(w / 2 + Math.cos(a) * w * 0.41, h / 2 + Math.sin(a) * w * 0.41); c.lineTo(w / 2 + Math.cos(a) * w * (i % 6 === 0 ? 0.36 : 0.385), h / 2 + Math.sin(a) * w * (i % 6 === 0 ? 0.36 : 0.385)); c.stroke(); }
    c.fillStyle = css(0xc4572a, 0.85);
    c.beginPath(); c.moveTo(w / 2, h * 0.08); c.lineTo(w / 2 + 22, h * 0.17); c.lineTo(w / 2 - 22, h * 0.17); c.closePath(); c.fill();
    P.blotches(c, w, h, 0x2a2018, r, { n: 4, r: 0.12, alpha: 0.12 });
  });
  const decoMat = new THREE.MeshStandardMaterial({ map: deco, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  top.add(mesh(new THREE.CircleGeometry(0.455, 64), decoMat, { rx: -PI / 2, y: 0.1045, ry: PI, cast: false }));
  const brass = FM.bare('cz_brass', 0xc9a65a, { rough: 0.42 });
  const stud = new THREE.SphereGeometry(0.009, 10, 6, 0, TAU, 0, PI / 2);
  for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; top.add(mesh(stud, brass, { x: Math.cos(a) * 0.463, y: 0.075, z: Math.sin(a) * 0.463, rz: -PI / 2, ry: -a })); }
  return { group: g, top };
}
void V; void cyl; void shade;
