import styles from "./foldertree.module.css"

export const ChevronIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path fill="currentColor" d="M6 4l4 4-4 4V4z" />
  </svg>
)

export const FolderIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M1.5 3.5h4l1.2 1.5h7.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"
    />
  </svg>
)

export const FileIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M8 1L2 4.2v7.6L8 15l6-3.2V4.2L8 1zm0 1.7l4 2.1-4 2.1-4-2.1 4-2.1zM3.2 6.1l4.2 2.2v4.8L3.2 11V6.1zm5.4 7V8.3l4.2-2.2V11l-4.2 2.1z"
    />
  </svg>
)

export const SearchIcon = () => (
  <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M11.7 10.3a5 5 0 1 0-1.4 1.4l3 3 1.4-1.4-3-3zM3 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0z"
    />
  </svg>
)
