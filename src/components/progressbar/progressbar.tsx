import styles from "./progressbar.module.css"

interface Props {
  progress: number
}

export const ProgressBar = ({ progress }: Props) => {
  return (
    <div className={styles.progressbar}>
      <div className={styles.progress} style={{ width: `${progress}%` }}></div>
    </div>
  )
}
