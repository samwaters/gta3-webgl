import styles from "./loadscreen.module.css"
import { ProgressBar } from "../progressbar/progressbar"
import { useAppSelector } from "../../store/hooks"
import { assetsSelector } from "../../store/assets/assets.slice"

export const LoadScreen = () => {
  const { downloadProgress, extractProgress } = useAppSelector(assetsSelector)
  return (
    <div className={styles.loadscreen}>
      <div className={styles.progressContainer}>
        <ProgressBar progress={(downloadProgress + extractProgress) / 2} />
      </div>
    </div>
  )
}
