// Poolrooms physics props (dynamic, networked through world.customModel) and their buoyancy:
// sun loungers, monobloc chairs, inflatable swim rings, kickboards, pool noodles, beach balls,
// inflatable float mats and folded towels. Built from detailed procedural geometry + texsynth
// materials; templates are cached and instanced (geometry shared).
import * as THREE from 'three';
import * as Synth from '../../../gfx/texsynth.js';
import { Mesher } from './geo.js';

const TEMPLATES = new Map();
const mats = new Map();
function mat(key, fn) { if (!mats.has(key)) mats.set(key, fn()); return mats.get(key); }

const M = {
  plasticWhite: () => mat('pw', () => Synth.pbrMaterial('plastic', { c0: 0xf1f0ea, c1: 0xe2dfd2, c2: 0x8a887a, p0: [0.36, 0.5, 0, 0], wear: 0.35, size: 512, repeat: [2, 2], name: 'pool_plastic_white' })),
  plasticGrey: () => mat('pg', () => Synth.pbrMaterial('plastic', { c0: 0x6f7476, c1: 0x5e6366, c2: 0x2a2c2c, p0: [0.5, 0.6, 0, 0], wear: 0.3, size: 256, repeat: [2, 2], name: 'pool_plastic_grey' })),
  vinyl: () => mat('vin', () => {
    const m = Synth.pbrMaterial('vinyl', { c0: 0xffffff, c1: 0xf4f4f4, p0: [240, 0.22, 0, 0], wear: 0.1, size: 256, repeat: [3, 3], name: 'pool_vinyl', physical: true, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    m.vertexColors = true;
    return m;
  }),
  foam: () => mat('foam', () => {
    const m = Synth.pbrMaterial('stucco', { c0: 0xffffff, c1: 0xf0f0f0, c2: 0xb0b0b0, p0: [0.88, 0, 0, 0], wear: 0.25, size: 256, repeat: [3, 3], name: 'pool_foam' });
    m.vertexColors = true;
    return m;
  }),
  terry: () => mat('terry', () => {
    const m = Synth.pbrMaterial('fabric', { c0: 0xffffff, c1: 0xf0f0f0, c2: 0xdddddd, p0: [90, 90, 0, 1], p1: [0.4, 0, 0, 0], wear: 0.1, size: 256, repeat: [2, 2], name: 'pool_terry' });
    m.vertexColors = true;
    return m;
  }),
  rubber: () => mat('rub', () => Synth.pbrMaterial('rubber', { c0: 0x2a2c2e, c1: 0x34373a, c2: 0x56585a, size: 256, repeat: [2, 2], name: 'pool_wheel' })),
  floatPlastic: () => mat('fp', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, name: 'pool_rope_float' })),
};

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  geo.userData.shared = true;
  return m;
}

function geoOf(fn, colors = false) {
  const B = new Mesher({ seg: 2 });
  fn(B);
  const g = B.build();
  if (colors) {
    // tint attribute doubles as vertex colour
    g.setAttribute('color', g.attributes.aTint.clone());
  }
  g.deleteAttribute('aTint');
  return g;
}

// rounded slab (plan-view rounded rectangle prism with caps), centred
function slab(B, cx, cy, cz, w, h, d, r = 0.02) {
  B.roundPrism(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, cy - h / 2, cy + h / 2, r, 3, { top: true, bottom: true });
}

