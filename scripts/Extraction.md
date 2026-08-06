# GTA III → glTF Extraction

How `gta_to_gltf.py` turns the original *Grand Theft Auto III* game data into
standard **glTF 2.0** models. This document describes every step of that
pipeline, in order, with the on-disk formats and worked examples.

---

## Overview

GTA III stores its world as proprietary **RenderWare** binaries packed inside a
single archive:

| File | Role |
|------|------|
| `models/gta3.img` + `models/gta3.dir` | Archive of all model geometry (`.dff`) and texture dictionaries (`.txd`) |
| `models/*.txd` (loose) | A handful of shared texture dictionaries that live *outside* the archive (e.g. `generic.txd`) |
| `data/**/*.ide` | Item **definitions** — the map from a numeric model ID to a `.dff` name **and** the `.txd` it uses |

A `.dff` contains geometry (vertices, UVs, per-vertex colour, triangles,
material list) but **never names its own texture dictionary** — that pairing
exists only in the `.ide` files. So the converter cannot work from the archive
alone; it must cross-reference the IDEs.

The pipeline is:

```
              ┌─────────────┐
 data/*.ide → │ parse IDEs  │ → model list + DFF→TXD map
              └─────────────┘
              ┌─────────────┐
 gta3.dir   → │ IMG index   │ → name → (offset, length) in gta3.img
              └─────────────┘
                     │  for each model:
                     ▼
        ┌──────────────────────────┐
        │ read <name>.dff  (bytes)  │──► parse RenderWare clump ──► geometry
        │ read <txd>.txd   (bytes)  │──► parse texture dict     ──► RGBA images
        └──────────────────────────┘
                     │
                     ▼  convert Z-up → Y-up, group by material
        ┌──────────────────────────┐
        │ build glTF 2.0            │──► <name>.gltf + <name>.bin
        │ + PNG textures            │──► textures/<txd>/<tex>.png
        └──────────────────────────┘
                     │
                     ▼
             extracted/gta3.json  (model → glTF path manifest)
```

Run with no arguments it reads `models/gta3.img` + `data/**/*.ide` and writes
everything to `./extracted`:

```
python gta_to_gltf.py
```

Everything below is what happens inside that command.

---

## Step 1 — Discover the inputs

Relative to the script (which sits in the game root):

- **Archive**: `models/gta3.img` with its paired directory `models/gta3.dir`.
- **Definitions**: every `*.ide` found by recursively walking `data/` (case-insensitive).
- **Loose textures**: the directory containing the archive (`models/`) is kept
  as a fallback texture source, because some dictionaries such as
  `generic.txd` (referenced by ~600 models) ship as loose files, not inside
  `gta3.img`.

No arguments are required; each of these has a flag override
(`--img`, `--data-dir`, `--dff-dir` / `--txd-dir`).

---

## Step 2 — Read the IMG/DIR archive

GTA III uses a **version-1** archive: a plain data blob (`gta3.img`) plus a
separate directory (`gta3.dir`). The `.dir` is an array of fixed **32-byte**
entries:

```
offset  size  field
  0      4    uint32  offset  (in 2048-byte sectors)
  4      4    uint32  size    (in 2048-byte sectors)
  8     24    char[]  name    (NUL-padded, e.g. "landchunk.dff")
```

To locate a file: `byte_offset = offset * 2048`, `byte_length = size * 2048`,
then seek into `gta3.img` and read. The reader builds a lowercase
`name → (byte_offset, byte_length)` index once, then serves reads lazily.

**Example** — a `.dir` entry `offset=1000, size=3, name="jetty.dff"` means
`jetty.dff` lives at byte `1000 × 2048 = 2,048,000` in `gta3.img` and is
`3 × 2048 = 6144` bytes long.

> The class also supports V2 archives (San Andreas: a single `gta3.img`
> beginning with the magic `VER2` and an embedded directory), but GTA III is
> always V1.

---

## Step 3 — Parse the IDE definitions

Each `.ide` is a plain-text file split into named sections terminated by `end`.
The converter reads every section that defines a placeable model — `objs`,
`tobj`, `cars`, `peds`, `hier` — all of which begin with the same three
columns:

```
objs
  ID,  ModelName,  TxdName,  ...extra columns...
end
```

**Example** (`data/maps/gta3.IDE`):

```
objs
200, ind_land101, pjs,      1, 127, 0
201, ind_land053, generic,  1, 180, 0
end
```

Only the first three fields matter here:

- **ID** — the model's numeric id (`200`)
- **ModelName** — the `.dff` basename (`ind_land101` → `ind_land101.dff`)
- **TxdName** — the texture dictionary (`pjs` → `pjs.txd`)

