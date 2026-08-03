# GTA III Paths → Transit

How `paths.py` turns GTA III's animation-path files into `extracted/paths.json`,
and how the scene viewer animates planes and trains along them.

GTA III drives its ambient transit — the planes leaving Francis International and
the two trains circling the tracks — along fixed coordinate paths in
`data/paths/`. Unlike world geometry (IPL, see `Render.md`) these are plain
lists of waypoints the engine steps a vehicle through.

---

## Step 1 — The path files

Six files, one format:

| File | Runs | Key |
|------|------|-----|
| `flight.dat` `flight2.dat` `flight3.dat` `flight4.dat` | `airtrain` (plane) | `flight`, `flight2`, … |
| `tracks.dat` `tracks2.dat` | `train` | `track`, `track2` |

Each is trivial text:

```
<count>        ← first line: how many waypoint lines follow
x y z          ← one waypoint per line (space-separated), the next step
x y z            along the path
…
```

Coordinates are **GTA world space** (right-handed, Z-up) — exactly the space the
IPL placements use — so no conversion happens here; the viewer applies the same
Z-up→Y-up transform it uses for every other instance (`Render.md` Step 5).

---

## Step 2 — `paths.py`

```
python paths.py                 # data/paths + extracted/ → extracted/paths.json
python paths.py --speed 150     # tune the animation speed
```

It reads each file (the declared count is authoritative — trailing blank/extra
lines are ignored, a short file is reported), maps it to its model and key, and
writes:

```json
{
  "track":  { "model": "train.gltf",    "paths": [[x,y,z], …], "speed": 250 },
  "flight": { "model": "airtrain.gltf", "paths": [[x,y,z], …], "speed": 250 }
}
```

`speed` is the milliseconds between successive waypoints (uniform 250 for now,
easy to tune later — globally via `--speed`, or per-path by editing the JSON).

A run reports, e.g.:

```
  OK    track    train.gltf       168 waypoints
  OK    flight   airtrain.gltf    105 waypoints
Paths: 6
```

---

## Step 3 — Viewer overlay

A **"Show Transit"** checkbox appears in the scene-viewer header once the **full
city** is loaded (transit is a city-wide overlay, like "Show Pickups"). When
ticked, the viewer fetches `paths.json` and, for each path, loads its model once
(shared: one `train`, one `airtrain`) and adds a single moving instance.

The animation is driven by the render loop, not a timer, and moves at a
**constant velocity** along the looped polyline. The waypoints are very
unevenly spaced — on `flight.dat` one segment is 0.78 units and another 490
(and `flight4` has a 3500-unit segment) — so spending a fixed `speed` ms *per
segment* made the plane lurch: crawling through tightly-spaced turns, rocketing
down the long runway leg. Instead each vehicle precomputes its segment lengths
and total length once, and travels at `velocity = total / (n · speed)` world
units per ms, crossing waypoint boundaries as needed. The whole loop still
takes `n · speed` ms (so `speed` is the *mean* ms per segment and still sets the
overall pace), but the speed no longer jumps between segments. The fly-speed
slider only affects the camera, not transit.

Each vehicle also **yaws to face its direction of travel**: the model's forward
axis is GTA +Y (the fuselage / carriage length — the plane's nose is at +Y), so
the heading is `atan2(-dx, dy)` of the current segment, applied as a rotation
about the GTA up-axis (Z) through the same per-instance transform as scene
models. A zero-length segment (duplicate waypoints) keeps the previous heading.

> Trains are symmetric front-to-back so their facing looks right either way;
> the plane's nose-at-+Y is confirmed from the model geometry. Pitch is not
> applied — climbing planes stay level — which reads fine from a distance; add
> pitch from the segment's `dz` if a steeper look is wanted.

### Riding the path by the belly, not the origin — `groundOffset`

A path point positions the model's **local origin** (GTA `0,0,0`). The airtrain's
origin sits ~4 units *above* its belly (its verts span Z `−4 → +7.8`), so placing
the origin on the runway height drove the lower third of the plane underground —
in places only the tail fin showed.

The fix is a per-path **`groundOffset`** (in `paths.json`, written by `paths.py`)
that the renderer adds to each waypoint's Z, raising the model so it rests on the
surface:

```json
"flight": { "model": "airtrain.gltf", "paths": […], "speed": 400, "groundOffset": 11.0 }
```

It's per-path — not computed from the model — because the airport's two runways
sit at different heights relative to their stored path Z:

| paths | groundOffset | why |
|-------|-------------|-----|
| `track`, `track2` (trains) | `0.2` | train origin is only 0.2 above its wheels |
| `flight2`, `flight3`, `flight4` | `4.0` | plane origin is ~4 above its belly; these runways sit at their path Z |
| `flight` | `11.0` | takes off **and** lands on the airport's left runway, whose tarmac is ~7 units higher than the path's stored Z, so 4 alone still sank it |

Verified in the viewer by parking the plane on the affected runway: at `4` the
engine nacelles were buried in the tarmac; at the tuned value they clear it and the plane
rests on the deck.
