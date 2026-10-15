# blender/

Source `.blend` files for rooms and frames, plus export scripts.

- One file per room: `blender/<roomId>.blend`
- Follow [docs/blender-conventions.md](../docs/blender-conventions.md)
- Baking a room's lighting: [lighting-tutorial.md](lighting-tutorial.md)
- Exports go to `content/rooms/` (rooms) and `content/frames/` (frames)
- M2 adds `export_slots.py`, which writes each room's `SLOT_*` empties into `content/museum.json`
