/**
 * Ambient types for the parts of the OPFS API that TypeScript's bundled DOM
 * lib does not declare.
 *
 * createSyncAccessHandle() is worker-only, and remove() is newer than the
 * shipped lib, so fetch.ts and extract.ts fail to compile without these.
 * Declared here rather than pulled from @types/wicg-file-system-access to keep
 * the dependency out of the project.
 */

interface FileSystemReadWriteOptions {
  at?: number
}

interface FileSystemRemoveOptions {
  recursive?: boolean
}

interface FileSystemHandle {
  // Called on the OPFS root, this clears all of OPFS in one call.
  remove(options?: FileSystemRemoveOptions): Promise<void>
}

interface FileSystemSyncAccessHandle {
  close(): void
  flush(): void
  getSize(): number
  read(buffer: ArrayBufferView, options?: FileSystemReadWriteOptions): number
  truncate(newSize: number): void
  write(buffer: ArrayBufferView, options?: FileSystemReadWriteOptions): number
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
}