// ---------------------------------------------------------------------------
const DEFS = {
  pool_lounger: {
    mass: 9, material: 'plastic', halfHeight: 0.24, buoy: 1.4, floatOffset: 0.05,
    build() {
      const g = new THREE.Group();
      const geo = geoOf((B) => {
        // frame rails
        const L = 1.95, Wd = 0.68, yb = 0.33;
        for (const sz of [-1, 1]) {
          slab(B, 0, yb - 0.24, sz * (Wd / 2 - 0.025), L, 0.07, 0.045, 0.018);
        }
        // seat slats (flat part from x=-0.95 .. 0.3)
        for (let k = 0; k < 14; k++) {
          const x = -0.92 + k * 0.088;
          slab(B, x, yb - 0.2, 0, 0.07, 0.022, Wd - 0.05, 0.01);
        }
        // raised backrest (x from 0.32 to 0.98, tilted)
        const ang = 0.72;
        const back = new Mesher({ seg: 2 });
        for (let k = 0; k < 7; k++) slab(back, 0.04 + k * 0.088, 0, 0, 0.07, 0.022, Wd - 0.06, 0.01);
        slab(back, 0.32, -0.025, -(Wd / 2 - 0.03), 0.66, 0.04, 0.035, 0.012);
        slab(back, 0.32, -0.025, (Wd / 2 - 0.03), 0.66, 0.04, 0.035, 0.012);
        const bg = back.build();
        bg.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0.3, yb - 0.19, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang), new THREE.Vector3(1, 1, 1)));
        B.append(bg, new THREE.Matrix4());
        // backrest strut
        B.tube([new THREE.Vector3(0.62, yb - 0.25, -0.2), new THREE.Vector3(0.66, yb - 0.02, -0.2)], 0.015, 6);
        B.tube([new THREE.Vector3(0.62, yb - 0.25, 0.2), new THREE.Vector3(0.66, yb - 0.02, 0.2)], 0.015, 6);
        // legs (foot end) with flared feet
        for (const sz of [-1, 1]) {
          B.tube([new THREE.Vector3(-0.9, yb - 0.26, sz * 0.3), new THREE.Vector3(-0.92, -0.2, sz * 0.31)], 0.026, 8);
          slab(B, -0.92, -0.232, sz * 0.31, 0.09, 0.016, 0.06, 0.008);
          B.tube([new THREE.Vector3(0.62, yb - 0.26, sz * 0.3), new THREE.Vector3(0.64, -0.14, sz * 0.31)], 0.026, 8);
        }
      });
      g.add(mesh(geo, M.plasticWhite()));
      const wheels = geoOf((B) => {
        for (const sz of [-1, 1]) {
          const m = new THREE.Matrix4().compose(new THREE.Vector3(0.66, -0.17, sz * 0.335), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1));
          B.lathe([[0.0, -0.022], [0.06, -0.022], [0.07, -0.012], [0.07, 0.012], [0.06, 0.022], [0.0, 0.022]], 18, m);
        }
      });
      g.add(mesh(wheels, M.rubber()));
      return {
        object: g,
        colliders: [
          { type: 'box', size: [1.9, 0.07, 0.66], pos: [-0.2, 0.12, 0] },
          { type: 'box', size: [1.7, 0.3, 0.6], pos: [-0.1, -0.08, 0] },
          { type: 'box', size: [0.7, 0.05, 0.62], pos: [0.62, 0.36, 0], rot: [0, 0, 0.72] },
        ],
      };
    },
  },
  pool_chair: {
    mass: 2.6, material: 'plastic', halfHeight: 0.42, buoy: 1.5, floatOffset: 0.1,
    build() {
      const g = new THREE.Group();
      const geo = geoOf((B) => {
        const sy = 0.02; // seat height relative to origin (origin 0.42 above floor)
        // dished seat
        B.param(10, 10, (fu, fv) => {
          const x = (fu - 0.5) * 0.46, z = (fv - 0.5) * 0.44;
          const dish = -0.025 * (1 - (2 * fu - 1) ** 2) * (1 - (2 * fv - 1) ** 2);
          return [x, sy + dish, z, 0, 1, 0, x, z];
        });
        B.param(10, 10, (fu, fv) => {
          const x = (fu - 0.5) * 0.46, z = (fv - 0.5) * 0.44;
          return [x, sy - 0.03, z, 0, -1, 0, x, z];
        });
        // seat rim
        B.roundPrism(-0.235, -0.225, 0.235, 0.225, sy - 0.035, sy + 0.004, 0.06, 4);
        // curved back with three slots (strips)
        for (let k = 0; k < 4; k++) {
          const z0 = -0.2 + k * 0.105, z1 = z0 + 0.085;
          B.param(4, 8, (fu, fv) => {
            const z = z0 + (z1 - z0) * fu, y = sy + 0.06 + fv * 0.42;
            const bend = 0.06 * (z / 0.22) ** 2;
            const x = 0.21 + fv * 0.06 + bend;
            return [x, y, z, -0.97, 0.1, -z * 0.6, z, y];
          });
          B.param(4, 8, (fu, fv) => {
            const z = z0 + (z1 - z0) * fu, y = sy + 0.06 + fv * 0.42;
            const bend = 0.06 * (z / 0.22) ** 2;
            const x = 0.235 + fv * 0.06 + bend;
            return [x, y, z, 0.97, -0.1, z * 0.6, z, y];
          });
        }
        B.tube([new THREE.Vector3(0.28, sy + 0.49, -0.24), new THREE.Vector3(0.3, sy + 0.5, 0), new THREE.Vector3(0.28, sy + 0.49, 0.24)], 0.02, 8);
        // armrests
        for (const sz of [-1, 1]) B.tube([new THREE.Vector3(0.22, sy + 0.22, sz * 0.26), new THREE.Vector3(0.0, sy + 0.2, sz * 0.27), new THREE.Vector3(-0.2, sy + 0.17, sz * 0.25), new THREE.Vector3(-0.21, sy, sz * 0.24)], 0.022, 8);
        // splayed legs
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          B.tube([new THREE.Vector3(sx * 0.19, sy - 0.02, sz * 0.19), new THREE.Vector3(sx * 0.24, -0.41, sz * 0.24)], 0.024, 8);
        }
      });
      g.add(mesh(geo, M.plasticWhite()));
      return {
        object: g,
        colliders: [
          { type: 'box', size: [0.48, 0.05, 0.48], pos: [0, 0.0, 0] },
          { type: 'box', size: [0.06, 0.46, 0.48], pos: [0.25, 0.26, 0] },
          { type: 'box', size: [0.46, 0.38, 0.46], pos: [0, -0.22, 0] },
        ],
      };
    },
  },
  pool_ring: {
    mass: 1.0, material: 'rubber', halfHeight: 0.1, buoy: 3.2, floatOffset: 0.03,
    variants: [[0xe8402f, 0xf4f1ea], [0xf2a91e, 0xf4f1ea], [0x2c86d8, 0xf4f1ea], [0xec6aa6, 0xffffff]],
    build(o) {
      const v = this.variants[(o.variant ?? 0) % this.variants.length];
      const ca = new THREE.Color(v[0]), cb = new THREE.Color(v[1]);
      const geo = geoOf((B) => {
        const R = 0.31, r = 0.1, segs = 48, rs = 16;
        const base = B.vcount;
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const col = Math.floor((i / segs) * 8 + 0.0001) % 2 ? ca : cb;
          for (let k = 0; k <= rs; k++) {
            const b = (k / rs) * Math.PI * 2;
            const swell = 1 + 0.04 * Math.sin(a * 8) ** 2;
            const rr = r * swell;
            const cx = Math.cos(a) * (R + rr * Math.cos(b)), cz = Math.sin(a) * (R + rr * Math.cos(b)), cy = rr * Math.sin(b) * 0.92;
            B.setTint(col.r, col.g, col.b);
            B.vert(cx, cy, cz, Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b), (i / segs) * 4, k / rs);
          }
        }
        for (let i = 0; i < segs; i++) for (let k = 0; k < rs; k++) {
          const a = base + i * (rs + 1) + k, b2 = a + 1, c = a + rs + 1, d = c + 1;
          B.tri(a, b2, c); B.tri(b2, d, c);
        }
        // seam lines (thin raised strips) + valve
        B.setTint(cb.r * 0.9, cb.g * 0.9, cb.b * 0.9);
        const vm = new THREE.Matrix4().compose(new THREE.Vector3(R + r * 0.98, 0.0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2), new THREE.Vector3(1, 1, 1));
        B.lathe([[0.0, 0.0], [0.02, 0.0], [0.02, 0.012], [0.012, 0.016], [0.012, 0.03], [0.0, 0.032]], 12, vm);
      }, true);
      const g = new THREE.Group();
      g.add(mesh(geo, M.vinyl()));
      return { object: g, colliders: [{ type: 'cylinder', radius: 0.41, height: 0.2, pos: [0, 0, 0] }] };
    },
  },
  kickboard: {
    mass: 1.0, material: 'rubber', halfHeight: 0.02, buoy: 4, floatOffset: 0.012,
    variants: [0x2a7ed6, 0xf4c21c, 0xe2462e, 0x2bb4a0],
    build(o) {
      const c = new THREE.Color(this.variants[(o.variant ?? 0) % this.variants.length]);
      const geo = geoOf((B) => {
        B.setTint(c.r, c.g, c.b);
        // rounded nose + square tail, bevelled foam slab
        const ring = [];
        const n = 28;
        for (let k = 0; k <= n; k++) {
          const a = -Math.PI / 2 + (k / n) * Math.PI;
          ring.push([0.12 + Math.cos(a) * 0.15, Math.sin(a) * 0.15]);
        }
        ring.push([-0.2, 0.15], [-0.23, 0.13], [-0.24, 0.0], [-0.23, -0.13], [-0.2, -0.15]);
        const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
        const shape = new THREE.Shape(pts);
        const eg = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 });
        eg.rotateX(Math.PI / 2);
        eg.translate(0, 0.015, 0);
        eg.computeVertexNormals();
        B.append(eg, new THREE.Matrix4());
      }, true);
      const g = new THREE.Group();
      g.add(mesh(geo, M.foam()));
      return { object: g, colliders: [{ type: 'box', size: [0.52, 0.045, 0.31], pos: [0.02, 0, 0] }] };
    },
  },
  pool_noodle: {
    mass: 1.0, material: 'rubber', halfHeight: 0.04, buoy: 4, floatOffset: 0.01,
    variants: [0xf2c21a, 0x37c26a, 0xe0479c, 0x2f8be0, 0xf07a22],
    build(o) {
      const c = new THREE.Color(this.variants[(o.variant ?? 0) % this.variants.length]);
      const geo = geoOf((B) => {
        B.setTint(c.r, c.g, c.b);
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          pts.push(new THREE.Vector3((t - 0.5) * 1.45, Math.sin(t * Math.PI) * 0.03 - 0.0, Math.sin(t * Math.PI * 2) * 0.02));
        }
        // star-fluted foam profile: tube with ridges via a custom ring
        B.tube(pts, 0.036, 14, false);
        // hollow ends
        for (const e of [pts[0], pts[pts.length - 1]]) {
          const sgn = e.x < 0 ? -1 : 1;
          const m = new THREE.Matrix4().compose(e, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sgn * Math.PI / 2), new THREE.Vector3(1, 1, 1));
          B.lathe([[0.036, 0], [0.012, 0], [0.012, -0.03]], 14, m);
        }
      }, true);
      const g = new THREE.Group();
      g.add(mesh(geo, M.foam()));
      return { object: g, colliders: [{ type: 'capsule', radius: 0.04, halfHeight: 0.68, pos: [0, 0, 0], rot: [0, 0, Math.PI / 2] }] };
    },
  },
  beach_ball: {
    mass: 1.0, material: 'rubber', halfHeight: 0.2, buoy: 6, floatOffset: 0.12,
    build() {
      const cols = [0xe23b2e, 0xf6f3ea, 0x2f78d4, 0xf6f3ea, 0xf3c21e, 0xf6f3ea].map((h) => new THREE.Color(h));
      const geo = geoOf((B) => {
        const R = 0.2, nu = 48, nv = 24;
        const base = B.vcount;
        for (let j = 0; j <= nv; j++) {
          const v = j / nv, th = v * Math.PI;
          for (let i = 0; i <= nu; i++) {
            const u = i / nu, ph = u * Math.PI * 2;
            const gore = Math.floor(u * 6 + 1e-4) % 6;
            const cap = th < 0.28 || th > Math.PI - 0.28;
            const c = cap ? cols[1] : cols[gore];
            B.setTint(c.r, c.g, c.b);
            const sx = Math.sin(th) * Math.cos(ph), sy = Math.cos(th), sz = Math.sin(th) * Math.sin(ph);
            const pinch = 1 - 0.015 * Math.cos(ph * 6) ** 8 * Math.sin(th);
            B.vert(sx * R * pinch, sy * R, sz * R * pinch, sx, sy, sz, u * 4, v * 2);
          }
        }
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
          const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
          B.tri(a, c, b); B.tri(b, c, d);
        }
      }, true);
      const g = new THREE.Group();
      g.add(mesh(geo, M.vinyl()));
      return { object: g, colliders: [{ type: 'ball', radius: 0.2, pos: [0, 0, 0] }] };
    },
  },
  float_mat: {
    mass: 1.4, material: 'rubber', halfHeight: 0.06, buoy: 3.5, floatOffset: 0.035,
    variants: [0x39a8e0, 0xf08a3c, 0xf2d24a, 0x58c8a8],
    build(o) {
      const c = new THREE.Color(this.variants[(o.variant ?? 0) % this.variants.length]);
      const geo = geoOf((B) => {
        // tubular ribs along the length + a pillow at the head
        const L = 1.55, n = 6, Wd = 0.66;
        for (let k = 0; k < n; k++) {
          const z = -Wd / 2 + (k + 0.5) * (Wd / n);
          const sh = 0.86 + 0.14 * Math.sin((k / (n - 1)) * Math.PI);
          B.setTint(c.r * sh, c.g * sh, c.b * sh);
          B.tube([new THREE.Vector3(-L / 2 + 0.06, 0, z), new THREE.Vector3(L / 2 - 0.36, 0, z)], 0.055, 12, true);
        }
        B.setTint(Math.min(1, c.r * 1.15), Math.min(1, c.g * 1.15), Math.min(1, c.b * 1.15));
        B.tube([new THREE.Vector3(L / 2 - 0.22, 0.03, -Wd / 2 + 0.06), new THREE.Vector3(L / 2 - 0.22, 0.03, Wd / 2 - 0.06)], 0.09, 14, true);
        // welded seam skirt around
        B.setTint(c.r * 0.8, c.g * 0.8, c.b * 0.8);
        B.roundPrism(-L / 2, -Wd / 2 - 0.01, L / 2 - 0.1, Wd / 2 + 0.01, -0.006, 0.006, 0.06, 4, { top: true, bottom: true });
      }, true);
      const g = new THREE.Group();
      g.add(mesh(geo, M.vinyl()));
      return { object: g, colliders: [{ type: 'box', size: [1.55, 0.12, 0.68], pos: [0, 0, 0] }] };
    },
  },
  towel: {
    mass: 0.6, material: 'fabric', halfHeight: 0.035, buoy: 0.85, floatOffset: 0.0,
    variants: [[0xf4f2ee, 0x2a68b8], [0xf2f0ea, 0xd8433a], [0x3e7ec8, 0xf2f0ea], [0xf6f4ef, 0x2aa58a]],
    build(o) {
      const v = this.variants[(o.variant ?? 0) % this.variants.length];
      const ca = new THREE.Color(v[0]), cb = new THREE.Color(v[1]);
      const geo = geoOf((B) => {
        // folded stack of 3 layers with soft rounded edges and stripes near the ends
        for (let k = 0; k < 3; k++) {
          const y = -0.025 + k * 0.022;
          const w = 0.36 - k * 0.006, d = 0.26 - k * 0.004;
          B.setTint(ca.r, ca.g, ca.b);
          B.roundPrism(-w / 2, -d / 2, w / 2, d / 2, y, y + 0.02, 0.012, 3, { top: true, bottom: k === 0 });
          B.setTint(cb.r, cb.g, cb.b);
          B.roundPrism(-w / 2 + 0.05, -d / 2 - 0.0015, -w / 2 + 0.075, d / 2 + 0.0015, y + 0.002, y + 0.0185, 0.004, 2, { top: true });
          B.roundPrism(w / 2 - 0.075, -d / 2 - 0.0015, w / 2 - 0.05, d / 2 + 0.0015, y + 0.002, y + 0.0185, 0.004, 2, { top: true });
        }
      }, true);
      const g = new THREE.Group();
      g.add(mesh(geo, M.terry()));
      return { object: g, colliders: [{ type: 'box', size: [0.36, 0.07, 0.26], pos: [0, 0, 0] }] };
    },
  },
};

