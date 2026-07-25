import type {Commands} from "./commands.ts";
import type {WorkerStatus} from "./status.ts";

export interface QueueMessage {
    callback: (reply: WorkerReply) => void
    command: Commands
    executorId: string | null
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
        workerId: string
    }
}

export interface WorkerReply {
    payload: any
    workerId: string
}
