import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { MenuState } from "./menu.types"
import type { RootState } from "../store"

const initialState: MenuState = {
  isConfirmingDelete: false,
  isDeleting: false,
}

const menuSlice = createSlice({
  name: "menu",
  initialState,
  reducers: {
    setConfirmingDelete(state, action: PayloadAction<boolean>) {
      state.isConfirmingDelete = action.payload
    },
    setDeleting(state, action: PayloadAction<boolean>) {
      state.isDeleting = action.payload
    }
  },
})

export const menuSelector = (state: RootState) => state.menu
export const { setConfirmingDelete, setDeleting } = menuSlice.actions
export const menuReducer = menuSlice.reducer
