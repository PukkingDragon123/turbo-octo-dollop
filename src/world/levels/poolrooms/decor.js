// Static Poolrooms set dressing built straight into the chunk meshers (baked with the chunk):
// lifeguard chairs, slatted benches, shower columns, plant-room pipework and sand-filter tanks,
// spawn-room tile debris — and the volumetric light shafts under the skylights.
import * as THREE from 'three';
import { HEIGHT } from './layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// local -> world helper for a rotated decor item at (x, y, z) with yaw `rot`
function frame(x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (lx, ly, lz) => V(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
}

// Tall white lifeguard chair (faces local +z). Returns collider boxes [{min,max}].
export function lifeguardChair(B, x, z, rot) {
  const P = frame(x, 0, z, rot);
  const S = B.steel;
  const r = 0.03;
  // A-frame side legs
  for (const sx of [-0.42, 0.42]) {
    S.tube([P(sx, 0, -0.55), P(sx * 0.9, 1.55, -0.2), P(sx * 0.86, 2.05, -0.12)], r, 10, true);
    S.tube([P(sx, 0, 0.62), P(sx * 0.92, 1.2, 0.28), P(sx * 0.9, 1.55, 0.2)], r, 10, true);
    // feet pads
    S.lathe([[0.0, 0.0], [0.06, 0.0], [0.06, 0.02], [0.035, 0.035]], 12, new THREE.Matrix4().makeTranslation(P(sx, 0, -0.55).x, 0, P(sx, 0, -0.55).z));
    S.lathe([[0.0, 0.0], [0.06, 0.0], [0.06, 0.02], [0.035, 0.035]], 12, new THREE.Matrix4().makeTranslation(P(sx, 0, 0.62).x, 0, P(sx, 0, 0.62).z));
  }
  // ladder rungs on the front (toward +z)
  for (let k = 1; k <= 4; k++) {
    const t = k / 5;
    const y = 1.2 * t, zf = 0.62 + (0.28 - 0.62) * t;
    S.tube([P(-0.4 * (1 - t * 0.08), y, zf), P(0.4 * (1 - t * 0.08), y, zf)], 0.022, 8, true);
  }
  // cross braces at the back
  S.tube([P(-0.4, 0.3, -0.5), P(0.4, 0.9, -0.36)], 0.018, 8, true);
  S.tube([P(0.4, 0.3, -0.5), P(-0.4, 0.9, -0.36)], 0.018, 8, true);
  // seat frame + teak seat & backrest
  S.tube([P(-0.42, 1.55, -0.24), P(0.42, 1.55, -0.24)], 0.026, 8, true);
  S.tube([P(-0.42, 1.55, 0.22), P(0.42, 1.55, 0.22)], 0.026, 8, true);
  const Wd = B.wood;
  for (let k = 0; k < 5; k++) {
    const z0 = -0.24 + k * 0.092;
    const a = P(-0.45, 1.58, z0), b = P(0.45, 1.6, z0 + 0.075);
    Wd.box(V(Math.min(a.x, b.x), 1.58, Math.min(a.z, b.z)), V(Math.max(a.x, b.x), 1.61, Math.max(a.z, b.z)));
  }
  // backrest slats between the upper legs
  for (let k = 0; k < 3; k++) {
    const y = 1.75 + k * 0.1;
    const a = P(-0.4, y, -0.17), b = P(0.4, y + 0.07, -0.15);
    Wd.box(V(Math.min(a.x, b.x), y, Math.min(a.z, b.z)), V(Math.max(a.x, b.x), y + 0.07, Math.max(a.z, b.z)));
  }
  // armrests
  for (const sx of [-0.43, 0.43]) S.tube([P(sx, 1.55, 0.2), P(sx, 1.82, 0.1), P(sx, 1.85, -0.15)], 0.02, 8, true);
  // red rescue tube hanging on the side
  const R = B.rescue;
  if (R) {
    const c = P(0.5, 1.15, 0.0);
    R.roundPrism(c.x - 0.06, c.z - 0.06, c.x + 0.06, c.z + 0.06, 0.55, 1.35, 0.05, 4, { top: true, bottom: true });
  }
  const a = P(-0.5, 0, -0.62), b = P(0.5, 0, 0.66);
  return [{ min: [Math.min(a.x, b.x), 0, Math.min(a.z, b.z)], max: [Math.max(a.x, b.x), 1.65, Math.max(a.z, b.z)] }];
}

// slatted teak bench on white steel legs, along local x
export function bench(B, x, z, rot, len = 1.6) {
  const P = frame(x, 0, z, rot);
  for (let k = 0; k < 4; k++) {
    const z0 = -0.2 + k * 0.105;
    const a = P(-len / 2, 0, z0), b = P(len / 2, 0, z0 + 0.085);
    B.wood.box(V(Math.min(a.x, b.x), 0.42, Math.min(a.z, b.z)), V(Math.max(a.x, b.x), 0.455, Math.max(a.z, b.z)));
  }
  for (const sx of [-len / 2 + 0.15, len / 2 - 0.15]) {
    B.steel.tube([P(sx, 0, -0.18), P(sx, 0.41, -0.16), P(sx, 0.41, 0.16), P(sx, 0, 0.18)], 0.022, 8, true);
  }
  const a = P(-len / 2, 0, -0.22), b = P(len / 2, 0, 0.22);
  return [{ min: [Math.min(a.x, b.x), 0, Math.min(a.z, b.z)], max: [Math.max(a.x, b.x), 0.46, Math.max(a.z, b.z)] }];
}

// chrome shower column against a wall (wall behind local -z)
export function showerColumn(B, x, z, rot) {
  const P = frame(x, 0, z, rot);
  const C = B.chrome;
  C.tube([P(0, 0.9, -0.05), P(0, 2.05, -0.05), P(0, 2.12, 0.02), P(0, 2.12, 0.16)], 0.017, 10, true);
  const head = P(0, 2.08, 0.22);
  const m = new THREE.Matrix4().compose(head, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), new THREE.Vector3(1, 1, 1));
  C.lathe([[0.0, -0.03], [0.04, -0.03], [0.075, 0.0], [0.08, 0.012], [0.0, 0.016]], 18, m);
  // mixer valve
  const mv = P(0, 1.1, -0.03);
  C.lathe([[0.05, 0], [0.05, 0.02], [0.03, 0.035], [0.0, 0.04]], 16, new THREE.Matrix4().compose(mv, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), P(0, 0, 1).sub(P(0, 0, 0)).normalize()), new THREE.Vector3(1, 1, 1)));
  C.tube([P(-0.06, 1.1, 0.04), P(0.06, 1.1, 0.04)], 0.012, 8, true);
}

