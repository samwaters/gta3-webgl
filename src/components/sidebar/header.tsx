import styles from "./header.module.css"
import type { PropsWithChildren } from "react"

export const SidebarHeader = ({ children }: PropsWithChildren) => {
    return <div className={styles.sidebarHeader}>
        {children}
    </div>
}