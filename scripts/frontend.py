#!/usr/bin/env python3
"""
frontend.py  —  Extract GTA III's in-game pause-menu textures

`<game root>/models/frontend.txd` holds the chrome for the pause menu you
get during play — a different visual language from the pre-game main menu
in menu.py. Where the main menu is full-bleed character art, this is a
translucent rounded panel over the frozen game world:

    fe2_mainpanel_ul/ur/dl/dr   256x256 rounded corners of that panel, drawn
                                as four quadrants; dr2 is a second variant of
                                the lower-right corner for taller panels
    fe2_tabactive               128x32  highlight behind the selected tab
    fe_icon{stats,brief,save,   256x256 the tab icons across the top:
      controls,audio,display,           statistics, mission brief, save,
      language}                         controls, audio, display, language
    fe_radio1-9                 64x64   station dial art for the audio tab,
                                        in the game's station order
    fe_controller/controllersh  256x256 the controls-tab pad diagram, plus
                                        its drop shadow overlay
    fe_arrows1-4                256x256 directional arrows for the diagram
    fe2_x_button/tri_button     16x16   PS2 button prompts left in the PC build

Panel corners are quadrants of one rounded rectangle, so a renderer should
place them at the four corners and stretch flat colour between rather than
9-slicing a single source image.

This is an ordinary multi-texture RenderWare TXD. On PC it sits loose in
`<game root>/models/`; on PS2 it's packed inside MODELS.IMG — run this
project's IMG/DIR extractor first if you're working from the PS2 image so
the loose .txd file exists on disk before pointing this script at it.

This writes:
  viewer/extracted/frontend/<texture>.png   — decoded textures
  viewer/extracted/frontend.json            — manifest, entries tagged w/ role

Usage:
  python frontend.py                        # <root>/models → viewer/extracted/frontend/
  python frontend.py --models-dir X -o Y
"""

import re

import txd_common

# Prefix rules — frontend.txd names are systematic enough to match on shape
# rather than listing every texture.
_ROLES = (
    (re.compile(r'^fe2_mainpanel_'),  'panel'),
    (re.compile(r'^fe2_tab'),         'panel'),
    (re.compile(r'^fe_icon'),         'icon'),
    (re.compile(r'^fe_radio\d+$'),    'radio'),
    (re.compile(r'^fe_controller'),   'controller'),
    (re.compile(r'^fe_arrows\d+$'),   'arrow'),
    (re.compile(r'^fe2_\w+_button$'), 'button'),
)


def classify(tex_name: str) -> str:
    """Return the manifest role for a frontend.txd texture name."""
    key = tex_name.lower()
    for pattern, role in _ROLES:
        if pattern.match(key):
            return role
    return 'other'


def main() -> None:
    txd_common.run_extractor(
        stem='frontend',
        manifest_key='frontend',
        description='Extract GTA III pause-menu textures (frontend.txd)',
        classify=classify,
    )


if __name__ == '__main__':
    main()
