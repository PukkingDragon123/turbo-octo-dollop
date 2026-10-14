// R.O.O.M. — Healthity: a cute floating spherical medical robot (~0.28 m) built like a premium
// little corporate gadget: glossy ceramic shell (white over a mint medical band, split by a real
// seam groove, panel lines, printed decals), a recessed curved glass visor in a rubber gasket with
// an LED-matrix pixel face behind it, speaker pods with tiny screws, a blinking antenna, a brushed
// metal hover thruster with a soft glow, two little side thrusters and two floating paddle hands.
//
// buildHealthity() -> { root, setFace(expr), setTalking(bool), update(dt), screen }
//   expressions: happy neutral worried alarmed sleepy dead love glitch wink angry
//   root origin = centre of the sphere (the hover point). The body bobs/tilts inside root.
//   The face looks down +Z: game code aims the root at the camera with Object3D.lookAt (+Z).
// Geometry, textures and materials are cached and shared; per instance only the face screen
// (canvas texture) and the animated emissive bits are unique.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const PI = Math.PI, TAU = PI * 2;
export const HEALTHITY_FACES = ['happy', 'neutral', 'worried', 'alarmed', 'sleepy', 'dead', 'love', 'glitch', 'wink', 'angry'];
const R0 = 0.14;
const GW = 32, GH = 24, CELL = 12; // LED matrix (cells) and canvas pixels per cell
const FACE_COL = { happy: '#59f7e6', neutral: '#59f7e6', worried: '#7fd8ff', alarmed: '#ffd84a', sleepy: '#4fb8c8', dead: '#6a8d8a', love: '#ff78b8', glitch: '#59f7e6', wink: '#59f7e6', angry: '#ff5a46' };
// visor: rounded rectangle on the sphere, in angles around the (slightly up-tilted) visor axis
const VIS = { ax: 0.9, ay: 0.6, n: 4.4, tilt: 0.13 };
const Y_SEAM = -0.083; // white shell / mint band split
const POD_R = 0.047; // speaker pod radius

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

const _cache = new Map();
const cached = (k, fn) => { if (!_cache.has(k)) _cache.set(k, fn()); return _cache.get(k); };
const qVis = new THREE.Quaternion().setFromEuler(new THREE.Euler(-VIS.tilt, 0, 0));

function visEdge(phi) {
  const c = Math.abs(Math.cos(phi)) / VIS.ax, s = Math.abs(Math.sin(phi)) / VIS.ay;
  return 1 / Math.pow(Math.pow(c, VIS.n) + Math.pow(s, VIS.n), 1 / VIS.n);
}
// direction for visor-polar angles (alpha from the visor axis, phi around it), model space
const _vd = new THREE.Vector3();
function visDir(alpha, phi, out = _vd) {
  return out.set(Math.sin(alpha) * Math.cos(phi), Math.sin(alpha) * Math.sin(phi), Math.cos(alpha)).applyQuaternion(qVis);
}

function finish(g) {
  g.computeBoundingSphere();
  g.userData.shared = true;
  return g;
}
// make triangles face along `ref(p)` (or the vertex normal) using a triangle from the middle
function fixWinding(g, ref = null) {
  const P = g.attributes.position, I = g.index.array, N = g.attributes.normal;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), r = new THREE.Vector3();
  let score = 0;
  for (let t = Math.floor(I.length / 6) * 3; t < I.length && t < Math.floor(I.length / 6) * 3 + 300; t += 3) {
    a.fromBufferAttribute(P, I[t]); b.fromBufferAttribute(P, I[t + 1]); c.fromBufferAttribute(P, I[t + 2]);
    const n = b.sub(a).cross(c.sub(a));
    if (n.lengthSq() < 1e-16) continue;
    if (ref) ref(a, r); else r.fromBufferAttribute(N, I[t]);
    score += Math.sign(n.dot(r));
  }
  if (score < 0) for (let i = 0; i < I.length; i += 3) { const tt = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = tt; }
  return g;
}

