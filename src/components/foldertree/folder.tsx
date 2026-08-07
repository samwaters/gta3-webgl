import clsx from "clsx"
import type { Props } from "./folder.types"
import { ChevronIcon, FolderIcon } from "./foldertree.icons"
import styles from "./foldertree.module.css"
import { indent } from "./foldertree.utils"
import { Nodes } from "./nodes"

export const Folder = ({
  node,
  onSelect,
  onToggle,
  openPaths,
  query,
  selected,
}: Props) => {
  const isOpen = openPaths.has(node.path)

  const handleClick = () => {
    onToggle(node.path)
  }

  return (
    <li className={styles.node}>
      <button
        aria-expanded={isOpen}
        className={clsx(styles.row, styles.folderRow)}
        onClick={handleClick}
        style={indent(node.depth)}
        type="button"
      >
        <span className={clsx(styles.chevron, { [styles.open]: isOpen })}>
          <ChevronIcon />
        </span>
        <span className={styles.icon}>
          <FolderIcon />
        </span>
        <span className={styles.label}>{node.name}</span>
        <span className={styles.badge}>{node.count}</span>
      </button>
      {isOpen && (
        <Nodes
          nodes={node.children}
          onSelect={onSelect}
          onToggle={onToggle}
          openPaths={openPaths}
          query={query}
          selected={selected}
        />
      )}
    </li>
  )
}
