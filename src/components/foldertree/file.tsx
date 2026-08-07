import clsx from "clsx"
import type { Props } from "./file.types"
import { FileIcon } from "./foldertree.icons"
import styles from "./foldertree.module.css"
import { indent } from "./foldertree.utils"
import { Label } from "./label"

export const File = ({ node, onSelect, query, selected }: Props) => {
  const className = clsx(styles.row, styles.fileRow, {
    [styles.selectable]: onSelect,
    [styles.selected]: selected,
  })

  const content = (
    <>
      <span className={styles.chevron} />
      <span className={styles.icon}>
        <FileIcon />
      </span>
      <Label name={node.name} query={query} />
    </>
  )

  const handleClick = () => {
    onSelect?.({ file: node.file, name: node.name, path: node.parentPath })
  }

  return (
    <li className={styles.node}>
      {onSelect ? (
        <button
          aria-current={selected}
          className={className}
          onClick={handleClick}
          style={indent(node.depth)}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className={className} style={indent(node.depth)}>
          {content}
        </div>
      )}
    </li>
  )
}
