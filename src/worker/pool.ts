import { type Commands, CommandsEnum } from "./commands"
import type { QueueMessage, WorkerMessage, WorkerReply, Workers } from "./types"
import { WorkerStatusEnum } from "./status"
import { WorkerMessageTypesEnum } from "./messagetypes.ts"
import { randomUUID } from "../utils/uuid"

export class WorkerPool {
  private static _initialised: boolean = false
  private static _pool: Record<string, Workers> = {}
  private static _queue: QueueMessage[] = []
  private static _queueRunnerId: ReturnType<typeof setInterval> = -1

  public static debug() {
    console.log("-----DEBUG-----")
    console.log(WorkerPool._pool)
    console.log(WorkerPool._queue)
    console.log(WorkerPool._queueRunnerId)
  }

  public static initialise(poolSize: number = 10) {
    if (WorkerPool._initialised) {
      return false
    }
    if (!poolSize || poolSize < 1 || poolSize > 50) {
      throw new Error("Invalid pool size")
    }
    for (let i = 0; i < poolSize; i++) {
      const workerId = randomUUID()
      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      })
      worker.onmessage = WorkerPool.onWorkerMessage
      worker.postMessage({ command: CommandsEnum.SET_ID, payload: workerId })
      WorkerPool._pool[workerId] = {
        lastCommand: CommandsEnum.SET_ID,
        status: WorkerStatusEnum.IDLE,
        worker,
      }
    }
    WorkerPool._initialised = true
  }

  public static onWorkerMessage(message: WorkerMessage) {
    if (!message.data || !message.data.workerId) {
      console.warn("[POOL] Unknown worker message", message)
      return
    }
    // The message has come back from the worker
    const queueItem = WorkerPool._queue.find(
      (q) => q.queueId === message.data.queueId,
    )
    if (!queueItem) {
      console.warn("[POOL] Unknown queue message", message)
      return
    }
    // We need to decide what to do with it here - what type is it?
    if (message.data.type === WorkerMessageTypesEnum.PROGRESS) {
      // This is a progress message, do not remove the task from the queue
      queueItem.onProgress(message.data)
      return
    }
    // Otherwise call either onError or onComplete
    if (message.data.type === WorkerMessageTypesEnum.ERROR) {
      queueItem.onError(message.data)
    } else {
      queueItem.onComplete(message.data)
    }
    // Then clear the item from the queue
    WorkerPool._queue = WorkerPool._queue.filter(
      (q) => q.queueId !== message.data.queueId,
    )
    // Then mark the worker as available
    WorkerPool._pool[message.data.workerId].status = WorkerStatusEnum.IDLE
  }

  private static _queueRunner() {
    // Get the next queued message which does not have an executor
    const nextMessage = WorkerPool._queue.find((q) => q.executorId === null)
    // If there's not one, we can cancel execution - the next run will start it again
    if (!nextMessage) {
      clearInterval(WorkerPool._queueRunnerId)
      WorkerPool._queueRunnerId = -1
      return
    }
    // Now that we have a message, we need to find an available executor
    const workerId = Object.keys(WorkerPool._pool).find(
      (k) => WorkerPool._pool[k].status === WorkerStatusEnum.IDLE,
    )
    // If there's no workerId, all the workers are busy and we can't do anything right now
    if (!workerId) {
      return
    }
    // We have a worker id, so mark it as busy and set the lastCommand
    WorkerPool._pool[workerId].lastCommand = nextMessage.command
    WorkerPool._pool[workerId].status = WorkerStatusEnum.RUNNING
    // Update the command in the queue
    nextMessage.executorId = workerId
    // Send it the message
    WorkerPool._pool[workerId].worker.postMessage({
      command: nextMessage.command,
      payload: nextMessage.payload,
      queueId: nextMessage.queueId,
    })
  }

  public static run(
    command: Commands,
    payload: any,
    onComplete: (reply: WorkerReply) => void,
    onError: (reply: WorkerReply) => void,
    onProgress: (reply: WorkerReply) => void,
  ) {
    WorkerPool._queue.push({
      command,
      executorId: null,
      payload,
      onComplete,
      onError,
      onProgress,
      queueId: randomUUID(),
    })
    if (WorkerPool._queueRunnerId === -1) {
      WorkerPool._queueRunnerId = setInterval(WorkerPool._queueRunner, 10)
    }
  }

  public static terminate() {
    if (!WorkerPool._initialised) {
      return
    }
    Object.keys(WorkerPool._pool).forEach((workerId) => {
      WorkerPool._pool[workerId].worker.terminate()
    })
    WorkerPool._pool = {}
    WorkerPool._initialised = false
  }
}
