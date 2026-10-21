// Detailed world-surface recipes (GPU texture synthesis, see texsynth.js) used by materials.js for the shared
// wallpaper / carpet / ceiling materials. Every tile carries printed / woven / moulded PATTERN detail plus small-
// scale wear (ink voids, misregistration, blisters, pin holes, fly specks, lint, crumbs, burns, fissures, rust)
// in albedo + height (-> normal) + roughness. Large-scale dirt that must not repeat per tile (damp, leaks, traffic
// paths, handprints, stains) is added in world space by the baked-light material (bakedlight.js grimeGLSL).
import { registerRecipe } from './texsynth.js';

// ---------------------------------------------------------------------------------------------------------------
// Wallpaper. 0.53 m paper strips; motif cells per strip (cols) and per tile (rows), half-drop on odd columns.
// p0: x strips per tile, y cols per strip, z rows per tile, w motif strength
// p1: x style (0 Level 0 pin-stripe + chevron, 1 damask, 2 floral sprig, 3 trellis, 4 regency stripe),
//     y foxing / fly specks, z seam strength, w damage (blisters, pin holes, scuffs)
// c0 ground, c1 print ink, c2 dark (seams, outlines, dirt), c3 highlight ink
registerRecipe('lv_wallpaper', {
  defaults: { c0: 0xcdb262, c1: 0xa9904a, c2: 0x6a5528, c3: 0xdcc679, p0: [3, 8, 24, 1.6], p1: [0, 0.6, 1, 1], wear: 0.35, meters: 1.59, bump: 1.9, size: 1024 },
  glsl: `
  // x fill (main ink), y outline / fine line, z accent ink (second colour)
  vec3 wpMotif(float style, vec2 q, float ar, float odd){
    float ax = abs(q.x);
    if (style < 0.5) {
      float cu = q.x / ar + 0.5, cv = q.y + 0.5;
      float pd = min(cu, 1.0 - cu);
      float pins = 1.0 - smoothstep(0.012, 0.028, abs(pd - 0.035));
      float band = smoothstep(0.12, 0.2, pd) * (1.0 - smoothstep(0.32, 0.42, pd));
      float chev = abs(fract(cv + abs(cu - 0.5) * 0.9) - 0.5);
      float chevron = (1.0 - smoothstep(0.035, 0.065, chev)) * (1.0 - smoothstep(0.18, 0.26, abs(cu - 0.5))) * odd;
      float dotp = 1.0 - smoothstep(0.045, 0.075, length(vec2(cu - 0.5, cv - 0.5)));
      return vec3(band * 0.6, pins, max(chevron, dotp * (1.0 - odd) * 0.8));
    }
    if (style < 1.5) { // damask: mirrored medallion, rose heart, finial, scrolls, leaves, corner quatrefoils
      vec2 p = vec2(ax, q.y);
      float e = (length(p / vec2(0.2, 0.34)) - 1.0) * 0.2;
      vec2 pr = p - vec2(0.0, 0.03); float a = atan(pr.x, pr.y); float r = length(pr);
      float rose = 0.12 + 0.045 * cos(a * 6.0);
      float heart = 1.0 - smoothstep(rose - 0.006, rose + 0.006, r);
      float heartL = 1.0 - smoothstep(0.004, 0.009, abs(r - rose - 0.03));
      float body = (1.0 - smoothstep(-0.004, 0.004, e)) * (1.0 - heartL) * step(0.012, abs(r - rose - 0.03) + heart);
      float outline = 1.0 - smoothstep(0.004, 0.009, abs(e - 0.025));
      float fin = 1.0 - smoothstep(0.04, 0.05, length((p - vec2(0.0, 0.43)) / vec2(0.7, 1.3)));
      vec2 sc = p - vec2(0.31, -0.06); float sr = length(sc);
      float scroll = (1.0 - smoothstep(0.007, 0.014, abs(sr - 0.075 - atan(sc.y, sc.x) * 0.006))) * step(-0.02, sc.y + sc.x * 0.4);
      vec2 lf = p - vec2(0.17, -0.36); lf = mat2(0.8, -0.6, 0.6, 0.8) * lf;
      float leaf = 1.0 - smoothstep(0.9, 1.0, length(lf / vec2(0.035, 0.1)));
      float vein = (1.0 - smoothstep(0.002, 0.005, abs(lf.x))) * leaf;
      vec2 cq = vec2(ar * 0.5 - ax, 0.5 - abs(q.y)); float ca = atan(cq.y, cq.x); float cr = length(cq);
      float quat = 1.0 - smoothstep(0.0, 0.008, cr - (0.05 + 0.03 * abs(cos(ca * 2.0))));
      return vec3(max(max(body, heart * 0.55), max(leaf * (1.0 - vein), quat)), max(outline, max(scroll, heartL)), fin + heart * 0.45);
    }
    if (style < 2.5) { // floral sprig: five-petal flower, centre, two leaves, wavy stem
      vec2 p = q - vec2(0.0, 0.08); float a = atan(p.y, p.x); float r = length(p);
      float pet = 0.1 * (0.5 + 0.5 * abs(cos(a * 2.5)));
      float petal = 1.0 - smoothstep(pet - 0.005, pet + 0.005, r);
      float petalL = (1.0 - smoothstep(0.003, 0.007, abs(r - pet))) * step(0.03, r);
      float centre = 1.0 - smoothstep(0.022, 0.03, r);
      float sx = q.x - 0.025 * sin(q.y * 14.0);
      float stem = (1.0 - smoothstep(0.004, 0.008, abs(sx))) * step(q.y, -0.02) * step(-0.44, q.y);
      vec2 l1 = mat2(0.77, -0.64, 0.64, 0.77) * (q - vec2(0.065, -0.2)), l2 = mat2(0.77, 0.64, -0.64, 0.77) * (q - vec2(-0.06, -0.3));
      float leaf = max(1.0 - smoothstep(0.85, 1.0, length(l1 / vec2(0.028, 0.075))), 1.0 - smoothstep(0.85, 1.0, length(l2 / vec2(0.025, 0.065))));
      // small bud in the cell corners (forms the half-drop between sprigs)
      vec2 b = vec2(ar * 0.5 - ax, 0.5 - abs(q.y)); float bud = 1.0 - smoothstep(0.022, 0.03, length(b / vec2(1.0, 1.4)));
      return vec3(petal * (1.0 - centre), max(petalL, stem), max(centre, max(leaf * 1.5, bud)));
    }
    if (style < 3.5) { // trellis: double diamond lattice with rosettes on the crossings
      float dm = ax / (ar * 0.5) + abs(q.y) / 0.5;
      float l1 = 1.0 - smoothstep(0.012, 0.024, abs(dm - 1.0) * 0.5);
      float l2 = 1.0 - smoothstep(0.006, 0.014, abs(dm - 0.88) * 0.5);
      float ros = 1.0 - smoothstep(0.035, 0.045, length(q));
      vec2 cq = vec2(ar * 0.5 - ax, 0.5 - abs(q.y)); float cr = length(cq);
      float node = 1.0 - smoothstep(0.03, 0.04, cr);
      return vec3(ros * 0.8, max(l1, l2 * 0.7), max(node, ros * 0.6));
    }
    // regency stripe: wide satin band, pin-stripes at its borders, faint moire inside
    float cu = q.x / ar + 0.5;
    float wide = smoothstep(0.24, 0.26, cu) * (1.0 - smoothstep(0.74, 0.76, cu));
    float pin = (1.0 - smoothstep(0.006, 0.012, abs(cu - 0.2))) + (1.0 - smoothstep(0.006, 0.012, abs(cu - 0.8)));
    return vec3(wide, pin, wide * smoothstep(0.6, 0.9, sin((q.y + cu * 0.3) * 60.0) * 0.5 + 0.5) * 0.4);
  }
  S surface(vec2 uv){
    float strips = uP0.x, cols = uP0.y, rows = uP0.z, style = floor(uP1.x + 0.5);
    float sx = uv.x * strips; float si = mod(floor(sx), strips); float su = fract(sx);
    vec3 sh = h32(vec2(si, 3.0));
    float cx = su * cols; float ci = floor(cx); float cu = fract(cx);
    float odd = mod(ci, 2.0);
    float cv = fract(uv.y * rows + odd * 0.5);
    float ar = rows / (strips * cols);
    vec2 q = vec2((cu - 0.5) * ar, cv - 0.5);
    // the second ink is printed slightly off register; ink coverage is patchy (screen-printed roll)
    vec3 m = wpMotif(style, q, ar, odd);
    vec3 mo = wpMotif(style, q + vec2(0.006, -0.009), ar, odd);
    float inkN = gn(uv * 700.0, vec2(700.0)), inkB = fbm(uv + 1.7, vec2(14.0, 3.0), 3);
    float voids = smoothstep(0.22, 0.4, inkN * 0.7 + inkB * 0.5);
    float fill = m.x * voids, line = m.y * (0.65 + 0.35 * voids), acc = mo.z * voids;
    float fib = gn(uv * 520.0, vec2(520.0)) * 0.6 + gn(uv * vec2(180.0, 18.0) + 3.0, vec2(180.0, 18.0)) * 0.4;
    float lin = gn(uv * vec2(360.0, 90.0), vec2(360.0, 90.0)) * 0.5 + gn(uv * vec2(90.0, 360.0) + 5.0, vec2(90.0, 360.0)) * 0.5;
    float mott = fbm(uv + sh.xy * 3.0, vec2(5.0, 5.0), 5);
    float k = uP0.w;
    vec3 col = uC0 * (1.0 + (sh.z - 0.5) * 0.035);
    col = mix(col, uC1, fill * 0.36 * k * (0.8 + inkB * 0.4));
    col = mix(col, mix(uC1, uC2, 0.45), line * 0.5 * min(k, 1.2));
    col = mix(col, uC3, acc * 0.45 * k);
    col *= 1.0 - (1.0 - inkB) * 0.035;
    col *= 0.96 + (fib - 0.5) * 0.07 * uP1.w + (mott - 0.5) * 0.05 + (lin - 0.5) * 0.03;
    // seams: hairline gap, lifted edge, glue tide along the seam
    float sd = min(su, 1.0 - su);
    float gap = 1.0 - smoothstep(0.0008, 0.0026, sd);
    float lift = (1.0 - smoothstep(0.0026, 0.009, sd)) * (1.0 - gap);
    float glue = (1.0 - smoothstep(0.004, 0.02, sd)) * (0.5 + 0.5 * fbm(uv + 4.4, vec2(3.0, 40.0), 3));
    col = mix(col, uC2 * 0.85, gap * 0.32 * uP1.z);
    col *= 1.0 + lift * 0.035 * uP1.z;
    col = mix(col, col * vec3(0.9, 0.84, 0.7), glue * 0.18 * uP1.z);
    // foxing + fly specks
    float fox = smoothstep(0.74, 0.82, fbm(uv + 9.0, vec2(6.0), 5)) * uP1.y;
    col = mix(col, uC2, fox * 0.2);
    vec4 fs = vor(uv, vec2(60.0), 1.0);
    float speck = (1.0 - smoothstep(0.05, 0.11, fs.x)) * step(0.93, fs.z) * uP1.y;
    col = mix(col, uC2 * 0.35, speck * 0.75);
    // damage: blisters (paper lifted off the wall), pin holes with torn rims, scuffs, hairline scratches
    float dmg = uP1.w * (0.4 + uWear);
    vec4 bv = vor(uv + 0.31, vec2(6.0), 0.9);
    float br = 0.11 + 0.1 * bv.w;
    float blister = step(0.86, bv.z) * pow(sat(1.0 - bv.x / br), 1.5) * dmg;
    vec4 pv = vor(uv + 0.77, vec2(11.0), 1.0);
    float hole = step(0.9, pv.z) * (1.0 - smoothstep(0.012, 0.02, pv.x)) * dmg;
    float torn = step(0.9, pv.z) * (1.0 - smoothstep(0.02, 0.05, pv.x)) * (1.0 - hole) * dmg;
    float scr = scratches(uv * 2.0, 5.0, 0.45, 0.006) * uWear;
    col = mix(col, col * 1.06 + 0.01, blister * 0.35);
    col = mix(col, uC2 * 0.25, hole);
    col = mix(col, mix(col, vec3(0.86, 0.82, 0.7), 0.6), torn * 0.5);
    col = mix(col, col * 0.82, scr * 0.5);
    // dust settles in the emboss troughs
    float cav = sat(0.5 - lin) * 2.0;
    col *= 1.0 - cav * 0.03 * (0.5 + uWear);
    S s; s.albedo = col;
    s.height = 0.5 + (fib - 0.5) * 0.2 * uP1.w + (lin - 0.5) * 0.12 + (fill * 0.5 + line * 0.35 + acc * 0.3) * 0.14 * k
      - gap * 0.45 + lift * 0.14 + blister * 0.6 - hole * 0.5 - torn * 0.06 - scr * 0.08;
    s.rough = 0.86 - (fill * 0.6 + acc * 0.5 + line * 0.3) * 0.16 * k + (fib - 0.5) * 0.06 - glue * 0.06 * uP1.z - blister * 0.05;
    s.ao = 1.0 - gap * 0.55 - hole * 0.6 - cav * 0.04; s.metal = 0.0; return s; }`,
});

