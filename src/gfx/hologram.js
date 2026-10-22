// Green phosphor holograms (Fallout-terminal style) for the camp kiosks.
//   holoMaterial(color)        translucent additive shader: fresnel rim, world-space scanlines, a travelling
//                              bright band, flicker; uniforms uTime / uAlpha / uGlitch (drive them per frame)
//   holoLineMaterial(color)    the matching wireframe-edge material
//   buildHologram(object3d, mats, size)  -> Group: every mesh of the model as a holo shell + its feature edges,
//                              centred and scaled to fit `size` metres (geometry is shared, never cloned)
//   holoCone(radius, height, mat)  -> the projector light cone (open, additive)
import * as THREE from 'three';

const VERT = /* glsl */`
  uniform float uTime; uniform float uGlitch;
  varying vec3 vW; varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // horizontal tearing: slices of the hologram jump sideways while glitching
    float slice = floor(wp.y * 28.0 + floor(uTime * 9.0) * 7.0);
    wp.x += uGlitch * 0.04 * (fract(sin(slice * 12.9898) * 43758.5453) - 0.5);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uAlpha;
  varying vec3 vW; varying vec3 vN; varying vec3 vV;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float scan = 0.45 + 0.55 * step(0.42, fract(vW.y * 110.0 - uTime * 1.7));
    float band = smoothstep(0.0, 0.06, 0.06 - abs(fract(vW.y * 1.4 - uTime * 0.45) - 0.5));
    float flick = 0.86 + 0.14 * sin(uTime * 41.0) * sin(uTime * 17.3);
    float a = (0.16 + fres * 0.95) * scan * flick + band * 0.4;
    a *= uAlpha;
    gl_FragColor = vec4(uColor * a * 1.7, a);
  }`;
const LFRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uAlpha;
  varying vec3 vW; varying vec3 vN; varying vec3 vV;
  void main() {
    float scan = 0.6 + 0.4 * step(0.35, fract(vW.y * 110.0 - uTime * 1.7));
    float flick = 0.9 + 0.1 * sin(uTime * 53.0);
    float a = scan * flick * uAlpha;
    gl_FragColor = vec4(uColor * a * 3.0, a);
  }`;

function mk(frag, color) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uGlitch: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: VERT, fragmentShader: frag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  m.userData.noProbe = true;
  m.toneMapped = false;
  return m;
}
export const holoMaterial = (color = 0x4dff7a) => mk(FRAG, color);
export const holoLineMaterial = (color = 0x7dffa0) => mk(LFRAG, color);

// one EdgesGeometry per source geometry (shared between holograms of the same model)
const _edges = new WeakMap();
function edgesOf(geo) {
  let e = _edges.get(geo);
  if (!e) {
    e = new THREE.EdgesGeometry(geo, 28);
    _edges.set(geo, e);
  }
  return e;
}

export function buildHologram(obj, mats, size = 0.34) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  // bounds of exactly what is drawn (visible meshes only; hidden flames / helpers would shrink the fit)
  const meshes = [];
  const box = new THREE.Box3(), gb = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let vis = true;
    for (let p = o; p && p !== obj; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(gb.copy(o.geometry.boundingBox).applyMatrix4(m));
    meshes.push([o, m]);
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const k = size / Math.max(0.04, s.x, s.y, s.z);
  const inner = new THREE.Group();
  for (const [o, m] of meshes) {
    const shell = new THREE.Mesh(o.geometry, mats.shell);
    shell.matrixAutoUpdate = false; shell.matrix.copy(m);
    const lines = new THREE.LineSegments(edgesOf(o.geometry), mats.line);
    lines.matrixAutoUpdate = false; lines.matrix.copy(m);
    shell.renderOrder = 5; lines.renderOrder = 6;
    shell.userData.noProbe = lines.userData.noProbe = true;
    shell.castShadow = shell.receiveShadow = false;
    inner.add(shell, lines);
  }
  inner.position.copy(c).multiplyScalar(-k);
  inner.scale.setScalar(k);
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

export function holoCone(r0, r1, h, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 28, 1, true), mat);
  m.userData.noProbe = true;
  m.renderOrder = 4;
  return m;
}
