import { store } from "../../../store/store"
import { checkAssets, fetchAssets, setDownloading } from "../../../store/assets/assets.slice"

const handleDownload = () => {
  store.dispatch(setDownloading(true))
  store.dispatch(fetchAssets())
}

const handleRefresh = () => {
  store.dispatch(checkAssets())
}

export const noAssets = [
  { onClick: handleDownload, selectable: true, text: "download assets" },
  { onClick: handleRefresh, selectable: true, text: "refresh asset status" },
]
