import { useEffect, useMemo, useRef, useState } from "react"
import { SearchIcon } from "./foldertree.icons"
import styles from "./foldertree.module.css"
import type { Props } from "./foldertree.types"
import {
  allFolderPaths,
  buildTree,
  defaultOpenPaths,
  filterTree,
} from "./foldertree.utils"
import { Nodes } from "./nodes"

export type { FolderTreeData, FolderTreeSelection } from "./foldertree.types"

const FILTER_DEBOUNCE_MS = 100

export const FolderTree = ({
  data,
  loading = false,
  onSelect,
  selected,
}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState("")
  const [query, setQuery] = useState("")

  const tree = useMemo(() => buildTree(data, 0, ""), [data])
  const nodes = useMemo(
    () => (query ? filterTree(tree, query) : tree),
    [query, tree],
  )

  // A query expands every folder it leaves visible; clearing it (or loading new
  // data) restores the default expansion.
  const [openPaths, setOpenPaths] = useState(() => defaultOpenPaths(tree))
  const [previous, setPrevious] = useState({ query, tree })
  if (previous.query !== query || previous.tree !== tree) {
    setPrevious({ query, tree })
    setOpenPaths(query ? allFolderPaths(nodes) : defaultOpenPaths(tree))
  }

  useEffect(() => {
    const timer = setTimeout(
      () => setQuery(value.trim().toLowerCase()),
      FILTER_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [value])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value)
  }

  const handleClear = () => {
    setValue("")
    setQuery("")
    inputRef.current?.focus()
  }

  const handleToggle = (path: string) => {
    setOpenPaths((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  return (
    <div className={styles.foldertree}>
      <div className={styles.searchBar}>
        <SearchIcon />
        <input
          autoComplete="off"
          className={styles.searchInput}
          onChange={handleChange}
          placeholder="Search…"
          ref={inputRef}
          spellCheck={false}
          type="search"
          value={value}
        />
        {value !== "" && (
          <button
            aria-label="Clear"
            className={styles.searchClear}
            onClick={handleClear}
            title="Clear"
            type="button"
          >
            &times;
          </button>
        )}
      </div>
      <div className={styles.tree}>
        {loading ? (
          <div className={styles.loading} role="status" aria-label="Loading">
            <span className={styles.spinner} />
          </div>
        ) : (
          <Nodes
            nodes={nodes}
            onSelect={onSelect}
            onToggle={handleToggle}
            openPaths={openPaths}
            query={query}
            selected={selected}
          />
        )}
      </div>
    </div>
  )
}
