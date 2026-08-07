import { WorkerPool } from "../worker/pool"
import { CommandsEnum } from "../worker/commands"
import type { WorkerReply } from "../worker/types"

export interface OPFSFiles {
	files: Record<string, (Uint8Array<ArrayBuffer> | null)>
}

export const getFilesFromOPFS = (paths: string[]): Promise<OPFSFiles> => {
	return new Promise(resolve => {
		const successFn = (reply: WorkerReply) => {
			resolve(reply.payload as OPFSFiles)
		}
		const voidFn = () => {}
		WorkerPool.run (
			CommandsEnum.GETFILES,
			paths,
			successFn,
			voidFn,
			voidFn
		)
	})
}
