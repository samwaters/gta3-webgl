import {
  checkAssets,
  deleteAssets,
  extractAssets,
  fetchAssets,
  setDownloaded,
  setDownloadError,
  setDownloading,
  setDownloadProgress,
  setExtracted,
  setExtractError,
  setExtracting,
  setExtractProgress,
} from "./assets.slice"
import {
  type EventChannel,
  type SagaIterator,
} from "redux-saga"
import { call, put, take, takeLeading } from "redux-saga/effects"
import { CommandsEnum } from "../../worker/commands"
import { setDeleting } from "../menu/menu.slice"
import { type WorkerEvent, runWorker } from "../runWorker"

function* handleCheckAssets(): SagaIterator {
  const channel: EventChannel<WorkerEvent> = yield call(() =>
    runWorker(CommandsEnum.CHECK, ""),
  )
  try {
    // This loop does not run infinitely - it pauses on take(channel)
    while (true) {
      const event: WorkerEvent = yield take(channel)
      if (event.kind === "COMPLETE") {
        yield put(setDownloaded(event.reply.payload.downloaded))
        yield put(setExtracted(event.reply.payload.extracted))
      }
      if (event.kind === "ERROR") {
        yield put(setDownloaded(false))
        yield put(setExtracted(false))
        yield put(setExtractError(true))
        yield put(setDownloadError(true))
      }
    }
  } finally {
    channel.close()
  }
}

function* handleDeleteAssets(): SagaIterator {
  const channel: EventChannel<WorkerEvent> = yield call(() =>
    runWorker(CommandsEnum.DELETE, ""),
  )
  try {
    while (true) {
      const event: WorkerEvent = yield take(channel)
      if (event.kind === "COMPLETE") {
        yield put(setDownloaded(false))
        yield put(setExtracted(false))
        yield put(setDeleting(false))
      }
      if (event.kind === "ERROR") {
        yield put(setDownloadError(true))
        yield put(setExtractError(true))
      }
    }
  } finally {
    channel.close()
  }
}

function* handleExtract(): SagaIterator {
  const channel: EventChannel<WorkerEvent> = yield call(() =>
    runWorker(CommandsEnum.EXTRACT, ""),
  )
  try {
    while (true) {
      const event: WorkerEvent = yield take(channel)
      if(event.kind === "COMPLETE") {
        yield put(setExtracted(true))
        yield put(setExtracting(false))
      }
      if (event.kind === "ERROR") {
        yield put(setExtracting(false))
        yield put(setExtracted(false))
        yield put(setExtractError(true))
      }
      if (event.kind === "PROGRESS") {
        yield put(setExtractProgress(event.reply.payload))
      }
    }
  } finally {
    channel.close()
  }
}

function* handleFetch(): SagaIterator {
  const channel: EventChannel<WorkerEvent> = yield call(() =>
    runWorker(CommandsEnum.FETCH, ""),
  )
  try {
    while(true) {
      const event: WorkerEvent = yield take(channel)
      if (event.kind === "COMPLETE") {
        yield put(setDownloaded(true))
        yield put(setDownloading(false))
        // Extract straight away
        yield put(setExtracting(true))
        yield put(extractAssets())
      }
      if (event.kind === "ERROR") {
        yield put(setDownloading(false))
        yield put(setDownloaded(false))
        yield put(setDownloadError(true))
      }
      if (event.kind === "PROGRESS") {
        yield put(setDownloadProgress(event.reply.payload))
      }
    }
  } finally {
    channel.close()
  }
}

export function* assetsSaga() {
  yield takeLeading(checkAssets.type, handleCheckAssets)
  yield takeLeading(deleteAssets.type, handleDeleteAssets)
  yield takeLeading(extractAssets.type, handleExtract)
  yield takeLeading(fetchAssets.type, handleFetch)
}
