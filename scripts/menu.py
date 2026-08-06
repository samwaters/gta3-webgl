#!/usr/bin/env python3
"""
menu.py  —  Extract GTA III's main-menu textures

`<game root>/models/menu.txd` holds everything the front-end main menu draws
before you're in a game: the page backgrounds, the logos on the title screen,
the list scroll arrows and the mouse cursors.

The seven 512x512 `*24` textures are one background per menu page —
mainmenu, singleplayer, multiplayer, playersetup, hostgame, findgame and
connection. Each already has the yellow selection bar and the Rockstar
corner logos baked into the art; the game stretches them to the viewport
rather than letterboxing, so they will not stay square on a wide display.

The in-game pause menu is a different dictionary — see frontend.py. The
fonts the menu renders its labels with are in fonts.py, and the HUD drawn
during play is in hud.py.

This is an ordinary multi-texture RenderWare TXD. On PC it sits loose in
`<game root>/models/`; on PS2 it's packed inside MODELS.IMG — run this
project's IMG/DIR extractor first if you're working from the PS2 image so
the loose .txd file exists on disk before pointing this script at it.

This writes:
  viewer/extracted/menu/<texture>.png   — decoded textures
  viewer/extracted/menu.json            — manifest, each entry tagged w/ role

Usage:
  python menu.py                        # <root>/models → viewer/extracted/menu/
  python menu.py --models-dir X -o Y
"""

import txd_common

# One 512x512 background per front-end page.
_BACKGROUNDS = {
    'mainmenu24', 'singleplayer24', 'multiplayer24', 'playersetup24',
    'hostgame24', 'findgame24', 'connection24',
}

# Title-screen and splash branding.
_LOGOS = {
    'gta3logo256', 'gtalogo128', 'rockstarlogo128', 'dmalogo128',
    'gamespy256', 'mp3logo',
}

# Scroll arrows for long lists, in highlighted/idle pairs.
_ARROWS = {'upon', 'upoff', 'downon', 'downoff'}

# PC-only pointer, plus the busy/hourglass variant.
_CURSORS = {'mouse', 'mousetimer'}


def classify(tex_name: str) -> str:
    """Return the manifest role for a menu.txd texture name."""
    key = tex_name.lower()
    if key in _BACKGROUNDS:
        return 'background'
    if key in _LOGOS:
        return 'logo'
    if key in _ARROWS:
        return 'arrow'
    if key in _CURSORS:
        return 'cursor'
    return 'other'


def main() -> None:
    txd_common.run_extractor(
        stem='menu',
        manifest_key='menu',
        description='Extract GTA III main-menu textures (menu.txd)',
        classify=classify,
    )


if __name__ == '__main__':
    main()
