import * as THREE from 'three/webgpu';
import type { ExhibitInfo, FrameStyle, Museum } from './scene-format';
import { contentUrl } from './scene-format';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getKTX2Loader, type LoadedRoom } from './rooms';
import { shadowDecal } from './surfaces';
import { createWallLabel, labelTexture, LABEL_GAP, LABEL_HEIGHT, LABEL_SIZE } from './wall-label';
import { StreamedMap, type Streamable } from './streaming';
import { lightArtworks, type SpotRequest } from './lighting';

/** Anything with a label: a hung artwork or a free-standing piece. Streams with its room. */
export interface PlacedExhibit extends Streamable {
  info: ExhibitInfo;
  /** Raycast target for click-to-read plaques. */
  target: THREE.Mesh;
  /** World-space centre of the piece. */
  center: THREE.Vector3;
  /** Everything drawn for this exhibit (hidden with its room). */
  group: THREE.Object3D;
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
    // Satin rather than mirror gold: there's no environment map for metal to reflect.
    material: new THREE.MeshStandardMaterial({ color: 0xa8823e, metalness: 0.35, roughness: 0.42 }),
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
  tapestry: { width: 0, depth: 0.05 },
};

const _forward = new THREE.Vector3(0, 0, 1);
const stretcherMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.9 });
const rodMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });

/**
 * Places every artwork at its real physical size, centred in its slot, framed and spot-lit.
 * Returns immediately; textures stream in and are applied as they arrive.
 */
export function placeArtworks(
  museum: Museum,
  rooms: Map<string, LoadedRoom>,
  scene: THREE.Scene,
  renderer: THREE.WebGPURenderer,
): PlacedExhibit[] {
  const placed: PlacedExhibit[] = [];
  const spots: SpotRequest[] = [];
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
    const isTapestry = artwork.frame === 'tapestry';
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: isTapestry ? 0.97 : 0.8 });
    const canvas = new THREE.Mesh(
      isTapestry ? clothGeometry(width, height) : new THREE.PlaneGeometry(width, height),
      canvasMat,
    );
    canvas.position.z = frame.depth - 0.012; // slightly recessed behind the frame face
    canvas.userData.exhibitId = artwork.id;
    group.add(canvas);

    if (isTapestry) {
      // Hanging rod along the top edge.
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, width + 0.16, 12).rotateZ(Math.PI / 2), rodMat);
      rod.position.set(0, height / 2 + 0.01, frame.depth);
      group.add(rod);
    } else {
      // Stretcher bars: gives the canvas edges real thickness when seen from the side.
      const backDepth = canvas.position.z - 0.002; // stop short of the canvas plane to avoid z-fighting
      const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, backDepth), stretcherMat);
      back.position.z = backDepth / 2;
      group.add(back);
    }

    if (frame.material) group.add(createFrame(width, height, frame));

    // Soft contact shadow on the wall, nudged down because the light comes from above.
    const outer = [width + 2 * frame.width, height + 2 * frame.width];
    const shadow = shadowDecal(outer[0] * 1.02, outer[1] * 1.02, 0.42);
    shadow.position.set(0, -0.04, 0.002);
    group.add(shadow);

    const floorY = loaded.room.bounds.min[1];
    const hasLabel = artwork.label !== false;
    const label = createWallLabel(artwork);
    const labelMat = label.material as THREE.MeshStandardMaterial;
    label.position.set(outer[0] / 2 + LABEL_GAP + LABEL_SIZE[0] / 2, floorY + LABEL_HEIGHT - slot.position[1], LABEL_SIZE[2] / 2);
    if (hasLabel) group.add(label);

    scene.add(group);
    group.updateMatrixWorld(true);

    const center = canvas.getWorldPosition(new THREE.Vector3());
    if (loaded.room.finish?.artworkSpots !== false) {
      spots.push({ room: roomId, center, normal, width: outer[0], height: outer[1], labelReach: hasLabel ? LABEL_GAP + LABEL_SIZE[0] : 0, roomBounds: loaded.box });
    }

    const image = new StreamedMap(
      canvasMat,
      async () => {
        const tex = await loadTexture(artwork.image, renderer);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = anisotropy;
        return tex;
      },
      { loaded: 0xffffff, unloaded: 0x444444 },
    );
    const text = new StreamedMap(labelMat, async () => labelTexture(artwork), { loaded: 0xffffff, unloaded: 0xf7f5f0 });

    placed.push({
      info: artwork,
      target: canvas,
      center,
      group,
      room: roomId,
      load: () => {
        image.load();
        if (hasLabel) text.load();
      },
      unload: () => {
        image.unload();
        text.unload();
      },
    });
  }
  lightArtworks(scene, spots);
  return placed;
}

/** The four frame rails merged into one mesh (one draw call). */
function createFrame(width: number, height: number, spec: FrameSpec): THREE.Mesh {
  const { width: fw, depth } = spec;
  const pieces: [w: number, h: number, x: number, y: number][] = [
    [width + 2 * fw, fw, 0, height / 2 + fw / 2],
    [width + 2 * fw, fw, 0, -height / 2 - fw / 2],
    [fw, height, -width / 2 - fw / 2, 0],
    [fw, height, width / 2 + fw / 2, 0],
  ];
  const geo = mergeGeometries(
    pieces.map(([w, h, x, y]) => new THREE.BoxGeometry(w, h, depth).translate(x, y, depth / 2).toNonIndexed()),
  );
  return new THREE.Mesh(geo, spec.material);
}

/**
 * A textile hanging from a rod: soft vertical folds that deepen towards the free bottom edge.
 * Enough segments for smooth shading, still only a few thousand triangles.
 */
function clothGeometry(width: number, height: number): THREE.BufferGeometry {
  const segX = Math.max(8, Math.ceil(width * 12));
  const segY = 8;
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const drop = 0.5 - pos.getY(i) / height; // 0 at the rod, 1 at the hem
    const fold = Math.sin((x / 0.55) * Math.PI * 2) * 0.6 + Math.sin((x / 0.23) * Math.PI * 2 + 1.3) * 0.4;
    pos.setZ(i, fold * (0.006 + 0.016 * drop));
  }
  geo.computeVertexNormals();
  return geo;
}

export function loadTexture(path: string, renderer: THREE.WebGPURenderer): Promise<THREE.Texture> {
  const url = contentUrl(path);
  if (path.endsWith('.ktx2')) return getKTX2Loader(renderer).loadAsync(url);
  return new THREE.TextureLoader().loadAsync(url);
}
