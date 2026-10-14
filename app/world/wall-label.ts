import * as THREE from 'three/webgpu';
import type { ExhibitInfo } from './scene-format';

/** Physical label size in metres: width, height, thickness. */
export const LABEL_SIZE = [0.2, 0.125, 0.004] as const;
/** Gap between the frame's right edge and the label. */
export const LABEL_GAP = 0.3;
/** Height of the label's centre above the floor (museum standard is ~1.4 m). */
export const LABEL_HEIGHT = 1.4;

const PX_PER_M = 3200;
const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

/** Display date for labels and plaques. */
export function artworkDate(a: ExhibitInfo): string {
  return a.date ?? String(a.year);
}

/** "212.2 × 276.2 cm" (h × w) or "270 × 100 × 280 cm" (h × w × d). */
export function formatDimensions(cm: number[]): string {
  return `${cm.join(' × ')} cm`;
}

const PAPER = 0xf7f5f0;

/**
 * Printed museum wall label beside an artwork: a thin paper-coloured box. The printed
 * text is a texture that streams in and out with the room (see `labelTexture`).
 */
export function createWallLabel(artwork: ExhibitInfo): THREE.Mesh {
  const [w, h, t] = LABEL_SIZE;
  const mat = new THREE.MeshStandardMaterial({ map: placeholderTexture(), color: PAPER, roughness: 0.85 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
  mesh.name = `label:${artwork.id}`;
  return mesh;
}

/** Prints the label text. Box UVs put it on the front face; the edges pick up the paper colour. */
export function labelTexture(artwork: ExhibitInfo): THREE.Texture {
  const [w, h] = LABEL_SIZE;
  const tex = new THREE.CanvasTexture(drawLabel(artwork, Math.round(w * PX_PER_M), Math.round(h * PX_PER_M)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let placeholder: THREE.Texture | undefined;

/**
 * A 1×1 white sRGB texture used wherever a real texture isn't loaded. Swapping one sRGB
 * map for another keeps the same shader, so streaming never triggers a recompile.
 */
export function placeholderTexture(): THREE.Texture {
  if (!placeholder) {
    placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    placeholder.colorSpace = THREE.SRGBColorSpace;
    placeholder.needsUpdate = true;
  }
  return placeholder;
}

function drawLabel(a: ExhibitInfo, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const pad = width * 0.08;
  const maxW = width - 2 * pad;

  // Long titles shrink the type until everything fits on the card.
  for (let scale = 1; scale > 0.4; scale *= 0.88) {
    ctx.fillStyle = '#f7f5f0';
    ctx.fillRect(0, 0, width, height);
    let y = pad;
    const line = (text: string, size: number, style: string, color: string, gap: number) => {
      const px = size * scale;
      ctx.font = `${style} ${px}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      for (const l of wrap(ctx, text, maxW)) {
        ctx.fillText(l, pad, y);
        y += px * 1.2;
      }
      y += px * gap;
    };
    line(a.artist, 36, '600', '#1c1a17', 0.15);
    line(a.title, 34, 'italic', '#1c1a17', 0.15);
    line(artworkDate(a), 28, '', '#4a453e', 0.5);
    line(formatDimensions(a.dimensionsCm), 22, '', '#6d665c', 0.2);
    line(a.license, 18, '', '#8a8378', 0);
    if (y <= height - pad * 0.5) break;
  }
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
