import styles from "./menu.module.css"
import { Logo } from "./logo"
import { MenuItem } from "./menuitem"
import { Font1 } from "../fonts/Font1"
import { getMenuData } from "./data/data"
import { useAppSelector } from "../../store/hooks"
import { menuSelector } from "../../store/menu/menu.slice"
import clsx from "clsx"
import { assetsSelector } from "../../store/assets/assets.slice"

export const Menu = () => {
  const menuItems = getMenuData()
  const { downloading, extracting } = useAppSelector(assetsSelector)
  const menuData = useAppSelector(menuSelector)
  return (
    <div
      className={clsx(styles.menuWrapper, {
        [styles.deleting]: menuData.isConfirmingDelete,
        [styles.downloading]: downloading,
        [styles.extracting]: extracting,
      })}
    >
      <div className={styles.menu}>
        <div className={styles.logoContainer}>
          <Logo />
        </div>
        <div className={styles.menuContainer}>
          {menuItems.map((item) => (
            <MenuItem
              key={item.text}
              onClick={item.onClick}
              selectable={item.selectable}
              text={item.text}
            />
          ))}
        </div>
        <div className={styles.barContainer}>
          <Font1 text="GTA3-GL V0.1" color="#000000" />
        </div>
        <div className={styles.footer}></div>
      </div>
    </div>
  )
}
