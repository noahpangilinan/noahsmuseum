import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface Engine {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 'WebGPU' or 'WebGL2' — whichever backend the renderer actually picked. */
  backend: string;
}

/**
 * WebGPU renderer with automatic WebGL2 fallback.
 * Append `?webgl` to the URL to force the fallback path for testing.
 */
export async function createEngine(container: HTMLElement): Promise<Engine> {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  await renderer.init();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);

  // Neutral image-based lighting so PBR materials have something to reflect
  // until baked lightmaps and reflection probes arrive in M1 (World).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const backendObj = renderer.backend as { isWebGPUBackend?: boolean };
  const backend = backendObj.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

  return { renderer, scene, camera, backend };
}
