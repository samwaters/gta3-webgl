import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { MenuState } from "./menu.types"
import type { RootState } from "../store"

const initialState: MenuState = {
  isConfirmingDelete: false,
}

const menuSlice = createSlice({
  name: "menu",
  initialState,
  reducers: {
    setConfirmingDelete(state, action: PayloadAction<boolean>) {
      state.isConfirmingDelete = action.payload
    },
  },
})

export const menuSelector = (state: RootState) => state.menu
export const { setConfirmingDelete } = menuSlice.actions
export const menuReducer = menuSlice.reducer