// ---------------------------------------------------------------------------
// Shell: visor-centred polar grid (exact visor opening), UV (phi, t) for the baked texture
// ---------------------------------------------------------------------------
const SH_M = 72, SH_N = 34;
function shellGeometry() {
  return cached('hl_shellGeo', () => {
    const pos = [], nor = [], uv = [], idx = [];
    const v = new THREE.Vector3();
    for (let j = 0; j <= SH_M; j++) {
      const phi = (j / SH_M) * TAU, a0 = visEdge(phi);
      for (let k = 0; k <= SH_N; k++) {
        const t = k / SH_N;
        const a = a0 + (PI - a0) * (1 - Math.pow(1 - t, 1.15));
        visDir(Math.min(a, PI - 1e-4), phi, v);
        pos.push(v.x * R0, v.y * R0, v.z * R0);
        nor.push(v.x, v.y, v.z);
        uv.push(j / SH_M, t);
      }
    }
    const row = SH_N + 1;
    for (let j = 0; j < SH_M; j++) for (let k = 0; k < SH_N; k++) {
      const a = j * row + k, b = (j + 1) * row + k, c = a + 1, d = b + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    fixWinding(g);
    return finish(g);
  });
}

// Baked shell maps (CPU, once): albedo, roughness, normal from a height field of seams/decals.
function decalCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  return ctx.getImageData(0, 0, w, h);
}
function shellMaps() {
  return cached('hl_shellMaps', () => {
    const W = 1024, H = 512;
    const alb = new Uint8Array(W * H * 4), rgh = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
    const hgt = new Float32Array(W * H);
    const text = decalCanvas(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 74px "Arial Rounded MT Bold", Arial, Helvetica, sans-serif';
      ctx.fillText('HEALTHITY', w / 2, 52);
      ctx.font = 'bold 26px Arial, Helvetica, sans-serif';
      ctx.fillText('R.O.O.M. MEDICAL UNIT  HLT-3412', w / 2, 108);
    });
    const label = decalCanvas(256, 96, (ctx, w, h) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.fillRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = '#000'; ctx.fillRect(12, 12, w - 24, h - 24);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
      ctx.fillText('DO NOT', w / 2 + 22, 36);
      ctx.fillText('SUBMERGE', w / 2 + 22, 66);
      ctx.beginPath(); ctx.moveTo(40, 22); ctx.lineTo(62, 70); ctx.lineTo(18, 70); ctx.closePath(); ctx.fill();
    });
    const sampleA = (img, u, v) => {
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
      const x = Math.floor(u * img.width), y = Math.floor(v * img.height);
      return img.data[(y * img.width + x) * 4] / 255;
    };
    // decal frames (centre direction, local axes) in model space
    const frameAt = (dir, upHint = new THREE.Vector3(0, 1, 0)) => {
      const n = dir.clone().normalize();
      const e1 = new THREE.Vector3().crossVectors(upHint, n).normalize(); // right
      const e2 = new THREE.Vector3().crossVectors(n, e1).normalize(); // up
      return { n, e1, e2 };
    };
    const crossF = frameAt(new THREE.Vector3(0, 0.84, -0.54), new THREE.Vector3(0, 0, -1));
    const textF = frameAt(new THREE.Vector3(0, 0.22, -1));
    const labelF = frameAt(new THREE.Vector3(-0.55, -0.62, -0.56));
    const P = new THREE.Vector3(), D = new THREE.Vector3();
    const WHITE = [0.86, 0.875, 0.865], MINT = [0.33, 0.71, 0.63], GROOVE = [0.05, 0.08, 0.08];
    const RED = [0.82, 0.05, 0.05], INK = [0.11, 0.33, 0.31], YEL = [0.95, 0.72, 0.05];
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let y = 0; y < H; y++) {
      const t = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W, phi = u * TAU, a0 = visEdge(phi);
        const a = a0 + (PI - a0) * (1 - Math.pow(1 - t, 1.15));
        visDir(Math.min(a, PI - 1e-4), phi, D);
        P.copy(D).multiplyScalar(R0);
        let r = WHITE[0], g = WHITE[1], b = WHITE[2], h = 0, ro = 0.17;
        // two-tone split + seam groove
        const mint = sstep(Y_SEAM + 0.0004, Y_SEAM - 0.0004, P.y);
        r = lerp(r, MINT[0], mint); g = lerp(g, MINT[1], mint); b = lerp(b, MINT[2], mint);
        const gs = 1 - sstep(0.0007, 0.0017, Math.abs(P.y - Y_SEAM));
        h -= gs * 0.9;
        // panel lines: crown band, back spine, ring around the visor, rings around the pods
        let pl = 0;
        if (P.y > Y_SEAM + 0.004) pl = Math.max(pl, 1 - sstep(0.0003, 0.0008, Math.abs(P.z + 0.043)));
        if (P.z < -0.043 && P.y > Y_SEAM + 0.004) pl = Math.max(pl, 1 - sstep(0.0003, 0.0008, Math.abs(P.x)));
        pl = Math.max(pl, 1 - sstep(0.0004, 0.0011, Math.abs((a - a0) - 0.06) * R0));
        const podB = Math.acos(clamp(Math.abs(D.x), -1, 1)), podE = Math.asin(POD_R / R0) + 0.035;
        pl = Math.max(pl, 1 - sstep(0.0003, 0.0009, Math.abs(podB - podE) * R0));
        h -= pl * 0.5;
        const dark = Math.max(gs, pl * 0.75);
        r = lerp(r, GROOVE[0], dark); g = lerp(g, GROOVE[1], dark); b = lerp(b, GROOVE[2], dark);
        ro = lerp(ro, 0.55, dark);
        // red cross decal (top-back)
        {
          const dl = D.dot(crossF.n);
          if (dl > 0.9) {
            const lx = D.dot(crossF.e1) * R0, ly = D.dot(crossF.e2) * R0;
            const arm = 0.0165, wd = 0.0055;
            const inC = (Math.abs(lx) < wd && Math.abs(ly) < arm) || (Math.abs(ly) < wd && Math.abs(lx) < arm);
            const ring = Math.abs(Math.hypot(lx, ly) - 0.025) < 0.0012;
            if (inC) { r = RED[0]; g = RED[1]; b = RED[2]; ro = 0.22; h += 0.08; }
            else if (ring) { r = lerp(r, RED[0], 0.85); g = lerp(g, RED[1], 0.85); b = lerp(b, RED[2], 0.85); }
          }
        }
        // printed name on the back
        {
          const dl = D.dot(textF.n);
          if (dl > 0.8) {
            const lx = D.dot(textF.e1) * R0, ly = D.dot(textF.e2) * R0;
            const tw = 0.105, th = tw / 4;
            const k = sampleA(text, 0.5 + lx / tw, 0.5 - ly / th);
            if (k > 0) { r = lerp(r, INK[0], k); g = lerp(g, INK[1], k); b = lerp(b, INK[2], k); ro = lerp(ro, 0.3, k); }
          }
        }
        // warning sticker on the mint band
        {
          const dl = D.dot(labelF.n);
          if (dl > 0.9) {
            const lx = D.dot(labelF.e1) * R0, ly = D.dot(labelF.e2) * R0;
            const lw = 0.034, lh = lw * 96 / 256;
            const lu = 0.5 + lx / lw, lv = 0.5 - ly / lh;
            if (lu > 0 && lu < 1 && lv > 0 && lv < 1) {
              const k = sampleA(label, lu, lv);
              r = lerp(YEL[0], 0.02, k); g = lerp(YEL[1], 0.02, k); b = lerp(YEL[2], 0.02, k); ro = 0.4; h += 0.05;
            }
          }
        }
        // ceramic micro-variation, faint hairline scratches, grime in the grooves
        const nz = hash(x * 0.37, y * 0.71);
        r *= 0.985 + 0.02 * nz; g *= 0.985 + 0.02 * nz; b *= 0.985 + 0.02 * nz;
        const scr = Math.abs(Math.sin(x * 0.11 + y * 0.31 + 5 * Math.sin(y * 0.013)) ) < 0.004 && hash(Math.floor(x / 40), Math.floor(y / 40)) > 0.75 ? 1 : 0;
        ro += scr * 0.12 + nz * 0.025;
        const i = y * W + x;
        hgt[i] = h;
        alb[i * 4] = Math.round(Math.pow(clamp(r, 0, 1), 1 / 2.2) * 255);
        alb[i * 4 + 1] = Math.round(Math.pow(clamp(g, 0, 1), 1 / 2.2) * 255);
        alb[i * 4 + 2] = Math.round(Math.pow(clamp(b, 0, 1), 1 / 2.2) * 255);
        alb[i * 4 + 3] = 255;
        rgh[i * 4] = 255; rgh[i * 4 + 1] = Math.round(clamp(ro, 0, 1) * 255); rgh[i * 4 + 2] = 0; rgh[i * 4 + 3] = 255;
      }
    }
    // normal map from the height field (texel size varies over the polar grid)
    for (let y = 0; y < H; y++) {
      const t = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W, a0 = visEdge(u * TAU);
        const a = a0 + (PI - a0) * (1 - Math.pow(1 - t, 1.15));
        const du = Math.max(1e-4, R0 * Math.sin(a) * TAU / W), dv = Math.max(1e-4, R0 * (PI - a0) * 1.15 * Math.pow(1 - t, 0.15) / H);
        const hl = hgt[y * W + ((x + W - 1) % W)], hr = hgt[y * W + ((x + 1) % W)];
        const hd = hgt[Math.max(0, y - 1) * W + x], hu = hgt[Math.min(H - 1, y + 1) * W + x];
        const k = 0.00045; // groove depth scale (m per height unit)
        let nx = -(hr - hl) * k / (2 * du), ny = -(hu - hd) * k / (2 * dv);
        const l = Math.hypot(nx, ny, 1);
        const i = (y * W + x) * 4;
        nrm[i] = Math.round((nx / l * 0.5 + 0.5) * 255); nrm[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255); nrm[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nrm[i + 3] = 255;
      }
    }
    const tex = (data, srgb) => {
      const tx = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
      tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tx.wrapS = THREE.RepeatWrapping; tx.wrapT = THREE.ClampToEdgeWrapping;
      tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter;
      tx.generateMipmaps = true; tx.anisotropy = 8; tx.flipY = false; tx.needsUpdate = true;
      return tx;
    };
    return { map: tex(alb, true), rough: tex(rgh, false), normal: tex(nrm, false) };
  });
}

