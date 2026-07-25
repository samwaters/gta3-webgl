#!/usr/bin/env python3
"""
ipl_to_scene.py  —  Build a scene-placement manifest from GTA III IPL files

Globs every .ipl under the data directory, parses its `inst` section, maps
each placed model to its converted glTF, and writes the instance transforms
into ./extracted/scene.json — nested by the IPL's location, mirroring
gta3.json.

GTA III `inst` line format (12 comma-separated columns, no flags):

    ID, ModelName, PosX, PosY, PosZ,
        ScaleX, ScaleY, ScaleZ,
        RotX, RotY, RotZ, RotW        (rotation is a quaternion)

Coordinates are GTA's native right-handed Z-up world space and are stored
verbatim (the viewer applies any Z-up→Y-up conversion to match the models).

Usage
-----
  python ipl_to_scene.py                 # auto: data/ + extracted/
  python ipl_to_scene.py --data-dir X -o Y
"""

import argparse
import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def discover_ipls(data_dir: Path) -> list[Path]:
    """Every .ipl file under *data_dir* (case-insensitive), sorted."""
    return sorted(
        p for p in data_dir.rglob('*')
        if p.is_file() and p.suffix.lower() == '.ipl'
    )


def gta3dat_ipl_stems(data_dir: Path) -> set[str] | None:
    """
    The IPL file stems that gta3.dat actually loads — the authoritative game
    scene.  IPLs present on disk but NOT listed here (the road IPLs, the
    suburb* duplicates of land*, making/temppart) are dev leftovers that
    misalign or double-place geometry, so they're excluded by default.
    Returns None if gta3.dat can't be found.
    """
    dat = data_dir / 'gta3.dat'
    if not dat.exists():
        return None
    stems = set()
    for line in dat.read_text(errors='replace').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].upper() == 'IPL':
            name = parts[1].strip().replace('\\', '/').split('/')[-1]
            if name.lower().endswith('.ipl'):
                stems.add(name.rsplit('.', 1)[0].lower())
    return stems


def hierarchy_keys(path: Path, root: Path) -> list[str]:
    """
    Nested manifest keys mirroring an IPL's location (same scheme as
    gta3.json):  data/maps/COMSW/COMSW.ipl -> ['data', 'maps', 'comsw'].
    Lower-cased, with a component equal to the previous one collapsed.
    """
    try:
        rel = path.resolve().relative_to(root)
    except ValueError:
        rel = Path(path.name)
    keys: list[str] = []
    for part in rel.with_suffix('').parts:
        low = part.lower()
        if keys and keys[-1] == low:
            continue
        keys.append(low)
    return keys


def dedupe_ipls(ipls: list[Path], root: Path) -> list[tuple[list[str], Path]]:
    """
    Resolve IPLs that map to the same hierarchy key (e.g. a top-level copy and
    the subdirectory copy of COMNbtm.ipl).  Prefer the one that sits next to a
    matching <stem>.ide; break ties by the deeper path.
    """
    best: dict[tuple[str, ...], tuple[tuple[int, int], Path]] = {}
    for p in ipls:
        keys = hierarchy_keys(p, root)
        has_sibling_ide = (p.parent / (p.stem + '.ide')).exists() or \
            any(f.stem.lower() == p.stem.lower() and f.suffix.lower() == '.ide'
                for f in p.parent.iterdir())
        score = (1 if has_sibling_ide else 0, len(p.parts))
        k = tuple(keys)
        if k not in best or score > best[k][0]:
            best[k] = (score, p)
    return sorted((list(k), v[1]) for k, v in best.items())


# ---------------------------------------------------------------------------
# IPL parsing
# ---------------------------------------------------------------------------

