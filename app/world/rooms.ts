import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import type { Room } from './scene-format';
import { contentUrl } from './scene-format';
import type { Doorway } from './layout';
import { aoPlane, bakeAO, diffuserTexture, floorMaterial, occlusion, plasterTexture } from './surfaces';
import { createBench } from './furniture';

export interface LoadedRoom {
  room: Room;
  object: THREE.Object3D;
  box: THREE.Box3;
  /** Benches you can sit on (click targets). */
  benches: THREE.Object3D[];
}

let ktx2: KTX2Loader | undefined;

/** Lazily created: no KTX2 assets exist yet, so don't pay for the transcoder until one does. */
export function getKTX2Loader(renderer: THREE.WebGPURenderer): KTX2Loader {
  // The basis transcoder is bundled by Vite from three's own files (no CDN).
  ktx2 ??= new KTX2Loader().detectSupport(renderer);
  return ktx2;
}

/** glTF loader with the Meshopt + KTX2 decoders the asset pipeline produces. */
export function createGLTFLoader(renderer: THREE.WebGPURenderer): GLTFLoader {
  return new GLTFLoader().setKTX2Loader(getKTX2Loader(renderer)).setMeshoptDecoder(MeshoptDecoder);
}

export async function loadRoom(room: Room, doorways: Doorway[], renderer: THREE.WebGPURenderer): Promise<LoadedRoom> {
  const object = room.model ? await loadModelRoom(room, renderer) : buildPlaceholderRoom(room, doorways);
  object.name = `room:${room.id}`;
  const benches: THREE.Object3D[] = [];
  for (const f of room.furniture ?? []) {
    const bench = createBench();
    bench.position.set(...f.position);
    bench.rotation.y = THREE.MathUtils.degToRad(f.rotationY ?? 0);
    object.add(bench);
    benches.push(bench);
  }
  // Baked skylit rooms keep their live skylight: the lightmap holds only bounced light, and the
  // live light gives direct light to the room and to everything not in the lightmap (paintings,
  // sculptures, benches). The glowing panel is part of the model.
  if (room.model && room.finish?.ceiling === 'skylight') {
    const [x0, , z0] = room.bounds.min;
    const [x1, y1, z1] = room.bounds.max;
    object.add(createSkylight((x0 + x1) / 2, y1, (z0 + z1) / 2, (x1 - x0) * 0.6, (z1 - z0) * 0.6)[0]);
  }
  const box = new THREE.Box3(new THREE.Vector3(...room.bounds.min), new THREE.Vector3(...room.bounds.max));
  return { room, object, box, benches };
}

async function loadModelRoom(room: Room, renderer: THREE.WebGPURenderer): Promise<THREE.Object3D> {
  const gltf = await createGLTFLoader(renderer).loadAsync(contentUrl(room.model!));

  // Rooms built by blender/build_rooms.py name their materials after the app's surface slots;
  // swap in the app's own surfaces so baked rooms look like the rest of the museum.
  const slots = surfaceMaterials(room, false);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name as keyof typeof slots;
    if (name in slots) mesh.material = slots[name];
  });

  if (room.lightmap) {
    const lightMap = room.lightmap.endsWith('.ktx2')
      ? await getKTX2Loader(renderer).loadAsync(contentUrl(room.lightmap))
      : await new THREE.TextureLoader().loadAsync(contentUrl(room.lightmap));
    lightMap.channel = 1; // UV1, per docs/blender-conventions.md
    lightMap.flipY = false;
    // Lightmaps are stored with the sRGB curve (more precision in the darks); decode on sampling.
    lightMap.colorSpace = THREE.SRGBColorSpace;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute('uv1')) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue; // the skylight panel glows on its own
        std.lightMap = lightMap;
        std.lightMapIntensity = room.lightmapIntensity ?? Math.PI;
        std.needsUpdate = true;
      }
    });
  }

  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
  });
  return gltf.scene;
}

const BASE_H = 0.12;
const BASE_D = 0.015;
const CASING_W = 0.09;
const CASING_D = 0.025;

/** One wall of a box room: which plane it lies on, which way it faces, and its extent. */
interface WallSpec {
  axis: 'x' | 'z';
  plane: number;
  /** Unit normal pointing into the room. */
  normal: THREE.Vector3;
  lo: number;
  hi: number;
}

/**
 * A gallery box built from the room bounds, used until the Blender room exists.
 * Walls get openings wherever a doorway touches them. Static geometry is merged per
 * material so a room costs a handful of draw calls.
 */
