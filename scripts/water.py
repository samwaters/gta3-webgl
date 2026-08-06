#!/usr/bin/env python3
"""
water.py  —  Convert GTA III's water.dat to water.json (+ the water texture)

GTA III defines its water surface as a set of axis-aligned rectangles in
`data/water.dat` (a plain-text table).  Each row is one rectangle:

    <level> <xLeft> <yBottom> <xRight> <yTop>

`level` is the water height in GTA world Z (most are `0.0` — sea level — with a
cluster at `63.2` for the elevated Cochrane Dam reservoir).  The four remaining
numbers are the rectangle's extent in the GTA X/Y ground plane.

The file is lightly irregular: comment lines start with `;`, a trailing line
starts with `*` (end-of-file marker), and the column delimiter is inconsistent
(commas and/or tabs, and one row is whitespace-only).  We split on any run of
commas/whitespace and take the five numbers.

This writes `viewer/extracted/water.json`:

    { "water": [ { "level": 0.0, "xLeft": 372.0, "yBottom": -2239.0,
                   "xRight": 767.0, "yTop": -84.0 }, … ] }

and extracts the water surface texture (`water_old`, 128×128, from
`models/particle.txd`) to `viewer/extracted/water_old.png` so the scene viewer can tile
it across the rectangles.

Usage:
  python water.py                       # <root>/data/water.dat + models/ → viewer/extracted/
  python water.py --water X --txd Y -o Z
"""

import argparse
import json
import re
import sys
from pathlib import Path

import txd_common

# The water surface texture GTA III uses, and the dictionary it lives in.
WATER_TXD     = 'particle.txd'
WATER_TEXTURE = 'water_old'

# Split a data row on any run of commas / whitespace.
_SPLIT = re.compile(r'[,\s]+')


def parse_water_dat(path: Path) -> list[dict]:
    """Parse water.dat → [{level, xLeft, yBottom, xRight, yTop}, …]."""
    rects = []
    for raw in path.read_text(errors='replace').splitlines():
        line = raw.strip()
        if not line or line.startswith(';'):     # blank / comment
            continue
        if line.startswith('*'):                  # end-of-file marker
            break
        nums = [t for t in _SPLIT.split(line) if t]
        if len(nums) < 5:
            continue
        try:
            level, x_left, y_bottom, x_right, y_top = (float(n) for n in nums[:5])
        except ValueError:
            continue
        rects.append({
            'level':   level,
            'xLeft':   x_left,
            'yBottom': y_bottom,
            'xRight':  x_right,
            'yTop':    y_top,
        })
    return rects


def main() -> None:
    root   = Path(__file__).resolve().parents[2]     # …/G3
    viewer = Path(__file__).resolve().parents[1]     # …/G3/viewer
    ap = argparse.ArgumentParser(description='Convert GTA III water.dat to water.json')
    ap.add_argument('--water', default=str(root / 'data' / 'water.dat'),
                    help='Path to water.dat (default: <game root>/data/water.dat)')
    ap.add_argument('--txd', default=str(root / 'models' / WATER_TXD),
                    help=f'TXD holding the water texture '
                         f'(default: <game root>/models/{WATER_TXD})')
    ap.add_argument('-o', '--output', default=str(viewer / 'extracted'),
                    help='Output directory (default: <game root>/viewer/extracted)')
    args = ap.parse_args()

    water_path = Path(args.water)
    out_dir    = Path(args.output)
    if not water_path.exists():
        sys.exit(f'Error: water.dat not found: {water_path}')
    out_dir.mkdir(parents=True, exist_ok=True)

    rects = parse_water_dat(water_path)
    (out_dir / 'water.json').write_text(
        json.dumps({'water': rects}, indent=1), encoding='utf-8')

    levels = sorted({r['level'] for r in rects})
    print(f'  OK    {len(rects)} rectangles  levels={levels}')
    txd_common.extract_one(Path(args.txd), WATER_TEXTURE,
                           out_dir / 'water_old.png')
    print(f'\nOutput: {(out_dir / "water.json").resolve()}')


if __name__ == '__main__':
    main()
