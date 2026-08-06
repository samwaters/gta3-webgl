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
import re
import sys
from pathlib import Path

import txd_common

# Case-insensitive filename patterns for the two families we care about.
_SPLASH_RE = re.compile(r'^splash([123])\.txd$', re.IGNORECASE)
_LOADSC_RE = re.compile(r'^loadsc(\d{1,2})\.txd$', re.IGNORECASE)


def find_targets(txd_dir: Path) -> list[tuple[Path, str, dict]]:
    """Return [(path, label, extra), …] for every SPLASH*/LOADSC* txd found."""
    targets = []
    if not txd_dir.exists():
        return targets
    for p in sorted(txd_dir.iterdir()):
        if not p.is_file():
            continue
        m = _SPLASH_RE.match(p.name)
        if m:
            targets.append((p, f'island_{m.group(1)}', {'kind': 'splash'}))
            continue
        m = _LOADSC_RE.match(p.name)
        if m:
            targets.append((p, f'loadsc{int(m.group(1))}', {'kind': 'loadsc'}))
    return targets


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

    splash_count = sum(1 for _, _, e in targets if e['kind'] == 'splash')
    loadsc_count = sum(1 for _, _, e in targets if e['kind'] == 'loadsc')
    print(f'  Found {splash_count} splash + {loadsc_count} loadsc dictionaries')

    manifest = txd_common.extract_group(targets, out_dir)
    txd_common.report(manifest,
                      txd_common.write_manifest(out_dir, 'loadscreens', manifest),
                      field='kind')


if __name__ == '__main__':
    main()