function buildPlaceholderRoom(room: Room, doorways: Doorway[]): THREE.Object3D {
  const group = new THREE.Group();
  const [x0, y0, z0] = room.bounds.min;
  const [x1, y1, z1] = room.bounds.max;
  const w = x1 - x0;
  const d = z1 - z0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const finish = room.finish ?? {};

  const surfaces = surfaceMaterials(room, true);
  const { wall: wallMat, ceiling: ceilingMat, trim: trimMat } = surfaces;

  const parts = { wall: [] as THREE.BufferGeometry[], ceiling: [] as THREE.BufferGeometry[], trim: [] as THREE.BufferGeometry[] };
  const m4 = new THREE.Matrix4();

  // Baked ambient occlusion: soft darkening wherever two surfaces meet, the cue that most
  // separates a real room from a CG box. Computed per vertex from distance to each edge.
  const nearWalls = (p: THREE.Vector3, radius: number, strength: number) =>
    occlusion(p.x - x0, radius, strength) *
    occlusion(x1 - p.x, radius, strength) *
    occlusion(p.z - z0, radius, strength) *
    occlusion(z1 - p.z, radius, strength);

  // Floor: UVs in metres so every room shares the same tiling texture scale.
  const floorGeo = aoPlane(w, d).rotateX(-Math.PI / 2).translate(cx, y0, cz);
  scaleUVs(floorGeo, w, d);
  bakeAO(floorGeo, (p) => nearWalls(p, 0.35, 0.4));
  const floor = new THREE.Mesh(floorGeo, surfaces.floor);
  floor.receiveShadow = true;
  group.add(floor);

  const ceilingGeo = aoPlane(w, d).rotateX(Math.PI / 2).translate(cx, y1, cz);
  bakeAO(ceilingGeo, (p) => nearWalls(p, 0.6, 0.45));
  parts.ceiling.push(ceilingGeo);

  const walls: WallSpec[] = [
    { axis: 'z', plane: z0, normal: new THREE.Vector3(0, 0, 1), lo: x0, hi: x1 },
    { axis: 'z', plane: z1, normal: new THREE.Vector3(0, 0, -1), lo: x0, hi: x1 },
    { axis: 'x', plane: x0, normal: new THREE.Vector3(1, 0, 0), lo: z0, hi: z1 },
    { axis: 'x', plane: x1, normal: new THREE.Vector3(-1, 0, 0), lo: z0, hi: z1 },
  ];

  for (const wall of walls) {
    const openings = doorways
      .filter((o) => o.rooms.includes(room.id) && o.axis === wall.axis && Math.abs(o.plane - wall.plane) < 1e-3)
      .sort((a, b) => a.from - b.from);

    const rotY = Math.atan2(wall.normal.x, wall.normal.z);
    /** Matrix placing a unit-facing (+z) piece centred at lateral `l`, height `y`, `out` metres off the wall. */
    const place = (l: number, y: number, out = 0) => {
      const pos =
        wall.axis === 'z' ? new THREE.Vector3(l, y, wall.plane) : new THREE.Vector3(wall.plane, y, l);
      pos.addScaledVector(wall.normal, out);
      return m4.compose(pos, new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY), new THREE.Vector3(1, 1, 1));
    };
    // Walls darken into the floor, the ceiling and the room's corners. UVs in metres for the plaster.
    const lateral = (p: THREE.Vector3) => (wall.axis === 'z' ? p.x : p.z);
    const wallPiece = (geo: THREE.BufferGeometry) => {
      bakeAO(geo, (p) => {
        const l = lateral(p);
        return (
          occlusion(p.y - y0, 0.22, 0.45) *
          occlusion(y1 - p.y, 0.55, 0.35) *
          occlusion(l - wall.lo, 0.45, 0.35) *
          occlusion(wall.hi - l, 0.45, 0.35)
        );
      });
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        uv.setXY(i, lateral(p), p.y);
      }
      parts.wall.push(geo);
    };
    const solid = (from: number, to: number) => {
      if (to - from < 1e-3) return;
      const mid = (from + to) / 2;
      wallPiece(aoPlane(to - from, h).applyMatrix4(place(mid, y0 + h / 2)));
      parts.trim.push(new THREE.BoxGeometry(to - from, BASE_H, BASE_D).applyMatrix4(place(mid, y0 + BASE_H / 2, BASE_D / 2)));
    };

    let cursor = wall.lo;
    for (const o of openings) {
      solid(cursor, o.from);
      const width = o.to - o.from;
      const mid = (o.from + o.to) / 2;
      const hasLintel = y1 - o.top > 1e-3;
      if (hasLintel) {
        wallPiece(aoPlane(width, y1 - o.top).applyMatrix4(place(mid, (o.top + y1) / 2)));
      }
      // Door casing on this side, only where there's wall to fix it to.
      const casingH = o.top - o.bottom;
      if (o.from - wall.lo > 1e-3) {
        parts.trim.push(
          new THREE.BoxGeometry(CASING_W, casingH, CASING_D).applyMatrix4(
            place(o.from - CASING_W / 2, o.bottom + casingH / 2, CASING_D / 2),
          ),
        );
      }
      if (wall.hi - o.to > 1e-3) {
        parts.trim.push(
          new THREE.BoxGeometry(CASING_W, casingH, CASING_D).applyMatrix4(
            place(o.to + CASING_W / 2, o.bottom + casingH / 2, CASING_D / 2),
          ),
        );
      }
      if (hasLintel) {
        parts.trim.push(
          new THREE.BoxGeometry(width + 2 * CASING_W, CASING_W, CASING_D).applyMatrix4(
            place(mid, o.top + CASING_W / 2, CASING_D / 2),
          ),
        );
      }
      cursor = o.to;
    }
    solid(cursor, wall.hi);
  }

  for (const [key, mat] of [
    ['wall', wallMat],
    ['ceiling', ceilingMat],
    ['trim', trimMat],
  ] as const) {
    const list = parts[key];
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => g.toNonIndexed())), mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    list.forEach((g) => g.dispose());
  }

  // Stand-in lighting until lightmaps are baked. Every light costs shading time on every
  // pixel in the museum, so keep the count low.
  const ceiling = finish.ceiling ?? 'downlights';
  if (ceiling === 'downlights') {
    const cols = Math.max(1, Math.round(w / 7));
    const rows = Math.max(1, Math.round(d / 7));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        // Recessed, so the ceiling itself stays unlit.
        const s = new THREE.SpotLight(0xfff1e0, 0.7 * h * h, 0, Math.PI / 2.6, 1, 2);
        s.position.set(x0 + ((i + 0.5) * w) / cols, y1 - 0.02, z0 + ((j + 0.5) * d) / rows);
        s.target.position.set(s.position.x, y0, s.position.z);
        group.add(s, s.target);
      }
    }
  } else if (ceiling === 'skylight') {
    group.add(...createSkylight(cx, y1, cz, w * 0.6, d * 0.6));
  }

  return group;
}