This yields the two things the archive can't provide: the **list of models to
convert** and, crucially, **which TXD each DFF uses**. Only ~6 % of models name
a TXD matching their own name, so this mapping is essential.

**Combining IDEs.** Every `.ide` under `data/` is parsed. A model may be
defined in more than one IDE (e.g. the master `gta3.IDE` plus a district IDE);
it is converted **once** (first definition wins), but the manifest records
every IDE that references it.

**Orphan sweep.** ~90 `.dff` files in the archive (mission/interior objects
like `bomber`, `cat`, weapons) appear in no IDE — they're loaded by the mission
script. The converter sweeps the archive for any `.dff` not covered by an IDE
and adds it with the fallback `txd = model-name` (which always exists for these
in GTA III).

---

## Step 4 — Parse the DFF (RenderWare clump)

A `.dff` is a tree of **RenderWare chunks**. Every chunk has a 12-byte header:

```
offset  size  field
  0      4    uint32  type     (e.g. 0x10 = Clump)
  4      4    uint32  size     (bytes of payload that follow)
  8      4    uint32  version  (RenderWare library id)
 12    size   payload / child chunks
```

Chunks nest: a chunk's payload is often just more chunks. The relevant type
codes:

| Code | Chunk |
|------|-------|
| `0x01` | Struct (raw data for its parent) |
| `0x02` | String |
| `0x03` | Extension |
| `0x06` | Texture |
| `0x07` | Material |
| `0x08` | Material List |
| `0x0E` | Frame List |
| `0x0F` | Geometry |
| `0x10` | Clump (root) |
| `0x1A` | Geometry List |

The hierarchy the parser walks:

```
Clump (0x10)
├─ Frame List (0x0E)
│    └─ Extension (0x03) → NodeName  → the model's frame name
├─ Geometry List (0x1A)
│    └─ Geometry (0x0F)
│         ├─ Struct (0x01)       → the mesh data (see below)
│         └─ Material List (0x08)
│              └─ Material (0x07)
│                   └─ Texture (0x06) → texture name string
```

The **frame name** is read from a `NodeName` extension inside the Frame List
(type `0x0253F2F5` on PC, `0x0253F2FE` on PS2 — GTA III PS2 data uses the
latter). Only the first Geometry is processed, which is sufficient for static
world objects.

### 4a. Geometry Struct layout

The Geometry's Struct payload is packed as (RW 3.x, GTA III / VC):

```
uint32   flags
uint32   n_triangles
uint32   n_vertices
uint32   n_morph_targets
float32  ambient, specular, diffuse         (surface lighting props, skipped)

if flags & PRELIT   (0x08):  RGBA8   × n_vertices      (per-vertex colour)
if flags & TEXTURED (0x04):  float32[2] × n_vertices   (UV set 1)
if flags & TEXTURED2(0x80):  float32[2] × n_vertices   (UV set 2 — skipped)

uint16[4] × n_triangles                     (v2, v1, mat_id, v3)

float32[4]  bounding sphere (cx, cy, cz, radius)
uint32      has_positions
uint32      has_normals
if has_positions:  float32[3] × n_vertices  (positions)
if has_normals:    float32[3] × n_vertices  (normals)
```

Notes / gotchas:

- **The `flags` field decides which attribute blocks are present.** Most GTA III
  world geometry is *pre-lit* (baked vertex colours) and has **no normals**;
  vehicle/interior meshes more often carry normals instead.
- **Triangle winding is stored as `(v2, v1, mat_id, v3)`** — note v1/v2 are
  swapped and the material index sits in the middle. The converter re-emits
  them as `(v1, v2, v3)`.
- **`mat_id`** indexes into the Material List, and is what later groups
  triangles into glTF primitives.

### 4b. Materials & texture names

Each **Material** chunk's Struct is 28 bytes:

```
offset  field
  0     uint32  flags
  4     uint8   r, g, b, a       (base colour)
  8     uint32  (unused)
 12     uint32  is_textured      (non-zero ⇒ a Texture child follows)
 16     float32 ambient, specular, diffuse
```

If `is_textured`, the Material contains a **Texture** chunk whose children are
`Struct` (filter/addressing flags), `String` (**texture name**), `String`
(mask name), `Extension`. The converter keeps the base colour and the texture
name (e.g. `"grass_128hv"`).

The output of Step 4 is, per model: vertex positions, optional UVs, optional
per-vertex colours, optional normals, a triangle list tagged by material, and a
material list of `{colour, texture_name}`.

---

## Step 5 — Parse the TXD (texture dictionary)

