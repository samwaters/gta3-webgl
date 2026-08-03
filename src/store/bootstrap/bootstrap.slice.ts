import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { BootstrapState } from "./bootstrap.types.ts"

const initialState: BootstrapState = {
  ready: false,
}

const bootstrapSlice = createSlice({
  name: "bootstrap",
  initialState,
  reducers: {
    setReady(state, action: PayloadAction<boolean>) {
      state.ready = action.payload
    },
  },
})
export const bootstrapReady = createAction<boolean>("bootstrap/READY")
export const { setReady } = bootstrapSlice.actions
export const bootstrapReducer = bootstrapSlice.reducer
