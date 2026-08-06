import type { Commands } from "./commands.ts"
import type { WorkerStatus } from "./status.ts"
import type { WorkerMessageTypes } from "./messagetypes.ts"

export interface QueueMessage {
  command: Commands
  executorId: string | null
  onComplete: (reply: WorkerReply) => void
  onError: (reply: WorkerReply) => void
  onProgress: (reply: WorkerReply) => void
  payload: any
  queueId: string
}

export interface Workers {
  lastCommand: Commands
  status: WorkerStatus
  worker: Worker
}

export interface WorkerMessage extends MessageEvent {
  data: {
    command: Commands
    payload: any
    queueId: string
    type: WorkerMessageTypes
    workerId: string
  }
}

export interface WorkerReply {
  payload: any
  workerId: string
}
