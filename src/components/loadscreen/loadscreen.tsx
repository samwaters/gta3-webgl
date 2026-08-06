import styles from "./loadscreen.module.css"
import { ProgressBar } from "../progressbar/progressbar"
import {useAppSelector} from "../../store/hooks.ts";
import {assetsSelector} from "../../store/assets/assets.slice.ts";

export const LoadScreen = () => {
    const { downloadProgress, extractProgress } = useAppSelector(assetsSelector)
    return <div className={styles.loadscreen}>
        <div className={styles.progressContainer}>
            <ProgressBar progress={downloadProgress + extractProgress} />
        </div>
    </div>
}
