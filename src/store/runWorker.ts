import type { Commands } from "../worker/commands"
import { END, eventChannel, type EventChannel } from "redux-saga"
import { WorkerPool } from "../worker/pool"
import type { WorkerReply } from "../worker/types"

export type WorkerEvent =
	| { kind: "COMPLETE"; reply: WorkerReply }
	| { kind: "ERROR"; reply: WorkerReply }
	| { kind: "PROGRESS"; reply: WorkerReply }

export const runWorker = (
	command: Commands,
	payload: any,
): EventChannel<WorkerEvent> => {
	return eventChannel<WorkerEvent>((emit) => {
		WorkerPool.run(
			command,
			payload,
			(reply) => {
				emit({ kind: "COMPLETE", reply })
				emit(END)
			},
			(reply) => {
				emit({ kind: "ERROR", reply })
				emit(END)
			},
			(reply) => {
				emit({ kind: "PROGRESS", reply })
			},
		)
		// Unsubscribe fn, not required here
		return () => {}
	})
}