// ---------------------------------------------------------------------------
// Visor: rubber gasket ring + curved glass screen (planar UVs for the face canvas)
// ---------------------------------------------------------------------------
const GLASS_R = R0 - 0.0062;
function gasketGeometry() {
  return cached('hl_gasketGeo', () => {
    const pos = [], uv = [], idx = [];
    const M = 96, v = new THREE.Vector3();
    const rings = [[R0 + 0.0006, 1.0], [R0 - 0.0012, 0.996], [R0 - 0.0045, 0.988], [GLASS_R - 0.001, 0.985]];
    for (let j = 0; j <= M; j++) {
      const phi = (j / M) * TAU, a0 = visEdge(phi);
      for (const [rr, ak] of rings) {
        visDir(a0 * ak, phi, v);
        pos.push(v.x * rr, v.y * rr, v.z * rr);
        uv.push(0.03, 0.03);
      }
    }
    const nR = rings.length;
    for (let j = 0; j < M; j++) for (let k = 0; k < nR - 1; k++) {
      const a = j * nR + k, b = (j + 1) * nR + k;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(qVis);
    fixWinding(g, (p, out) => out.copy(axis));
    g.computeVertexNormals();
    return finish(g);
  });
}

function screenGeometry() {
  return cached('hl_screenGeo', () => {
    const pos = [], nor = [], uv = [], idx = [];
    const M = 64, N = 12, v = new THREE.Vector3();
    const hw = Math.sin(VIS.ax) * GLASS_R * 0.93, hh = Math.sin(VIS.ay) * GLASS_R * 0.93;
    const inv = qVis.clone().invert();
    for (let j = 0; j <= M; j++) {
      const phi = (j / M) * TAU, a0 = visEdge(phi) * 0.985;
      for (let k = 0; k <= N; k++) {
        const a = a0 * (k / N);
        visDir(a, phi, v);
        pos.push(v.x * GLASS_R, v.y * GLASS_R, v.z * GLASS_R);
        nor.push(v.x, v.y, v.z);
        const lv = v.clone().applyQuaternion(inv).multiplyScalar(GLASS_R);
        uv.push(0.5 + lv.x / (2 * hw), 0.5 + lv.y / (2 * hh));
      }
    }
    const row = N + 1;
    for (let j = 0; j < M; j++) for (let k = 0; k < N; k++) {
      const a = j * row + k, b = (j + 1) * row + k;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    fixWinding(g);
    return finish(g);
  });
}

// ---------------------------------------------------------------------------
// Small parts (lathes), merged per material
// ---------------------------------------------------------------------------
function lathe(profile, seg, axis = 'y', tf = null) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), seg);
  if (axis === 'x') g.rotateZ(-PI / 2); // lathe Y -> +X
  if (tf) g.applyMatrix4(tf);
  return g;
}
function colorize(g, rgb) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function clean(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.color) colorize(g, [1, 1, 1]);
  return g.index ? g : (() => { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); return g; })();
}
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

