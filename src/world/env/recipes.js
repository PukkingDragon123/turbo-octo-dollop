// Texture-synthesis recipes for the environments (Level 0 + HQ lobby). Registered into the shared
// GPU texture library (src/gfx/texsynth.js); world materials in src/gfx/materials.js use them with
// UVs in meters (repeat = 1 / meters). Large-scale variation (stains, damp, fading, tide marks) is
// NOT baked into these tiles: it is added in world space by the baked-light material (bakedlight.js)
// so nothing repeats every tile.
import { registerRecipe } from '../../gfx/texsynth.js';

// Level 0 wallpaper: 0.53 m paper strips, fine paired pin-stripes with a faint chevron column,
// paper fibre, roll-to-roll tone shifts, butt seams with a hairline gap and a slightly lifted edge.
// p0: x strips per tile, y columns per strip, z motif rows per tile, w motif strength
// p1: x style (0 = Level 0 stripes, 1 = manila damask), y foxing, z seam strength, w paper grain
registerRecipe('env_wallpaper', {
  defaults: { c0: 0xcdb262, c1: 0xa9904a, c2: 0x6a5528, c3: 0xdcc679, p0: [3, 8, 24, 1.6], p1: [0, 0.6, 1, 1], wear: 0.3, meters: 1.59, bump: 1.9, size: 1024 },
  glsl: `S surface(vec2 uv){
    float strips = uP0.x;
    float sx = uv.x * strips; float si = mod(floor(sx), strips); float su = fract(sx);
    vec3 sh = h32(vec2(si, 3.0));
    float cols = uP0.y, rows = uP0.z;
    float cx = su * cols; float ci = floor(cx); float cu = fract(cx);
    float odd = mod(ci, 2.0);
    float cv = fract(uv.y * rows + odd * 0.5);
    float motif = 0.0, band = 0.0, emb = 0.0;
    if (uP1.x < 0.5) {
      // paired pin-stripes at the column borders + soft darker band + faint chevrons in odd columns
      float pd = min(cu, 1.0 - cu);
      float pins = (1.0 - smoothstep(0.012, 0.028, abs(pd - 0.035))) ;
      band = smoothstep(0.12, 0.2, pd) * (1.0 - smoothstep(0.32, 0.42, pd));
      float chev = abs(fract(cv + abs(cu - 0.5) * 0.9) - 0.5);
      float chevron = (1.0 - smoothstep(0.035, 0.065, chev)) * (1.0 - smoothstep(0.18, 0.26, abs(cu - 0.5))) * odd;
      float dotp = 1.0 - smoothstep(0.045, 0.075, length(vec2(cu - 0.5, cv - 0.5)));
      motif = max(chevron, dotp * (1.0 - odd) * 0.8);
      emb = motif * 0.7 + pins * 0.5;
      band = max(band * 0.6, pins);
    } else {
      // manila: lozenge damask with a quatrefoil
      vec2 q = vec2(cu - 0.5, cv - 0.5);
      float loz = abs(q.x) * 1.25 + abs(q.y);
      float ring = 1.0 - smoothstep(0.018, 0.045, abs(loz - 0.38));
      float pr = min(min(length(q - vec2(0.0, 0.12)), length(q + vec2(0.0, 0.12))), min(length(q - vec2(0.1, 0.0)), length(q + vec2(0.1, 0.0))));
      float petal = 1.0 - smoothstep(0.06, 0.1, pr);
      motif = max(ring, petal * 0.85); emb = motif; band = 0.0;
    }
    float fib = gn(uv * 520.0, vec2(520.0)) * 0.6 + gn(uv * vec2(180.0, 18.0) + 3.0, vec2(180.0, 18.0)) * 0.4;
    float mott = fbm(uv + sh.xy * 3.0, vec2(5.0, 5.0), 5);
    float print = fbm(uv * vec2(1.0, 1.0) + 1.7, vec2(14.0, 3.0), 3);
    vec3 col = uC0 * (1.0 + (sh.z - 0.5) * 0.03);
    col = mix(col, uC1, band * 0.36 * uP0.w * (0.8 + print * 0.4));
    col = mix(col, uC3, motif * 0.4 * uP0.w * (0.75 + print * 0.5));
    // the print sits a little proud and is a touch glossier than the paper: it catches grazing light
    col *= 1.0 - (1.0 - print) * 0.035;
    col *= 0.965 + (fib - 0.5) * 0.06 * uP1.w + (mott - 0.5) * 0.045;
    float sd = min(su, 1.0 - su);
    float gap = 1.0 - smoothstep(0.0008, 0.0026, sd);
    float lift = (1.0 - smoothstep(0.0026, 0.009, sd)) * (1.0 - gap);
    col = mix(col, uC2 * 0.85, gap * 0.32 * uP1.z);
    col *= 1.0 + lift * 0.035 * uP1.z;
    float fox = smoothstep(0.74, 0.82, fbm(uv + 9.0, vec2(6.0), 5)) * uP1.y;
    col = mix(col, uC2, fox * 0.18);
    S s; s.albedo = col;
    s.height = 0.5 + (fib - 0.5) * 0.22 * uP1.w + emb * 0.13 * uP0.w - gap * 0.45 + lift * 0.14;
    s.rough = 0.84 - motif * 0.12 * uP0.w - band * 0.04 + (fib - 0.5) * 0.06; s.ao = 1.0 - gap * 0.55; s.metal = 0.0; return s; }`,
});

