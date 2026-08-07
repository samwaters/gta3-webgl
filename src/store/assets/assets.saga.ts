import { checkAssets, setDownloaded, setDownloadError, setExtracted, setExtractError } from "./assets.slice"
import { END, eventChannel, type EventChannel, type SagaIterator } from "redux-saga"
import { call, put, take, takeLeading } from "redux-saga/effects"
import { WorkerPool } from "../../worker/pool"
import { CommandsEnum, type Commands } from "../../worker/commands"
import type { WorkerReply } from "../../worker/types"

type WorkerEvent =
    | { kind: "COMPLETE"; reply: WorkerReply }
    | { kind: "ERROR"; reply: WorkerReply }
    | { kind: "PROGRESS"; reply: WorkerReply }

const runWorker = (command: Commands, payload: any): EventChannel<WorkerEvent> => {
    return eventChannel<WorkerEvent>((emit) => {
        WorkerPool.run(
            command,
            payload,
            (reply) => {
                emit({ kind: "COMPLETE", reply });
                emit(END)
            },
            (reply) => {
                emit({ kind: "ERROR", reply });
                emit(END)
            },
            (reply) => {
                emit({ kind: "PROGRESS", reply })
            }
        )
        // Unsubscribe fn, not required here
        return () => {}
    })
}

function* handleCheckAssets(): SagaIterator {
    const channel: EventChannel<WorkerEvent> = yield call(() => runWorker(CommandsEnum.CHECK, ""))
    try {
        // This loop does not run infinitely - it pauses on take(channel)
        while(true) {
            const event: WorkerEvent = yield take(channel)
            if(event.kind === "COMPLETE") {
                yield put(setDownloaded(event.reply.payload.downloaded))
                yield put(setExtracted(event.reply.payload.extracted))
            }
            if(event.kind === "ERROR") {
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

export function* assetsSaga() {
    yield takeLeading(checkAssets.type, handleCheckAssets)
}
