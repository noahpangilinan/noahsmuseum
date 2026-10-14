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
 * Rooms within `radius` doorways of the visitor are loaded; the rest release their
 * textures and models. Two doorways is enough to cover what you can see down a corridor.
 *
 * This frees GPU memory, which is different from rendering cost: three.js already skips
 * drawing anything outside the camera's view (frustum culling).
 */
export class RoomStreamer {
  private readonly graph = new Map<string, string[]>();
  private current: string | null = null;
  private loaded = new Set<string>();

  constructor(
    museum: Museum,
    private readonly items: Streamable[],
    private readonly radius = 2,
  ) {
    for (const r of museum.rooms) this.graph.set(r.id, [...r.connections]);
    // Connections may be listed on one side only; make the graph symmetric.
    for (const r of museum.rooms) for (const c of r.connections) {
      const back = this.graph.get(c)!;
      if (!back.includes(r.id)) back.push(r.id);
    }
  }

  /** Call every frame with the visitor's room; does work only when it changes. */
  update(roomId: string) {
    if (roomId === this.current) return;
    this.current = roomId;
    this.loaded = this.roomsWithin(roomId, this.radius);
    for (const item of this.items) {
      if (this.loaded.has(item.room)) item.load();
      else item.unload();
    }
  }

  loadedRooms(): string[] {
    return [...this.loaded];
  }

  private roomsWithin(start: string, radius: number): Set<string> {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const r = queue.shift()!;
      const d = dist.get(r)!;
      if (d === radius) continue;
      for (const n of this.graph.get(r) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, d + 1);
          queue.push(n);
        }
      }
    }
    return new Set(dist.keys());
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
