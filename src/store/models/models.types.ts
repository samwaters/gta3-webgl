export type Models = { [name: string]: string | Models }
export interface ModelsState {
	error: boolean
	loading: boolean
	models: Models
	selectedFile: string | undefined
	selectedName: string | undefined
	selectedPath: string | undefined
}
