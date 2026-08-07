import styles from "./sceneviewer.module.css"
import { useAppSelector } from "../../store/hooks"
import { scenesSelector } from "../../store/scenes/scenes.slice"
import { Scene } from "./scene"

export const SceneViewer = () => {
  const { selectedFile, selectedName, selectedPath } =
    useAppSelector(scenesSelector)
  return (
    <div className={styles.sceneviewer}>
      <div className={styles.sceneviewerHeader}>
        <span className={styles.selectedName}>
          {selectedName ? selectedName : "No scene selected"}
        </span>
        <span>{selectedPath ? `${selectedPath}/${selectedFile}` : ""}</span>
      </div>
      <div className={styles.scene}>
        <Scene />
      </div>
    </div>
  )
}
