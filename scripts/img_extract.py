#!/usr/bin/env python3
"""
GTA IMG/DIR Archive Extractor
Supports GTA III / Vice City / San Andreas formats:
  - V1: separate .img + .dir files (GTA3, VC)
  - V2: single .img with embedded directory (SA, later VC)

Usage:
  python img_extract.py game.img [game.dir] [options]

Options:
  -o DIR         Output directory (default: <img_name>_extracted)
  -f PATTERN     Filter by filename pattern (glob, e.g. "*.txd" or "ind_*")
  -t TYPE        Filter by type: txd, dff, col, ifp, scm, rrr, or any extension
  -l             List contents only, don't extract
  -v             Verbose output
  --overwrite    Overwrite existing files (default: skip)
"""

import struct
import os
import sys
import fnmatch
import argparse
from pathlib import Path


SECTOR_SIZE = 2048
V2_MAGIC = b"VER2"


# ---------------------------------------------------------------------------
# Directory parsing
# ---------------------------------------------------------------------------

def read_dir_v1(dir_path: Path) -> list[dict]:
    """
    Parse a V1 .dir file.
    Each entry is 32 bytes: uint32 offset_sectors, uint32 size_sectors, char[24] name
    """
    data = dir_path.read_bytes()
    if len(data) % 32 != 0:
        raise ValueError(
            f"DIR file size {len(data)} is not a multiple of 32 — may be corrupt"
        )

    entries = []
    n = len(data) // 32
    for i in range(n):
        off = i * 32
        sector_offset, sector_size = struct.unpack_from("<2I", data, off)
        raw_name = data[off + 8 : off + 32]
        name = raw_name.rstrip(b"\x00").decode("latin-1")
        if name:  # skip empty/padding entries
            entries.append(
                {
                    "name": name,
                    "sector_offset": sector_offset,
                    "sector_size": sector_size,
                    "byte_offset": sector_offset * SECTOR_SIZE,
                    "byte_size": sector_size * SECTOR_SIZE,
                }
            )
    return entries


def read_dir_v2(img_path: Path) -> list[dict]:
    """
    Parse a V2 .img file with embedded directory.
    Header: 4 bytes magic "VER2", 4 bytes entry count, then entries.
    Each entry: uint32 offset_sectors, uint32 size_sectors, char[24] name
    """
    with img_path.open("rb") as f:
        magic = f.read(4)
        if magic != V2_MAGIC:
            raise ValueError(f"Not a V2 IMG: expected VER2, got {magic!r}")

        count = struct.unpack("<I", f.read(4))[0]
        entries = []
        for _ in range(count):
            raw = f.read(32)
            if len(raw) < 32:
                break
            sector_offset, sector_size = struct.unpack_from("<2I", raw)
            name = raw[8:].rstrip(b"\x00").decode("latin-1")
            if name:
                entries.append(
                    {
                        "name": name,
                        "sector_offset": sector_offset,
                        "sector_size": sector_size,
                        "byte_offset": sector_offset * SECTOR_SIZE,
                        "byte_size": sector_size * SECTOR_SIZE,
                    }
                )
    return entries


def load_directory(img_path: Path, dir_path: Path | None) -> tuple[list[dict], str]:
    """
    Auto-detect format and return (entries, format_name).
    - If dir_path given: V1
    - If img starts with VER2: V2
    - Otherwise try to locate a .dir alongside the .img
    """
    # Explicit .dir provided → V1
    if dir_path is not None:
        return read_dir_v1(dir_path), "V1 (paired .img/.dir)"

    # Check for embedded V2 header
    with img_path.open("rb") as f:
        magic = f.read(4)
    if magic == V2_MAGIC:
        return read_dir_v2(img_path), "V2 (embedded directory)"

    # Try auto-locating a .dir with the same stem
    auto_dir = img_path.with_suffix(".dir")
    if auto_dir.exists():
        return read_dir_v1(auto_dir), f"V1 (auto-found {auto_dir.name})"

    raise FileNotFoundError(
        f"Cannot find a directory for {img_path.name}.\n"
        "  Provide a .dir file explicitly, or the .img must start with 'VER2'."
    )


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def matches_filter(name: str, pattern: str | None, ext_filter: str | None) -> bool:
    name_lower = name.lower()
    if pattern and not fnmatch.fnmatch(name_lower, pattern.lower()):
        return False
    if ext_filter:
        want_ext = ext_filter.lower().lstrip(".")
        actual_ext = name_lower.rsplit(".", 1)[-1] if "." in name_lower else ""
        if actual_ext != want_ext:
            return False
    return True


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract_entry(
    img_file,
    entry: dict,
    out_dir: Path,
    overwrite: bool = False,
    verbose: bool = False,
) -> bool:
    """
    Extract one entry from the open img_file handle into out_dir.
    Returns True if written, False if skipped.
    """
    out_path = out_dir / entry["name"]

    if out_path.exists() and not overwrite:
        if verbose:
            print(f"  SKIP (exists): {entry['name']}")
        return False

    # Seek and read exactly sector_size * SECTOR_SIZE bytes
    img_file.seek(entry["byte_offset"])
    data = img_file.read(entry["byte_size"])

    if len(data) < entry["byte_size"]:
        print(
            f"  WARNING: {entry['name']}: expected {entry['byte_size']} bytes, "
            f"got {len(data)} (truncated?)"
        )

    out_path.write_bytes(data)
    return True


