import { loadScenes, setError, setLoading, setScenes } from "./scenes.slice"
import { call, put, take, takeLeading } from "redux-saga/effects"
import { CommandsEnum } from "../../worker/commands"
import { type EventChannel } from "redux-saga"
import { runWorker, type WorkerEvent } from "../runWorker"
import { Decode } from "../../utils/decode"

function* handleLoadScenes() {
  const channel: EventChannel<WorkerEvent> = yield call(() =>
    runWorker(CommandsEnum.GETFILES, ["scene.json"]),
  )
  try {
    while (true) {
      const event: WorkerEvent = yield take(channel)
      if (event.kind === "COMPLETE") {
        const decoded = Decode.decode(event.reply.payload.files["scene.json"])
        yield put(setScenes(JSON.parse(decoded)))
        yield put(setError(false))
        yield put(setLoading(false))
      }
      if (event.kind === "ERROR") {
        yield put(setError(true))
        yield put(setLoading(false))
      }
    }
  } finally {
    channel.close()
  }
}

export function* scenesSaga() {
  yield takeLeading(loadScenes.type, handleLoadScenes)
}
