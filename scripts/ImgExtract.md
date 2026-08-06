# IMG Archive Extraction

How `img_extract.py` unpacks the raw files out of a GTA `.img` archive.

This is a **standalone utility**, separate from the model pipeline. The
converter (`gta_to_gltf.py`) reads models straight out of `gta3.img` and never
needs the files on disk — so `img_extract.py` is only for *inspecting* or
*dumping* the archive's raw contents (`.dff`, `.txd`, `.col`, `.ifp`, `.scm`, …)
for manual poking around.

It reuses the same IMG/DIR archive format described in **`Extraction.md`,
Step 2** — see there for the byte-level directory-entry layout. This document
just covers the extractor's own behaviour.

---

## Overview

```
game.img (+ game.dir) ─► read directory ─► filter ─► write each file to disk
```

The archive is a flat blob of files aligned to 2048-byte sectors, plus a
directory listing each file's sector offset, sector length, and name. The tool
reads that directory, optionally filters it, then seeks into the `.img` and
writes each selected entry out as an individual file.

---

## Step 1 — Load the directory

Two archive versions are auto-detected:

- **V1** (GTA III / Vice City) — a separate `.img` + `.dir` pair. The `.dir` is
  an array of 32-byte entries (`uint32 offset_sectors`, `uint32 size_sectors`,
  `char[24] name`; see `Extraction.md` Step 2). If the `.dir` path isn't given
  on the command line, the tool looks for one with the same stem next to the
  `.img`.
- **V2** (San Andreas) — a single `.img` whose first 4 bytes are the magic
  `VER2`, followed by a `uint32` entry count and then the same 32-byte entries
  embedded in the file.

Detection: an explicit `.dir` argument ⇒ V1; otherwise if the `.img` begins with
`VER2` ⇒ V2; otherwise fall back to an adjacent `.dir`.

GTA III is always V1 (`gta3.img` + `gta3.dir`).

---

## Step 2 — Filter (optional)

The full entry list can be narrowed:

- **`-f PATTERN`** — glob match on the filename (case-insensitive), e.g.
  `"*.txd"` or `"ind_*"`.
- **`-t TYPE`** — match by extension, e.g. `txd`, `dff`, `col`, `ifp`, `scm`.

With no filter, every entry is selected.

---

## Step 3 — Extract

For each selected entry: `byte_offset = offset_sectors × 2048`,
`byte_length = size_sectors × 2048`; seek there in the `.img`, read that many
bytes, and write them to `<output>/<name>`. By default existing files are
skipped (use `--overwrite` to replace).

> **Sector padding.** Extracted files are sized to whole sectors, so a file may
> carry a few trailing padding bytes past its real end. This is harmless for
> RenderWare files — the `.dff`/`.txd` chunk parsers stop at the declared chunk
> size and ignore the tail.

The default output directory is `<img_stem>_extracted` (e.g.
`gta3_extracted/`). When run in **list mode** (`-l`) nothing is written; instead
it prints a table of entries and a per-extension summary (counts and total
size).

---

## Usage

```
python img_extract.py IMG [DIR] [options]
```

| Option | Meaning |
|--------|---------|
| `-o DIR` | Output directory (default `<img_stem>_extracted`) |
| `-f PATTERN` | Glob filter on filename (`"*.txd"`, `"ind_*"`) |
| `-t TYPE` | Extension filter (`txd`, `dff`, `col`, …) |
| `-l` | List contents only — don't extract |
| `-v` | Verbose (list each file as it's written) |
| `--overwrite` | Overwrite existing files instead of skipping |

### Examples

```
# List everything in the GTA III archive with a size summary
python img_extract.py models/gta3.img -l

# Extract only texture dictionaries into ./txds
python img_extract.py models/gta3.img -t txd -o txds

# Extract every model whose name starts with "ind_"
python img_extract.py models/gta3.img -f "ind_*"

# Extract a San Andreas V2 archive (no .dir needed)
python img_extract.py gta_sa.img
```

For V1, the `.dir` is found automatically if it sits beside the `.img`; pass it
explicitly only if it's elsewhere:

```
python img_extract.py models/gta3.img models/gta3.dir
```

---

## Notes

- **Not required for conversion.** `gta_to_gltf.py` reads `gta3.img` directly;
  you don't need to extract first. Use this tool for inspection only.
- Handles GTA III / VC (V1) and San Andreas (V2); the reader logic mirrors the
  `ImgArchive` class in `gta_to_gltf.py`.
