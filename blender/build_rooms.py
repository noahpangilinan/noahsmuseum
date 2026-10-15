"""
Builds museum rooms in Blender from content/museum.json, bakes their lighting, and exports
them for the app. Run headless:

  blender -b --factory-startup --python blender/build_rooms.py -- --room entrance-gallery
  blender -b --factory-startup --python blender/build_rooms.py -- --room all --size 2048 --samples 256

For each room it writes:
  content/rooms/<id>.glb         geometry; materials are named slots the app fills in
                                 ("floor", "wall", "ceiling", "trim", "skylight")
  content/rooms/<id>_lm.png      baked lighting (diffuse, no albedo) on UV map 2, 8-bit, sRGB-encoded
  content/rooms/<id>.bake.json   bake settings and the lightmap's brightness scale
  blender/<id>.blend             the scene, so lights can be art-directed and re-baked by hand

Geometry mirrors the app's placeholder rooms (app/world/rooms.ts): the same walls, doorway
openings, lintels, baseboards and casings, so collision and visibility still line up.
"""

import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

MAX_DOOR_HEIGHT = 3.6
MIN_DOOR_WIDTH = 0.9
EPS = 1e-3
BASE_H, BASE_D = 0.12, 0.015
CASING_W, CASING_D = 0.09, 0.025

# Albedo stand-ins for the app's procedural floors (affects bounce colour only).
FLOOR_COLORS = {"oak": "#9a7a58", "dark-wood": "#5a4030", "concrete": "#b7b3ab", "stone": "#9d968a"}


# ---------------------------------------------------------------- arguments

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {"room": "entrance-gallery", "size": 1024, "samples": 128}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        args[key] = argv[i + 1] if key == "room" else int(argv[i + 1])
    return args


# ---------------------------------------------------------------- layout (mirrors app/world/layout.ts)

def find_doorway(a, b):
    ax0, ay0, az0 = a["bounds"]["min"]
    ax1, ay1, az1 = a["bounds"]["max"]
    bx0, by0, bz0 = b["bounds"]["min"]
    bx1, by1, bz1 = b["bounds"]["max"]
    bottom = max(ay0, by0)
    top = min(ay1, by1, bottom + MAX_DOOR_HEIGHT)
    if top - bottom < 2:
        return None
    ids = (a["id"], b["id"])
    for p, q in ((az0, bz1), (az1, bz0)):
        if abs(p - q) < EPS:
            lo, hi = max(ax0, bx0), min(ax1, bx1)
            if hi - lo >= MIN_DOOR_WIDTH:
                return {"rooms": ids, "axis": "z", "plane": p, "from": lo, "to": hi, "bottom": bottom, "top": top}
    for p, q in ((ax0, bx1), (ax1, bx0)):
        if abs(p - q) < EPS:
            lo, hi = max(az0, bz0), min(az1, bz1)
            if hi - lo >= MIN_DOOR_WIDTH:
                return {"rooms": ids, "axis": "x", "plane": p, "from": lo, "to": hi, "bottom": bottom, "top": top}
    return None


def find_doorways(museum):
    by_id = {r["id"]: r for r in museum["rooms"]}
    seen, out = set(), []
    for r in museum["rooms"]:
        for c in r["connections"]:
            key = tuple(sorted((r["id"], c)))
            if key in seen:
                continue
            seen.add(key)
            d = find_doorway(r, by_id[c])
            if d:
                out.append(d)
    return out


# ---------------------------------------------------------------- geometry

def to_blender(x, y, z):
    """Museum (x, y up, z) -> Blender (x, -z, y up). The glTF exporter's +Y Up undoes this."""
    return (x, -z, y)


class MeshBuilder:
    """Collects quads per material, in museum coordinates, with UV0 in metres."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.materials = []

    def slot(self, name):
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def quad(self, corners, uvs, material):
        verts = [self.bm.verts.new(to_blender(*c)) for c in corners]
        face = self.bm.faces.new(verts)
        face.material_index = self.slot(material)
        for loop, uv in zip(face.loops, uvs):
            loop[self.uv].uv = uv

    def box(self, center, size, material):
        """Axis-aligned box (museum coordinates); UVs don't matter for trim."""
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        x0, x1, y0, y1, z0, z1 = cx - sx, cx + sx, cy - sy, cy + sy, cz - sz, cz + sz
        flat = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for corners in (
            [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],  # +z
            [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)],  # -z
            [(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)],  # +x
            [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],  # -x
            [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)],  # +y
        ):
            self.quad(corners, flat, material)