function partsGeometry() {
  return cached('hl_parts', () => {
    const plastic = [], metal = [], rubber = [];
    const MINT = lin(0x5fc7b3), WHITE = lin(0xeef1ee);
    const M4 = new THREE.Matrix4();
    // speaker pods on both sides (axis +-X)
    const a0 = Math.sqrt(R0 * R0 - POD_R * POD_R) - 0.004;
    for (const s of [-1, 1]) {
      const flip = s < 0 ? new THREE.Matrix4().makeRotationY(PI) : new THREE.Matrix4();
      const T = (m) => m.premultiply(flip);
      plastic.push(colorize(lathe([[POD_R + 0.001, a0], [POD_R + 0.0008, a0 + 0.006], [0.0462, a0 + 0.0102], [0.0435, a0 + 0.0128], [0.0395, a0 + 0.0138], [0.0345, a0 + 0.0138], [0.0318, a0 + 0.0134], [0.0308, a0 + 0.0122]], 48, 'x', T(new THREE.Matrix4())), MINT));
      metal.push(lathe([[0.0352, a0 + 0.0133], [0.0346, a0 + 0.0142], [0.0326, a0 + 0.0144], [0.0312, a0 + 0.0136]], 48, 'x', T(new THREE.Matrix4())));
      // grille disc (perforated, rubber material uses the grille texture)
      const gd = new THREE.CircleGeometry(0.0305, 40);
      gd.rotateY(PI / 2); gd.translate(a0 + 0.0124, 0, 0);
      const uvA = gd.attributes.uv; // planar uv already 0..1 over the disc
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, 0.5 + (uvA.getX(i) - 0.5) * 0.98, 0.5 + (uvA.getY(i) - 0.5) * 0.98);
      gd.applyMatrix4(flip);
      rubber.push(gd);
      // tiny screws on the pod face
      for (let k = 0; k < 4; k++) {
        const ang = PI / 4 + (k * PI) / 2;
        const sg = new THREE.SphereGeometry(0.0026, 8, 4, 0, TAU, 0, PI / 2);
        sg.scale(1, 0.45, 1);
        sg.rotateZ(-PI / 2);
        sg.translate(a0 + 0.0139, Math.sin(ang) * 0.0372, Math.cos(ang) * 0.0372);
        sg.applyMatrix4(flip);
        metal.push(sg);
      }
    }
    // hover thruster (bottom)
    metal.push(lathe([[0, -0.132], [0.026, -0.1335], [0.035, -0.139], [0.0412, -0.1478], [0.0445, -0.1495], [0.0465, -0.1485], [0.05, -0.142], [0.0545, -0.131], [0.0565, -0.121], [0.0545, -0.112]], 48));
    plastic.push(colorize(lathe([[0.0565, -0.1265], [0.0582, -0.1255], [0.0582, -0.1225], [0.0565, -0.1215]], 48), MINT));
    // little side thrusters
    for (const s of [-1, 1]) {
      const dir = new THREE.Vector3(s * 0.68, -0.6, -0.1).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      M4.compose(dir.clone().multiplyScalar(R0 - 0.004), q, new THREE.Vector3(1, 1, 1));
      metal.push(lathe([[0, -0.011], [0.0072, -0.0128], [0.0092, -0.0145], [0.0102, -0.013], [0.0122, -0.004], [0.0118, 0.004]], 20, 'y', M4.clone()));
    }
    // antenna: ball joint + rod + collar
    {
      const base = new THREE.Vector3(0.042, 0, -0.026); base.y = Math.sqrt(R0 * R0 - base.x * base.x - base.z * base.z) - 0.002;
      const ball = new THREE.SphereGeometry(0.0078, 16, 10); ball.translate(base.x, base.y, base.z); metal.push(ball);
      const rod = new THREE.CylinderGeometry(0.0021, 0.0026, 0.058, 10, 1); rod.translate(0, 0.029, 0);
      rod.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.32)); rod.translate(base.x, base.y + 0.004, base.z); metal.push(rod);
      const col = new THREE.TorusGeometry(0.0036, 0.0012, 6, 16); col.rotateX(PI / 2); col.translate(0, 0.045, 0);
      col.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.32)); col.translate(base.x, base.y + 0.004, base.z); metal.push(col);
    }
    const merge = (list) => finish(mergeGeometries(list.map(clean)));
    rubber.push(gasketGeometry().clone());
    return { plastic: merge(plastic), metal: merge(metal), rubber: merge(rubber) };
  });
}

