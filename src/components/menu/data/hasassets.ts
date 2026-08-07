import { store } from "../../../store/store"
import { setConfirmingDelete } from "../../../store/menu/menu.slice"
import { checkAssets } from "../../../store/assets/assets.slice"
import { router } from "../../../routes"

const handleDelete = () => {
  store.dispatch(setConfirmingDelete(true))
}

const handleNavigate = (path: string) => {
  router.navigate(path)
}

const handleRefresh = () => {
  store.dispatch(checkAssets())
}

export const hasAssets = [
  { onClick: () => handleNavigate("/models"), selectable: true, text: "model viewer" },
  { onClick: () => handleNavigate("/scenes"), selectable: true, text: "scene viewer" },
  { onClick: () => handleNavigate("/city"), selectable: true, text: "full city view" },
  { onClick: handleRefresh, selectable: true, text: "refresh asset status" },
  { onClick: handleDelete, selectable: true, text: "delete assets" }
]