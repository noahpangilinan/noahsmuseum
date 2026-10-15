# Textures: formats and tiers

Two budgets drive this (see [plan.md](plan.md#performance-budgets)): what a visitor **downloads**, and how much **GPU memory** the textures take once uploaded. They pull in different directions, so paintings use two tiers.

## Paintings

| Tier | File | When it's resident | Download | GPU memory (≈) |
|---|---|---|---|---|
| Preview | `art/<id>/preview.ktx2`, 1024 px, KTX2 ETC1S | whenever the painting's room is loaded | ~150–250 KB | ~0.7 MB |
| Full | `art/<id>/full.jpg`, up to 2048 px | only within `nearDistance` of the piece (3.5 m, or 1.3× its largest side) | ~100–900 KB | ~21 MB |

For comparison, the old setup kept every painting as a 2048 px JPEG in GPU memory, about 21 MB each.

Why not use KTX2 for the full tier too? Measured on a dark Caravaggio and a flat-colour af Klint:

| 2048 px | JPEG | KTX2 ETC1S | KTX2 UASTC | UASTC + RDO |
|---|---|---|---|---|
| file size | 300–430 KB | ~620 KB | 3.7–4.1 MB | ~3 MB |

UASTC (near-lossless) files are about 10× the JPEG, which would blow the download budget. ETC1S is small, but it bands in dark gradients and flat fields, the two things this collection has most of. So the close-up tier stays JPEG, where quality matters and only a few are resident at once. ETC1S is used only for distant previews, where its artifacts aren't visible.

Wall label text also only loads when you're near; from a distance the label is a blank card.

## 3D models

Textures inside `content/models/*.glb` are KTX2: colour and ORM maps as ETC1S (≤ 2048 px), normal maps as UASTC (≤ 1024 px). ETC1S artifacts on a normal map would show up as lighting errors.

## Building

```sh
npm run textures              # build missing or stale painting previews from full.jpg
npm run textures -- --models  # also convert any non-KTX2 textures inside content/models/*.glb
```

The tool is in `tools/textures/build.mjs`. It uses the Basis Universal encoder compiled to WebAssembly (`ktx2-encoder`), so there's nothing native to install. Outputs are committed, and CI doesn't re-encode. A 1024 px ETC1S preview takes a few seconds to encode.

## Not compressed

- Floors and label text are drawn in the browser at runtime, so they stay uncompressed. They're small.
- Sculpture photo cards (`art/<id>/preview.jpg`) only appear if a model fails to load.