// floating paddle hand: white mitten with a mint cuff (local origin = magnet joint)
function handGeometry() {
  return cached('hl_hand', () => {
    const MINT = lin(0x5fc7b3), WHITE = lin(0xeef1ee);
    const cuff = colorize(lathe([[0.021, -0.02], [0.0225, -0.016], [0.0215, -0.006], [0.017, 0.0], [0, 0.002]], 20), MINT);
    const mit = colorize(lathe([[0, -0.0745], [0.014, -0.072], [0.023, -0.062], [0.0262, -0.048], [0.025, -0.032], [0.021, -0.02]], 22), WHITE);
    mit.scale(1, 1, 0.72);
    const thumb = colorize(new THREE.SphereGeometry(0.0105, 14, 10), WHITE);
    thumb.scale(1, 1.5, 0.8); thumb.translate(0.021, -0.04, 0);
    return finish(mergeGeometries([cuff, mit, thumb].map(clean)));
  });
}

// ---------------------------------------------------------------------------
// Materials (shared unless animated)
// ---------------------------------------------------------------------------
function grilleTexture() {
  return cached('hl_grille', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a2122'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#030505';
    for (let ring = 0; ring < 6; ring++) {
      const r = 8 + ring * 9.5, n = Math.max(1, Math.round((TAU * r) / 9));
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + ring * 0.3; ctx.beginPath(); ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2.3, 0, TAU); ctx.fill(); }
    }
    ctx.beginPath(); ctx.arc(64, 64, 3, 0, TAU); ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}
const shellMat = () => cached('hl_shellMat', () => {
  const T = shellMaps();
  const m = new THREE.MeshPhysicalMaterial({
    name: 'hl_shell', map: T.map, roughnessMap: T.rough, normalMap: T.normal, normalScale: new THREE.Vector2(1, 1),
    roughness: 1, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
  });
  return m;
});
const plasticMat = () => cached('hl_plastic', () => new THREE.MeshPhysicalMaterial({ name: 'hl_plastic', color: 0xffffff, vertexColors: true, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }));
const metalMat = () => cached('hl_metal', () => new THREE.MeshStandardMaterial({ name: 'hl_metal', color: 0xc9ced3, roughness: 0.28, metalness: 1, envMapIntensity: 1.3 }));
const rubberMat = () => cached('hl_rubber', () => new THREE.MeshStandardMaterial({ name: 'hl_rubber', color: 0xffffff, map: grilleTexture(), roughness: 0.6, metalness: 0.1 }));

