import * as THREE from 'three/webgpu';
import type { Museum, Sculpture } from './scene-format';
import { contentUrl } from './scene-format';
import { displaySize } from './layout';
import { createGLTFLoader, type LoadedRoom } from './rooms';
import { loadTexture, type PlacedExhibit } from './artworks';
import { shadowDecal } from './surfaces';
import { createWallLabel, labelTexture, LABEL_SIZE } from './wall-label';
import { disposeObject, StreamedMap } from './streaming';

const plinthMat = new THREE.MeshStandardMaterial({ color: 0xebe8e1, roughness: 0.8 });
const platformMat = new THREE.MeshStandardMaterial({ color: 0x35312d, roughness: 0.7 });
const capMat = new THREE.MeshStandardMaterial({ color: 0xcfcbc3, metalness: 0.3, roughness: 0.4 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 0.4, roughness: 0.35 });
const lensMat = new THREE.MeshStandardMaterial({
  color: 0xdfe9ef,
  transparent: true,
  opacity: 0.22,
  roughness: 0.05,
  depthWrite: false,
});
/** Pieces smaller than this (largest dimension, metres) get a higher case and a magnifier. */
const SMALL = 0.15;
// Plain transparency rather than physical transmission: a fraction of the cost per pixel.
const glassMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.1,
  roughness: 0.05,
  depthWrite: false,
});

/**
 * Free-standing pieces on plinths, in glass cases, or on platforms.
 * No lights of their own: they're lit by the room. Models stream in and out with the
 * room; a photo card stands in when there's no model or it fails to load.
 */
export function placeSculptures(
  museum: Museum,
  rooms: Map<string, LoadedRoom>,
  scene: THREE.Scene,
  renderer: THREE.WebGPURenderer,
): PlacedExhibit[] {
  const placed: PlacedExhibit[] = [];
  for (const sc of museum.sculptures ?? []) {
    const loaded = rooms.get(sc.room);
    if (!loaded) continue;

    const [h, w, d] = sc.dimensionsCm.map((cm) => cm / 100);
    const size = displaySize(sc);
    const group = new THREE.Group();
    group.name = `sculpture:${sc.id}`;
    group.position.set(...sc.position);
    group.rotation.y = THREE.MathUtils.degToRad(sc.rotationY ?? 0);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(size.width, size.height, size.depth),
      sc.display === 'platform' ? platformMat : plinthMat,
    );
    base.position.y = size.height / 2;
    group.add(base);

    const floorShadow = shadowDecal(size.width, size.depth, 0.5);
    floorShadow.rotation.x = -Math.PI / 2;
    floorShadow.position.y = 0.002;
    group.add(floorShadow);

    const small = Math.max(h, w, d) < SMALL;
    let target = base;
    // Space the stand-in photo may fill: [max width, max height].
    let photoBox: [number, number] = [Math.max(w, d), h];
    if (sc.display === 'case') {
      const gh = Math.max(small ? 0.28 : 0.45, h + 0.2);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(size.width - 0.02, gh, size.depth - 0.02), glassMat);
      glass.position.y = size.height + gh / 2;
      glass.renderOrder = 2;
      group.add(glass);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(size.width - 0.01, 0.012, size.depth - 0.01), capMat);
      cap.position.y = size.height + gh + 0.006;
      group.add(cap);
      target = glass;
      photoBox = [Math.max(w, d), gh - 0.08];
    }
    target.userData.exhibitId = sc.id;
    if (small) group.add(magnifierProp(size.height, size.depth));

    const label = createWallLabel(sc);
    const text = new StreamedMap(label.material as THREE.MeshStandardMaterial, async () => labelTexture(sc), {
      loaded: 0xffffff,
      unloaded: 0xf7f5f0,
    });
    label.position.set(0, sc.display === 'platform' ? size.height / 2 : size.height - LABEL_SIZE[1], size.depth / 2 + LABEL_SIZE[2] / 2);
    group.add(label);

    const stand = new THREE.Group();
    stand.position.y = size.height;
    group.add(stand);

    // Exactly one of these is shown: the model, or the photo card as a fallback.
    let model: THREE.Object3D | null = null;
    let card: { mesh: THREE.Mesh; map: StreamedMap } | null = null;
    let wanted = false;
    let loadingModel = false;
    const showCard = () => {
      if (!sc.image) return;
      card ??= photoCard(sc, photoBox, renderer);
      stand.add(card.mesh);
      card.map.load();
    };

    scene.add(group);
    group.updateMatrixWorld(true);
    const center = group.localToWorld(new THREE.Vector3(0, size.height + h / 2, 0));
    placed.push({
      info: sc,
      target,
      center,
      group,
      magnify: small ? { size: Math.max(h, w, d) } : undefined,
      room: sc.room,
      load: () => {
        wanted = true;
        text.load();
        if (!sc.model) return showCard();
        if (model || loadingModel) return;
        loadingModel = true;
        loadModel(sc, h, renderer).then((m) => {
          loadingModel = false;
          if (!m) return showCard();
          if (!wanted) return disposeObject(m); // walked away mid-download
          model = m;
          stand.add(m);
        });
      },
      unload: () => {
        wanted = false;
        text.unload();
        if (model) {
          stand.remove(model);
          disposeObject(model);
          model = null;
        }
        if (card) {
          stand.remove(card.mesh);
          card.map.unload();
        }
      },
    });
  }
  return placed;
}

