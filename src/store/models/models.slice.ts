import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { RootState } from "../store"
import type { Models, ModelsState } from "./models.types"

const initialState: ModelsState = {
	error: false,
	loading: false,
	models: {},
	selectedFile: undefined,
	selectedName: undefined,
	selectedPath: undefined,
}

const modelsSlice = createSlice({
	name: "models",
	initialState,
	reducers: {
		clearModels(state) {
			state.models = {}
		},
		selectModel(state, action: PayloadAction<{ file: string, name: string, path: string }>) {
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
		setModels(state, action: PayloadAction<Models>) {
			state.models = action.payload
		}
	},
})

export const loadModels = createAction("models/LOAD")
export const modelsSelector = (state: RootState) => state.models
export const { clearModels, selectModel, setError, setLoading, setModels } = modelsSlice.actions
export const modelsReducer = modelsSlice.reducer
