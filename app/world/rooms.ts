import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Room } from './scene-format';
import { contentUrl } from './scene-format';

export interface LoadedRoom {
  room: Room;
  object: THREE.Object3D;
  box: THREE.Box3;
}

let ktx2: KTX2Loader | undefined;

/** Lazily created: no KTX2 assets exist yet, so don't pay for the transcoder until one does. */
export function getKTX2Loader(renderer: THREE.WebGPURenderer): KTX2Loader {
  // The basis transcoder is bundled by Vite from three's own files (no CDN).
  ktx2 ??= new KTX2Loader().detectSupport(renderer);
  return ktx2;
}

export async function loadRoom(room: Room, renderer: THREE.WebGPURenderer): Promise<LoadedRoom> {
  const object = room.model ? await loadModelRoom(room, renderer) : buildPlaceholderRoom(room);
  object.name = `room:${room.id}`;
  const box = new THREE.Box3(new THREE.Vector3(...room.bounds.min), new THREE.Vector3(...room.bounds.max));
  return { room, object, box };
}

async function loadModelRoom(room: Room, renderer: THREE.WebGPURenderer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader().setKTX2Loader(getKTX2Loader(renderer)).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(contentUrl(room.model!));

  if (room.lightmap) {
    const lightMap = room.lightmap.endsWith('.ktx2')
      ? await getKTX2Loader(renderer).loadAsync(contentUrl(room.lightmap))
      : await new THREE.TextureLoader().loadAsync(contentUrl(room.lightmap));
    lightMap.channel = 1; // UV1, per docs/blender-conventions.md
    lightMap.flipY = false;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute('uv1')) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        std.lightMap = lightMap;
        std.lightMapIntensity = 1;
        std.needsUpdate = true;
      }
    });
  }

  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
  });
  return gltf.scene;
}

/** A plain gallery box built from the room bounds, used until the Blender room exists. */
function buildPlaceholderRoom(room: Room): THREE.Object3D {
  const group = new THREE.Group();
  const [x0, y0, z0] = room.bounds.min;
  const [x1, y1, z1] = room.bounds.max;
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x6b5a48,
    roughness: 0.38,
    roughnessMap: noiseTexture(256, 0.55, 0.25),
  });
  floorMat.roughnessMap!.repeat.set(w / 2, d / 2);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xeeebe4, roughness: 0.92 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf4f3f0, roughness: 0.95 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xe2ded6, roughness: 0.6 });

  const plane = (width: number, height: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const floor = plane(w, d, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, y0, cz);

  const ceiling = plane(w, d, ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, y1, cz);

  // Walls face inward.
  const walls: [width: number, x: number, z: number, rotationY: number][] = [
    [w, cx, z0, 0],
    [w, cx, z1, Math.PI],
    [d, x0, cz, Math.PI / 2],
    [d, x1, cz, -Math.PI / 2],
  ];
  const baseH = 0.12;
  const baseD = 0.015;
  for (const [width, x, z, ry] of walls) {
    const wall = plane(width, h, wallMat);
    wall.position.set(x, y0 + h / 2, z);
    wall.rotation.y = ry;

    const base = new THREE.Mesh(new THREE.BoxGeometry(width, baseH, baseD), baseMat);
    base.position.set(x, y0 + baseH / 2, z);
    base.rotation.y = ry;
    base.translateZ(baseD / 2);
    base.receiveShadow = true;
    group.add(base);
  }

  // Stand-in lighting until lightmaps are baked: soft fill plus a few ceiling washes.
  group.add(new THREE.HemisphereLight(0xfff6ea, 0x3a3128, 0.3));
  const cols = Math.max(1, Math.round(w / 5));
  const rows = Math.max(1, Math.round(d / 5));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // Recessed downlights: wide, soft, and they don't light the ceiling itself.
      const s = new THREE.SpotLight(0xfff1e0, 12, 0, Math.PI / 3, 1, 2);
      s.position.set(x0 + ((i + 0.5) * w) / cols, y1 - 0.02, z0 + ((j + 0.5) * d) / rows);
      s.target.position.set(s.position.x, y0, s.position.z);
      group.add(s, s.target);
    }
  }

  return group;
}

/** Small tileable grey-noise texture for subtle roughness variation. */
function noiseTexture(size: number, base: number, spread: number): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(255 * Math.min(1, Math.max(0, base + (Math.random() - 0.5) * spread)));
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
