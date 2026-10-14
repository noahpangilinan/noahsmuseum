import * as THREE from 'three/webgpu';
import type { PlacedExhibit } from '../world/artworks';
import { artworkDate, formatDimensions } from '../world/wall-label';

const NEAR_DISTANCE = 2.2; // m — plaque appears when standing this close (further for big pieces)…
const FACING_DOT = 0.6; // …and roughly looking at the piece
const CLICK_RANGE = 12; // m — click works from across the room

/**
 * Museum wall label. Shows automatically when the visitor stands in front of an
 * artwork, or on click (centre-screen raycast) from further away.
 */
export class Plaque {
  private readonly el: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly byId: Map<string, PlacedExhibit>;
  private shown: PlacedExhibit | null = null;
  /** Artwork chosen by click; stays until the visitor walks/looks away. */
  private pinned: PlacedExhibit | null = null;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly exhibits: PlacedExhibit[],
  ) {
    this.byId = new Map(exhibits.map((a) => [a.info.id, a]));
    this.raycaster.far = CLICK_RANGE;
    this.el = document.createElement('aside');
    this.el.className = 'plaque';
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
  }

  /** Call on click while pointer-locked. */
  pick() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = this.raycaster.intersectObjects(this.exhibits.map((a) => a.target), false)[0];
    this.pinned = hit ? (this.byId.get(hit.object.userData.exhibitId) ?? null) : null;
  }

  update() {
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const toArt = new THREE.Vector3();

    const isFacing = (a: PlacedExhibit) => toArt.subVectors(a.center, camPos).normalize().dot(camDir) > FACING_DOT;

    let nearest: PlacedExhibit | null = null;
    let best = Infinity;
    for (const a of this.exhibits) {
      const d = a.center.distanceTo(camPos);
      if (d < nearDistance(a) && d < best && isFacing(a)) {
        best = d;
        nearest = a;
      }
    }

    if (this.pinned && !isFacing(this.pinned)) this.pinned = null;
    this.show(nearest ?? this.pinned);
  }

  private show(a: PlacedExhibit | null) {
    if (a === this.shown) return;
    this.shown = a;
    if (!a) {
      this.el.classList.remove('visible');
      return;
    }
    const { title, artist, dimensionsCm, source, license } = a.info;
    this.el.innerHTML = '';
    const add = (tag: string, cls: string, text: string) => {
      const n = document.createElement(tag);
      n.className = cls;
      n.textContent = text;
      this.el.appendChild(n);
      return n;
    };
    add('div', 'plaque-artist', artist);
    add('div', 'plaque-title', `${title}, ${artworkDate(a.info)}`);
    add('div', 'plaque-meta', formatDimensions(dimensionsCm));
    const link = add('a', 'plaque-source', `Source · ${license}`) as HTMLAnchorElement;
    link.href = source;
    link.target = '_blank';
    link.rel = 'noopener';
    this.el.classList.add('visible');
  }
}

/** Big paintings are viewed from further back, so the plaque triggers further away too. */
function nearDistance(a: PlacedExhibit): number {
  return Math.max(NEAR_DISTANCE, 1.2 * Math.max(...a.info.dimensionsCm) / 100);
}
