import { WorkerMessageTypesEnum } from "./messagetypes.ts"

export const checkFileStatus = async (
    workerData: { id: string, queueId: string }
) => {

    const sendMessage = (downloaded: boolean, extracted: boolean) => {
        postMessage({
            payload: {
                downloaded,
                extracted
            },
            type: WorkerMessageTypesEnum.COMPLETE,
            queueId: workerData.queueId,
            workerId: workerData.id,
        })
    }

    const root = await navigator.storage.getDirectory()
    try {
        await root.getFileHandle("assets.tar")
    } catch {
        sendMessage(false, false)
        return
    }
    try {
        await root.getFileHandle("gta3.json")
    } catch {
        sendMessage(true, false)
        return
    }
    sendMessage(true, true)
}