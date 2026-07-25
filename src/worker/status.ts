export const WorkerStatusEnum = {
    IDLE: "IDLE",
    RUNNING: "RUNNING",
}

export type WorkerStatus = (typeof WorkerStatusEnum)[keyof typeof WorkerStatusEnum]
