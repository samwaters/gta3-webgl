import type { FolderNode, SelectHandler } from "./foldertree.types"

export interface Props {
  node: FolderNode
  onSelect?: SelectHandler
  onToggle: (path: string) => void
  openPaths: Set<string>
  query: string
  selected?: string
}
