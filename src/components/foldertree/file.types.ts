import type { FileNode, SelectHandler } from "./foldertree.types"

export interface Props {
  node: FileNode
  onSelect?: SelectHandler
  query: string
  selected: boolean
}