def parse_inst(path: Path) -> list[dict]:
    """
    Parse the `inst` section of an IPL file into a list of raw instance dicts
    (id, name, position, scale, rotation quaternion).
    """
    out = []
    section = None
    for raw in path.read_text(errors='replace').splitlines():
        line = raw.split('#')[0].strip()
        if not line:
            continue
        low = line.lower()
        if low == 'end':
            section = None
            continue
        if ',' not in line:
            section = low
            continue
        if section != 'inst':
            continue

        p = [c.strip() for c in line.split(',')]
        if len(p) < 12:
            continue
        try:
            out.append({
                'id':   int(p[0]),
                'name': p[1].lower(),
                'x':    float(p[2]),  'y':  float(p[3]),  'z':  float(p[4]),
                'sx':   float(p[5]),  'sy': float(p[6]),  'sz': float(p[7]),
                'rx':   float(p[8]),  'ry': float(p[9]),
                'rz':   float(p[10]), 'rw': float(p[11]),
            })
        except (ValueError, IndexError):
            pass
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    root = Path(__file__).resolve().parent

    ap = argparse.ArgumentParser(description='Build scene.json from GTA III IPLs')
    ap.add_argument('--data-dir', metavar='DIR', default=str(root / 'data'),
                    help='Directory to scan for .ipl files (default: ./data)')
    ap.add_argument('-o', '--output', metavar='DIR', default=str(root / 'extracted'),
                    help='Output directory holding the glTFs (default: ./extracted)')
    ap.add_argument('--all', action='store_true',
                    help='Include every IPL on disk, not just the gta3.dat set '
                         '(adds road IPLs, suburb duplicates, making/temppart)')
    ap.add_argument('--keep-lod', action='store_true',
                    help='Keep LOD models (low-poly distant stand-ins; omitted by default)')
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out_dir  = Path(args.output)
    if not data_dir.exists():
        sys.exit(f'Error: data directory not found: {data_dir}')
    if not out_dir.exists():
        sys.exit(f'Error: output directory not found: {out_dir} '
                 '(run gta_to_gltf.py first)')

    # Which model names actually have a converted glTF?
    gltf_names = {p.stem.lower() for p in out_dir.glob('*.gltf')}

    ipls = discover_ipls(data_dir)
    chosen = dedupe_ipls(ipls, root)

    # Restrict to the gta3.dat load set unless --all.
    if not args.all:
        stems = gta3dat_ipl_stems(data_dir)
        if stems is None:
            print('WARNING: gta3.dat not found — using all IPLs (--all behaviour)')
        else:
            before = len(chosen)
            chosen = [(k, p) for (k, p) in chosen if k[-1] in stems]
            print(f'IPLs:     {before} on disk → {len(chosen)} in the gta3.dat '
                  'game scene (use --all for everything)')
    if args.all:
        print(f'IPLs:     {len(chosen)} (all, de-duplicated)')

    scene: dict = {}
    n_inst = n_missing = n_lod = 0
    missing_names: set[str] = set()

    for keys, path in chosen:
        instances = parse_inst(path)
        if not instances:
            continue

        arr = []
        for e in instances:
            # Skip LOD models — the engine's distance swap doesn't apply here,
            # so they z-fight the real geometry.  Two naming forms, both caught
            # by "contains lod" (no real model name contains the substring):
            #   • per-object LODs replace the name's first 3 chars with "LOD"
            #   • the big island silhouettes are "islandLOD<district>"
            if not args.keep_lod and 'lod' in e['name']:
                n_lod += 1
                continue
            gltf = f"{e['name']}.gltf" if e['name'] in gltf_names else None
            if gltf is None:
                n_missing += 1
                missing_names.add(e['name'])
            arr.append({
                'id':   e['id'],
                'name': e['name'],
                'gltf': gltf,
                'x': e['x'], 'y': e['y'], 'z': e['z'],
                'sx': e['sx'], 'sy': e['sy'], 'sz': e['sz'],
                'rx': e['rx'], 'ry': e['ry'], 'rz': e['rz'], 'rw': e['rw'],
            })
        if not arr:
            continue
        n_inst += len(arr)

        node = scene
        for k in keys[:-1]:
            node = node.setdefault(k, {})
        node[keys[-1]] = arr

    # Node keys are already inserted in sorted order (chosen is sorted); keep
    # insertion order so each instance object reads id, name, gltf, x, y, z…
    scene_path = out_dir / 'scene.json'
    scene_path.write_text(json.dumps(scene, indent=1), encoding='utf-8')

    lod_note = f'   LOD dropped: {n_lod:,}' if not args.keep_lod else ''
    print(f'Instances: {n_inst:,}   with glTF: {n_inst - n_missing:,}   '
          f'no glTF: {n_missing:,} ({len(missing_names)} distinct){lod_note}')
    print(f'Output:    {scene_path.resolve()}')


if __name__ == '__main__':
    main()
