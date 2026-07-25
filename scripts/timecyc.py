#!/usr/bin/env python3
"""
timecyc.py  —  Convert GTA III's timecyc.dat to timecyc.json

`data/timecyc.dat` is GTA III's "time cycle" table: the colours and atmosphere
settings the engine uses to build the sky (and light the world) for every hour
of the day, under each weather type.  There is no skybox texture — the sky is a
gradient + clouds + sun/moon coronas + fog, all coloured from this table.

Layout: four weather blocks in order — SUNNY, CLOUDY, RAINY, FOGGY — each with
24 rows (Midnight, 1AM … 11PM).  Comment lines start with `//`; a block header
comment carries the weather name.  Each data row is 40 whitespace-separated
numbers, in this order (the file's own header documents all but the last four):

    amb R G B            ambient light colour (lights the world)
    dir R G B            directional / sun light colour
    skyTop R G B         sky colour at the zenith
    skyBot R G B         sky colour at the horizon
    sunCore R G B        sun disc colour
    sunCorona R G B      sun glow colour
    sunSize              sun size
    spriteSize           corona sprite size
    spriteBright         corona sprite brightness
    shadow               shadow strength
    lightShadow          light-shadow strength
    treeShadow           tree/pole-shadow strength
    farClip              far clip / draw distance
    fogStart             fog start distance
    lightOnGround        ground light brightness
    lowClouds R G B      streaky low-cloud tint
    topClouds R G B      fluffy-cloud top tint
    bottomClouds R G B   fluffy-cloud bottom tint
    blur R G B A         screen blur / colour-filter tint (undocumented in-file)

Output `extracted/timecyc.json`, keyed by weather, each an array of 24 hour
objects (index = hour, 0 = Midnight).  Grouped colours are stored as arrays:

    { "sunny": [ { "amb": [74,74,46], "dir": [100,100,105], "skyTop": [0,0,5],
                   …, "sunSize": 1.0, …, "blur": [152,86,5,80] }, … 24 … ],
      "cloudy": [ … ], "rainy": [ … ], "foggy": [ … ] }

Usage:
  python timecyc.py                     # data/timecyc.dat → extracted/timecyc.json
  python timecyc.py --timecyc X -o Y
"""

import argparse
import json
import sys
from pathlib import Path

WEATHERS = ('SUNNY', 'CLOUDY', 'RAINY', 'FOGGY')
HOURS_PER_WEATHER = 24

# (json key, type, component count) in the order columns appear in a row.
# count > 1 → stored as a list; count == 1 → stored as a scalar.
FIELDS = [
    ('amb',           'int',   3),
    ('dir',           'int',   3),
    ('skyTop',        'int',   3),
    ('skyBot',        'int',   3),
    ('sunCore',       'int',   3),
    ('sunCorona',     'int',   3),
    ('sunSize',       'float', 1),
    ('spriteSize',    'float', 1),
    ('spriteBright',  'float', 1),
    ('shadow',        'int',   1),
    ('lightShadow',   'int',   1),
    ('treeShadow',    'int',   1),
    ('farClip',       'float', 1),
    ('fogStart',      'float', 1),
    ('lightOnGround', 'float', 1),
    ('lowClouds',     'int',   3),
    ('topClouds',     'int',   3),
    ('bottomClouds',  'int',   3),
    ('blur',          'int',   4),
]
NUM_COLUMNS = sum(count for _, _, count in FIELDS)   # 40


def _num(token: str, kind: str):
    """Parse one token as int or float ('086' / '05' / '2000.0' all fine)."""
    return int(float(token)) if kind == 'int' else float(token)


def parse_row(tokens: list[str]) -> dict:
    """Turn 40 numeric tokens into a named-field hour object."""
    row, i = {}, 0
    for name, kind, count in FIELDS:
        vals = [_num(tokens[i + j], kind) for j in range(count)]
        row[name] = vals if count > 1 else vals[0]
        i += count
    return row


def parse_timecyc(path: Path) -> dict:
    """Parse timecyc.dat → { weather: [ hour_obj × 24 ] }."""
    result: dict[str, list] = {}
    current = None
    for raw in path.read_text(errors='replace').splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith('/'):                       # comment / block header
            up = line.upper()
            for w in WEATHERS:
                if w in up:
                    current = w.lower()
                    result.setdefault(current, [])
                    break
            continue
        tokens = line.split()                          # data row (tabs or spaces)
        if len(tokens) < NUM_COLUMNS:
            print(f'  WARNING: skipping short row ({len(tokens)} cols): {line[:40]}…')
            continue
        if current is None:
            print(f'  WARNING: data row before any weather header: {line[:40]}…')
            continue
        result[current].append(parse_row(tokens[:NUM_COLUMNS]))
    return result


def main() -> None:
    root = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description='Convert GTA III timecyc.dat to timecyc.json')
    ap.add_argument('--timecyc', default=str(root / 'data' / 'timecyc.dat'),
                    help='Path to timecyc.dat (default: data/timecyc.dat)')
    ap.add_argument('-o', '--output', default=str(root / 'extracted'),
                    help='Output directory (default: ./extracted)')
    args = ap.parse_args()

    tc_path = Path(args.timecyc)
    out_dir = Path(args.output)
    if not tc_path.exists():
        sys.exit(f'Error: timecyc.dat not found: {tc_path}')
    out_dir.mkdir(parents=True, exist_ok=True)

    cycle = parse_timecyc(tc_path)
    (out_dir / 'timecyc.json').write_text(json.dumps(cycle, indent=1), encoding='utf-8')

    for weather, hours in cycle.items():
        flag = '' if len(hours) == HOURS_PER_WEATHER else f'  (expected {HOURS_PER_WEATHER}!)'
        print(f'  OK    {weather:<7} {len(hours):2d} hours{flag}')
    print(f'\nOutput: {(out_dir / "timecyc.json").resolve()}')


if __name__ == '__main__':
    main()
