#!/usr/bin/env python3
"""
txd_common.py  —  shared plumbing for the TXD-to-PNG extractors

All the RenderWare decoding lives in gta_to_gltf.py (`parse_txd`, and the
PS2/D3D8/DXT paths under it). Nothing here re-implements any of that — this
module only holds the asset-pipeline convention layered on top of it: find
the dictionaries, decode every texture, name the PNGs, and write a manifest.

Three extraction shapes are supported, because the extractors want different
things and differ in what a failure should cost:

  extract_txd    one dictionary owns one folder, and PNGs are named after the
                 textures themselves (menu.py, fonts.py, frontend.py, hud.py).
                 A dictionary that won't parse is fatal — there's nothing else
                 to do on that run.

  extract_group  several related dictionaries share one folder, and PNGs are
                 named after a per-dictionary label rather than the texture
                 (screens.py, misctxd.py — SPLASH1.TXD → island_1.png). A
                 dictionary that won't parse is warned about and skipped, so
                 the rest of the group still comes out.

  extract_one    a single named texture pulled out of a dictionary as a side
                 asset next to a script's real output (water.py's water_old
                 beside water.json). Wholly non-fatal — it reports whether it
                 wrote and lets the caller carry on either way.
"""

import json
import sys
from pathlib import Path
from collections.abc import Callable

# …/G3 and …/G3/viewer, resolved relative to this file so the scripts work
# from any working directory.
ROOT   = Path(__file__).resolve().parents[2]
VIEWER = Path(__file__).resolve().parents[1]


def _backend(fatal: bool = True):
    """Return (gta_to_gltf, PIL.Image).

    A missing dependency exits with a clear message by default; with
    fatal=False it warns and returns (None, None) instead, for callers where
    the texture is an optional extra beside their real output.
    """
    try:
        import gta_to_gltf as g
    except ImportError as exc:
        if fatal:
            sys.exit(f'Error: cannot import gta_to_gltf ({exc})')
        print(f'  WARNING: cannot import gta_to_gltf ({exc}); skipping texture')
        return None, None
    if not g.HAS_PIL:
        if fatal:
            sys.exit('Error: Pillow not installed; cannot write PNGs')
        print('  WARNING: Pillow not installed; skipping texture')
        return None, None
    from PIL import Image
    return g, Image


def find_txd(txd_dir: Path, stem: str) -> Path | None:
    """Locate `<stem>.txd` in txd_dir, case-insensitively."""
    if not txd_dir.exists():
        return None
    target = f'{stem.lower()}.txd'
    for p in txd_dir.iterdir():
        if p.is_file() and p.name.lower() == target:
            return p
    return None


def extract_txd(path: Path, out_dir: Path,
                classify: Callable[[str], str]) -> list[dict]:
    """Decode one TXD to <out_dir>/<texture>.png.

    Texture names are unique within a dictionary, so they're used verbatim as
    filenames — no prefix needed when each dictionary owns its folder.
    """
    g, Image = _backend()
    try:
        txd = g.parse_txd(path.read_bytes())
    except Exception as exc:                           # noqa: BLE001
        sys.exit(f'Error: could not parse {path.name}: {exc}')
    if not txd:
        sys.exit(f'Error: no textures found in {path.name}')

    manifest = []
    for tex_name, (w, h, rgba) in txd.items():
        role = classify(tex_name)
        out_name = f'{tex_name}.png'
        Image.frombytes('RGBA', (w, h), bytes(rgba)).save(out_dir / out_name)
        print(f'  OK    {tex_name:20s} {w:5d}x{h:<5d} {role:11s} -> {out_name}')
        manifest.append({
            'texture': tex_name,
            'role':    role,
            'width':   w,
            'height':  h,
            'file':    out_name,
        })
    return manifest


