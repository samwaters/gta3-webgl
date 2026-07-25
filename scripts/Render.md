# GTA III IPL → Scene

How `ipl_to_scene.py` reads the game's placement files and produces
`extracted/scene.json` — a flat list of model instances (position, rotation,
scale, and the glTF to draw) organised by district. This document also covers
the coordinate/rotation math needed to actually *place* each instance, since
that's where the subtle bugs live.

It assumes the models have already been converted (see `Extraction.md`); it does
**not** cover the WebGL renderer itself.

---

## Overview

`gta_to_gltf.py` gives us the *models*. The **IPL** (Item PLacement) files say
*where each one goes*. An IPL's `inst` section is a list of placements: for a
given model ID, a world position, a scale, and a rotation quaternion.

The job of `ipl_to_scene.py` is:

```
 data/**/*.ipl ─► pick the right IPLs ─► parse `inst` ─► drop LODs
                                                            │
                                                            ▼
                                     map model → <name>.gltf
                                                            │
                                                            ▼
                                        extracted/scene.json
```

Three things make this non-trivial, and each has its own step below:

1. **The wrong IPLs are on disk.** There are dev leftovers and duplicates that
   the shipped game never loads; including them double-places or misaligns
   geometry.
2. **LOD models must be dropped** — and some are named in a non-obvious way.
3. **The rotation quaternion needs conjugating**, and the whole scene needs a
   Z-up → Y-up conversion to line up with the converted models.

Run with no arguments:

```
python ipl_to_scene.py            # gta3.dat scene, LODs removed → extracted/scene.json
python ipl_to_scene.py --all      # every IPL on disk (adds the leftovers)
python ipl_to_scene.py --keep-lod # keep LOD models
```

---

## Step 1 — The IPL `inst` format

IPLs are plain text with named sections closed by `end`. Several sections exist
(`inst`, `cull`, `pick`, `path`, …); only **`inst`** is used — the others are
cull zones, pickups, and AI paths, which don't place visible models.

> Files use Windows **CRLF** line endings; strip `\r` (or use a tolerant text
> read) or the section keywords won't match.

Each `inst` line in GTA III has exactly **12 comma-separated columns**:

```
ID, ModelName, PosX, PosY, PosZ, ScaleX, ScaleY, ScaleZ, RotX, RotY, RotZ, RotW
```

**Example** (`data/maps/comsw/comSW.ipl`):

```
inst
1585, courthse_night, 97.2695, -1429.18, 39.5732, 1, 1, 1, 0, 0, 0, 1
1115, rd_tjunction22,  41.8152, -1611.43, 24.9782, 1, 1, 1, 0, 0, -1, 0
end
```

Reading of the columns:

- **ID** — the model definition id (matches the IDE; **not** a unique instance
  id — the same model appears many times with the same id).
- **ModelName** — the model to place (`courthse_night` → `courthse_night.gltf`).
- **Pos** — world position, in GTA's right-handed **Z-up** space.
- **Scale** — per-axis scale (almost always `1,1,1`).
- **Rot** — a **quaternion** `(x, y, z, w)`. `0,0,0,1` is identity; the second
  line above (`0,0,-1,0`) is a 180° turn about the vertical axis.

> **There are no "flag" columns in GTA III.** The interior-id and LOD-index
> fields that some tools expect only exist in Vice City / San Andreas IPLs. GTA
> III `inst` is pure transform data.

---

## Step 2 — Choosing which IPLs to load

This is the biggest source of "the map looks wrong" problems.

### 2a. Discovery and duplicate resolution

All `*.ipl` under `data/` are found recursively. Many exist **twice** — a copy
directly in `data/maps/` and the "real" one in a subdirectory next to its IDE:

```
data/maps/comNbtm.ipl              ← top-level copy
data/maps/comnbtm/comNbtm.ipl      ← subdir copy (next to comnbtm.ide)
```

Both map to the same logical district (`data › maps › comnbtm`). They differ
only in minor edits, so keeping both double-places that district. The resolver
keys each IPL by its folder path (lower-cased, collapsing a repeated component
like `comnbtm/comnbtm`), and when two collide it **prefers the copy sitting next
to a matching `<stem>.ide`** (the subdirectory one), breaking ties by deeper
path.

### 2b. The `gta3.dat` load set (the authoritative scene)

`data/gta3.dat` is the game's own load manifest. Its `IPL` lines are the
*only* placement files the shipped game actually loads:

