import { FONT2 } from "./atlas"
import { BitmapText } from "./bitmapText"

interface Props {
    /** The text to draw. font2 is a two-case face with no italic cells. */
    text: string
    /** Any CSS colour — the atlas is white-on-alpha and gets tinted to it. */
    color: string
    /**
     * Rendered cell height in px. Defaults to 40 to match Font1; font2's cells
     * are natively 80, so the default is a clean half-scale.
     */
    size?: number
}

export const Font2 = ({ text, color, size = 40 }: Props) => (
    <BitmapText atlas={FONT2} text={text} color={color} size={size} />
)
