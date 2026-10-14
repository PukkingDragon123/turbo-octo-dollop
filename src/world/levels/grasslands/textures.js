// Grasslands texture sets: custom GPU-synthesized PBR recipes (meadow thatch, conifer litter, packed
// trail dirt, corrugated sheet metal, river foam) + canvas-painted alpha cards (fir sprays) and small
// CPU noise textures for wind / macro variation. Terrain layers are packed into texture arrays.
import * as THREE from 'three';
import * as Synth from '../../../gfx/texsynth.js';
import { engine } from '../../../core/engine.js';
import { RNG } from '../../../core/rng.js';

// ---------------------------------------------------------------------------
// Recipes
Synth.registerRecipe('gl_meadow', {
  // late-summer meadow seen from above: a dense mat of golden thatch and green blades, soil in the gaps
  defaults: { c0: 0xb39a55, c1: 0x5f6e2c, c2: 0x463626, c3: 0xd2c283, p0: [0.5, 0.3, 0, 0], wear: 0, meters: 1.7, bump: 3.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float sN = fbm(uv + 3.0, vec2(9.0), 5);
    float lush = fbm(uv + 11.0, vec2(3.0), 4);
    vec3 thatch = mix(uC2 * 1.25, mix(uC0, uC3, 0.3) * 0.62, smoothstep(0.25, 0.75, sN));
    vec3 col = thatch; float hgt = 0.25 + sN * 0.15; float ao = 0.55;
    for (int k = 0; k < 10; k++) {
      float fk = float(k);
      vec2 per = vec2(14.0 + fk * 5.0);
      vec2 p = uv * per + vec2(fk * 0.37, fk * 0.71); vec2 c = floor(p), f = fract(p);
      vec3 h = h32(mod(c, per) + fk * 17.0);
      float a = (h.x - 0.5) * 2.6 + 1.5708 * step(0.5, h.z);
      vec2 d = vec2(cos(a), sin(a));
      vec2 q = f - (0.5 + (h.yz - 0.5) * 0.25);
      float t = clamp(dot(q, d), -0.46, 0.46);
      float dist = length(q - d * t);
      float w = (0.05 + 0.04 * h.y) * (1.0 - abs(t) * 0.9);
      float b = 1.0 - smoothstep(w * 0.5, w, dist);
      float green = step(h.x, 0.25 + lush * 0.5 * uP0.x);
      vec3 bc = mix(uC0, uC3, h.z * 0.75);
      bc = mix(bc, uC1 * (0.8 + 0.45 * h.y), green);
      bc *= 0.72 + 0.45 * (t + 0.46);
      float lift = 0.45 + fk * 0.055;
      if (b > 0.01) { col = mix(col, bc, b); hgt = max(hgt, b * lift + (1.0 - dist / w) * 0.04); ao = mix(ao, 0.78 + fk * 0.022, b); }
    }
    vec4 fl = vor(uv, vec2(36.0), 0.9); float flower = smoothstep(0.07, 0.03, fl.x) * step(0.94, fl.z);
    col = mix(col, mix(vec3(0.88, 0.8, 0.45), vec3(0.66, 0.55, 0.7), step(0.5, fl.w)), flower * 0.8);
    S s; s.albedo = col; s.height = hgt + flower * 0.2; s.rough = 0.92; s.ao = ao; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('gl_forest', {
  // conifer forest floor: thick tan/brown needle litter, twigs, cones, moss cushions
  defaults: { c0: 0x7a5a3a, c1: 0xa0703f, c2: 0x3a2c1e, c3: 0x5a6a28, p0: [0.5, 0, 0, 0], wear: 0, meters: 1.6, bump: 3.2, size: 1024 },
  glsl: `S surface(vec2 uv){
    float sN = fbm(uv, vec2(8.0), 5);
    vec3 col = mix(uC2, mix(uC0, uC2, 0.5), sN); float hgt = sN * 0.1; float ao = 0.55;
    for (int k = 0; k < 8; k++) {
      float fk = float(k);
      vec2 per = vec2(46.0 + fk * 13.0);
      vec2 p = uv * per + fk * 0.53; vec2 c = floor(p), f = fract(p);
      vec3 h = h32(mod(c, per) + fk * 5.0);
      float a = h.x * PI * 2.0; vec2 d = vec2(cos(a), sin(a));
      vec2 q = f - 0.5 - (h.yz - 0.5) * 0.2;
      float t = clamp(dot(q, d), -0.45, 0.45);
      float dist = length(q - d * t);
      float b = 1.0 - smoothstep(0.035, 0.075, dist);
      vec3 nc = mix(uC0, uC1, h.z) * (0.75 + 0.45 * h.y);
      nc = mix(nc, vec3(0.42, 0.36, 0.28), step(0.8, h.y) * 0.6);
      if (b > 0.01) { col = mix(col, nc, b); hgt = max(hgt, b * (0.3 + fk * 0.07)); ao = mix(ao, 0.82, b); }
    }
    float tw = scratches(uv, 6.0, 0.45, 0.012); col = mix(col, uC2 * 1.3, tw * 0.8); hgt = max(hgt, tw * 0.7);
    vec4 cv = vor(uv + 0.3, vec2(9.0), 0.8); float cone = smoothstep(0.12, 0.08, cv.x) * step(0.84, cv.z);
    float scales = 0.5 + 0.5 * sin((cv.x * 90.0)); col = mix(col, uC1 * (0.5 + scales * 0.35), cone); hgt = max(hgt, cone * (0.9 - cv.x * 3.0));
    float moss = smoothstep(0.58, 0.7, fbm(uv + 7.0, vec2(4.0), 5)) * uP0.x;
    float mf = gn(uv * 300.0, vec2(300.0));
    col = mix(col, uC3 * (0.75 + mf * 0.5), moss); hgt = mix(hgt, 0.55 + mf * 0.2, moss);
    S s; s.albedo = col; s.height = hgt; s.rough = 0.9 - moss * 0.05; s.ao = mix(ao, 0.8, moss); s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('gl_trail', {
  // packed trail dirt with embedded gravel, cracks and shallow boot prints
  defaults: { c0: 0x8c7458, c1: 0x6a543c, c2: 0x9e9584, p0: [0.5, 0, 0, 0], wear: 0, meters: 1.8, bump: 2.2, size: 1024 },
  glsl: `S surface(vec2 uv){
    float m = fbm(uv, vec2(6.0), 6); float d = fbm(uv + 4.0, vec2(30.0), 3);
    vec3 col = mix(uC1, uC0, m) * (0.88 + d * 0.2);
    vec4 g = vor(uv, vec2(48.0), 0.9); float grav = smoothstep(0.32, 0.18, g.x) * step(0.45, g.z);
    vec4 g2 = vor(uv + 0.5, vec2(110.0), 0.9); float grit = smoothstep(0.3, 0.15, g2.x) * step(0.6, g2.z);
    col = mix(col, uC2 * (0.7 + g.w * 0.5), grav); col = mix(col, uC2 * 0.9, grit * 0.6);
    vec3 ce = vorEdge(uv, vec2(7.0), 1.0); float crack = (1.0 - smoothstep(0.0, 0.012, ce.x)) * step(0.55, ce.y) * smoothstep(0.4, 0.7, fbm(uv + 2.0, vec2(3.0), 3));
    col = mix(col, uC1 * 0.5, crack * 0.7);
    vec4 bp = vor(uv + 0.17, vec2(4.0, 6.0), 0.7); float print = smoothstep(0.32, 0.2, length((uv * vec2(4.0, 6.0) - floor(uv * vec2(4.0, 6.0)) - 0.5) * vec2(2.2, 1.0))) * step(0.7, bp.z) * uP0.x;
    S s; s.albedo = col * (1.0 - print * 0.1); s.height = m * 0.35 + grav * (0.45 + g.w * 0.2) + grit * 0.15 - crack * 0.4 - print * 0.25; s.rough = 0.92 - grav * 0.1; s.ao = 0.65 + grav * 0.3 - crack * 0.4 + m * 0.1; s.metal = 0.0; return s; }`,
});

Synth.registerRecipe('gl_corrugated', {
  // corrugated galvanised steel sheet: ribs along V, galvanising spangle, rust streaks and paint remains
  defaults: { c0: 0x8d9296, c1: 0x5f6468, c2: 0x7a3e1c, c3: 0x5b6e5a, p0: [10, 0.6, 0.35, 0], wear: 0.55, meters: 1.2, bump: 6.0, size: 1024, metal: true },
  glsl: `S surface(vec2 uv){
    float rib = 0.5 + 0.5 * cos(uv.x * uP0.x * 2.0 * PI);
    vec4 sp = vor(uv, vec2(40.0), 1.0); float spangle = sp.z;
    float m = fbm(uv, vec2(4.0), 5);
    vec3 col = mix(uC1, uC0, 0.55 + (spangle - 0.5) * 0.3 + (m - 0.5) * 0.3);
    float streakN = gn(vec2(uv.x * 30.0, uv.y * 1.5), vec2(30.0, 1.0)) * fbm(uv + 2.0, vec2(3.0, 1.0), 4);
    float rust = smoothstep(0.35, 0.6, streakN + (1.0 - rib) * 0.12) * uWear + smoothstep(0.85, 1.0, uv.y + (m - 0.5) * 0.3) * uWear;
    rust = clamp(rust, 0.0, 1.0);
    float paint = smoothstep(0.55, 0.6, fbm(uv + 9.0, vec2(2.0), 5)) * uP0.z;
    col = mix(col, uC3, paint * (1.0 - rust));
    col = mix(col, uC2 * (0.6 + 0.6 * fbm(uv + 5.0, vec2(20.0), 3)), rust);
    float holes = smoothstep(0.03, 0.0, vor(uv + 0.2, vec2(5.0, 8.0), 0.9).x) * step(0.9, h12(floor(uv * vec2(5.0, 8.0))));
    S s; s.albedo = col * (1.0 - holes * 0.8); s.height = rib * 0.8 + (m - 0.5) * 0.05 - rust * 0.05 - holes;
    s.rough = mix(mix(0.42, 0.6, paint), 0.9, rust); s.ao = 0.75 + rib * 0.25 - holes * 0.6; s.metal = (1.0 - rust) * (1.0 - paint) * 0.85; return s; }`,
});

Synth.registerRecipe('gl_foam', {
  // white water / river foam: bubbly streaks (albedo = foam colour, R of ORM = coverage)
  defaults: { c0: 0xf4f8f6, c1: 0xb8c8c8, p0: [0, 0, 0, 0], wear: 0, meters: 2, bump: 1.0, size: 512 },
  glsl: `S surface(vec2 uv){
    float a = fbm(uv * vec2(1.0, 3.0), vec2(4.0, 12.0), 5);
    vec4 b = vor(uv, vec2(18.0, 30.0), 1.0); float bub = smoothstep(0.0, 0.35, b.y - b.x);
    vec4 b2 = vor(uv + 0.4, vec2(40.0, 60.0), 1.0); float bub2 = smoothstep(0.0, 0.3, b2.y - b2.x);
    float cov = smoothstep(0.38, 0.72, a) * (0.55 + 0.45 * bub) * (0.7 + 0.3 * bub2);
    S s; s.albedo = mix(uC1, uC0, cov); s.height = cov; s.rough = 0.5; s.ao = cov; s.metal = 0.0; return s; }`,
});

// ---------------------------------------------------------------------------
const Q = () => engine.qualityName || 'medium';
export const texSize = (n) => (Q() === 'low' ? Math.min(n, 512) : n);

// Terrain layer sets (index = array layer)
export const TERRAIN_LAYERS = [
  ['gl_meadow', {}],                                                                                      // 0 meadow
  ['gl_trail', {}],                                                                                       // 1 trail dirt
  ['pebbles', { c0: 0x8e8b84, c1: 0x5c5a56, c2: 0x5e5244, c3: 0xbcb6aa, p0: [24, 0.45, 0, 0], meters: 1.2 }], // 2 river gravel
  ['gl_forest', {}],                                                                                      // 3 forest floor
  ['rock', { c0: 0x8d8983, c1: 0x4e4b47, c2: 0xc6c0b6, c3: 0x8e8f4c, p0: [0.5, 0.45, 0.25, 0.35], meters: 4, bump: 3.2 }], // 4 granite
];

export function terrainArrays() {
  if (terrainArrays._c) return terrainArrays._c;
  const size = texSize(1024);
  const sets = TERRAIN_LAYERS.map(([name, o]) => Synth.pbr(name, { ...o, size }));
  const L = sets.length;
  // roughness/AO carry little high-frequency detail: half resolution below 'high' (saves ~21 MB)
  const half = (src, n) => {
    const h = n >> 1, out = new Uint8Array(h * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) for (let c = 0; c < 4; c++) {
      const a = ((y * 2) * n + x * 2) * 4 + c;
      out[(y * h + x) * 4 + c] = (src[a] + src[a + 4] + src[a + n * 4] + src[a + n * 4 + 4] + 2) >> 2;
    }
    return out;
  };
  const mk = (key, srgb, down = false) => {
    const n = down ? size >> 1 : size;
    const data = new Uint8Array(n * n * 4 * L);
    sets.forEach((s, i) => data.set(down ? half(s[key].image.data, size) : s[key].image.data, i * n * n * 4));
    const t = new THREE.DataArrayTexture(data, n, n, L);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  };
  terrainArrays._c = { albedo: mk('map', true), normal: mk('normalMap', false), orm: mk('orm', false, Q() !== 'high' && size >= 1024), meters: sets.map((s) => s.meters), size };
  return terrainArrays._c;
}

// ---------------------------------------------------------------------------
// Tileable value-noise texture (RGBA = 4 independent octave sets) for wind gusts, macro colour, clouds
export function noiseTexture(size = 256) {
  if (noiseTexture._c) return noiseTexture._c;
  const rng = new RNG(9137);
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const per = [4, 8, 16, 32][ch];
    // one tileable lattice per octave
    const lats = [];
    for (let o = 0; o < 4; o++) {
      const p = per * (1 << o);
      if (p > size) break;
      const lat = new Float32Array(p * p);
      for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
      lats.push(lat);
    }
    const val = (x, y, p, lat) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const m = (a) => ((a % p) + p) % p;
      const L = (a, b) => lat[m(b) * p + m(a)];
      return (L(xi, yi) * (1 - u) + L(xi + 1, yi) * u) * (1 - v) + (L(xi, yi + 1) * (1 - u) + L(xi + 1, yi + 1) * u) * v;
    };
    const raw = new Float32Array(size * size);
    let mean = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0, a = 0.5, n = 0;
      for (let o = 0; o < lats.length; o++) {
        const p = per * (1 << o);
        s += a * val((x / size) * p, (y / size) * p, p, lats[o]);
        n += a; a *= 0.5;
      }
      raw[y * size + x] = s / n;
      mean += s / n;
    }
    mean /= raw.length;
    let vr = 0;
    for (let i = 0; i < raw.length; i++) vr += (raw[i] - mean) ** 2;
    const sd = Math.sqrt(vr / raw.length) || 1;
    // normalise every channel to the same distribution (mean 0.5, sd 0.17) whatever its lattice
    for (let i = 0; i < raw.length; i++) data[i * 4 + ch] = Math.max(0, Math.min(255, Math.round((0.5 + ((raw[i] - mean) / sd) * 0.17) * 255)));
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  noiseTexture._c = t;
  return t;
}

// ---------------------------------------------------------------------------
// Fir / spruce spray cards painted on a canvas: albedo with alpha + a matching normal map.
// kind 0: dense spruce spray (hanging), 1: flat fir frond, 2: pine needle tufts
export function needleCard(kind = 0) {
  const key = `needle${kind}`;
  needleCard._c = needleCard._c || {};
  if (needleCard._c[key]) return needleCard._c[key];
  const W = Q() === 'low' ? 256 : 512, H = W;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const hv = document.createElement('canvas');
  hv.width = W; hv.height = H;
  const hctx = hv.getContext('2d');
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, W, H);
  const rng = new RNG(1300 + kind * 77);
  const s = W / 512;
  ctx.lineCap = 'round';
  hctx.lineCap = 'round';
  const needleLen = (kind === 2 ? 34 : kind === 1 ? 17 : 14) * s;
  const needle = (px, py, na, nl, shade, light) => {
    const g = shade;
    let r, gg, b;
    if (light) { r = 105 + rng.next() * 30; gg = 140 + rng.next() * 25; b = 55 + rng.next() * 15; }
    else if (kind === 2) { r = 40 + rng.next() * 18; gg = 72 + rng.next() * 24; b = 34 + rng.next() * 12; }
    else { r = 26 + rng.next() * 14; gg = 58 + rng.next() * 24; b = 30 + rng.next() * 14; }
    ctx.strokeStyle = `rgb(${Math.round(r * g)},${Math.round(gg * g)},${Math.round(b * g)})`;
    ctx.lineWidth = (kind === 2 ? 2.0 : 2.6) * s;
    const ex = px + Math.cos(na) * nl, ey = py + Math.sin(na) * nl;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    const hl = Math.round(120 + 135 * Math.min(1, shade * 0.9));
    hctx.strokeStyle = `rgb(${hl},${hl},${hl})`;
    hctx.lineWidth = (kind === 2 ? 2.0 : 2.6) * s;
    hctx.beginPath(); hctx.moveTo(px, py); hctx.lineTo(ex, ey); hctx.stroke();
  };
  // a twig with needles on both sides; recursive side shoots
  const twig = (x0, y0, ang, len, depth) => {
    const steps = Math.max(4, Math.floor(len / (kind === 2 ? 3.5 * s : 2.4 * s)));
    let x = x0, y = y0, a = ang;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      pts.push([x, y, a]);
      a += (rng.next() - 0.5) * 0.06 + (kind === 0 ? 0.004 : 0);
      x += Math.cos(a) * (len / steps); y += Math.sin(a) * (len / steps);
    }
    // bark of the twig
    ctx.strokeStyle = `rgb(${78 + rng.next() * 20},${54 + rng.next() * 10},${34})`;
    ctx.lineWidth = Math.max(1, (4.5 - depth * 1.6) * s);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    // side shoots (drawn first so the main axis' needles overlap them)
    if (depth < 2) {
      const n = depth === 0 ? 15 : 6;
      for (let k = 0; k < n; k++) {
        const t = 0.08 + (k / n) * 0.86;
        const p = pts[Math.min(pts.length - 1, Math.floor(t * steps))];
        const side = k % 2 ? 1 : -1;
        // teardrop envelope: longest shoots a third of the way up
        const env = Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - t * 0.35);
        const sl = len * (depth === 0 ? 0.5 : 0.42) * env * (0.8 + rng.next() * 0.4);
        if (sl < 8 * s) continue;
        twig(p[0], p[1], p[2] + side * (kind === 1 ? 1.05 : 0.8) + (rng.next() - 0.5) * 0.25, sl, depth + 1);
      }
    }
    // needles
    for (let i = 0; i < pts.length; i++) {
      const t = i / pts.length;
      const [px, py, pa] = pts[i];
      const taper = 1 - t * 0.45;
      const rows = kind === 2 ? 3 : 2;
      for (let r = 0; r < rows; r++) for (const side of [-1, 1]) {
        const spread = kind === 1 ? 1.45 : kind === 2 ? 0.4 + r * 0.25 : 0.75 + r * 0.32;
        const na = pa + side * spread + (rng.next() - 0.5) * 0.4;
        const nl = needleLen * taper * (0.75 + rng.next() * 0.5) * (depth === 2 ? 0.85 : 1);
        const shade = 0.72 + 0.4 * rng.next() - depth * 0.05;
        needle(px, py, na, nl, shade, t > 0.8 && rng.next() < 0.35);
      }
    }
  };
  // the spray grows from the bottom centre (card base) toward the top
  twig(W * 0.5, H * 0.99, -Math.PI / 2 + (rng.next() - 0.5) * 0.08, H * 0.92, 0);
  // fake normals from the height canvas
  const img = ctx.getImageData(0, 0, W, H);
  const hd = hctx.getImageData(0, 0, W, H).data;
  const nrm = new Uint8Array(W * H * 4);
  const hAt = (x, y) => hd[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (hAt(x - 1, y) - hAt(x + 1, y)) * 2.5, dy = (hAt(x, y - 1) - hAt(x, y + 1)) * 2.5;
    const l = Math.hypot(dx, dy, 1);
    const k = ((H - 1 - y) * W + x) * 4;
    nrm[k] = Math.round((dx / l * 0.5 + 0.5) * 255);
    nrm[k + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    nrm[k + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    nrm[k + 3] = 255;
  }
  // flip to texture space; bleed colour into transparent texels so mipmaps don't fringe
  const d = img.data;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4, di = ((H - 1 - y) * W + x) * 4;
    out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = d[si + 3];
    if (d[si + 3] < 8) { out[di] = 30; out[di + 1] = 52; out[di + 2] = 28; }
  }
  const map = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  const nmap = new THREE.DataTexture(nrm, W, H, THREE.RGBAFormat);
  for (const t of [map, nmap]) {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  needleCard._c[key] = { map, normalMap: nmap };
  return needleCard._c[key];
}
