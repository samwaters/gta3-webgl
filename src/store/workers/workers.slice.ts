import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { WorkersState } from "./workers.types.ts"

const initialState: WorkersState = {
    initialised: false,
    poolSize: 0,
}

const workersSlice = createSlice({
    name: "workers",
    initialState,
    reducers: {
        setInitialised(state, action: PayloadAction<boolean>) {
            state.initialised = action.payload
        },
        setPoolSize(state, action: PayloadAction<number>) {
            state.poolSize = action.payload
        },
    },
})
export const startWorkerPool = createAction("workers/START_POOL")
export const { setInitialised, setPoolSize } = workersSlice.actions
export const workersReducer = workersSlice.reducer
