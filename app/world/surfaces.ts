import * as THREE from 'three/webgpu';
import type { FloorStyle } from './scene-format';

/**
 * Procedural stand-in surfaces for placeholder rooms. They give the floors scale and
 * variation until World's baked PBR materials replace them.
 */

/** Size of one floor texture tile in metres (UVs are in metres). */
const TILE_M = 2.4;
const TILE_PX = 1024;

const floorCache = new Map<FloorStyle, THREE.MeshStandardMaterial>();

export function floorMaterial(style: FloorStyle): THREE.MeshStandardMaterial {
  let mat = floorCache.get(style);
  if (mat) return mat;

  const rand = mulberry32(style.length * 7919);
  if (style === 'concrete') {
    mat = new THREE.MeshStandardMaterial({
      map: tileTexture(concreteCanvas(rand, '#b7b3ab'), true),
      roughnessMap: tileTexture(noiseCanvas(rand, 0.86, 0.12), false),
      roughness: 1,
    });
  } else {
    const palette = style === 'oak' ? (['#9a7a58', 0.035] as const) : (['#5a4030', 0.012] as const);
    mat = new THREE.MeshStandardMaterial({
      map: tileTexture(plankCanvas(rand, palette[0], palette[1]), true),
      roughnessMap: tileTexture(noiseCanvas(rand, 0.78, 0.14), false),
      roughness: 1,
    });
  }
  floorCache.set(style, mat);
  return mat;
}

function tileTexture(canvas: HTMLCanvasElement, color: boolean): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / TILE_M, 1 / TILE_M);
  tex.anisotropy = 8;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function canvas2d(size = TILE_PX): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Tileable wood planks, 20 cm wide, with per-plank tone and fine grain. */
function plankCanvas(rand: () => number, base: string, variation: number): HTMLCanvasElement {
  const [c, ctx] = canvas2d();
  const rows = Math.round(TILE_M / 0.2);
  const rowH = TILE_PX / rows;
  const baseColor = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);

  for (let r = 0; r < rows; r++) {
    let x = -rand() * TILE_PX;
    while (x < TILE_PX) {
      const len = (0.9 + rand() * 1.1) * (TILE_PX / TILE_M);
      const tone = new THREE.Color().setHSL(hsl.h + (rand() - 0.5) * 0.015, hsl.s, hsl.l + (rand() - 0.5) * 2 * variation);
      // Draw twice when the plank crosses the tile edge so the texture wraps seamlessly.
      for (const off of [0, TILE_PX]) {
        const px = x + off;
        ctx.fillStyle = `#${tone.getHexString()}`;
        ctx.fillRect(px, r * rowH, len, rowH);
        ctx.globalAlpha = 0.05;
        for (let g = 0; g < 14; g++) {
          ctx.fillStyle = rand() < 0.5 ? '#000' : '#fff';
          const gy = r * rowH + rand() * rowH;
          ctx.fillRect(px, gy, len, 1 + rand());
        }
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#1a120c';
        ctx.fillRect(px, r * rowH, 1.5, rowH); // butt joint
        ctx.globalAlpha = 1;
      }
      x += len;
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#1a120c';
    ctx.fillRect(0, r * rowH, TILE_PX, 1.5); // long seam
    ctx.globalAlpha = 1;
  }
  return c;
}

/** Polished concrete: soft mottling plus a little aggregate speckle. */
function concreteCanvas(rand: () => number, base: string): HTMLCanvasElement {
  const [c, ctx] = canvas2d();
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  for (let i = 0; i < 260; i++) {
    const x = rand() * TILE_PX;
    const y = rand() * TILE_PX;
    const r = 40 + rand() * 160;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    g.addColorStop(0, dark ? 'rgba(60,55,50,0.035)' : 'rgba(255,255,250,0.035)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const ox of [-TILE_PX, 0, TILE_PX]) for (const oy of [-TILE_PX, 0, TILE_PX]) ctx.fillRect(x - r + ox, y - r + oy, 2 * r, 2 * r);
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(40,38,35,0.25)' : 'rgba(255,255,255,0.2)';
    ctx.fillRect(rand() * TILE_PX, rand() * TILE_PX, 1.2, 1.2);
  }
  return c;
}

/** Grey noise for roughness: `base` ± `spread`/2. */
function noiseCanvas(rand: () => number, base: number, spread: number): HTMLCanvasElement {
  const size = 256;
  const [c, ctx] = canvas2d(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(255 * Math.min(1, Math.max(0, base + (rand() - 0.5) * spread)));
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let softShadow: THREE.Texture | undefined;

/**
 * A blurred dark rectangle used as a contact-shadow decal behind frames and under benches.
 * Much cheaper than real-time shadow maps for every gallery spotlight.
 */
export function softShadowTexture(): THREE.Texture {
  if (softShadow) return softShadow;
  const size = 256;
  const [c, ctx] = canvas2d(size);
  const pad = size * 0.2;
  // White-on-black because alphaMap reads the green channel. Draw the rectangle
  // off-canvas and keep only its blurred shadow.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetX = size * 2;
  ctx.fillRect(pad - size * 2, pad, size - 2 * pad, size - 2 * pad);
  softShadow = new THREE.CanvasTexture(c);
  return softShadow;
}

/** Plane mesh showing the soft shadow, facing +z, whose dark core is `width` × `height`. */
export function shadowDecal(width: number, height: number, opacity: number): THREE.Mesh {
  // The texture's dark core covers the middle 60%; scale the plane so the core matches the object.
  const geo = new THREE.PlaneGeometry(width / 0.6, height / 0.6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: softShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/** Small deterministic PRNG so procedural textures look the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
