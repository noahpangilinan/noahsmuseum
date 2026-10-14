import './style.css';
import * as THREE from 'three/webgpu';
import { createEngine } from './engine/renderer';
import { loadMuseum } from './world/scene-format';
import { loadRoom, type LoadedRoom } from './world/rooms';
import { placeArtworks } from './world/artworks';
import { FirstPersonControls } from './controls/first-person';
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

    // M1: every room loads up front. Streaming by `connections` comes in M3.
    start.setStatus('Building the galleries…');
    const rooms = new Map<string, LoadedRoom>();
    for (const loaded of await Promise.all(museum.rooms.map((r) => loadRoom(r, renderer)))) {
      rooms.set(loaded.room.id, loaded);
      scene.add(loaded.object);
    }

    const artworks = placeArtworks(museum, rooms, scene, renderer);
    const controls = new FirstPersonControls(camera, renderer.domElement, [...rooms.values()]);
    controls.spawn(rooms.values().next().value!);
    const plaque = new Plaque(camera, artworks);
    const debug = new DebugOverlay(renderer, backend, () => [...rooms.keys()]);

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

main();
