import { WorkerMessageTypesEnum } from "./messagetypes.ts"

/**
 * Creates a sync access handler for opfs that can be used with pipeTo
 * @param name The file name
 */
const opfsWrite = async (name: string) => {
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle(name, { create: true })
  const accessHandle = await fileHandle.createSyncAccessHandle() // This only works in web workers
  accessHandle.truncate(0)
  let offset = 0
  return new WritableStream({
    write(chunk) {
      offset += accessHandle.write(chunk, { at: offset })
    },
    close() {
      accessHandle.flush()
      accessHandle.close()
    },
    abort() {
      accessHandle.close()
    },
  })
}

/**
 * A progress transformer for a writeable stream that calls onProgress with the number of chunks received and total
 * @param total
 * @param onProgress
 */
const withProgress = (
  total: number,
  onProgress: (rec: number, total: number) => void,
) => {
  let received = 0
  return new TransformStream({
    transform(chunk, controller) {
      received += chunk.length
      onProgress(received, total)
      controller.enqueue(chunk)
    },
  })
}

/**
 * Fetch assets.tar.gz and extract the tar file to OPFS
 * @param workerData The worker's id and queue id
 */
export const fetchAssets = async (workerData: {
  id: string
  queueId: string
}) => {
  const progressHandler = (rec: number, total: number) => {
    postMessage({
      payload: Math.round((rec / total) * 100),
      type: WorkerMessageTypesEnum.PROGRESS,
      queueId: workerData.queueId,
      workerId: workerData.id,
    })
  }
  const response = await fetch("/assets.bin")
  const totalSize = Number(response.headers.get("Content-Length") || 0)
  if (!response.body) {
    throw new Error("Unable to fetch assets.tar.gz")
  }
  try {
    await response.body
      .pipeThrough(withProgress(totalSize, progressHandler))
      .pipeThrough(new DecompressionStream("gzip"))
      .pipeTo(await opfsWrite("assets.tar"))
    postMessage({
      payload: true,
      type: WorkerMessageTypesEnum.COMPLETE,
      queueId: workerData.queueId,
      workerId: workerData.id,
    })
  } catch (e: unknown) {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry("assets.tar").catch(() => {})
    postMessage({
      payload: e,
      type: WorkerMessageTypesEnum.ERROR,
      queueId: workerData.queueId,
      workerId: workerData.id,
    })
  }
}
