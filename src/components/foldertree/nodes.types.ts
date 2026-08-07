import type { SelectHandler, TreeNode } from "./foldertree.types"

export interface Props {
  nodes: TreeNode[]
  onSelect?: SelectHandler
  onToggle: (path: string) => void
  openPaths: Set<string>
  query: string
  selected?: string
}
