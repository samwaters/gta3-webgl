import { FONT1 } from "./atlas"
import { BitmapText } from "./bitmapText"

interface Props {
  /**
   * The text to draw. font1 is a lowercase face: the A-Z cells hold the
   * upright letterforms and the a-z cells hold italic versions of the same
   * shapes, so the case of what you pass in picks the style.
   */
  text: string
  /** Any CSS colour — the atlas is white-on-alpha and gets tinted to it. */
  color: string
  /** Rendered cell height in px. Defaults to font1's native 40. */
  size?: number
}

export const Font1 = ({ text, color, size = 40 }: Props) => (
  <BitmapText atlas={FONT1} text={text} color={color} size={size} />
)
