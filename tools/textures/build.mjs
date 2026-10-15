#!/usr/bin/env node
/**
 * Builds GPU-compressed textures for the museum. Run after adding or changing art:
 *
 *   npm run textures            # painting previews (skips ones that are up to date)
 *   npm run textures -- --models  # also re-encode textures inside content/models/*.glb
 *
 * Paintings get two tiers (see docs/textures.md):
 *   art/<id>/full.jpg     the source, shown only when the visitor is close
 *   art/<id>/preview.ktx2 1024 px ETC1S, shown from a distance; ~8x less GPU memory than a JPEG
 *
 * Model textures: colour/ORM maps become ETC1S, normal maps UASTC (ETC1S artifacts would show
 * as lighting errors). Normal maps are capped at 1024 px, everything else at 2048 px.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const content = path.join(root, 'content');
const PREVIEW_PX = 1024;

/**
 * Size that fits inside maxPx and is a multiple of 4 on both axes. Block-compressed GPU formats
 * work in 4x4 blocks; in WebGPU any other size is an invalid texture, and one invalid texture
 * makes the whole frame fail to render.
 */
async function blockAlignedSize(buffer, maxPx) {
  const { width, height } = await sharp(buffer).metadata();
  const scale = Math.min(1, maxPx / Math.max(width, height));
  const round4 = (v) => Math.max(4, Math.round((v * scale) / 4) * 4);
  return { width: round4(width), height: round4(height) };
}

/** Decodes any image to RGBA for the encoder, resized to block-aligned dimensions. */
const decoder = (maxPx) => async (buffer) => {
  const size = await blockAlignedSize(buffer, maxPx);
  const { data, info } = await sharp(buffer).resize(size.width, size.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

const ETC1S = { enableDebug: false, isUASTC: false, qualityLevel: 230, compressionLevel: 2, isPerceptual: true, generateMipmap: true };
const UASTC_NORMAL = { enableDebug: false, isUASTC: true, needSupercompression: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1, isPerceptual: false, isNormalMap: true, generateMipmap: true };

/** True if a KTX2 file's base level is a multiple of 4 on both axes (see blockAlignedSize). */
function isBlockAligned(ktx2) {
  const width = ktx2.readUInt32LE(20);
  const height = ktx2.readUInt32LE(24);
  return width % 4 === 0 && height % 4 === 0;
}

async function buildPreviews() {
  const museum = JSON.parse(fs.readFileSync(path.join(content, 'museum.json'), 'utf8'));
  let built = 0;
  for (const a of museum.artworks) {
    if (!a.imageFull || !a.image.endsWith('.ktx2')) continue;
    const src = path.join(content, a.imageFull);
    const out = path.join(content, a.image);
    const upToDate =
      fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs && isBlockAligned(fs.readFileSync(out));
    if (upToDate && !process.argv.includes('--force')) continue;
    const t = Date.now();
    const source = fs.readFileSync(src);
    // Y-flipped so it matches three.js's convention for ordinary (flipY) images.
    const ktx2 = Buffer.from(await encodeToKTX2(new Uint8Array(source), { ...ETC1S, isYFlip: true, imageDecoder: decoder(PREVIEW_PX) }));
    if (!isBlockAligned(ktx2)) throw new Error(`${a.id}: encoder produced a non-block-aligned texture`);
    fs.writeFileSync(out, ktx2);
    built++;
    console.log(`${a.id}: ${(ktx2.length / 1024).toFixed(0)} KB (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }
  console.log(`previews: ${built} built, ${museum.artworks.length - built} up to date or not tiered`);
}

async function buildModels() {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS, EXTTextureWebP } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
  const { ktx2 } = await import('ktx2-encoder/gltf-transform');
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const dir = path.join(content, 'models');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const doc = await io.read(path.join(dir, file));
    const textures = doc.getRoot().listTextures();
    if (textures.every((t) => t.getMimeType() === 'image/ktx2')) {
      console.log(`${file}: already KTX2`);
      continue;
    }
    const t = Date.now();
    await doc.transform(
      ktx2({ ...UASTC_NORMAL, slots: /normalTexture/, imageDecoder: decoder(1024) }),
      ktx2({ ...ETC1S, slots: /^(?!normalTexture).*/, imageDecoder: decoder(2048) }),
    );
    // WebP is no longer referenced.
    for (const ext of doc.getRoot().listExtensionsUsed()) if (ext instanceof EXTTextureWebP) ext.dispose();
    await io.write(path.join(dir, file), doc);
    console.log(`${file}: ${(fs.statSync(path.join(dir, file)).size / 1024).toFixed(0)} KB (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }
}

await buildPreviews();
if (process.argv.includes('--models')) await buildModels();
