import { useEffect } from "react"
import { useAppDispatch, useAppSelector } from "../../store/hooks"
import { assetsSelector, checkAssets } from "../../store/assets/assets.slice"
import { LoadScreen } from "../../components/loadscreen/loadscreen"
import * as styles from "./home.module.css"
import { Menu } from "../../components/menu/menu"

export const Home = () => {
  const dispatch = useAppDispatch()
  const { downloading, extracting } = useAppSelector(assetsSelector)

  useEffect(() => {
    dispatch(checkAssets())
  }, []);

  return <div className={styles.homepage}>
    <div className={styles.homepageContainer}>
      {(downloading || extracting) && <LoadScreen />}
      {(!downloading && !extracting) && <Menu />}
    </div>
  </div>
}
