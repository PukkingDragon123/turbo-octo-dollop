// Humid-air light volumes under the Level 0 troffers: one soft, camera-facing glow card per fixture whose
// brightness follows the fixture's live state in the light field (dead tubes leave no shaft, flickering ones
// flicker). The card turns about the vertical axis to face the viewer (no edge-on slivers or frustum corners),
// widens towards the floor like the light cone, fades with height, towards its sides and close to the camera,
// so it reads as a faint glow in the haze rather than geometry. One merged mesh / draw call per chunk.
import * as THREE from 'three';
import { CELL, HEIGHT } from '../levels/yellow/layout.js';
import { FIELD_SIZE } from '../../gfx/bakedlight.js';

const TOP = HEIGHT - 0.03, BOT = 0.45;
const HW_TOP = 0.42, HW_BOT = 0.9;   // half widths at the fixture / at the bottom (kept clear of the cell's walls)

let _mat = null;
export function hazeMaterial(field) {
  if (_mat) return _mat;
  _mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uLightTex: field.uniforms.uLightTex,
      uLightScale: field.uniforms.uLightScale,
      uHaze: { value: 0.02 },
      uTime: field.uniforms.uTime,
    }),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 aCell;
      attribute vec2 aQ;           // x: -1 / 1 across the card, y: 0 at the fixture .. 1 at the bottom
      // vQ: x lateral offset in metres, y as aQ.y
      uniform sampler2D uLightTex;
      varying vec3 vCol;
      varying vec2 vQ;
      varying vec3 vWP;
      void main(){
        vec2 uv = (mod(aCell, ${FIELD_SIZE.toFixed(1)}) + 0.5) / ${FIELD_SIZE.toFixed(1)};
        vCol = texture2D(uLightTex, uv).rgb * 2.0;
        // the card is a trapezoid: interpolate the lateral offset in metres (affine over the card) and
        // normalise per fragment; a per-corner -1..1 attribute would crease along the triangle diagonal
        float hw = mix(${HW_TOP.toFixed(2)}, ${HW_BOT.toFixed(2)}, aQ.y);
        vQ = vec2(aQ.x * hw, aQ.y);
        // position holds the card's axis point at this vertex's height; turn the card towards the camera
        vec3 c = (modelMatrix * vec4(position, 1.0)).xyz;
        vec2 toCam = cameraPosition.xz - c.xz;
        float l = length(toCam);
        vec2 side = l > 1e-4 ? vec2(toCam.y, -toCam.x) / l : vec2(1.0, 0.0);
        vec3 wp = c + vec3(side.x, 0.0, side.y) * (aQ.x * hw);
        vWP = wp;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uHaze, uLightScale, uTime;
      varying vec3 vCol;
      varying vec2 vQ;
      varying vec3 vWP;
      void main(){
        float y = clamp(vQ.y, 0.0, 1.0);
        float x = clamp(abs(vQ.x) / mix(${HW_TOP.toFixed(2)}, ${HW_BOT.toFixed(2)}, y), 0.0, 1.0);
        float across = pow2(1.0 - x * x);
        float fall = pow(1.0 - y, 2.4) * smoothstep(0.0, 0.07, y);
        float nearFade = smoothstep(0.6, 2.2, length(cameraPosition - vWP));
        float shimmer = 0.88 + 0.12 * sin(vWP.x * 3.1 + vWP.z * 2.3 + uTime * 0.4) * sin(vWP.y * 4.0 - uTime * 0.3);
        float a = uHaze * across * fall * nearFade * shimmer;
        gl_FragColor = vec4(vCol * uLightScale * a, 1.0);
        #include <fog_fragment>
        #ifdef USE_FOG
          gl_FragColor.rgb *= 1.0 - fogFactor * 0.85;
        #endif
      }`,
  });
  return _mat;
}

// geometry for every lit fixture of a chunk layout
export function lightVolumes(layout, level) {
  // (no shaft under a low ceiling: the fixture is right above the clones' heads)
  const lit = layout.cells.filter((c) => c.light && !(c.ceil < HEIGHT - 0.3));
  if (!lit.length) return null;
  const n = lit.length * 4;
  const pos = new Float32Array(n * 3), cel = new Float32Array(n * 2), q = new Float32Array(n * 2);
  const idx = new Uint32Array(lit.length * 6);
  let v = 0, t = 0;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of lit) {
    // centre of the troffer (same placement as the ceiling module)
    const cx = c.i * CELL + (c.lightRot ? 1.2 : 1.5), cz = c.j * CELL + (c.lightRot ? 1.5 : 1.2);
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
    const base = v;
    for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      pos[v * 3] = cx; pos[v * 3 + 1] = sy ? BOT : TOP; pos[v * 3 + 2] = cz;
      cel[v * 2] = c.i; cel[v * 2 + 1] = c.j;
      q[v * 2] = sx; q[v * 2 + 1] = sy;
      v++;
    }
    idx[t++] = base; idx[t++] = base + 1; idx[t++] = base + 2;
    idx[t++] = base; idx[t++] = base + 2; idx[t++] = base + 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCell', new THREE.BufferAttribute(cel, 2));
  g.setAttribute('aQ', new THREE.BufferAttribute(q, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // the cards are expanded in the vertex shader: bound the axis points plus the widest half width
  const r = HW_BOT;
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0 - r, BOT, z0 - r), new THREE.Vector3(x1 + r, TOP, z1 + r));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  const m = new THREE.Mesh(g, hazeMaterial(level.field));
  m.renderOrder = 3;
  m.frustumCulled = true;
  m.userData.noProbe = true;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}
