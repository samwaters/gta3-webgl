import { store } from "../../../store/store"
import { setConfirmingDelete } from "../../../store/menu/menu.slice"

const handleNo = () => {
    store.dispatch(setConfirmingDelete(false))
}

const handleYes = () => {
    store.dispatch(setConfirmingDelete(false))
}

export const confirmDelete = [
  { onClick: () => {}, selectable: false, text: "Are you sure?" },
  { onClick: handleYes, selectable: true, text: "Yes" },
  { onClick: handleNo, selectable: true, text: "No" },
]