The model's texture *names* now need pixels. The `.txd` named by the IDE is
read and parsed. A TXD is:

```
Texture Dictionary (0x16)
└─ Texture Native (0x15)   × N       (one per texture)
     └─ Struct (0x01)                (platform + raster header + pixels)
```

Each **Texture Native** Struct (PS2, `platform == 8`) is laid out:

```
offset  field
  0     uint32   platform            (8 = PS2, 9 = PC D3D8)
  4     uint32   filter / addressing flags
  8     char[32] texture name
 40     char[32] mask name
 72     uint32   raster format       (format nibble + palette flag)
 76     uint32   (GS register / unused)
 80     uint16   width               ← little-endian, e.g. 256 = 00 01
 82     uint16   height
 84     uint32   format flags        (low byte = bits-per-pixel)
 88     raster data (CLUT and/or pixels — see per-format below)
```

> **Width/height are `uint16`, not bytes.** Reading them as single bytes works
> for 128 (`0x80 00`) but silently yields 0 for 256 (`0x00 01`), dropping every
> 256×256 texture.

> **The pixel block is preceded by a `uint32` byte-count.** In every format the
> actual pixel data starts *after* a 4-byte size field. Skipping it (reading
> pixels 4 bytes early) shifts the whole image a few pixels to the right —
> barely visible on one texture, but it accumulates into obvious seams where a
> texture tiles across a surface (e.g. text on signs).

GTA III's PS2 textures come in three encodings, distinguished by the
bits-per-pixel byte at offset 84:

### 5a. 8-bpp paletted — PSMT8 (`bpp == 8`)

The common case. A 256-entry colour table (CLUT) followed by one index byte per
pixel:

```
 88            uint32[256]  CLUT           (1024 bytes)
 88 + 1024     uint32       pixel size     (byte count; skip it)
 88 + 1024 + 4 uint8[w×h]   indices        (pixel[i] = CLUT[indices[i]])
```

Each CLUT entry is a little-endian word whose bytes are **R, G, B, A** (red in
the low byte). Alpha is stored 0–128 (PS2 convention) and is scaled to 0–255
(`a = min(255, a × 2)`).

```
entry = 0xAABBGGRR  →  R = entry & 0xFF,  G = (entry>>8)&0xFF,
                       B = (entry>>16)&0xFF,  A = (entry>>24)&0xFF
```

> **The CLUT is stored linearly** — no PS2 "swizzle" reordering is applied.
> (Applying the standard GS 8/16↔16/23 block unswizzle here scrambles these
> particular dictionaries into rainbow noise.)

### 5b. 16-bpp direct — PSMCT16 / 1555 (`bpp == 16`)

Two bytes per pixel, no palette (pixels start at `88 + 4`, after the size
field). The 16-bit word is **B:0-4, G:5-9, R:10-14, A:15** (1-bit alpha):

```
R = ((v >> 10) & 0x1F) × 255/31
G = ((v >>  5) & 0x1F) × 255/31
B = ( v        & 0x1F) × 255/31
A = (v >> 15) ? 255 : 0
```

### 5c. 32-bpp direct — PSMCT32 (`bpp == 32`)

Four bytes per pixel, no palette (pixels start at `88 + 4`, after the size
field), stored **B, G, R, A**. Alpha is 0–128 → ×2.

### The channel-order subtlety

The **paletted CLUT stores R,G,B,A**, but the **direct 16/32-bpp rasters store
B,G,R** — the red and blue channels are in the opposite order between the two
families. Both are decoded to standard RGBA. Getting this wrong is what makes
brown wood look blue, or a red barrel decode as blue.

The result of Step 5 is `{ texture_name → (width, height, RGBA bytes) }`.

---

## Step 6 — Convert the coordinate system

GTA uses a right-handed, **Z-up** world (X = east, Y = north, Z = up). glTF is
right-handed **Y-up**. Every vertex position and normal is rotated −90° about X:

```
(x, y, z)_GTA  →  (x, z, −y)_glTF
```

This is applied by default; `--no-yup` keeps the original Z-up coordinates.

> This transform is *baked into each model's local vertices*. The scene viewer,
> which places these Y-up models using GTA's Z-up instance transforms, has to
> undo and redo this rotation per instance — but that's outside this converter.

---

## Step 7 — Build the glTF 2.0

For each model the converter assembles a `.gltf` (JSON) + `.bin` (binary buffer)
pair:

1. **Buffers/accessors.** Positions (`VEC3` float), UVs (`VEC2` float),
   vertex colours (`VEC4` unsigned-byte, *normalized*), and normals (`VEC3`
   float) are written into the `.bin` and described by accessors. Positions
   carry `min`/`max` (used later for scene bounding boxes).
