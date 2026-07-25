# GTA III SCM → Pickups

How `scm_to_pickups.py` extracts pickup placements from GTA III's mission
script and writes `extracted/pickups.json`, and how the scene viewer overlays
them.

Unlike models (`Extraction.md`) and world placement (`Render.md`), pickups are
**not** in the IPL files — their `pick` sections are empty. GTA III creates
pickups at load time from the compiled mission script `data/main.scm`, so we
have to read the bytecode.

---

## Overview

```
 data/main.scm ─► scan for pickup opcodes ─► validate ─► map model → glTF
                                                             │
                                                             ▼
                                              extracted/pickups.json
```

Each pickup is a model id + a world position. The script disassembles just
enough of the SCM to read the two pickup-creation opcodes, validates each
match, resolves the model id to a name, and writes `{model, gltf, x, y, z}`.

Run it after the models have been converted:

```
python scm_to_pickups.py            # data/main.scm + extracted/ → extracted/pickups.json
```

---

## Step 1 — The SCM instruction format

`main.scm` is a stream of instructions. Each begins with a **2-byte opcode**
(little-endian). Then come arguments, and — crucially — **every argument is
self-describing**: a 1-byte data type followed by its value.

```
data type   value
  0x01      int32   (4 bytes)
  0x02      global variable index (u16)
  0x03      local  variable index (u16)
  0x04      int8    (1 byte)
  0x05      int16   (2 bytes)
  0x06      float
```

> **GTA III stores SCM floats as 16-bit fixed-point** (`value = int16 / 16`).
> That's why Liberty City's ±2048 world fits in an int16 — and it's why a
> pickup at `20.5625` is stored as `329` (`329/16 = 20.5625`). Vice City later
> switched to IEEE 32-bit floats.

---

## Step 2 — The pickup opcodes

Three opcodes place the world pickups:

```
0213  CREATE_PICKUP            model, type,        X, Y, Z, →handle
032B  CREATE_PICKUP_WITH_AMMO  model, weaponId, ammo, X, Y, Z, →handle
02EC  put_hidden_package_at    X, Y, Z             (100 hidden packages)
```

`02EC` is the outlier: it takes only three coordinate floats — the model is
hardcoded to the collectable. That model isn't in this archive, so the packages
are rendered with the `package1` mesh (the wrapped-parcel icon). This is also
why no `create_pickup` uses the COLLECTABLE type — packages are a separate
opcode.

`model` is a model id (an integer literal), `type` is the pickup type
(1–15: on-street, once, collectable, …), the coords are floats, and the last
argument is a variable that receives the pickup handle.

Example (`032B`, from the opcode reference):

```
032B: $602 = create_weapon_pickup #AK47 14 ammo 60 at 1249.0 -858.4999 20.5625
```

— an AK47 pickup (model id 171) with 60 rounds at `(1249.0, -858.5, 20.5625)`.

---

## Step 3 — Scanning safely (avoiding false positives)

A full disassembly would need GTA III's entire opcode table (which arg count
each of ~1000 opcodes takes). Instead this uses a **validated scan**: it looks
for the two opcode byte-patterns and, at each hit, parses the arguments using
the self-describing type bytes.

The catch: the opcode bytes (`13 02`, `2B 03`) also occur **mid-instruction**
(e.g. an int8 value `0x13` followed by a global-var type byte `0x02`), so a raw
scan yields many false hits. Three checks reject them:

1. **The arguments must parse** with valid data-type bytes in the expected
   shape (`int, int, float, float, float, var`).
2. **The coordinates must be inside the map** (roughly ±2048), and the pickup
   type in range.
3. **The model id must resolve to a real model name** (from the IDE files,
   `Extraction.md` Step 3).

Check 3 is the decisive one — a stray `13 02` almost never has a following
value that is simultaneously a valid model id *and* is followed by three
in-range floats. This cleanly separates the ~80 real pickups from the noise.

---

## Step 4 — Model → glTF, and the weapon-mesh caveat

Each pickup's model id is mapped to its name via the IDEs, then to
`"<name>.gltf"` **if that model was converted**. GTA III's world pickups are
all **weapons** (`colt45`, `uzi`, `ak47`, `shotgun`, …). Their meshes aren't in
`gta3.img` — they're bundled in `models/Generic/weapons.dff`, which
`gta_to_gltf.py --combined` splits into per-weapon glTFs (see `Extraction.md`).
Once that's run, every pickup resolves to a real weapon glTF.

> Health/armour/hidden-package pickups don't appear: their icon model ids
> (1361–1392) are never referenced as literals in the script — GTA III places
> them by other means (data tables / engine defaults), out of scope here.

---

## Step 5 — Output: `pickups.json`

A flat array of pickups, each with the model name, resolved glTF (or `null`),
and the raw GTA world position (Z-up — the viewer applies the same
Z-up→Y-up + quaternion transform as scene instances, `Render.md` Step 5):

```json
[
  { "model": "colt45", "gltf": null, "x": 1068.5,  "y": -400.75, "z": 15.1875 },
  { "model": "ak47",   "gltf": null, "x": 342.5,   "y": -713.0,  "z": 26.375  }
]
```

A run reports, e.g.:

```
Pickups: 78   with glTF: 0   without: 78
By model: {'colt45': 8, 'uzi': 8, 'ak47': 9, ...}
```

---

## Step 6 — Viewer overlay

In the scene viewer a **"Show Pickups"** checkbox appears in the header once the
**full city** is loaded (pickups are a city-wide overlay, not per-district).
When ticked, the viewer fetches `pickups.json` and places each pickup:

- The pickup's model glTF is drawn at its location (the weapon models, once
  `weapons.dff` has been split — see `Extraction.md`).
- If a model has no glTF, a **stand-in marker** (the `bonus` model, the GTA III
  logo) is drawn instead so the spawn point is still visible.

Markers reuse the scene renderer's model cache and the same per-instance
transform (pickups have no rotation, identity quaternion), scaled up a few times
so they're findable in the full-city view.

---

## Appendix — quick reference

| Thing | Value |
|-------|-------|
| Pickup source | `data/main.scm` (IPL `pick` sections are empty) |
| Opcodes | `0213` CREATE_PICKUP, `032B` CREATE_PICKUP_WITH_AMMO, `02EC` put_hidden_package_at |
| Arg encoding | 1 type byte + value (`01`=i32 `04`=i8 `05`=i16 `06`=float `02/03`=var) |
| Float format | 16-bit fixed point (`int16 / 16`) |
| False-positive filter | args parse + coords in map + model id resolves to a name |
| Coordinates | GTA Z-up, stored raw (viewer converts, per `Render.md`) |
| Result (this dump) | 312 pickups — 78 weapons, 134 static (health/armour/adrenaline/info/bribe), 100 hidden packages |
