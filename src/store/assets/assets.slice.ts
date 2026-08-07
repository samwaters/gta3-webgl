import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit"
import type { AssetsState } from "./assets.types"
import type { RootState } from "../store"

const initialState: AssetsState = {
  downloaded: false,
  downloadError: false,
  downloadProgress: 0,
  downloading: false,
  extracted: false,
  extractError: false,
  extractProgress: 0,
  extracting: false,
}

const assetsSlice = createSlice({
  name: "assets",
  initialState,
  reducers: {
    setDownloaded(state, action: PayloadAction<boolean>) {
      state.downloaded = action.payload
    },
    setDownloadError(state, action: PayloadAction<boolean>) {
      state.downloadError = action.payload
    },
    setDownloadProgress(state, action: PayloadAction<number>) {
      state.downloadProgress = action.payload
    },
    setDownloading(state, action: PayloadAction<boolean>) {
      state.downloading = action.payload
    },
    setExtracted(state, action: PayloadAction<boolean>) {
      state.extracted = action.payload
    },
    setExtractError(state, action: PayloadAction<boolean>) {
      state.extractError = action.payload
    },
    setExtractProgress(state, action: PayloadAction<number>) {
      state.extractProgress = action.payload
    },
    setExtracting(state, action: PayloadAction<boolean>) {
      state.extracting = action.payload
    },
  },
})
export const checkAssets = createAction("assets/CHECK")
export const deleteAssets = createAction("assets/DELETE")
export const extractAssets = createAction("assets/EXTRACT")
export const fetchAssets = createAction("assets/FETCH")
export const {
  setDownloaded,
  setDownloadError,
  setDownloadProgress,
  setDownloading,
  setExtracted,
  setExtractError,
  setExtractProgress,
  setExtracting,
} = assetsSlice.actions
export const assetsSelector = (state: RootState) => state.assets
export const assetsReducer = assetsSlice.reducer
