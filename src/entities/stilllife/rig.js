// Still Lifes — bone specs, body assembly (pieces -> one skinned geometry) and per-instance skeletons.
import * as THREE from 'three';
import { fbm3, noise3, smoothstep, clamp, lin, PAL } from './core.js';
import { meshRaw, finishMesh, clusterBoxes } from './mesher.js';
import { bodyMaterial, clothMaterial, partsMaterial } from './materials.js';

// Bones are authored in model space (feet at y=0, creature faces -Z) with identity rest rotations.
export class BoneSpec {
  constructor() { this.names = []; this.parent = []; this.pos = []; this.map = new Map(); }
  add(name, parent, pos) {
    if (this.map.has(name)) throw new Error('bone exists ' + name);
    const i = this.names.length;
    this.names.push(name); this.parent.push(parent == null ? -1 : this.idx(parent)); this.pos.push(pos.slice ? pos.slice() : [pos.x, pos.y, pos.z]);
    this.map.set(name, i);
    return i;
  }
  idx(n) { const i = this.map.get(n); if (i === undefined) throw new Error('unknown bone ' + n); return i; }
  p(n) { return this.pos[this.idx(n)]; }
}

const G_LIN = lin(PAL.grime), RUST_LIN = lin(PAL.rust), FADED_LIN = lin(PAL.suitFaded), ROT_LIN = lin(PAL.burlapRot);

// Merge mesher outputs into one body geometry; bakes grime/stains/fading into vertex colours.
// look: {floor, stains, fade, seed, wetStains}
export function assembleBody(pieces, look = {}) {
  const outs = [];
  let nV = 0, nI = 0;
  const stats = [];
  for (const pc of pieces) {
    // mesh each spatially separate cluster on its own grid, share the piece's triangle budget
    const boxes = pc.clip ? [pc.clip] : clusterBoxes(pc.S, 0.04 + pc.h * 3);
    const raws = boxes.map((box) => meshRaw(pc.S, { h: pc.h, pad: pc.pad, clip: box }));
    const tot = raws.reduce((a, r) => a + r.idx.length / 3, 0);
    for (const raw of raws) {
      const tris = pc.tris ? Math.max(60, Math.round(pc.tris * (raw.idx.length / 3) / Math.max(1, tot))) : 0;
      const m = finishMesh(pc.S, raw, { tris, errScale: pc.err, aoDist: pc.aoDist });
      outs.push(m); nV += m.nV; nI += m.idx.length; stats.push(m.stats);
    }
  }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3);
  const am = new Uint8Array(nV * 4), mi = new Uint8Array(nV * 4), si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
  const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
  const floor = look.floor ?? 0.5, stains = look.stains ?? 0.6, fade = look.fade ?? 0.5, sd = look.seed ?? 1, wetSt = (look.wetStains ?? 0.5) * 0.45;
  let vo = 0, io = 0;
  for (const m of outs) {
    for (let i = 0; i < m.nV; i++) {
      const k = vo + i;
      const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      nor[k * 3] = m.nor[i * 3]; nor[k * 3 + 1] = m.nor[i * 3 + 1]; nor[k * 3 + 2] = m.nor[i * 3 + 2];
      const M = m.mats, o5 = i * 5;
      const wSk = M[o5], wSu = M[o5 + 1], wRu = M[o5 + 2], wFl = M[o5 + 3], wIn = M[o5 + 4];
      let r = m.cols[i * 3], g = m.cols[i * 3 + 1], b = m.cols[i * 3 + 2];
      let dirt = m.misc[i * 3], thin = m.misc[i * 3 + 1], wet = m.misc[i * 3 + 2];
      const ao = m.ao[i];
      // broad value variation
      const n1 = fbm3(x * 2.3 + sd, y * 2.3, z * 2.3 - sd, 3);
      const vv = 0.8 + n1 * 0.4;
      r *= vv; g *= vv; b *= vv * 0.98;
      // sun-faded / bleached hazmat patches
      if (wSu > 0.01) {
        const f = smoothstep(0.5, 0.72, fbm3(x * 3.3 - sd * 2, y * 2.1 + 7, z * 3.3, 3)) * fade * wSu;
        r += (FADED_LIN[0] - r) * f; g += (FADED_LIN[1] - g) * f; b += (FADED_LIN[2] - b) * f;
      }
      // mildew-dark rot on the burlap
      if (wSk > 0.01) {
        const f = smoothstep(0.6, 0.78, fbm3(x * 6.1 + sd, y * 6.1, z * 6.1 + 3, 3)) * 0.55 * wSk;
        r += (ROT_LIN[0] * 0.6 - r) * f; g += (ROT_LIN[1] * 0.6 - g) * f; b += (ROT_LIN[2] * 0.55 - b) * f;
      }
      // floor grime creeping up from the feet + dirt attribute
      const fg = clamp((1 - smoothstep(0.0, 0.85, y)) * floor * (0.8 + n1 * 0.4) + dirt * 0.7 * (0.4 + n1), 0, 0.92) * (1 - wIn);
      r += (G_LIN[0] - r) * fg * 0.6; g += (G_LIN[1] - g) * fg * 0.6; b += (G_LIN[2] - b) * fg * 0.6;
      // rust-brown stains (old, some still wet)
      const sN = fbm3(x * 2.7 + sd * 3, y * 2.7 - 2, z * 2.7, 4);
      const st = smoothstep(0.6, 0.7, sN + (wFl + wIn) * 0.08) * stains * (1 - wRu * 0.7);
      if (st > 0) {
        const edge = smoothstep(0.6, 0.64, sN) - smoothstep(0.64, 0.7, sN);
        const k2 = st * 0.75;
        r += (RUST_LIN[0] - r) * k2; g += (RUST_LIN[1] - g) * k2; b += (RUST_LIN[2] - b) * k2;
        r *= 1 - edge * 0.25 * stains; g *= 1 - edge * 0.3 * stains; b *= 1 - edge * 0.3 * stains;
        wet = Math.max(wet, st * wetSt * smoothstep(0.66, 0.74, sN));
        dirt = Math.max(dirt, st * 0.6);
      }
      // cavity darkening
      const cav = 0.6 + 0.4 * ao;
      col[k * 3] = r * cav; col[k * 3 + 1] = g * cav; col[k * 3 + 2] = b * cav;
      am[k * 4] = wSu * 255; am[k * 4 + 1] = wRu * 255; am[k * 4 + 2] = wFl * 255; am[k * 4 + 3] = wIn * 255;
      mi[k * 4] = ao * 255; mi[k * 4 + 1] = clamp(thin, 0, 1) * 255; mi[k * 4 + 2] = clamp(wet, 0, 1) * 255; mi[k * 4 + 3] = clamp(dirt, 0, 1) * 255;
      for (let q = 0; q < 4; q++) { si[k * 4 + q] = m.skinI[i * 4 + q]; sw[k * 4 + q] = m.skinW[i * 4 + q]; }
    }
    for (let q = 0; q < m.idx.length; q++) idx[io++] = m.idx[q] + vo;
    vo += m.nV;
  }
  // orientation check: face normals should agree with field normals
  let agree = 0, tot = 0;
  for (let t = 0; t < idx.length && tot < 400; t += 3 * 17) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nor[a * 3] + ny * nor[a * 3 + 1] + nz * nor[a * 3 + 2] > 0) agree++;
    tot++;
  }
  if (agree < tot / 2) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(am, 4, true));
  geo.setAttribute('aMisc', new THREE.BufferAttribute(mi, 4, true));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo, stats };
}

