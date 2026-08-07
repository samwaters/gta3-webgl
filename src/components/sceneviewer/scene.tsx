import { memo, useEffect, useRef } from "react"
import styles from "./scene.module.css"
import { useAppSelector } from "../../store/hooks"
import { scenesSelector } from "../../store/scenes/scenes.slice"
import { Renderer } from "../../utils/gl/renderer"

export const Scene = memo(() => {
  const { selectedFile } = useAppSelector(scenesSelector)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!selectedFile || !canvas) {
      return
    }
    const renderer = new Renderer(selectedFile, canvas)
    renderer.ready.catch((error: unknown) => {
      console.error(`[SCENE] Could not load ${selectedFile}`, error)
    })
    return () => renderer.dispose()
  }, [selectedFile])

  return (
    <div className={styles.scene}>
      <canvas id="scene-viewer" ref={canvasRef} />
    </div>
  )
})
