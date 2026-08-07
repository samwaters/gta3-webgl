/** A folder maps a name to either a file (its value) or a nested folder. */
export type FolderTreeData = { [name: string]: string | FolderTreeData }

/**
 * A selected file, e.g.
 * { file: "air_grnd01.gltf", name: "air_grnd01", path: "data/maps/gta3" }.
 */
export interface FolderTreeSelection {
  /** The manifest entry's value — the file name. */
  file: string
  /** The manifest entry's key — what the row displays. */
  name: string
  /** The containing folder's path. */
  path: string
}

export type SelectHandler = (selection: FolderTreeSelection) => void

export interface FileNode {
  depth: number
  /** The entry's value — the file name, e.g. "amco_floor.gltf". */
  file: string
  /** The entry's key — what the row displays, e.g. "amco_floor". */
  name: string
  /** Folder path built from the ancestor keys, e.g. "data/maps/comse". */
  parentPath: string
  /** Selection identity: parentPath + file, matched against `selected`. */
  path: string
  type: "file"
}

export interface FolderNode {
  children: TreeNode[]
  count: number
  depth: number
  hasFolders: boolean
  name: string
  path: string
  type: "folder"
}

export type TreeNode = FileNode | FolderNode

export interface Props {
  data: FolderTreeData
  loading?: boolean
  /** Called when a file row is clicked. */
  onSelect?: SelectHandler
  /** The selected file as a full path, e.g. "data/maps/comse/amco_floor.gltf". */
  selected?: string
}
