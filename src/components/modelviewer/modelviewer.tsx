import styles from "./modelviewer.module.css"
import { useAppSelector } from "../../store/hooks.ts"
import { modelsSelector } from "../../store/models/models.slice.ts"
import { Model } from "./model"

export const ModelViewer = () => {
	const { selectedFile, selectedName, selectedPath } = useAppSelector(modelsSelector)
	return <div className={styles.modelviewer}>
		<div className={styles.modelviewerHeader}>
			<span className={styles.selectedName}>
				{selectedName ? selectedName : "No model selected"}
			</span>
			<span>{selectedPath ? `${selectedPath}/${selectedFile}` : ""}</span>
		</div>
		<div className={styles.model}>
			<Model />
		</div>
	</div>
}