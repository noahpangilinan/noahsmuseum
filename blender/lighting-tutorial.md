# Baking lighting for a room: quick tutorial

This guide turns one placeholder room into a Blender-modelled room with **baked lighting** (a lightmap), then plugs it into the museum. Do one room first, all the way through. The entrance gallery is a good start.

How it works in the app: when a room in `content/museum.json` has a `model`, the app loads that glTF *instead of* the placeholder box. If it also has a `lightmap`, that image is applied to every mesh that has a second UV map, as baked indirect light. Collision, doorways and what gets drawn still come from the room's `bounds` in `museum.json`, so the model has to match them.

Written for Blender 4.x. See also [docs/blender-conventions.md](../docs/blender-conventions.md).

---

## 1. Set up the scene

1. **New file → General.** Delete the default cube, camera and light.
2. **Scene Properties → Units:** Metric, Unit Scale `1.0`, Length `Meters`.
3. **Render Properties:** Render Engine **Cycles**, Device **GPU Compute** if you have one.
4. Save as `blender/<roomId>.blend`, e.g. `blender/entrance-gallery.blend`.

## 2. Model the room in museum coordinates

Blender is Z-up and the museum is Y-up. The glTF exporter converts between them, but it flips one axis:

> **Museum (x, y, z) → Blender (x, −z, y).** So x stays the same, the museum's z becomes Blender's **−Y**, and height is Blender's **Z**.

Current rooms, already converted (metres):

| Room | Blender X | Blender Y | Height (Blender Z) |
|---|---|---|---|
| `entrance-gallery` | -7 … 7 | -5 … 5 | 5 |
| `north-hall` | -1.5 … 1.5 | 5 … 13 | 3.6 |
| `swan-room` | -8 … 8 | 13 … 25 | 5.5 |
| `east-hall` | 7 … 17 | -1.5 … 1.5 | 3.6 |
| `dark-room` | 17 … 27 | -6 … 6 | 4.5 |
| `rousseau-hall` | -7.5 … -1.5 | 7 … 10 | 3.6 |
| `rousseau-room` | -21 … -7.5 | -1.5 … 12.5 | 5 |
| `armor-hall` | -1.5 … 1.5 | -11 … -5 | 3.6 |
| `armor-hall-east` | 1.5 … 10.5 | -11 … -8 | 3.6 |
| `armor-hall-south` | 7.5 … 10.5 | -17 … -11 | 3.6 |
| `armor-court` | 0 … 22 | -33 … -17 | 8 |

1. Floor at **Z = 0**. Build the floor, ceiling and four walls so the room's *inside faces* sit exactly on the edges above. Give walls real thickness (10–20 cm) by building them outward, beyond the edges.
2. **Cut doorways** where the room meets a connected room or corridor: the full width of the shared stretch of wall, **3.6 m high** (or the corridor's ceiling height if that's lower). The app's collision expects openings exactly there. The M map in the app shows where they are.
3. Add the details that sell it: baseboards, door casings, a skylight well, light tracks, vents.
4. Check normals point into the room (**Overlays → Face Orientation**: blue inside).
5. Don't model the paintings, frames, benches or cases. The app places those from `museum.json`.

## 3. Materials (UV map 1)

1. Use **Principled BSDF** only, with Base Color, Roughness and Normal maps. Anything fancier won't survive glTF export.
2. Unwrap for texturing in the first UV map (`UVMap`). It can tile and overlap freely.

## 4. Lightmap UVs (UV map 2)