// --- pixel painter -------------------------------------------------------------
class Pix {
  constructor() { this.g = new Uint8Array(GW * GH); }
  clear() { this.g.fill(0); }
  set(x, y, v = 1) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < GW && y < GH) this.g[y * GW + x] = v; }
  rect(x0, y0, w, h) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.set(x0 + x, y0 + y); }
  oval(cx, cy, rx, ry) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx + 0.6) + (y * y) / (ry * ry + 0.6) <= 1) this.set(cx + x, cy + y); }
  ring(cx, cy, r) { for (let a = 0; a < TAU; a += 0.12) this.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  line(x0, y0, x1, y1) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) this.set(lerp(x0, x1, i / n), lerp(y0, y1, i / n)); }
  arc(cx, cy, r, a0, a1, sy = 1) { const n = Math.ceil(r * Math.abs(a1 - a0) * 1.5) + 2; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); this.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy); } }
  heart(cx, cy) { const H = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']; H.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') this.set(cx - 3 + x, cy - 3 + y); })); }
  x(cx, cy, r) { this.line(cx - r, cy - r, cx + r, cy + r); this.line(cx - r, cy + r, cx + r, cy - r); }
}

function drawFace(P, expr, st) {
  P.clear();
  const ex = [9, 22], ey = 9;
  const blink = st.blink > 0;
  const eyeOval = (i, rx = 3, ry = 4) => { if (blink) { P.line(ex[i] - 3, ey + 1, ex[i] + 3, ey + 1); P.line(ex[i] - 3, ey + 2, ex[i] + 3, ey + 2); } else P.oval(ex[i], ey, rx, ry); };
  const mouthTalk = () => { const o = st.talkOpen; if (o < 0.2) P.rect(12, 17, 8, 2); else P.oval(15.5, 18, 2 + Math.round(o * 2), Math.max(1, Math.round(o * 3.5))); };
  switch (expr) {
    case 'happy':
      for (const i of [0, 1]) { P.arc(ex[i], ey + 3, 4, PI * 1.1, PI * 1.9); P.arc(ex[i], ey + 4, 4, PI * 1.15, PI * 1.85); }
      if (st.talking) mouthTalk(); else { P.arc(15.5, 13, 6, PI * 0.15, PI * 0.85); P.arc(15.5, 14, 6, PI * 0.2, PI * 0.8); }
      P.rect(3, 14, 3, 2); P.rect(26, 14, 3, 2);
      break;
    case 'neutral':
      eyeOval(0); eyeOval(1);
      if (st.talking) mouthTalk(); else P.rect(12, 17, 8, 2);
      break;
    case 'worried':
      eyeOval(0, 2, 2); eyeOval(1, 2, 2);
      P.line(7, 5, 11, 4); P.line(20, 4, 24, 5);
      if (st.talking) mouthTalk(); else for (let x = 11; x <= 20; x++) P.set(x, 18 + Math.round(Math.sin(x * 1.3) * 0.7));
      break;
    case 'alarmed':
      for (const i of [0, 1]) { P.ring(ex[i], ey, 3.4); P.set(ex[i], ey); }
      if (st.talking) mouthTalk(); else P.oval(15.5, 18, 2, 2);
      if (Math.floor(st.t * 4) % 2) { P.line(29, 3, 29, 7); P.set(29, 9); }
      break;
    case 'sleepy': {
      P.line(7, ey + 2, 13, ey + 2); P.line(18, ey + 2, 24, ey + 2);
      P.oval(15.5, 18, 1, 1);
      const z = (st.t * 0.8) % 1, zx = 24 + Math.round(z * 4), zy = 6 - Math.round(z * 5);
      P.line(zx, zy, zx + 2, zy); P.line(zx + 2, zy, zx, zy + 2); P.line(zx, zy + 2, zx + 2, zy + 2);
      break;
    }
    case 'dead':
      P.x(ex[0], ey, 2); P.x(ex[1], ey, 2);
      for (let x = 11; x <= 20; x++) P.set(x, 17 + (x % 2));
      break;
    case 'love':
      P.heart(ex[0], ey); P.heart(ex[1], ey);
      if (st.talking) mouthTalk(); else P.arc(15.5, 14, 4, PI * 0.2, PI * 0.8);
      { const k = (st.t * 0.6) % 1; P.heart(27 + Math.round(Math.sin(k * 9)), 20 - Math.round(k * 16)); }
      break;
    case 'wink':
      P.arc(ex[0], ey + 3, 4, PI * 1.1, PI * 1.9); P.arc(ex[0], ey + 4, 4, PI * 1.15, PI * 1.85);
      eyeOval(1);
      if (st.talking) mouthTalk(); else { P.arc(15.5, 13, 6, PI * 0.15, PI * 0.85); P.arc(15.5, 14, 6, PI * 0.2, PI * 0.8); }
      break;
    case 'angry':
      P.line(6, 4, 13, 7); P.line(18, 7, 25, 4);
      for (const i of [0, 1]) P.rect(ex[i] - 2, ey, 5, 3);
      if (st.talking) mouthTalk(); else P.arc(15.5, 21, 4, PI * 1.2, PI * 1.8);
      break;
    case 'glitch':
    default:
      eyeOval(0); eyeOval(1); P.line(12, 17, 19, 17);
      break;
  }
  // glitch scramble (expression 'glitch' or a burst on face change)
  const gl = expr === 'glitch' ? 0.55 + 0.45 * Math.sin(st.t * 13) : st.glitch;
  if (gl > 0.02) {
    const rnd = st.rnd;
    for (let y = 0; y < GH; y++) {
      if (rnd() < gl * 0.35) { const sh = Math.round((rnd() - 0.5) * 8 * gl); const row = P.g.slice(y * GW, y * GW + GW); for (let x = 0; x < GW; x++) P.g[y * GW + x] = row[(x - sh + GW) % GW]; }
    }
    for (let i = 0; i < 40 * gl; i++) P.g[Math.floor(rnd() * GW * GH)] = rnd() < 0.5 ? 1 : 2;
  }
}