def build_room(room, doorways):
    (x0, y0, z0), (x1, y1, z1) = room["bounds"]["min"], room["bounds"]["max"]
    h = y1 - y0
    mb = MeshBuilder()

    # Floor and ceiling, wound to face into the room. UVs in metres like the app's.
    mb.quad([(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)],
            [(x0, -z1), (x1, -z1), (x1, -z0), (x0, -z0)], "floor")
    mb.quad([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
            [(x0, -z0), (x1, -z0), (x1, -z1), (x0, -z1)], "ceiling")

    walls = [
        ("z", z0, (0, 0, 1), x0, x1),
        ("z", z1, (0, 0, -1), x0, x1),
        ("x", x0, (1, 0, 0), z0, z1),
        ("x", x1, (-1, 0, 0), z0, z1),
    ]
    for axis, plane, normal, lo, hi in walls:
        def point(l, y, out=0.0):
            if axis == "z":
                return (l, y, plane + normal[2] * out)
            return (plane + normal[0] * out, y, l)

        def panel(a, b, ya, yb):
            """Wall quad from lateral a..b, height ya..yb, facing into the room."""
            corners = [point(a, ya), point(b, ya), point(b, yb), point(a, yb)]
            uvs = [(a, ya), (b, ya), (b, yb), (a, yb)]
            # Flip winding where (a->b) runs against the inward normal's handedness.
            facing_in = (normal[2] > 0) if axis == "z" else (normal[0] < 0)
            if not facing_in:
                corners, uvs = corners[::-1], uvs[::-1]
            mb.quad(corners, uvs, "wall")

        def trim(a, b, ya, yb, depth):
            mid_l, mid_y = (a + b) / 2, (ya + yb) / 2
            c = point(mid_l, mid_y, depth / 2)
            size = (b - a, yb - ya, depth) if axis == "z" else (depth, yb - ya, b - a)
            mb.box(c, size, "trim")

        openings = sorted(
            (d for d in doorways if room["id"] in d["rooms"] and d["axis"] == axis and abs(d["plane"] - plane) < EPS),
            key=lambda d: d["from"],
        )
        cursor = lo
        for o in openings:
            if o["from"] - cursor > EPS:
                panel(cursor, o["from"], y0, y1)
                trim(cursor, o["from"], y0, y0 + BASE_H, BASE_D)
            if y1 - o["top"] > EPS:
                panel(o["from"], o["to"], o["top"], y1)
                trim(o["from"] - CASING_W, o["to"] + CASING_W, o["top"], o["top"] + CASING_W, CASING_D)
            casing_h = o["top"] - o["bottom"]
            if o["from"] - lo > EPS:
                trim(o["from"] - CASING_W, o["from"], o["bottom"], o["bottom"] + casing_h, CASING_D)
            if hi - o["to"] > EPS:
                trim(o["to"], o["to"] + CASING_W, o["bottom"], o["bottom"] + casing_h, CASING_D)
            cursor = o["to"]
        if hi - cursor > EPS:
            panel(cursor, hi, y0, y1)
            trim(cursor, hi, y0, y0 + BASE_H, BASE_D)

    # Skylight diffuser panel (the app swaps in its glowing diffuser material).
    finish = room.get("finish", {})
    if finish.get("ceiling") == "skylight":
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hw, hd = (x1 - x0) * 0.3, (z1 - z0) * 0.3
        y = y1 - 0.02
        mb.quad([(cx - hw, y, cz - hd), (cx + hw, y, cz - hd), (cx + hw, y, cz + hd), (cx - hw, y, cz + hd)],
                [(0, 1), (1, 1), (1, 0), (0, 0)], "skylight")

    mesh = bpy.data.meshes.new(room["id"])
    mb.bm.to_mesh(mesh)
    mb.bm.free()
    obj = bpy.data.objects.new(room["id"], mesh)
    bpy.context.scene.collection.objects.link(obj)
    for name in mb.materials:
        obj.data.materials.append(make_material(name, room))
    return obj


# ---------------------------------------------------------------- materials and lights

def srgb_to_linear(hex_color):
    c = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c] + [1.0]


def make_material(name, room):
    finish = room.get("finish", {})
    wall = finish.get("walls", "#eeebe4")
    mat = bpy.data.materials.new(name)  # the app looks materials up by these names
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    color = {
        "floor": FLOOR_COLORS.get(finish.get("floor", "oak"), "#9a7a58"),
        "wall": wall,
        "ceiling": wall,
        "trim": wall,
        "skylight": "#ffffff",
    }[name]
    bsdf.inputs["Base Color"].default_value = srgb_to_linear(color)
    bsdf.inputs["Roughness"].default_value = 0.6 if name == "floor" else 0.95
    return mat


