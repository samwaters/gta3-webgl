import { memo, useEffect, useRef } from "react"
import styles from "./model.module.css"
import { useAppSelector } from "../../store/hooks"
import { modelsSelector } from "../../store/models/models.slice"
import { Renderer } from "../../utils/gl/renderer.ts"

export const Model = memo(() => {
	const { selectedFile } = useAppSelector(modelsSelector)
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if(!selectedFile || !canvas) {
			return
		}
		const renderer = new Renderer(selectedFile, canvas)
		renderer.ready.catch((error: unknown) => {
			console.error(`[MODEL] Could not load ${selectedFile}`, error)
		})
		return () => renderer.dispose()
	}, [selectedFile]);

	return <div className={styles.model}>
		<canvas id="model-viewer" ref={canvasRef} />
	</div>
})