export function isPoolProp(type) { return !!DEFS[type]; }

// world.customModel hook: returns a fresh model instance (template cached per variant)
export function poolModel(type, state, mo) {
  const D = DEFS[type];
  if (!D) return null;
  const variant = mo?.variant ?? (mo?.seed !== undefined ? Math.abs(mo.seed | 0) : 0);
  const nv = D.variants ? D.variants.length : 1;
  const key = `${type}|${variant % nv}`;
  let tpl = TEMPLATES.get(key);
  if (!tpl) {
    tpl = D.build.call(D, { variant: variant % nv });
    TEMPLATES.set(key, tpl);
  }
  return {
    object: tpl.object.clone(true),
    colliders: JSON.parse(JSON.stringify(tpl.colliders)),
    mass: D.mass,
    material: D.material,
    halfHeight: D.halfHeight,
    floatHalf: D.halfHeight,
    floatOffset: D.floatOffset,
    buoy: D.buoy,
    anchors: {},
    parts: {},
  };
}

export function poolHalfHeight(type) { return DEFS[type]?.halfHeight; }
export function floatOffsetOf(type) { return DEFS[type]?.floatOffset; }

const MAT_BUOY = { plastic: 1.5, wood: 1.3, rubber: 1.6, cardboard: 1.15, paper: 1.1, fabric: 0.92, soft: 0.92, metal: 0.25, glass: 0.45, stone: 0.15, concrete: 0.15, heavy: 0.15 };
export function buoyancyOf(p) {
  if (p.model?.buoy !== undefined) return p.model.buoy;
  if (p.type === 'rubber_duck') return 3;
  if (p.type.startsWith('rag_')) return 0.98;
  return MAT_BUOY[p.material] ?? 0.8;
}

// rope-line float (lathe) shared by every chunk's InstancedMesh
let _floatGeo = null;
export function floatGeometry() {
  if (_floatGeo) return _floatGeo;
  const B = new Mesher({ seg: 2 });
  B.lathe([[0.0, -0.075], [0.03, -0.074], [0.05, -0.066], [0.06, -0.05], [0.062, 0.0], [0.06, 0.05], [0.05, 0.066], [0.03, 0.074], [0.0, 0.075]], 16, new THREE.Matrix4());
  _floatGeo = B.build();
  _floatGeo.deleteAttribute('aTint');
  _floatGeo.userData.shared = true;
  return _floatGeo;
}
export function floatMaterial() { return M.floatPlastic(); }
