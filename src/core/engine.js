// Renderer / scene / camera / post stack. One global engine instance.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PostFX } from '../gfx/post.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 512, bloom: false, ao: false, msaa: false, maxDpr: 1 },
  medium: { pixelRatio: 1.0, shadows: true, shadowSize: 1024, bloom: true, ao: false, msaa: false, maxDpr: 1.25 },
  high: { pixelRatio: 1.0, shadows: true, shadowSize: 2048, bloom: true, ao: true, msaa: false, maxDpr: 2 },
};

class Engine {
  init(container, qualityName = 'medium') {
    this.container = container;
    this.qualityName = qualityName;
    this.quality = QUALITY[qualityName] || QUALITY.medium;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxDpr) * this.quality.pixelRatio);
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 220);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // First-person viewmodel (hands, held items, wristwatch) rendered on top
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmScene.add(this.vmCamera);

    this.pmrem = new THREE.PMREMGenerator(r);
    this.defaultEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.defaultEnv;
    this.vmScene.environment = this.defaultEnv;
    this.scene.environmentIntensity = 0.35;
    this.vmScene.environmentIntensity = 0.35;

    this.post = new PostFX(r, this.scene, this.camera, this.vmScene, this.vmCamera, this.quality);
    this.time = 0;
    this.frame = 0;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    return this;
  }

  setQuality(name) {
    // Re-create post stack with new options (renderer stays)
    this.qualityName = name;
    this.quality = QUALITY[name] || QUALITY.medium;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.maxDpr) * this.quality.pixelRatio);
    const oldParams = this.post?.params;
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.vmScene, this.vmCamera, this.quality);
    if (oldParams) for (const k in oldParams) if (k !== 'tDiffuse' && k !== 'uRes') this.post.params[k].value = oldParams[k].value;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  // Capture a cube env map from a point in the current scene (used for reflections)
  captureEnvironment(position, near = 0.1, far = 60) {
    const crt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(near, far, crt);
    cubeCam.position.copy(position);
    this.scene.add(cubeCam);
    const prevEnv = this.scene.environment;
    this.scene.environment = this.defaultEnv;
    cubeCam.update(this.renderer, this.scene);
    this.scene.remove(cubeCam);
    const env = this.pmrem.fromCubemap(crt.texture).texture;
    crt.dispose();
    this.scene.environment = prevEnv;
    return env;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.post.setSize(w, h, this.renderer.getPixelRatio());
  }

  render(dt) {
    this.time += dt;
    this.frame++;
    this.vmCamera.position.set(0, 0, 0);
    this.vmCamera.quaternion.identity();
    this.post.render(dt, this.time);
  }
}

export const engine = new Engine();
