import './style.css';
import * as THREE from 'three/webgpu';
import { createEngine } from './engine/renderer';
import { loadMuseum } from './world/scene-format';
import { findDoorways, Walkable } from './world/layout';
import { loadRoom, type LoadedRoom } from './world/rooms';
import { placeArtworks } from './world/artworks';
import { placeSculptures } from './world/sculptures';
import { BODY_RADIUS, FirstPersonControls } from './controls/first-person';
import { Plaque } from './ui/plaque';
import { DebugOverlay } from './ui/debug-overlay';
import { StartScreen } from './ui/start-screen';

async function main() {
  const start = new StartScreen();
  try {
    start.setStatus('Starting renderer…');
    const { renderer, scene, camera, backend } = await createEngine(document.getElementById('app')!);

    start.setStatus('Reading the catalogue…');
    const museum = await loadMuseum();
    const doorways = findDoorways(museum);

    // Every room loads up front for now. Streaming by `connections` comes in M3.
    start.setStatus('Building the galleries…');
    const rooms = new Map<string, LoadedRoom>();
    for (const loaded of await Promise.all(museum.rooms.map((r) => loadRoom(r, doorways, renderer)))) {
      rooms.set(loaded.room.id, loaded);
      scene.add(loaded.object);
    }

    const exhibits = [
      ...placeArtworks(museum, rooms, scene, renderer),
      ...placeSculptures(museum, rooms, scene, renderer),
    ];
    const walkable = new Walkable(museum, doorways, BODY_RADIUS);
    const controls = new FirstPersonControls(camera, renderer.domElement, [...rooms.values()], walkable);
    controls.spawn(rooms.values().next().value!);
    debugTeleport(camera);
    const plaque = new Plaque(camera, exhibits);
    const debug = new DebugOverlay(renderer, backend, () => [...rooms.keys()], () => controls.room.room.id);

    start.setStatus('Preparing shaders…');
    // Compile shaders before the first visible frame to avoid a hitch on entry.
    await renderer.compileAsync(scene, camera);

    controls.pointer.addEventListener('lock', () => {
      start.setVisible(false);
      document.body.classList.add('locked');
    });
    controls.pointer.addEventListener('unlock', () => {
      start.setVisible(true);
      document.body.classList.remove('locked');
    });
    renderer.domElement.addEventListener('click', () => {
      if (controls.isLocked) plaque.pick();
    });
    start.ready(() => controls.lock());

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      const dt = Math.min(timer.getDelta(), 0.1); // avoid big jumps after tab switches
      controls.update(dt);
      plaque.update();
      renderer.render(scene, camera);
      debug.update(dt);
    });
  } catch (err) {
    console.error(err);
    start.error(err);
  }
}

/** Debug: `?at=x,z&look=x,z` starts the camera somewhere else (handy for screenshots and testing rooms). */
function debugTeleport(camera: THREE.PerspectiveCamera) {
  const params = new URLSearchParams(location.search);
  const at = params.get('at')?.split(',').map(Number);
  if (!at || at.length !== 2 || at.some(Number.isNaN)) return;
  camera.position.set(at[0], camera.position.y, at[1]);
  const look = params.get('look')?.split(',').map(Number);
  if (look?.length === 2) camera.lookAt(look[0], camera.position.y, look[1]);
}

main();
