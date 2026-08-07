export type Scenes = { [name: string]: string | Scenes }
export interface ScenesState {
	error: boolean
	loading: boolean
	scenes: Scenes
	selectedFile: string | undefined
	selectedName: string | undefined
	selectedPath: string | undefined
}
