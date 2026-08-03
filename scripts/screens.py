#!/usr/bin/env python3
"""
loadscreens.py  —  Extract GTA III's loading-screen and island-splash textures

GTA III ships two families of loading-screen texture dictionaries in its
`txd` folder:

    SPLASH1.TXD / SPLASH2.TXD / SPLASH3.TXD
        The three per-island loading-transition screens, one per island,
        referenced by name via the `SPLASH` directive in gta.dat.

    LOADSC0.TXD … LOADSC25.TXD
        ~26 general loading screens (character portraits etc.) shown at
        random while loading saves/missions — not tied to a specific island.

Both families are ordinary single-texture RenderWare TXDs. On PC they sit
loose in `<game root>/txd/`; on PS2 they're packed inside MODELS.IMG — run
this project's IMG/DIR extractor first if you're working from the PS2 image
so the loose .txd files exist on disk before pointing this script at them.

This writes, for every SPLASH*/LOADSC* dictionary found:
  viewer/extracted/loadscreens/<label>.png   — decoded texture(s)
  viewer/extracted/loadscreens.json          — manifest of what was found

Usage:
  python loadscreens.py                    # <root>/txd → viewer/extracted/loadscreens/
  python loadscreens.py --txd-dir X -o Y
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Case-insensitive filename patterns for the two families we care about.
_SPLASH_RE = re.compile(r'^splash([123])\.txd$', re.IGNORECASE)
_LOADSC_RE = re.compile(r'^loadsc(\d{1,2})\.txd$', re.IGNORECASE)


def find_targets(txd_dir: Path) -> list[tuple[str, Path, str]]:
    """Return [(kind, path, label), …] for every SPLASH*/LOADSC* txd found."""
    targets = []
    if not txd_dir.exists():
        return targets
    for p in sorted(txd_dir.iterdir()):
        if not p.is_file():
            continue
        m = _SPLASH_RE.match(p.name)
        if m:
            targets.append(('splash', p, f'island_{m.group(1)}'))
            continue
        m = _LOADSC_RE.match(p.name)
        if m:
            targets.append(('loadsc', p, f'loadsc{int(m.group(1))}'))
    return targets


def extract_all(targets: list[tuple[str, Path, str]], out_dir: Path) -> list[dict]:
    """Decode every texture in every target TXD and write it as a PNG."""
    try:
        import gta_to_gltf as g
    except ImportError as exc:
        sys.exit(f'Error: cannot import gta_to_gltf ({exc})')
    if not g.HAS_PIL:
        sys.exit('Error: Pillow not installed; cannot write PNGs')
    from PIL import Image

    manifest = []
    for kind, path, label in targets:
        try:
            txd = g.parse_txd(path.read_bytes())
        except Exception as exc:                       # noqa: BLE001
            print(f'  WARNING: could not parse {path.name}: {exc}')
            continue
        if not txd:
            print(f'  WARNING: no textures found in {path.name}')
            continue
        # Almost all of these dictionaries hold exactly one texture, but
        # handle the rare multi-texture case without clobbering filenames.
        multi = len(txd) > 1
        for tex_name, (w, h, rgba) in txd.items():
            out_name = f'{label}_{tex_name}.png' if multi else f'{label}.png'
            out_png = out_dir / out_name
            Image.frombytes('RGBA', (w, h), bytes(rgba)).save(out_png)
            print(f'  OK    {kind:7s} {path.name:14s} {tex_name:20s} '
                  f'{w}x{h} -> {out_png.name}')
            manifest.append({
                'kind':    kind,
                'source':  path.name,
                'label':   label,
                'texture': tex_name,
                'width':   w,
                'height':  h,
                'file':    out_name,
            })
    return manifest


def main() -> None:
    root   = Path(__file__).resolve().parents[2]     # …/G3
    viewer = Path(__file__).resolve().parents[1]     # …/G3/viewer
    ap = argparse.ArgumentParser(
        description='Extract GTA III SPLASH (island) and LOADSC (general) loading screens')
    ap.add_argument('--txd-dir', default=str(root / 'txd'),
                    help='Directory holding loose .txd files (default: <game root>/txd)')
    ap.add_argument('-o', '--output', default=str(viewer / 'extracted' / 'loadscreens'),
                    help='Output directory (default: <game root>/viewer/extracted/loadscreens)')
    args = ap.parse_args()

    txd_dir = Path(args.txd_dir)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = find_targets(txd_dir)
    if not targets:
        sys.exit(f'Error: no SPLASH*/LOADSC* .txd files found in {txd_dir}')

    splash_count = sum(1 for k, _, _ in targets if k == 'splash')
    loadsc_count = sum(1 for k, _, _ in targets if k == 'loadsc')
    print(f'  Found {splash_count} splash + {loadsc_count} loadsc dictionaries')

    manifest = extract_all(targets, out_dir)

    manifest_path = out_dir.parent / 'loadscreens.json'
    manifest_path.write_text(
        json.dumps({'loadscreens': manifest}, indent=1), encoding='utf-8')

    print(f'\nExtracted {len(manifest)} textures')
    print(f'Manifest: {manifest_path.resolve()}')


if __name__ == '__main__':
    main()