// ---------------------------------------------------------------------------------------------------------------
// Carpet. p0: x tufts per tile, y fleck amount, z pile shading, w matting
// p1: x style (0 damp cut pile, 1 patterned loop-pile office carpet, 2 berber loop), y pattern scale (motifs per
//     tile), z dirt (lint, crumbs, burns, small stains), w loop rows per tile (styles 1, 2)
// c0 base, c1 dark pile, c2 dirt / pattern dark, c3 flecks / pattern light
registerRecipe('lv_carpet', {
  defaults: { c0: 0xb0924f, c1: 0x8a6f38, c2: 0x4c3b1c, c3: 0xc8ab6a, p0: [300, 0.7, 0.8, 0.5], p1: [0, 4, 0.6, 160], wear: 0.35, meters: 1.0, bump: 1.5, size: 1024 },
  glsl: `
  // geometric office-carpet pattern: squares-in-squares with a diagonal dot lattice, x = dark ink, y = light ink
  vec2 cpPattern(vec2 uv, float n){
    vec2 c = uv * n; vec2 f = fract(c) - 0.5; vec2 id = floor(c);
    float sq = max(abs(f.x), abs(f.y));
    float frame = (1.0 - smoothstep(0.02, 0.035, abs(sq - 0.4))) + (1.0 - smoothstep(0.015, 0.03, abs(sq - 0.3)));
    float dia = abs(f.x) + abs(f.y);
    float core = 1.0 - smoothstep(0.1, 0.12, dia);
    vec2 g = fract(c * 4.0 + 0.5) - 0.5;
    float dots = (1.0 - smoothstep(0.12, 0.2, length(g))) * step(0.3, sq) * step(sq, 0.38);
    float alt = mod(id.x + id.y, 2.0);
    return vec2(sat(frame) * (0.6 + 0.4 * alt), max(core, dots * 0.8));
  }
  S surface(vec2 uv){
    float style = floor(uP1.x + 0.5);
    float fib = gn(uv * floor(uP0.x * 2.6), vec2(floor(uP0.x * 2.6)));
    float shade = fbm(uv, vec2(3.0), 5), shade2 = fbm(uv + 2.3, vec2(9.0, 7.0), 4), mat = fbm(uv + 4.1, vec2(4.0), 5);
    float pile, fleckA, fleckB, tone;
    vec3 col;
    if (style < 0.5) {
      vec4 v = vor(uv, vec2(uP0.x), 1.0);
      vec4 v2 = vor(uv + 0.37, vec2(floor(uP0.x * 0.71)), 1.0);
      float tuft = 1.0 - smoothstep(0.0, 0.9, v.x), tuft2 = 1.0 - smoothstep(0.0, 0.9, v2.x);
      pile = max(tuft, tuft2 * 0.85); tone = v.z; fleckA = step(1.0 - uP0.y * 0.05, v.w); fleckB = step(1.0 - uP0.y * 0.035, v2.w);
      col = mix(uC1, uC0, sat(0.55 + (shade - 0.5) * uP0.z * 1.5 + (shade2 - 0.5) * 0.4 + (tone - 0.5) * 0.3));
    } else {
      // loop pile: staggered rows of yarn loops; each loop a small raised ring with a dark core between loops
      float rows = floor(uP1.w * 0.5 + 0.5) * 2.0, lc = floor(rows * 1.3 + 0.5);
      vec2 lp = uv * vec2(lc, rows); float row = floor(lp.y);
      lp.x += mod(row, 2.0) * 0.5;
      vec2 lf = fract(lp) - 0.5; vec2 lid = mod(floor(lp), vec2(lc, rows));
      vec3 lh = h32(lid + 0.5);
      float lr = length(lf * vec2(1.0, 1.25));
      float loop = (1.0 - smoothstep(0.16, 0.42, abs(lr - 0.22))) * (0.75 + 0.25 * lh.x);
      float twist = 0.5 + 0.5 * sin(atan(lf.y, lf.x) * 3.0 + lh.y * 6.283);
      pile = loop * (0.85 + 0.15 * twist); tone = lh.z; fleckA = step(1.0 - uP0.y * 0.06, lh.x); fleckB = step(1.0 - uP0.y * 0.04, lh.y);
      col = mix(uC1, uC0, sat(0.6 + (shade - 0.5) * uP0.z + (shade2 - 0.5) * 0.3 + (tone - 0.5) * 0.35));
      if (style < 1.5) {
        vec2 pt = cpPattern(uv, floor(uP1.y + 0.5));
        col = mix(col, uC2, pt.x * 0.75);
        col = mix(col, uC3, pt.y * 0.7);
      } else {
        float heather = fbm(uv + 7.0, vec2(40.0), 2);
        col = mix(col, uC3, smoothstep(0.55, 0.75, heather) * 0.35);
      }
    }
    col = mix(col, uC3, fleckA * 0.55);
    col = mix(col, uC2, fleckB * 0.5);
    col *= 0.68 + pile * 0.4 + (fib - 0.5) * 0.14;
    float matted = smoothstep(0.52, 0.78, mat) * uP0.w;
    col = mix(col, col * vec3(0.86, 0.85, 0.82), matted);
    // dirt: grey lint fluff, crumbs, dark grit, cigarette burns (melted black core, brown halo), drink spots
    float d = uP1.z * (0.5 + uWear);
    vec4 cv = vor(uv + 0.13, vec2(48.0), 1.0);
    float lint = step(0.94, cv.z) * (1.0 - smoothstep(0.08, 0.22, cv.x)) * d;
    float crumb = step(0.965, cv.w) * (1.0 - smoothstep(0.05, 0.12, cv.x)) * d;
    vec4 gv = vor(uv + 0.71, vec2(130.0), 1.0);
    float grit = step(0.9, gv.z) * (1.0 - smoothstep(0.08, 0.2, gv.x)) * d;
    vec4 bv = vor(uv + 0.5, vec2(5.0), 0.8);
    float burnOn = step(0.9, bv.z) * d;
    float burnR = 0.07 + 0.05 * bv.w;
    float burnCore = (1.0 - smoothstep(burnR * 0.35, burnR * 0.55, bv.x)) * burnOn;
    float burnHalo = (1.0 - smoothstep(burnR * 0.5, burnR, bv.x + (fib - 0.5) * 0.03)) * burnOn;
    vec4 sv = vor(uv + 0.9, vec2(3.0), 0.9);
    float stR = 0.16 + 0.12 * sv.w; float sdist = sv.x + (fbm(uv + 2.0, vec2(12.0), 3) - 0.5) * 0.08;
    float spot = step(0.78, sv.z) * (1.0 - smoothstep(stR * 0.8, stR, sdist)) * d;
    float spotRing = step(0.78, sv.z) * (1.0 - smoothstep(0.0, 0.025, abs(sdist - stR * 0.9))) * d;
    col = mix(col, vec3(0.42, 0.41, 0.39), lint * 0.55);
    col = mix(col, vec3(0.62, 0.48, 0.3), crumb * 0.8);
    col = mix(col, uC2 * 0.4, grit * 0.6);
    col = mix(col, col * vec3(0.55, 0.45, 0.32), spot * 0.35 + spotRing * 0.45);
    col = mix(col, col * vec3(0.45, 0.32, 0.2), burnHalo * 0.7);
    col = mix(col, vec3(0.03, 0.025, 0.02), burnCore * 0.95);
    S s; s.albedo = col;
    s.height = pile * (0.8 - matted * 0.45) + (fib - 0.5) * 0.14 + crumb * 0.35 + lint * 0.2 - burnCore * 0.5 - burnHalo * 0.15 - spot * 0.06;
    s.rough = 0.97 - matted * 0.08 - burnCore * 0.45 - spot * 0.08; s.ao = 0.5 + pile * 0.5 - burnCore * 0.3; s.metal = 0.0; return s; }`,
});

