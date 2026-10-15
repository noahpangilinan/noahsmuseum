/**
 * The shared scene-format contract (see docs/plan.md, "Scene format").
 * Change this only after agreeing with both World and Platform owners.
 */

import { findDoorway } from './layout';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Museum {
  rooms: Room[];
  artworks: Artwork[];
  /** Free-standing 3D pieces: sculpture, armour, objects in cases. */
  sculptures?: Sculpture[];
}

export interface Room {
  id: string;
  /** Display name, e.g. on the map. Rooms without one (corridors) go unlabelled. */
  name?: string;
  /** glTF room model, relative to content root. Omitted → procedural placeholder room built from `bounds`. */
  model?: string;
  /** Baked lightmap applied to UV1 of the room model. */
  lightmap?: string;
  /** Axis-aligned walkable volume in metres. `min[1]` is the floor height. */
  bounds: { min: Vec3; max: Vec3 };
  /** Where the visitor starts if this is the first room. Defaults to the room centre. */
  spawn?: { position: Vec3; lookAt?: Vec3 };
  /**
   * Ids of rooms reachable from this one. Connected rooms must share a wall plane:
   * the overlap of the two walls becomes a doorway (cut automatically in placeholder rooms).
   */
  connections: string[];
  slots: Slot[];
  /** Look of the placeholder room. Ignored once the room has a Blender `model`. */
  finish?: RoomFinish;
  furniture?: Furniture[];
}

export type FloorStyle = 'oak' | 'dark-wood' | 'concrete' | 'stone';

export interface RoomFinish {
  /** CSS colour. */
  walls?: string;
  /** Faint plaster texture on the walls. Default true; off gives a perfectly even painted wall. */
  plaster?: boolean;
  floor?: FloorStyle;
  /**
   * General lighting. `downlights` (default): recessed ceiling spots. `skylight`: one large
   * diffuse ceiling panel, white-cube style. `none`: dark room lit only by artwork spots.
   */
  ceiling?: CeilingLight;
  /** One warm spotlight per artwork. Default true; skylight rooms usually don't need them. */
  artworkSpots?: boolean;
}

export type CeilingLight = 'downlights' | 'skylight' | 'none';