function makeScreenTexture() {
  const c = document.createElement('canvas');
  c.width = GW * CELL; c.height = GH * CELL;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.userData.ctx = c.getContext('2d');
  return tex;
}
// LED matrix: faint unlit diodes, soft bloom halo, rounded lit diodes with hot centres, scanlines
function paintScreen(tex, P, col, dim) {
  const ctx = tex.userData.ctx, w = GW * CELL, h = GH * CELL;
  const bg = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.1, w / 2, h / 2, w * 0.7);
  bg.addColorStop(0, '#04100f'); bg.addColorStop(1, '#010303');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(70,150,150,0.13)';
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
  ctx.globalAlpha = 0.22 * dim; ctx.fillStyle = col;
  for (let i = 0; i < P.g.length; i++) if (P.g[i]) { const x = i % GW, y = (i / GW) | 0; ctx.fillRect(x * CELL - 4, y * CELL - 4, CELL + 8, CELL + 8); }
  ctx.globalAlpha = 1;
  for (let i = 0; i < P.g.length; i++) if (P.g[i]) {
    const x = i % GW, y = (i / GW) | 0;
    ctx.globalAlpha = dim;
    ctx.fillStyle = P.g[i] === 2 ? '#ff4fd8' : col;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2, 3); ctx.fill(); } else ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 7, CELL - 7);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