# ---------------------------------------------------------------------------
# Summary helpers
# ---------------------------------------------------------------------------

def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def print_summary_table(entries: list[dict]) -> None:
    from collections import Counter
    ext_stats: dict[str, dict] = {}
    for e in entries:
        ext = e["name"].rsplit(".", 1)[-1].lower() if "." in e["name"] else "(none)"
        s = ext_stats.setdefault(ext, {"count": 0, "bytes": 0})
        s["count"] += 1
        s["bytes"] += e["byte_size"]

    print(f"\n{'Extension':<12} {'Count':>8} {'Total size':>12}")
    print("-" * 34)
    for ext, s in sorted(ext_stats.items(), key=lambda x: -x[1]["count"]):
        print(f"  .{ext:<10} {s['count']:>8,}   {human_bytes(s['bytes']):>10}")
    print("-" * 34)
    total_bytes = sum(e["byte_size"] for e in entries)
    print(f"  {'TOTAL':<10} {len(entries):>8,}   {human_bytes(total_bytes):>10}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Extract files from a GTA .img archive.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("img", help="Path to .img file")
    parser.add_argument("dir", nargs="?", default=None, help="Path to .dir file (V1 only)")
    parser.add_argument("-o", "--output", default=None, help="Output directory")
    parser.add_argument("-f", "--filter", default=None, metavar="PATTERN",
                        help="Glob pattern filter, e.g. '*.txd' or 'ind_*'")
    parser.add_argument("-t", "--type", default=None, metavar="EXT",
                        help="File type filter, e.g. txd, dff, col")
    parser.add_argument("-l", "--list", action="store_true",
                        help="List contents without extracting")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Verbose output")
    parser.add_argument("--overwrite", action="store_true",
                        help="Overwrite existing output files")

    args = parser.parse_args()

    img_path = Path(args.img)
    dir_path = Path(args.dir) if args.dir else None

    if not img_path.exists():
        sys.exit(f"Error: IMG file not found: {img_path}")
    if dir_path and not dir_path.exists():
        sys.exit(f"Error: DIR file not found: {dir_path}")

    # --- Load directory ---
    try:
        entries, fmt = load_directory(img_path, dir_path)
    except (FileNotFoundError, ValueError) as e:
        sys.exit(f"Error: {e}")

    img_size = img_path.stat().st_size
    print(f"Archive:  {img_path.name}  ({human_bytes(img_size)})")
    print(f"Format:   {fmt}")
    print(f"Entries:  {len(entries):,}")

    # --- Apply filters ---
    filtered = [
        e for e in entries
        if matches_filter(e["name"], args.filter, args.type)
    ]

    if args.filter or args.type:
        print(f"Filtered: {len(filtered):,} entries match")

    if not filtered:
        print("No entries match the filter — nothing to do.")
        return

    # --- List mode ---
    if args.list:
        col_w = max(len(e["name"]) for e in filtered)
        print(f"\n{'Name':<{col_w}}  {'Offset':>10}  {'Sectors':>8}  {'Bytes':>10}")
        print("-" * (col_w + 34))
        for e in filtered:
            print(
                f"{e['name']:<{col_w}}  "
                f"{e['sector_offset']:>10,}  "
                f"{e['sector_size']:>8,}  "
                f"{e['byte_size']:>10,}"
            )
        print_summary_table(filtered)
        return

    # --- Extract ---
    if args.output:
        out_dir = Path(args.output)
    else:
        out_dir = img_path.parent / (img_path.stem + "_extracted")

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output:   {out_dir}")
    print()

    written = 0
    skipped = 0
    errors  = 0

    with img_path.open("rb") as img_file:
        for i, entry in enumerate(filtered):
            try:
                ok = extract_entry(
                    img_file, entry, out_dir,
                    overwrite=args.overwrite,
                    verbose=args.verbose,
                )
                if ok:
                    written += 1
                    if args.verbose:
                        print(
                            f"  [{i+1:4d}/{len(filtered)}] "
                            f"{entry['name']:<40} "
                            f"{human_bytes(entry['byte_size']):>10}"
                        )
                else:
                    skipped += 1
            except Exception as e:
                errors += 1
                print(f"  ERROR: {entry['name']}: {e}")

            # Progress for large non-verbose runs
            if not args.verbose and len(filtered) > 50 and (i + 1) % 100 == 0:
                pct = (i + 1) / len(filtered) * 100
                print(f"  {i+1}/{len(filtered)} ({pct:.0f}%)...")

    print(f"\nDone.")
    print(f"  Written:  {written:,}")
    print(f"  Skipped:  {skipped:,}  (already exist, use --overwrite to replace)")
    if errors:
        print(f"  Errors:   {errors:,}")
    print_summary_table(filtered)
    print(f"\nOutput: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
