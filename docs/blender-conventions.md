# Blender conventions

These rules let room exports drop into the app with no manual fixes. If a rule gets in your way, raise it before working around it. The exported files are part of the shared contract.

## Units and axes

- **1 Blender unit = 1 metre.** Scene → Units: Metric, Unit Scale 1.0.
- Blender is Z-up; glTF/three.js is Y-up. Leave **+Y Up** checked in the glTF exporter and model naturally in Blender.
- The floor of every room is at Z = 0 in Blender (→ y = 0 in the app). Put the room where it sits in the museum plan, not at the origin, so `bounds` in `museum.json` matches the model.
- Ceilings 4–6 m. Artwork centres hang ~1.5 m above the floor.

## Naming

| Thing | Name | Example |
|---|---|---|
| Room collection | `room_<roomId>` | `room_impressionism` |
| Wall / floor / ceiling meshes | `<roomId>_<part>[_n]` | `impressionism_wall_north` |
| Artwork slot | Empty named `SLOT_<slotId>` | `SLOT_north-1` |
| Materials | `M_<surface>_<variant>` | `M_floor_oak_polished` |

`roomId` and `slotId` must match `museum.json` exactly: lowercase, hyphen-separated.

## Artwork slots

- Use an **Empty (Plain Axes or Single Arrow)** per slot, inside the room collection.
- Place it at the **centre of the hanging area**, 1–2 cm in front of the wall surface.
- Orient it so its **local −Y axis (Blender "front") points into the room**. After the Y-up conversion this becomes the slot `normal`.
- Custom properties on the empty: `maxWidth` and `maxHeight` in metres. These become `maxSize: [width, height]`.
- The M2 export script reads these empties and writes the room's `slots` list into `museum.json`. Don't hand-edit slots for rooms that have a `.blend`.

## UV channels

- **UV0 (`UVMap`)**: material textures. Tiling is fine.
- **UV1 (`Lightmap`)**: the lightmap unwrap. **Non-overlapping**, inside 0–1, with ≥ 4 px padding at the target resolution. Use Smart UV Project or Lightmap Pack, then check for overlaps.
- The app applies the room's `lightmap` texture to UV1 automatically (`app/world/rooms.ts`).

## Lightmaps

- Step by step: [blender/lighting-tutorial.md](../blender/lighting-tutorial.md).
- Bake with Cycles: Diffuse with Direct + Indirect and **Color off** (the app multiplies by the material colour itself). Denoise before saving.
- Resolution: **2048² per room for high, 1024² for low** (export both once quality tiers land).
- Save as an 8-bit **PNG, Non-Color**, to `content/rooms/<roomId>_lm.png`. The app also accepts `.ktx2`; an HDR/KTX2 path can come later if 8-bit clipping becomes a problem.
- Don't bake artwork spotlights into the walls. They're real-time lights in the app so frames cast moving-correct shadows.

## Materials

- Principled BSDF only, with standard texture inputs: Base Color (sRGB), Roughness/Metallic (Non-Color), Normal (Non-Color). Anything else won't survive glTF export.
- Keep texture sizes to powers of two, ≤ 2048².

## Export

File → Export → glTF 2.0:

- Format: **glTF Binary (.glb)**
- Include: Selected objects / active collection only; Custom Properties ✓ (for slot data)
- Transform: +Y Up ✓
- Mesh: Apply Modifiers ✓, UVs ✓, Normals ✓
- Compression: **Meshopt** (EXT_meshopt_compression). If the exporter lacks it, run `gltfpack -cc -tc` afterwards, which also converts textures to KTX2.
- Output: `content/rooms/<roomId>.glb`

Keep source files in `blender/<roomId>.blend`. `*.blend1` backups are git-ignored.
