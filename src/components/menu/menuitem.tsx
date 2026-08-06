import * as styles from "./menuitem.module.css"
import { Font1 } from "../fonts/Font1"
import { useState } from "react"
import clsx from "clsx"

interface Props {
    onClick?: () => void
    text: string
}

export const MenuItem = ({ onClick, text }: Props) => {
    const [isHovered, setIsHovered] = useState(false)

    const handleOver = () => {
        setIsHovered(true)
    }
    const handleOut = () => {
        setIsHovered(false)
    }

    return <div className={clsx(styles.menuitem, {[styles.hover]: isHovered})} onClick={onClick} onMouseEnter={handleOver} onMouseLeave={handleOut}>
        <Font1 text={text.toUpperCase()} color="#F0AF39" />
    </div>
}