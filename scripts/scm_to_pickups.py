#!/usr/bin/env python3
"""
scm_to_pickups.py  —  Extract pickup placements from GTA III's main.scm

GTA III does not place pickups (weapons, health, packages) through the IPL
files — their `pick` sections are empty.  Instead the mission script
(`data/main.scm`, compiled bytecode) creates them at load time with the
pickup opcodes.  This script scans the SCM for those opcodes and writes the
model + world position of each pickup to `extracted/pickups.json`.

Opcodes read (GTA III):
  0213  CREATE_PICKUP            model, type,        X, Y, Z, →handle
  032B  CREATE_PICKUP_WITH_AMMO  model, weaponId, ammo, X, Y, Z, →handle
  02EC  put_hidden_package_at    X, Y, Z            (the 100 hidden packages)

SCM argument encoding (each argument is self-describing — a 1-byte data type
then its value):
  0x01 int32   0x02 global var (u16)   0x03 local var (u16)
  0x04 int8    0x05 int16              0x06 float

GTA III stores SCM floats as **16-bit fixed point** (`int16 / 16`), which is
why Liberty City's ±2048 world fits in an int16.  (Vice City switched to IEEE
32-bit floats.)

Because a full SCM disassembly would need the entire opcode table, this uses a
validated scan: an opcode match is only accepted if its arguments parse with
valid data-type bytes, the model id maps to a real model name (from the IDEs),
and the coordinates fall inside the map — which rejects the false positives
that arise from the opcode bytes appearing mid-instruction.

Usage:
  python scm_to_pickups.py                 # data/main.scm + extracted/ → extracted/pickups.json
  python scm_to_pickups.py --scm X -o Y
"""

import argparse
import json
import struct
import sys
from pathlib import Path

CREATE_PICKUP           = 0x0213
CREATE_PICKUP_WITH_AMMO = 0x032B
PUT_HIDDEN_PACKAGE      = 0x02EC   # the 100 hidden packages: takes just X, Y, Z

# The hidden-package model ("collectable1") isn't in this archive; render the
# floating packages with the package1 model instead.
HIDDEN_PACKAGE_MODEL    = 'package1'

# The static non-weapon pickups use Sanny-Builder model constants (#HEALTH …)
# that compile to these (negative) numeric ids — not the IDE model ids.  The
# mapping was recovered by matching the decompiled main.scm's create_pickup
# coordinates to the ids seen in the bytecode (exact matches).  Only the four
# permanent street pickups are mapped; other negatives are dynamic / packages.
STATIC_PICKUP_MODELS = {
    -27: 'info',        # #INFO       (id 1361)
    -28: 'health',      # #HEALTH     (id 1362)
    -29: 'adrenaline',  # #ADRENALINE (id 1363)
    -24: 'bodyarmour',  # #BODYARMOUR (id 1364)
    -30: 'bribe',       # #BRIBE      (police bribe / wanted-level star)
}
# Other negative ids exist (-31 ×60, -139 ×6, both PICKUP_ONCE) but are placed
# by mission scripts, not the permanent world-pickup list — left out as they
# aren't static world pickups (and their icon models don't resolve).


def build_id_to_name(data_dir: Path) -> dict[int, str]:
    """model id → name, from every IDE's objs/tobj/cars/peds/hier/weap rows."""
    id2name: dict[int, str] = {}
    for f in list(data_dir.rglob('*.ide')) + list(data_dir.rglob('*.IDE')):
        section = None
        for line in f.read_text(errors='replace').splitlines():
            l = line.split('#')[0].strip()
            if not l:
                continue
            if ',' not in l:
                section = l.lower()
                continue
            if section in ('objs', 'tobj', 'cars', 'peds', 'hier', 'weap'):
                p = [x.strip() for x in l.split(',')]
                try:
                    id2name[int(p[0])] = p[1].lower()
                except (ValueError, IndexError):
                    pass
    return id2name


def read_arg(d: bytes, off: int):
    """Return (kind, value, next_offset). kind ∈ {'int','var','float',None}."""
    t = d[off]; off += 1
    if t == 0x01: return 'int',   struct.unpack_from('<i', d, off)[0],       off + 4
    if t == 0x02: return 'var',   struct.unpack_from('<H', d, off)[0],       off + 2
    if t == 0x03: return 'var',   struct.unpack_from('<H', d, off)[0],       off + 2
    if t == 0x04: return 'int',   struct.unpack_from('<b', d, off)[0],       off + 1
    if t == 0x05: return 'int',   struct.unpack_from('<h', d, off)[0],       off + 2
    if t == 0x06: return 'float', struct.unpack_from('<h', d, off)[0] / 16.0, off + 2
    return None, None, off


