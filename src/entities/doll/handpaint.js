// R.O.O.M. — hand-painted canvas texture kit (art direction: broad soft brush strokes, large slow value
// shifts, painted edge wear, uneven line weight, very little high-frequency noise). Used by the cosmetic
// models (hats.js), the cloth rags (cloth.js), the eyes (eyes.js) and the customizer station props.
//
//   ptex(key, w, h, draw, opts)  cached CanvasTexture (sRGB, mipmapped, optional repeat)
//   P.* painting helpers on a 2D context: wash, strokes, blotches, wear, stitches, weave, drips, text
//   heightToNormal(canvas)      tangent-space normal map from a painted height canvas
//   FM.* fabric / painted metal / wood / glazed / rubber material factories (MeshPhysical, cached)
import * as THREE from 'three';
import { RNG } from '../../core/rng.js';
import { font } from '../../ui/fonts.js';

const PI = Math.PI, TAU = PI * 2;
const TEX = new Map();
export const css = (hex, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
export const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(0xfff1d2), k); else c.lerp(new THREE.Color(0x2a3430), -k);   // lights go warm, darks go olive
  return c.getHex();
};
export const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// cached CanvasTexture; draw(g, w, h, rng)
export function ptex(key, w, h, draw, { repeat = null, srgb = true, aniso = 4 } = {}) {
  if (TEX.has(key)) return TEX.get(key);
  const c = mkCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h, new RNG(hashKey(key)));
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.name = key;
  TEX.set(key, t);
  return t;
}
function hashKey(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// tangent-space normal map from a height canvas (white = high)
export function heightToNormal(key, src, strength = 2, { repeat = null } = {}) {
  if (TEX.has(key)) return TEX.get(key);
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const c = mkCanvas(w, h), g = c.getContext('2d'), out = g.createImageData(w, h), o = out.data;
  const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  TEX.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// painting helpers (all take the 2D context first)
export const P = {
  // flat base with a slow two-tone vertical / diagonal value shift (the "large slow value shift")
  wash(g, w, h, hex, { k = 0.12, angle = 0.4 } = {}) {
    g.fillStyle = css(hex); g.fillRect(0, 0, w, h);
    const x = Math.cos(angle) * w, y = Math.sin(angle) * h;
    const gr = g.createLinearGradient(w / 2 - x / 2, h / 2 - y / 2, w / 2 + x / 2, h / 2 + y / 2);
    gr.addColorStop(0, css(shade(hex, k), 0.55)); gr.addColorStop(0.5, css(hex, 0)); gr.addColorStop(1, css(shade(hex, -k), 0.55));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  },
  // broad soft brush strokes in nearby tints
  strokes(g, w, h, hex, rng, { n = 60, len = 0.25, wid = 0.05, k = 0.08, alpha = 0.18, angle = null, jitter = 0.6 } = {}) {
    g.save(); g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = angle == null ? rng.next() * TAU : angle + (rng.next() - 0.5) * jitter;
      const L = len * w * (0.5 + rng.next()), x = rng.next() * w, y = rng.next() * h;
      g.strokeStyle = css(shade(hex, (rng.next() * 2 - 1) * k), alpha * (0.5 + rng.next()));
      g.lineWidth = wid * w * (0.5 + rng.next());
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (rng.next() - 0.5) * L * 0.2, y + Math.sin(a) * L * 0.5 + (rng.next() - 0.5) * L * 0.2, x + Math.cos(a) * L, y + Math.sin(a) * L);
      g.stroke();
    }
    g.restore();
  },
  // soft painted blotches (stains, damp, grime)
  blotches(g, w, h, hex, rng, { n = 8, r = 0.15, alpha = 0.18 } = {}) {
    for (let i = 0; i < n; i++) {
      const x = rng.next() * w, y = rng.next() * h, R = r * w * (0.4 + rng.next());
      const gr = g.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, css(hex, alpha)); gr.addColorStop(0.6, css(hex, alpha * 0.5)); gr.addColorStop(1, css(hex, 0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, R, R * (0.6 + rng.next() * 0.6), rng.next() * PI, 0, TAU); g.fill();
    }
  },
  // painted edge wear along the top / bottom borders (lighter chips, darker crevice line)
  edgeWear(g, w, h, rng, { light = 0xfff1d2, dark = 0x3e4a3f, top = true, bottom = true, amt = 1 } = {}) {
    const band = (y0, dir) => {
      for (let i = 0; i < 40 * amt; i++) {
        const x = rng.next() * w, ww = (0.01 + rng.next() * 0.05) * w, hh = (0.004 + rng.next() * 0.02) * h;
        g.fillStyle = css(light, 0.15 + rng.next() * 0.3);
        g.beginPath(); g.ellipse(x, y0 + dir * hh * 0.7, ww, hh, 0, 0, TAU); g.fill();
      }
      const gr = g.createLinearGradient(0, y0, 0, y0 + dir * h * 0.06);
      gr.addColorStop(0, css(dark, 0.35)); gr.addColorStop(1, css(dark, 0));
      g.fillStyle = gr; g.fillRect(0, Math.min(y0, y0 + dir * h * 0.06), w, h * 0.06);
    };
    if (top) band(0, 1);
    if (bottom) band(h, -1);
  },
  // chipped paint flecks showing a primer / metal colour
  chips(g, w, h, hex, rng, { n = 30, s = 0.012 } = {}) {
    for (let i = 0; i < n; i++) {
      const x = rng.next() * w, y = rng.next() * h, r = s * w * (0.4 + rng.next() * 1.4);
      g.fillStyle = css(hex, 0.75);
      g.beginPath();
      for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU, rr = r * (0.5 + rng.next() * 0.7); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7); }
      g.closePath(); g.fill();
    }
  },
  // running stitches along a polyline [[x, y], ...] (uneven, hand sewn)
  stitches(g, pts, rng, { col = 0xf3e6c8, len = 7, gap = 5, wid = 2, alpha = 0.9 } = {}) {
    g.save(); g.lineCap = 'round'; g.strokeStyle = css(col, alpha); g.lineWidth = wid;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      for (let d = 0; d < L; d += len + gap) {
        const a = d + (rng.next() - 0.5) * 1.5, b = Math.min(L, d + len * (0.8 + rng.next() * 0.4));
        const o = (rng.next() - 0.5) * 1.2;
        g.beginPath(); g.moveTo(x0 + ux * a - uy * o, y0 + uy * a + ux * o); g.lineTo(x0 + ux * b - uy * o, y0 + uy * b + ux * o); g.stroke();
      }
    }
    g.restore();
  },
  // woven cloth: soft warp / weft lines (low contrast)
  weave(g, w, h, hex, rng, { pitch = 4, k = 0.09, alpha = 0.35 } = {}) {
    g.save();
    for (let y = 0; y < h; y += pitch) { g.fillStyle = css(shade(hex, (rng.next() - 0.5) * k * 2), alpha * 0.6); g.fillRect(0, y, w, pitch * 0.5); }
    for (let x = 0; x < w; x += pitch) { g.fillStyle = css(shade(hex, (rng.next() - 0.5) * k * 2 - k * 0.5), alpha * 0.45); g.fillRect(x, 0, pitch * 0.5, h); }
    g.restore();
  },
  // paint drips running down from y0
  drips(g, w, h, hex, rng, { n = 6, y0 = 0, maxLen = 0.4, wid = 0.03 } = {}) {
    g.save(); g.fillStyle = css(hex, 0.95);
    for (let i = 0; i < n; i++) {
      const x = rng.next() * w, L = (0.08 + rng.next() * maxLen) * h, ww = wid * w * (0.5 + rng.next());
      g.beginPath(); g.moveTo(x - ww, y0); g.lineTo(x + ww, y0); g.lineTo(x + ww * 0.6, y0 + L); g.arc(x, y0 + L, ww * 0.75, 0, PI); g.closePath(); g.fill();
    }
    g.restore();
  },
  // hand-lettered text (Jolly Lodger) with a wobble per glyph
  text(g, s, x, y, px, hex, rng, { align = 'center', slot = 'note', wobble = 0.05, alpha = 1, maxW = 0 } = {}) {
    g.save(); g.font = font(slot, px); g.fillStyle = css(hex, alpha); g.textBaseline = 'middle';
    let total = 0; const ws = [...s].map((ch) => { const m = g.measureText(ch).width; total += m; return m; });
    let k = maxW && total > maxW ? maxW / total : 1;
    g.font = font(slot, px * k);
    total *= k;
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    [...s].forEach((ch, i) => {
      g.save(); g.translate(cx + ws[i] * k / 2, y + (rng.next() - 0.5) * px * 0.06); g.rotate((rng.next() - 0.5) * wobble * 2);
      g.textAlign = 'center'; g.fillText(ch, 0, 0); g.restore();
      cx += ws[i] * k;
    });
    g.restore();
  },
  // plaid / tartan: crossing bands
  plaid(g, w, h, base, bands, rng, { alpha = 0.55 } = {}) {
    g.fillStyle = css(base); g.fillRect(0, 0, w, h);
    for (const [pos, wid, hex, a] of bands) {
      g.fillStyle = css(hex, (a ?? alpha) * 0.8); g.fillRect(pos * w, 0, wid * w, h);
      g.fillStyle = css(hex, (a ?? alpha) * 0.8); g.fillRect(0, pos * h, w, wid * h);
    }
    void rng;
  },
  // horizontal stripes
  stripes(g, w, h, list, { wobble = 0, rng = null } = {}) {
    for (const [y0, hh, hex, a] of list) {
      g.fillStyle = css(hex, a ?? 1);
      if (!wobble) { g.fillRect(0, y0 * h, w, hh * h); continue; }
      g.beginPath(); g.moveTo(0, y0 * h);
      for (let x = 0; x <= w; x += w / 16) g.lineTo(x, y0 * h + (rng.next() - 0.5) * wobble * h);
      for (let x = w; x >= 0; x -= w / 16) g.lineTo(x, (y0 + hh) * h + (rng.next() - 0.5) * wobble * h);
      g.closePath(); g.fill();
    }
  },
};