def add_light(kind, name, location, rotation=(0, 0, 0), **props):
    data = bpy.data.lights.new(name, kind)
    for k, v in props.items():
        setattr(data, k, v)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_lights(room):
    """Bakes the room's general lighting (finish.ceiling). Paintings are lit live by the app."""
    (x0, y0, z0), (x1, y1, z1) = room["bounds"]["min"], room["bounds"]["max"]
    w, d = x1 - x0, z1 - z0
    ceiling = room.get("finish", {}).get("ceiling", "downlights")
    warm = (1.0, 0.94, 0.86)
    if ceiling == "skylight":
        # Pointing straight down is the area light's default orientation.
        add_light("AREA", "skylight", to_blender((x0 + x1) / 2, y1 - 0.05, (z0 + z1) / 2),
                  shape="RECTANGLE", size=w * 0.6, size_y=d * 0.6, energy=60 * w * d, color=(1.0, 0.97, 0.93))
    elif ceiling == "downlights":
        # A grid of soft, wide ceiling fixtures (~3.5 m apart) for even gallery light, rather than
        # a few narrow spots that leave hot pools on the floor and dark walls.
        cols, rows = max(1, round(w / 3.5)), max(1, round(d / 3.5))
        for i in range(cols):
            for j in range(rows):
                x = x0 + (i + 0.5) * w / cols
                z = z0 + (j + 0.5) * d / rows
                add_light("AREA", f"ceiling_light_{i}_{j}", to_blender(x, y1 - 0.05, z),
                          shape="DISK", size=0.9, energy=120, color=warm)


# ---------------------------------------------------------------- lightmap UVs, bake, export

def lightmap_uvs(obj):
    uv = obj.data.uv_layers.new(name="Lightmap")  # second UV map -> TEXCOORD_1 -> app's uv1
    obj.data.uv_layers.active = uv
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(obj, size, samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False  # light only: the app multiplies by its own materials
    scene.render.bake.margin = 8

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0  # the app adds its own fill

    image = bpy.data.images.new(f"{obj.name}_lightmap", size, size, alpha=True, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    image.generated_color = (0, 0, 0, 0)
    for mat in obj.data.materials:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        mat.node_tree.nodes.active = node  # bake target

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE")
    return image


def denoise(pixels, size):
    """
    Light smoothing of residual sampling noise: a small Gaussian, normalised by coverage so
    unbaked texels (alpha 0) don't bleed into the islands.
    """
    img = pixels.reshape(size, size, 4)
    rgb, cover = img[..., :3] * img[..., 3:4], img[..., 3:4]
    k = np.array([1, 4, 6, 4, 1], dtype=np.float32)
    k /= k.sum()

    def blur(a):
        for axis in (0, 1):
            a = sum(np.roll(a, s - 2, axis=axis) * k[s] for s in range(5))
        return a

    smooth = blur(rgb) / np.maximum(blur(cover), 1e-6)
    out = np.where(cover > 0, smooth, 0)
    return out, cover[..., 0]


def save_lightmap(image, size, path):
    pixels = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgb, cover = denoise(pixels, size)

    # Scale so all but the brightest 1% fits; record the scale so the app restores it.
    lit = rgb[cover > 0]
    peak = float(np.percentile(lit.max(axis=1), 99)) if lit.size else 1.0
    scale = 1.0 / max(peak, 1e-6)
    rgb = np.clip(rgb * scale, 0, 1)
    # Store with the sRGB curve, like a photo: darks get far more of the 256 levels than linear
    # storage would give them. The app decodes it (the texture is marked sRGB).
    rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)

    out = bpy.data.images.new(path.stem, size, size, alpha=False, float_buffer=False)
    out.colorspace_settings.name = "Non-Color"
    rgba = np.concatenate([rgb, np.ones((size, size, 1), dtype=np.float32)], axis=2)
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = str(path)
    out.file_format = "PNG"
    out.save()
    return scale


def export_glb(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_apply=True,
    )


# ---------------------------------------------------------------- main

def process(room, doorways, size, samples):
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = build_room(room, doorways)
    add_lights(room)
    lightmap_uvs(obj)
    image = bake(obj, size, samples)
    rooms_dir = CONTENT / "rooms"
    rooms_dir.mkdir(exist_ok=True)
    scale = save_lightmap(image, size, rooms_dir / f"{room['id']}_lm.png")
    export_glb(obj, rooms_dir / f"{room['id']}.glb")
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "blender" / f"{room['id']}.blend"))
    info = {"room": room["id"], "size": size, "samples": samples, "scale": scale, "seconds": round(time.time() - t0)}
    (rooms_dir / f"{room['id']}.bake.json").write_text(json.dumps(info, indent=2) + "\n")
    print("BAKED", json.dumps(info))


def main():
    args = parse_args()
    museum = json.loads((CONTENT / "museum.json").read_text(encoding="utf-8"))
    doorways = find_doorways(museum)
    rooms = museum["rooms"] if args["room"] == "all" else [r for r in museum["rooms"] if r["id"] == args["room"]]
    if not rooms:
        raise SystemExit(f"no room {args['room']!r}")
    for room in rooms:
        process(room, doorways, args["size"], args["samples"])


main()
