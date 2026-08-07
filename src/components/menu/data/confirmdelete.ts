import { store } from "../../../store/store"
import { setConfirmingDelete, setDeleting } from "../../../store/menu/menu.slice"
import { deleteAssets } from "../../../store/assets/assets.slice";

const handleNo = () => {
  store.dispatch(setConfirmingDelete(false))
}

const handleYes = () => {
  store.dispatch(setDeleting(true))
  store.dispatch(setConfirmingDelete(false))
  store.dispatch(deleteAssets())
}

export const confirmDelete = [
  { onClick: () => {}, selectable: false, text: "Are you sure?" },
  { onClick: handleYes, selectable: true, text: "Yes" },
  { onClick: handleNo, selectable: true, text: "No" },
]