// ---------------------------------------------------------------------------
// material factories (cached by key)
const MATS = new Map();
export function cachedMat(key, fn) { if (!MATS.has(key)) MATS.set(key, fn()); return MATS.get(key); }
export const FM = {
  // woven cloth / felt: high roughness, sheen tinted by the fibre colour
  fabric(key, map, { normalMap = null, nScale = 0.8, sheen = 0.7, color = 0xffffff, side = THREE.FrontSide, alphaTest = 0, rough = 0.92 } = {}) {
    return cachedMat('fab_' + key, () => new THREE.MeshPhysicalMaterial({
      name: 'fabric_' + key, color, map, normalMap, normalScale: new THREE.Vector2(nScale, nScale), roughness: rough, metalness: 0,
      sheen, sheenRoughness: 0.55, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xfff0d8), 0.5), side, alphaTest, transparent: false,
    }));
  },
  // painted metal with chipped edges (map carries the chips), satin
  paintedMetal(key, map, { rough = 0.62, metal = 0.25, cc = 0.15, normalMap = null } = {}) {
    return cachedMat('pm_' + key, () => new THREE.MeshPhysicalMaterial({
      name: 'paintedmetal_' + key, map, normalMap, roughness: rough, metalness: metal, clearcoat: cc, clearcoatRoughness: 0.5, envMapIntensity: 0.9,
    }));
  },
  bare(key, color, { rough = 0.38, metal = 1 } = {}) {
    return cachedMat('bare_' + key, () => new THREE.MeshStandardMaterial({ name: 'bare_' + key, color, roughness: rough, metalness: metal, envMapIntensity: 1.1 }));
  },
  // glazed / lacquered (party hat card, porcelain, enamel)
  glazed(key, map, { rough = 0.4, cc = 0.6, color = 0xffffff } = {}) {
    return cachedMat('gl_' + key, () => new THREE.MeshPhysicalMaterial({ name: 'glazed_' + key, map, color, roughness: rough, clearcoat: cc, clearcoatRoughness: 0.3 }));
  },
  plain(key, color, { rough = 0.8, metal = 0, sheen = 0, cc = 0, emissive = 0, ei = 0 } = {}) {
    return cachedMat('pl_' + key, () => new THREE.MeshPhysicalMaterial({ name: 'plain_' + key, color, roughness: rough, metalness: metal, sheen, sheenColor: new THREE.Color(color), clearcoat: cc, emissive, emissiveIntensity: ei }));
  },
  glass(key, { tint = 0xdfeee8, opacity = 0.22 } = {}) {
    return cachedMat('glass_' + key, () => {
      const m = new THREE.MeshPhysicalMaterial({
        name: 'glass_' + key, color: tint, roughness: 0.06, metalness: 0, transparent: true, opacity, clearcoat: 1, clearcoatRoughness: 0.05,
        specularIntensity: 1, ior: 1.5, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide,
      });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
          float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.4);
          diffuseColor.a = clamp(${opacity.toFixed(3)} + fres * 0.65 + dot(outgoingLight, vec3(0.3)) * 0.5, 0.0, 0.9);
          #include <opaque_fragment>`);
      };
      m.customProgramCacheKey = () => 'hp_glass_' + opacity.toFixed(3);
      return m;
    });
  },
};

