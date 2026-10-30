// R.O.O.M. — doll textures.
//  * Tileable PBR fabric sets synthesised on the GPU (texsynth recipes 'doll_*'): PVC hazmat
//    crinkle, burlap weave, felt, rubber, duct tape / webbing, knit, quilting and the suit prints.
//    Generated once per process, shared by every avatar (UVs are in meters; each material sets
//    its own texture repeat = 1 / tile size).
//  * One shared canvas decal atlas (+ emissive twin) for every printed detail: tank label, ID
//    badge, digits for the employee number, shoulder patch, watch LCD, gauge dial, filter labels...
import * as THREE from 'three';
import * as Synth from '../../gfx/texsynth.js';
import { cached, mkCanvas } from './kit.js';
import { RNG } from '../../core/rng.js';

const PI = Math.PI, TAU = PI * 2;

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
const CELL = `
vec4 cellNear(vec2 uv, float per, float jit, float sd){
  vec2 p = uv * per; vec2 i = floor(p), f = fract(p); float md = 9.0; vec4 best = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 c = mod(i + g, vec2(per));
    vec2 o = 0.5 + (h22(c + sd) - 0.5) * jit; vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; best = vec4(r, h12(c + sd + 3.7), h12(c + sd + 9.1)); } }
  return best; }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  // rubberised PVC coverall sheet (albedo ~neutral: the suit colour comes from the material).
  // A smooth calendered coat with broad soft undulation, sparse sharp crumple creases (slightly
  // stress-whitened and rougher) and a faint orange peel; no fibre-scale noise, so it reads as a
  // glossy coated film rather than felt.
  Synth.registerRecipe('doll_pvc', {
    defaults: { c0: 0xffffff, c2: 0x6a5a3a, p0: [0.36, 1, 0, 0], wear: 0.3, meters: 0.36, bump: 3.0, size: 512 },
    glsl: `S surface(vec2 uv){
      float bil = fbm(uv, vec2(3.0, 2.0), 4);
      float bil2 = fbm(uv + vec2(0.31, 0.57), vec2(5.0, 4.0), 3);
      float c1 = pow(ridged(uv + vec2(0.37, 0.71), vec2(4.0, 3.0), 2), 6.0);
      float c2 = pow(ridged(uv + vec2(0.13, 0.29), vec2(8.0, 6.0), 1), 9.0);
      float c3 = pow(ridged(uv + vec2(0.61, 0.17), vec2(13.0, 11.0), 1), 12.0);
      float crease = c1 * 0.75 + c2 * 0.45 + c3 * 0.25;
      float peel = gn(uv * 110.0, vec2(110.0));
      float dirt = smoothstep(0.6, 0.92, fbm(uv + 6.0, vec2(3.0), 6)) * uWear;
      float scuff = scratches(uv, 9.0, 0.35, 0.006) * uWear;
      vec3 col = vec3(0.9) * (0.985 + (bil - 0.5) * 0.05);
      col = mix(col, vec3(1.0), sat(crease) * 0.1);
      col = mix(col, uC2, dirt * 0.3); col = mix(col, col * 1.06, scuff * 0.5);
      S s; s.albedo = col;
      s.height = bil * 0.55 + bil2 * 0.25 + crease * 0.32 + peel * 0.008;
      s.rough = uP0.x + sat(crease) * 0.14 + dirt * 0.3 + scuff * 0.12 + (peel - 0.5) * 0.05 + (bil2 - 0.5) * 0.08;
      s.ao = 0.9 + bil * 0.1 - sat(crease) * 0.04; s.metal = 0.0; return s; }`,
  });
  // dense spun-bonded Tyvek (cleanroom suit): matte, fibrous mottling, soft crumples
  Synth.registerRecipe('doll_tyvek', {
    defaults: { c0: 0xffffff, c2: 0x6a5a3a, p0: [0.82, 1, 0, 0], wear: 0.25, meters: 0.3, bump: 2.0, size: 512 },
    glsl: `S surface(vec2 uv){
      float bil = fbm(uv, vec2(3.0, 2.0), 4);
      float c1 = pow(ridged(uv + vec2(0.37, 0.71), vec2(5.0, 4.0), 2), 4.0);
      float mot = fbm(uv + 3.0, vec2(24.0), 3);
      float dirt = smoothstep(0.6, 0.92, fbm(uv + 6.0, vec2(3.0), 6)) * uWear;
      vec3 col = vec3(0.92) * (0.96 + (mot - 0.5) * 0.08);
      col = mix(col, uC2, dirt * 0.25);
      S s; s.albedo = col; s.height = bil * 0.5 + c1 * 0.4 + mot * 0.04;
      s.rough = uP0.x + (mot - 0.5) * 0.08 + dirt * 0.1; s.ao = 0.9 + bil * 0.1; s.metal = 0.0; return s; }`,
  });
  // dense canvas-like burlap (PEAK heads are a fine hessian: weave visible up close, mottled further away)
  Synth.registerRecipe('doll_burlap', {
    defaults: { c0: 0xfff8ec, c1: 0xeddcbe, c2: 0x6a5034, p0: [26, 26, 0.28, 1.0], wear: 0.3, meters: 0.085, bump: 2.4, size: 512 },
    glsl: `S surface(vec2 uv){
      vec2 wob = vec2(fbm(uv, vec2(4.0), 3) - 0.5, fbm(uv + 7.1, vec2(4.0), 3) - 0.5) * 0.55 / uP0.xy;
      vec2 t = (uv + wob) * uP0.xy; vec2 c = floor(t), f = fract(t);
      float thW = 0.4 + 0.12 * h12(vec2(mod(c.x, uP0.x), 2.0)) + 0.1 * (vn(vec2(c.x, uv.y * 10.0), vec2(uP0.x, 10.0)) - 0.5);
      float thF = 0.4 + 0.12 * h12(vec2(5.0, mod(c.y, uP0.y))) + 0.1 * (vn(vec2(uv.x * 10.0, c.y), vec2(10.0, uP0.y)) - 0.5);
      float pw = sqrt(sat(1.0 - abs(f.x - 0.5) / thW)), pf = sqrt(sat(1.0 - abs(f.y - 0.5) / thF));
      float over = mod(c.x + c.y, 2.0);
      float hw = pw * (0.72 + 0.28 * sin(PI * f.y)) * (over > 0.5 ? 1.0 : 0.72), hf = pf * (0.72 + 0.28 * sin(PI * f.x)) * (over > 0.5 ? 0.72 : 1.0);
      float h = max(hw, hf); bool onW = hw > hf;
      vec2 pa = floor(uP0.xy * vec2(9.0, 1.2)), pb = floor(uP0.xy * vec2(1.2, 9.0));
      float fib = onW ? gn(uv * pa, pa) : gn(uv * pb, pb);
      float tone = h12(onW ? vec2(mod(c.x, uP0.x), 1.0) : vec2(3.0, mod(c.y, uP0.y)));
      float slub = smoothstep(0.7, 0.95, onW ? vn(vec2(c.x * 3.1, uv.y * 30.0), vec2(uP0.x * 3.0, 30.0)) : vn(vec2(uv.x * 30.0, c.y * 3.1), vec2(30.0, uP0.y * 3.0)));
      vec3 col = mix(uC0, uC1, tone * 0.85) * (0.78 + h * 0.3) * (0.88 + fib * 0.24) * (1.0 + slub * 0.06);
      float gap = 1.0 - smoothstep(0.0, 0.2, h);
      col = mix(col, uC2 * 0.55, gap * uP0.z);
      float hair = smoothstep(0.88, 0.985, gn(uv * vec2(60.0, 8.0) + fib, vec2(60.0, 8.0))) + smoothstep(0.9, 0.99, gn(uv.yx * vec2(55.0, 7.0) + fib, vec2(55.0, 7.0)));
      col = mix(col, uC0 * 1.1, hair * 0.35 * uP0.w);
      float stain = smoothstep(0.62, 0.88, fbm(uv + 4.4, vec2(2.0), 5)) * uWear; col *= 1.0 - stain * 0.22;
      S s; s.albedo = col; s.height = h + fib * 0.08 + slub * 0.12 + hair * 0.1 * uP0.w; s.rough = 0.9 + gap * 0.08; s.ao = 0.5 + 0.5 * h; s.metal = 0.0; return s; }`,
  });
  // needle felt: matted short fibres + pilling (albedo neutral, tinted by vertex colour)
  Synth.registerRecipe('doll_felt', {
    defaults: { c0: 0xffffff, p0: [1, 0, 0, 0], wear: 0.0, meters: 0.05, bump: 1.6, size: 256 },
    glsl: `S surface(vec2 uv){
      float a = fbm(uv, vec2(6.0), 5); float b = fbm(uv + 2.0, vec2(32.0), 3);
      float f1 = scratches(uv, 22.0, 0.45, 0.03), f2 = scratches(uv + 0.31, 31.0, 0.4, 0.025), f3 = scratches(uv + 0.67, 15.0, 0.5, 0.035);
      float fib = max(f1, max(f2, f3)); float pill = smoothstep(0.74, 0.88, fbm(uv + 9.0, vec2(14.0), 3));
      vec3 col = vec3(0.92) * (0.9 + a * 0.12 + b * 0.06) * (1.0 + fib * 0.06) * (1.0 - pill * 0.05);
      S s; s.albedo = col; s.height = a * 0.4 + b * 0.25 + fib * 0.35 + pill * 0.25; s.rough = 1.0; s.ao = 0.85 + a * 0.15; s.metal = 0.0; return s; }`,
  });
  // moulded rubber: fine stipple, flow marks, dust in the low spots
  Synth.registerRecipe('doll_rubber', {
    defaults: { c0: 0xffffff, c2: 0x9a958c, p0: [0.5, 0, 0, 0], wear: 0.35, meters: 0.1, bump: 1.0, size: 256 },
    glsl: `S surface(vec2 uv){
      float st = gn(uv * 180.0, vec2(180.0)); float m = fbm(uv, vec2(4.0), 5);
      float flow = fbm(uv * vec2(1.0, 1.0) + vec2(fbm(uv, vec2(2.0), 3)), vec2(3.0, 9.0), 4);
      float dust = smoothstep(0.6, 0.9, fbm(uv + 1.0, vec2(5.0), 5)) * uWear;
      vec3 col = vec3(0.85) * (0.95 + (m - 0.5) * 0.1); col = mix(col, uC2, dust * 0.5);
      S s; s.albedo = col; s.height = st * 0.25 + flow * 0.12; s.rough = uP0.x + (st - 0.5) * 0.08 + dust * 0.25; s.ao = 1.0; s.metal = 0.0; return s; }`,
  });
  // duct tape / nylon webbing / canvas: woven scrim under a crinkled coating
  Synth.registerRecipe('doll_tape', {
    defaults: { c0: 0xffffff, p0: [56, 56, 0, 0], wear: 0.2, meters: 0.05, bump: 1.6, size: 256 },
    glsl: `S surface(vec2 uv){
      vec2 t = uv * uP0.xy; vec2 f = fract(t);
      float wx = pow(max(0.0, sin(PI * f.x)), 0.6), wy = pow(max(0.0, sin(PI * f.y)), 0.6);
      float weave = max(wx * (0.7 + 0.3 * sin(PI * f.y)), wy * (0.7 + 0.3 * sin(PI * f.x)));
      float crk = ridged(uv + 0.2, vec2(5.0, 3.0), 4); float m = fbm(uv, vec2(3.0), 4);
      vec3 col = vec3(0.86) * (0.93 + weave * 0.08 + (m - 0.5) * 0.08);
      S s; s.albedo = col; s.height = weave * 0.35 + crk * 0.5; s.rough = 0.5 + (1.0 - crk) * 0.12; s.ao = 0.85 + weave * 0.15; s.metal = 0.0; return s; }`,
  });
  // stockinette knit (beanies, scarves)
  Synth.registerRecipe('doll_knit', {
    defaults: { c0: 0xffffff, p0: [12, 16, 0, 0], wear: 0.0, meters: 0.06, bump: 2.6, size: 256 },
    glsl: `S surface(vec2 uv){
      vec2 t = uv * uP0.xy; vec2 c = floor(t), f = fract(t);
      float lx = abs(f.x - 0.5) * 2.0;
      float d = abs(fract(f.y + lx * 0.45) - 0.5) * 2.0;
      float h = pow(sat(1.0 - d), 0.7) * (0.65 + 0.35 * sin(PI * lx)) * (0.8 + 0.2 * sin(PI * f.x));
      float fz = fbm(uv, vec2(48.0), 3);
      vec3 col = vec3(0.9) * (0.62 + h * 0.42) * (0.92 + fz * 0.14);
      S s; s.albedo = col; s.height = h + fz * 0.1; s.rough = 1.0; s.ao = 0.55 + h * 0.45; s.metal = 0.0; return s; }`,
  });
  // quilted insulated shell (night shift suit): horizontal channels + stitching
  Synth.registerRecipe('doll_quilt', {
    defaults: { c0: 0xffffff, p0: [4, 0, 0, 0], wear: 0.2, meters: 0.32, bump: 3.0, size: 256 },
    glsl: `S surface(vec2 uv){
      float ch = fract(uv.y * uP0.x + (fbm(uv, vec2(3.0), 3) - 0.5) * 0.04);
      float puff = pow(sin(PI * ch), 0.5); float st = (ch < 0.025 || ch > 0.975) ? step(0.5, fract(uv.x * 120.0)) : 0.0;
      float crk = ridged(uv, vec2(6.0, 4.0), 3);
      vec3 col = vec3(0.9) * (0.86 + puff * 0.14) * (1.0 - st * 0.25);
      S s; s.albedo = col; s.height = puff * 0.8 + crk * 0.15 - st * 0.1; s.rough = 0.42 + (1.0 - puff) * 0.15; s.ao = 0.6 + puff * 0.4; s.metal = 0.0; return s; }`,
  });
  // Hawaiian print: white plumerias with red star centres + green monstera-ish leaves on pink
  Synth.registerRecipe('doll_hawaii', {
    defaults: { c0: 0xe0518f, c1: 0xfbf6ee, c2: 0x2f9a52, c3: 0xd8283a, p0: [0, 0, 0, 0], meters: 0.5, bump: 0.2, size: 512 },
    glsl: CELL + `S surface(vec2 uv){
      vec3 col = uC0 * (0.95 + fbm(uv, vec2(8.0), 3) * 0.1);
      // leaves (sparse)
      for (int k = 0; k < 2; k++) {
        vec4 L = cellNear(uv + float(k) * 0.37, 3.0 + float(k), 0.8, 11.0 + float(k) * 5.0);
        if (L.w > 0.7) continue;
        vec2 q = rot2(L.z * 6.283) * (-L.xy); float s = 0.36 + L.w * 0.1;
        for (int j = 0; j < 2; j++) { vec2 qq = rot2(float(j) * 2.6 + 0.4) * q; qq.x -= s * 0.95;
          float e = length(qq / vec2(s * 0.95, s * 0.34));
          if (e < 1.0) { float vein = smoothstep(0.025, 0.0, abs(qq.y)) * step(-s * 0.85, qq.x); col = mix(uC2 * (0.8 + 0.25 * (1.0 - e)), uC2 * 0.55, vein * 0.6); } }
      }
      // plumerias: big + medium, with gaps
      for (int k = 0; k < 2; k++) {
        vec4 F = cellNear(uv + 0.11 + float(k) * 0.53, k == 0 ? 3.0 : 5.0, 0.75, 31.0 + float(k) * 7.0);
        if (F.w > (k == 0 ? 0.85 : 0.55)) continue;
        vec2 q = rot2(F.z * 6.283) * (-F.xy); float R = (k == 0 ? 0.34 : 0.28) * (0.85 + F.w * 0.25);
        float r = length(q), a = atan(q.y, q.x);
        float petal = R * (0.52 + 0.48 * pow(abs(cos(2.5 * a)), 0.65));
        if (r < petal) {
          float sh = smoothstep(petal, petal * 0.35, r);
          col = mix(uC1 * 0.84, uC1, sh);
          col = mix(col, vec3(0.98, 0.86, 0.45), smoothstep(R * 0.45, R * 0.12, r) * 0.6);
          if (r < R * 0.2) col = mix(uC3, uC3 * 0.7, r / (R * 0.2));
          else if (r < R * 0.42) { float star = step(0.62, abs(cos(2.5 * a))); col = mix(col, uC3, star * smoothstep(R * 0.42, R * 0.22, r)); }
        }
      }
      S s; s.albedo = col; s.height = 0.5; s.rough = 0.5; s.ao = 1.0; s.metal = 0.0; return s; }`,
  });
  // woodland camo
  Synth.registerRecipe('doll_camo', {
    defaults: { c0: 0x8d8a5a, c1: 0x5c6a38, c2: 0x3b4528, c3: 0x2c261e, meters: 0.6, bump: 0.2, size: 512 },
    glsl: `S surface(vec2 uv){
      float a = fbm(uv, vec2(4.0, 3.0), 5), b = fbm(uv + 3.3, vec2(5.0, 4.0), 5), c = fbm(uv + 7.7, vec2(6.0, 4.0), 5);
      vec3 col = uC0; col = mix(col, uC1, smoothstep(0.5, 0.53, a)); col = mix(col, uC2, smoothstep(0.55, 0.58, b)); col = mix(col, uC3, smoothstep(0.6, 0.63, c));
      col *= 0.95 + fbm(uv, vec2(30.0), 3) * 0.1;
      S s; s.albedo = col; s.height = 0.5; s.rough = 0.6; s.ao = 1.0; s.metal = 0.0; return s; }`,
  });
}

// texture set with its own repeat (shares the GPU upload): { map, normalMap, orm, meters }
function flatSet(meters = 0.3) {
  // fallback when GPU synthesis is unavailable: neutral albedo, flat normal, mid roughness
  const mk = (r, g, b, srgb) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; };
  return { map: mk(225, 225, 225, true), normalMap: mk(128, 128, 255, false), orm: mk(255, 150, 0, false), meters };
}
export function synth(name, opts = {}, repeat = null) {
  register();
  return cached('dtex_' + name + JSON.stringify(opts) + (repeat ?? ''), () => {
    let t;
    try { t = Synth.pbr(name, opts); } catch (e) { console.warn('doll: texture synthesis failed for', name, e); t = flatSet(); }
    const r = repeat ?? 1 / t.meters;
    const cl = (tex) => { const c = tex.clone(); c.repeat.set(r, r); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c; };
    return { map: cl(t.map), normalMap: cl(t.normalMap), orm: cl(t.orm), meters: t.meters };
  });
}

// ---------------------------------------------------------------------------
// Joint compression folds (tileable, CPU-built): stacked lens-shaped ridges running across the
// limb (constant v), rounded crests and sharp valleys. RGB = tangent-space normal, A = cavity
// (0 in a valley, 1 on a crest). The suit shader blends it in where the skin weights say the
// vertex sits on a joint (elbows, knees, waist, armpits, neck, ankles). UV v runs along the limb.
// ---------------------------------------------------------------------------
export const CREASE_METERS = 0.19;
export function creaseTexture() {
  return cached('dollCrease', () => {
    const N = 256, RINGS = 7, h = new Float32Array(N * N);
    const hash = (k) => { const s = Math.sin(k * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const warp = 0.32 * Math.sin(TAU * (u + 0.13)) + 0.18 * Math.sin(TAU * (2 * u + v) + 1.7) + 0.1 * Math.sin(TAU * (3 * u - v) + 0.4);
      const t = v * RINGS + warp, k = ((Math.floor(t) % RINGS) + RINGS) % RINGS, f = t - Math.floor(t);
      const crest = Math.pow(Math.sin(PI * f), 0.65);                         // rounded crest, sharp valley
      const lens = 0.5 + 0.5 * Math.sin(TAU * (u * (1 + (k % 3 === 0 ? 1 : 0)) + hash(k)));  // folds fade in / out around the limb
      const amp = 0.35 + 0.65 * Math.pow(lens, 1.5) * (0.6 + 0.4 * hash(k + 9));
      h[j * N + i] = crest * amp;
    }
    const data = new Uint8Array(N * N * 4), K = 9.0;
    const H = (i, j) => h[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = (H(i - 1, j) - H(i + 1, j)) * K, dy = (H(i, j - 1) - H(i, j + 1)) * K;
      const l = Math.hypot(dx, dy, 1), o = (j * N + i) * 4;
      data[o] = Math.round((dx / l * 0.5 + 0.5) * 255); data[o + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); data[o + 3] = Math.round(Math.min(1, H(i, j) * 1.6) * 255);
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

// ---------------------------------------------------------------------------
// Decal atlas (1024 x 1024, shared). Regions in px: x, y, w, h (canvas space, y down).
// ---------------------------------------------------------------------------
export const ATLAS = {
  W: 1024, H: 1024,
  tank: [0, 0, 1024, 150],
  badge: [8, 168, 248, 360],
  digits: [272, 168, 400, 72],          // 10 cells of 40 x 72
  patch: [272, 256, 240, 240],
  lcd: [528, 256, 256, 192],
  gauge: [800, 168, 200, 200],
  cross: [800, 384, 180, 180],
  filter: [272, 512, 300, 120],
  hoodtxt: [8, 544, 256, 80],
  stripes: [8, 640, 512, 56],
  lens: [590, 470, 120, 120],          // emissive hot spot (headlamp / jet nozzle glow)
  flame: [730, 600, 120, 200],         // emissive flame gradient
  glow: [880, 600, 100, 100],          // flat emissive (halo)
  white: [600, 600, 80, 80],           // plain white (lens backs, labels)
  black: [600, 700, 80, 80],
  pcb: [8, 712, 300, 120],             // watch side / gadget detail
  name: [320, 712, 300, 60],           // name tape "R.O.O.M."
  stencil: [8, 840, 520, 130],         // sprayed "R.O.O.M." back stencil
  bio: [540, 840, 120, 120],           // biohazard mark (thigh)
  suitno: [670, 850, 340, 70],         // "SUIT No." thigh print
  bezel: [670, 930, 90, 90],           // knurled knob / dial face (wrist terminal)
  // clone android
  led: [716, 456, 64, 64],             // glowing LED pupil (cyan), emissive
  ledr: [716, 528, 64, 64],            // red replacement LED, emissive
  serial: [8, 974, 400, 46],           // "CLONE UNIT RC-7 · DO NOT OPEN" print
  barcode: [416, 974, 240, 46],        // barcode + lot number
  warn: [772, 932, 240, 86],           // yellow HIGH VOLTAGE label
  grille: [870, 712, 64, 64],          // speaker grille dots (ears)
  amber: [944, 712, 64, 64],           // amber status lamp, emissive
};
// UV for region r at (u, v) in 0..1 (v = 0 bottom of the region)
export function atlasUV(r, u, v) {
  const [x, y, w, h] = ATLAS[r] || r;
  return [(x + u * w) / ATLAS.W, 1 - (y + (1 - v) * h) / ATLAS.H];
}

const MONO = ""Jolly Lodger", Georgia, serif", VT = ""Jolly Lodger", Georgia, serif";
function hazard(ctx, x, y, w, h, step = 28) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#f2c418'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#17171a';
  for (let k = x - h; k < x + w + h; k += step * 2) { ctx.beginPath(); ctx.moveTo(k, y + h); ctx.lineTo(k + step, y + h); ctx.lineTo(k + step + h, y); ctx.lineTo(k + h, y); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
function grime(ctx, x, y, w, h, n, seed, a = 0.08) {
  const r = new RNG(seed);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let i = 0; i < n; i++) {
    const px = x + r.next() * w, py = y + r.next() * h, rr = 2 + r.next() * 14;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, `rgba(40,30,20,${a * r.next()})`); g.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = g; ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  ctx.restore();
}
// little doll portrait for the badge photo
function dollPortrait(ctx, cx, cy, s) {
  ctx.save();
  ctx.fillStyle = '#f2c418'; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.9, s * 0.95, s * 0.6, 0, PI, 0); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - s * 0.62, cy - s * 0.66, s * 1.24, s * 1.32, s * 0.5); ctx.fill();
  ctx.fillStyle = '#d9be8c'; ctx.beginPath(); ctx.roundRect(cx - s * 0.48, cy - s * 0.5, s * 0.96, s * 1.0, s * 0.36); ctx.fill();
  ctx.fillStyle = '#101012'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * s * 0.27, cy - s * 0.05, s * 0.07, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#d02c2a'; ctx.beginPath(); ctx.arc(cx, cy + s * 0.05, s * 0.16, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#2a1810'; ctx.lineWidth = s * 0.035; ctx.beginPath(); ctx.moveTo(cx - s * 0.08, cy + s * 0.33); ctx.lineTo(cx + s * 0.08, cy + s * 0.33); ctx.stroke();
  ctx.restore();
}

function drawAtlas(ctx, emissive = false) {
  const A = ATLAS;
  if (emissive) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, A.W, A.H); } else ctx.clearRect(0, 0, A.W, A.H);
  const R = (k) => A[k];
  if (emissive) {
    // LCD glow
    { const [x, y, w, h] = R('lcd'); ctx.fillStyle = '#04150a'; ctx.fillRect(x, y, w, h); lcdFace(ctx, x, y, w, h, true); }
    { const [x, y, w, h] = R('lens'); const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w / 2); g.addColorStop(0, '#fffef0'); g.addColorStop(0.5, '#ffe9a8'); g.addColorStop(1, '#a87a30'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
    { const [x, y, w, h] = R('flame'); const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#fff8d0'); g.addColorStop(0.25, '#ffd040'); g.addColorStop(0.6, '#ff6a10'); g.addColorStop(1, '#300800'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
    { const [x, y, w, h] = R('glow'); ctx.fillStyle = '#ffe08a'; ctx.fillRect(x, y, w, h); }
    { const [x, y, w, h] = R('gauge'); ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); }
    ledFace(ctx, R('led'), [[0, '#ffffff'], [0.35, '#d8fbff'], [0.62, '#46c8ec'], [0.85, '#0a4a66'], [1, '#000000']]);
    ledFace(ctx, R('ledr'), [[0, '#fff2ea'], [0.35, '#ffb09a'], [0.62, '#f03020'], [0.85, '#4a0806'], [1, '#000000']]);
    ledFace(ctx, R('amber'), [[0, '#fffbe8'], [0.4, '#ffd27a'], [0.75, '#e08a10'], [1, '#2a1400']]);
    return;
  }
  // --- tank label: hazard bands + text
  {
    const [x, y, w, h] = R('tank');
    ctx.fillStyle = '#ece6d6'; ctx.fillRect(x, y, w, h);
    hazard(ctx, x, y, w, 26, 22); hazard(ctx, x, y + h - 26, w, 26, 22);
    ctx.fillStyle = '#1a1a1c'; ctx.textBaseline = 'middle';
    for (const [cx, txt] of [[w * 0.25, 'BREATHING AIR'], [w * 0.75, 'O₂  200 BAR']]) {
      ctx.font = `bold 40px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(txt, x + cx, y + h / 2 - 8);
      ctx.font = `bold 16px ${MONO}`; ctx.fillText('R.O.O.M. LIFE SUPPORT DIV. — DO NOT REMOVE', x + cx, y + h / 2 + 26);
    }
    ctx.fillStyle = '#c8302a'; ctx.beginPath(); ctx.arc(x + w * 0.5, y + h / 2, 22, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold 24px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('!', x + w * 0.5, y + h / 2 + 1);
    grime(ctx, x, y, w, h, 60, 3, 0.12);
  }
  // --- ID badge card (vertical): yellow header, photo, CLONE, empty number slot, barcode
  {
    const [x, y, w, h] = R('badge');
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.clip();
    ctx.fillStyle = '#f6f3ea'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f2c418'; ctx.fillRect(x, y, w, 64);
    hazard(ctx, x, y + 58, w, 10, 9);
    ctx.fillStyle = '#151515'; ctx.font = `bold 38px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('R.O.O.M.', x + w / 2, y + 30);
    ctx.fillStyle = '#d9d4c4'; ctx.fillRect(x + 54, y + 84, 140, 150);
    ctx.fillStyle = '#b8c4cc'; ctx.fillRect(x + 54, y + 84, 140, 60);
    dollPortrait(ctx, x + w / 2, y + 162, 58);
    ctx.fillStyle = '#151515'; ctx.font = `bold 22px ${MONO}`; ctx.fillText('CLONE EMPLOYEE', x + w / 2, y + 254);
    ctx.fillStyle = '#e4dfd2'; ctx.fillRect(x + 34, y + 270, w - 68, 46);           // number slot (digits are separate quads)
    ctx.fillStyle = '#151515';
    for (let i = 0, bx = x + 30; bx < x + w - 30; i++) { const bw = 1 + ((i * 7 + 3) % 4); ctx.fillRect(bx, y + 326, bw, 26); bx += bw + 2 + (i % 3); }
    ctx.restore();
    ctx.strokeStyle = '#9a968c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 17); ctx.stroke();
    ctx.fillStyle = '#7a776e'; ctx.beginPath(); ctx.roundRect(x + w / 2 - 22, y + 8, 44, 10, 5); ctx.fill();
  }
  // --- digits 0-9 (badge number)
  {
    const [x, y, w, h] = R('digits');
    ctx.fillStyle = '#e4dfd2'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#151515'; ctx.font = `bold 58px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = 0; d < 10; d++) ctx.fillText(String(d), x + d * 40 + 20, y + h / 2 + 3);
  }
  // --- round shoulder patch: embroidered R.O.O.M. logo
  {
    const [x, y, w, h] = R('patch'); const cx = x + w / 2, cy = y + h / 2, r = w / 2 - 6;
    ctx.fillStyle = '#1c2a4a'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f2c418'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(cx, cy, r - 8, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(cx, cy, r - 17, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // stylised door / room icon
    ctx.fillStyle = '#f2c418'; ctx.fillRect(cx - 34, cy - 58, 68, 80); ctx.fillStyle = '#1c2a4a'; ctx.fillRect(cx - 24, cy - 48, 48, 70);
    ctx.fillStyle = '#f2c418'; ctx.beginPath(); ctx.arc(cx + 14, cy - 10, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8e2d0'; ctx.font = `bold 34px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('R.O.O.M.', cx, cy + 50);
    ctx.font = `bold 13px ${MONO}`; ctx.fillText('CONTAINMENT', cx, cy + 74);
  }
  // --- watch LCD (dim, the emissive twin holds the glow)
  { const [x, y, w, h] = R('lcd'); ctx.fillStyle = '#0b1d10'; ctx.fillRect(x, y, w, h); lcdFace(ctx, x, y, w, h, false); }
  // --- pressure gauge dial
  {
    const [x, y, w, h] = R('gauge'); const cx = x + w / 2, cy = y + h / 2, r = w / 2 - 4;
    ctx.fillStyle = '#f4f1e8'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c8302a'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(cx, cy, r - 14, PI * 0.75, PI * 1.05); ctx.stroke();
    ctx.strokeStyle = '#3aa040'; ctx.beginPath(); ctx.arc(cx, cy, r - 14, PI * 1.6, PI * 2.25); ctx.stroke();
    ctx.strokeStyle = '#151515'; ctx.lineWidth = 3;
    for (let i = 0; i <= 10; i++) { const a = PI * 0.75 + (i / 10) * PI * 1.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); ctx.lineTo(cx + Math.cos(a) * (r - (i % 5 ? 18 : 26)), cy + Math.sin(a) * (r - (i % 5 ? 18 : 26))); ctx.stroke(); }
    ctx.fillStyle = '#151515'; ctx.font = `bold 20px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BAR', cx, cy + r * 0.45);
    const a = PI * 0.75 + 0.78 * PI * 1.5; ctx.strokeStyle = '#c8302a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); ctx.lineTo(cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22)); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.fill();
  }
  // --- medic cross
  { const [x, y, w, h] = R('cross'); ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2 - 4, 0, TAU); ctx.fill(); ctx.fillStyle = '#d02a2a'; const t = w * 0.2; ctx.fillRect(x + w / 2 - t / 2, y + 26, t, h - 52); ctx.fillRect(x + 26, y + h / 2 - t / 2, w - 52, t); }
  // --- respirator filter label
  { const [x, y, w, h] = R('filter'); ctx.fillStyle = '#e8d24a'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#9a2a8a'; ctx.fillRect(x, y + h * 0.62, w, h * 0.38); ctx.fillStyle = '#151515'; ctx.font = `bold 34px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ABEK-P3', x + w / 2, y + h * 0.32); ctx.fillStyle = '#fff'; ctx.font = `bold 20px ${MONO}`; ctx.fillText('R.O.O.M. FILTER', x + w / 2, y + h * 0.81); }
  // --- hood back stencil
  { const [x, y, w, h] = R('hoodtxt'); ctx.fillStyle = '#17171a'; ctx.font = `bold 52px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('R.O.O.M.', x + w / 2, y + h / 2 + 2); }
  // --- hazard stripes strip
  { const [x, y, w, h] = R('stripes'); hazard(ctx, x, y, w, h, 24); }
  { const [x, y, w, h] = R('white'); ctx.fillStyle = '#f4f2ec'; ctx.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R('black'); ctx.fillStyle = '#101012'; ctx.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R('lens'); ctx.fillStyle = '#fff6d8'; ctx.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R('flame'); ctx.fillStyle = '#ffb030'; ctx.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R('glow'); ctx.fillStyle = '#ffd860'; ctx.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R('pcb'); ctx.fillStyle = '#1d5a32'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 2; for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(x + 10 + i * 24, y + 10); ctx.lineTo(x + 10 + i * 24, y + 60); ctx.lineTo(x + 30 + i * 24, y + 100); ctx.stroke(); } }
  { const [x, y, w, h] = R('name'); ctx.fillStyle = '#2a2a2e'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#f2c418'; ctx.font = `bold 34px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('R.O.O.M.', x + w / 2, y + h / 2 + 2); }
  // --- sprayed stencil "R.O.O.M." (letters broken by stencil bridges, overspray speckle)
  {
    const [x, y, w, h] = R('stencil');
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#18181a'; ctx.font = `bold 92px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('R.O.O.M.', x + w / 2, y + h * 0.4);
    ctx.font = `bold 22px ${MONO}`; ctx.fillText('HAZMAT CLASS 3  \u00b7  CONTAINMENT', x + w / 2, y + h * 0.86);
    // stencil bridges
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 8; k += 2) { const bx = x + w / 2 + (k - 3.5) * 55.5; ctx.fillRect(bx - 3, y + h * 0.4 - 30, 6, 16); ctx.fillRect(bx - 3, y + h * 0.4 + 12, 6, 14); }
    const r = new RNG(17);
    for (let i = 0; i < 900; i++) { const px = x + r.next() * w, py = y + r.next() * h; ctx.fillRect(px, py, 1 + r.next() * 3, 1 + r.next() * 3); }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(24,24,26,0.9)';
    for (let i = 0; i < 260; i++) { const px = x + w * 0.12 + r.next() * w * 0.76, py = y + h * 0.15 + r.next() * h * 0.55; ctx.fillRect(px, py, 1.5, 1.5); }
    ctx.restore();
  }
  // --- biohazard mark: trefoil in a ring (black on transparent)
  {
    const [x, y, w, h] = R('bio'); const cx = x + w / 2, cy = y + h / 2 + 4, r0 = w * 0.44;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#18181a';
    for (let k = 0; k < 3; k++) { const a = -PI / 2 + k * TAU / 3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r0 * 0.36, cy + Math.sin(a) * r0 * 0.36, r0 * 0.44, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 3; k++) { const a = -PI / 2 + k * TAU / 3; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r0 * 0.5, cy + Math.sin(a) * r0 * 0.5, r0 * 0.3, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.arc(cx, cy, r0 * 0.15, 0, TAU); ctx.fill();
    ctx.lineWidth = r0 * 0.07; ctx.beginPath(); ctx.arc(cx, cy, r0 * 0.27, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath(); ctx.arc(cx, cy, r0 * 0.1, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // --- "SUIT No." print
  { const [x, y, w, h] = R('suitno'); ctx.fillStyle = '#18181a'; ctx.font = `bold 30px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SUIT No.0451-B', x + w / 2, y + h * 0.36); ctx.font = `bold 17px ${MONO}`; ctx.fillText('SIZE: CLONE / ONE-SIZE', x + w / 2, y + h * 0.82); }
  // --- clone android prints
  ledFace(ctx, R('led'), [[0, '#f4ffff'], [0.35, '#bff4ff'], [0.62, '#2a9cc4'], [0.85, '#08283a'], [1, '#05080a']]);
  ledFace(ctx, R('ledr'), [[0, '#fff0e8'], [0.35, '#ff9a86'], [0.62, '#c02818'], [0.85, '#2a0604'], [1, '#080404']]);
  ledFace(ctx, R('amber'), [[0, '#fff8e0'], [0.4, '#ffcc66'], [0.75, '#c87810'], [1, '#2a1400']]);
  {
    const [x, y, w, h] = R('serial');
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#1e1c1a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `bold 21px ${MONO}`; ctx.fillText('CLONE UNIT RC-7  \u00b7  R.O.O.M.', x + 6, y + h * 0.32);
    ctx.font = `bold 13px ${MONO}`; ctx.fillText('DO NOT OPEN \u00b7 NO USER SERVICEABLE PARTS INSIDE', x + 6, y + h * 0.76);
    ctx.restore();
  }
  {
    const [x, y, w, h] = R('barcode');
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#1e1c1a';
    for (let i = 0, bx = x + 6; bx < x + w - 70; i++) { const bw = 1 + ((i * 5 + 2) % 4); ctx.fillRect(bx, y + 4, bw, h - 18); bx += bw + 1.5 + (i % 3); }
    ctx.font = `bold 11px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('LOT 0451-C', x + 6, y + h - 1);
    ctx.font = `bold 15px ${MONO}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText('QC', x + w - 8, y + h * 0.35); ctx.fillText('\u2713 07', x + w - 8, y + h * 0.75);
    ctx.restore();
  }
  {
    const [x, y, w, h] = R('warn');
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.clip();
    ctx.fillStyle = '#f2c418'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#17171a'; ctx.lineWidth = 4; ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
    ctx.fillStyle = '#17171a'; ctx.beginPath(); ctx.moveTo(x + 46, y + 14); ctx.lineTo(x + 80, y + h - 14); ctx.lineTo(x + 12, y + h - 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2c418'; ctx.font = `bold 34px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x + 46, y + h * 0.62);
    ctx.fillStyle = '#17171a'; ctx.font = `bold 22px ${MONO}`; ctx.textAlign = 'left'; ctx.fillText('HIGH', x + 94, y + h * 0.34); ctx.fillText('VOLTAGE', x + 94, y + h * 0.66);
    ctx.restore();
  }
  {
    const [x, y, w, h] = R('grille');
    ctx.fillStyle = '#2a2826'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#060606';
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { if (i * i + j * j > 10) continue; ctx.beginPath(); ctx.arc(x + w / 2 + i * 7.5, y + h / 2 + j * 7.5, 2.4, 0, TAU); ctx.fill(); }
  }
  // --- knurled dial face (radial ticks)
  { const [x, y, w, h] = R('bezel'); const cx = x + w / 2, cy = y + h / 2; ctx.fillStyle = '#2a2b2e'; ctx.beginPath(); ctx.arc(cx, cy, w / 2, 0, TAU); ctx.fill(); ctx.strokeStyle = '#d8d4c4'; ctx.lineWidth = 3; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * w * 0.3, cy + Math.sin(a) * w * 0.3); ctx.lineTo(cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * w * 0.44); ctx.stroke(); } ctx.fillStyle = '#e04030'; ctx.fillRect(cx - 3, y + 6, 6, w * 0.32); }
}
function ledFace(ctx, [x, y, w, h], stops) {
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w / 2);
  for (const [k, c] of stops) g.addColorStop(k, c);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
function lcdFace(ctx, x, y, w, h, glow) {
  ctx.save();
  ctx.fillStyle = glow ? '#5dff8a' : '#2f7a46'; ctx.font = `86px ${VT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('03:33', x + w / 2, y + h / 2 + 8);
  ctx.font = `30px ${VT}`; ctx.fillText('R.O.O.M.  ♥ 72', x + w / 2, y + 28);
  ctx.fillRect(x + 20, y + h - 30, (w - 40) * 0.7, 10);
  ctx.restore();
}

export function atlasTextures() {
  return cached('dollAtlas', () => {
    const mk = (emissive) => {
      const c = mkCanvas(ATLAS.W, ATLAS.H), ctx = c.getContext('2d');
      drawAtlas(ctx, emissive);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      t.userData.redraw = () => { ctx.clearRect(0, 0, ATLAS.W, ATLAS.H); drawAtlas(ctx, emissive); t.needsUpdate = true; };
      return t;
    };
    const res = { map: mk(false), emissiveMap: mk(true) };
    // labels use web fonts: redraw once they have loaded
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => { res.map.userData.redraw(); res.emissiveMap.userData.redraw(); });
    }
    return res;
  });
}
