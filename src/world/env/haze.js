// Humid-air light volumes under the Level 0 troffers: a soft frustum of additive cards per fixture whose
// brightness follows the fixture's live state in the light field (dead tubes leave no shaft, flickering
// ones flicker). Cards fade with height, towards their edges and when seen edge-on, so they read as a
// faint glow in the haze rather than geometry. One merged mesh / draw call per chunk.
import * as THREE from 'three';
import { CELL, HEIGHT } from '../levels/yellow/layout.js';
import { FIELD_SIZE } from '../../gfx/bakedlight.js';

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
      uHaze: { value: 0.028 },
      uTime: field.uniforms.uTime,
    }),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec2 aCell;
      attribute vec2 aUV;          // x across the card (0..1), y down from the fixture (0..1)
      uniform sampler2D uLightTex;
      varying vec3 vCol;
      varying vec2 vUV;
      varying vec3 vN;
      varying vec3 vWP;
      void main(){
        vec2 uv = (mod(aCell, ${FIELD_SIZE.toFixed(1)}) + 0.5) / ${FIELD_SIZE.toFixed(1)};
        vCol = texture2D(uLightTex, uv).rgb * 2.0;
        vUV = aUV;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uHaze, uLightScale, uTime;
      varying vec3 vCol;
      varying vec2 vUV;
      varying vec3 vN;
      varying vec3 vWP;
      void main(){
        vec3 V = normalize(cameraPosition - vWP);
        float face = abs(dot(normalize(vN), V));
        float edge = sin(PI * clamp(vUV.x, 0.0, 1.0));
        edge = edge * edge * edge;
        float fall = pow(1.0 - clamp(vUV.y, 0.0, 1.0), 2.2) * smoothstep(0.0, 0.08, vUV.y);
        float nearFade = smoothstep(0.4, 1.6, length(cameraPosition - vWP));
        float shimmer = 0.85 + 0.15 * sin(vWP.x * 3.1 + vWP.z * 2.3 + uTime * 0.4) * sin(vWP.y * 4.0 - uTime * 0.3);
        float a = uHaze * edge * fall * smoothstep(0.25, 0.85, face) * nearFade * shimmer;
        vec3 col = vCol * uLightScale * a;
        gl_FragColor = vec4(col, 1.0);
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
  const lit = layout.cells.filter((c) => c.light);
  if (!lit.length) return null;
  const n = lit.length * 16;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cel = new Float32Array(n * 2), auv = new Float32Array(n * 2);
  const idx = [];
  let v = 0;
  const top = HEIGHT - 0.03, bot = 0.45;
  for (const c of lit) {
    // troffer footprint (same placement as the ceiling module), centre slightly offset on the long axis
    const x0 = c.i * CELL, z0 = c.j * CELL;
    const X0 = c.lightRot ? x0 + 0.6 : x0 + 1.2, X1 = c.lightRot ? x0 + 1.8 : x0 + 1.8;
    const Z0 = c.lightRot ? z0 + 1.2 : z0 + 0.6, Z1 = c.lightRot ? z0 + 1.8 : z0 + 1.8;
    const grow = 0.55;
    const tb = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
    const cxm = (X0 + X1) / 2, czm = (Z0 + Z1) / 2;
    const bb = tb.map(([x, z]) => [cxm + (x - cxm) * (1 + grow * 1.6), czm + (z - czm) * (1 + grow * 2.4)]);
    for (let s = 0; s < 4; s++) {
      const a = s, b = (s + 1) % 4;
      const quad = [[tb[a][0], top, tb[a][1], 0, 0], [tb[b][0], top, tb[b][1], 1, 0], [bb[b][0], bot, bb[b][1], 1, 1], [bb[a][0], bot, bb[a][1], 0, 1]];
      // outward normal of this side
      const ex = tb[b][0] - tb[a][0], ez = tb[b][1] - tb[a][1];
      let nx = ez, nz = -ex; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if ((tb[a][0] - cxm) * nx + (tb[a][1] - czm) * nz < 0) { nx = -nx; nz = -nz; }
      const base = v;
      for (const q of quad) {
        pos[v * 3] = q[0]; pos[v * 3 + 1] = q[1]; pos[v * 3 + 2] = q[2];
        nor[v * 3] = nx; nor[v * 3 + 1] = 0.25; nor[v * 3 + 2] = nz;
        cel[v * 2] = c.i; cel[v * 2 + 1] = c.j;
        auv[v * 2] = q[3]; auv[v * 2 + 1] = q[4];
        v++;
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aCell', new THREE.BufferAttribute(cel, 2));
  g.setAttribute('aUV', new THREE.BufferAttribute(auv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, hazeMaterial(level.field));
  m.renderOrder = 3;
  m.frustumCulled = true;
  m.userData.noProbe = true;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}
