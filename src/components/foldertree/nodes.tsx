import { File } from "./file"
import { Folder } from "./folder"
import styles from "./foldertree.module.css"
import type { Props } from "./nodes.types"

export const Nodes = ({
  nodes,
  onSelect,
  onToggle,
  openPaths,
  query,
  selected,
}: Props) => (
  <ul className={styles.children}>
    {nodes.map((node) =>
      node.type === "folder" ? (
        <Folder
          key={node.name}
          node={node}
          onSelect={onSelect}
          onToggle={onToggle}
          openPaths={openPaths}
          query={query}
          selected={selected}
        />
      ) : (
        <File
          key={node.name}
          node={node}
          onSelect={onSelect}
          query={query}
          selected={selected === node.path}
        />
      ),
    )}
  </ul>
)