```
IPL DATA\MAPS\COMNtop\COMNtop.IPL
IPL DATA\MAPS\COMNbtm\COMNbtm.IPL
IPL DATA\MAPS\COMSE\COMSE.IPL
IPL DATA\MAPS\COMSW\COMSW.IPL
IPL DATA\MAPS\CULL.IPL                 (cull zones — no `inst`)
IPL DATA\MAPS\INDUSTNE\INDUSTNE.IPL
IPL DATA\MAPS\INDUSTNW\INDUSTNW.IPL
IPL DATA\MAPS\INDUSTSE\INDUSTSE.IPL
IPL DATA\MAPS\INDUSTSW\INDUSTSW.IPL
IPL DATA\MAPS\LANDne\LANDne.IPL
IPL DATA\MAPS\LANDsw\LANDsw.IPL
IPL DATA\MAPS\overview.IPL
IPL DATA\MAPS\props.IPL
```

By default `ipl_to_scene.py` parses `gta3.dat`, and keeps only IPLs whose stem
is in that list — **13 files (12 with instances)**, out of ~20 on disk. `--all`
disables this filter.

### 2c. The leftover dev IPLs (why they're excluded)

The IPLs on disk that `gta3.dat` does **not** load are development leftovers,
and each causes a visible artefact if included:

| Leftover IPL(s) | Problem if loaded |
|-----------------|-------------------|
| `comroad`, `indroads`, `subroads` | Standalone road layouts. The real roads are already baked into the district IPLs (e.g. `landne` alone has ~200 road pieces); these are redundant, differently-positioned copies → **roads in mid-air / misaligned road textures**. |
| `suburbne`, `suburbsw` | Near-identical duplicates of `landne` / `landsw` (same Shoreside instances) → **everything in Shoreside placed twice**, z-fighting. |
| `making`, `temppart` | "Making of" / temp-party test areas, not part of the live map. |

Confirming they're redundant: the road model `rd_SrRoad3A50` sits in both
`comroad.ipl` *and* the district IPLs at different positions; the dam pods
appear in both `landne` and `suburbne` at *identical* positions. Following
`gta3.dat` sidesteps all of it.

---

## Step 3 — Filtering out LOD models

**Why.** GTA III ships a low-detail "LOD" stand-in for most objects. In-game the
engine shows the LOD from far away and swaps to the full-detail model up close —
only ever one at a time. We load the *entire* IPL at once, so the swap never
happens: the LOD and its real counterpart occupy the same space and **z-fight**,
and the crude LOD ground planes poke through the real geometry.

So every LOD placement is dropped (`--keep-lod` disables this).

**Identifying them — two naming conventions.** This is the non-obvious part.
GTA III has *two* kinds of LOD, named differently:

1. **Per-object LODs** — the model's name has its **first three characters
   replaced with `LOD`** (not prefixed). Examples:

   | Real model | LOD model |
   |------------|-----------|
   | `tenement1ad` | `LODement1ad` |
   | `underground_over9` | `LODerground_over9` |
   | `hotel_tenemant1` | `LODel_tenemant1` |
   | `dam_pod1` | `lod_pod1` |

   These all *start* with `lod`, so `name.startswith('lod')` catches them.

2. **Island silhouettes** — the giant, single low-poly meshes that represent a
   whole district from across the water. These are named
   **`islandLOD<district>`**: `islandlodind`, `islandlodcomind`,
   `islandlodsubcom`, `islandlodsubind`, `islandlodcomsub`. Here `lod` is in the
   **middle**, so a `startswith` test misses them — and they render as
   district-sized low-detail planes laid over the real city (a flat grey slab
   across the road, buildings sunk into the ground with blurry textures).

**The filter.** Because of case 2, the test is **`'lod' in name`** (substring),
not a prefix check. Verified across the entire model set, the only names
containing the substring `lod` are these two LOD families — there are **no false
positives** (no real model like "flood" or "melody"). In the default run this
drops **~970 instances**.

> A useful cross-check: LOD models carry a large IDE draw distance (median
> ~800) versus ~200 for real models — consistent with "only drawn from afar."

---

## Step 4 — Map each model to its glTF

For every surviving instance, the model name maps to `"<name>.gltf"` **if that
file exists** in the output directory (checked against the actual converted
`.gltf` files). Instances whose model has no glTF (e.g. `airpshadows01` — a
model with no `.dff`) get `gltf: null` so the data stays faithful; a renderer
skips them. In practice all but one instance resolve.

