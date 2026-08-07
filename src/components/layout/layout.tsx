import { Header } from "../header/header"
import { Outlet } from "react-router"
import styles from "./layout.module.css"

export const Layout = () => {
  return (
    <div className={styles.layout}>
      <Header />
      <Outlet />
    </div>
  )
}
