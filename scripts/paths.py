#!/usr/bin/env python3
"""
paths.py  —  Convert GTA III animation path files to paths.json

GTA III drives its ambient transit — planes leaving the airport and the two
subway/overground trains circling the tracks — along fixed coordinate paths in
`data/paths/`:

  flight.dat  flight2.dat  flight3.dat  flight4.dat   → the airport planes
  tracks.dat  tracks2.dat                             → the trains

Every file has the same trivial format:

    <count>            ← first line: number of coordinate lines that follow
    x y z              ← one waypoint per line (space-separated), the next
    x y z                step along the path
    …

Coordinates are GTA world space (right-handed, Z-up) — the same space as the
IPL placements — so the scene viewer applies the same Z-up→Y-up transform when
it draws them (see Render.md).

This writes `extracted/paths.json`, mapping each path to the model that runs it,
its ordered waypoints, and an animation speed (ms between waypoints):

    {
      "track":  { "model": "train.gltf",    "paths": [[x,y,z], …], "speed": 250 },
      "flight": { "model": "airtrain.gltf", "paths": [[x,y,z], …], "speed": 250 }
    }

Usage:
  python paths.py                       # data/paths + extracted/ → extracted/paths.json
  python paths.py --paths-dir X -o Y
"""

import argparse
import json
import sys
from pathlib import Path

# file → (json key, model, ground_offset).
#
# ground_offset raises the model along GTA Z so it rests on the surface instead
# of riding the path by its (mid-height) origin.  A model's origin sits above
# its belly/wheels — ~4 units for the airtrain, ~0.2 for the train — so that is
# the base offset.  Planes fly airtrain; both track files run train.
#
# `flight` takes off *and* lands on the airport's left runway, whose tarmac is
# ~7 units higher than that path's stored Z, so it needs a larger offset (≈11) to
# keep the wheels on the deck.  The other runways sit at their path height, so
# the plain 4 works there.
PATH_FILES = [
    ('flight.dat',  'flight',  'airtrain', 11.0),
    ('flight2.dat', 'flight2', 'airtrain', 4.0),
    ('flight3.dat', 'flight3', 'airtrain', 4.0),
    ('flight4.dat', 'flight4', 'airtrain', 4.0),
    ('tracks.dat',  'track',   'train',    0.2),
    ('tracks2.dat', 'track2',  'train',    0.2),
]

# Animation speed: milliseconds between successive waypoints.  Kept uniform for
# now (easy to tune per-path later).
DEFAULT_SPEED = 400


def parse_path_file(path: Path) -> list[list[float]]:
    """Read a .dat path file → list of [x, y, z] waypoints.

    Line 1 is the waypoint count; each following line is 'x y z'.  The declared
    count is authoritative — trailing blank lines or a stray extra line are
    ignored, and a short file is reported rather than silently truncated.
    """
    lines = [ln.strip() for ln in path.read_text(errors='replace').splitlines()]
    lines = [ln for ln in lines if ln]                 # drop blanks
    if not lines:
        raise ValueError('empty file')
    count = int(lines[0])
    coords = []
    for ln in lines[1:1 + count]:
        parts = ln.split()
        if len(parts) < 3:
            raise ValueError(f'bad waypoint line: {ln!r}')
        coords.append([float(parts[0]), float(parts[1]), float(parts[2])])
    if len(coords) != count:
        raise ValueError(f'expected {count} waypoints, read {len(coords)}')
    return coords


def main() -> None:
    root = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description='Convert GTA III path files to paths.json')
    ap.add_argument('--paths-dir', default=str(root / 'data' / 'paths'),
                    help='Directory of .dat path files (default: data/paths)')
    ap.add_argument('-o', '--output', default=str(root / 'extracted'),
                    help='Output directory (default: ./extracted)')
    ap.add_argument('--speed', type=int, default=DEFAULT_SPEED,
                    help=f'ms between waypoints (default: {DEFAULT_SPEED})')
    args = ap.parse_args()

    paths_dir = Path(args.paths_dir)
    out_dir   = Path(args.output)
    if not paths_dir.exists():
        sys.exit(f'Error: paths directory not found: {paths_dir}')
    out_dir.mkdir(parents=True, exist_ok=True)

    result: dict = {}
    for fname, key, model, ground_offset in PATH_FILES:
        fpath = paths_dir / fname
        if not fpath.exists():
            print(f'  MISSING  {fname}')
            continue
        try:
            coords = parse_path_file(fpath)
        except (ValueError, OSError) as exc:
            print(f'  ERROR    {fname}: {exc}')
            continue
        result[key] = {
            'model': f'{model}.gltf',
            'paths': coords,
            'speed': args.speed,
            'groundOffset': ground_offset,
        }
        print(f'  OK    {key:<8} {model+".gltf":<14} {len(coords):4d} waypoints  '
              f'groundOffset={ground_offset}')

    out_path = out_dir / 'paths.json'
    out_path.write_text(json.dumps(result, indent=1), encoding='utf-8')
    print(f'\nPaths: {len(result)}   Output: {out_path.resolve()}')


if __name__ == '__main__':
    main()
