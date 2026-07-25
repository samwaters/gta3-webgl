#!/usr/bin/env python3
"""
gta_to_gltf.py  —  Convert GTA III / Vice City models to glTF 2.0

Writes one .gltf + .bin per model, plus shared PNG textures, into an
output directory.

The DFF (geometry) files never record which TXD (texture dictionary) they
need — that pairing lives only in the game's .ide definition files. So the
converter discovers every .ide under the data directory, builds the
DFF→TXD mapping from them, and reads the models straight out of gta3.img.

Usage
-----
# Convert EVERYTHING, no inputs required (reads models/gta3.img + data/*.ide,
# writes glTFs + a gta3.json manifest into ./extracted).  A full run also
# auto-splits models/Generic/weapons.dff, so no separate --combined step is
# needed for the weapons:
  python gta_to_gltf.py

# Convert everything into a specific folder:
  python gta_to_gltf.py -o ./gltf

# Filter to specific models (glob on model name):
  python gta_to_gltf.py -f "ind_land*"

# Convert a single .ide only:
  python gta_to_gltf.py scene.ide

# Point at a non-default archive / data dir:
  python gta_to_gltf.py --img game.img --img-dir game.dir --data-dir ./data

# Use pre-extracted files instead of the archive:
  python gta_to_gltf.py --dff-dir ./dff --txd-dir ./txd

# Keep GTA's Z-up coordinate system (default converts to Y-up for glTF):
  python gta_to_gltf.py --no-yup

Dependencies
------------
  Python 3.10+
  Pillow  (pip install pillow)  — required for PNG texture export
"""

import argparse
import fnmatch
import json
import os
import re
import struct
import sys
from collections import defaultdict
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SECTOR = 2048

# RenderWare chunk types
RW_STRUCT    = 0x01
RW_STRING    = 0x02
RW_EXTENSION = 0x03
RW_TEXTURE   = 0x06
RW_MATERIAL  = 0x07
RW_MATLIST   = 0x08
RW_FRAMELIST = 0x0E
RW_GEOMETRY  = 0x0F
RW_CLUMP     = 0x10
RW_ATOMIC    = 0x14
RW_TEXNATIVE = 0x15
RW_TEXDICT   = 0x16
RW_GEOMLIST  = 0x1A

# Frame-name extension types (0x0253F2F5 = PC NodeName, 0x0253F2FE = PS2 variant)
RW_NODENAME_PC  = 0x0253F2F5
RW_NODENAME_PS2 = 0x0253F2FE

# Geometry flags
GF_POSITIONS = 0x02
GF_TEXTURED  = 0x04
GF_PRELIT    = 0x08
GF_NORMALS   = 0x10
GF_TEXTURED2 = 0x80

# glTF component types
GL_UNSIGNED_BYTE  = 5121
GL_UNSIGNED_SHORT = 5123
GL_UNSIGNED_INT   = 5125
GL_FLOAT          = 5126

# glTF buffer-view targets
GL_ARRAY_BUFFER         = 34962
GL_ELEMENT_ARRAY_BUFFER = 34963


# ---------------------------------------------------------------------------
# RenderWare chunk helpers
# ---------------------------------------------------------------------------

def iter_chunks(data: bytes, start: int = 0):
    """Yield (type, inner_bytes, rw_version) for each chunk at this level."""
    off = start
    while off + 12 <= len(data):
        ct, cs, cv = struct.unpack_from('<3I', data, off)
        if ct == 0:
            break
        end = off + 12 + cs
        if end > len(data):
            break
        yield ct, data[off + 12 : end], cv
        off = end


def find_chunk(data: bytes, want: int) -> bytes | None:
    """Return inner bytes of the first chunk matching *want*, else None."""
    for ct, cd, _ in iter_chunks(data):
        if ct == want:
            return cd
    return None


def rw_string(data: bytes) -> str:
    """Decode a String-chunk payload (null-stripped)."""
    return data.rstrip(b'\x00').decode('latin-1', errors='replace')


# ---------------------------------------------------------------------------
# IMG / DIR archive reader
# ---------------------------------------------------------------------------