export interface Furniture {
  type: 'bench';
  /** Floor position in metres. */
  position: Vec3;
  /** Rotation about the vertical axis in degrees. 0 = long side along x. */
  rotationY?: number;
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

/** `tapestry`: unframed textile hung from a rod, with soft folds. */
export type FrameStyle = 'gilded-ornate' | 'modern-black' | 'gallery-white' | 'none' | 'tapestry';

/** What every exhibit's label needs, wall-hung or free-standing. */
export interface ExhibitInfo {
  id: string;
  title: string;
  /** Artist, or maker/culture when unknown (e.g. "North Italy"). */
  artist: string;
  /** For sorting/filtering. Use `date` for how it should read on the label. */
  year: number;
  /** Display date when a single year isn't accurate, e.g. "1819–1823" or "c. 1599". */
  date?: string;
  /** Real size in centimetres: [height, width] for flat works, [height, width, depth] for 3D. */
  dimensionsCm: number[];
  source: string;
  license: string;
}

export interface Artwork extends ExhibitInfo {
  /** `<roomId>/<slotId>` */
  slot: string;
  /** Real physical size of the image area: [height, width] in centimetres. */
  dimensionsCm: Vec2;
  /** Preview texture shown from a distance, relative to content root (.ktx2 preferred; .jpg/.png/.webp work). */
  image: string;
  /** Full-resolution image loaded only when the visitor is close (see docs/textures.md). */
  imageFull?: string;
  /** Deep Zoom tile pyramid directory (M3). */
  deepZoom?: string;
  frame: FrameStyle;
  /** Wall label beside the piece. Default true; turn off for all but one panel of a triptych. */
  label?: boolean;
}

/**
 * `case`: plinth with a glass vitrine. `plinth`: open pedestal. `platform`: low stage
 * for large pieces (e.g. a mounted armour).
 */
export type DisplayStyle = 'case' | 'plinth' | 'platform';

export interface Sculpture extends ExhibitInfo {
  room: string;
  /** Floor point under the centre of the display, in metres. */
  position: Vec3;
  /** Degrees about the vertical axis. 0 = the piece's front faces +z. */
  rotationY?: number;
  /** Real size: [height, width, depth] in centimetres. The model is scaled to this height. */
  dimensionsCm: Vec3;
  display: DisplayStyle;
  /** glTF model (Meshopt + KTX2 welcome), relative to content root. Until it exists, `image` stands in. */
  model?: string;
  /** Photo of the object, shown on a card in the display until `model` is available. */
  image?: string;
}

const FRAME_STYLES: FrameStyle[] = ['gilded-ornate', 'modern-black', 'gallery-white', 'none', 'tapestry'];
const FLOOR_STYLES: FloorStyle[] = ['oak', 'dark-wood', 'concrete', 'stone'];
const DISPLAY_STYLES: DisplayStyle[] = ['case', 'plinth', 'platform'];
const CEILING_LIGHTS: CeilingLight[] = ['downlights', 'skylight', 'none'];

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
    if (r.finish?.floor && !FLOOR_STYLES.includes(r.finish.floor)) {
      problems.push(`${where}: "finish.floor" must be one of ${FLOOR_STYLES.join(', ')}`);
    }
    if (r.finish?.ceiling && !CEILING_LIGHTS.includes(r.finish.ceiling)) {
      problems.push(`${where}: "finish.ceiling" must be one of ${CEILING_LIGHTS.join(', ')}`);
    }
    for (const [j, f] of (r.furniture ?? []).entries()) {
      if (f.type !== 'bench') problems.push(`${where} furniture[${j}]: unknown type "${f.type}"`);
      if (!isVec(f.position, 3)) problems.push(`${where} furniture[${j}]: "position" must be [x, y, z]`);
    }
  }
  for (const r of m.rooms) {
    for (const c of r.connections ?? []) {
      if (!roomIds.has(c)) {
        problems.push(`room ${r.id}: connection "${c}" is not a known room`);
        continue;
      }
      const other = m.rooms.find((o) => o.id === c)!;
      if (isVec(r.bounds?.min, 3) && isVec(other.bounds?.min, 3) && !findDoorway(r, other)) {
        problems.push(`rooms ${r.id} and ${c} are connected but don't share a wall, so no doorway fits`);
      }
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
    if (a.label !== undefined && typeof a.label !== 'boolean') problems.push(`${where}: "label" must be true or false`);
    if (a.imageFull !== undefined && !isStr(a.imageFull)) problems.push(`${where}: "imageFull" must be a path`);
    if (!FRAME_STYLES.includes(a.frame)) {
      problems.push(`${where}: "frame" must be one of ${FRAME_STYLES.join(', ')}`);
    }
  }

  for (const [i, sc] of (m.sculptures ?? []).entries()) {
    const where = `sculptures[${i}]${sc?.id ? ` (${sc.id})` : ''}`;
    if (!isStr(sc.id)) problems.push(`${where}: missing "id"`);
    else if (artIds.has(sc.id)) problems.push(`${where}: id is already used by another exhibit`);
    artIds.add(sc.id);
    if (!roomIds.has(sc.room)) problems.push(`${where}: room "${sc.room}" does not exist`);
    if (!isVec(sc.position, 3)) problems.push(`${where}: "position" must be [x, y, z]`);
    if (!isVec(sc.dimensionsCm, 3) || sc.dimensionsCm.some((d) => d <= 0)) {
      problems.push(`${where}: "dimensionsCm" must be [height, width, depth] in cm`);
    }
    if (!DISPLAY_STYLES.includes(sc.display)) problems.push(`${where}: "display" must be one of ${DISPLAY_STYLES.join(', ')}`);
    if (!sc.model && !sc.image) problems.push(`${where}: needs a "model" or a placeholder "image"`);
    for (const f of ['title', 'artist', 'source', 'license'] as const) {
      if (!isStr(sc[f])) problems.push(`${where}: missing "${f}"`);
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
