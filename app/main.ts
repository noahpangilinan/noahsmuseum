import './style.css';
import * as THREE from 'three/webgpu';
import { createEngine } from './engine/renderer';
import { loadMuseum } from './world/scene-format';
import { computeVisibility, findDoorways, Walkable } from './world/layout';
import { loadRoom, type LoadedRoom } from './world/rooms';
import { placeArtworks } from './world/artworks';
import { placeSculptures } from './world/sculptures';
import { RoomStreamer } from './world/streaming';
import { BODY_RADIUS, FirstPersonControls } from './controls/first-person';
import { Plaque } from './ui/plaque';
import { DebugOverlay } from './ui/debug-overlay';
import { StartScreen } from './ui/start-screen';
import { Hint } from './ui/hint';
import { Loupe } from './ui/loupe';

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
    const hint = new Hint();
    const loupe = new Loupe();
    const magnifiable = exhibits.filter((e) => e.magnify);
    const magnifierInView = () => {
      const hit = controls.pickInReach(magnifiable.map((e) => e.target));
      return hit ? magnifiable.find((e) => e.target === hit)! : null;
    };
    // Rooms you can't see aren't drawn, and their textures and models are released.
    // Lights stay on: hiding one would change every shader's light set and force a recompile.
    const roomObjects = new Map([...rooms].map(([id, r]) => [id, r.object.children.filter((o) => !(o as THREE.Light).isLight)]));
    for (const e of exhibits) roomObjects.get(e.room)!.push(e.group);
    const streamer = new RoomStreamer(museum, exhibits, computeVisibility(museum, doorways), roomObjects);
    streamer.update(controls.room.room.id);
    const debug = new DebugOverlay(renderer, backend, () => streamer.drawnRooms(), () => streamer.loadedRooms(), () => {
      const p = camera.position;
      return `${controls.room.room.id} @ ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}`;
    });

    start.setStatus('Preparing shaders…');
    // Compile shaders before the first visible frame to avoid a hitch on entry.
    await renderer.compileAsync(scene, camera);

    controls.pointer.addEventListener('lock', () => {
      start.setVisible(false);
      document.body.classList.add('locked');
    });
    controls.pointer.addEventListener('unlock', () => {
      controls.unmagnify();
      loupe.setVisible(false);
      start.setVisible(true);
      document.body.classList.remove('locked');
    });
    renderer.domElement.addEventListener('click', () => {
      if (!controls.isLocked) return;
      if (controls.isMagnified) {
        controls.unmagnify();
        loupe.setVisible(false);
        return;
      }
      if (controls.isSeated) {
        controls.stand();
        return;
      }
      const bench = controls.benchInView();
      const lens = magnifierInView();
      if (bench) controls.sit(bench);
      else if (lens) {
        controls.magnify(lens.center, lens.magnify!.size);
        loupe.setVisible(true);
      } else plaque.pick();
    });
    start.ready(() => controls.lock());

    // Full-resolution images and label text load only for pieces you're close to. Checked a
    // few times a second, with a 1.5 m buffer so nothing flickers between tiers at the boundary.
    const near = new Set<(typeof exhibits)[number]>();
    let nearClock = 0;
    const updateNear = (dt: number) => {
      nearClock += dt;
      if (nearClock < 0.2) return;
      nearClock = 0;
      for (const e of exhibits) {
        const d = e.center.distanceTo(camera.position);
        if (d < e.nearDistance && !near.has(e)) {
          near.add(e);
          e.setNear(true);
        } else if (d > e.nearDistance + 1.5 && near.has(e)) {
          near.delete(e);
          e.setNear(false);
        }
      }
    };

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      const dt = Math.min(timer.getDelta(), 0.1); // avoid big jumps after tab switches
      controls.update(dt);
      streamer.update(controls.room.room.id);
      updateNear(dt);
      plaque.update();
      if (!controls.isLocked) hint.set(null);
      else if (controls.isMagnified) hint.set('Click to step back', true);
      else if (controls.isSeated) hint.set('Click to stand');
      else if (controls.benchInView()) hint.set('Click to sit');
      else if (magnifierInView()) hint.set('Click to magnify');
      else hint.set(null);
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
