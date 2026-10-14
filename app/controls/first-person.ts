import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { LoadedRoom } from '../world/rooms';
import type { Walkable } from '../world/layout';
import { BENCH_SIZE } from '../world/layout';

const EYE_HEIGHT = 1.6;
const CROUCH_EYE_HEIGHT = 1.0;
const SEATED_EYE_HEIGHT = 1.15;
export const BODY_RADIUS = 0.3;
const WALK_SPEED = 3.0; // m/s: brisker than real life, which feels right on screen
const RUN_SPEED = 6.0;
const CROUCH_SPEED = 1.4;
const ACCEL = 8; // higher = snappier easing toward target speed
const POSE_EASE = 8; // how quickly eye height and sit/stand moves settle
/** How far away a bench can be clicked to sit on it. */
const SIT_REACH = 3;

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  // Ctrl, with C as a fallback: browsers won't let a page block Ctrl+W (close tab),
  // so crouch-walking forward with Ctrl+W can't be fully protected.
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
};

/**
 * Pointer-lock first-person walking: WASD/arrows, mouse look, eased acceleration,
 * crouching, sitting on benches, and collision against the walkable floor area.
 */
export class FirstPersonControls {
  readonly pointer: PointerLockControls;
  private readonly pressed = new Set<string>();
  private readonly velocity = new THREE.Vector2(); // x = right, y = forward (m/s)
  private readonly raycaster = new THREE.Raycaster();
  private currentRoom: LoadedRoom;
  private eyeHeight = EYE_HEIGHT;
  /** Set while sitting: where to return to when standing up. */
  private seat: { standAt: THREE.Vector3 } | null = null;
  /** Floor position the camera is gliding to (sitting down or standing up); input is paused meanwhile. */
  private glideTo: THREE.Vector3 | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private readonly rooms: LoadedRoom[],
    private readonly walkable: Walkable,
  ) {
    this.pointer = new PointerLockControls(camera, domElement);
    this.currentRoom = rooms[0];
    this.raycaster.far = SIT_REACH;

    window.addEventListener('keydown', (e) => {
      this.pressed.add(e.code);
      // While walking, stop the Ctrl shortcuts a page is allowed to cancel (save, bookmark, select all…).
      if (this.pointer.isLocked && e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    window.addEventListener('blur', () => this.pressed.clear());
    this.pointer.addEventListener('unlock', () => this.pressed.clear());
  }

  get isLocked() {
    return this.pointer.isLocked;
  }

  get room() {
    return this.currentRoom;
  }

  get isSeated() {
    return this.seat !== null;
  }

  lock() {
    this.pointer.lock();
  }

  /** Places the camera at the room's spawn point (or its centre). */
  spawn(room: LoadedRoom) {
    this.currentRoom = room;
    const spawn = room.room.spawn;
    const center = room.box.getCenter(new THREE.Vector3());
    const pos = spawn ? new THREE.Vector3(...spawn.position) : center;
    this.camera.position.set(pos.x, room.box.min.y + EYE_HEIGHT, pos.z);
    const look = spawn?.lookAt ? new THREE.Vector3(...spawn.lookAt) : center.setY(EYE_HEIGHT);
    this.camera.lookAt(look);
  }

  /** The bench under the crosshair and within reach, if any. */
  benchInView(): THREE.Object3D | null {
    if (this.seat) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const benches = this.rooms.flatMap((r) => r.benches);
    const hit = this.raycaster.intersectObjects(benches, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !benches.includes(o)) o = o.parent;
    return o;
  }

  /** Sit on the bench at the point along it nearest to where you're standing. */
  sit(bench: THREE.Object3D) {
    const p = this.camera.position;
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(bench.getWorldQuaternion(new THREE.Quaternion()));
    const centre = bench.getWorldPosition(new THREE.Vector3());
    const along = THREE.MathUtils.clamp(
      new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z).dot(axis),
      -BENCH_SIZE.length / 2 + 0.3,
      BENCH_SIZE.length / 2 - 0.3,
    );
    this.seat = { standAt: new THREE.Vector3(p.x, 0, p.z) };
    this.glideTo = centre.addScaledVector(axis, along).setY(0);
    this.velocity.set(0, 0);
  }

  stand() {
    if (!this.seat) return;
    this.glideTo = this.seat.standAt;
    this.seat = null;
  }

  update(dt: number) {
    const held = (k: keyof typeof KEYS) => KEYS[k].some((c) => this.pressed.has(c));
    const ease = 1 - Math.exp(-POSE_EASE * dt);
    const crouching = held('crouch') && !this.seat;

    const targetEye = this.seat ? SEATED_EYE_HEIGHT : crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEye - this.eyeHeight) * ease;

    const p = this.camera.position;
    if (this.glideTo) {
      // Sitting down or standing up: glide there, no walking until it's done.
      p.x += (this.glideTo.x - p.x) * ease;
      p.z += (this.glideTo.z - p.z) * ease;
      if (!this.seat && Math.hypot(this.glideTo.x - p.x, this.glideTo.z - p.z) < 0.01) {
        p.set(this.glideTo.x, p.y, this.glideTo.z);
        this.glideTo = null;
      }
    } else {
      const active = this.pointer.isLocked;
      const input = new THREE.Vector2(
        active ? Number(held('right')) - Number(held('left')) : 0,
        active ? Number(held('forward')) - Number(held('back')) : 0,
      );
      if (input.lengthSq() > 1) input.normalize();
      input.multiplyScalar(crouching ? CROUCH_SPEED : held('run') ? RUN_SPEED : WALK_SPEED);

      this.velocity.lerp(input, 1 - Math.exp(-ACCEL * dt));
      if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0);

      const before = p.clone();
      this.pointer.moveRight(this.velocity.x * dt);
      this.pointer.moveForward(this.velocity.y * dt);
      this.collide(before);
    }

    const inside = this.rooms.find(
      (r) => p.x >= r.box.min.x && p.x <= r.box.max.x && p.z >= r.box.min.z && p.z <= r.box.max.z,
    );
    if (inside) this.currentRoom = inside;
    p.y = this.currentRoom.box.min.y + this.eyeHeight;
  }

  /** Rejects moves off the walkable area, sliding along walls where one axis is still free. */
  private collide(before: THREE.Vector3) {
    const p = this.camera.position;
    if (this.walkable.contains(p.x, p.z)) return;
    if (this.walkable.contains(p.x, before.z)) p.z = before.z;
    else if (this.walkable.contains(before.x, p.z)) p.x = before.x;
    else p.set(before.x, p.y, before.z);
  }
}
