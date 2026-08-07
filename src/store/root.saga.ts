import { all, fork } from "redux-saga/effects"
import { assetsSaga } from "./assets/assets.saga"
import { bootstrapSaga } from "./bootstrap/bootstrap.saga"
import { modelsSaga } from "./models/models.saga"
import { scenesSaga } from "./scenes/scenes.saga"
import { workersSaga } from "./workers/workers.saga"

export function* rootSaga() {
  yield all([
    fork(assetsSaga),
    fork(bootstrapSaga),
    fork(modelsSaga),
    fork(scenesSaga),
    fork(workersSaga)
  ])
}