// plant room pipework on a wall: horizontal runs with flanges, a valve wheel and a gauge.
// (x0,z0)-(x1,z1) along the wall, n = unit normal pointing into the room
export function pipeRun(B, x0, z0, x1, z1, n, yBase = 2.15) {
  const C = B.chrome, Pp = B.pipe || B.steel;
  const off = 0.18;
  const runs = [[yBase, 0.075, Pp], [yBase + 0.26, 0.055, C], [yBase - 0.3, 0.045, Pp]];
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  for (const [y, r, M] of runs) {
    const o = off + r;
    const a = V(x0 + n[0] * o, y, z0 + n[1] * o), b = V(x1 + n[0] * o, y, z1 + n[1] * o);
    M.tube([a, b], r, 14, true);
    // flanges & brackets every ~1.5 m
    for (let s = 0.6; s < len - 0.3; s += 1.5) {
      const c = V(x0 + ux * s + n[0] * o, y, z0 + uz * s + n[1] * o);
      C.tube([V(c.x - ux * 0.02, y, c.z - uz * 0.02), V(c.x + ux * 0.02, y, c.z + uz * 0.02)], r * 1.45, 14, true);
      C.box(V(Math.min(c.x, c.x - n[0] * o) - 0.015, y - 0.015, Math.min(c.z, c.z - n[1] * o) - 0.015), V(Math.max(c.x, c.x - n[0] * o) + 0.015, y + 0.015, Math.max(c.z, c.z - n[1] * o) + 0.015));
    }
  }
  // valve wheel on the big pipe
  const vs = len * 0.35;
  const vc = V(x0 + ux * vs + n[0] * (off + 0.075), yBase + 0.12, z0 + uz * vs + n[1] * (off + 0.075));
  C.tube([V(vc.x, yBase, vc.z), vc], 0.018, 8, true);
  const wheel = new THREE.TorusGeometry(0.09, 0.012, 8, 20);
  wheel.rotateX(Math.PI / 2);
  B.red?.append(wheel, new THREE.Matrix4().makeTranslation(vc.x, vc.y + 0.01, vc.z));
  // pressure gauge
  const gc = V(x0 + ux * len * 0.7 + n[0] * (off + 0.075), yBase + 0.14, z0 + uz * len * 0.7 + n[1] * (off + 0.075));
  C.tube([V(gc.x, yBase, gc.z), gc], 0.012, 8, true);
  const gq = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(n[0], 0, n[1]));
  C.lathe([[0.0, -0.02], [0.06, -0.02], [0.065, 0.0], [0.06, 0.02], [0.0, 0.022]], 18, new THREE.Matrix4().compose(V(gc.x, gc.y + 0.06, gc.z), gq, new THREE.Vector3(1, 1, 1)));
}