// Damp cut-pile carpet: two interleaved tuft layers, pile shading (brushed directions), flecks, matting.
// p0: x tufts per tile, y fleck amount, z pile shading, w matting
registerRecipe('env_carpet', {
  defaults: { c0: 0xb39a5e, c1: 0x8e7843, c2: 0x4e4024, c3: 0xcab47c, p0: [300, 0.7, 0.8, 0.5], wear: 0.3, meters: 1.0, bump: 1.5, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec4 v = vor(uv, vec2(uP0.x), 1.0);
    float tuft = 1.0 - smoothstep(0.0, 0.9, v.x);
    vec4 v2 = vor(uv + 0.37, vec2(floor(uP0.x * 0.71)), 1.0);
    float tuft2 = 1.0 - smoothstep(0.0, 0.9, v2.x);
    float fib = gn(uv * floor(uP0.x * 2.6), vec2(floor(uP0.x * 2.6)));
    float shade = fbm(uv, vec2(3.0), 5);
    float shade2 = fbm(uv + 2.3, vec2(9.0, 7.0), 4);
    float mat = fbm(uv + 4.1, vec2(4.0), 5);
    vec3 col = mix(uC1, uC0, sat(0.55 + (shade - 0.5) * uP0.z * 1.5 + (shade2 - 0.5) * 0.4 + (v.z - 0.5) * 0.3));
    col = mix(col, uC3, step(1.0 - uP0.y * 0.05, v.w) * 0.55);
    col = mix(col, uC2, step(1.0 - uP0.y * 0.035, v2.w) * 0.5);
    float pile = max(tuft, tuft2 * 0.85);
    col *= 0.68 + pile * 0.4 + (fib - 0.5) * 0.14;
    float matted = smoothstep(0.52, 0.78, mat) * uP0.w;
    col = mix(col, col * vec3(0.86, 0.85, 0.82), matted);
    S s; s.albedo = col; s.height = pile * (0.8 - matted * 0.45) + (fib - 0.5) * 0.14;
    s.rough = 0.97 - matted * 0.08; s.ao = 0.5 + pile * 0.5; s.metal = 0.0; return s; }`,
});

// Fissured mineral-fibre drop-ceiling tiles framed by the white enamel T-bar grid: 4x4 tiles per texture
// (the material shuffles / rotates them per world tile). Each tile carries half of the 24 mm flange on its
// borders, so any arrangement still shows a continuous grid.
// p0: x tiles per texture, y fissures, z pinholes, w per-tile tone; p1: x flange half-width (tile uv),
//     y kerf width beyond the flange, z yellowing, w flange enamel roughness
registerRecipe('env_acoustic', {
  defaults: { c0: 0xe9e3cf, c1: 0xd2c9ae, c2: 0x9a8458, c3: 0xf1efe9, p0: [4, 0.9, 0.8, 0.012], p1: [0.02, 0.012, 0.5, 0.42], wear: 0.2, meters: 2.4, bump: 2.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x; vec2 t = uv * n; vec2 ti = mod(floor(t), n); vec2 f = fract(t);
    vec3 th = h32(ti + 0.5);
    vec2 e = min(f, 1.0 - f); float ed = min(e.x, e.y);
    float flange = 1.0 - smoothstep(uP1.x - 0.0015, uP1.x + 0.0015, ed);
    float fe = 1.0 - smoothstep(0.0, 0.004, abs(ed - uP1.x));          // flange edge highlight / seam
    float kerf = smoothstep(uP1.x, uP1.x + uP1.y, ed);                 // tile edge rolls down into the kerf
    float r1 = ridged(uv + th.xy * 7.0, vec2(56.0), 2);
    float r2 = ridged(uv + th.yz * 5.0 + 3.1, vec2(96.0), 2);
    float fis = smoothstep(0.86, 0.95, r1) * uP0.y * 0.8 + smoothstep(0.88, 0.97, r2) * uP0.y * 0.55;
    float pin = smoothstep(0.84, 0.95, gn(uv * 360.0 + th.z * 9.0, vec2(360.0))) * uP0.z;
    float grain = gn(uv * 760.0, vec2(760.0));
    float m = fbm(uv + th.xz, vec2(6.0), 4);
    vec3 col = mix(uC1, uC0, sat(0.62 + (m - 0.5) * 0.45 + (th.x - 0.5) * uP0.w * 16.0));
    col = mix(col, mix(col, uC2, 0.25), smoothstep(0.4, 1.0, th.y) * uP1.z * 0.25);
    col *= 1.0 - fis * 0.24 - pin * 0.3;
    col *= 0.975 + grain * 0.045;
    col *= mix(0.82, 1.0, kerf);
    float sc = scratches(uv * 4.0, 6.0, 0.4, 0.01) * uWear;
    vec3 fl = uC3 * (0.97 + grain * 0.03) * (1.0 - sc * 0.15);
    col = mix(col, fl, flange);
    col *= 1.0 - fe * 0.25;
    S s; s.albedo = col;
    float tileH = 0.5 - (1.0 - kerf) * 0.22 - fis * 0.3 - pin * 0.28 + grain * 0.04 + (m - 0.5) * 0.04;
    s.height = mix(tileH, 0.62, flange) - fe * 0.05;
    s.rough = mix(0.98, uP1.w + sc * 0.2, flange); s.ao = mix((1.0 - fis * 0.45 - pin * 0.35) * mix(0.8, 1.0, kerf), 1.0, flange) * (1.0 - fe * 0.3);
    s.metal = 0.0; return s; }`,
});