class ImgArchive:
    """
    Lazy reader for GTA .img archives.

    V1 (GTA III / Vice City): paired .img + .dir files
    V2 (San Andreas):         single .img with embedded 'VER2' directory
    """

    def __init__(self, img_path: str | Path, dir_path: str | Path | None = None):
        self.img_path = Path(img_path)
        self._index: dict[str, tuple[int, int]] = {}   # name_lower → (byte_off, byte_len)

        if dir_path:
            self._load_v1(Path(dir_path))
            return

        magic = self.img_path.read_bytes()[:4]
        if magic == b'VER2':
            self._load_v2()
        else:
            auto = self.img_path.with_suffix('.dir')
            if auto.exists():
                self._load_v1(auto)
            else:
                raise FileNotFoundError(
                    f"No directory found for {img_path}. "
                    "Pass --img-dir, or use a V2 (VER2) archive."
                )

    def _load_v1(self, dir_path: Path) -> None:
        raw = dir_path.read_bytes()
        for i in range(len(raw) // 32):
            off = i * 32
            sec, sz = struct.unpack_from('<2I', raw, off)
            name = raw[off + 8 : off + 32].rstrip(b'\x00').decode('latin-1')
            if name:
                self._index[name.lower()] = (sec * SECTOR, sz * SECTOR)

    def _load_v2(self) -> None:
        with self.img_path.open('rb') as f:
            count = struct.unpack('<I', f.read(8)[4:])[0]
            for _ in range(count):
                raw = f.read(32)
                sec, sz = struct.unpack_from('<2I', raw)
                name = raw[8:].rstrip(b'\x00').decode('latin-1')
                if name:
                    self._index[name.lower()] = (sec * SECTOR, sz * SECTOR)

    def read(self, filename: str) -> bytes | None:
        entry = self._index.get(filename.lower())
        if entry is None:
            return None
        off, sz = entry
        with self.img_path.open('rb') as f:
            f.seek(off)
            return f.read(sz)

    def __contains__(self, filename: str) -> bool:
        return filename.lower() in self._index

    def __len__(self) -> int:
        return len(self._index)

    def names(self) -> list[str]:
        """All entry names (lower-cased) in the archive."""
        return list(self._index.keys())


# ---------------------------------------------------------------------------
# IDE parser
# ---------------------------------------------------------------------------

# IDE sections whose rows begin  id, model, txd, ...
# (objs = static, tobj = timed, cars = vehicles, peds = characters,
#  hier = cutscene objects).  All share the same first three columns.
IDE_MODEL_SECTIONS = {'objs', 'tobj', 'cars', 'peds', 'hier'}


def parse_ide(path: Path) -> list[dict]:
    """
    Parse every model-defining section of an IDE file.

    Each returned dict has: id, name, txd, section.  The first three columns
    (id, model, txd) are identical across objs/tobj/cars/peds/hier, which is
    all we need for the DFF→TXD pairing.
    """
    entries = []
    section = None

    for raw_line in path.read_text(errors='replace').splitlines():
        line = raw_line.split('#')[0].strip()
        if not line:
            continue
        low = line.lower()
        if low == 'end':
            section = None
            continue
        # A bare keyword (no comma) opens a new section.
        if ',' not in line:
            section = low
            continue
        if section not in IDE_MODEL_SECTIONS:
            continue

        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 3:
            continue
        try:
            entries.append({
                'id':      int(parts[0]),
                'name':    parts[1].lower(),
                'txd':     parts[2].lower(),
                'section': section,
            })
        except (ValueError, IndexError):
            pass

    return entries


def discover_ides(data_dir: Path) -> list[Path]:
    """Every .ide file under *data_dir* (case-insensitive), sorted."""
    return sorted(
        p for p in data_dir.rglob('*')
        if p.is_file() and p.suffix.lower() == '.ide'
    )


def collect_entries(ide_paths: list[Path]) -> tuple[list[dict], dict[str, dict]]:
    """
    Parse many IDEs into one de-duplicated model list.

    Returns (ordered_entries, by_name).  Each model is converted once (first
    definition wins, matching the engine, which ignores duplicate IDs), but
    every entry records *all* the IDEs that reference it in e['ides'] — so a
    model listed in both gta3.IDE and a district IDE is indexed under both in
    the manifest.
    """
    by_name: dict[str, dict] = {}
    order: list[dict] = []
    for ide in ide_paths:
        try:
            rows = parse_ide(ide)
        except Exception as exc:                       # noqa: BLE001
            print(f'  WARNING: failed to parse {ide}: {exc}')
            continue
        for e in rows:
            existing = by_name.get(e['name'])
            if existing is None:
                e['ides'] = [ide]
                by_name[e['name']] = e
                order.append(e)
            elif ide not in existing['ides']:
                existing['ides'].append(ide)
    return order, by_name


def add_archive_orphans(archive, by_name: dict[str, dict],
                        order: list[dict]) -> int:
    """
    Append any .dff in the archive not covered by an IDE.

    These are mission / interior objects loaded by main.scm rather than a map
    IDE.  In GTA III every such model ships with a same-named TXD, so
    txd = model-name is a safe fallback.
    """
    added = 0
    for fname in archive.names():
        if not fname.endswith('.dff'):
            continue
        name = fname[:-4]
        if name not in by_name:
            e = {'id': -1, 'name': name, 'txd': name,
                 'section': 'orphan', 'ides': []}
            by_name[name] = e
            order.append(e)
            added += 1
    return added


def manifest_keys(ide_path: Path, root: Path) -> list[str]:
    """
    Turn an IDE file path into nested manifest keys mirroring its location.

        data/maps/COMSW/COMSW.ide  →  ['data', 'maps', 'comsw']
        data/maps/generic.ide      →  ['data', 'maps', 'generic']
        data/default.ide           →  ['data', 'default']

    Path components are lower-cased, and a component equal to the one before
    it is collapsed (so COMSW/COMSW.ide nests once, not twice).
    """
    try:
        rel = ide_path.resolve().relative_to(root)
    except ValueError:
        rel = Path(ide_path.name)
    keys: list[str] = []
    for part in rel.with_suffix('').parts:      # drop the .ide extension
        low = part.lower()
        if keys and keys[-1] == low:
            continue
        keys.append(low)
    return keys


def manifest_insert(tree: dict, keys: list[str], model: str, value: str) -> None:
    """Insert model→value into *tree* at the nested path *keys*."""
    node = tree
    for k in keys:
        node = node.setdefault(k, {})
    node[model] = value


# ---------------------------------------------------------------------------
# DFF (RenderWare Clump) parser
# ---------------------------------------------------------------------------

class DFFGeometry:
    """All mesh data extracted from one DFF file."""
    __slots__ = (
        'name', 'flags',
        'verts', 'normals', 'uvs', 'colors',
        'triangles',   # list of (v1, v2, v3, mat_id)
        'materials',   # list of dicts
        'bsphere',     # (cx, cy, cz, radius)
    )

    def __init__(self):
        self.name      = ''
        self.flags     = 0
        self.verts     = []
        self.normals   = []
        self.uvs       = []
        self.colors    = []
        self.triangles = []
        self.materials = []
        self.bsphere   = (0.0, 0.0, 0.0, 1.0)


def _parse_geometry_struct(raw: bytes, geo: DFFGeometry) -> None:
    """
    Fill *geo* from a Geometry Struct inner payload.

    Layout (RW 3.1, GTA3 / GTA VC):
        uint32  flags
        uint32  n_triangles
        uint32  n_vertices
        uint32  n_morph_targets
        float   ambient, specular, diffuse   ← surface properties
        if PRELIT:   RGBA8[n_verts]
        if TEXTURED: float32[2][n_verts]     ← UV set 1
        if TEXTURED2:float32[2][n_verts]     ← UV set 2 (skipped)
        uint16[4][n_tri]                     ← v2, v1, mat_id, v3
        float32[4]  bsphere cx,cy,cz,radius
        uint32      has_positions
        uint32      has_normals
        float32[3][n_verts]                  ← positions
        float32[3][n_verts]                  ← normals (if has_normals)
    """
    if len(raw) < 28:
        return

    flags, n_tri, n_verts, n_morph = struct.unpack_from('<4I', raw, 0)
    geo.flags = flags
    cur = 16 + 12   # skip counts (16) + surface properties (12)

    if n_verts == 0:
        return

    # ── Vertex colours ──────────────────────────────────────────────────
    if flags & GF_PRELIT:
        end = cur + n_verts * 4
        if end > len(raw):
            return
        geo.colors = [
            (raw[cur + i*4],     raw[cur + i*4 + 1],
             raw[cur + i*4 + 2], raw[cur + i*4 + 3])
            for i in range(n_verts)
        ]
        cur = end

    # ── UV set 1 ────────────────────────────────────────────────────────
    if flags & GF_TEXTURED:
        end = cur + n_verts * 8
        if end > len(raw):
            return
        geo.uvs = [
            struct.unpack_from('<2f', raw, cur + i*8)
            for i in range(n_verts)
        ]
        cur = end

    # ── UV set 2 (skip) ─────────────────────────────────────────────────
    if flags & GF_TEXTURED2:
        cur += n_verts * 8

    # ── Triangle list  (v2, v1, mat_id, v3) ─────────────────────────────
    end = cur + n_tri * 8
    if end > len(raw):
        return
    geo.triangles = [
        struct.unpack_from('<4H', raw, cur + i*8)
        for i in range(n_tri)
    ]
    cur = end

    # ── Bounding sphere + presence flags ─────────────────────────────────
    if cur + 24 > len(raw):
        return
    geo.bsphere = struct.unpack_from('<4f', raw, cur)
    has_pos = struct.unpack_from('<I', raw, cur + 16)[0]
    has_nrm = struct.unpack_from('<I', raw, cur + 20)[0]
    cur += 24

    # ── Positions ────────────────────────────────────────────────────────
    if has_pos:
        end = cur + n_verts * 12
        if end > len(raw):
            return
        geo.verts = [
            struct.unpack_from('<3f', raw, cur + i*12)
            for i in range(n_verts)
        ]
        cur = end

    # ── Normals ──────────────────────────────────────────────────────────
    if has_nrm:
        end = cur + n_verts * 12
        if end <= len(raw):
            geo.normals = [
                struct.unpack_from('<3f', raw, cur + i*12)
                for i in range(n_verts)
            ]


def _parse_texture_chunk(tex_data: bytes) -> str:
    """Extract the texture name from a Texture chunk's inner bytes."""
    # Children: Struct (filter flags), String (name), String (mask), Extension
    names = []
    for ct, cd, _ in iter_chunks(tex_data):
        if ct == RW_STRING:
            s = rw_string(cd)
            # Ignore strings that are empty or pure garbage after a leading null
            if s and not s.startswith('\x00'):
                names.append(s)
        if len(names) >= 2:
            break
    return names[0] if names else ''


def _parse_material_chunk(mat_data: bytes) -> dict:
    """
    Parse one Material chunk's inner bytes.

    Material Struct layout (28 bytes):
        uint32  flags
        uint8   r, g, b, a          ← base colour
        uint32  unused
        uint32  is_textured
        float32 ambient, specular, diffuse
    """
    mat = {'color': (255, 255, 255, 255), 'has_tex': 0, 'tex_name': ''}

    st = find_chunk(mat_data, RW_STRUCT)
    if st is None or len(st) < 16:
        return mat

    mat['color']   = struct.unpack_from('<4B', st, 4)   # RGBA
    mat['has_tex'] = struct.unpack_from('<I',  st, 12)[0]

    if mat['has_tex']:
        tex_data = find_chunk(mat_data, RW_TEXTURE)
        if tex_data is not None:
            mat['tex_name'] = _parse_texture_chunk(tex_data)

    return mat


def _parse_matlist(ml_data: bytes, geo: DFFGeometry) -> None:
    """Parse a MaterialList chunk and populate geo.materials."""
    for ct, cd, _ in iter_chunks(ml_data):
        if ct == RW_MATERIAL:
            geo.materials.append(_parse_material_chunk(cd))


def _find_frame_name(clump_data: bytes) -> str:
    """
    Search the FrameList for the root frame's name.

    GTA III PS2 uses extension type 0x0253F2FE;
    PC / VC uses 0x0253F2F5 (NodeName).
    We accept both.
    """
    fl_data = find_chunk(clump_data, RW_FRAMELIST)
    if fl_data is None:
        return ''

    # Walk every chunk inside FrameList (Extensions carry per-frame names)
    for ct, cd, _ in iter_chunks(fl_data):
        if ct != RW_EXTENSION:
            continue
        for ict, icd, _ in iter_chunks(cd):
            if ict in (RW_NODENAME_PC, RW_NODENAME_PS2):
                name = rw_string(icd)
                if name:
                    return name
    return ''


def parse_dff(data: bytes) -> DFFGeometry | None:
    """
    Parse a complete DFF file.  Returns a DFFGeometry, or None on failure.
    Only the first Geometry in the GeometryList is processed (sufficient for
    static world objects; character / vehicle rigs are more complex).
    """
    geo = DFFGeometry()

    clump = find_chunk(data, RW_CLUMP)
    if clump is None:
        return None

    # Frame name
    geo.name = _find_frame_name(clump)

    # Geometry
    geomlist = find_chunk(clump, RW_GEOMLIST)
    if geomlist is None:
        return None

    geom = find_chunk(geomlist, RW_GEOMETRY)
    if geom is None:
        return None

    st = find_chunk(geom, RW_STRUCT)
    if st is None:
        return None
    _parse_geometry_struct(st, geo)

    ml = find_chunk(geom, RW_MATLIST)
    if ml is not None:
        _parse_matlist(ml, geo)

    return geo if geo.verts else None


def _frame_names(clump: bytes) -> list[str]:
    """Frame names in index order ('' where a frame is unnamed)."""
    fl = find_chunk(clump, RW_FRAMELIST)
    if fl is None:
        return []
    names = []
    for ct, cd, _ in iter_chunks(fl):        # one Extension per frame, in order
        if ct != RW_EXTENSION:
            continue
        nm = ''
        for ict, icd, _ in iter_chunks(cd):
            if ict in (RW_NODENAME_PC, RW_NODENAME_PS2):
                nm = rw_string(icd)
                break
        names.append(nm)
    return names


def parse_dff_atomics(data: bytes) -> list[DFFGeometry]:
    """
    Split a *combined* DFF into one named DFFGeometry per model.

    Files like models/Generic/weapons.dff, peds.dff and wheels.DFF pack many
    models into a single clump: N geometries in the GeometryList plus N Atomics,
    each binding a frame (which carries the model's name) to a geometry.  This
    returns one DFFGeometry per atomic with renderable geometry, its .name set
    from the bound frame.
    """
    clump = find_chunk(data, RW_CLUMP)
    if clump is None:
        return []
    frame_names = _frame_names(clump)
    geomlist = find_chunk(clump, RW_GEOMLIST)
    if geomlist is None:
        return []
    geoms = [cd for ct, cd, _ in iter_chunks(geomlist) if ct == RW_GEOMETRY]

    out = []
    for ct, cd, _ in iter_chunks(clump):
        if ct != RW_ATOMIC:
            continue
        st = find_chunk(cd, RW_STRUCT)
        if st is None or len(st) < 8:
            continue
        frame_idx, geo_idx = struct.unpack_from('<2I', st, 0)
        if not (0 <= geo_idx < len(geoms)):
            continue
        gs = find_chunk(geoms[geo_idx], RW_STRUCT)
        if gs is None:
            continue
        geo = DFFGeometry()
        _parse_geometry_struct(gs, geo)
        ml = find_chunk(geoms[geo_idx], RW_MATLIST)
        if ml is not None:
            _parse_matlist(ml, geo)
        if not geo.verts:
            continue
        geo.name = (frame_names[frame_idx]
                    if 0 <= frame_idx < len(frame_names) else f'geo{geo_idx}')
        out.append(geo)
    return out


def _frame_transforms(clump: bytes) -> list[tuple]:
    """
    Per-frame local transform + parent, in frame-index order.

    FrameList Struct layout: uint32 count, then count × 56 bytes:
        float32 rot[9]   ← RenderWare RwMatrix basis: right, up, at (columns)
        float32 pos[3]
        int32   parent   (-1 for the root)
        int32   flags
    Returns [(rot9, pos3, parent), …].
    """
    fl = find_chunk(clump, RW_FRAMELIST)
    if fl is None:
        return []
    st = find_chunk(fl, RW_STRUCT)
    if st is None or len(st) < 4:
        return []
    n = struct.unpack_from('<I', st, 0)[0]
    out = []
    for i in range(n):
        off = 4 + i * 56
        if off + 56 > len(st):
            break
        rot    = struct.unpack_from('<9f', st, off)
        pos    = struct.unpack_from('<3f', st, off + 36)
        parent = struct.unpack_from('<i',  st, off + 48)[0]
        out.append((rot, pos, parent))
    return out


def _apply_frame(rot, pos, v, translate=True):
    """world = rot · v (+ pos).  rot9 stores basis vectors right/up/at as columns."""
    x, y, z = v
    wx = rot[0]*x + rot[3]*y + rot[6]*z
    wy = rot[1]*x + rot[4]*y + rot[7]*z
    wz = rot[2]*x + rot[5]*y + rot[8]*z
    if translate:
        return (wx + pos[0], wy + pos[1], wz + pos[2])
    return (wx, wy, wz)


def _to_model(frames, idx, v, translate=True):
    """Transform a local point (or vector) up the frame parent chain to model space."""
    while 0 <= idx < len(frames):
        rot, pos, parent = frames[idx]
        v = _apply_frame(rot, pos, v, translate=translate)
        idx = parent
    return v


def _detail_key(fname: str) -> tuple[str, int, bool]:
    """
    Classify an atomic's frame name into (base_part, detail_rank, is_damage).

    RenderWare packs a part's LOD/damage variants as separate atomics that
    differ only by a suffix: `_L0`/`_L1`/`_L2` (LOD level), `_hi`/`_lo`/`_vlo`
    (detail), `_ok`/`_dam` (damage state).  Grouping by the *base* name (suffixes
    stripped) tells apart a genuine composite (chassis + door + …, many bases)
    from one mesh shipped at several detail levels (a rail-track piece: one base,
    L0 + L1).  Lower rank = higher detail (the variant to keep).
    """
    f = fname.lower()
    is_dam = '_dam' in f
    rank = 0
    m = re.search(r'_l(\d+)(?:_|$)', f)          # _L0, _L1, …
    if m:
        rank = int(m.group(1))
    elif '_vlo' in f:
        rank = 100
    elif re.search(r'_lo(?:_|$)', f):
        rank = 50
    base = f
    while True:                                  # strip trailing detail/damage tokens
        new = re.sub(r'_(l\d+|vlo|lo|hi|ok|dam)$', '', base)
        if new == base:
            break
        base = new
    return base, rank, is_dam


def parse_dff_assembled(data: bytes) -> DFFGeometry | None:
    """
    Assemble a multi-part model into a single DFFGeometry.

    Every atomic is grouped by its logical part (`_detail_key`), keeping only
    the highest-detail, undamaged variant of each — this drops LOD duplicates
    (`…_L1`/`_vlo`/`_lo`) and damage variants (`…_dam`) that would otherwise
    overlap the intact mesh.  Then, if a single part remains it is emitted at the
    object origin (a mesh shipped only as LODs, e.g. a rail-track piece); if
    several remain they are a composite (a vehicle) and are merged with their
    frame-hierarchy transforms.
    """
    clump = find_chunk(data, RW_CLUMP)
    if clump is None:
        return None
    frames = _frame_transforms(clump)
    fnames = _frame_names(clump)
    geomlist = find_chunk(clump, RW_GEOMLIST)
    if geomlist is None:
        return None
    geoms = [cd for ct, cd, _ in iter_chunks(geomlist) if ct == RW_GEOMETRY]

    groups: dict = {}          # base name → (rank, frame_idx, DFFGeometry)
    order: list = []           # first-seen base order (stable output)
    for ct, cd, _ in iter_chunks(clump):
        if ct != RW_ATOMIC:
            continue
        st = find_chunk(cd, RW_STRUCT)
        if st is None or len(st) < 8:
            continue
        frame_idx, geo_idx = struct.unpack_from('<2I', st, 0)
        if not (0 <= geo_idx < len(geoms)):
            continue
        fname = fnames[frame_idx] if 0 <= frame_idx < len(fnames) else ''
        base, rank, is_dam = _detail_key(fname)
        if is_dam:                                   # never keep damage variants
            continue
        gs = find_chunk(geoms[geo_idx], RW_STRUCT)
        if gs is None:
            continue
        g = DFFGeometry()
        _parse_geometry_struct(gs, g)
        ml = find_chunk(geoms[geo_idx], RW_MATLIST)
        if ml is not None:
            _parse_matlist(ml, g)
        if not g.verts:
            continue
        if base not in groups:
            order.append(base)
            groups[base] = (rank, frame_idx, g)
        elif rank < groups[base][0]:                 # keep the higher-detail variant
            groups[base] = (rank, frame_idx, g)

    parts = [groups[b] for b in order]               # one (rank, frame_idx, geo) per part
    if not parts:
        return None

    # A single logical part (e.g. a rail-track piece shipped as L0 + L1 LODs) is
    # really one mesh: emit its highest-detail geometry at the object origin,
    # exactly as a single-atomic static object would be.  Its per-atomic frame
    # offset is just editor layout for the LODs and must NOT be applied.
    if len(parts) == 1:
        _, _, g = parts[0]
        g.name = fnames[0] if fnames else ''
        return g

    # Several distinct parts → a composite (a vehicle: chassis + doors + …).
    # Merge them, transforming each up its frame parent chain into model space.
    # Merge only the attributes every part carries, so the arrays stay aligned.
    have_uv  = all(len(g.uvs)     == len(g.verts) for _, _, g in parts)
    have_col = all(len(g.colors)  == len(g.verts) for _, _, g in parts)
    have_nrm = all(len(g.normals) == len(g.verts) for _, _, g in parts)

    merged = DFFGeometry()
    merged.name = fnames[0] if fnames else 'model'
    for _, frame_idx, g in parts:
        base_v = len(merged.verts)
        base_m = len(merged.materials)
        merged.verts.extend(_to_model(frames, frame_idx, v) for v in g.verts)
        if have_uv:
            merged.uvs.extend(g.uvs)
        if have_col:
            merged.colors.extend(g.colors)
        if have_nrm:
            merged.normals.extend(
                _to_model(frames, frame_idx, n, translate=False) for n in g.normals)
        for v2, v1, mat_id, v3 in g.triangles:
            merged.triangles.append(
                (v2 + base_v, v1 + base_v, mat_id + base_m, v3 + base_v))
        merged.materials.extend(g.materials)
    return merged


def parse_dff_model(data: bytes) -> DFFGeometry | None:
    """
    Parse one world/vehicle DFF, choosing the right strategy automatically.

    A DFF with a single Atomic is a simple object → take its geometry
    (parse_dff).  A DFF with several Atomics is a multi-part object — a vehicle
    (chassis + doors + …) or any composite mesh — and must be assembled from
    all its parts via the frame hierarchy (parse_dff_assembled), otherwise only
    the first fragment (e.g. one car door) would be exported.
    """
    clump = find_chunk(data, RW_CLUMP)
    if clump is None:
        return None
    n_atomics = sum(1 for ct, _, _ in iter_chunks(clump) if ct == RW_ATOMIC)
    if n_atomics > 1:
        return parse_dff_assembled(data)
    return parse_dff(data)


def clean_model_name(name: str) -> str:
    """Strip the LOD suffix and lower-case: 'ak47_l0' → 'ak47'."""
    return re.sub(r'_l\d+$', '', name.strip(), flags=re.IGNORECASE).lower()


# ---------------------------------------------------------------------------
# TXD (RenderWare Texture Dictionary) parser
# ---------------------------------------------------------------------------

def _decode_ps2(st: bytes) -> tuple[int, int, bytes] | None:
    """
    Decode a PS2 TextureNative struct payload (platform 8).
    Returns (width, height, rgba_bytes) or None.

    Handles PSMT8 (8-bpp paletted) and direct 32-bpp RGBA rasters.

    Struct layout:
        +0   uint32  platform (8)
        +4   uint32  filter / addressing flags
        +8   char[32] texture name
        +40  char[32] mask name
        +72  uint32  raster format
        +76  uint32  [unused / GS param]
        +80  uint16  width,  uint16 height   (little-endian; e.g. 256 = 00 01)
        +84  uint32  format flags  (lower byte = bpp: 8 = PSMT8, 32 = direct)
        +88  8-bpp:  ARGB8[256] CLUT (1024 bytes)
             +then   uint32 pixel-data size, then pixel data
             16/32-bpp: uint32 pixel-data size, then pixel data (no palette)

    The pixel block is preceded by a uint32 byte-count.  Skipping it (reading
    pixels 4 bytes early) shifts the whole image ~4 bytes / a few pixels to the
    right — subtle on one texture, but it accumulates into visible seams on
    tiling signs.
    """
    if len(st) < 88:
        return None

    w   = struct.unpack_from('<H', st, 80)[0]
    h   = struct.unpack_from('<H', st, 82)[0]
    bpp = st[84] & 0xFF

    if w == 0 or h == 0:
        return None

    if bpp == 32:
        # Direct colour: PS2 stores these pixels B,G,R,A in memory (unlike the
        # PSMT8 CLUT, which is R,G,B,A) — so swap R and B.  Alpha is 0-128.
        need = w * h * 4
        px_off = 88 + 4                       # skip the pixel-size field
        if len(st) < px_off + need:
            return None
        px   = st[px_off : px_off + need]
        rgba = bytearray(need)
        for i in range(w * h):
            b, g, r, a = px[i*4], px[i*4+1], px[i*4+2], px[i*4+3]
            rgba[i*4 : i*4+4] = bytes([r, g, b, min(255, a << 1)])
        return w, h, bytes(rgba)

    if bpp == 16:
        # PS2 PSMCT16, like the 32-bpp path, stores B,G,R (not R,G,B): the
        # uint16 is B:0-4 G:5-9 R:10-14 A:15.
        need = w * h * 2
        px_off = 88 + 4                       # skip the pixel-size field
        if len(st) < px_off + need:
            return None
        px   = st[px_off : px_off + need]
        rgba = bytearray(w * h * 4)
        for i in range(w * h):
            v = px[i*2] | (px[i*2 + 1] << 8)
            rgba[i*4 : i*4+4] = bytes([
                ((v >> 10) & 0x1F) * 255 // 31,   # R
                ((v >>  5) & 0x1F) * 255 // 31,   # G
                ( v        & 0x1F) * 255 // 31,   # B
                255 if (v >> 15) & 1 else 0,      # A (1-bit)
            ])
        return w, h, bytes(rgba)

    if bpp != 8:
        return None

    # PSMT8 paletted: CLUT (1024 bytes) then a uint32 pixel-size field, then
    # the index data.
    clut_off  = 88
    pixel_off = clut_off + 1024 + 4           # +4 skips the pixel-size field

    if len(st) < pixel_off + w * h:
        return None

    # GTA III PS2 TXDs store the CLUT already in linear order (not in the
    # PS2 GS swizzled block layout), so it is read as-is.
    clut = struct.unpack_from('<256I', st, clut_off)

    # Build RGBA palette.  PS2 CLUT entries are stored as R,G,B,A bytes
    # (R in the low byte of the little-endian word), and alpha is 0-128 so
    # it's scaled to 0-255.
    palette = []
    for entry in clut:
        r =  entry        & 0xFF
        g = (entry >>  8) & 0xFF
        b = (entry >> 16) & 0xFF
        a = min(255, ((entry >> 24) & 0xFF) << 1)
        palette.append(bytes([r, g, b, a]))

    indices = st[pixel_off : pixel_off + w * h]
    rgba    = b''.join(palette[i] for i in indices)
    return w, h, rgba


def _decode_d3d8(st: bytes) -> tuple[int, int, bytes] | None:
    """
    Decode a PC D3D8 TextureNative struct payload.
    Handles raw ARGB8, DXT1, and DXT3.

    Struct layout (partial):
        +0   uint32  platform (9)
        ...
        +72  uint16  width
        +74  uint16  height
        +76  uint8   depth (bpp)
        +77  uint8   mip levels
        +78  uint8   raster type
        +79  uint8   compression (0=raw, 1=DXT1, 3=DXT3)
        +80  uint32  flags
        +84  uint32  data size (mip 0)
        +88  uint8[] pixel data
    """
    if len(st) < 88:
        return None

    w   = struct.unpack_from('<H', st, 72)[0]
    h   = struct.unpack_from('<H', st, 74)[0]
    fmt = st[79]   # 0=raw ARGB8, 1=DXT1, 3=DXT3

    if w == 0 or h == 0:
        return None

    px_size = struct.unpack_from('<I', st, 84)[0]
    px      = st[88 : 88 + px_size]

    if fmt == 0:                        # Raw ARGB8
        if len(px) < w * h * 4:
            return None
        rgba = bytearray(w * h * 4)
        for i in range(w * h):
            b, g, r, a = px[i*4], px[i*4+1], px[i*4+2], px[i*4+3]
            rgba[i*4 : i*4+4] = bytes([r, g, b, a])
        return w, h, bytes(rgba)

    if fmt == 1:                        # DXT1
        return w, h, _dxt1_to_rgba(px, w, h)

    if fmt == 3:                        # DXT3
        return w, h, _dxt3_to_rgba(px, w, h)

    return None


def _unpack_565(c: int) -> tuple[int, int, int]:
    r = ((c >> 11) & 0x1F) * 255 // 31
    g = ((c >>  5) & 0x3F) * 255 // 63
    b = ( c        & 0x1F) * 255 // 31
    return r, g, b


def _dxt1_to_rgba(data: bytes, w: int, h: int) -> bytes:
    rgba = bytearray(w * h * 4)
    bx = (w + 3) // 4
    by = (h + 3) // 4
    for row in range(by):
        for col in range(bx):
            off    = (row * bx + col) * 8
            c0, c1 = struct.unpack_from('<HH', data, off)
            lut    = struct.unpack_from('<I',  data, off + 4)[0]
            r0,g0,b0 = _unpack_565(c0)
            r1,g1,b1 = _unpack_565(c1)
            if c0 > c1:
                cols = [
                    (r0,g0,b0,255), (r1,g1,b1,255),
                    ((2*r0+r1)//3,(2*g0+g1)//3,(2*b0+b1)//3,255),
                    ((r0+2*r1)//3,(g0+2*g1)//3,(b0+2*b1)//3,255),
                ]
            else:
                cols = [
                    (r0,g0,b0,255), (r1,g1,b1,255),
                    ((r0+r1)//2,(g0+g1)//2,(b0+b1)//2,255),
                    (0,0,0,0),
                ]
            for py in range(4):
                for px in range(4):
                    x, y = col*4+px, row*4+py
                    if x < w and y < h:
                        ci  = (lut >> ((py*4+px)*2)) & 3
                        idx = (y*w+x)*4
                        rgba[idx:idx+4] = bytes(cols[ci])
    return bytes(rgba)


def _dxt3_to_rgba(data: bytes, w: int, h: int) -> bytes:
    rgba = bytearray(w * h * 4)
    bx = (w + 3) // 4
    by = (h + 3) // 4
    for row in range(by):
        for col in range(bx):
            off    = (row * bx + col) * 16
            abits  = struct.unpack_from('<Q', data, off)[0]
            c0, c1 = struct.unpack_from('<HH', data, off + 8)
            lut    = struct.unpack_from('<I',  data, off + 12)[0]
            r0,g0,b0 = _unpack_565(c0)
            r1,g1,b1 = _unpack_565(c1)
            cols = [
                (r0,g0,b0), (r1,g1,b1),
                ((2*r0+r1)//3,(2*g0+g1)//3,(2*b0+b1)//3),
                ((r0+2*r1)//3,(g0+2*g1)//3,(b0+2*b1)//3),
            ]
            for py in range(4):
                for px in range(4):
                    x, y = col*4+px, row*4+py
                    if x < w and y < h:
                        ci  = (lut  >> ((py*4+px)*2)) & 3
                        ai  =  (py*4+px)
                        a   = ((abits >> (ai*4)) & 0xF) * 17
                        r,g,b = cols[ci]
                        idx = (y*w+x)*4
                        rgba[idx:idx+4] = bytes([r,g,b,a])
    return bytes(rgba)


def parse_txd(data: bytes) -> dict[str, tuple[int, int, bytes]]:
    """
    Parse a TXD binary.
    Returns {texture_name_lower: (width, height, rgba_bytes)}.
    Supports PS2 PSMT8 (platform 8) and PC D3D8 (platform 9).
    """
    textures: dict[str, tuple[int, int, bytes]] = {}

    # The file might wrap everything in a TXDict chunk, or be raw inner content
    inner = find_chunk(data, RW_TEXDICT)
    blob  = inner if inner is not None else data

    for ct, tn_data, _ in iter_chunks(blob):
        if ct != RW_TEXNATIVE:
            continue

        st = find_chunk(tn_data, RW_STRUCT)
        if st is None or len(st) < 12:
            continue

        platform = struct.unpack_from('<I', st, 0)[0]
        tex_name = st[8:40].rstrip(b'\x00').decode('latin-1', errors='replace')

        result = None
        if platform == 8:
            result = _decode_ps2(st)
        elif platform == 9:
            result = _decode_d3d8(st)

        if result is not None:
            w, h, rgba = result
            textures[tex_name.lower()] = (w, h, rgba)

    return textures


# ---------------------------------------------------------------------------
# glTF 2.0 builder
# ---------------------------------------------------------------------------

def _align4(buf: BytesIO) -> None:
    pad = (-buf.tell()) % 4
    if pad:
        buf.write(b'\x00' * pad)


def build_gltf(
    geo:         DFFGeometry,
    textures:    dict[str, tuple[int, int, bytes]],
    out_dir:     Path,
    model_name:  str,
    tex_out_dir: Path,
    txd_name:    str = '',
    yup:         bool = True,
) -> bool:
    """
    Write <model_name>.gltf and <model_name>.bin into *out_dir*.
    Textures are written as PNG into *tex_out_dir*.
    Returns True on success.
    """
    if not geo.verts or not geo.triangles:
        return False

    n_verts = len(geo.verts)

    # ── Coordinate system ──────────────────────────────────────────────
    # GTA uses Z-up right-handed; glTF uses Y-up right-handed.
    # Transform: (x, y, z)_GTA  →  (x, z, -y)_glTF
    if yup:
        verts   = [(x,  z, -y) for x, y, z in geo.verts]
        normals = [(nx, nz, -ny) for nx, ny, nz in geo.normals] if geo.normals else []
    else:
        verts   = list(geo.verts)
        normals = list(geo.normals)

    # ── Group triangles by material ────────────────────────────────────
    # DFF triangle tuple: (v2, v1, mat_id, v3)  — note v1/v2 order
    mat_groups: dict[int, list[tuple[int,int,int]]] = defaultdict(list)
    for v2, v1, mat_id, v3 in geo.triangles:
        mat_groups[mat_id].append((v1, v2, v3))

    if not mat_groups:
        return False

    # ── Binary buffer ──────────────────────────────────────────────────
    buf          = BytesIO()
    buffer_views = []
    accessors    = []

    def add_bv(data: bytes, target: int | None = None) -> int:
        _align4(buf)
        bv: dict = {'buffer': 0, 'byteOffset': buf.tell(), 'byteLength': len(data)}
        if target is not None:
            bv['target'] = target
        buf.write(data)
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def add_acc(bv_idx, comp_type, count, acc_type,
                normalized=False, min_v=None, max_v=None) -> int:
        acc: dict = {
            'bufferView':    bv_idx,
            'byteOffset':    0,
            'componentType': comp_type,
            'count':         count,
            'type':          acc_type,
        }
        if normalized:
            acc['normalized'] = True
        if min_v is not None:
            acc['min'] = min_v
            acc['max'] = max_v
        accessors.append(acc)
        return len(accessors) - 1

    # Positions  (VEC3 float)
    pos_bytes = struct.pack(f'<{n_verts*3}f', *[c for v in verts for c in v])
    pos_acc   = add_acc(
        add_bv(pos_bytes, GL_ARRAY_BUFFER),
        GL_FLOAT, n_verts, 'VEC3',
        min_v=[min(v[i] for v in verts) for i in range(3)],
        max_v=[max(v[i] for v in verts) for i in range(3)],
    )

    # UV coords  (VEC2 float)
    uv_acc = None
    if geo.uvs and len(geo.uvs) == n_verts:
        uv_bytes = struct.pack(f'<{n_verts*2}f', *[c for uv in geo.uvs for c in uv])
        uv_acc   = add_acc(
            add_bv(uv_bytes, GL_ARRAY_BUFFER),
            GL_FLOAT, n_verts, 'VEC2',
        )

    # Vertex colours  (VEC4 unsigned byte, normalised → 0.0–1.0 in shader)
    col_acc = None
    if geo.colors and len(geo.colors) == n_verts:
        col_bytes = bytes(c for col in geo.colors for c in col)
        col_acc   = add_acc(
            add_bv(col_bytes, GL_ARRAY_BUFFER),
            GL_UNSIGNED_BYTE, n_verts, 'VEC4', normalized=True,
        )

    # Normals  (VEC3 float)
    nrm_acc = None
    if normals and len(normals) == n_verts:
        nrm_bytes = struct.pack(f'<{n_verts*3}f', *[c for n in normals for c in n])
        nrm_acc   = add_acc(
            add_bv(nrm_bytes, GL_ARRAY_BUFFER),
            GL_FLOAT, n_verts, 'VEC3',
        )

    # Index buffers — one per material group
    use_u32  = n_verts > 65535
    idx_fmt  = 'I' if use_u32 else 'H'
    idx_ctype = GL_UNSIGNED_INT if use_u32 else GL_UNSIGNED_SHORT

    prim_acc: dict[int, int] = {}
    for mat_id, tris in mat_groups.items():
        flat     = [i for tri in tris for i in tri]
        idx_data = struct.pack(f'<{len(flat)}{idx_fmt}', *flat)
        _align4(buf)
        prim_acc[mat_id] = add_acc(
            add_bv(idx_data, GL_ELEMENT_ARRAY_BUFFER),
            idx_ctype, len(flat), 'SCALAR',
            min_v=[min(flat)], max_v=[max(flat)],
        )

    # ── Textures ───────────────────────────────────────────────────────
    gltf_images    = []
    gltf_textures  = []
    gltf_samplers  = [{
        'magFilter': 9729,    # LINEAR
        'minFilter': 9987,    # LINEAR_MIPMAP_LINEAR
        'wrapS':    10497,    # REPEAT
        'wrapT':    10497,
    }]
    gltf_materials = []

    tex_to_gltf_idx: dict[str, int] = {}

    def get_or_create_texture(tex_name: str) -> int | None:
        key = tex_name.lower()
        if key in tex_to_gltf_idx:
            return tex_to_gltf_idx[key]
        if key not in textures:
            return None
        if not HAS_PIL:
            return None

        w, h, rgba = textures[key]
        # Namespace PNGs by source TXD: the same texture name can appear in
        # different dictionaries with different pixels (e.g. clean vs damaged
        # vehicle skins), so a flat folder would collide them.
        png_dir  = tex_out_dir / txd_name if txd_name else tex_out_dir
        png_dir.mkdir(parents=True, exist_ok=True)
        png_path = png_dir / f'{key}.png'

        if not png_path.exists():
            Image.frombytes('RGBA', (w, h), rgba).save(png_path)

        # URI relative to the glTF file location
        rel = os.path.relpath(png_path, out_dir).replace('\\', '/')

        img_idx = len(gltf_images)
        gltf_images.append({'uri': rel})
        gltf_textures.append({'sampler': 0, 'source': img_idx})

        gltf_idx = len(gltf_textures) - 1
        tex_to_gltf_idx[key] = gltf_idx
        return gltf_idx

    for mat in geo.materials:
        r, g, b, a = mat.get('color', (255, 255, 255, 255))
        pbr: dict = {
            'baseColorFactor':  [r/255, g/255, b/255, a/255],
            'metallicFactor':   0.0,
            'roughnessFactor':  1.0,
        }

        tex_name = mat.get('tex_name', '')
        if tex_name:
            gltf_tex_idx = get_or_create_texture(tex_name)
            if gltf_tex_idx is not None:
                pbr['baseColorTexture'] = {'index': gltf_tex_idx}

        gltf_materials.append({
            'name':                 tex_name or f'material_{len(gltf_materials)}',
            'pbrMetallicRoughness': pbr,
            'doubleSided':          True,
        })

    # ── Primitives ─────────────────────────────────────────────────────
    primitives = []
    for mat_id in sorted(mat_groups.keys()):
        attrs: dict = {'POSITION': pos_acc}
        if uv_acc  is not None: attrs['TEXCOORD_0'] = uv_acc
        if col_acc is not None: attrs['COLOR_0']    = col_acc
        if nrm_acc is not None: attrs['NORMAL']     = nrm_acc

        prim: dict = {
            'attributes': attrs,
            'indices':    prim_acc[mat_id],
            'mode':       4,   # TRIANGLES
        }
        if mat_id < len(gltf_materials):
            prim['material'] = mat_id

        primitives.append(prim)

    # ── Assemble glTF JSON ─────────────────────────────────────────────
    bin_name  = f'{model_name}.bin'
    buf_bytes = buf.getvalue()

    gltf: dict = {
        'asset':   {'version': '2.0', 'generator': 'gta_to_gltf.py'},
        'scene':   0,
        'scenes':  [{'name': model_name, 'nodes': [0]}],
        'nodes':   [{'name': model_name, 'mesh': 0}],
        'meshes':  [{'name': model_name, 'primitives': primitives}],
        'buffers': [{'uri': bin_name, 'byteLength': len(buf_bytes)}],
        'bufferViews': buffer_views,
        'accessors':   accessors,
    }
    if gltf_materials: gltf['materials'] = gltf_materials
    if gltf_textures:  gltf['textures']  = gltf_textures
    if gltf_images:    gltf['images']    = gltf_images
    if gltf_textures:  gltf['samplers']  = gltf_samplers

    # ── Write ──────────────────────────────────────────────────────────
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / bin_name).write_bytes(buf_bytes)
    (out_dir / f'{model_name}.gltf').write_text(
        json.dumps(gltf, indent=2), encoding='utf-8'
    )
    return True


# ---------------------------------------------------------------------------
# File resolver (pre-extracted dirs or IMG archive)
# ---------------------------------------------------------------------------

def make_resolvers(dff_dir, txd_dir, archive, loose_txd_dirs=None):
    """
    Return (get_dff, get_txd) callables that return raw bytes or None.

    Lookup order:
      DFF  — dff_dir, then archive
      TXD  — txd_dir, then archive, then any loose_txd_dirs

    *loose_txd_dirs* covers texture dictionaries that ship as loose files
    rather than inside the archive (e.g. GTA III's generic.txd / particle.txd
    beside gta3.img), so models referencing them still get their textures.
    """
    loose_txd_dirs = loose_txd_dirs or []

    def _read_dir(name: str, directory, ext: str) -> bytes | None:
        p = Path(directory) / f'{name}{ext}'
        if p.exists():
            return p.read_bytes()
        # Case-insensitive fallback (Linux / mixed-case archives)
        target = f'{name.lower()}{ext}'
        for f in Path(directory).iterdir():
            if f.name.lower() == target:
                return f.read_bytes()
        return None

    def get_dff(name: str) -> bytes | None:
        if dff_dir:
            r = _read_dir(name, dff_dir, '.dff')
            if r is not None:
                return r
        if archive:
            return archive.read(f'{name}.dff')
        return None

    def get_txd(name: str) -> bytes | None:
        if txd_dir:
            r = _read_dir(name, txd_dir, '.txd')
            if r is not None:
                return r
        if archive:
            r = archive.read(f'{name}.txd')
            if r is not None:
                return r
        for d in loose_txd_dirs:
            r = _read_dir(name, d, '.txd')
            if r is not None:
                return r
        return None

    return get_dff, get_txd


# ---------------------------------------------------------------------------
# Combined-DFF extraction (weapons.dff, peds.dff, …)
# ---------------------------------------------------------------------------

def build_pool_getter(archive, loose_txd_dirs):
    """
    Return get(texname) -> (w, h, rgba) | None, searching *all* TXDs.

    Combined models (weapons, peds) reference textures scattered across many
    dictionaries, so there's no single TXD to load.  This indexes every
    texture *name* across the archive + loose files (cheap — no pixel decode),
    then decodes a dictionary lazily, on first use, and caches it.
    """
    name_index: dict[str, tuple] = {}      # texname → ('a', archive_name) | ('f', Path)

    def scan(blob, ref):
        inner = find_chunk(blob, RW_TEXDICT) or blob
        for ct, tnd, _ in iter_chunks(inner):
            if ct != RW_TEXNATIVE:
                continue
            st = find_chunk(tnd, RW_STRUCT)
            if st is not None and len(st) >= 40:
                nm = st[8:40].rstrip(b'\x00').decode('latin-1', 'replace').lower()
                if nm:
                    name_index.setdefault(nm, ref)

    if archive:
        for n in archive.names():
            if n.endswith('.txd'):
                b = archive.read(n)
                if b:
                    scan(b, ('a', n))
    for d in loose_txd_dirs:
        for p in Path(d).iterdir():
            if p.suffix.lower() == '.txd':
                scan(p.read_bytes(), ('f', p))

    decoded: dict[tuple, dict] = {}

    def get(texname: str):
        key = texname.lower()
        ref = name_index.get(key)
        if ref is None:
            return None
        if ref not in decoded:
            blob = archive.read(ref[1]) if ref[0] == 'a' else Path(ref[1]).read_bytes()
            try:
                decoded[ref] = parse_txd(blob)
            except Exception:                          # noqa: BLE001
                decoded[ref] = {}
        return decoded[ref].get(key)

    return get


def convert_combined(files, get_texture, out_dir, tex_out_dir, root, yup, verbose):
    """Split each combined DFF into one glTF per model, resolving textures
    from the global pool, and merge the models into gta3.json."""
    n_ok = 0
    added: list[tuple[list[str], str]] = []      # (manifest keys, model name)
    for fpath in files:
        p = Path(fpath)
        if not p.exists():
            print(f'  MISSING  {p}')
            continue
        geos = parse_dff_atomics(p.read_bytes())
        folder = p.stem.lower()                        # PNGs → textures/<file>/
        keys = manifest_keys(p, root)                  # e.g. ['models','generic','weapons']
        print(f'{p.name}:  {len(geos)} models')
        seen: dict[str, int] = {}
        for geo in geos:
            name = clean_model_name(geo.name)
            if not name:
                continue
            if name in seen:                            # avoid clobbering duplicates
                seen[name] += 1
                name = f'{name}_{seen[name]}'
            else:
                seen[name] = 0

            texs: dict = {}
            for m in geo.materials:
                tn = (m.get('tex_name') or '').lower()
                if tn and tn not in texs:
                    r = get_texture(tn)
                    if r is not None:
                        texs[tn] = r
            try:
                ok = build_gltf(geo, texs, out_dir, name, tex_out_dir,
                                txd_name=folder, yup=yup)
            except Exception as exc:                    # noqa: BLE001
                print(f'  ERROR {name}: {exc}')
                continue
            if ok:
                n_ok += 1
                added.append((keys, name))
                want = {(m.get('tex_name') or '').lower()
                        for m in geo.materials if m.get('tex_name')}
                got = len(want & set(texs))
                print(f'  OK    {name:<16} {len(geo.verts):5d}v  '
                      f'{len(geo.triangles):5d}t  {len(geo.materials)}mat  '
                      f'{got}/{len(want)}tex')

    # Merge into gta3.json so combined models are browsable in the viewer.
    # (Read-modify-write: a full IDE run rebuilds the manifest, so re-run
    # --combined after it to re-add these.)
    if added:
        mpath = out_dir / 'gta3.json'
        try:
            manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
        except (OSError, ValueError):
            manifest = {}
        for k, name in added:
            manifest_insert(manifest, k, name, f'{name}.gltf')
        mpath.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding='utf-8')
        print(f'Manifest:  +{len(added)} models → {mpath.resolve()}')

    print(f'\nConverted: {n_ok}')
    if n_ok:
        print(f'Output:    {out_dir.resolve()}')


def convert_assembled(models, get_dff, get_texture, out_dir, tex_out_dir, yup):
    """Assemble each multi-part model (vehicle) into ONE glTF, applying frame
    transforms and merging its parts.  Overwrites any single-part glTF the
    normal run produced (the manifest entry already points at <name>.gltf)."""
    n_ok = 0
    for m in models:
        p = Path(m)
        if p.exists():
            data, name = p.read_bytes(), clean_model_name(p.stem)
        else:
            data, name = get_dff(m), m.lower()          # model name inside the archive
        if not data:
            print(f'  MISSING  {m}')
            continue
        try:
            geo = parse_dff_assembled(data)
        except Exception as exc:                        # noqa: BLE001
            print(f'  ERROR    {name}: {exc}')
            continue
        if geo is None:
            print(f'  no geometry: {name}')
            continue

        texs: dict = {}
        for mat in geo.materials:
            tn = (mat.get('tex_name') or '').lower()
            if tn and tn not in texs:
                r = get_texture(tn)
                if r is not None:
                    texs[tn] = r
        try:
            ok = build_gltf(geo, texs, out_dir, name, tex_out_dir,
                            txd_name=name, yup=yup)
        except Exception as exc:                        # noqa: BLE001
            print(f'  ERROR    {name}: {exc}')
            continue
        if ok:
            n_ok += 1
            want = {(mat.get('tex_name') or '').lower()
                    for mat in geo.materials if mat.get('tex_name')}
            print(f'  OK    {name:<16} {len(geo.verts):5d}v  '
                  f'{len(geo.triangles):5d}t  {len(geo.materials)}mat  '
                  f'{len(want & set(texs))}/{len(want)}tex')
    print(f'\nAssembled: {n_ok}')
    if n_ok:
        print(f'Output:    {out_dir.resolve()}')


# Loose textures that no world model references but the viewer still needs, as
# (source TXD, texture name, output PNG).  The water surface uses water_old from
# the particle dictionary; the per-model texture pass never touches it.
LOOSE_TEXTURES = [
    ('particle.txd', 'water_old', 'water_old.png'),
]


def extract_loose_textures(archive, loose_txd_dirs, out_dir) -> None:
    """Decode the LOOSE_TEXTURES straight to PNGs in *out_dir*.

    These live in dictionaries (e.g. particle.txd) that aren't tied to any
    converted model, so build_gltf's per-model texture export skips them.
    """
    if not HAS_PIL:
        return

    def read_txd(name: str) -> bytes | None:
        for d in loose_txd_dirs:                         # loose file beside the archive
            p = Path(d) / name
            if p.exists():
                return p.read_bytes()
        return archive.read(name) if archive is not None else None

    cache: dict[str, dict] = {}
    for txd_name, tex_name, png_name in LOOSE_TEXTURES:
        if txd_name not in cache:
            blob = read_txd(txd_name)
            try:
                cache[txd_name] = parse_txd(blob) if blob else {}
            except Exception:                            # noqa: BLE001
                cache[txd_name] = {}
        tex = cache[txd_name].get(tex_name.lower())
        if tex is None:
            print(f'  WARNING: loose texture {tex_name} not found in {txd_name}')
            continue
        w, h, rgba = tex
        out = out_dir / png_name
        Image.frombytes('RGBA', (w, h), rgba).save(out)
        print(f'  OK    {tex_name:<12} {w}x{h}  → {png_name}')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description='Convert GTA III / VC models to glTF 2.0',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument('ide', nargs='?',
                    help='Single .ide to convert (default: auto-discover all)')
    ap.add_argument('--dff-dir',      metavar='DIR',  help='Pre-extracted DFF directory')
    ap.add_argument('--txd-dir',      metavar='DIR',  help='Pre-extracted TXD directory')
    ap.add_argument('--img',          metavar='FILE', help='.img archive')
    ap.add_argument('--img-dir',      metavar='FILE', help='.dir file paired with --img')
    ap.add_argument('--data-dir',     metavar='DIR',
                    help='Directory to scan for .ide files (default: ./data)')
    ap.add_argument('-o', '--output', metavar='DIR',  default=None,
                    help='Output directory (default: ./extracted)')
    ap.add_argument('-f', '--filter', metavar='PATTERN',
                    help='Glob filter on model name, e.g. "ind_land*"')
    ap.add_argument('--combined', nargs='+', metavar='DFF',
                    help='Split the given combined multi-model DFFs into one '
                         'glTF per model (weapons.dff is auto-split on a full '
                         'run; use this for peds.dff / wheels.DFF / custom files)')
    ap.add_argument('--assemble', nargs='+', metavar='MODEL',
                    help='Assemble a multi-part model (a vehicle such as "train") '
                         'into one glTF, merging its body/doors and applying the '
                         'frame-hierarchy transforms.  Takes archive model names '
                         '(e.g. "train") or .dff paths; overwrites <name>.gltf.')
    ap.add_argument('--no-yup', action='store_true',
                    help='Keep GTA Z-up coords (default: convert to glTF Y-up)')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()

    if not HAS_PIL:
        print('WARNING: Pillow not installed — textures will be skipped.')
        print('         pip install pillow\n')

    # ── Default locations (this script lives in the game root) ─────────
    root         = Path(__file__).resolve().parent      # …/G3
    default_img  = root / 'models' / 'gta3.img'
    default_data = root / 'data'
    default_out  = root / 'extracted'

    # ── Resolve the model/texture source ───────────────────────────────
    #   explicit --img  >  pre-extracted dirs  >  bundled gta3.img
    archive = None
    if args.img:
        try:
            archive = ImgArchive(args.img, args.img_dir)
            print(f'Archive:  {args.img}  ({len(archive):,} files)')
        except Exception as exc:
            sys.exit(f'Error loading archive: {exc}')
    elif not args.dff_dir and not args.txd_dir:
        if not default_img.exists():
            ap.error(
                f'No source given and default archive not found ({default_img}).\n'
                '       Provide --img, or --dff-dir / --txd-dir.'
            )
        try:
            archive = ImgArchive(default_img)
            print(f'Archive:  {default_img}  ({len(archive):,} files)')
        except Exception as exc:
            sys.exit(f'Error loading archive: {exc}')

    # Loose TXDs (generic.txd, particle.txd, …) live beside the archive, not
    # inside it.  Search the archive's own directory as a fallback.
    loose_txd_dirs = []
    if archive is not None:
        loose_txd_dirs.append(archive.img_path.parent)

    get_dff, get_txd = make_resolvers(
        args.dff_dir, args.txd_dir, archive, loose_txd_dirs=loose_txd_dirs,
    )

    # ── Combined-DFF mode (weapons.dff, peds.dff, …) ───────────────────
    if args.combined:
        out_dir     = Path(args.output) if args.output else default_out
        tex_out_dir = out_dir / 'textures'
        out_dir.mkdir(parents=True, exist_ok=True)
        print('Indexing textures for pool lookup…')
        get_texture = build_pool_getter(archive, loose_txd_dirs)
        convert_combined(args.combined, get_texture, out_dir, tex_out_dir,
                         root, yup=not args.no_yup, verbose=args.verbose)
        return

    # ── Assemble mode (multi-part vehicles, e.g. the subway train) ─────
    if args.assemble:
        out_dir     = Path(args.output) if args.output else default_out
        tex_out_dir = out_dir / 'textures'
        out_dir.mkdir(parents=True, exist_ok=True)
        print('Indexing textures for pool lookup…')
        get_texture = build_pool_getter(archive, loose_txd_dirs)
        convert_assembled(args.assemble, get_dff, get_texture, out_dir,
                          tex_out_dir, yup=not args.no_yup)
        return

    # ── Build the model list + DFF→TXD mapping ─────────────────────────
    if args.ide:
        ide_path = Path(args.ide)
        if not ide_path.exists():
            sys.exit(f'Error: IDE not found: {ide_path}')
        entries, by_name = collect_entries([ide_path])
        print(f'IDE:      {ide_path.name}  →  {len(entries)} models')
    else:
        data_dir = Path(args.data_dir) if args.data_dir else default_data
        if not data_dir.exists():
            sys.exit(f'Error: data directory not found: {data_dir}')
        ide_paths = discover_ides(data_dir)
        if not ide_paths:
            sys.exit(f'Error: no .ide files found under {data_dir}')
        entries, by_name = collect_entries(ide_paths)
        print(f'IDEs:     {len(ide_paths)} files under {data_dir}  '
              f'→  {len(entries)} models')
        # Sweep the archive for models no IDE mentions (mission/interior objs).
        if archive is not None:
            n_orphan = add_archive_orphans(archive, by_name, entries)
            if n_orphan:
                print(f'          + {n_orphan} archive models with no IDE '
                      '(txd = model name)')

    if args.filter:
        pat     = args.filter.lower()
        entries = [e for e in entries if fnmatch.fnmatch(e['name'], pat)]
        print(f'Filter:   "{args.filter}"  →  {len(entries)} models')

    out_dir     = Path(args.output) if args.output else default_out
    tex_out_dir = out_dir / 'textures'

    print(f'Output:   {out_dir.resolve()}')
    print()

    # Manifest: nested model→glTF map mirroring each IDE's location.
    manifest: dict = {}

    # ── TXD cache ─────────────────────────────────────────────────────
    txd_cache: dict[str, dict] = {}

    def load_textures(txd_name: str) -> dict:
        if txd_name in txd_cache:
            return txd_cache[txd_name]
        raw = get_txd(txd_name)
        result: dict = {}
        if raw is not None:
            try:
                result = parse_txd(raw)
            except Exception as exc:
                print(f'  WARNING: TXD parse error for {txd_name}.txd: {exc}')
        else:
            if args.verbose:
                print(f'  WARNING: {txd_name}.txd not found')
        txd_cache[txd_name] = result
        if args.verbose and result:
            print(f'  TXD {txd_name}.txd  ({len(result)} textures)')
        return result

    # ── Convert ───────────────────────────────────────────────────────
    n_ok = n_skip = n_err = 0

    for entry in entries:
        name     = entry['name']
        txd_name = entry['txd']

        raw_dff = get_dff(name)
        if raw_dff is None:
            if args.verbose:
                print(f'  SKIP  {name}  (.dff not found)')
            n_skip += 1
            continue

        try:
            geo = parse_dff_model(raw_dff)          # assembles multi-part vehicles
        except Exception as exc:
            print(f'  ERROR {name}  DFF: {exc}')
            n_err += 1
            continue

        if geo is None:
            if args.verbose:
                print(f'  SKIP  {name}  (no geometry)')
            n_skip += 1
            continue

        textures = load_textures(txd_name)

        if args.verbose:
            for mat in geo.materials:
                tname = mat.get('tex_name', '').lower()
                if tname and tname not in textures:
                    print(f'    WARNING: texture "{tname}" missing from {txd_name}.txd')

        try:
            ok = build_gltf(
                geo, textures, out_dir, name, tex_out_dir,
                txd_name=txd_name,
                yup=not args.no_yup,
            )
        except Exception as exc:
            print(f'  ERROR {name}  glTF: {exc}')
            if args.verbose:
                import traceback
                traceback.print_exc()
            n_err += 1
            continue

        if ok:
            n_v = len(geo.verts)
            n_t = len(geo.triangles)
            n_m = len(geo.materials)
            print(f'  OK    {name:<40}  {n_v:5d}v  {n_t:5d}t  {n_m}mat')
            n_ok += 1
            # Index in the manifest under every IDE that references this model
            # (path is relative to the manifest file).  Orphans → _orphans.
            gltf_rel = f'{name}.gltf'
            ide_list = entry.get('ides') or []
            if ide_list:
                for ide in ide_list:
                    manifest_insert(manifest, manifest_keys(ide, root),
                                    name, gltf_rel)
            else:
                manifest_insert(manifest, ['_orphans'], name, gltf_rel)
        else:
            if args.verbose:
                print(f'  SKIP  {name}  (empty output)')
            n_skip += 1

    # ── Manifest ──────────────────────────────────────────────────────
    if n_ok:
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = out_dir / 'gta3.json'
        manifest_path.write_text(
            json.dumps(manifest, indent=2, sort_keys=True), encoding='utf-8'
        )

    print()
    print(f'Converted: {n_ok}   Skipped: {n_skip}   Errors: {n_err}')
    if n_ok:
        print(f'Output:    {out_dir.resolve()}')
        print(f'Manifest:  {manifest_path.resolve()}')

    # ── Auto-split the standard combined DFFs on a full run ────────────
    # weapons.dff isn't in the archive and holds many models, so a plain
    # "convert everything" run also splits it (needed for the weapon pickups).
    # This runs AFTER the manifest write so the models merge into gta3.json.
    if (n_ok and archive is not None and not args.ide and not args.filter
            and not args.dff_dir and not args.txd_dir):
        auto = [root / 'models' / 'Generic' / n
                for n in ('weapons.dff', 'wheels.DFF')]
        auto = [p for p in auto if p.exists()]
        if auto:
            print('\nCombined models (auto):')
            get_texture = build_pool_getter(archive, loose_txd_dirs)
            convert_combined([str(p) for p in auto], get_texture, out_dir,
                             tex_out_dir, root, yup=not args.no_yup,
                             verbose=args.verbose)

        # Loose textures no model references (e.g. water_old for the water overlay).
        print('\nLoose textures (auto):')
        extract_loose_textures(archive, loose_txd_dirs, out_dir)


if __name__ == '__main__':
    main()
