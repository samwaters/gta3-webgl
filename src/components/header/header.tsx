import styles from "./header.module.css"
import { NavLink } from "react-router"

export const Header = () => {
  return (
    <div className={styles.header}>
      <div className={styles.brand}>GTA 3 Viewer</div>
      <NavLink to="/">Home</NavLink>
      <NavLink to="/models">Models</NavLink>
      <NavLink to="/scenes">Scenes</NavLink>
      <NavLink to="/city">Full City</NavLink>
    </div>
  )
}
