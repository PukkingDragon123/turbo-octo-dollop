// "Virtual" point lights for hand-built set pieces (the HQ receptionist, elevator cars, the elevator ride).
//
// Real THREE lights change the scene's light count, which recompiles every material in the scene the
// moment one is added or removed (a hitch exactly when the ride starts and ends). These lights live in
// plain uniforms instead: a material patched with vlPatch() evaluates up to VL_MAX extra point lights in
// world space through three.js's own physical BRDF (Lambert diffuse + GGX specular), plus a flat ambient
// irradiance term. Many materials can share one rig, so a whole set piece flickers with a few writes.
import * as THREE from 'three';

export const VL_MAX = 4;

// A light rig: positions (xyz + range in w), colours (linear rgb * intensity) and an ambient term.
export class VLRig {
  constructor() {
    this.uniforms = {
      uVLp: { value: Array.from({ length: VL_MAX }, () => new THREE.Vector4(0, -1000, 0, 1)) },
      uVLc: { value: Array.from({ length: VL_MAX }, () => new THREE.Color(0, 0, 0)) },
      uVAmb: { value: new THREE.Color(0, 0, 0) },
    };
    this.base = Array.from({ length: VL_MAX }, () => ({ color: new THREE.Color(0, 0, 0), k: 1 }));
  }
  // world position, colour (hex or Color), intensity (candela-ish), range (m)
  set(i, pos, color, intensity = 1, range = 8) {
    this.uniforms.uVLp.value[i].set(pos.x, pos.y, pos.z, range);
    this.base[i].color.set(color).multiplyScalar(intensity);
    this.base[i].k = 1;
    this.uniforms.uVLc.value[i].copy(this.base[i].color);
    return this;
  }
  move(i, pos) { const p = this.uniforms.uVLp.value[i]; p.x = pos.x; p.y = pos.y; p.z = pos.z; return this; }
  // scale a light's brightness (flicker / dimming) without losing its colour
  level(i, k) {
    this.base[i].k = k;
    this.uniforms.uVLc.value[i].copy(this.base[i].color).multiplyScalar(k);
    return this;
  }
  tint(i, color, intensity) {
    this.base[i].color.set(color).multiplyScalar(intensity);
    return this.level(i, this.base[i].k);
  }
  off(i) { this.base[i].color.setRGB(0, 0, 0); this.uniforms.uVLc.value[i].setRGB(0, 0, 0); return this; }
  ambient(r, g = r, b = r) { this.uniforms.uVAmb.value.setRGB(r, g, b); return this; }
}

// Patch a MeshStandardMaterial (in place) to receive the rig's lights. The patch survives cloning by the
// probe system (probeMaterial clones and chains onBeforeCompile), and all patched materials share one
// shader program per base program.
export function vlPatch(mat, rig) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.() || '';
  mat.userData.vlRig = rig;
  mat.onBeforeCompile = (shader, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(mat, shader, r);
    shader.uniforms.uVLp = rig.uniforms.uVLp;
    shader.uniforms.uVLc = rig.uniforms.uVLc;
    shader.uniforms.uVAmb = rig.uniforms.uVAmb;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uVLp[${VL_MAX}];
        uniform vec3 uVLc[${VL_MAX}];
        uniform vec3 uVAmb;`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
        {
          #ifdef STANDARD
          material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / max( material.dfg.x + material.dfg.y, 1e-3 ) - 1.0 );
          #endif
          IncidentLight vlL;
          for ( int vi = 0; vi < ${VL_MAX}; vi ++ ) {
            vec3 vc = uVLc[ vi ];
            if ( vc.r + vc.g + vc.b < 1e-4 ) continue;
            vec3 vp = ( viewMatrix * vec4( uVLp[ vi ].xyz, 1.0 ) ).xyz - geometryPosition;
            float vd = length( vp );
            float vw = clamp( 1.0 - pow( vd / max( uVLp[ vi ].w, 0.01 ), 4.0 ), 0.0, 1.0 );
            vlL.direction = vp / max( vd, 1e-4 );
            vlL.color = vc * ( vw * vw / ( 0.25 + vd * vd ) );
            vlL.visible = true;
            RE_Direct( vlL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          }
        }`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        irradiance += uVAmb;`);
  };
  mat.customProgramCacheKey = () => `vl${VL_MAX}_${prevKey}`;
  mat.needsUpdate = true;
  return mat;
}

// Mark every mesh under root as "not probe lit" (the world probe system would otherwise swap materials).
export function noProbe(root) {
  root.traverse((o) => { if (o.isMesh) o.userData.noProbe = true; });
  return root;
}
