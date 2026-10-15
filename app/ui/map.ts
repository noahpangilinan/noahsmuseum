import * as THREE from 'three/webgpu';
import type { Museum } from '../world/scene-format';
import { wallSegments, type Doorway, type Segment } from '../world/layout';

const PAD = 28; // canvas px around the plan

/**
 * Floor plan overlay, toggled with M. Drawn from the scene file: rooms, walls with their
 * doorway gaps, a dot per painting, a square per free-standing piece, and an arrow for the
 * visitor. North (−z) is up. Click a spot to teleport there.
 */
export class MuseumMap {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly walls: Segment[];
  private readonly bounds = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  private readonly dir = new THREE.Vector3();
  private open = false;
  /** Canvas px → world, from the last draw. */
  private toWorld: ((cx: number, cy: number) => { x: number; z: number }) | null = null;
  private hover: { x: number; z: number } | null = null;
  /**
   * Called when the map opens or closes. The app frees the mouse while it's open, and captures
   * it again on close unless `resume` is false (closed with Esc).
   */
  onOpenChange?: (open: boolean, resume: boolean) => void;
  /** Called with a floor position when the visitor clicks the map. */
  onPick?: (x: number, z: number) => void;

  constructor(
    private readonly museum: Museum,
    doorways: Doorway[],
    /** Snaps a floor position to somewhere the visitor can stand, or null if nowhere near. */
    private readonly standable: (x: number, z: number) => { x: number; z: number } | null,
  ) {
    this.walls = wallSegments(museum, doorways);
    for (const r of museum.rooms) {
      this.bounds.x0 = Math.min(this.bounds.x0, r.bounds.min[0]);
      this.bounds.z0 = Math.min(this.bounds.z0, r.bounds.min[2]);
      this.bounds.x1 = Math.max(this.bounds.x1, r.bounds.max[0]);
      this.bounds.z1 = Math.max(this.bounds.z1, r.bounds.max[2]);
    }

    this.el = document.createElement('div');
    this.el.className = 'museum-map';
    this.el.innerHTML = `<div class="museum-map-card"><canvas></canvas><div class="museum-map-key">Click a spot to go there · M to close</div></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.setOpen(!this.open);
      else if (e.code === 'Escape' && this.open) this.setOpen(false, false);
    });
    const worldAt = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const p = this.toWorld?.(e.clientX - rect.left, e.clientY - rect.top);
      return p ? this.standable(p.x, p.z) : null;
    };
    this.canvas.addEventListener('mousemove', (e) => {
      this.hover = worldAt(e);
      this.canvas.style.cursor = this.hover ? 'pointer' : 'not-allowed';
    });
    this.canvas.addEventListener('mouseleave', () => (this.hover = null));
    this.canvas.addEventListener('click', (e) => {
      const p = worldAt(e);
      if (p) this.onPick?.(p.x, p.z);
    });
  }

  get isOpen() {
    return this.open;
  }

  setOpen(open: boolean, resume = true) {
    if (open === this.open) return;
    this.open = open;
    this.hover = null;
    this.el.classList.toggle('visible', open);
    this.onOpenChange?.(open, resume);
  }

  /** Redraws while open (cheap: a few dozen shapes). */
  update(camera: THREE.Camera, currentRoom: string) {
    if (!this.open) return;
    const { canvas, ctx, bounds } = this;

    // Fit the plan into the card at the screen's pixel density.
    const cssW = Math.min(window.innerWidth - 32, 720);
    const planW = bounds.x1 - bounds.x0;
    const planH = bounds.z1 - bounds.z0;
    const scale = Math.min((cssW - 2 * PAD) / planW, (window.innerHeight * 0.75 - 2 * PAD) / planH);
    const cssH = planH * scale + 2 * PAD;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const offX = (cssW - planW * scale) / 2;
    const px = (x: number) => offX + (x - bounds.x0) * scale;
    const pz = (z: number) => PAD + (z - bounds.z0) * scale;
    this.toWorld = (cx, cy) => ({ x: bounds.x0 + (cx - offX) / scale, z: bounds.z0 + (cy - PAD) / scale });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Floors, the visitor's room highlighted.
    for (const r of this.museum.rooms) {
      const [x0, , z0] = r.bounds.min;
      const [x1, , z1] = r.bounds.max;
      ctx.fillStyle = r.id === currentRoom ? '#e9dcc0' : '#d9d2c4';
      ctx.fillRect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
    }

    // Walls, with doorway gaps.
    ctx.strokeStyle = '#2b2722';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (const [ax, az, bx, bz] of this.walls) {
      ctx.moveTo(px(ax), pz(az));
      ctx.lineTo(px(bx), pz(bz));
    }
    ctx.stroke();

    // Paintings on the walls, free-standing pieces on the floor.
    ctx.fillStyle = '#8a5a2b';
    for (const r of this.museum.rooms) {
      for (const s of r.slots) {
        if (!this.museum.artworks.some((a) => a.slot === `${r.id}/${s.id}`)) continue;
        const [x, , z] = s.position;
        const [nx, , nz] = s.normal;
        ctx.beginPath();
        ctx.arc(px(x + nx * 0.25), pz(z + nz * 0.25), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#5c544a';
    for (const sc of this.museum.sculptures ?? []) {
      const [x, , z] = sc.position;
      ctx.fillRect(px(x) - 3.5, pz(z) - 3.5, 7, 7);
    }

    // Room names.
    ctx.fillStyle = '#3d372f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`;
    for (const r of this.museum.rooms) {
      if (!r.name) continue;
      const cx = (r.bounds.min[0] + r.bounds.max[0]) / 2;
      // Rooms with free-standing pieces keep their centre clear: name goes near the north wall.
      const hasPieces = (this.museum.sculptures ?? []).some((sc) => sc.room === r.id);
      const cz = hasPieces ? r.bounds.min[2] + 1.8 : (r.bounds.min[2] + r.bounds.max[2]) / 2;
      // Wrap onto two lines when the name doesn't fit comfortably inside the room.
      const room = (r.bounds.max[0] - r.bounds.min[0]) * scale * 0.8;
      const words = r.name.split(' ');
      const lines = ctx.measureText(r.name).width > room && words.length > 1
        ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
        : [r.name];
      lines.forEach((line, i) => ctx.fillText(line, px(cx), pz(cz) + (i - (lines.length - 1) / 2) * 14));
    }

    // Where a click would take you.
    if (this.hover) {
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(px(this.hover.x), pz(this.hover.z), 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // You are here: an arrow pointing where the camera looks.
    camera.getWorldDirection(this.dir);
    const angle = Math.atan2(this.dir.x, this.dir.z); // 0 = facing +z (down on the map)
    ctx.save();
    ctx.translate(px(camera.position.x), pz(camera.position.z));
    ctx.rotate(-angle);
    ctx.fillStyle = '#c0392b';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(6, -6);
    ctx.lineTo(0, -3);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