Paths are stored relative to the manifest (the glTFs sit flat beside
`scene.json`), so the value is simply `"<name>.gltf"`.

---

## Step 5 — Placing an instance (coordinate & rotation math)

`scene.json` stores the IPL transform **verbatim** — GTA's Z-up position, raw
scale, and the raw quaternion. Turning that into a correct placement requires
two conversions. (These are applied when drawing; they are documented here
because this is where the placement bugs were, and any consumer of `scene.json`
must apply them.)

### 5a. Z-up → Y-up

GTA's world is right-handed **Z-up**; the converted glTF models were baked to
**Y-up** (`Extraction.md`, Step 6) via a −90° rotation about X:

```
Rconv:  (x, y, z) → (x, z, −y)
```

Because each model's *local* vertices were already rotated by `Rconv`, an
instance's transform has to un-rotate to GTA-local, apply the GTA placement,
then re-apply `Rconv` to view the whole world Y-up. As a single matrix per
instance:

```
M = Rconv · T(pos) · R(quat) · S(scale) · Rconv⁻¹
```

- `T(pos)` — translate by `(x, y, z)`
- `R(quat)` — rotate by the (conjugated — see below) quaternion
- `S(scale)` — scale by `(sx, sy, sz)`
- `Rconv` / `Rconv⁻¹` — the ±90°-about-X change of basis

A vertical (Z-axis) rotation in GTA correctly becomes a vertical (Y-axis)
rotation in the viewed scene, so buildings stay upright and level.

### 5b. The rotation quaternion must be **conjugated**

GTA III's IPL stores the placement rotation such that the engine applies its
**conjugate** — i.e. negate the vector part, keep `w`:

```
(rx, ry, rz, rw)  →  R(−rx, −ry, −rz, rw)
```

Using the quaternion as-is **inverts** every rotation about the vertical axis,
which swaps `+90°` and `−90°`. That's invisible on 180°-symmetric pieces
(straight road segments, boxy buildings), so the map looks *mostly* right — but
it flips every **asymmetric** piece: corners, curves, T-junctions and angled
segments come out rotated 90°, so roads don't line up. Conjugating fixes it.
(This matches how community IPL importers such as DragonFF handle GTA III.)

> This is the one gotcha that looks like a modelling error but isn't — the
> geometry and positions are fine; only the rotation sense is wrong without the
> conjugate.

---

## Step 6 — Output: `scene.json`

The manifest nests every instance under the folder hierarchy of its IPL,
mirroring `gta3.json`, with each district holding an **array** of instances:

```json
{
  "data": { "maps": { "comsw": [
    {
      "id": 1585, "name": "courthse_night", "gltf": "courthse_night.gltf",
      "x": 97.2695, "y": -1429.18, "z": 39.5732,
      "sx": 1, "sy": 1, "sz": 1,
      "rx": 0, "ry": 0, "rz": 0, "rw": 1
    }
  ] } }
}
```

A default run reports something like:

```
IPLs:     20 on disk → 13 in the gta3.dat game scene (use --all for everything)
Instances: 7,716   with glTF: 7,715   no glTF: 1   LOD dropped: 973
```

Because the filtering (right IPL set, no LODs) happens here at the **data**
level, `scene.json` is self-consistent: any renderer can load it and draw the
right set of objects without re-implementing these rules. (The one thing a
renderer must still do is apply the Step 5 coordinate/rotation math.)

---

## Appendix — gotchas quick reference

| Gotcha | Resolution |
|--------|------------|
| CRLF line endings | Strip `\r` before matching section keywords |
| Only `inst` places models | Ignore `cull` / `pick` / `path` / … |
| No flag/interior columns in GTA III | `inst` is 12 columns, pure transform |
| Duplicate IPLs (top-level vs subdir) | Prefer the copy next to a matching `.ide` |
| Dev-leftover IPLs (`*road*`, `suburb*`, `making`, `temppart`) | Not in `gta3.dat`; exclude by default |
| Per-object LODs | First 3 chars replaced with `LOD` → start with `lod` |
| Island-silhouette LODs | `islandLOD…` — `lod` in the middle; use *substring* match |
| LOD filter | `'lod' in name` — no false positives across the model set |
| Rotation looks 90° off on corners | Conjugate the quaternion `(−x, −y, −z, w)` |
| Models are Y-up, IPL is Z-up | Per-instance `M = Rconv · T · R · S · Rconv⁻¹` |
| `id` is a model id, not an instance id | Same id repeats across placements |
