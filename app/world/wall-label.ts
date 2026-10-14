import * as THREE from 'three/webgpu';
import type { Artwork } from './scene-format';

/** Physical label size in metres: width, height, thickness. */
export const LABEL_SIZE = [0.2, 0.125, 0.004] as const;
/** Gap between the frame's right edge and the label. */
export const LABEL_GAP = 0.3;
/** Height of the label's centre above the floor (museum standard is ~1.4 m). */
export const LABEL_HEIGHT = 1.4;

const PX_PER_M = 3200;
const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

/** Display date for labels and plaques. */
export function artworkDate(a: Artwork): string {
  return a.date ?? String(a.year);
}

/**
 * Printed museum wall label beside an artwork. A thin box textured on every face:
 * the front shows the text, and the edges pick up the paper colour.
 */
export function createWallLabel(artwork: Artwork): THREE.Mesh {
  const [w, h, t] = LABEL_SIZE;
  const tex = new THREE.CanvasTexture(drawLabel(artwork, Math.round(w * PX_PER_M), Math.round(h * PX_PER_M)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
  mesh.name = `label:${artwork.id}`;
  return mesh;
}

function drawLabel(a: Artwork, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f5f0';
  ctx.fillRect(0, 0, width, height);

  const pad = width * 0.08;
  const maxW = width - 2 * pad;
  let y = pad;
  const line = (text: string, size: number, style: string, color: string, gap = 0.3) => {
    ctx.font = `${style} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    for (const l of wrap(ctx, text, maxW)) {
      ctx.fillText(l, pad, y);
      y += size * 1.2;
    }
    y += size * gap;
  };

  const [hCm, wCm] = a.dimensionsCm;
  line(a.artist, 36, '600', '#1c1a17', 0.15);
  line(a.title, 34, 'italic', '#1c1a17', 0.15);
  line(artworkDate(a), 28, '', '#4a453e', 0.5);
  line(`${hCm} × ${wCm} cm`, 22, '', '#6d665c', 0.2);
  line(a.license, 18, '', '#8a8378', 0);
  return c;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