// ---------------------------------------------------------------------------
// a few shared painted textures
export const TX = {
  // painted steel: base colour, broad strokes, chipped edges showing dark primer and bright metal
  paintedSteel(hex, seed = 1) {
    return ptex('steel_' + hex.toString(16) + '_' + seed, 256, 256, (g, w, h, r) => {
      P.wash(g, w, h, hex, { k: 0.1 });
      P.strokes(g, w, h, hex, r, { n: 50, len: 0.4, wid: 0.06, k: 0.07, alpha: 0.2, angle: 0, jitter: 0.25 });
      P.blotches(g, w, h, 0x4a3a28, r, { n: 5, r: 0.2, alpha: 0.1 });
      P.chips(g, w, h, 0x3a3532, r, { n: 18, s: 0.012 });
      P.chips(g, w, h, 0xb8b2a6, r, { n: 10, s: 0.006 });
      P.edgeWear(g, w, h, r, { amt: 0.8 });
    });
  },
  wood(hex = 0x9a6b40, seed = 1) {
    return ptex('wood_' + hex.toString(16) + '_' + seed, 256, 256, (g, w, h, r) => {
      P.wash(g, w, h, hex, { k: 0.08, angle: PI / 2 });
      for (let i = 0; i < 26; i++) {
        const y = r.next() * h, a = 0.12 + r.next() * 0.2;
        g.strokeStyle = css(shade(hex, -0.25 - r.next() * 0.2), a); g.lineWidth = 1 + r.next() * 2.5;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 + (r.next() - 0.5) * 2);
        g.stroke();
      }
      P.strokes(g, w, h, hex, r, { n: 30, len: 0.5, wid: 0.04, k: 0.1, alpha: 0.15, angle: 0, jitter: 0.1 });
      P.blotches(g, w, h, 0x3e2a18, r, { n: 3, r: 0.12, alpha: 0.18 });
    });
  },
  // generic woven fabric in a colour (with a little grime)
  cloth(hex, seed = 1, { pitch = 4 } = {}) {
    return ptex('cloth_' + hex.toString(16) + '_' + seed + '_' + pitch, 256, 256, (g, w, h, r) => {
      P.wash(g, w, h, hex, { k: 0.1 });
      P.weave(g, w, h, hex, r, { pitch, k: 0.08, alpha: 0.4 });
      P.strokes(g, w, h, hex, r, { n: 30, len: 0.4, wid: 0.06, k: 0.08, alpha: 0.12 });
      P.blotches(g, w, h, 0x5a4a30, r, { n: 4, r: 0.18, alpha: 0.1 });
    }, { repeat: [1, 1] });
  },
};
