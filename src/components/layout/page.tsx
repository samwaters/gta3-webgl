import type { PropsWithChildren } from "react"
import styles from "./page.module.css"

export const PageLayout = ({ children }: PropsWithChildren) => {
  return <div className={styles.pagelayout}>{children}</div>
}
