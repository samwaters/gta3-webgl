import { all, fork } from "redux-saga/effects"
import { bootstrapSaga } from "./bootstrap/bootstrap.saga.ts"

export function* rootSaga() {
  yield all([fork(bootstrapSaga)])
}
