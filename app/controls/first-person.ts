import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { LoadedRoom } from '../world/rooms';
import type { Walkable } from '../world/layout';

const EYE_HEIGHT = 1.6;
export const BODY_RADIUS = 0.3;
const WALK_SPEED = 1.4; // m/s, a gallery stroll
const RUN_SPEED = 3.0;
const ACCEL = 8; // higher = snappier easing toward target speed

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
};

/**
 * Pointer-lock first-person walking: WASD/arrows, mouse look, eased acceleration,
 * eye height 1.6 m, collision against the walkable floor area (rooms, doorways, furniture).
 */
export class FirstPersonControls {
  readonly pointer: PointerLockControls;
  private readonly pressed = new Set<string>();
  private readonly velocity = new THREE.Vector2(); // x = right, y = forward (m/s)
  private currentRoom: LoadedRoom;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private readonly rooms: LoadedRoom[],
    private readonly walkable: Walkable,
  ) {
    this.pointer = new PointerLockControls(camera, domElement);
    this.currentRoom = rooms[0];

    window.addEventListener('keydown', (e) => this.pressed.add(e.code));
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

  update(dt: number) {
    const held = (k: keyof typeof KEYS) => KEYS[k].some((c) => this.pressed.has(c));
    const active = this.pointer.isLocked;
    const input = new THREE.Vector2(
      active ? Number(held('right')) - Number(held('left')) : 0,
      active ? Number(held('forward')) - Number(held('back')) : 0,
    );
    if (input.lengthSq() > 1) input.normalize();
    input.multiplyScalar(held('run') ? RUN_SPEED : WALK_SPEED);

    this.velocity.lerp(input, 1 - Math.exp(-ACCEL * dt));
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0);

    const before = this.camera.position.clone();
    this.pointer.moveRight(this.velocity.x * dt);
    this.pointer.moveForward(this.velocity.y * dt);
    this.collide(before);
  }

  /** Rejects moves off the walkable area, sliding along walls where one axis is still free. */
  private collide(before: THREE.Vector3) {
    const p = this.camera.position;
    if (!this.walkable.contains(p.x, p.z)) {
      if (this.walkable.contains(p.x, before.z)) p.z = before.z;
      else if (this.walkable.contains(before.x, p.z)) p.x = before.x;
      else p.set(before.x, p.y, before.z);
    }

    const inside = this.rooms.find(
      (r) => p.x >= r.box.min.x && p.x <= r.box.max.x && p.z >= r.box.min.z && p.z <= r.box.max.z,
    );
    if (inside) this.currentRoom = inside;
    p.y = this.currentRoom.box.min.y + EYE_HEIGHT;
  }
}
