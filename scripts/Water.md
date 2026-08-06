# GTA III water.dat → Water

How `water.py` extracts GTA III's water surface from `data/water.dat` into
`extracted/water.json` (+ the water texture), and how the scene viewer draws it.

Like pickups (`Pickups.md`) and transit (`Paths.md`), water is a **full-city
overlay** — a "Show Water" checkbox that appears once the whole city is loaded.

---

## Overview

```
 data/water.dat ──► parse rectangles ──► extracted/water.json
 models/particle.txd ──► water_old ───► extracted/water_old.png
                                              │
                                              ▼
                              scene viewer: tiled textured quads
```

Run it after the models have been converted (it reuses `gta_to_gltf.parse_txd`
for the texture):

```
python water.py            # data/water.dat + models/particle.txd → extracted/
```

---

## Step 1 — The `water.dat` format

`data/water.dat` is a plain-text table. Each data row is one axis-aligned
rectangle of water:

```
<level>  <xLeft>  <yBottom>  <xRight>  <yTop>
```

- **`level`** is the water height in GTA world **Z**. Most rows are `0.0` (sea
  level); a cluster is `63.2` — the elevated Cochrane Dam reservoir.
- The other four are the rectangle's extent in the GTA X/Y ground plane.

The file is lightly irregular, so the parser is forgiving:

- lines starting with `;` are comments;
- a line starting with `*` is the end-of-file marker (`* ;end of file`);
- the column delimiter is inconsistent — commas **and** tabs, and one row is
  whitespace-only — so we split each row on any run of commas/whitespace and
  take the first five numbers.

This dump yields **32 rectangles** at levels `{0.0, 63.2}`.

---

## Step 2 — The water texture

GTA III's water surface texture is **`water_old`** (128×128, fully opaque),
found in `models/particle.txd`. `water.py` decodes it (via the TXD parser from
`Extraction.md`) and writes `extracted/water_old.png` so the viewer can tile it.

Because `water_old` isn't referenced by any world model, the main extractor's
per-model texture pass never emits it — `gta_to_gltf.py` leaves it alone
entirely, and `water.py` is the only script that produces it. It pulls the
single texture out via `txd_common.extract_one`, which is non-fatal: if
`particle.txd` is missing the run still writes `water.json` and just warns
about the texture.

(`gta_to_gltf.py` used to emit this file too, via a `LOOSE_TEXTURES` allowlist,
so a full pipeline run wrote it twice. That allowlist has been removed and
`water.py` now owns the texture outright.)

---

## Step 3 — Output: `water.json`

```json
{
  "water": [
    { "level": 0.0, "xLeft": 372.0, "yBottom": -2239.0, "xRight": 767.0, "yTop": -84.0 },
    …
  ]
}
```

Coordinates are raw GTA world space (Z-up); the viewer applies the same
Z-up→Y-up transform it uses for everything else (`Render.md`).

---

## Step 4 — Viewer overlay

In the scene viewer a **"Show Water"** checkbox appears in the header once the
**full city** is loaded (water is a city-wide overlay, not per-district). When
ticked, the viewer builds one horizontal textured quad per rectangle:

- The quad sits at world height `level` and spans the rectangle in X/Y. GTA
  `(x, y, z)` → viewer `(x, z, −y)`, so a `level`-Z rectangle becomes a flat
  plane at viewer Y = `level`.
- The `water_old` texture is **tiled**, not stretched: UVs are world position
  divided by `WATER_TILE` (40 units per repeat, in `scene-renderer.js`), with
  the texture set to `REPEAT` wrap. Tune `WATER_TILE` to change the wave scale.
- Rendered opaque (the texture has no alpha) with lighting off, in the normal
  depth-tested pass, so land correctly occludes/pokes through the surface.

All the rectangles share one vertex buffer and one draw call.