// Prismatic acrylic diffuser (K12 pattern): tiny square pyramids. p0.x pyramids per tile
registerRecipe('env_prism', {
  defaults: { c0: 0xf4f1ea, c1: 0xdedad0, p0: [80, 0, 0, 0], wear: 0.0, meters: 0.32, bump: 1.2, size: 512 },
  glsl: `S surface(vec2 uv){
    vec2 f = fract(uv * uP0.x) - 0.5;
    float pyr = 1.0 - max(abs(f.x), abs(f.y)) * 2.0;
    float facet = step(abs(f.y), abs(f.x));
    float m = fbm(uv, vec2(3.0), 3);
    vec3 col = mix(uC1, uC0, 0.6 + facet * 0.25 + pyr * 0.15) * (0.97 + m * 0.05);
    S s; s.albedo = col; s.height = pyr; s.rough = 0.22; s.ao = 0.9 + pyr * 0.1; s.metal = 0.0; return s; }`,
});

// Painted concrete masonry units (16x8 in, running bond) with concave tooled joints and porous faces.
// p0: x blocks across, y courses, z joint width (uv), w pore visibility through the paint
registerRecipe('env_cmu', {
  defaults: { c0: 0xd8d2c2, c1: 0xb8b0a0, c2: 0x6a6458, p0: [4, 8, 0.0065, 0.7], wear: 0.3, meters: 1.6, bump: 2.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    float bx = uP0.x, by = uP0.y;
    float row = floor(uv.y * by);
    vec2 t = vec2(uv.x * bx + mod(row, 2.0) * 0.5, uv.y * by);
    vec2 c = floor(t), f = fract(t);
    vec3 hb = h32(mod(c, vec2(bx, by)) + 0.5);
    float jd = min(min(f.x, 1.0 - f.x) / bx, min(f.y, 1.0 - f.y) / by);
    float joint = 1.0 - smoothstep(uP0.z * 0.5, uP0.z * 0.5 + 0.0018, jd);
    float concave = smoothstep(0.0, uP0.z * 0.5, jd);
    float pores = smoothstep(0.8, 0.93, gn(uv * 420.0 + hb.xy * 11.0, vec2(420.0))) * (0.6 + 0.4 * gn(uv * 37.0, vec2(37.0)));
    float agg = fbm(uv + hb.xy, vec2(48.0), 3);
    float m = fbm(uv, vec2(5.0), 5);
    vec3 col = uC0 * (0.965 + (hb.x - 0.5) * 0.045 + (m - 0.5) * 0.05) * (0.975 + agg * 0.05);
    col = mix(col, uC2, pores * 0.4 * uP0.w);
    col = mix(col, uC1, joint * 0.4);
    float dirt = smoothstep(0.62, 0.85, fbm(uv + 2.0, vec2(3.0), 5)) * uWear; col = mix(col, uC2, dirt * 0.25);
    S s; s.albedo = col;
    s.height = joint > 0.5 ? concave * 0.35 : 0.6 + (agg - 0.5) * 0.12 - pores * 0.3 * uP0.w;
    s.rough = 0.74 + pores * 0.14 + joint * 0.1; s.ao = 1.0 - joint * 0.35 - pores * 0.25; s.metal = 0.0; return s; }`,
});

// Commercial loop-pile carpet tiles (0.5 m), quarter-turned, with a wavy multi-level stripe and flecks.
// p0: x tiles per texture, y loop rows per tile, z stripe frequency, w pattern contrast
registerRecipe('env_carpet_tile', {
  defaults: { c0: 0x76829a, c1: 0x5f6a80, c2: 0x3a404c, c3: 0x9a8e78, p0: [2, 150, 9, 0.22], wear: 0.25, meters: 1.0, bump: 1.6, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x; vec2 t = uv * n; vec2 ti = mod(floor(t), n); vec2 f = fract(t);
    float rot = mod(ti.x + ti.y, 2.0);
    vec2 lu = rot > 0.5 ? vec2(f.y, f.x) : f;
    float rowsN = uP0.y;
    float ry = lu.y * rowsN; float rf = fract(ry); float rI = floor(ry);
    float lx = lu.x * rowsN * 1.25 + h12(vec2(rI, ti.x + ti.y * 7.0)); float lf = fract(lx);
    float loop = sin(PI * rf) * (0.55 + 0.45 * sin(PI * lf));
    float pat = 0.5 + 0.5 * sin((lu.y + 0.035 * sin(lu.x * 2.0 * PI * 2.0)) * 2.0 * PI * uP0.z);
    float hi = smoothstep(0.35, 0.65, pat);
    vec3 col = mix(uC1, uC0, mix(0.5, hi, uP0.w));
    vec3 fl = h32(vec2(floor(lx), rI) + ti * 31.0);
    col = mix(col, uC2, step(0.92, fl.x) * 0.6);
    col = mix(col, uC3, step(0.975, fl.y) * 0.55);
    col *= 0.72 + loop * 0.34;
    float m = fbm(uv, vec2(4.0), 4); col *= 0.94 + m * 0.1;
    float tint = h12(ti + 7.7); col *= 0.97 + tint * 0.06;
    vec2 e = min(f, 1.0 - f); float seam = 1.0 - smoothstep(0.0, 0.005, min(e.x, e.y));
    col *= 1.0 - seam * 0.4;
    float dirt = smoothstep(0.6, 0.86, fbm(uv + 5.0, vec2(3.0), 5)) * uWear; col = mix(col, col * 0.8, dirt);
    S s; s.albedo = col; s.height = loop * (0.45 + hi * 0.45 * uP0.w) - seam * 0.5;
    s.rough = 0.96; s.ao = 0.55 + loop * 0.45 - seam * 0.3; s.metal = 0.0; return s; }`,
});

