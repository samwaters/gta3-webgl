import { CommandsEnum } from "./commands.ts";
import type {WorkerMessage} from "./types.ts";
const WorkerData = {
    id: "",
    queueId: ""
}

const delay = async (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const handleFetch = (message: WorkerMessage) => {
    WorkerData.queueId = message.data.queueId
    delay(500).then(() => {
        sendMessage("FETCH RESPONSE - " + message.data.payload);
    })
}

const handleSetId = (message: WorkerMessage) => {
    console.log("[WORKER] setId", message.data);
    WorkerData.id = message.data.payload
}

const sendMessage = (payload: any) => {
    postMessage({
        payload,
        queueId: WorkerData.queueId,
        workerId: WorkerData.id
    })
}

onmessage = (message: WorkerMessage) => {
    if(!message.data || !message.data.command) {
        console.warn("[WORKER] Unknown message", message.data)
        return
    }
    switch(message.data.command) {
        case CommandsEnum.SET_ID:
            handleSetId(message)
            break
        case CommandsEnum.FETCH:
            handleFetch(message)
            break
        default:
            console.error("[WORKER] Unknown message type", message.data)
    }
}