# Virtual Museum — Project Plan

A browser-based, first-person museum of our favorite artworks, rendered at high fidelity and running smoothly on an ordinary laptop.

## Goals

- **Looks real:** baked global illumination, believable materials, gallery-style lighting on every piece.
- **Feels good:** smooth 60fps first-person movement on desktop, usable touch controls on mobile.
- **Easy to grow:** adding a new artwork takes minutes and needs no 3D work.
- **Loads fast:** first room interactive in under 5 seconds on a typical connection; everything else streams in.

## Non-goals (for v1)

- Real-time global illumination or ray tracing
- User accounts or a public submission system
- VR support (keep it possible, but don't build it yet)

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Rendering | Three.js (WebGPU renderer, WebGL2 fallback) | Mature, big ecosystem, WebGPU path is ready |
| Language / build | TypeScript + Vite | Fast iteration, typed scene format |
| UI overlay | Plain TS or a light framework (Svelte/Preact) | Plaques, menus, loading screens |
| 3D authoring | Blender | Modeling, UV unwrapping, lightmap baking |
| Asset formats | glTF 2.0 + KTX2 (Basis) textures + Meshopt geometry | Small downloads, GPU-friendly |
| Large artwork images | Tiled image pyramids (Deep Zoom style) | Close-up inspection without huge downloads |
| Hosting | Static hosting + CDN (Cloudflare Pages, Netlify, or S3 + CloudFront) | No server needed for v1 |
| Content source | Open-access APIs (Met, Art Institute of Chicago, Rijksmuseum, NGA) plus local images | High-res public-domain images, easy to automate |

---

## Ownership

**World (Person A):** the look.
Architecture and room modeling in Blender, materials, lightmap baking, artwork lighting, post-processing, frame designs, overall art direction.

**Platform (Person B):** the machinery.
Engine setup, asset pipeline and compression, streaming and LOD, controls, curation tool, performance tooling, deployment.

**Shared contract:** the scene format (below). Agree on it in week 1 and change it only by talking first.

---

## Scene format (shared contract)

A museum is described in JSON. Rooms are authored in Blender; artworks are placed by data, not by hand.

```json
{
  "rooms": [
    {
      "id": "impressionism",
      "model": "rooms/impressionism.glb",
      "lightmap": "rooms/impressionism_lm.ktx2",
      "bounds": { "min": [-10, 0, -8], "max": [10, 5, 8] },
      "connections": ["entrance", "dutch-golden-age"],
      "slots": [
        {
          "id": "north-1",
          "position": [0, 1.6, -7.9],
          "normal": [0, 0, 1],
          "maxSize": [3.0, 2.2]
        }
      ]
    }
  ],
  "artworks": [
    {
      "id": "water-lilies",
      "slot": "impressionism/north-1",
      "title": "Water Lilies",
      "artist": "Claude Monet",
      "year": 1906,
      "dimensionsCm": [89.9, 94.1],
      "image": "art/water-lilies/preview.ktx2",
      "deepZoom": "art/water-lilies/tiles/",
      "frame": "gilded-ornate",
      "source": "https://www.artic.edu/artworks/16568",
      "license": "CC0"
    }
  ]
}
```

Key rules:
- Artworks are always rendered at their **real physical size** (from `dimensionsCm`), centered in the slot.
- Slots are marked in Blender with named empties and exported automatically into the room's slot list.
- Every artwork records its source and license.

---

## Milestones

### M0 — Foundations (week 1)
- Repo, Vite + TypeScript + Three.js setup, CI, preview deploys on every PR
- Agree on the scene format and folder layout
- Pick the first 10 artworks and confirm their licenses
- Blender conventions doc: units (1 unit = 1 m), naming, UV channels (UV0 materials, UV1 lightmap)

**Done when:** an empty scene deploys to a public preview URL.

### M1 — One great room (weeks 2–4)
The most important milestone. If this room looks great, everything else is scaling.

- **A:** model one gallery room (walls, floor, ceiling, skylight or track lighting), bake lightmaps, PBR materials for the floor (polished concrete or wood) and walls
- **A:** gallery spotlight setup per artwork, tone mapping (AgX or ACES), subtle bloom and SSAO
- **B:** load the room glTF with KTX2 + Meshopt, apply lightmaps
- **B:** first-person controls: pointer lock, WASD, mouse look, head height ~1.6 m, collision with walls
- **B:** load 3 artworks from the scene file and place them at real size with a simple frame
- **Both:** click or approach an artwork to show its plaque

**Done when:** a friend opens the link, walks around, and says it looks real.

### M2 — Content pipeline (weeks 5–6)
- **B:** CLI tool: `add-artwork <source-url or image>` fetches the image and metadata from open-access APIs, generates a compressed preview texture and a Deep Zoom tile pyramid, and writes the artwork entry
- **B:** Blender export script that writes the room's slot list into the scene file
- **A:** 3–4 frame styles (modern thin black, gallery white, gilded ornate, floating/no frame) as reusable models, scaled procedurally to each artwork
- **A:** canvas and glass material variations (subtle sheen, slight reflections on glazed works)

**Done when:** adding a new painting takes under 5 minutes with no Blender work.

### M3 — The full museum (weeks 7–10)
- **A:** 4–6 themed rooms with distinct character (e.g. a bright modern white cube, a dark room with dramatic spot lighting, a classical hall with a skylight, a sculpture courtyard)
- **A:** entrance hall, corridors, benches, wayfinding signage
- **B:** room streaming: load adjacent rooms in the background, unload distant ones
- **B:** occlusion and frustum culling per room, texture memory budget
- **B:** close-up inspection mode: smoothly move to the artwork and pan/zoom into the Deep Zoom tiles
- **B:** loading screen with progress, then fade in

**Done when:** the whole museum loads progressively and holds 60fps on a mid-range laptop.

### M4 — Polish (weeks 11–12)
- Ambient audio (room tone, distant footsteps) and quiet footstep sounds
- Mobile controls: virtual joystick plus drag to look, or tap-to-walk to a point
- Quality tiers (low / medium / high) chosen automatically from device capability, with a manual override
- Minimap or room index for quick travel
- Accessibility: keyboard-only navigation, readable plaques, reduced-motion option
- Shareable links to a specific artwork (`/#water-lilies` drops you in front of it)

**Done when:** it's something you'd proudly post publicly.

### Stretch goals
- **Sculptures and 3D pieces** via Gaussian splats or photogrammetry scans
- **Procedural layout:** generate the floor plan from the collection, grouping by era, artist, or color
- **Multiplayer visits:** see friends as simple avatars, with presence and spatial voice
- **Time of day:** skylight rooms that shift from morning to evening light (pre-bake several lightmaps and blend between them)
- **Audio guide:** recorded narration per piece
- **WebXR:** walk the museum in a VR headset

---

## Performance budgets

| Item | Budget |
|---|---|
| Frame rate | 60fps on a mid-range laptop (integrated GPU), 30fps minimum on mobile |
| Initial download | < 15 MB before the first room is walkable |
| Per room | < 20 MB including lightmaps and artwork previews |
| GPU texture memory | < 512 MB on high, < 256 MB on low |
| Draw calls | < 300 per frame |
| Lightmap resolution | 2K per room on high, 1K on low |

Add an in-app debug overlay (FPS, draw calls, texture memory, loaded rooms) in M1 and keep it working throughout.

---

## Visual quality checklist

What separates "real" from "game demo":

- [ ] Baked global illumination with soft bounce light and contact shadows
- [ ] Correct physical scale (ceilings 4–6 m, artworks hung with centers ~1.5 m from the floor)
- [ ] Linear workflow, sRGB textures flagged correctly, good tone mapping
- [ ] Floors with subtle reflections and roughness variation
- [ ] Wall imperfections: slight texture, baseboards, light switches, vents
- [ ] Artwork lighting: warm spotlight pools, gentle falloff, no blown-out highlights on the canvas
- [ ] Frames cast soft shadows onto the wall
- [ ] Mipmapping and anisotropic filtering so artworks stay sharp at angles
- [ ] Antialiasing (MSAA or TAA) with no shimmering edges
- [ ] Camera: slight head bob (optional, off with reduced motion), eased acceleration

---

## Risks

| Risk | Mitigation |
|---|---|
| Lightmap baking is slow or produces artifacts | Learn the bake workflow in M1 on a single room; keep UV1 unwraps clean; use denoising |
| Mobile performance | Quality tiers from day one; test on a real phone every milestone |
| WebGPU differences between browsers | Keep the WebGL2 fallback path working in CI |
| Scope creep | M1 is the bar; stretch goals only after M4 |
| Licensing of artworks | Prefer CC0 open-access sources; record source and license per artwork; keep any copyrighted favorites private |

---

## Repo layout

```
/
├── app/                  # Three.js app (TypeScript)
│   ├── engine/           # renderer setup, post-processing, quality tiers
│   ├── world/            # room loading, streaming, culling
│   ├── controls/         # first-person, touch, inspection mode
│   ├── ui/               # plaques, menus, loading, debug overlay
│   └── main.ts
├── content/
│   ├── museum.json       # the scene file
│   ├── rooms/            # exported .glb + lightmaps
│   ├── frames/
│   └── art/              # per-artwork previews + tile pyramids
├── blender/              # source .blend files + export scripts
├── tools/
│   └── add-artwork/      # CLI for the content pipeline
└── docs/
    └── blender-conventions.md
```

---

## Working rhythm

- Weekly 30-minute sync: demo what changed in the live preview, adjust the next week's scope
- Every PR gets a preview deploy; review each other's work in the browser, not just in code
- Keep a shared "screenshots" channel or folder; the visual history is motivating and useful for a portfolio write-up later
