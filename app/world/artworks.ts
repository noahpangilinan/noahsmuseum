import * as THREE from 'three/webgpu';
import type { Artwork, FrameStyle, Museum } from './scene-format';
import { contentUrl } from './scene-format';
import { getKTX2Loader, type LoadedRoom } from './rooms';

export interface PlacedArtwork {
  artwork: Artwork;
  group: THREE.Group;
  /** The painted surface; raycast target for plaques. */
  canvas: THREE.Mesh;
  /** World-space centre of the canvas. */
  center: THREE.Vector3;
  /** World-space direction the artwork faces. */
  normal: THREE.Vector3;
}

interface FrameSpec {
  width: number;
  depth: number;
  material?: THREE.MeshStandardMaterial;
}

const FRAMES: Record<FrameStyle, FrameSpec> = {
  'gilded-ornate': {
    width: 0.09,
    depth: 0.07,
    material: new THREE.MeshStandardMaterial({ color: 0xb48c45, metalness: 1, roughness: 0.38 }),
  },
  'modern-black': {
    width: 0.03,
    depth: 0.045,
    material: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55 }),
  },
  'gallery-white': {
    width: 0.035,
    depth: 0.045,
    material: new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 0.7 }),
  },
  none: { width: 0, depth: 0.03 },
};

const _forward = new THREE.Vector3(0, 0, 1);

/**
 * Places every artwork at its real physical size, centred in its slot, framed and spot-lit.
 * Returns immediately; textures stream in and are applied as they arrive.
 */
export function placeArtworks(
  museum: Museum,
  rooms: Map<string, LoadedRoom>,
  scene: THREE.Scene,
  renderer: THREE.WebGPURenderer,
): PlacedArtwork[] {
  const placed: PlacedArtwork[] = [];
  const anisotropy = renderer.getMaxAnisotropy();

  for (const artwork of museum.artworks) {
    const [roomId, slotId] = artwork.slot.split('/');
    const loaded = rooms.get(roomId);
    if (!loaded) continue; // room not loaded (streaming arrives in M3)
    const slot = loaded.room.slots.find((s) => s.id === slotId)!;

    const height = artwork.dimensionsCm[0] / 100;
    const width = artwork.dimensionsCm[1] / 100;
    if (width > slot.maxSize[0] || height > slot.maxSize[1]) {
      console.warn(
        `[museum] ${artwork.id} (${width.toFixed(2)}×${height.toFixed(2)} m) exceeds slot ${artwork.slot} ` +
          `maxSize ${slot.maxSize.join('×')} m; hanging at real size anyway.`,
      );
    }

    const normal = new THREE.Vector3(...slot.normal).normalize();
    const group = new THREE.Group();
    group.name = `artwork:${artwork.id}`;
    group.position.set(...slot.position);
    group.quaternion.setFromUnitVectors(_forward, normal);

    const frame = FRAMES[artwork.frame];
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(width, height), canvasMat);
    canvas.position.z = frame.depth - 0.012; // slightly recessed behind the frame face
    canvas.receiveShadow = true;
    canvas.userData.artworkId = artwork.id;
    group.add(canvas);

    // Stretcher bars: gives the canvas edges real thickness when seen from the side.
    const backDepth = canvas.position.z - 0.002; // stop short of the canvas plane to avoid z-fighting
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, backDepth),
      new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.9 }),
    );
    back.position.z = backDepth / 2;
    back.castShadow = true;
    group.add(back);

    if (frame.material) addFrame(group, width, height, frame);

    scene.add(group);
    group.updateMatrixWorld(true);

    const center = canvas.getWorldPosition(new THREE.Vector3());
    addSpotlight(scene, center, normal, width, height, loaded.room.bounds.max[1]);

    loadTexture(artwork.image, renderer).then(
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = anisotropy;
        canvasMat.map = tex;
        canvasMat.color.set(0xffffff);
        canvasMat.needsUpdate = true;
      },
      (err) => console.error(`[museum] failed to load image for ${artwork.id}`, err),
    );

    placed.push({ artwork, group, canvas, center, normal });
  }
  return placed;
}

function addFrame(group: THREE.Group, width: number, height: number, spec: FrameSpec) {
  const { width: fw, depth } = spec;
  const pieces: [w: number, h: number, x: number, y: number][] = [
    [width + 2 * fw, fw, 0, height / 2 + fw / 2],
    [width + 2 * fw, fw, 0, -height / 2 - fw / 2],
    [fw, height, -width / 2 - fw / 2, 0],
    [fw, height, width / 2 + fw / 2, 0],
  ];
  for (const [w, h, x, y] of pieces) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), spec.material);
    m.position.set(x, y, depth / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

/** Warm gallery spot from the ceiling, angled ~30° down onto the artwork. */
function addSpotlight(
  scene: THREE.Scene,
  center: THREE.Vector3,
  normal: THREE.Vector3,
  width: number,
  height: number,
  ceilingY: number,
) {
  const mountY = ceilingY - 0.2;
  const out = Math.max(1.2, (mountY - center.y) * 0.6);
  const pos = center.clone().addScaledVector(normal, out);
  pos.y = mountY;

  const dist = pos.distanceTo(center);
  const radius = 0.5 * Math.hypot(width, height) * 1.25;
  const spot = new THREE.SpotLight(0xffe4c4, 1.6 * dist * dist, 0, Math.atan(radius / dist), 0.65, 2);
  spot.position.copy(pos);
  spot.target.position.copy(center);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.5;
  spot.shadow.camera.far = dist + 2;
  scene.add(spot, spot.target);
}

function loadTexture(path: string, renderer: THREE.WebGPURenderer): Promise<THREE.Texture> {
  const url = contentUrl(path);
  if (path.endsWith('.ktx2')) return getKTX2Loader(renderer).loadAsync(url);
  return new THREE.TextureLoader().loadAsync(url);
}