// blue fibreglass sand-filter tank with domed ends, legs and a multiport valve
export function filterTank(B, x, z, h = 1.25, r = 0.38) {
  const T = B.tank || B.steel;
  T.lathe([[0.0, 0.18], [r * 0.6, 0.2], [r * 0.92, 0.26], [r, 0.34], [r, 0.18 + h - 0.16], [r * 0.92, 0.18 + h - 0.08], [r * 0.6, 0.18 + h - 0.02], [0.0, 0.18 + h]], 28, new THREE.Matrix4().makeTranslation(x, 0, z));
  const C = B.chrome;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    C.tube([V(x + Math.cos(a) * r * 0.7, 0.24, z + Math.sin(a) * r * 0.7), V(x + Math.cos(a) * r * 0.85, 0.0, z + Math.sin(a) * r * 0.85)], 0.025, 8, true);
  }
  C.lathe([[0.0, 0.0], [0.11, 0.0], [0.12, 0.06], [0.1, 0.12], [0.0, 0.13]], 18, new THREE.Matrix4().makeTranslation(x, 0.18 + h, z));
  C.tube([V(x, 0.18 + h + 0.08, z), V(x + 0.3, 0.18 + h + 0.08, z), V(x + 0.45, 0.18 + h + 0.3, z)], 0.04, 12, true);
  return [{ min: [x - r, 0, z - r], max: [x + r, 0.2 + h, z + r] }];
}

// Tube waterslide spiralling out of the ceiling into a pool. pts: centreline (THREE.Vector3[]),
// returns collider boxes for the low part of the tube and the supports.
export function waterslide(B, pts, ceilY, groundAt) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const line = curve.getSpacedPoints(90);
  const R = 0.44, r = 0.4;
  B.slide.setTint(1, 1, 1);
  B.slide.tube(line, R, 22, false);
  B.slideIn.setTint(1, 1, 1);
  B.slideIn.tube(line, r, 22, false, true);
  // flanged joints every ~1.6 m (the slide is bolted together from sections)
  let acc = 0;
  for (let i = 1; i < line.length - 1; i++) {
    acc += line[i].distanceTo(line[i - 1]);
    if (acc < 1.6) continue;
    acc = 0;
    const t = new THREE.Vector3().subVectors(line[i + 1], line[i - 1]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), t);
    B.slide.setTint(0.86, 0.9, 0.95);
    B.slide.lathe([[R + 0.001, -0.03], [R + 0.03, -0.025], [R + 0.032, 0.025], [R + 0.001, 0.03]], 22, new THREE.Matrix4().compose(line[i], q, new THREE.Vector3(1, 1, 1)));
    B.slide.setTint(1, 1, 1);
  }
  // exit lip: rolled rim joining outer and inner skins
  const e = line[line.length - 1], ep = line[line.length - 2];
  const te = new THREE.Vector3().subVectors(e, ep).normalize();
  B.slide.lathe([[r, -0.005], [r + 0.01, 0.012], [(R + r) / 2, 0.02], [R - 0.01, 0.012], [R, -0.005]], 22, new THREE.Matrix4().compose(e, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), te), new THREE.Vector3(1, 1, 1)));
  // ceiling collar where the tube disappears
  const top = line.find((p) => p.y < ceilY - 0.05) || line[0];
  B.chrome.lathe([[R + 0.02, 0.0], [R + 0.12, 0.0], [R + 0.12, -0.03], [R + 0.02, -0.03]], 24, new THREE.Matrix4().makeTranslation(top.x, ceilY - 0.002, top.z));
  // supports: steel columns from the ground to the underside at a few points
  const boxes = [];
  for (const f of [0.38, 0.62, 0.84]) {
    const p = curve.getPointAt(f);
    if (p.y < 0.9) continue;
    const g = groundAt(p.x, p.z);
    B.steel.tube([V(p.x, g, p.z), V(p.x, p.y - R + 0.02, p.z)], 0.06, 12, true);
    B.steel.lathe([[0.0, 0.0], [0.14, 0.0], [0.14, 0.02], [0.07, 0.05]], 14, new THREE.Matrix4().makeTranslation(p.x, g, p.z));
    B.steel.lathe([[0.06, 0.0], [0.2, 0.0], [0.2, 0.03], [0.0, 0.04]], 14, new THREE.Matrix4().makeTranslation(p.x, p.y - R - 0.03, p.z));
    boxes.push({ min: [p.x - 0.08, g, p.z - 0.08], max: [p.x + 0.08, p.y - R, p.z + 0.08] });
  }
  // the low run of the tube blocks movement
  for (let i = 0; i < line.length; i += 4) {
    const p = line[i];
    if (p.y > 2.2) continue;
    boxes.push({ min: [p.x - R * 0.85, p.y - R, p.z - R * 0.85], max: [p.x + R * 0.85, p.y + R, p.z + R * 0.85] });
  }
  return boxes;
}

