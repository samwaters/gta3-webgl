import { WorkerMessageTypesEnum } from "./messagetypes"

export const deleteAssets = async (workerData: {
    id: string
    queueId: string
}) => {
    const sendMessage = (completed: boolean) => {
        postMessage({
            payload: {
                completed,
            },
            type: completed ? WorkerMessageTypesEnum.COMPLETE : WorkerMessageTypesEnum.ERROR,
            queueId: workerData.queueId,
            workerId: workerData.id,
        })
    }

    const root = await navigator.storage.getDirectory()
    try {
        await root.remove({ recursive: true })
        sendMessage(true)
    } catch {
        sendMessage(false)
    }
}
