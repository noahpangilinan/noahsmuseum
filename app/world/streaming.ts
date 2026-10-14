import * as THREE from 'three/webgpu';
import type { Museum } from './scene-format';
import { placeholderTexture } from './wall-label';

/** Something whose heavy GPU data can be dropped while its room is far away. */
export interface Streamable {
  room: string;
  load(): void;
  unload(): void;
}

/**
 * Decides what exists on the GPU and what gets drawn, room by room, from the precomputed
 * line-of-sight table (`computeVisibility`):
 *
 * - **Drawn:** rooms visible from the visitor's room. Everything else is hidden, which saves
 *   draw calls that frustum culling can't (a room behind a wall is still "in view").
 * - **Loaded:** the drawn set, plus what the neighbouring rooms can see as long as it's within
 *   two doorways, so stepping through a doorway rarely reveals art that's still downloading.
 *   (Anything further is so far away that its brief grey placeholder is a few pixels.) The
 *   rest release their textures and models.
 */
export class RoomStreamer {
  private readonly neighbours = new Map<string, string[]>();
  private current: string | null = null;
  private loaded = new Set<string>();
  private drawn = new Set<string>();

  constructor(
    museum: Museum,
    private readonly items: Streamable[],
    private readonly visibility: Map<string, Set<string>>,
    /** Scene objects belonging to each room (its shell, furniture and exhibits). */
    private readonly roomObjects: Map<string, THREE.Object3D[]>,
  ) {
    for (const r of museum.rooms) this.neighbours.set(r.id, [...r.connections]);
    // Connections may be listed on one side only; make the graph symmetric.
    for (const r of museum.rooms) for (const c of r.connections) {
      const back = this.neighbours.get(c)!;
      if (!back.includes(r.id)) back.push(r.id);
    }
  }

  /** Call every frame with the visitor's room; does work only when it changes. */
  update(roomId: string) {
    if (roomId === this.current) return;
    this.current = roomId;
    this.drawn = new Set(this.visibility.get(roomId));
    this.loaded = new Set(this.drawn);
    const near = this.roomsWithin(roomId, 2);
    for (const n of this.neighbours.get(roomId) ?? []) {
      for (const r of this.visibility.get(n) ?? []) if (near.has(r)) this.loaded.add(r);
    }
    for (const [room, objects] of this.roomObjects) {
      for (const o of objects) o.visible = this.drawn.has(room);
    }
    for (const item of this.items) {
      if (this.loaded.has(item.room)) item.load();
      else item.unload();
    }
  }

  private roomsWithin(start: string, hops: number): Set<string> {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const r = queue.shift()!;
      const d = dist.get(r)!;
      if (d === hops) continue;
      for (const n of this.neighbours.get(r) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
    return new Set(dist.keys());
  }

  drawnRooms(): string[] {
    return [...this.drawn];
  }

  loadedRooms(): string[] {
    return [...this.loaded];
  }
}

/**
 * One material's `map`, streamed: the real texture while loaded, the shared placeholder
 * otherwise. Handles load/unload racing with an in-flight fetch.
 */
export class StreamedMap {
  private texture: THREE.Texture | null = null;
  private pending = false;
  private wanted = false;

  constructor(
    private readonly material: THREE.MeshStandardMaterial,
    private readonly fetch: () => Promise<THREE.Texture>,
    private readonly colors: { loaded: THREE.ColorRepresentation; unloaded: THREE.ColorRepresentation },
    private readonly onLoad?: (texture: THREE.Texture) => void,
  ) {
    material.map = placeholderTexture();
    material.color.set(colors.unloaded);
  }

  load() {
    this.wanted = true;
    if (this.texture || this.pending) return;
    this.pending = true;
    this.fetch().then(
      (tex) => {
        this.pending = false;
        if (!this.wanted) {
          tex.dispose(); // left the area while it was downloading
          return;
        }
        this.texture = tex;
        this.material.map = tex;
        this.material.color.set(this.colors.loaded);
        this.material.needsUpdate = true;
        this.onLoad?.(tex);
      },
      (err) => {
        this.pending = false;
        console.error('[museum] texture failed to load', err);
      },
    );
  }

  unload() {
    this.wanted = false;
    if (!this.texture) return;
    this.material.map = placeholderTexture();
    this.material.color.set(this.colors.unloaded);
    this.material.needsUpdate = true;
    this.texture.dispose();
    this.texture = null;
  }
}

/** Frees a loaded glTF scene's GPU resources. */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(m)) {
        if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      }
      m.dispose();
    }
  });
}