// ---------------------------------------------------------------------------------------------------------------
// Fissured mineral-fibre drop-ceiling tiles in the white enamel T-bar grid: 4x4 tiles per texture (the material
// shuffles / rotates them per world tile); each tile carries half of the 24 mm flange on its borders.
// p0: x tiles per texture, y fissures, z pinholes, w per-tile tone; p1: x flange half-width (tile uv),
//     y kerf width, z yellowing / water marks, w flange enamel roughness. wear: chips, rust on the grid, dust
registerRecipe('lv_acoustic', {
  defaults: { c0: 0xe9e3cf, c1: 0xd2c9ae, c2: 0x9a8458, c3: 0xf1efe9, p0: [4, 0.9, 0.8, 0.012], p1: [0.02, 0.012, 0.6, 0.42], wear: 0.35, meters: 2.4, bump: 2.6, size: 1024 },
  glsl: `S surface(vec2 uv){
    float n = uP0.x; vec2 t = uv * n; vec2 ti = mod(floor(t), n); vec2 f = fract(t);
    vec3 th = h32(ti + 0.5); vec3 th2 = h32(ti + 7.5);
    vec2 e = min(f, 1.0 - f); float ed = min(e.x, e.y);
    float flange = 1.0 - smoothstep(uP1.x - 0.0015, uP1.x + 0.0015, ed);
    float fe = 1.0 - smoothstep(0.0, 0.004, abs(ed - uP1.x));
    float kerf = smoothstep(uP1.x, uP1.x + uP1.y, ed);
    // worm-hole fissures: two ridged layers warped along a random direction, plus short pits
    vec2 wv = vec2(fbm(uv + th.xy, vec2(8.0), 3), fbm(uv + th.yz + 4.0, vec2(8.0), 3)) - 0.5;
    float r1 = ridged(uv + wv * 0.03 + th.xy * 7.0, vec2(56.0), 2);
    float r2 = ridged(uv + wv * 0.02 + th.yz * 5.0 + 3.1, vec2(96.0), 2);
    float r3 = ridged(uv * vec2(1.0, 1.0) + th.zx * 3.0 + 1.7, vec2(150.0, 150.0), 1);
    float fis = smoothstep(0.86, 0.95, r1) * uP0.y * 0.8 + smoothstep(0.88, 0.97, r2) * uP0.y * 0.55 + smoothstep(0.92, 0.99, r3) * uP0.y * 0.35;
    float pin = smoothstep(0.84, 0.95, gn(uv * 360.0 + th.z * 9.0, vec2(360.0))) * uP0.z;
    float grain = gn(uv * 760.0, vec2(760.0)), grain2 = gn(uv * 240.0 + 2.0, vec2(240.0));
    float m = fbm(uv + th.xz, vec2(6.0), 4);
    vec3 col = mix(uC1, uC0, sat(0.62 + (m - 0.5) * 0.45 + (th.x - 0.5) * uP0.w * 16.0));
    col = mix(col, mix(col, uC2, 0.25), smoothstep(0.4, 1.0, th.y) * uP1.z * 0.25);
    col *= 1.0 - fis * 0.26 - pin * 0.32;
    col *= 0.97 + grain * 0.04 + (grain2 - 0.5) * 0.03;
    col *= mix(0.8, 1.0, kerf);
    // per-tile water marks: brown tide rings with a paler bleached centre on a few tiles
    vec2 sc = vec2(0.25) + th2.xy * 0.5; float sR = 0.14 + 0.22 * th2.z;
    float sd = length(f - sc) + (fbm(uv + th2.yx * 3.0, vec2(16.0), 3) - 0.5) * 0.12;
    float stOn = step(0.8, th.z) * uP1.z * (1.0 - flange);
    float sFill = (1.0 - smoothstep(sR * 0.85, sR, sd)) * stOn;
    float sRing = (1.0 - smoothstep(0.0, 0.018, abs(sd - sR))) * stOn + (1.0 - smoothstep(0.0, 0.012, abs(sd - sR * 0.66))) * stOn * step(0.5, th2.x);
    col = mix(col, col * vec3(0.93, 0.86, 0.7), sFill * 0.45);
    col = mix(col, col * vec3(0.62, 0.5, 0.32), sRing * 0.6);
    // mould dots near the stain, dust darkening near the kerf, chipped tile corners
    float mould = step(0.6, th2.y) * sFill * smoothstep(0.86, 0.95, gn(uv * 180.0 + 3.0, vec2(180.0)));
    col = mix(col, vec3(0.2, 0.22, 0.16), mould * 0.7);
    float dust = (1.0 - smoothstep(uP1.x, uP1.x + 0.05, ed)) * (1.0 - flange) * uWear;
    col *= 1.0 - dust * 0.18;
    vec2 cr = min(f, 1.0 - f); float cdist = length(cr - uP1.x);
    float chip = step(0.75, th2.z) * (1.0 - smoothstep(0.012, 0.03, cdist + (grain - 0.5) * 0.01)) * (1.0 - flange) * uWear * 1.5;
    col = mix(col, uC1 * 0.86, sat(chip));
    // T-bar: enamel, scratches, rust bloom along the flange, dust on the lip
    float sc2 = scratches(uv * 4.0, 6.0, 0.4, 0.01) * uWear;
    float rustN = fbm(uv + 6.0, vec2(24.0), 3);
    float rust = smoothstep(0.66, 0.8, rustN) * uWear * flange;
    vec3 fl = uC3 * (0.97 + grain * 0.03) * (1.0 - sc2 * 0.15);
    fl = mix(fl, vec3(0.5, 0.3, 0.14), rust * 0.6);
    fl *= 1.0 - (1.0 - smoothstep(0.0, uP1.x * 0.5, ed)) * 0.12 * uWear;
    col = mix(col, fl, flange);
    col *= 1.0 - fe * 0.25;
    S s; s.albedo = col;
    float tileH = 0.5 - (1.0 - kerf) * 0.22 - fis * 0.3 - pin * 0.28 + grain * 0.04 + (m - 0.5) * 0.04 - sat(chip) * 0.25 + sFill * 0.02;
    s.height = mix(tileH, 0.62 + rust * 0.03, flange) - fe * 0.05;
    s.rough = mix(0.98, uP1.w + sc2 * 0.2 + rust * 0.4, flange);
    s.ao = mix((1.0 - fis * 0.45 - pin * 0.35) * mix(0.8, 1.0, kerf) * (1.0 - dust * 0.2), 1.0, flange) * (1.0 - fe * 0.3);
    s.metal = 0.0; return s; }`,
});
