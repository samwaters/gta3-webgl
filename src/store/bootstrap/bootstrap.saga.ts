import { bootstrapReady, setReady } from "./bootstrap.slice.ts"
import { put, takeEvery } from "redux-saga/effects"
import type { PayloadAction } from "@reduxjs/toolkit"

function* handleBootstrapReady(action: PayloadAction<boolean>) {
  yield put(setReady(action.payload))
}

export function* bootstrapSaga() {
  yield takeEvery(bootstrapReady.type, handleBootstrapReady)
}