export function buildHealthity() {
  const root = new THREE.Group(); root.name = 'Healthity';
  const body = new THREE.Group(); root.add(body);
  const shell = new THREE.Mesh(shellGeometry(), shellMat());
  shell.castShadow = true; shell.receiveShadow = true;
  body.add(shell);
  const P = partsGeometry();
  const plastic = new THREE.Mesh(P.plastic, plasticMat()); plastic.castShadow = true;
  const metal = new THREE.Mesh(P.metal, metalMat()); metal.castShadow = true;
  const rubber = new THREE.Mesh(P.rubber, rubberMat());
  body.add(plastic, metal, rubber);
  // face screen (per instance canvas)
  const tex = makeScreenTexture();
  const screenMat = new THREE.MeshPhysicalMaterial({ name: 'hl_screen', color: 0x020506, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.015, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.3, envMapIntensity: 1.4 });
  const scr = new THREE.Mesh(screenGeometry(), screenMat);
  scr.name = 'screen';
  body.add(scr);
  // antenna tip (blinks), thruster glow ring, side thruster glows, glow cone
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3030, emissiveIntensity: 2.5, roughness: 0.25 });
  const tipPos = new THREE.Vector3(0.042, Math.sqrt(R0 * R0 - 0.042 * 0.042 - 0.026 * 0.026) + 0.002, -0.026).add(new THREE.Vector3(-Math.sin(-0.32), Math.cos(-0.32), 0).multiplyScalar(0.06));
  const tip = new THREE.Mesh(cached('hl_tipGeo', () => finish(new THREE.SphereGeometry(0.0082, 16, 12))), tipMat);
  tip.position.copy(tipPos); body.add(tip);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x0a2020, emissive: 0x4ff5ff, emissiveIntensity: 2.2, roughness: 0.3 });
  const glowGeo = cached('hl_glowGeo', () => {
    const disc = new THREE.CircleGeometry(0.03, 32); disc.rotateX(PI / 2); disc.translate(0, -0.1345, 0);
    const parts = [disc];
    for (const s of [-1, 1]) {
      const dir = new THREE.Vector3(s * 0.68, -0.6, -0.1).normalize();
      const d2 = new THREE.CircleGeometry(0.0075, 16); d2.rotateX(PI / 2);
      d2.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir));
      d2.translate(...dir.clone().multiplyScalar(R0 + 0.007).toArray());
      parts.push(d2);
    }
    return finish(mergeGeometries(parts.map(clean)));
  });
  const ring = new THREE.Mesh(glowGeo, ringMat);
  body.add(ring);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x4ff5ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(cached('hl_coneGeo', () => finish(new THREE.CylinderGeometry(0.04, 0.006, 0.11, 24, 1, true))), coneMat);
  cone.position.y = -R0 - 0.065; cone.renderOrder = 3; body.add(cone);
  // floating paddle hands
  const arms = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const h = new THREE.Mesh(handGeometry(), plasticMat()); h.castShadow = true;
    h.scale.x = s; // mirrored thumb
    g.add(h); g.position.set(s * (R0 + 0.035), -0.01, 0.01); g.rotation.z = s * 0.35;
    body.add(g); arms.push(g);
  }

  const Px = new Pix();
  let seed = 12345;
  const st = {
    t: 0, expr: 'happy', talking: false, talkOpen: 0, blink: 0, blinkT: 2, glitch: 0, dirty: true, prevKey: '', bounce: 0,
    rnd: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; },
  };
  function redraw() {
    drawFace(Px, st.expr, st);
    paintScreen(tex, Px, FACE_COL[st.expr] || FACE_COL.neutral, st.expr === 'dead' ? 0.55 : 1);
  }
  function setFace(expr) {
    if (!FACE_COL[expr]) expr = 'neutral';
    if (expr !== st.expr) { st.expr = expr; st.glitch = 0.6; st.dirty = true; st.bounce = 1; }
  }
  function setTalking(v) { v = !!v; if (v !== st.talking) { st.talking = v; st.dirty = true; } }
  function update(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    st.t += dt;
    const t = st.t, dead = st.expr === 'dead', sleepy = st.expr === 'sleepy', happy = st.expr === 'happy' || st.expr === 'love' || st.expr === 'wink';
    // hover bob + tilt (+ a little squash-bounce on every face change, a lean while talking)
    st.bounce = Math.max(0, st.bounce - dt * 4);
    const bz = Math.sin(st.bounce * PI) * 0.06;
    const amp = dead ? 0.004 : sleepy ? 0.01 : 0.018;
    body.position.y = Math.sin(t * 2.1) * amp + (dead ? -0.03 : 0);
    body.rotation.z = Math.sin(t * 1.3) * 0.06 + (dead ? 0.35 : 0);
    body.rotation.x = Math.sin(t * 1.7 + 1) * 0.04 + (sleepy ? 0.18 : 0) + (st.expr === 'alarmed' ? Math.sin(t * 40) * 0.02 : 0) - (st.talking ? 0.05 + st.talkOpen * 0.03 : 0);
    body.scale.set(1 + bz * 0.5, 1 - bz, 1 + bz * 0.5);
    // hands float out of phase; one gestures while talking
    arms.forEach((a, i) => {
      const s = i ? 1 : -1;
      const talkWave = st.talking && i === 1 ? 0.5 + 0.35 * Math.sin(t * 6) : 0;
      a.position.y = -0.01 + Math.sin(t * 2.6 + i * 1.9) * 0.012 + (happy ? Math.max(0, Math.sin(t * 5 + i * PI)) * 0.02 : 0) + talkWave * 0.04;
      a.rotation.z = s * (0.35 + Math.sin(t * 1.9 + i) * 0.12) + (st.expr === 'alarmed' ? s * 0.8 : 0) + (dead ? s * -0.3 : 0) + s * talkWave * 1.2;
      a.rotation.x = Math.sin(t * 1.4 + i * 2) * 0.15;
    });
    // antenna blink + thruster flicker
    const on = dead ? 0 : (Math.floor(t * 1.5) % 2 === 0 ? 1 : 0.15);
    tip.material.emissiveIntensity = 2.6 * on;
    tip.material.emissive.setHex(happy ? 0x40ff70 : st.expr === 'alarmed' || st.expr === 'angry' ? 0xff3030 : 0xffb030);
    ring.material.emissiveIntensity = dead ? 0.15 : 1.8 + Math.sin(t * 31) * 0.25 + Math.sin(t * 7.3) * 0.15;
    cone.material.opacity = dead ? 0.01 : 0.08 + Math.sin(t * 23) * 0.02;
    scr.material.emissiveIntensity = dead ? 1.2 : 2.3 + Math.sin(t * 50) * 0.04;
    // face animation: blink, talking, glitch decay; redraw only when the image changes
    st.blinkT -= dt;
    if (st.blinkT <= 0 && !dead) { st.blink = 0.13; st.blinkT = 2 + st.rnd() * 3.5; }
    if (st.blink > 0) st.blink -= dt;
    if (st.talking) st.talkOpen = 0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 7.3);
    else st.talkOpen = damp(st.talkOpen, 0, 20, dt);
    st.glitch = Math.max(0, st.glitch - dt * 2.5);
    const animated = st.expr === 'glitch' || st.expr === 'sleepy' || st.expr === 'love' || st.expr === 'alarmed';
    const key = `${st.expr}|${st.blink > 0}|${st.talking ? Math.round(st.talkOpen * 4) : -1}|${st.glitch > 0.02 ? Math.floor(t * 15) : 0}|${animated ? Math.floor(t * 10) : 0}`;
    if (key !== st.prevKey || st.dirty) { st.prevKey = key; st.dirty = false; redraw(); }
  }
  setFace('happy');
  update(0);
  root.userData.dispose = () => { tex.dispose(); screenMat.dispose(); tipMat.dispose(); ringMat.dispose(); coneMat.dispose(); };
  return { root, setFace, setTalking, update, screen: scr };
}
