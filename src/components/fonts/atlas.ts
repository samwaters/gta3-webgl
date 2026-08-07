/**
 * The grid geometry of GTA III's bitmap font atlases, as extracted by
 * scripts/fonts.py into public/fonts.
 *
 * Each atlas is indexed by character code rather than packed by glyph width,
 * so a cell's position is arithmetic: 16 columns across and 12.8 rows down,
 * with space as cell 0 and the codes running on from there. Ten of those rows
 * are filled — ASCII up to 126, then the accented Latin the localised .gxt
 * text needs from cell 96 on.
 *
 * Because every glyph gets the same cell, spacing text by the cell comes out
 * monospaced. The advance widths the game set its own text with live in the
 * executable rather than the TXD, so what we have instead is the ink: how far
 * each letterform actually reaches, measured off the alpha channel by
 * scripts/fonts.py into inkWidths.ts. An advance is that reach plus a gap.
 */

import { FONT1_INK_WIDTHS, FONT2_INK_WIDTHS } from "./inkWidths"

export interface FontAtlas {
  /** Where the PNG is served from — scripts/fonts.py copies it there. */
  src: string
  width: number
  height: number
  /** One cell. Always width / 16 across by height / 12.8 down. */
  cellWidth: number
  cellHeight: number
  /** Measured reach of each cell's letterform, in atlas px. */
  inkWidths: readonly number[]
  /**
   * Atlas px left between one letterform and the next. Both faces lean
   * right, so a letter's reach is measured at its top while its foot stops
   * well short of that; the gap is small to make up for the air the lean
   * already leaves at the baseline.
   */
  letterGap: number
  /** Advance of a space, in atlas px — nothing to measure in an empty cell. */
  spaceWidth: number
}

export const FONT1: FontAtlas = {
  src: "/fonts/font1.png",
  width: 512,
  height: 512,
  cellWidth: 32,
  cellHeight: 40,
  inkWidths: FONT1_INK_WIDTHS,
  letterGap: 2,
  spaceWidth: 9,
}

export const FONT2: FontAtlas = {
  src: "/fonts/font2.png",
  width: 1024,
  height: 1024,
  cellWidth: 64,
  cellHeight: 80,
  inkWidths: FONT2_INK_WIDTHS,
  letterGap: 0,
  spaceWidth: 18,
}

export const COLUMNS = 16

const SPACE_CODE = 0x20
const LAST_ASCII_CODE = 0x7e

/**
 * Cell 96 upward, in atlas order. This is the game's own ordering rather than
 * any Unicode range, so it is written out literally.
 */
const EXTENDED = "ÀÁÂÄÆÇÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜßàáâäæçèéêëìíîïòóôöùúûüÑñ¿¡"
const EXTENDED_FIRST_CELL = 96

/** The cell `char` lives in, or null if the atlases have no glyph for it. */
export const cellFor = (char: string): number | null => {
  const code = char.codePointAt(0) ?? 0
  if (code >= SPACE_CODE && code <= LAST_ASCII_CODE) {
    return code - SPACE_CODE
  }
  if (EXTENDED.includes(char)) {
    return EXTENDED_FIRST_CELL + EXTENDED.indexOf(char)
  }
  return null
}

/** How far the pen moves after drawing `cell`, in atlas px. */
export const advanceFor = (atlas: FontAtlas, cell: number | null): number => {
  const ink = cell === null ? 0 : (atlas.inkWidths[cell] ?? 0)
  // An empty cell is a space, and so is anything the atlas can't draw.
  return ink === 0 ? atlas.spaceWidth : ink + atlas.letterGap
}
