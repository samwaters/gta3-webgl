#!/usr/bin/env python3
"""
hud.py  —  Extract GTA III's in-play HUD textures

`<game root>/models/hud.txd` holds what's drawn over the world during play,
as opposed to the menus in menu.py and frontend.py:

    radar_*        16x16   radar blips. Most are mission-giver markers named
                           after the character (asuka, joey, luigi, kenji,
                           el, ray, sal, tony, liz, cat, don, ice, eight),
                           the rest are pickups and services (save, spray,
                           weapon, bomb, copcar) plus radar_north for the
                           compass and radar_centre for the player arrow.
    radardisc      64x64   circular mask/frame the radar map is drawn inside
    <weapon>       64x64   weapon slot icons, in inventory order: fist, bat,
                           pistol, uzi, shotgun, ak47, m16, sniper, rocket,
                           flame, molotov, grenade, detonator
    site*          128x128 aiming reticles — sitem16, sitesniper, siterocket
    pager          128x128 the pager message frame

Note `pager` here is the HUD's pager *frame*, not the pager font of the same
name in fonts.txd — the two dictionaries each own their folder, so the names
no longer collide on disk.

The radar blips are tiny and were drawn for a 4:3 SD display; they'll need
nearest-neighbour scaling to stay crisp rather than smooth filtering.

This is an ordinary multi-texture RenderWare TXD. On PC it sits loose in
`<game root>/models/`; on PS2 it's packed inside MODELS.IMG — run this
project's IMG/DIR extractor first if you're working from the PS2 image so
the loose .txd file exists on disk before pointing this script at it.

This writes:
  viewer/extracted/hud/<texture>.png   — decoded textures
  viewer/extracted/hud.json            — manifest, each entry tagged w/ role

Usage:
  python hud.py                        # <root>/models → viewer/extracted/hud/
  python hud.py --models-dir X -o Y
"""

import txd_common

# Weapon slot icons, in the order the game cycles them.
_WEAPONS = {
    'fist', 'bat', 'pistol', 'uzi', 'shotgun', 'ak47', 'm16', 'sniper',
    'rocket', 'flame', 'molotov', 'grenade', 'detonator',
}


def classify(tex_name: str) -> str:
    """Return the manifest role for a hud.txd texture name."""
    key = tex_name.lower()
    if key.startswith('radar_'):
        return 'blip'
    if key == 'radardisc':
        return 'radar'
    if key in _WEAPONS:
        return 'weapon'
    if key.startswith('site'):
        return 'sight'
    if key == 'pager':
        return 'pager'
    return 'other'


def main() -> None:
    txd_common.run_extractor(
        stem='hud',
        manifest_key='hud',
        description='Extract GTA III in-play HUD textures (hud.txd)',
        classify=classify,
    )


if __name__ == '__main__':
    main()