def parse_args(d: bytes, off: int, sig: str):
    """Parse args matching *sig* ('i'=literal int, 'f'=float, 'v'=var). None on mismatch."""
    vals = []
    for want in sig:
        if off >= len(d):
            return None
        kind, val, off = read_arg(d, off)
        if kind is None:
            return None
        if want == 'i' and kind != 'int':   return None
        if want == 'f' and kind != 'float': return None
        if want == 'v' and kind != 'var':   return None
        vals.append(val)
    return vals


def extract_pickups(scm: bytes, id2name: dict[int, str]) -> list[dict]:
    in_map = lambda c: -2100.0 < c < 2100.0
    seen = set()
    out = []
    i = 0
    while i < len(scm) - 2:
        op = struct.unpack_from('<H', scm, i)[0]
        model = coords = name = None

        if op == CREATE_PICKUP:
            a = parse_args(scm, i + 2, 'iifffv')          # model,type,x,y,z,handle
            if a and 1 <= a[1] <= 20 and all(map(in_map, a[2:5])):
                model, coords = a[0], a[2:5]
        elif op == CREATE_PICKUP_WITH_AMMO:
            a = parse_args(scm, i + 2, 'iiifffv')          # model,weap,ammo,x,y,z,handle
            if a and all(map(in_map, a[3:6])):
                model, coords = a[0], a[3:6]
        elif op == PUT_HIDDEN_PACKAGE:
            a = parse_args(scm, i + 2, 'fff')              # x,y,z (model is hardcoded)
            if a and all(map(in_map, a)):
                name, coords = HIDDEN_PACKAGE_MODEL, a

        # For create_pickup, accept only if the model resolves to a name —
        # a known static pickup (negative id) or a real IDE model (weapons).
        # This validation also discards mid-instruction false positives.
        if name is None:
            if model in STATIC_PICKUP_MODELS:
                name = STATIC_PICKUP_MODELS[model]
            elif model is not None and model in id2name:
                name = id2name[model]
        if name and coords:
            key = (name, round(coords[0], 2), round(coords[1], 2), round(coords[2], 2))
            if key not in seen:
                seen.add(key)
                out.append({'model': name,
                            'x': coords[0], 'y': coords[1], 'z': coords[2]})
        i += 1
    return out


def main() -> None:
    root = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description='Extract pickup placements from main.scm')
    ap.add_argument('--scm', default=str(root / 'data' / 'main.scm'),
                    help='Path to main.scm (default: data/main.scm)')
    ap.add_argument('--data-dir', default=str(root / 'data'),
                    help='Directory of IDE files for id→name (default: ./data)')
    ap.add_argument('-o', '--output', default=str(root / 'extracted'),
                    help='Output directory holding the glTFs (default: ./extracted)')
    args = ap.parse_args()

    scm_path = Path(args.scm)
    out_dir  = Path(args.output)
    if not scm_path.exists():
        sys.exit(f'Error: SCM not found: {scm_path}')
    if not out_dir.exists():
        sys.exit(f'Error: output dir not found: {out_dir} (run gta_to_gltf.py first)')

    id2name    = build_id_to_name(Path(args.data_dir))
    gltf_names = {p.stem.lower() for p in out_dir.glob('*.gltf')}

    pickups = extract_pickups(scm_path.read_bytes(), id2name)
    # Resolve each model to a glTF if one was converted (weapon models have no
    # .dff in this archive, so most resolve to null — the viewer shows a marker).
    for p in pickups:
        p['gltf'] = f"{p['model']}.gltf" if p['model'] in gltf_names else None

    (out_dir / 'pickups.json').write_text(json.dumps(pickups, indent=1), encoding='utf-8')

    from collections import Counter
    have = sum(1 for p in pickups if p['gltf'])
    print(f'Pickups: {len(pickups)}   with glTF: {have}   without: {len(pickups) - have}')
    print('By model:', dict(Counter(p['model'] for p in pickups)))
    print(f'Output:  {(out_dir / "pickups.json").resolve()}')


if __name__ == '__main__':
    main()
