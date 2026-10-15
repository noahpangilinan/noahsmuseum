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
 * One material's `map` with quality tiers, e.g. [distant preview, full resolution]. Ask for a
 * tier with `want(level)` (-1 = nothing): tiers up to that level are fetched, tiers above it are
 * released, and the material shows the best tier it has (the shared placeholder until then).
 * Handles requests changing while a fetch is in flight.
 */
export class TieredMap {
  private readonly textures: (THREE.Texture | null)[];
  private readonly pending: boolean[];
  private wanted = -1;

  constructor(
    private readonly material: THREE.MeshStandardMaterial,
    private readonly tiers: (() => Promise<THREE.Texture>)[],
    private readonly colors: { loaded: THREE.ColorRepresentation; unloaded: THREE.ColorRepresentation },
    private readonly onShow?: (texture: THREE.Texture) => void,
  ) {
    this.textures = tiers.map(() => null);
    this.pending = tiers.map(() => false);
    material.map = placeholderTexture();
    material.color.set(colors.unloaded);
  }

  /** Highest tier that should be resident; -1 releases everything. */
  want(level: number) {
    this.wanted = Math.min(level, this.tiers.length - 1);
    this.show();
    this.tiers.forEach((fetch, i) => {
      if (i > this.wanted) {
        this.textures[i]?.dispose();
        this.textures[i] = null;
      } else if (!this.textures[i] && !this.pending[i]) {
        this.pending[i] = true;
        fetch().then(
          (tex) => {
            this.pending[i] = false;
            if (i > this.wanted) return tex.dispose(); // no longer wanted by the time it arrived
            this.textures[i] = tex;
            this.show();
          },
          (err) => {
            this.pending[i] = false;
            console.error('[museum] texture failed to load', err);
          },
        );
      }
    });
  }

  private show() {
    let best: THREE.Texture | null = null;
    for (let i = Math.min(this.wanted, this.textures.length - 1); i >= 0 && !best; i--) best = this.textures[i];
    const next = best ?? placeholderTexture();
    if (this.material.map === next) return;
    this.material.map = next;
    this.material.color.set(best ? this.colors.loaded : this.colors.unloaded);
    this.material.needsUpdate = true;
    if (best) this.onShow?.(best);
  }
}

/** A single-tier `TieredMap`: the texture is either loaded or not. */
export class StreamedMap extends TieredMap {
  constructor(
    material: THREE.MeshStandardMaterial,
    fetch: () => Promise<THREE.Texture>,
    colors: { loaded: THREE.ColorRepresentation; unloaded: THREE.ColorRepresentation },
    onShow?: (texture: THREE.Texture) => void,
  ) {
    super(material, [fetch], colors, onShow);
  }

  load() {
    this.want(0);
  }

  unload() {
    this.want(-1);
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
