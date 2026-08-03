export const WorkerMessageTypesEnum = {
    COMPLETE: "COMPLETE",
    ERROR: "ERROR",
    PROGRESS: "PROGRESS",
}

export type WorkerMessageTypes =
    (typeof WorkerMessageTypesEnum)[keyof typeof WorkerMessageTypesEnum]