2. **Indices, grouped by material.** Triangles are bucketed by `mat_id`; each
   bucket becomes one **primitive** with its own index accessor. Indices are
   `UNSIGNED_SHORT`, or `UNSIGNED_INT` when a mesh exceeds 65 535 vertices.
3. **Materials.** Each becomes a `pbrMetallicRoughness` material with
   `baseColorFactor = [r/255, g/255, b/255, a/255]`, `metallic = 0`,
   `roughness = 1`, `doubleSided = true` (GTA winding is inconsistent).
4. **Textures.** Each referenced texture is written once as a PNG under
   `textures/<txd>/<texname>.png` and wired up as a `baseColorTexture` with a
   REPEAT-wrapped, mipmapped sampler. **PNGs are namespaced by their source
   TXD** because the same texture name can appear in different dictionaries with
   different pixels.

A minimal resulting `.gltf` references its buffer and images by relative path:

```json
{
  "asset": {"version": "2.0", "generator": "gta_to_gltf.py"},
  "meshes":  [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 1,
               "COLOR_0": 2}, "indices": 3, "material": 0}]}],
  "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1,1,1,1],
                 "baseColorTexture": {"index": 0}}, "doubleSided": true}],
  "images":  [{"uri": "textures/pjs/grass_128hv.png"}],
  "buffers": [{"uri": "ind_land101.bin", "byteLength": 12345}]
}
```

> Textures requires **Pillow** (`pip install pillow`) to write PNGs. Without it
> the geometry still exports; textures are skipped.

---

## Step 8 — Write outputs and the manifest

Into `./extracted`:

- `<model>.gltf` + `<model>.bin` — one pair per model (flat).
- `textures/<txd>/<tex>.png` — shared, de-duplicated textures.
- `gta3.json` — a manifest nesting every converted model under the folder
  hierarchy of the IDE(s) that referenced it, mapping model name → glTF path:

```json
{
  "data": { "maps": { "comsw": {
    "courthse_night": "courthse_night.gltf",
    "empirestate":    "empirestate.gltf"
  } } }
}
```

For ~3,100 models the run finishes in a few seconds and reports how many
converted, how many were skipped (no `.dff`, or empty geometry), and any
missing textures.

---

## Combined DFFs (weapons, peds, wheels)

A few models aren't in `gta3.img` at all — GTA III bundles them into single
**combined** DFFs in `models/Generic/`:

| File | Contains |
|------|----------|
| `weapons.dff` | all 14 weapon models (ak47, colt45, uzi, …) |
| `peds.dff`    | the pedestrian/character models |
| `wheels.DFF`  | the vehicle wheel models |

