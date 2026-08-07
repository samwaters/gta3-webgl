import { CommandsEnum } from "./commands"
import { checkFileStatus } from "./check"
import { deleteAssets } from "./delete"
import { extractArchive } from "./extract"
import { fetchAssets } from "./fetch"
import type { WorkerMessage } from "./types"
import { getFiles } from "./files"

interface WorkerData {
  files?: string[]
  id: string
  queueId: string
}

const workerData: WorkerData = {
  id: "",
  queueId: "",
}

const handleCheck = (message: WorkerMessage) => {
  workerData.queueId = message.data.queueId
  checkFileStatus(workerData)
}

const handleDelete = (message: WorkerMessage) => {
  workerData.queueId = message.data.queueId
  deleteAssets(workerData)
}

const handleExtract = (message: WorkerMessage) => {
  workerData.queueId = message.data.queueId
  extractArchive(workerData)
}

const handleFetch = (message: WorkerMessage) => {
  workerData.queueId = message.data.queueId
  fetchAssets(workerData)
}

const handleGetFiles = (message: WorkerMessage) => {
  workerData.queueId = message.data.queueId
  workerData.files = message.data.payload
  getFiles(workerData as WorkerData & { files: string })
}

const handleSetId = (message: WorkerMessage) => {
  workerData.id = message.data.payload
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
    case CommandsEnum.DELETE:
      handleDelete(message)
      break
    case CommandsEnum.EXTRACT:
      handleExtract(message)
      break
    case CommandsEnum.FETCH:
      handleFetch(message)
      break
    case CommandsEnum.GETFILES:
      handleGetFiles(message)
      break
    default:
      console.error("[WORKER] Unknown message type", message.data)
  }
}
