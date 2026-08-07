import { store } from "../../../store/store"
import { confirmDelete } from "./confirmdelete"
import { hasAssets } from "./hasassets"
import { noAssets } from "./noassets"

interface MenuItemProps {
  onClick: () => void
  selectable: boolean
  text: string
}

export const getMenuData = (): MenuItemProps[] => {
  const state = store.getState()
  if(state.menu.isConfirmingDelete) {
    return confirmDelete
  }
  if(!state.assets.downloaded || !state.assets.extracted) {
    return noAssets
  }
  return hasAssets
}