import * as THREE from 'three/webgpu';

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
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);

  // No environment map for now: surfaces are meant to read as matte, and skipping the
  // PMREM pass saves ~1 s of shader compilation at load. Reflection probes come with
  // World's baked lighting.

  // Global soft fill. Rooms add their own downlights and artwork spots.
  // The warm ground colour stands in for light bounced off the floor, so ceilings aren't black.
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0xa89a88, 0.45));

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