/**
 * A room's surfaces. `placeholder` rooms fake what a lightmap would give: per-vertex ambient
 * occlusion (vertexColors) and a little emission for bounce light. Baked rooms get the plain
 * surfaces and their lightmap supplies both.
 */
function surfaceMaterials(room: Room, placeholder: boolean) {
  const finish = room.finish ?? {};
  const wallColor = new THREE.Color(finish.walls ?? '#eeebe4');
  const plaster = finish.plaster !== false ? plasterTexture() : null;
  const wall = new THREE.MeshStandardMaterial({
    color: wallColor,
    map: plaster,
    emissive: placeholder ? wallColor.clone().multiplyScalar(0.07) : 0x000000,
    emissiveMap: placeholder ? plaster : null,
    roughness: 0.95,
    vertexColors: placeholder,
  });
  const ceilingColor = wallColor.clone().offsetHSL(0, 0, 0.03);
  const ceiling = new THREE.MeshStandardMaterial({
    color: ceilingColor,
    emissive: placeholder ? ceilingColor.clone().multiplyScalar(0.12) : 0x000000,
    roughness: 0.97,
    vertexColors: placeholder,
  });
  const trim = new THREE.MeshStandardMaterial({ color: wallColor.clone().offsetHSL(0, 0, -0.05), roughness: 0.7 });
  // Floors are shared per style; baked rooms get a copy without the vertex-colour AO.
  const shared = floorMaterial(finish.floor ?? 'oak');
  let floor = shared;
  if (!placeholder) {
    floor = shared.clone();
    floor.vertexColors = false;
  }
  const [x0, , z0] = room.bounds.min;
  const [x1, , z1] = room.bounds.max;
  const skylight = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff8ee).multiplyScalar(1.25),
    map: diffuserTexture((x1 - x0) * 0.6, (z1 - z0) * 0.6),
  });
  return { floor, wall, ceiling, trim, skylight };
}

let ltcReady = false;

/**
 * A diffuse ceiling light panel: one area light plus the glowing diffuser you see. Returned as
 * siblings, not a group, so a hidden room can hide the panel without switching the light off.
 */
function createSkylight(x: number, ceilingY: number, z: number, width: number, depth: number): THREE.Object3D[] {
  if (!ltcReady) {
    THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
    ltcReady = true;
  }
  const light = new THREE.RectAreaLight(0xfff8ee, 2.2, width, depth);
  light.position.set(x, ceilingY - 0.03, z);
  light.lookAt(x, 0, z);

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff8ee).multiplyScalar(1.25), map: diffuserTexture(width, depth) }),
  );
  panel.position.set(x, ceilingY - 0.02, z);
  return [light, panel];
}

/** Rewrites 0–1 UVs to metres so tiling textures keep a constant real-world scale. */
function scaleUVs(geo: THREE.BufferGeometry, sx: number, sy: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  uv.needsUpdate = true;
}