// fallen ceiling tiles on the spawn room floor
export function tileDebris(B, x, z, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 16; k++) {
    const a = rnd() * Math.PI * 2, d = 0.3 + rnd() * 1.6;
    const w = 0.07 + rnd() * 0.12, l = 0.07 + rnd() * 0.15;
    const g = new THREE.BoxGeometry(w, 0.009, l);
    const m = new THREE.Matrix4().compose(V(x + Math.cos(a) * d, 0.005 + rnd() * 0.004, z + Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.15, rnd() * 6, (rnd() - 0.5) * 0.15)), new THREE.Vector3(1, 1, 1));
    B.wall.append(g, m);
  }
}

// ---------------------------------------------------------------------------
// Volumetric light shafts under skylights (one merged mesh per chunk, additive)
let shaftMat = null;
export function shaftMaterial(field) {
  if (shaftMat) return shaftMat;
  shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uLightTex: field.uniforms.uLightTex, uTime: field.uniforms.uTime, uStrength: { value: 0.05 } },
    vertexShader: /* glsl */`
      attribute float aCell; attribute float aH;
      uniform sampler2D uLightTex;
      varying float vH; varying vec3 vL; varying vec3 vW; varying vec3 vN;
      void main(){
        float s = 128.0;
        vec2 uv = (vec2(mod(aCell, s), floor(aCell / s)) + 0.5) / s;
        vL = texture2D(uLightTex, uv).rgb * 2.0;
        vH = aH;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uStrength;
      varying float vH; varying vec3 vL; varying vec3 vW; varying vec3 vN;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        // faces seen head-on carry the beam, grazing faces (the silhouette) fade out: soft volumetric edges
        float face = pow(abs(dot(V, normalize(vN))), 1.8);
        float fall = smoothstep(0.0, 0.6, vH) * (1.0 - smoothstep(0.86, 1.0, vH)) * (0.3 + 0.7 * vH);
        float dust = 0.8 + 0.2 * sin(vW.x * 3.1 + vW.y * 2.3 + uTime * 0.7) * sin(vW.z * 2.7 - uTime * 0.5);
        float d = length(cameraPosition - vW);
        float near = smoothstep(1.0, 4.0, d);
        vec3 c = vL * vec3(0.92, 0.98, 1.05) * face * fall * dust * near * uStrength;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return shaftMat;
}

// frustum from the skylight opening (half size h at y0) down to the floor (half size h1 at y1)
export function shaftGeometry(list) {
  const pos = [], nor = [], cell = [], hh = [], idx = [];
  for (const s of list) {
    const { x, z, y0, y1, h0, h1, key } = s;
    const corners0 = [[-h0, -h0], [h0, -h0], [h0, h0], [-h0, h0]];
    const corners1 = [[-h1, -h1], [h1, -h1], [h1, h1], [-h1, h1]];
    for (let k = 0; k < 4; k++) {
      const a0 = corners0[k], b0 = corners0[(k + 1) % 4], a1 = corners1[k], b1 = corners1[(k + 1) % 4];
      const base = pos.length / 3;
      const mx = (a0[0] + b0[0]) / 2, mz = (a0[1] + b0[1]) / 2;
      const nl = Math.hypot(mx, mz) || 1;
      for (const [p, y, hv] of [[a0, y0, 1], [b0, y0, 1], [b1, y1, 0], [a1, y1, 0]]) {
        pos.push(x + p[0], y, z + p[1]);
        nor.push(mx / nl, 0, mz / nl);
        cell.push(key);
        hh.push(hv);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export { HEIGHT };
