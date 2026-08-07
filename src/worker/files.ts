import { WorkerMessageTypesEnum } from "./messagetypes"

export const getFiles = async (workerData: {
	files: string[]
	id: string
	queueId: string
}) => {
	const root = await navigator.storage.getDirectory()
	// Paths are slash separated, mirroring the archive the files were unpacked
	// from, so walk the segments rather than treating the whole path as a name.
	const getFile = async (path: string) => {
		try {
			const segments = path.split("/").filter(segment => segment !== "")
			let directory = root
			for (const segment of segments.slice(0, -1)) {
				directory = await directory.getDirectoryHandle(segment)
			}
			const fileHandle = await directory.getFileHandle(segments[segments.length - 1])
			const fileData = await fileHandle.getFile()
			return await fileData.bytes()
		} catch {
			return null
		}
	}
	const sendMessage = (fileDict: Record<string, (Uint8Array<ArrayBuffer> | null)>) => {
		postMessage({
			payload: {
				files: fileDict,
			},
			type: WorkerMessageTypesEnum.COMPLETE,
			queueId: workerData.queueId,
			workerId: workerData.id,
		})
	}


	const fileBytes = await Promise.all(workerData.files.map(file => getFile(file)))
	const fileDict = Object.fromEntries(workerData.files.map((k, i) => [k, fileBytes[i]]))
	sendMessage(fileDict)
}
