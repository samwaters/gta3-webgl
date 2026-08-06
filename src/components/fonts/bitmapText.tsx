import type { CSSProperties } from "react"
import { advanceFor, cellFor, COLUMNS, type FontAtlas } from "./atlas"
import styles from "./fonts.module.css"

interface Props {
    atlas: FontAtlas
    text: string
    color: string
    /** Rendered height of one cell, in px. Everything else scales off it. */
    size: number
}

/**
 * Draws `text` one atlas cell at a time. Shared by Font1 and Font2, which only
 * differ in which atlas they hand over.
 *
 * The glyphs are solid white with the letterform carried entirely in the alpha
 * channel, so a cell is used as a CSS mask over a solid fill rather than as a
 * background image — that is what lets `color` be any colour instead of only
 * white. The mask is the whole atlas scaled to `size` and offset so the wanted
 * cell lands in the box: the background-position trick, with mask-position
 * doing the work.
 *
 * Every box stays a full cell wide so nothing is ever cut off; spacing is done
 * by pulling the next box back with a negative margin, to the advance width
 * atlas.ts works out from the measured ink. The boxes overlap as a result,
 * which costs nothing — the mask leaves everything but the letterform
 * transparent.
 */
export const BitmapText = ({ atlas, text, color, size }: Props) => {
    const scale = size / atlas.cellHeight
    const cellWidth = atlas.cellWidth * scale
    const maskSize = `${atlas.width * scale}px ${atlas.height * scale}px`

    const glyphStyle = (char: string): CSSProperties => {
        const cell = cellFor(char)
        const box: CSSProperties = {
            width: cellWidth,
            height: size,
            marginRight: advanceFor(atlas, cell) * scale - cellWidth,
        }
        if (cell === null) {
            return box
        }
        const maskImage = `url(${atlas.src})`
        const column = cell % COLUMNS
        const row = Math.floor(cell / COLUMNS)
        const maskPosition = `${-column * cellWidth}px ${-row * size}px`
        return {
            ...box,
            maskImage,
            maskSize,
            maskPosition,
            WebkitMaskImage: maskImage,
            WebkitMaskSize: maskSize,
            WebkitMaskPosition: maskPosition,
        }
    }

    return (
        <div className={styles.text} style={{ color }} role="img" aria-label={text}>
            {text.split("\n").map((line, lineIndex) => (
                <div className={styles.line} key={lineIndex}>
                    {[...line].map((char, index) => (
                        <div className={styles.glyph} key={index} style={glyphStyle(char)} />
                    ))}
                </div>
            ))}
        </div>
    )
}
