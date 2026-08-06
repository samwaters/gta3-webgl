import { CommandsEnum } from "./commands.ts"
import type { WorkerMessage } from "./types.ts"
import { fetchAssets } from "./fetch.ts"
import { checkFileStatus } from "./check.ts"
import { extractArchive } from "./extract.ts"

const WorkerData = {
  id: "",
  queueId: "",
}

const handleCheck = (message: WorkerMessage) => {
  WorkerData.queueId = message.data.queueId
  checkFileStatus(WorkerData)
}

const handleExtract = (message: WorkerMessage) => {
  WorkerData.queueId = message.data.queueId
  extractArchive(WorkerData)
}

const handleFetch = (message: WorkerMessage) => {
  WorkerData.queueId = message.data.queueId
  fetchAssets(WorkerData)
}

const handleSetId = (message: WorkerMessage) => {
  WorkerData.id = message.data.payload
}

onmessage = (message: WorkerMessage) => {
  if (!message.data || !message.data.command) {
    console.warn("[WORKER] Unknown message", message.data)
    return
  }
  switch (message.data.command) {
    case CommandsEnum.SET_ID:
      handleSetId(message)
      break
    case CommandsEnum.CHECK:
      handleCheck(message)
      break
    case CommandsEnum.EXTRACT:
      handleExtract(message)
      break
    case CommandsEnum.FETCH:
      handleFetch(message)
      break
    default:
      console.error("[WORKER] Unknown message type", message.data)
  }
}
