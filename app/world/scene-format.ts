/**
 * The shared scene-format contract (see docs/plan.md, "Scene format").
 * Change this only after agreeing with both World and Platform owners.
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Museum {
  rooms: Room[];
  artworks: Artwork[];
}

export interface Room {
  id: string;
  /** glTF room model, relative to content root. Omitted → procedural placeholder room built from `bounds`. */
  model?: string;
  /** Baked lightmap applied to UV1 of the room model. */
  lightmap?: string;
  /** Axis-aligned walkable volume in metres. `min[1]` is the floor height. */
  bounds: { min: Vec3; max: Vec3 };
  /** Where the visitor starts if this is the first room. Defaults to the room centre. */
  spawn?: { position: Vec3; lookAt?: Vec3 };
  /** Ids of rooms reachable from this one (used for streaming in M3). */
  connections: string[];
  slots: Slot[];
}

export interface Slot {
  id: string;
  /** Centre of the hanging area, on (or just in front of) the wall surface, in metres. */
  position: Vec3;
  /** Unit vector pointing out of the wall, into the room. */
  normal: Vec3;
  /** Largest artwork the slot can hold: [width, height] in metres. */
  maxSize: Vec2;
}

export type FrameStyle = 'gilded-ornate' | 'modern-black' | 'gallery-white' | 'none';

export interface Artwork {
  id: string;
  /** `<roomId>/<slotId>` */
  slot: string;
  title: string;
  artist: string;
  year: number;
  /** Real physical size of the image area: [height, width] in centimetres. */
  dimensionsCm: Vec2;
  /** Preview texture, relative to content root (.ktx2, .jpg, .png, .webp). */
  image: string;
  /** Deep Zoom tile pyramid directory (M3). */
  deepZoom?: string;
  frame: FrameStyle;
  source: string;
  license: string;
}

const FRAME_STYLES: FrameStyle[] = ['gilded-ornate', 'modern-black', 'gallery-white', 'none'];

export class SceneFormatError extends Error {
  constructor(public readonly problems: string[]) {
    super(`museum.json has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    this.name = 'SceneFormatError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(isNum);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Checks structure and cross-references. Throws a SceneFormatError listing every problem found. */
export function validateMuseum(data: unknown): Museum {
  const problems: string[] = [];
  const m = data as Partial<Museum>;
  if (!m || !Array.isArray(m.rooms) || !Array.isArray(m.artworks)) {
    throw new SceneFormatError(['top level must have "rooms" and "artworks" arrays']);
  }

  const slotIds = new Set<string>();
  const roomIds = new Set<string>();
  for (const [i, r] of m.rooms.entries()) {
    const where = `rooms[${i}]${r?.id ? ` (${r.id})` : ''}`;
    if (!isStr(r.id)) problems.push(`${where}: missing "id"`);
    else if (roomIds.has(r.id)) problems.push(`${where}: duplicate room id`);
    roomIds.add(r.id);
    if (!r.bounds || !isVec(r.bounds.min, 3) || !isVec(r.bounds.max, 3)) {
      problems.push(`${where}: "bounds" needs min and max as [x, y, z]`);
    }
    if (!Array.isArray(r.connections)) problems.push(`${where}: "connections" must be an array`);
    if (!Array.isArray(r.slots)) {
      problems.push(`${where}: "slots" must be an array`);
      continue;
    }
    for (const s of r.slots) {
      const sw = `${where} slot ${s?.id ?? '?'}`;
      if (!isStr(s.id)) problems.push(`${sw}: missing "id"`);
      if (!isVec(s.position, 3)) problems.push(`${sw}: "position" must be [x, y, z]`);
      if (!isVec(s.normal, 3)) problems.push(`${sw}: "normal" must be [x, y, z]`);
      if (!isVec(s.maxSize, 2)) problems.push(`${sw}: "maxSize" must be [width, height]`);
      slotIds.add(`${r.id}/${s.id}`);
    }
  }
  for (const r of m.rooms) {
    for (const c of r.connections ?? []) {
      if (!roomIds.has(c)) problems.push(`room ${r.id}: connection "${c}" is not a known room`);
    }
  }

  const artIds = new Set<string>();
  const usedSlots = new Set<string>();
  for (const [i, a] of m.artworks.entries()) {
    const where = `artworks[${i}]${a?.id ? ` (${a.id})` : ''}`;
    if (!isStr(a.id)) problems.push(`${where}: missing "id"`);
    else if (artIds.has(a.id)) problems.push(`${where}: duplicate artwork id`);
    artIds.add(a.id);
    if (!isStr(a.slot) || !slotIds.has(a.slot)) problems.push(`${where}: slot "${a.slot}" does not exist`);
    else if (usedSlots.has(a.slot)) problems.push(`${where}: slot "${a.slot}" is already used`);
    usedSlots.add(a.slot);
    for (const f of ['title', 'artist', 'image', 'source', 'license'] as const) {
      if (!isStr(a[f])) problems.push(`${where}: missing "${f}"`);
    }
    if (!isNum(a.year)) problems.push(`${where}: "year" must be a number`);
    if (!isVec(a.dimensionsCm, 2) || a.dimensionsCm.some((d) => d <= 0)) {
      problems.push(`${where}: "dimensionsCm" must be [height, width] in cm`);
    }
    if (!FRAME_STYLES.includes(a.frame)) {
      problems.push(`${where}: "frame" must be one of ${FRAME_STYLES.join(', ')}`);
    }
  }

  if (problems.length) throw new SceneFormatError(problems);
  return m as Museum;
}

/** Resolves a content-relative path against the deployed base URL. */
export function contentUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}

export async function loadMuseum(url = contentUrl('museum.json')): Promise<Museum> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status} ${res.statusText}`);
  return validateMuseum(await res.json());
}