/** A mounted magnifying glass on the front of a small-object case: the cue that you can look closer. */
function magnifierProp(plinthHeight: number, plinthDepth: number): THREE.Group {
  const r = 0.065;
  const prop = new THREE.Group();
  prop.position.set(0, plinthHeight + 0.13, plinthDepth / 2 + 0.05);
  prop.rotation.x = -0.55; // tilted up towards a standing visitor

  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 40), brassMat);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(r, 32), lensMat);
  lens.renderOrder = 3;
  // Arm down to the plinth's front edge.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), brassMat);
  arm.position.set(0, -r - 0.06, -0.03);
  arm.rotation.x = 0.55;
  prop.add(ring, lens, arm);
  return prop;
}

/** Loads the glTF and scales it so its height matches the catalogue height, standing on the origin. */
async function loadModel(sc: Sculpture, height: number, renderer: THREE.WebGPURenderer): Promise<THREE.Object3D | null> {
  try {
    const gltf = await createGLTFLoader(renderer).loadAsync(contentUrl(sc.model!));
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const s = height / Math.max(1e-6, box.max.y - box.min.y);
    model.scale.setScalar(s);
    box.setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
    const holder = new THREE.Group();
    holder.add(model);
    return holder;
  } catch (err) {
    console.error(`[museum] failed to load model for ${sc.id}`, err);
    return null;
  }
}

/** The object's photo printed on a card, leaning back slightly, sized to fit its display. */
function photoCard(
  sc: Sculpture,
  [maxW, maxH]: [number, number],
  renderer: THREE.WebGPURenderer,
): { mesh: THREE.Mesh; map: StreamedMap } {
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, side: THREE.DoubleSide });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  card.rotation.x = -0.1;
  const fit = (aspect: number) => {
    const width = Math.min(maxW, maxH * aspect);
    const height = width / aspect;
    card.scale.set(width, height, 1);
    card.position.set(0, height / 2 + 0.01, 0);
  };
  fit(1);
  const map = new StreamedMap(
    mat,
    async () => {
      const tex = await loadTexture(sc.image!, renderer);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.getMaxAnisotropy();
      return tex;
    },
    { loaded: 0xffffff, unloaded: 0x888888 },
    (tex) => {
      const img = tex.image as { width: number; height: number };
      fit(img.width / img.height);
    },
  );
  return { mesh: card, map };
}
