#!/usr/bin/env python3
"""
fonts.py  —  Extract GTA III's bitmap font atlases

`<game root>/models/fonts.txd` holds the three glyph atlases the game draws
all of its text with:

    font1    512x512   the heavy italic face used for menu labels, mission
                       titles and most on-screen text
    font2    1024x1024 the larger/wider face
    pager    256x256   the dot-matrix face for the in-game pager

Each atlas is a fixed 16-column grid of equal cells, indexed by character
code rather than packed by glyph width, so a renderer can compute a cell's
UVs arithmetically. The cells are taller than they are wide: one cell is
atlas_width/16 across by atlas_height/12.8 down — 32x40 for font1, 64x80
for font2, 16x20 for the pager — matching the 1/16 x 1/12.8 sprite the game
samples. Space is cell 0, so the glyph for code c sits at column
(c - 32) % 16, row (c - 32) // 16. Ten rows are filled, covering codes
32..191: ASCII up to 126, then accented Latin (À-ÿ, Æ, Ç, Ñ, ¿, ¡) from 128
upward for the localised text in TEXT/*.gxt. Note the game substitutes a
few slots: the `"` cell holds a triangle button glyph and the `<`/`>` cells
hold arrow glyphs. font1 additionally puts its lowercase letterforms in the
A-Z cells and *italic* versions of them in a-z; font2 is a true two-case
face with no italics.

Important for rendering: the glyphs are solid white with the letterform
carried entirely in the alpha channel. Drawn as-is on a light background
they look blank — the game tints them per-context (white menu text, yellow
highlights, coloured mission text), so multiply by your target colour and
use the alpha as coverage.

Widths are not in the TXD. GTA III ships per-glyph advance widths in the
executable rather than as data, so fixed-cell spacing will look loose
against the original; the menu itself uses proportional spacing.

This is an ordinary multi-texture RenderWare TXD. On PC it sits loose in
`<game root>/models/`; on PS2 it's packed inside MODELS.IMG — run this
project's IMG/DIR extractor first if you're working from the PS2 image so
the loose .txd file exists on disk before pointing this script at it.

This writes:
  viewer/extracted/fonts/<texture>.png   — decoded atlases
  viewer/extracted/fonts.json            — manifest, each entry tagged w/ role
  viewer/public/fonts/font{1,2}.png      — the two text faces, served as-is

The public copies are what src/components/fonts/{Font1,Font2}.tsx point their
CSS masks at; the pager face stays in extracted/ since nothing renders it yet.

Usage:
  python fonts.py                        # <root>/models → viewer/extracted/fonts/
  python fonts.py --models-dir X -o Y
"""

import shutil
from pathlib import Path

import txd_common

# The two general-purpose text faces, as opposed to the pager's own face.
_FONTS = {'font1', 'font2'}

# Where Vite serves static assets from: viewer/public/fonts/<texture>.png is
# fetched by the components as /fonts/<texture>.png.
_PUBLIC_DIR = txd_common.VIEWER / 'public' / 'fonts'

# The measured-ink table the components space their text with.
_WIDTHS_TS = txd_common.VIEWER / 'src' / 'components' / 'fonts' / 'inkWidths.ts'

# Grid shape, as described above: 16 cells across, 12.8 down, of which ten
# rows are filled (codes 32..191).
_COLUMNS = 16
_ROWS = 12.8
_CELLS = 160

# A cell carries a 2px-tall sliver of its neighbour along the right edge at
# alpha <= 8 — DXT decode bleed, not letterform. Ignoring near-transparent
# pixels and columns with almost nothing in them drops it without touching
# anything as thin as a full stop (~6px of ink per column at font1's size).
_MIN_ALPHA = 16
_MIN_COLUMN_PIXELS = 3


def classify(tex_name: str) -> str:
    """Return the manifest role for a fonts.txd texture name."""
    key = tex_name.lower()
    if key in _FONTS:
        return 'font'
    if key == 'pager':
        return 'pager'
    return 'other'


def ink_widths(png: Path) -> list[int]:
    """Measure how far the letterform reaches across each cell, in px.

    Every glyph gets the same cell, so text laid out a cell at a time comes out
    monospaced. The advance widths that made the game's own text proportional
    are in the executable rather than the TXD, but the ink is right here: the
    distance from a cell's left edge to the last column its letterform touches
    is enough to space text by, once the caller adds a gap between letters.

    Returned per cell, 0 for the empty ones, in the atlas's own pixels — the
    renderer scales them along with everything else.
    """
    from PIL import Image

    image = Image.open(png).convert('RGBA')
    width, height = image.size
    alpha = image.split()[3].load()
    cell_w = width // _COLUMNS
    cell_h = int(height / _ROWS)

    widths = []
    for cell in range(_CELLS):
        x0 = (cell % _COLUMNS) * cell_w
        y0 = (cell // _COLUMNS) * cell_h
        ink = 0
        for x in range(cell_w):
            lit = sum(1 for y in range(y0, y0 + cell_h)
                      if alpha[x0 + x, y] >= _MIN_ALPHA)
            if lit >= _MIN_COLUMN_PIXELS:
                ink = x + 1
        widths.append(ink)
    return widths


def write_ink_widths(widths: dict[str, list[int]]) -> None:
    """Write the measured widths out as the components' generated data module."""
    lines = [
        '// Generated by scripts/fonts.py — do not edit by hand.',
        '//',
        "// How far each atlas cell's letterform reaches across it, in the",
        '// atlas\'s own pixels, indexed by cell; 0 where the cell is empty.',
        '// fonts/atlas.ts turns these into the advance widths text is set with.',
        '',
    ]
    for texture in sorted(widths):
        lines.append(f'export const {texture.upper()}_INK_WIDTHS: readonly number[] = [')
        for row in range(0, _CELLS, _COLUMNS):
            first = row + 32
            lines.append(f'    // codes {first}-{first + _COLUMNS - 1}')
            lines.append('    ' + ', '.join(str(w) for w in widths[texture][row:row + _COLUMNS]) + ',')
        lines.append(']')
        lines.append('')
    _WIDTHS_TS.write_text('\n'.join(lines), encoding='utf-8')
    print(f'  WIDTH {len(widths)} faces measured -> {_WIDTHS_TS.name}')


def publish(out_dir: Path, manifest: list[dict]) -> None:
    """Hand the two text faces over to the app: PNGs to public, widths to src."""
    _PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    widths = {}
    for entry in manifest:
        if entry['role'] != 'font':
            continue
        png = out_dir / entry['file']
        shutil.copyfile(png, _PUBLIC_DIR / entry['file'])
        print(f'  COPY  {entry["file"]:20s} -> public/fonts/{entry["file"]}')
        widths[entry['texture']] = ink_widths(png)
    write_ink_widths(widths)


def main() -> None:
    txd_common.run_extractor(
        stem='fonts',
        manifest_key='fonts',
        description='Extract GTA III bitmap font atlases (fonts.txd)',
        classify=classify,
        post=publish,
    )


if __name__ == '__main__':
    main()
