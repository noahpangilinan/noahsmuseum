import * as THREE from 'three/webgpu';

/** One artwork that wants a gallery spot. */
export interface SpotRequest {
  room: string;
  /** World-space centre of the artwork. */
  center: THREE.Vector3;
  /** Direction the artwork faces (into the room). */
  normal: THREE.Vector3;
  /** Area to light, in metres: artwork plus frame. */
  width: number;
  height: number;
  /** How far the wall label extends past the frame's right edge; single spots cover it too. */
  labelReach: number;
  roomBounds: THREE.Box3;
}

const WARM = 0xffe4c4;
/** Illuminance-ish target on the canvas; intensity is scaled by distance² so every piece reads the same. */
const TARGET = 1.6;

/**
 * Lights artworks with as few lights as possible, since every light adds shading cost to every
 * pixel and lengthens shader compilation. A painting alone on its wall gets its own spot.
 * A wall with several shares one spot whose projected "cookie" texture paints a soft pool on
 * each piece: one light, same look.
 */
export function lightArtworks(scene: THREE.Scene, requests: SpotRequest[]): number {
  const walls = new Map<string, SpotRequest[]>();
  for (const r of requests) {
    const plane = r.center.dot(r.normal).toFixed(1);
    const key = `${r.room}|${r.normal.x.toFixed(2)},${r.normal.z.toFixed(2)}|${plane}`;
    walls.set(key, [...(walls.get(key) ?? []), r]);
  }
  for (const group of walls.values()) {
    if (group.length === 1) addSingleSpot(scene, group[0]);
    else addWallSpot(scene, group);
  }
  return walls.size;
}

/** Warm spot from the ceiling, angled ~30° down onto the artwork. */
function addSingleSpot(scene: THREE.Scene, r: SpotRequest) {
  const mountY = r.roomBounds.max.y - 0.2;
  const out = Math.max(1.2, (mountY - r.center.y) * 0.6);
  const pos = r.center.clone().addScaledVector(r.normal, out);
  pos.y = mountY;

  const dist = pos.distanceTo(r.center);
  const radius = 0.5 * Math.hypot(r.width + r.labelReach, r.height) * 1.15;
  const spot = new THREE.SpotLight(WARM, TARGET * dist * dist, 0, Math.atan(radius / dist), 0.65, 2);
  spot.position.copy(pos);
  spot.target.position.copy(r.center);
  scene.add(spot, spot.target);
}

/** One spot set back from the wall, with a cookie texture holding a pool per artwork. */
function addWallSpot(scene: THREE.Scene, group: SpotRequest[]) {
  const normal = group[0].normal;
  const along = new THREE.Vector3().crossVectors(normal, THREE.Object3D.DEFAULT_UP).normalize();
  const wallCenter = group.reduce((c, r) => c.add(r.center), new THREE.Vector3()).divideScalar(group.length);
  const spread = Math.max(...group.map((r) => Math.abs(r.center.clone().sub(wallCenter).dot(along)) + r.width / 2));

  // Back off far enough to cover the whole row, but stay inside the room.
  const bounds = group[0].roomBounds;
  const depth = Math.abs(normal.x) > 0.5 ? bounds.max.x - bounds.min.x : bounds.max.z - bounds.min.z;
  const back = THREE.MathUtils.clamp(spread / Math.tan(THREE.MathUtils.degToRad(40)), 2.5, depth * 0.7);
  const pos = wallCenter.clone().addScaledVector(normal, back);
  pos.y = bounds.max.y - 0.2;

  const angle = Math.min(1.3, Math.atan((spread * 1.15) / back) + 0.12);
  const farthest = Math.max(...group.map((r) => pos.distanceTo(r.center)));
  // Hard cone edge: the cookie supplies the soft falloff around each piece.
  const spot = new THREE.SpotLight(WARM, TARGET * farthest * farthest, 0, angle, 0.02, 2);
  spot.position.copy(pos);
  spot.target.position.copy(wallCenter);
  spot.updateMatrixWorld();
  spot.target.updateMatrixWorld();
  // The cookie only masks light inside the projection frustum. With the default 0.5 m near
  // plane, the ceiling just above the fixture fell outside it and lit up at full strength.
  spot.shadow.camera.near = 0.02;
  spot.shadow.camera.far = 80;
  spot.shadow.updateMatrices(spot); // the cookie is projected through the shadow camera
  spot.map = cookieTexture(spot, group, along, farthest);
  scene.add(spot, spot.target);
}

function cookieTexture(spot: THREE.SpotLight, group: SpotRequest[], along: THREE.Vector3, farthest: number): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  const toPixel = (p: THREE.Vector3) => {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(spot.shadow.matrix);
    return [(v.x / v.w) * size, (1 - v.y / v.w) * size]; // canvas rows run top-down; textures flip Y
  };

  for (const r of group) {
    // A pool a little larger than the piece, like a real gallery spot.
    const halfW = (r.width / 2) * 1.25 + 0.15;
    const halfH = (r.height / 2) * 1.2 + 0.2;
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => toPixel(r.center.clone().addScaledVector(along, sx * halfW).add(new THREE.Vector3(0, sy * halfH, 0)))),
    );
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rx = (Math.max(...xs) - Math.min(...xs)) / 2;
    const ry = (Math.max(...ys) - Math.min(...ys)) / 2;

    // Pieces further from the light get a brighter pool so all of them land at the same level.
    const d = spot.position.distanceTo(r.center);
    const level = Math.round(255 * Math.min(1, (d * d) / (farthest * farthest)));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    // Flat centre, long soft falloff: reads as a beam, not a stage spotlight.
    const shade = (k: number) => `rgb(${Math.round(level * k)},${Math.round(level * k)},${Math.round(level * k)})`;
    g.addColorStop(0, shade(1));
    g.addColorStop(0.55, shade(0.95));
    g.addColorStop(0.8, shade(0.45));
    g.addColorStop(1, shade(0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return new THREE.CanvasTexture(canvas);
}
