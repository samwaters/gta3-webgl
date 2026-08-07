import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { RootState } from "../store"
import type { Scenes, ScenesState } from "./scenes.types"

const initialState: ScenesState = {
	error: false,
	loading: false,
	scenes: {},
	selectedFile: undefined,
	selectedName: undefined,
	selectedPath: undefined,
}

const scenesSlice = createSlice({
	name: "scenes",
	initialState,
	reducers: {
		clearScenes(state) {
			state.scenes = {}
		},
		selectScene(state, action: PayloadAction<{ file: string, name: string, path: string }>) {
			state.selectedFile = action.payload.file
			state.selectedName = action.payload.name
			state.selectedPath = action.payload.path
		},
		setError(state, action: PayloadAction<boolean>) {
			state.error = action.payload
		},
		setLoading(state, action: PayloadAction<boolean>) {
			state.loading = action.payload
		},
		setScenes(state, action: PayloadAction<Scenes>) {
			state.scenes = action.payload
		}
	},
})

export const loadScenes = createAction("scenes/LOAD")
export const scenesSelector = (state: RootState) => state.scenes
export const { clearScenes, selectScene, setError, setLoading, setScenes } = scenesSlice.actions
export const scenesReducer = scenesSlice.reducer