These are one clump holding **N geometries** plus **N Atomics**, where each
Atomic binds a **frame** (which carries the model's name) to a geometry:

```
Clump
├─ Frame List           → frame[i] name, e.g. "ak47_l0"
├─ Geometry List        → geometry[0..N-1]
└─ Atomic × N           → Struct: uint32 frame_index, uint32 geometry_index
```

A full run (`python gta_to_gltf.py` with no filters) **auto-splits
`weapons.dff` and `wheels.DFF`**, so the weapons and wheels are produced
without any extra step. The `--combined` flag splits any given combined DFF
explicitly — use it for `peds.dff` or custom files:

```
python gta_to_gltf.py --combined models/Generic/peds.dff
```

Either way, one glTF is written per model, named from its frame (with the
`_l0` LOD suffix stripped → `ak47.gltf`). Where two atomics share a frame name
(e.g. a lo/hi wheel pair) the duplicate gets a numeric suffix (`wheel_alloy`,
`wheel_alloy_1`).

Two wrinkles versus normal models:

- **Naming** comes from the atomic's frame, not an IDE — the converter reads
  the Frame List names and the Atomic `frame→geometry` mapping.
- **Textures are scattered.** A combined model's textures live across many
  different TXDs (e.g. `ak47_all` in `rifle.txd`, `colt_all` in `colt1.txd`),
  so instead of one named TXD the converter builds a **global texture pool** —
  it indexes every texture name across all dictionaries (names only, no pixel
  decode), then decodes the one holding each needed texture on demand.

Combined models are written as flat `<name>.gltf` like any other, and each is
merged into `gta3.json` (under its source file's folder, e.g.
`models/generic/weapons`) so they're browsable in the model viewer.

---

## Multi-part models (vehicles, the subway train)

Combined DFFs *split* one clump into many independent models. A **vehicle** is
the opposite: its many atomics are *parts of one object* — a high-detail body
plus separately-framed doors, bonnet, bumpers, windscreen — positioned by the
**frame hierarchy**, not baked into each part's vertices. Every GTA III car is
built this way (a Cheetah has 18 atomics, a coach 21), as is the subway
`train`. Exporting only the first geometry (fine for a single-atomic static
object) yields a *fragment* — one car door, or the train's single door.

So the converter **picks its strategy per DFF automatically** (`parse_dff_model`):

- **1 atomic** → `parse_dff` (take the geometry, as before — the ~3000 static
  world objects are unchanged).
- **>1 atomic** → `parse_dff_assembled` — merge all parts into one mesh.

This needs no flags: a plain `python gta_to_gltf.py` run assembles every
multi-part model, textured from its own IDE TXD like any other model. There is
also an explicit `--assemble MODEL…` (archive name or `.dff` path) for
one-offs.

How assembly works:

1. **Group atomics by logical part.** RenderWare packs a part's variants as
   separate atomics that differ only by a name suffix: `_L0`/`_L1`/`_L2` (LOD
   level), `_hi`/`_lo`/`_vlo` (detail), `_ok`/`_dam` (damage state). Stripping
   that suffix gives the *base* part name. In each group only the **highest-
   detail, undamaged** variant is kept — so `chassis_hi` beats `chassis_vlo`,
   `railtrax_straight_L0` beats `…_L1`, and every `…_dam` is dropped.
2. **One part vs. many.** The base-name grouping is what tells the two cases
   apart:
   - **A single base** means the whole DFF is *one mesh* shipped only as LODs —
     a rail-track piece is `railtrax_straight_L0` + `…_L1`. It's emitted at the
     object origin like any single-atomic object; the per-atomic frame offset on
     LOD variants (the mirrored ±9 m the two levels sit at in the editor) is
     **not** applied — applying it is what doubled and shifted the elevated
     train tracks on Portland.
   - **Several bases** means a genuine composite (a vehicle: `chassis`, `door_lf`,
     `bonnet`, `bump_front`, …). The parts are merged, each transformed up its
     **frame parent chain** into model space (offsetting vertex + material
     indices). Note a car part's *own* frame is usually identity — the door's
     position comes from its parent dummy frame — so the whole chain matters.
3. **Frame transforms.** The Frame List Struct is `uint32 count` then
   `count × 56` bytes per frame: `float32 rot[9]` (the RenderWare basis vectors
   right/up/at, as columns), `float32 pos[3]`, `int32 parent`, `int32 flags`.
   A point is walked `world = rot · v + pos` up each parent to the root; normals
   use the rotation only.

So a Cheetah keeps `chassis_hi`, `door_lf_hi_ok`, `bonnet_hi_ok`, … (9 parts,
merged with transforms) and drops `chassis_vlo` + every `…_dam`; the train keeps
`chassis_hi` + `door_lhs_hi` + `door_rhs_hi` (3 parts) and drops `chassis_vlo`;
a `railtrax_*` piece keeps just its `_L0` mesh at the origin.

> Vehicle **wheels** aren't in the car DFF — GTA III attaches a wheel model
> from `wheels.DFF` at each wheel dummy frame at runtime — so an assembled car
> body has no wheels, which is expected. Car bodies are also mostly untextured:
> the flat paint colour comes from the material's base colour (the game tints
> it per-car), with textures only on glass and details.

---

## Appendix — format quick reference

| Thing | Value |
|-------|-------|
| Archive sector size | 2048 bytes |
| DIR entry | `uint32 offset_sectors, uint32 size_sectors, char[24] name` |
| RW chunk header | `uint32 type, uint32 size, uint32 version` (12 bytes) |
| DFF path | Clump → GeometryList → Geometry → Struct + MaterialList → Material → Texture |
| Geometry flags | `POSITIONS 0x02, TEXTURED 0x04, PRELIT 0x08, NORMALS 0x10, TEXTURED2 0x80` |
| Triangle record | `uint16 v2, v1, mat_id, v3` |
| TXD path | TexDictionary → TextureNative → Struct |
| TexNative dims | `uint16 width @80, uint16 height @82, bpp = byte @84` |
| Pixel block | preceded by a `uint32` size field (8-bpp: after the 1024-byte CLUT) — skip it |
| PSMT8 CLUT byte order | R, G, B, A (red low) — **no unswizzle** |
| 16/32-bpp byte order | B, G, R (, A) |
| PS2 alpha | 0–128 → scale ×2 to 0–255 |
| Coordinate transform | `(x, y, z) → (x, z, −y)` (Z-up → Y-up) |