// Vinyl composition tile (12 in), through-chip mottle with alternating grain, waxed sheen, heel marks.
// p0: x tiles across, y joint width (tile uv), z checker strength, w wax gloss
registerRecipe('env_vct', {
  defaults: { c0: 0xd9d6cb, c1: 0x7c8a84, c2: 0x3a3830, p0: [4, 0.006, 1, 0.6], wear: 0.45, meters: 1.22, bump: 1.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x; vec2 t = uv * n; vec2 ti = mod(floor(t), n); vec2 f = fract(t);
    float chk = mod(ti.x + ti.y, 2.0) * uP0.z;
    vec3 th = h32(ti + 0.5);
    vec2 q = mod(ti.x + ti.y, 2.0) > 0.5 ? uv.yx : uv;
    float chips = fbm(q + th.yz * 4.0, vec2(12.0, 40.0), 4);
    float chips2 = fbm(q + 3.3 + th.xy, vec2(28.0, 90.0), 3);
    vec3 base = mix(uC0, uC1, chk);
    vec3 col = base * (0.95 + (th.z - 0.5) * 0.05);
    col = mix(col, base * 0.8, smoothstep(0.56, 0.68, chips) * 0.85);
    col = mix(col, base * 1.1, smoothstep(0.6, 0.7, chips2) * 0.6);
    vec2 e = min(f, 1.0 - f); float gap = 1.0 - smoothstep(0.0, uP0.y, min(e.x, e.y));
    float scuff = scratches(uv, 6.0, 0.45, 0.006) * uWear;
    float heel = smoothstep(0.84, 0.95, fbm(uv + 7.0, vec2(14.0), 4)) * uWear;
    float wax = fbm(uv + 1.0, vec2(3.0), 4);
    col = mix(col, uC2, sat(gap * 0.75 + scuff * 0.25 + heel * 0.55));
    S s; s.albedo = col; s.height = 0.5 - gap * 0.5 - scuff * 0.08;
    s.rough = mix(0.16, 0.42, wax) * mix(1.0, 0.7, uP0.w) + gap * 0.5 + scuff * 0.15 + heel * 0.2; s.ao = 1.0 - gap * 0.45; s.metal = 0.0; return s; }`,
});

// Vertical wood-veneer wainscot / paneling with irregular V-grooves (grain along V).
// p0: x boards per tile, y groove width (uv), z growth rings across a board, w lacquer roughness
registerRecipe('env_panel', {
  defaults: { c0: 0x553422, c1: 0x7a553a, c2: 0x22140a, p0: [6, 0.0045, 7, 0.38], wear: 0.25, meters: 1.2, bump: 2.0, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x; float bx = uv.x * n; float bi = mod(floor(bx), n); float bf = fract(bx);
    vec3 hb = h32(vec2(bi, 2.0));
    float w = fbm(vec2(uv.x, uv.y) + hb.xy, vec2(3.0, 2.0), 4) - 0.5;
    float ring = fract((bf * 0.85 + w * 0.35 + hb.z) * uP0.z + 0.18 * sin(uv.y * 2.0 * PI + hb.x * 6.283 + w * 2.0));
    float late = smoothstep(0.62, 0.9, ring) * (1.0 - smoothstep(0.9, 1.0, ring));
    float fine = gn(vec2(uv.x * 900.0, uv.y * 10.0), vec2(900.0, 10.0));
    float pore = smoothstep(0.82, 0.95, gn(vec2(uv.x * 400.0, uv.y * 40.0) + hb.yz, vec2(400.0, 40.0)));
    vec3 col = mix(uC1, uC0, sat(late * 0.65 + (hb.y - 0.5) * 0.5)) * (0.86 + fine * 0.24);
    col = mix(col, uC2, pore * 0.3);
    float gd = min(bf, 1.0 - bf) / n;
    float groove = 1.0 - smoothstep(uP0.y * 0.5, uP0.y * 0.5 + 0.0018, gd);
    col = mix(col, uC2, groove * 0.85);
    float wearN = smoothstep(1.0 - uWear * 0.5, 1.0, fbm(uv + 4.0, vec2(5.0), 5)); col = mix(col, col * 1.25 + 0.03, wearN * 0.4);
    S s; s.albedo = col;
    s.height = groove > 0.5 ? smoothstep(0.0, uP0.y * 0.5, gd) * 0.5 : 0.65 + (fine - 0.5) * 0.06 - late * 0.03 - pore * 0.05;
    s.rough = uP0.w + (fine - 0.5) * 0.06 + groove * 0.35 + pore * 0.1 + wearN * 0.15; s.ao = 1.0 - groove * 0.5; s.metal = 0.0; return s; }`,
});

