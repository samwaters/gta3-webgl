import styles from "./sidebar.module.css"
import type { PropsWithChildren } from "react"

export const Sidebar = ({ children }: PropsWithChildren) => {
  return <div className={styles.sidebar}>
    {children}
  </div>
}
