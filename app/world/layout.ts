import type { Museum, Room, Sculpture } from './scene-format';

const EPS = 1e-3;
/** Doorways are never taller than this, even between two tall rooms. */
const MAX_DOOR_HEIGHT = 3.6;
/** Narrowest gap worth calling a doorway. */
const MIN_DOOR_WIDTH = 0.9;

/**
 * An opening in the wall plane shared by two connected rooms.
 * `axis` is the axis the wall is perpendicular to; the opening spans `[from, to]`
 * along the other horizontal axis, from the floor up to `top`.
 */
export interface Doorway {
  rooms: [string, string];
  axis: 'x' | 'z';
  plane: number;
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** Returns the doorway between two rooms if their boxes touch along a wall, else null. */
export function findDoorway(a: Room, b: Room): Doorway | null {
  const [ax0, ay0, az0] = a.bounds.min;
  const [ax1, ay1, az1] = a.bounds.max;
  const [bx0, by0, bz0] = b.bounds.min;
  const [bx1, by1, bz1] = b.bounds.max;
  const bottom = Math.max(ay0, by0);
  const top = Math.min(ay1, by1, bottom + MAX_DOOR_HEIGHT);
  if (top - bottom < 2) return null;

  const overlap = (lo0: number, hi0: number, lo1: number, hi1: number) => [Math.max(lo0, lo1), Math.min(hi0, hi1)];
  const touching = (p: number, q: number) => Math.abs(p - q) < EPS;
  const rooms: [string, string] = [a.id, b.id];

  // Shared wall perpendicular to z (north/south walls).
  for (const [p, q] of [[az0, bz1], [az1, bz0]]) {
    if (!touching(p, q)) continue;
    const [from, to] = overlap(ax0, ax1, bx0, bx1);
    if (to - from >= MIN_DOOR_WIDTH) return { rooms, axis: 'z', plane: p, from, to, bottom, top };
  }
  // Shared wall perpendicular to x (east/west walls).
  for (const [p, q] of [[ax0, bx1], [ax1, bx0]]) {
    if (!touching(p, q)) continue;
    const [from, to] = overlap(az0, az1, bz0, bz1);
    if (to - from >= MIN_DOOR_WIDTH) return { rooms, axis: 'x', plane: p, from, to, bottom, top };
  }
  return null;
}

/** Every doorway in the museum, one per connected pair. */
export function findDoorways(museum: Museum): Doorway[] {
  const byId = new Map(museum.rooms.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const doorways: Doorway[] = [];
  for (const r of museum.rooms) {
    for (const c of r.connections) {
      const key = [r.id, c].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const d = findDoorway(r, byId.get(c)!);
      if (d) doorways.push(d);
    }
  }
  return doorways;
}

/** Bench footprint in metres (long side × depth). Shared with the bench model. */
export const BENCH_SIZE = { length: 1.6, depth: 0.5, height: 0.46 };

/** Size of a sculpture's plinth/platform in metres, before rotation (width along x, depth along z). */
export function displaySize(sc: Sculpture): { width: number; depth: number; height: number } {
  const [h, w, d] = sc.dimensionsCm.map((cm) => cm / 100);
  if (sc.display === 'platform') return { width: w + 0.8, depth: d + 0.8, height: 0.35 };
  // Tall pieces stand on a low base; small ones are raised to eye level.
  const height = h > 1.2 ? 0.3 : sc.display === 'case' ? 0.95 : 0.9;
  return { width: Math.max(0.6, w + 0.3), depth: Math.max(0.6, d + 0.3), height };
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * The floor area a visitor can stand on: every room plus a strip through each doorway,
 * minus furniture. Works on the visitor's centre point, with the body radius baked in.
 */
export class Walkable {
  private readonly open: Rect[] = [];
  private readonly blocked: Rect[] = [];

  constructor(museum: Museum, doorways: Doorway[], radius: number) {
    for (const r of museum.rooms) {
      const [x0, , z0] = r.bounds.min;
      const [x1, , z1] = r.bounds.max;
      this.open.push({ x0: x0 + radius, x1: x1 - radius, z0: z0 + radius, z1: z1 - radius });
      for (const f of r.furniture ?? []) {
        this.blocked.push(footprint(f.position, BENCH_SIZE.length, BENCH_SIZE.depth, f.rotationY, radius));
      }
    }
    for (const sc of museum.sculptures ?? []) {
      const size = displaySize(sc);
      this.blocked.push(footprint(sc.position, size.width, size.depth, sc.rotationY, radius));
    }
    for (const d of doorways) {
      const lateral = { lo: d.from + radius, hi: d.to - radius };
      const across = { lo: d.plane - radius - 0.05, hi: d.plane + radius + 0.05 };
      this.open.push(
        d.axis === 'z'
          ? { x0: lateral.lo, x1: lateral.hi, z0: across.lo, z1: across.hi }
          : { x0: across.lo, x1: across.hi, z0: lateral.lo, z1: lateral.hi },
      );
    }
  }

  contains(x: number, z: number): boolean {
    const inside = (r: Rect) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    return this.open.some(inside) && !this.blocked.some(inside);
  }
}

/** Axis-aligned footprint of a box rotated by a multiple of 90°, grown by the body radius. */
function footprint(position: number[], width: number, depth: number, rotationY: number | undefined, radius: number): Rect {
  const quarterTurns = Math.round((rotationY ?? 0) / 90) % 2 !== 0;
  const hx = (quarterTurns ? depth : width) / 2 + radius;
  const hz = (quarterTurns ? width : depth) / 2 + radius;
  const [x, , z] = position;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}