1. Select all room meshes → **Object Data Properties → UV Maps → +** and name the new map `Lightmap`. It must be the **second** UV map.
2. With `Lightmap` selected (click it so it's the *active* UV map), enter Edit Mode, select all, then **UV → Lightmap Pack** (or Smart UV Project with Island Margin `0.02`).
3. Check in the UV editor that **no islands overlap** and everything is inside the square. Overlaps bake as dark smudges.

## 5. Light it

Lights live only in Blender and get baked in. **Don't light the paintings:** the app adds a real-time spotlight pool on each painting (and its wall). Baking pools too would double them. Light the *room*.

- **Skylit rooms:** an **Area light** (Shape: Rectangle) just under the skylight opening, pointing down, warm white (~5500 K), and a low-strength **World** colour for sky bounce.
- **Track or downlit rooms:** a few **Spot** or **Area** lights with large Radius (soft edges) and Blend ~0.6, washing the floor and the upper walls. Leave the hanging height to the app's painting spots.
- **Keep it a little dim.** Lightmaps are saved as 8-bit images (step 7), so anything brighter than white clips. You can lift the overall level in the app afterwards.
- Check with **Viewport Shading → Rendered** before baking.

## 6. Bake

1. **Image Editor → New Image:** name `Lightmap`, **2048 × 2048**, tick **32-bit Float**, untick Alpha. In the sidebar, set Color Space to **Non-Color**.
2. In **every** material on the room: add an **Image Texture** node, choose `Lightmap`, **don't connect it**, and click it so it's the *active* (highlighted) node. Blender bakes into the active image node.
3. Make sure `Lightmap` is the **active** UV map on every mesh (step 4).
4. **Render Properties → Bake:**
   - Bake Type: **Diffuse**
   - Contributions: **Direct** ✓, **Indirect** ✓, **Color ✗** (important: the app multiplies by the material colour itself)
   - Margin: 8 px
   - Sampling → Render: 512–1024 samples
5. Select all room meshes → **Bake**. A 2K bake takes from a few minutes to tens of minutes.

## 7. Denoise and save

1. **Compositing** workspace → tick **Use Nodes** → add **Image** (the `Lightmap`) → **Denoise** → **Viewer**. Check the result in the Image Editor's *Viewer Node*.
2. Save the denoised image: **Image → Save As** → **PNG**, 8-bit, RGB, Color Space **Non-Color**, to `content/rooms/<roomId>_lm.png`.

## 8. Export the model

1. Select the room's meshes (just the room).
2. **File → Export → glTF 2.0:**
   - Format: **glTF Binary (.glb)**
   - Include: **Selected Objects**
   - Transform: **+Y Up** ✓
   - Data → Mesh: **Apply Modifiers** ✓, **UVs** ✓, **Normals** ✓
   - Materials: Export
3. Save as `content/rooms/<roomId>.glb`.
4. Optional, to shrink it (keeps both UV maps):
   ```sh
   npx @gltf-transform/cli optimize content/rooms/<roomId>.glb content/rooms/<roomId>.glb --compress meshopt --texture-compress webp --simplify false
   ```

## 9. Plug it in

In `content/museum.json`, on that room:

```json
"model": "rooms/entrance-gallery.glb",
"lightmap": "rooms/entrance-gallery_lm.png",
```

Leave `bounds`, `connections` and `slots` as they are. The placeholder's `finish` options (`walls`, `floor`, `ceiling`, `plaster`) are ignored once a model is set. `artworkSpots` still applies: keep it on so the paintings stay lit.

> The scene file is generated by a script in the current workflow. If you edit `museum.json` by hand, say so before the next regeneration, or ask for these two fields to be added to the generator.

## 10. Check it

```sh
npm run dev
```

- Walk the room. Add `?debug` to the URL to see draw calls and memory, and `?at=x,z&look=x,z` to jump straight there (museum coordinates).
- **Too dark or too bright overall?** Rebake with adjusted light strengths, or ask for the lightmap intensity to be made a per-room setting.
- **Black smudges or seams:** overlapping lightmap UVs (step 4), or too small a Margin.
- **Room looks offset from the paintings or doors:** the model isn't in museum coordinates (step 2).
- **Budget:** 2K lightmap per room on high, 1K on low; ≤ 20 MB per room including art.

Once one room looks right, the rest follow the same steps. Each baked room also makes it possible to remove that room's real-time placeholder lights, which helps load time.
