# Noah's Museum

A browser-based, first-person museum of our favourite artworks. Built with Three.js (WebGPU, with WebGL2 fallback), TypeScript and Vite. The full project plan is in [docs/plan.md](docs/plan.md).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

URL flags: `?debug` opens the performance overlay on load, and `?webgl` forces the WebGL2 fallback.

## Controls

| Input | Action |
|---|---|
| Click | Enter (locks the pointer) |
| W A S D / arrows | Walk |
| Shift | Run |
| C | Crouch while held |
| Click a bench | Sit (lower view, no walking). Click again to stand |
| Mouse | Look |
| Click a painting | Show its wall label (labels also appear when you stand in front of a piece) |
| `` ` `` | Toggle debug overlay (FPS, draw calls, texture memory, loaded rooms) |
| Esc | Release the pointer |

## Layout

```
app/
  engine/     renderer setup (WebGPU → WebGL2), tone mapping, environment
  world/      scene-format contract + validation, room loading, artwork placement
  controls/   first-person controls and collision
  ui/         start screen, plaques, debug overlay
content/      served at the site root
  museum.json the scene file (see below)
  rooms/      exported .glb rooms + lightmaps (none yet)
  frames/     reusable frame models (M2)
  art/        per-artwork preview images
blender/      source .blend files + export scripts
tools/        content pipeline (add-artwork CLI arrives in M2)
docs/         plan, Blender conventions, artwork shortlist
```

## The scene file

`content/museum.json` is the contract between World (Blender) and Platform (code). Its types and validation live in [app/world/scene-format.ts](app/world/scene-format.ts). The app checks the file on load and lists every problem on screen.

- `dimensionsCm` is **[height, width]**. Artworks always render at real physical size, centred on their slot.
- `slots[].maxSize` is **[width, height]** in metres.
- A room without `model` gets a procedural placeholder box built from its `bounds`. All current rooms are placeholders until the first Blender room lands.
- **Doorways are automatic.** List two rooms in each other's `connections` and make their `bounds` touch along a wall (corridors are just narrow rooms). The shared stretch of wall becomes an opening, up to 3.6 m high, and you can walk through it.
- `finish` (optional, placeholder rooms only): `walls` colour, `floor` (`oak`, `dark-wood`, `concrete`, `stone`), `ceiling` lighting (`downlights`, `skylight`, `none`), and `artworkSpots` (default `true`).
- `furniture` (optional): benches at `position`, rotated by `rotationY` degrees. You can't walk through them.
- `spawn` (optional) sets where the visitor starts.
- Artworks can carry an optional display `date` (e.g. `"c. 1599"`) alongside the numeric `year`. `frame: "tapestry"` hangs a textile from a rod with soft folds.
- `sculptures` (optional, top level): free-standing 3D pieces placed by `room` + floor `position` + `rotationY`, with `dimensionsCm` as **[height, width, depth]** and `display` set to `case` (glass vitrine), `plinth` or `platform`. Give a `model` (glTF) and/or an `image`. The image appears as a photo card in the display until the model exists.

### Adding a 3D model

Download the glTF/GLB, then compress it before committing:

```sh
npx @gltf-transform/cli optimize in.glb content/models/<id>.glb --compress meshopt --texture-compress webp --texture-size 2048 --simplify-ratio 0.5
```

Set `"model": "models/<id>.glb"` on the sculpture. The app scales it to the catalogue height and stands it on the display, so the model should face +z. Aim for ≤ 150k triangles and 2K textures per piece. Sculptures add no lights, so they cost draw calls and memory but almost no shading time.

Each light adds shading cost to every pixel and slows shader compilation at load, so watch the count. Removing the three corridor downlights cut compile time from ~6 s to ~2 s. How lights are spent:

- A painting alone on its wall gets its own spot. Several paintings on one wall share **one** spot whose projected cookie texture paints a soft pool on each piece (`app/world/lighting.ts`).
- A skylight room with `artworkSpots: false` costs one light in total. Corridors use `ceiling: "none"` and borrow light from the rooms.

### Streaming and visibility

At load, `computeVisibility` (`app/world/layout.ts`) tests plan-view sight lines between points in every pair of rooms against the real walls and doorway openings. It takes about 75 ms. Each room then knows exactly which rooms can be seen from anywhere inside it (`app/world/streaming.ts`):

- **Drawn:** only the rooms visible from where you are. Frustum culling already skips what's off-screen; this also skips rooms hidden behind walls.
- **Loaded:** the drawn rooms, plus what the next room over can see (within two doorways), so art is ready before you step through. Everything else releases its textures and models. In the Armor Court only the court and its two halls are drawn or loaded (about 287 MB of textures, versus about 520 MB at the hub).
- Lights are never hidden. Toggling one would change every shader and cause a recompile hitch.

## Current floor plan

```
                 ┌────────────────────┐
                 │     swan-room      │  Hilma af Klint, The Swan (12 works), skylight
                 └───────┐    ┌───────┘
                         │    │ north-hall
           ┌─────────────┘    └──────────┐                ┌────────────┐
           │      entrance-gallery       ├────────────────┤ dark-room  │  Goya wall (5 Black Paintings),
           │  overture: 10 works, 4 walls    east-hall      │            │  Caravaggio, Artemisia Gentileschi
           └─────────────┐    ┌──────────┘                └────────────┘
                         │    │ armor-hall
                         │    └───────────────┬───────────────────────────────┐
                         │   armor-hall-east                 armor-court      │  Dido and Aeneas tapestries (8),
                         └────────────────────┤                               │  CMA armor scans (5)
                                              └───────────────────────────────┘
```

The armor wing bends on purpose: from the court you can't see the rest of the museum, so it isn't drawn or kept in memory there.

Debug flag: `?at=x,z&look=x,z` starts the camera anywhere (e.g. `?at=12,0&look=27,0` looks down the east hall at Saturn).

To add an artwork by hand, see [docs/artworks.md](docs/artworks.md#adding-one-by-hand-until-the-m2-cli-exists).

## Deploys

Netlify builds from `netlify.toml`. Once the repo is connected in the Netlify UI, every PR gets a deploy-preview URL. GitHub Actions runs a typecheck and build on every push and PR.
