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
      vertexColors: true, // baked ambient occlusion from the room builder
    });
  } else if (style === 'stone') {
    mat = new THREE.MeshStandardMaterial({
      map: tileTexture(stoneCanvas(rand, '#9d968a'), true),
      roughnessMap: tileTexture(noiseCanvas(rand, 0.88, 0.1), false),
      roughness: 1,
      vertexColors: true, // baked ambient occlusion from the room builder
    });
  } else {
    const palette = style === 'oak' ? (['#9a7a58', 0.035] as const) : (['#5a4030', 0.012] as const);
    mat = new THREE.MeshStandardMaterial({
      map: tileTexture(plankCanvas(rand, palette[0], palette[1]), true),
      roughnessMap: tileTexture(noiseCanvas(rand, 0.78, 0.14), false),
      roughness: 1,
      vertexColors: true, // baked ambient occlusion from the room builder
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
    wrappedBlotch(ctx, TILE_PX, x, y, r, rand() < 0.5 ? 'rgba(60,55,50,0.035)' : 'rgba(255,255,250,0.035)');
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(40,38,35,0.25)' : 'rgba(255,255,255,0.2)';
    ctx.fillRect(rand() * TILE_PX, rand() * TILE_PX, 1.2, 1.2);
  }
  return c;
}

/** Limestone slabs, 60 × 120 cm in a running bond, each with its own tone and fine speckle. */
function stoneCanvas(rand: () => number, base: string): HTMLCanvasElement {
  const [c, ctx] = canvas2d();
  const px = TILE_PX / TILE_M;
  const slabW = 1.2 * px;
  const slabH = 0.6 * px;
  const rows = Math.round(TILE_PX / slabH);
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(base).getHSL(hsl);
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? slabW / 2 : 0;
    for (let x = -offset; x < TILE_PX; x += slabW) {
      const tone = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l + (rand() - 0.5) * 0.05);
      ctx.fillStyle = `#${tone.getHexString()}`;
      ctx.fillRect(x, r * slabH, slabW, slabH);
      if (x + slabW > TILE_PX) ctx.fillRect(x - TILE_PX, r * slabH, slabW, slabH); // wrap
    }
  }
  for (let i = 0; i < 12000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(60,55,48,0.18)' : 'rgba(255,252,245,0.15)';
    ctx.fillRect(rand() * TILE_PX, rand() * TILE_PX, 1.3, 1.3);
  }
  // Grout joints.
  ctx.fillStyle = 'rgba(70,64,56,0.55)';
  for (let r = 0; r < rows; r++) {
    ctx.fillRect(0, r * slabH, TILE_PX, 2);
    const offset = r % 2 ? slabW / 2 : 0;
    for (let x = -offset; x < TILE_PX; x += slabW) {
      for (const xx of [x, x + TILE_PX]) ctx.fillRect(xx, r * slabH, 2, slabH);
    }
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

/**
 * Draws a soft radial blotch that wraps across the tile's edges. Each wrapped copy needs its
 * own gradient centred on it; reusing one gradient clips the copies into visible squares.
 */
function wrappedBlotch(ctx: CanvasRenderingContext2D, size: number, x: number, y: number, r: number, color: string) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const cx = x + ox;
      const cy = y + oy;
      if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
  }
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

/**
 * Positions along an edge of `length` metres, dense near both ends (where occlusion changes
 * fast) and every ~0.6 m in between.
 */
function stops(length: number): number[] {
  const edge = [0, 0.05, 0.12, 0.22, 0.36, 0.55, 0.8].filter((s) => s < length / 2);
  const out = [...edge];
  const start = edge[edge.length - 1];
  const end = length - start;
  const n = Math.max(0, Math.ceil((end - start) / 0.6));
  for (let i = 1; i < n; i++) out.push(start + ((end - start) * i) / n);
  for (const s of [...edge].reverse()) out.push(length - s);
  return [...new Set(out.map((v) => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
}

/**
 * A flat rectangle facing +z, centred on the origin, subdivided by `stops` so per-vertex
 * ambient occlusion can fall off smoothly into its edges. UVs run 0..1 like PlaneGeometry.
 */
export function aoPlane(width: number, height: number): THREE.BufferGeometry {
  const xs = stops(width);
  const ys = stops(height);
  const pos: number[] = [];
  const uv: number[] = [];
  for (const y of ys) {
    for (const x of xs) {
      pos.push(x - width / 2, y - height / 2, 0);
      uv.push(x / width, y / height);
    }
  }
  const index: number[] = [];
  const row = xs.length;
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < row - 1; i++) {
      const a = j * row + i;
      index.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** Soft darkening near a contact edge: 1 far away, 1 - strength right at it. */
export const occlusion = (distance: number, radius: number, strength: number) =>
  1 - strength * Math.exp(-Math.max(0, distance) / radius);

/** Bakes per-vertex ambient occlusion into a geometry already placed in world space. */
export function bakeAO(geo: THREE.BufferGeometry, ao: (p: THREE.Vector3) => number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const v = ao(p);
    colors.set([v, v, v], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

let plaster: THREE.Texture | undefined;

/**
 * Near-white plaster: broad, faint mottling plus fine grain, so lit walls read as a surface
 * rather than a flat colour. Multiplied by each room's wall colour; UVs are in metres.
 */
export function plasterTexture(): THREE.Texture {
  if (plaster) return plaster;
  const rand = mulberry32(4242);
  const size = 512;
  const [c, ctx] = canvas2d(size);
  // Very low contrast on purpose: it should read as "a painted wall", never as a pattern.
  ctx.fillStyle = '#fbfbfb';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const r = 40 + rand() * 120;
    wrappedBlotch(ctx, size, rand() * size, rand() * size, r, rand() < 0.5 ? 'rgba(0,0,0,0.012)' : 'rgba(255,255,255,0.02)');
  }
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(rand() * size, rand() * size, 1, 1);
  }
  plaster = tileTexture(c, true);
  return plaster;
}

/**
 * A ceiling light diffuser: frosted panes in a grid of slim frames, slightly brighter in the
 * middle of each pane. Sized so panes are about 1.2 m across.
 */
export function diffuserTexture(width: number, depth: number): THREE.Texture {
  const px = 64; // per metre
  const [c, ctx] = canvas2d(1);
  c.width = Math.round(width * px);
  c.height = Math.round(depth * px);
  const cols = Math.max(1, Math.round(width / 1.2));
  const rows = Math.max(1, Math.round(depth / 1.2));
  const pw = c.width / cols;
  const ph = c.height / rows;
  ctx.fillStyle = '#8f8b84'; // frames
  ctx.fillRect(0, 0, c.width, c.height);
  const frame = Math.max(2, px * 0.06);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * pw + frame / 2;
      const y = j * ph + frame / 2;
      const g = ctx.createRadialGradient(x + pw / 2, y + ph / 2, 0, x + pw / 2, y + ph / 2, Math.max(pw, ph) * 0.7);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#e6e3dc');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, pw - frame, ph - frame);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