const IDENT = new THREE.Matrix4();
// Build a live instance from a cached template {spec, body, parts, cloth, bounds: Sphere}
export function instantiate(tpl, into = null) {
  const spec = tpl.spec;
  const root = into || new THREE.Group();
  const bones = spec.names.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  const byName = {};
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i], p = spec.parent[i], P = spec.pos[i];
    byName[spec.names[i]] = b;
    if (p >= 0) { const Q = spec.pos[p]; b.position.set(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]); bones[p].add(b); }
    else { b.position.set(P[0], P[1], P[2]); root.add(b); }
  }
  if (!tpl.inverses) tpl.inverses = spec.pos.map((P) => new THREE.Matrix4().makeTranslation(-P[0], -P[1], -P[2]));
  const skeleton = new THREE.Skeleton(bones, tpl.inverses.slice());
  const meshes = [];
  const mk = (geo, mat, name) => {
    if (!geo) return;
    const m = new THREE.SkinnedMesh(geo, mat);
    m.name = name;
    m.bind(skeleton, IDENT);
    m.boundingSphere = tpl.bounds.clone();
    m.castShadow = true; m.receiveShadow = true;
    root.add(m); meshes.push(m);
  };
  mk(tpl.body, bodyMaterial(), 'sl_body');
  mk(tpl.parts, partsMaterial(), 'sl_parts');
  mk(tpl.cloth, clothMaterial(), 'sl_cloth');
  // rest local positions for animation resets
  const rest = bones.map((b) => b.position.clone());
  // geometry/materials are shared per variant; only the skeleton's bone texture is per instance
  root.userData.dispose = () => skeleton.dispose();
  return { root, bones, byName, skeleton, meshes, rest };
}
