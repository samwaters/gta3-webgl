import { setInitialised, setPoolSize, startWorkerPool } from "./workers.slice"
import { put, select, takeEvery } from "redux-saga/effects"
import { WorkerPool } from "../../worker/pool"
import type { RootState } from "../store"

function* handleStartPool() {
  const isInitialised: boolean = yield select(
    (state: RootState) => state.workers.initialised,
  )
  if (isInitialised) {
    console.warn("Trying to start an already initialised worker pool")
    return
  }
  yield put(setPoolSize(navigator.hardwareConcurrency))
  WorkerPool.initialise(navigator.hardwareConcurrency)
  yield put(setInitialised(true))
}

export function* workersSaga() {
  yield takeEvery(startWorkerPool.type, handleStartPool)
}
