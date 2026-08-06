import * as styles from "./menu.module.css"
import { Logo } from "./logo"
import { MenuItem } from "./menuitem"
import { Font1 } from "../fonts/Font1"

export const Menu = () => {
    return <div className={styles.menu}>
        <div className={styles.logoContainer}>
            <Logo />
        </div>
        <div className={styles.menuContainer}>
            <MenuItem text="model viewer" />
            <MenuItem text="scene viewer" />
            <MenuItem text="full city view" />
            <MenuItem text="refresh asset status" />
            <MenuItem text="delete assets" />
        </div>
        <div className={styles.barContainer}>
            <Font1 text="GTA3-GL V0.1" color="#000000" />
        </div>
        <div className={styles.footer}></div>
    </div>
}