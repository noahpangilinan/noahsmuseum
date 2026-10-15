import './style.css';
import * as THREE from 'three/webgpu';
import { createEngine } from './engine/renderer';
import { loadMuseum, type Artwork } from './world/scene-format';
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
import { MuseumMap } from './ui/map';
import { PhotoViewer } from './ui/photo-viewer';

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
    // Map clicks snap to the nearest spot you could actually stand (not inside a wall or a bench).
    const standable = (x: number, z: number) => {
      if (walkable.contains(x, z)) return { x, z };
      for (let r = 0.15; r <= 1.5; r += 0.15) {
        for (let a = 0; a < 16; a++) {
          const sx = x + r * Math.cos((a / 16) * Math.PI * 2);
          const sz = z + r * Math.sin((a / 16) * Math.PI * 2);
          if (walkable.contains(sx, sz)) return { x: sx, z: sz };
        }
      }
      return null;
    };
    const map = new MuseumMap(museum, doorways, standable);
    const photo = new PhotoViewer();

    // A painting you're close to and looking at can be opened full-screen.
    const viewRay = new THREE.Raycaster();
    viewRay.far = 8;
    const paintings = exhibits.filter((e) => 'slot' in e.info);
    const paintingInView = () => {
      viewRay.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hit = viewRay.intersectObjects(paintings.map((e) => e.target), false)[0];
      const e = hit && paintings.find((p) => p.target === hit.object);
      if (!e) return null;
      const reach = Math.max(2.2, (0.9 * Math.max(...e.info.dimensionsCm)) / 100);
      return hit.distance <= reach ? e : null;
    };
    const photoPath = (e: (typeof exhibits)[number]) => {
      const info = e.info as Artwork; // only paintings reach here
      return info.imageFull ?? (info.image.endsWith('.ktx2') ? null : info.image);
    };
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

    // Opening the map frees the mouse so you can click it; closing it (or teleporting) captures
    // it again. While it's open, losing pointer lock is expected, so no start screen.
    map.onOpenChange = (open, resume) => {
      if (open) {
        controls.pointer.unlock();
        hint.set(null);
      } else if (resume) {
        controls.lock();
      } else {
        start.setVisible(true);
      }
    };
    map.onPick = (x, z) => {
      controls.teleport(x, z);
      map.setOpen(false);
    };

    controls.pointer.addEventListener('lock', () => {
      start.setVisible(false);
      document.body.classList.add('locked');
    });
    controls.pointer.addEventListener('unlock', () => {
      controls.unmagnify();
      loupe.setVisible(false);
      photo.close();
      controls.frozen = false;
      if (!map.isOpen) start.setVisible(true);
      document.body.classList.remove('locked');
    });
    renderer.domElement.addEventListener('click', () => {
      if (!controls.isLocked) return;
      if (photo.isOpen) {
        photo.close();
        controls.frozen = false;
        return;
      }
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
      } else {
        const close = paintingInView();
        const path = close && photoPath(close);
        if (close && path) {
          photo.show(close.info, path);
          controls.frozen = true;
        } else plaque.pick();
      }
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
      map.update(camera, controls.room.room.id);
      if (!controls.isLocked) hint.set(null);
      else if (controls.isMagnified) hint.set('Click to step back', true);
      else if (controls.isSeated) hint.set('Click to stand');
      else if (controls.benchInView()) hint.set('Click to sit');
      else if (photo.isOpen) hint.set(null);
      else if (magnifierInView()) hint.set('Click to magnify');
      else if (paintingInView()) hint.set('Click to view');
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
