import styles from "./header.module.css"
import { NavLink } from "react-router"
import { useAppSelector } from "../../store/hooks"
import { assetsSelector } from "../../store/assets/assets.slice"

export const Header = () => {
  const assets = useAppSelector(assetsSelector)
  const hasAssets = assets.downloaded && assets.extracted
  return (
    <div className={styles.header}>
      <div className={styles.brand}>GTA 3 Viewer</div>
      <NavLink to="/">Home</NavLink>
      {hasAssets && (
        <>
          <NavLink to="/models">Models</NavLink>
          <NavLink to="/scenes">Scenes</NavLink>
          <NavLink to="/city">Full City</NavLink>
        </>
      )}
    </div>
  )
}
