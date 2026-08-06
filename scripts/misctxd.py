#!/usr/bin/env python3
"""
misctxd.py  —  Extract GTA III's miscellaneous menu/UI textures

A handful of texture dictionaries in GTA III's `txd` folder don't fit the
SPLASH*/LOADSC* loading-screen families handled by loadscreens.py:

    MAINSC1.TXD    front-end / main-menu background
    MAINSC2.TXD    a second main-menu background (used for some menu states)
    NEWS.TXD       newspaper graphic shown on the PC-only outro/news screen

Contents aren't fully confirmed since these haven't been extracted before —
this script decodes whatever textures each dictionary actually contains
rather than assuming one texture per file, so nothing gets silently dropped.

Like SPLASH*/LOADSC*, these are ordinary single- or multi-texture RenderWare
TXDs. On PC they sit loose in `<game root>/txd/`; on PS2 they're packed
inside MODELS.IMG — run this project's IMG/DIR extractor first if you're
working from the PS2 image so the loose .txd files exist on disk before
pointing this script at them.

This writes, for every dictionary found:
  viewer/extracted/misc/<label>.png   — decoded texture(s)
  viewer/extracted/misc.json          — manifest of what was found

Usage:
  python misctxd.py                    # <root>/txd → viewer/extracted/misc/
  python misctxd.py --txd-dir X -o Y
"""

import argparse
import sys
from pathlib import Path

import txd_common

# Filenames (without extension) we're after, each mapped to a manifest label.
_TARGET_NAMES = {
    'mainsc1': 'mainsc1',
    'mainsc2': 'mainsc2',
    'news':    'news',
}


def find_targets(txd_dir: Path) -> list[tuple[Path, str, dict]]:
    """Return [(path, label, extra), …] for every misc txd found."""
    targets = []
    for stem, label in _TARGET_NAMES.items():
        p = txd_common.find_txd(txd_dir, stem)
        if p is not None:
            targets.append((p, label, {}))
    return targets


def main() -> None:
    root   = Path(__file__).resolve().parents[2]     # …/G3
    viewer = Path(__file__).resolve().parents[1]     # …/G3/viewer
    ap = argparse.ArgumentParser(
        description='Extract GTA III misc menu/UI TXDs (mainsc1, mainsc2, news)')
    ap.add_argument('--txd-dir', default=str(root / 'txd'),
                    help='Directory holding loose .txd files (default: <game root>/txd)')
    ap.add_argument('-o', '--output', default=str(viewer / 'extracted' / 'misc'),
                    help='Output directory (default: <game root>/viewer/extracted/misc)')
    args = ap.parse_args()

    txd_dir = Path(args.txd_dir)
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = find_targets(txd_dir)
    if not targets:
        sys.exit(f'Error: none of mainsc1/mainsc2/news .txd found in {txd_dir}')

    found = ', '.join(p.name for p, _, _ in targets)
    print(f'  Found {len(targets)} misc dictionaries: {found}')

    manifest = txd_common.extract_group(targets, out_dir)
    txd_common.report(manifest,
                      txd_common.write_manifest(out_dir, 'misc', manifest))


if __name__ == '__main__':
    main()