// Painted drywall / plaster: roller stipple + orange peel, faint trowel ridges, eggshell sheen.
// p0: x base roughness, y stipple, z trowel, w scuffs
registerRecipe('env_paint', {
  defaults: { c0: 0xe2dccb, c1: 0xcfc8b4, c2: 0x8a806a, p0: [0.62, 1, 0.5, 0.4], wear: 0.3, meters: 1.5, bump: 1.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec4 st = vor(uv, vec2(150.0), 1.0); float stip = smoothstep(0.0, 0.5, st.y - st.x) * uP0.y;
    float peel = gn(uv * 260.0, vec2(260.0)) * 0.6 + gn(uv * 90.0 + 2.0, vec2(90.0)) * 0.4;
    float tr = fbm(uv + 1.3, vec2(4.0, 9.0), 4) * uP0.z;
    float m = fbm(uv, vec2(3.0), 6);
    float scuff = smoothstep(1.0 - uWear * 0.35, 1.0, fbm(uv + 4.0, vec2(9.0, 3.0), 5)) * uP0.w;
    vec3 col = mix(uC1, uC0, 0.62 + (m - 0.5) * 0.5) * (0.975 + peel * 0.04 + stip * 0.02);
    col = mix(col, uC2, scuff * 0.3);
    S s; s.albedo = col; s.height = peel * 0.35 + stip * 0.25 + tr * 0.15 + m * 0.05;
    s.rough = uP0.x + (peel - 0.5) * 0.08 - stip * 0.04 + scuff * 0.15; s.ao = 1.0 - (1.0 - stip) * 0.03; s.metal = 0.0; return s; }`,
});

// Canvas-jacketed pipe insulation with aluminium bands every so often (U runs along the pipe).
// p0: x bands per tile
registerRecipe('env_insulation', {
  defaults: { c0: 0xe8e2d2, c1: 0xcfc6b0, c2: 0x7a6a4a, c3: 0xb8bcc0, p0: [2, 0, 0, 0], wear: 0.5, meters: 1.0, bump: 2.0, size: 512, metal: true },
  glsl: `S surface(vec2 uv){
    float weave = gn(uv * 220.0, vec2(220.0));
    float bd = abs(fract(uv.x * uP0.x) - 0.5);
    float band = smoothstep(0.47, 0.475, bd);
    float m = fbm(uv, vec2(4.0), 5);
    float stain = smoothstep(0.55, 0.82, fbm(uv + 3.0, vec2(3.0, 2.0), 5)) * uWear;
    float wrin = ridged(uv + 0.5, vec2(6.0, 3.0), 3);
    vec3 col = mix(uC1, uC0, m) * (0.93 + weave * 0.1);
    col = mix(col, uC2, stain * 0.55);
    col = mix(col, uC3 * (0.9 + weave * 0.1), band);
    S s; s.albedo = col; s.height = weave * 0.25 + wrin * 0.2 + band * 0.5 + m * 0.05;
    s.rough = mix(0.92, 0.38, band); s.ao = 0.85 + wrin * 0.15; s.metal = band * 0.9; return s; }`,
});

// Industrial painted concrete floor (troweled, with swirl marks, oil stains and hairline cracks).
// p0: x swirl amount, y crack amount, z stain amount, w sealer gloss
registerRecipe('env_slab', {
  defaults: { c0: 0x8e8a82, c1: 0x6e6a62, c2: 0x34312c, c3: 0xa8a294, p0: [0.6, 0.5, 0.5, 0.5], wear: 0.4, meters: 2.5, bump: 1.6, size: 1024 },
  glsl: `S surface(vec2 uv){
    float m = fbm(uv, vec2(4.0), 7); float d = fbm(uv + 2.0, vec2(24.0), 4);
    vec2 sw = vec2(fbm(uv + 5.0, vec2(6.0), 3), fbm(uv + 8.0, vec2(6.0), 3)) - 0.5;
    float swirl = 0.5 + 0.5 * sin((length(fract(uv * 6.0 + sw * 0.6) - 0.5) * 18.0)) ;
    vec4 ag = vor(uv, vec2(90.0), 1.0); float agg = smoothstep(0.22, 0.08, ag.x) * step(0.7, ag.z);
    float pore = smoothstep(0.9, 0.98, gn(uv * 240.0, vec2(240.0)));
    vec3 ce = vorEdge(uv, vec2(3.0), 1.0); float crack = (1.0 - smoothstep(0.0, 0.004, ce.x)) * step(0.6, ce.y) * uP0.y * smoothstep(0.3, 0.6, fbm(uv + 5.0, vec2(3.0), 4));
    float stain = smoothstep(0.58, 0.82, fbm(uv + 9.0, vec2(2.0), 6)) * uP0.z;
    float oil = smoothstep(0.7, 0.78, fbm(uv + 13.0, vec2(5.0), 5)) * uP0.z;
    vec3 col = mix(uC1, uC0, m) * (0.92 + d * 0.12) * (0.97 + swirl * 0.05 * uP0.x);
    col = mix(col, uC3, agg * 0.25);
    col = mix(col, uC2, sat(stain * 0.35 + oil * 0.6 + crack * 0.8 + pore * 0.6));
    S s; s.albedo = col; s.height = m * 0.3 + d * 0.1 + swirl * 0.04 * uP0.x - pore * 0.4 - crack * 0.5;
    s.rough = mix(0.86, 0.48, uP0.w) + d * 0.08 - oil * 0.3 + pore * 0.1 - swirl * 0.05 * uP0.x; s.ao = 1.0 - pore * 0.4 - crack * 0.4; s.metal = 0.0; return s; }`,
});

// Glazed ceramic wall / pool tiles with thin grout, slight per-tile glaze waviness and crazing.
// (thin wrapper so the env set can tune it without touching the shared 'tiles' defaults)
registerRecipe('env_ceramic', {
  defaults: { c0: 0xeef0ea, c1: 0xb4b2a8, c2: 0x5a5444, c3: 0xe6ebe6, p0: [4, 4, 0.04, 0.06], p1: [0.05, 0.2, 0.14, 0.55], wear: 0.3, meters: 0.6, bump: 2.4, size: 1024 },
  glsl: `S surface(vec2 uv){
    vec2 t = uv * uP0.xy; vec2 c = mod(floor(t), uP0.xy), f = fract(t);
    vec2 e = min(f, 1.0 - f); float edge = min(e.x, e.y);
    float g = uP0.z; float grout = 1.0 - smoothstep(g * 0.5, g * 0.5 + 0.006, edge);
    float bev = smoothstep(g * 0.5, g * 0.5 + uP1.z * 0.3, edge);
    vec3 th = h32(c + 0.5);
    vec3 tcol = mix(uC0, uC3, step(0.5, mod(c.x + c.y, 2.0))) * (1.0 + (th.x - 0.5) * uP1.x * 2.0);
    float wav = fbm(uv + th.yz, vec2(uP0.x * 2.0, uP0.y * 2.0), 3);
    vec3 cr = vorEdge(uv + th.xy, vec2(uP0.x * 3.0, uP0.y * 3.0), 1.0);
    float craze = (1.0 - smoothstep(0.0, 0.004, cr.x)) * step(1.0 - uP1.y, th.z) * (1.0 - grout);
    float dirt = smoothstep(0.45, 0.8, fbm(uv + 6.0, vec2(4.0), 5)) * uWear;
    vec3 gcol = mix(uC1, uC2, sat(uP1.w * 0.6 + dirt * 0.6));
    vec3 col = mix(tcol * (1.0 - dirt * 0.1), gcol, grout); col = mix(col, uC2, craze * 0.35);
    S s; s.albedo = col; s.height = grout > 0.5 ? 0.15 : 0.2 + bev * 0.75 + (wav - 0.5) * 0.05;
    s.rough = mix(uP0.w + (wav - 0.5) * 0.05 + dirt * 0.12 + craze * 0.1, 0.9, grout); s.ao = 1.0 - grout * 0.45 - (1.0 - bev) * 0.15; s.metal = 0.0; return s; }`,
});

// Fixture atlas helper surface: plain satin plastic / enamel with a faint stipple (tinted by vertex colour)
registerRecipe('env_enamel', {
  defaults: { c0: 0xffffff, c1: 0xf0eee8, c2: 0x9a958a, p0: [0.38, 0.5, 0, 0], wear: 0.25, meters: 0.5, bump: 0.6, size: 512 },
  glsl: `S surface(vec2 uv){
    float st = gn(uv * 220.0, vec2(220.0)); float m = fbm(uv, vec2(4.0), 5);
    float scr = scratches(uv, 9.0, 0.4, 0.004) * uWear; float grime = smoothstep(0.6, 0.86, fbm(uv + 5.0, vec2(4.0), 5)) * uWear;
    vec3 col = mix(uC1, uC0, m) ; col = mix(col, uC2, grime * 0.25); col = mix(col, col * 0.85, scr * 0.5);
    S s; s.albedo = col; s.height = 0.5 + (st - 0.5) * 0.25 * uP0.y - scr * 0.2; s.rough = uP0.x + (st - 0.5) * 0.06 + grime * 0.2 + scr * 0.1; s.ao = 1.0; s.metal = 0.0; return s; }`,
});
