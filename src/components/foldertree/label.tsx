import styles from "./foldertree.module.css"
import type { Props } from "./label.types"

export const Label = ({ name, query }: Props) => {
  const index = query ? name.toLowerCase().indexOf(query) : -1
  if (index < 0) return <span className={styles.label}>{name}</span>

  return (
    <span className={styles.label}>
      {name.slice(0, index)}
      <span className={styles.highlight}>
        {name.slice(index, index + query.length)}
      </span>
      {name.slice(index + query.length)}
    </span>
  )
}
