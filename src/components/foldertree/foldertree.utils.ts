import type {
  FileNode,
  FolderNode,
  FolderTreeData,
  TreeNode,
} from "./foldertree.types"

const isFolder = (value: string | FolderTreeData): value is FolderTreeData =>
  typeof value !== "string"

/** Folders first, then files, each sorted naturally by name. */
export const buildTree = (
  data: FolderTreeData,
  depth: number,
  parentPath: string,
): TreeNode[] => {
  const folders: FolderNode[] = []
  const files: FileNode[] = []

  for (const [name, value] of Object.entries(data)) {
    const path = parentPath ? `${parentPath}/${name}` : name
    if (isFolder(value)) {
      const children = buildTree(value, depth + 1, path)
      folders.push({
        children,
        count: children.reduce(
          (total, child) => total + (child.type === "file" ? 1 : child.count),
          0,
        ),
        depth,
        hasFolders: children.some((child) => child.type === "folder"),
        name,
        path,
        type: "folder",
      })
    } else {
      files.push({
        depth,
        file: value,
        name,
        parentPath,
        path: parentPath ? `${parentPath}/${value}` : value,
        type: "file",
      })
    }
  }

  const byName = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  return [...folders.sort(byName), ...files.sort(byName)]
}

/** Keeps files whose name contains the query, and folders that still hold one. */
export const filterTree = (nodes: TreeNode[], query: string): TreeNode[] => {
  const kept: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === "file") {
      if (node.name.toLowerCase().includes(query)) kept.push(node)
      continue
    }
    const children = filterTree(node.children, query)
    if (children.length > 0) kept.push({ ...node, children })
  }
  return kept
}

const collectFolders = (
  nodes: TreeNode[],
  include: (node: FolderNode) => boolean,
): Set<string> => {
  const paths = new Set<string>()
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.type !== "folder") continue
      if (include(item)) paths.add(item.path)
      walk(item.children)
    }
  }
  walk(nodes)
  return paths
}

/** Default expansion: the top two levels of structural folders. */
export const defaultOpenPaths = (nodes: TreeNode[]) =>
  collectFolders(nodes, (node) => node.depth <= 1 && node.hasFolders)

export const allFolderPaths = (nodes: TreeNode[]) =>
  collectFolders(nodes, () => true)

export const indent = (depth: number) => ({
  paddingLeft: `calc(8px + ${depth} * var(--indent))`,
})