def extract_group(targets: list[tuple[Path, str, dict]],
                  out_dir: Path) -> list[dict]:
    """Decode several related TXDs into one shared folder.

    `targets` is [(path, label, extra), …]. PNGs are named for the label —
    `<label>.png` for the common single-texture case, `<label>_<texture>.png`
    when a dictionary holds more than one so nothing gets clobbered. Each
    target's `extra` dict is merged into the front of its manifest entries.
    """
    g, Image = _backend()

    manifest = []
    for path, label, extra in targets:
        try:
            txd = g.parse_txd(path.read_bytes())
        except Exception as exc:                       # noqa: BLE001
            print(f'  WARNING: could not parse {path.name}: {exc}')
            continue
        if not txd:
            print(f'  WARNING: no textures found in {path.name}')
            continue
        multi = len(txd) > 1
        for tex_name, (w, h, rgba) in txd.items():
            out_name = f'{label}_{tex_name}.png' if multi else f'{label}.png'
            Image.frombytes('RGBA', (w, h), bytes(rgba)).save(out_dir / out_name)
            print(f'  OK    {path.name:14s} {tex_name:20s} '
                  f'{w:5d}x{h:<5d} -> {out_name}')
            manifest.append({
                **extra,
                'source':  path.name,
                'label':   label,
                'texture': tex_name,
                'width':   w,
                'height':  h,
                'file':    out_name,
            })
    return manifest


def extract_one(txd_path: Path, texture: str, out_png: Path) -> bool:
    """Decode a single named texture out of a TXD. Returns whether it wrote.

    Every failure warns and returns False rather than exiting: this is for one
    optional texture sitting beside a script's real output (water.py's
    water_old next to water.json), where a missing dictionary shouldn't sink
    an otherwise good run.
    """
    g, Image = _backend(fatal=False)
    if g is None:
        return False
    if not txd_path.exists():
        print(f'  WARNING: {txd_path} not found; skipping {texture}')
        return False
    try:
        txd = g.parse_txd(txd_path.read_bytes())
    except Exception as exc:                           # noqa: BLE001
        print(f'  WARNING: could not parse {txd_path.name}: {exc}')
        return False
    tex = txd.get(texture.lower())                     # parse_txd lowercases keys
    if tex is None:
        print(f'  WARNING: "{texture}" not in {txd_path.name}')
        return False
    w, h, rgba = tex
    Image.frombytes('RGBA', (w, h), bytes(rgba)).save(out_png)
    print(f'  OK    texture {texture}  {w}x{h}  → {out_png.name}')
    return True


def write_manifest(out_dir: Path, key: str, entries: list[dict]) -> Path:
    """Write {key: entries} to <out_dir>/../<key>.json and return the path."""
    path = out_dir.parent / f'{key}.json'
    path.write_text(json.dumps({key: entries}, indent=1), encoding='utf-8')
    return path


def summarize(entries: list[dict], field: str) -> str:
    """'7 background, 6 logo' — counts of `field`, or '' if no entry has it."""
    counts: dict[str, int] = {}
    for entry in entries:
        if field in entry:
            counts[entry[field]] = counts.get(entry[field], 0) + 1
    return ', '.join(f'{n} {value}' for value, n in sorted(counts.items()))


def report(entries: list[dict], manifest_path: Path, field: str = 'role') -> None:
    """Print the trailing count/summary line both extractor shapes end with."""
    summary = summarize(entries, field)
    suffix = f' ({summary})' if summary else ''
    print(f'\nExtracted {len(entries)} textures{suffix}')
    print(f'Manifest: {manifest_path.resolve()}')


def run_extractor(*, stem: str, manifest_key: str, description: str,
                  classify: Callable[[str], str],
                  post: Callable[[Path, list[dict]], None] | None = None) -> None:
    """Full CLI for a one-dictionary extractor reading from <root>/models.

    Writes viewer/extracted/<stem>/*.png and viewer/extracted/<manifest_key>.json.

    `post` runs after the PNGs are written, with (out_dir, manifest), for an
    extractor that owes the app something beyond extracted/ — fonts.py uses it
    to copy the two text faces into viewer/public/fonts.
    """
    import argparse

    ap = argparse.ArgumentParser(description=description)
    ap.add_argument('--models-dir', default=str(ROOT / 'models'),
                    help='Directory holding loose .txd files (default: <game root>/models)')
    ap.add_argument('-o', '--output',
                    default=str(VIEWER / 'extracted' / stem),
                    help=f'Output directory (default: <game root>/viewer/extracted/{stem})')
    args = ap.parse_args()

    models_dir = Path(args.models_dir)
    out_dir = Path(args.output)

    path = find_txd(models_dir, stem)
    if path is None:
        sys.exit(f'Error: {stem}.txd not found in {models_dir}')

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f'  Found {path.name} ({path.stat().st_size / 1024:.0f} KB)')

    manifest = extract_txd(path, out_dir, classify)
    if post is not None:
        post(out_dir, manifest)
    report(manifest, write_manifest(out_dir, manifest_key, manifest))
