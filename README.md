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
| Shift | Walk faster |
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
- A room without `model` gets a procedural placeholder box built from its `bounds`. That's what the entrance gallery is until the first Blender room lands.
- `spawn` (optional) sets where the visitor starts.

To add an artwork by hand, see [docs/artworks.md](docs/artworks.md#adding-one-by-hand-until-the-m2-cli-exists).

## Deploys

Netlify builds from `netlify.toml`. Once the repo is connected in the Netlify UI, every PR gets a deploy-preview URL. GitHub Actions runs a typecheck and build on every push and PR.
